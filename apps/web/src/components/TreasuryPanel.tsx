import { useCallback, useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { shortAddress } from '../lib/format';
import { fmtUsdc, isTreasuryAddress, shortRef, type TreasuryView } from '../lib/treasury';

/**
 * Which Smart Agent funds this player's night.
 *
 * The default is the one the Home already told us about — their own Smart Agent — so the common case
 * is "confirm the number you are looking at". Anything else has to be typed in and is only accepted
 * after the card room has checked on chain that this player custodies it; the refusal comes back
 * saying which of the two facts failed, and it is shown verbatim rather than rewritten into "invalid".
 *
 * The faucet is labelled as what it is. Minting your own money is only sane because this asset is a
 * test token on a private chain, and a control that does that must never look like a deposit.
 */
export function TreasuryPanel({ session }: { session: AppSession }) {
  const [view, setView] = useState<TreasuryView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState<null | 'select' | 'fund'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState('100');

  const load = useCallback(async () => {
    try {
      setView(await api.getTreasury(session.token));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? `${e.status}: ${e.message}` : 'Could not reach the card room to read your treasury.');
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = useCallback(
    async (address: string) => {
      setBusy('select');
      setError(null);
      setNotice(null);
      try {
        const r = await api.selectTreasury(address, session.token);
        setNotice(`Play is funded from ${shortAddress(r.chosen)}.`);
        setCustom('');
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [load, session.token],
  );

  const fund = useCallback(async () => {
    setBusy('fund');
    setError(null);
    setNotice(null);
    try {
      const r = await api.fundTreasury(fundAmount.trim(), session.token);
      setNotice(`Minted ${r.mintedUsdc} test USDC — ${shortRef(r.txHash)}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [fundAmount, load, session.token]);

  if (loadError) {
    return (
      <section className="panel treasury">
        <h2>Your treasury</h2>
        <div className="form-error">{loadError}</div>
      </section>
    );
  }
  if (!view) {
    return (
      <section className="panel treasury">
        <h2>Your treasury</h2>
        <p className="hint">Loading…</p>
      </section>
    );
  }
  if (view.unavailable) {
    return (
      <section className="panel treasury">
        <h2>Your treasury</h2>
        <p className="hint">{view.unavailable}</p>
        <p className="hint">Play-money tables are unaffected.</p>
      </section>
    );
  }

  const chosen = view.chosen;
  const chosenBalance = fmtUsdc(view.balance);
  const empty = view.balance !== null && BigInt(view.balance) === 0n;
  const customValid = isTreasuryAddress(custom);

  return (
    <section className="panel treasury">
      <h2>Your treasury</h2>
      <p className="hint">
        The Smart Agent that pays your buy-ins and receives your cash-outs, on faithchain {view.chainId}. Play money never
        touches it.
      </p>

      {chosen ? (
        <div className="treasury-chosen">
          <span className="tag live">funding play</span>
          <code className="mono" title={chosen}>
            {shortAddress(chosen)}
          </code>
          <strong className="treasury-balance">{chosenBalance === null ? '—' : `${chosenBalance} USDC`}</strong>
        </div>
      ) : (
        <p className="hint">No treasury chosen yet — you cannot sit at a settled table until you pick one.</p>
      )}

      <ul className="treasury-list">
        {view.candidates.map((c) => (
          <li key={c.address} className={c.address === chosen ? 'is-chosen' : undefined}>
            <span className="treasury-label">
              {c.label}
              {c.source === 'home-agent' ? <span className="tag">your Smart Agent</span> : null}
            </span>
            <code className="mono" title={c.address}>
              {shortAddress(c.address)}
            </code>
            <span className="num">{c.balanceUsdc === null ? (c.error ? '—' : '…') : `${fmtUsdc(c.balance) ?? c.balanceUsdc} USDC`}</span>
            {c.address === chosen ? (
              <span className="hint">in use</span>
            ) : (
              <button type="button" className="small" disabled={busy !== null} onClick={() => void choose(c.address)}>
                use this
              </button>
            )}
            {c.error ? <span className="form-error">{c.error}</span> : null}
          </li>
        ))}
      </ul>

      <label className="treasury-custom">
        Another treasury you custody
        <span className="pair">
          <input
            type="text"
            value={custom}
            spellCheck={false}
            placeholder="0x…"
            maxLength={64}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button type="button" disabled={busy !== null || !customValid} onClick={() => void choose(custom.trim())}>
            {busy === 'select' ? 'Checking…' : 'Verify & use'}
          </button>
        </span>
      </label>
      {custom.trim() && !customValid ? <p className="hint">That is not a 20-byte address.</p> : null}

      {chosen && view.faucet.available ? (
        <div className="treasury-faucet">
          <p className="hint">
            <strong>Test money.</strong> The settlement asset here is {view.faucet.asset} on faithchain — a test token with
            an open mint. It is worth nothing anywhere else.
          </p>
          <span className="pair">
            <input
              type="text"
              value={fundAmount}
              inputMode="decimal"
              maxLength={16}
              aria-label="Test USDC to mint"
              onChange={(e) => setFundAmount(e.target.value)}
            />
            <button type="button" className={empty ? 'primary' : undefined} disabled={busy !== null} onClick={() => void fund()}>
              {busy === 'fund' ? 'Minting…' : 'Fund with test USDC'}
            </button>
          </span>
        </div>
      ) : null}
      {chosen && !view.faucet.available && view.faucet.reason ? <p className="hint">{view.faucet.reason}</p> : null}

      {notice ? <p className="hint treasury-notice">{notice}</p> : null}
      {error ? <div className="form-error">{error}</div> : null}
    </section>
  );
}
