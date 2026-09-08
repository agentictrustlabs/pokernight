import { useCallback, useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { shortAddress } from '../lib/format';
import {
  describeSettlement,
  fmtUsdc,
  seatBlocker,
  shortRef,
  statusOf,
  type TableSettlement,
  type TreasuryView,
} from '../lib/treasury';

/** Settlement lands seconds after the ledger row; poll while anything is still in flight. */
const POLL_MS = 4000;

/**
 * The money side of a settled table: where this player's chips come from, and what has happened to
 * every movement.
 *
 * Only drawn for a table that actually settles — a play-money table has no money to show and gains
 * nothing from a panel saying so. Each row says one of three things and never anything vaguer:
 * waiting for the chain, settled (with the transaction), or failed (with the reason it failed).
 */
export function MoneyPanel({
  tableId,
  settlement,
  session,
}: {
  tableId: string;
  settlement: string;
  session: AppSession | null;
}) {
  const [rows, setRows] = useState<TableSettlement | null>(null);
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = session?.token ?? null;
  const settles = settlement !== 'play-money';

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, t] = await Promise.all([api.getTableSettlement(tableId, token), api.getTreasury(token)]);
      setRows(s);
      setTreasury(t);
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

  if (!settles) return null;
  if (!session) {
    return (
      <section className="panel money">
        <h2>Money</h2>
        <p className="hint">This table settles in USDC. Sign in to see your treasury.</p>
      </section>
    );
  }

  const chosen = treasury?.chosen ?? rows?.treasury ?? null;
  const balance = fmtUsdc(treasury?.balance);

  return (
    <section className="panel money">
      <h2>Money</h2>
      <p className="hint">This table settles in USDC on faithchain. Chips are the table's units; the asset moves on chain.</p>

      <div className="treasury-chosen">
        {chosen ? (
          <>
            <span className="tag live">your treasury</span>
            <code className="mono" title={chosen}>
              {shortAddress(chosen)}
            </code>
            <strong className="treasury-balance">{balance === null ? '—' : `${balance} USDC`}</strong>
          </>
        ) : (
          <span className="hint">{seatBlocker(settlement, treasury) ?? 'No treasury chosen.'} You can pick one in the lobby.</span>
        )}
      </div>

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
