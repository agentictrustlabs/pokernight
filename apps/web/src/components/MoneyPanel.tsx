import { useCallback, useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { shortAddress } from '../lib/format';
import {
  describeSettlement,
  fmtUsdc,
  seatBlock,
  shortRef,
  statusOf,
  type TableSettlement,
  type TreasuryView,
} from '../lib/treasury';

/** Settlement lands seconds after the ledger row; poll while anything is still in flight. */
const POLL_MS = 4000;

/**
 * The money side of a settled table: where this player's chips come from, what they have authorised,
 * and what has happened to every movement.
 *
 * Only drawn for a table that actually settles — a play-money table has no money to show and gains
 * nothing from a panel saying so. Each row says one of three things and never anything vaguer:
 * waiting for the chain, settled (with the transaction), or failed (with the reason it failed).
 *
 * The panel also CARRIES THE ACTIONS. A seat that is refused for want of money or authority is
 * refused in the seat picker by name; the control that fixes that exact thing has to be somewhere a
 * player can reach without leaving the table, and this is that somewhere.
 */
export function MoneyPanel({
  tableId,
  settlement,
  session,
  treasury,
  onChanged,
}: {
  tableId: string;
  settlement: string;
  session: AppSession | null;
  /** Read by the page (see TablePage) so the seat picker and this panel agree. */
  treasury: TreasuryView | null;
  /** Re-read it after this panel has moved something. */
  onChanged: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<TableSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'fund' | 'mandate'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const token = session?.token ?? null;
  const settles = settlement !== 'play-money';

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setRows(await api.getTableSettlement(tableId, token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : 'Could not read the settlement state.');
    }
  }, [tableId, token]);

  useEffect(() => {
    if (!settles || !token) return;
    void load();
    const h = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => clearInterval(h);
  }, [load, settles, token]);

  const run = useCallback(
    async (kind: 'fund' | 'mandate', fn: () => Promise<string>) => {
      setBusy(kind);
      setError(null);
      setNotice(null);
      try {
        setNotice(await fn());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        await onChanged();
        setBusy(null);
      }
    },
    [onChanged],
  );

  if (!settles) return null;
  if (!session || !token) {
    return (
      <section className="panel money" id="money">
        <h2>Money</h2>
        <p className="hint">This table settles in USDC. Sign in to see your treasury.</p>
      </section>
    );
  }

  const chosen = treasury?.chosen ?? rows?.treasury ?? null;
  const balance = fmtUsdc(treasury?.balance);
  const block = seatBlock(settlement, treasury);
  const mandate = treasury?.mandate ?? null;

  return (
    <section className="panel money" id="money">
      <h2>Money</h2>
      <p className="hint">This table settles in USDC on faithchain. Chips are the table's units; the asset moves on chain.</p>

      <div className="treasury-chosen">
        {chosen ? (
          <>
            <span className="tag live">your treasury</span>
            <code className="mono" title={chosen}>
              {treasury?.chosenName || shortAddress(chosen)}
            </code>
            <strong className="treasury-balance">{balance === null ? '—' : `${balance} USDC`}</strong>
          </>
        ) : (
          <span className="hint">{block?.reason ?? 'No treasury chosen.'}</span>
        )}
      </div>

      {/* One block at a time, with the one control that clears it. Everything else is a link back to
          the lobby, because creating or choosing a treasury is not a thing to do mid-hand. */}
      {block && chosen ? (
        <div className="money-block">
          <p className={block.action === 'wait' ? 'hint' : 'form-error'}>{block.reason}</p>
          {block.action === 'fund-treasury' && treasury?.faucet.available ? (
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              onClick={() =>
                void run('fund', async () => {
                  const r = await api.fundTreasury('100', token);
                  return `Minted ${r.mintedUsdc} test USDC — ${shortRef(r.txHash)}`;
                })
              }
            >
              {busy === 'fund' ? 'Minting…' : 'Fund with 100 test USDC'}
            </button>
          ) : null}
          {block.action === 'sign-mandate' && treasury?.create.mode === 'server' ? (
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              onClick={() =>
                void run('mandate', async () => {
                  const r = await api.signMandate(undefined, token);
                  return `Authorised up to ${fmtUsdc(r.maxPerBuyIn) ?? '?'} USDC per buy-in, ${fmtUsdc(r.sessionTotal) ?? '?'} USDC in total.`;
                })
              }
            >
              {busy === 'mandate' ? 'Asking your Home…' : 'Authorise buy-ins'}
            </button>
          ) : null}
          {block.action === 'sign-mandate' && treasury?.create.mode !== 'server' ? (
            <p className="hint">Your Home signs the buy-in mandate, not the card room. Start it from your Home.</p>
          ) : null}
          {block.action === 'create-treasury' || block.action === 'choose-treasury' ? (
            <p className="hint">
              <a href="#/">Set your treasury up in the lobby →</a>
            </p>
          ) : null}
        </div>
      ) : null}

      {mandate?.present && chosen ? (
        <p className="hint">
          <span className="tag live">authorised</span> up to {fmtUsdc(mandate.maxPerBuyIn) ?? '?'} USDC per buy-in,{' '}
          {fmtUsdc(mandate.sessionTotal) ?? '?'} USDC in total, until{' '}
          {mandate.validUntil ? new Date(mandate.validUntil * 1000).toLocaleTimeString() : 'the end of the night'}.
        </p>
      ) : null}

      {notice ? <p className="hint">{notice}</p> : null}
      {error ? <div className="form-error">{error}</div> : null}

      {rows && rows.entries.length > 0 ? (
        <ul className="money-rows">
          {rows.entries.map((e) => {
            const status = statusOf(e.receipt) ?? 'pending';
            return (
              <li key={e.id} className={`money-row is-${status}`}>
                <span className={`tag ${status === 'settled' ? 'live' : status === 'failed' ? 'allin' : 'thinking'}`}>{status}</span>
                <span className="money-what">{describeSettlement(e)}</span>
                {status === 'settled' && e.receipt?.ref ? (
                  <code className="mono money-ref" title={e.receipt.ref}>
                    {shortRef(e.receipt.ref)}
                  </code>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">Nothing has moved yet. A buy-in settles when you take a seat; a cash-out when you stand up.</p>
      )}
    </section>
  );
}
