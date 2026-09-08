import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { shortAddress } from '../lib/format';
import { startBuyInMandate, type AuthConfig } from '../lib/home';
import { fmtUsdc, shortRef, type TreasuryView } from '../lib/treasury';

/**
 * Which Smart Agent funds this player's night.
 *
 * The list is the player's TREASURIES, as their own Home reports them — `treasury`-kind agents
 * chartered under their person agent. Their person agent is shown at the top and is deliberately not
 * selectable: it is who they are, not what they stake, and an earlier build that offered it as a
 * default conflated the two. A player with no treasury is offered a way to make one, never a
 * substitute.
 *
 * Below that: the money in it, and the mandate. A buy-in moves the player's own USDC, so it needs an
 * authority the player signs; the panel shows the exact caps before asking, and shows them again
 * after, because "authorised" with no numbers is not consent.
 */
export function TreasuryPanel({ session, config, bare = false }: { session: AppSession; config: AuthConfig | null; bare?: boolean }) {
  const [view, setView] = useState<TreasuryView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'select' | 'fund' | 'create' | 'mandate' | 'refresh'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState('10000');
  const [label, setLabel] = useState('');
  const [handedOff, setHandedOff] = useState(false);

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

  /** One shape for every action here: clear, run, say what happened, re-read the truth. */
  const run = useCallback(
    async (kind: 'select' | 'fund' | 'create' | 'mandate' | 'refresh', fn: () => Promise<string | null>) => {
      setBusy(kind);
      setError(null);
      setNotice(null);
      try {
        const said = await fn();
        if (said) setNotice(said);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        await load();
        setBusy(null);
      }
    },
    [load],
  );

  const choose = useCallback(
    (address: string) =>
      run('select', async () => {
        const r = await api.selectTreasury(address, session.token);
        return `Play is funded from ${r.name || shortAddress(r.chosen)}. ${r.note}`;
      }),
    [run, session.token],
  );

  const create = useCallback(
    () =>
      run('create', async () => {
        const r = await api.createTreasury(label.trim() || undefined, session.token);
        setLabel('');
        return `${r.name || shortAddress(r.treasury)} — ${r.note}`;
      }),
    [label, run, session.token],
  );

  const fund = useCallback(
    () =>
      run('fund', async () => {
        const r = await api.fundTreasury(fundAmount.trim(), session.token);
        return `Minted ${r.mintedUsdc} test USDC — ${shortRef(r.txHash)}`;
      }),
    [fundAmount, run, session.token],
  );

  const authorise = useCallback(
    () =>
      run('mandate', async () => {
        const r = await api.signMandate(undefined, session.token);
        const per = fmtUsdc(r.maxPerBuyIn) ?? '?';
        const total = fmtUsdc(r.sessionTotal) ?? '?';
        return `Authorised: up to ${per} USDC per buy-in, ${total} USDC in total, at most ${r.maxBuyIns} buy-ins, until ${new Date(r.validUntil * 1000).toLocaleString()}.`;
      }),
    [run, session.token],
  );

  /**
   * A real player's mandate is signed AT THEIR HOME, so this navigates rather than posting: the Home
   * shows them the caps and signs with their own key, and returns to us with the result.
   */
  const authoriseAtHome = useCallback(
    (maxPerBuyIn: string) =>
      run('mandate', async () => {
        if (!config) throw new Error('The card room has not said which Home to ask yet.');
        location.href = await startBuyInMandate(config, maxPerBuyIn);
        return 'Sending you to your Home to authorise buy-ins…';
      }),
    [config, run],
  );

  /** Standalone it is a panel with a heading; inside the "details" disclosure it is just content. */
  const Shell = ({ children }: { children: ReactNode }) =>
    bare ? (
      <div className="treasury treasury-bare">{children}</div>
    ) : (
      <section className="panel treasury">
        <h2>Your treasury</h2>
        {children}
      </section>
    );

  if (loadError) {
    return (
      <Shell>
        <div className="form-error">{loadError}</div>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <p className="hint">Loading…</p>
      </Shell>
    );
  }

  const chosen = view.chosen;
  const chosenBalance = fmtUsdc(view.balance);
  const empty = view.balance !== null && BigInt(view.balance) === 0n;
  const working = busy !== null;

  return (
    <Shell>
      {view.person ? (
        <p className="hint">
          You are signed in as <code className="mono">{view.personName ?? shortAddress(view.person)}</code>. That is your
          identity, and it is not a treasury: play is funded from a separate Smart Agent chartered under it, so who you
          are and what you stake stay different things.
        </p>
      ) : (
        <p className="hint">Play is funded from a treasury Smart Agent chartered under your person agent at your Home.</p>
      )}

      {view.notice ? <p className="hint treasury-notice">{view.notice}</p> : null}
      {view.unavailable ? (
        <>
          <p className="hint">{view.unavailable}</p>
          <p className="hint">Play-money tables are unaffected.</p>
        </>
      ) : null}

      {chosen ? (
        <div className="treasury-chosen">
          <span className="tag live">funding play</span>
          <code className="mono" title={chosen}>
            {view.chosenName || shortAddress(chosen)}
          </code>
          <strong className="treasury-balance">{chosenBalance === null ? '—' : `${chosenBalance} USDC`}</strong>
        </div>
      ) : null}

      {view.discoveryError ? <p className="hint">{view.discoveryError}</p> : null}

      {view.candidates.length > 0 ? (
        <ul className="treasury-list">
          {view.candidates.map((c) => (
            <li key={c.address} className={c.address === chosen ? 'is-chosen' : undefined}>
              <span className="treasury-label">
                {c.label}
                <span className="tag">treasury</span>
              </span>
              <code className="mono" title={c.address}>
                {shortAddress(c.address)}
              </code>
              <span className="num">{c.balanceUsdc === null ? (c.error ? '—' : '…') : `${fmtUsdc(c.balance) ?? c.balanceUsdc} USDC`}</span>
              {c.address === chosen ? (
                <span className="hint">in use</span>
              ) : (
                <button type="button" className="small" disabled={working} onClick={() => void choose(c.address)}>
                  use this
                </button>
              )}
              {c.error ? <span className="form-error">{c.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : view.discoveryError ? null : (
        <p className="hint">
          Your Home lists no treasuries for you yet. You need one before you can sit at a settled table.
        </p>
      )}

      {view.create.mode === 'server' ? (
        <div className="treasury-create">
          <p className="hint">
            <strong>{view.candidates.length > 0 ? 'Another treasury' : 'Create your treasury'}.</strong> Your Home
            deploys it and holds its key; the card room never does. A name is optional — the address is its identity.
          </p>
          {view.create.canName ? (
            <span className="pair">
              <input
                type="text"
                value={label}
                spellCheck={false}
                maxLength={24}
                aria-label="Treasury label (optional)"
                placeholder="name (optional) — e.g. friday"
                onChange={(e) => setLabel(e.target.value)}
              />
              <button type="button" className={view.candidates.length === 0 ? 'primary' : undefined} disabled={working} onClick={() => void create()}>
                {busy === 'create' ? 'Creating…' : label.trim() ? `Create ${label.trim()}.treasury` : 'Create, nameless'}
              </button>
            </span>
          ) : (
            <button type="button" className={view.candidates.length === 0 ? 'primary' : undefined} disabled={working} onClick={() => void create()}>
              {busy === 'create' ? 'Creating…' : 'Create a treasury'}
            </button>
          )}
        </div>
      ) : (
        <div className="treasury-create">
          <p className="hint">
            <strong>Your Home creates and custodies your treasury</strong>, not this card room — it is your money and
            your key. Open your Home, create a personal treasury there, then come back here and check again.
          </p>
          <span className="pair">
            {view.create.portalUrl ? (
              <a
                className="button primary"
                href={view.create.portalUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setHandedOff(true)}
              >
                Open my Home →
              </a>
            ) : null}
            <button type="button" disabled={working} onClick={() => void run('refresh', async () => 'Checked your Home again.')}>
              {busy === 'refresh' ? 'Checking…' : 'I have created it — check again'}
            </button>
          </span>
          {handedOff ? <p className="hint">When your Home says the treasury is ready, come back and press “check again”.</p> : null}
        </div>
      )}

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
            <button type="button" className={empty ? 'primary' : undefined} disabled={working} onClick={() => void fund()}>
              {busy === 'fund' ? 'Minting…' : 'Fund with test USDC'}
            </button>
          </span>
        </div>
      ) : null}
      {chosen && !view.faucet.available && view.faucet.reason ? <p className="hint">{view.faucet.reason}</p> : null}

      {chosen ? (
        <MandateSection
          view={view}
          busy={busy}
          working={working}
          canAskHome={config !== null}
          onAuthorise={() => void authorise()}
          onAuthoriseAtHome={() => void authoriseAtHome(view.mandate.maxPerBuyIn)}
        />
      ) : null}

      {notice ? <p className="hint treasury-notice">{notice}</p> : null}
      {error ? <div className="form-error">{error}</div> : null}
    </Shell>
  );
}

/**
 * The buy-in authority.
 *
 * A cash-out is the house paying out of its own treasury. A buy-in is the opposite: it is the
 * player's money, and the card room may move it only under a delegation the player's treasury signed.
 * So this shows the four numbers that bound it — per buy-in, in total, how many times, until when —
 * before the button, and repeats them after. Nothing is worded as "connect" or "enable": it is a
 * permission to take money, and it reads like one.
 */
function MandateSection({
  view,
  busy,
  working,
  canAskHome,
  onAuthorise,
  onAuthoriseAtHome,
}: {
  view: TreasuryView;
  busy: string | null;
  working: boolean;
  /** Whether we know which Home to send a real player to. */
  canAskHome: boolean;
  onAuthorise: () => void;
  onAuthoriseAtHome: () => void;
}) {
  const m = view.mandate;
  if (m.unavailable) {
    return (
      <div className="treasury-mandate">
        <h3>Buy-in authority</h3>
        <p className="hint">{m.unavailable}</p>
      </div>
    );
  }
  const per = fmtUsdc(m.maxPerBuyIn) ?? '?';
  const total = fmtUsdc(m.sessionTotal) ?? '?';
  const until = m.validUntil ? new Date(m.validUntil * 1000).toLocaleString() : 'the end of the night';
  const canSignHere = view.create.mode === 'server';

  return (
    <div className="treasury-mandate">
      <h3>Buy-in authority</h3>
      {m.present ? (
        <p className="hint">
          <span className="tag live">authorised</span> The card room may take up to <strong>{per} USDC</strong> per
          buy-in from {view.chosenName || shortAddress(view.chosen ?? '')}, <strong>{total} USDC</strong> in total, at
          most {m.maxBuyIns} times, until {until}. It can send that money to one place only:{' '}
          <code className="mono">{shortAddress(m.payee)}</code>.
        </p>
      ) : (
        <>
          <p className="hint">
            A buy-in moves your own USDC, so it needs your signature. What you would be authorising: up to{' '}
            <strong>{per} USDC</strong> per buy-in, <strong>{total} USDC</strong> in total, at most {m.maxBuyIns} times,
            until {until} — payable only to <code className="mono">{shortAddress(m.payee)}</code>, and revocable at your
            Home at any time.
          </p>
          {m.problem ? <p className="form-error">{m.problem}</p> : null}
          {canSignHere ? (
            <button type="button" className="primary" disabled={working} onClick={onAuthorise}>
              {busy === 'mandate' ? 'Asking your Home…' : 'Authorise buy-ins'}
            </button>
          ) : (
            <>
              <button type="button" className="primary" disabled={working || !canAskHome} onClick={onAuthoriseAtHome}>
                {busy === 'mandate' ? 'Sending you to your Home…' : 'Authorise buy-ins at my Home →'}
              </button>
              <p className="hint">
                Your Home signs this, not the card room: it shows you these caps and signs with your own key, then sends
                the signed mandate back here.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
