import { useCallback, useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { shortAddress } from '../lib/format';
import { describeRate, tableRate } from '../lib/money';
import { stakeBalance, stakeName } from '../lib/stake';
import { describeMovement, fmtUsdc, seatBlock, shortRef, type TableSettlement, type TreasuryView } from '../lib/treasury';

/** Settlement lands seconds after the ledger row; poll while anything is still in flight. */
const POLL_MS = 4000;

/**
 * The money at THIS table, for the person playing at it.
 *
 * Three things and nothing else: what they have, what this session has moved, and — when a seat is
 * blocked — the one sentence saying why. It used to lead with the treasury address, the mandate cap,
 * a transaction hash per row, and every per-hand chip movement labelled "not settled". None of that
 * was wrong; all of it was in the way of a person trying to work out whether they could sit down.
 *
 * The receipts are still here, one disclosure away. This is a chain-backed product and hiding them
 * would be dishonest — but a default view that reads like a blockchain explorer is a default view
 * about the wrong thing.
 *
 * Only drawn for a table that actually settles: a play-money table has no money to show.
 */
export function MoneyPanel({
  tableId,
  settlement,
  chipValue = null,
  session,
  treasury,
  onChanged,
}: {
  tableId: string;
  settlement: string;
  /** The rate this table pinned at creation (`TableSummary.chipValue`), not the deployment's. */
  chipValue?: string | null;
  session: AppSession | null;
  /** Read by the page (see TablePage) so the seat picker and this panel agree. */
  treasury: TreasuryView | null;
  /** Re-read it after this panel has moved something. */
  onChanged: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<TableSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!settles) return null;
  if (!session || !token) {
    return (
      <section className="panel money" id="money">
        <h2>Your money</h2>
        <p className="hint">This table plays for money. Sign in to see yours.</p>
      </section>
    );
  }

  const chosen = treasury?.chosen ?? rows?.treasury ?? null;
  const balance = stakeBalance(treasury);
  const name = stakeName(treasury);
  // The table's own rate, preferring the summary the page read and falling back to the one the
  // settlement rows carry — both come from the table, neither from the deployment default.
  const rate = tableRate(settlement, chipValue ?? rows?.chipValue ?? null);
  const block = seatBlock(settlement, treasury);
  const mandate = treasury?.mandate ?? null;
  const entries = rows?.entries ?? [];

  return (
    <section className="panel money" id="money">
      <h2>Your money</h2>

      <div className="start-money">
        <span className="start-amount">{balance ?? '—'}</span>
        {name ? <span className="start-name">in {name}</span> : null}
      </div>

      {/* A seat that cannot be paid for says so here, in one sentence, with the way to fix it. */}
      {block ? (
        <p className={block.action === 'wait' ? 'hint' : 'form-error'}>
          {block.reason}
          {block.action === 'wait' || block.action === 'configure' ? null : (
            <>
              {' '}
              <a href="#stake">Set your stake up →</a>
            </>
          )}
        </p>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      {/* This session at this table, in money. Only movements that settle reach here — the Worker
          leaves per-hand chip results out, because a hand result never settles on chain and listing
          one as unsettled invents a problem. */}
      <h3 className="money-sub">This session</h3>
      {entries.length > 0 ? (
        <ul className="money-rows">
          {entries.map((e) => {
            const m = describeMovement(e);
            return (
              <li key={e.id} className={`money-row is-${m.status}`}>
                <span className="money-what">
                  {m.what} <strong>{m.amount}</strong>
                </span>
                <span className={`tag ${m.status === 'settled' ? 'live' : m.status === 'failed' ? 'allin' : 'thinking'}`}>{m.statusText}</span>
                {m.problem ? <span className="form-error money-why">{m.problem}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">Nothing yet. Money moves when you sit down, and again when you stand up.</p>
      )}

      {/* Kept, and kept honest: what kind of money this is, said plainly rather than removed. */}
      <p className="hint money-disclosure">
        Test USDC on faithchain — real settlement, money that is worth nothing anywhere else. One chip is{' '}
        {describeRate(rate)?.replace('1 chip = ', '') ?? 'a value this table has not stated'}.
      </p>

      <details className="money-details">
        <summary>Receipts and addresses</summary>
        <div className="money-detail-body">
          {chosen ? (
            <p className="hint">
              Your treasury: <code className="mono">{treasury?.chosenName || shortAddress(chosen)}</code>{' '}
              <code className="mono">{chosen}</code>
            </p>
          ) : null}
          {mandate?.present ? (
            <p className="hint">
              Authorised: up to {fmtUsdc(mandate.maxPerBuyIn) ?? '?'} USDC per buy-in, {fmtUsdc(mandate.sessionTotal) ?? '?'} USDC in total, at
              most {mandate.maxBuyIns} times, until{' '}
              {mandate.validUntil ? new Date(mandate.validUntil * 1000).toLocaleString() : 'the end of the night'}. Payable only to{' '}
              <code className="mono">{shortAddress(mandate.payee)}</code>, and revocable at your Home.
            </p>
          ) : null}
          {entries.length > 0 ? (
            <ul className="money-rows">
              {entries.map((e) => {
                const m = describeMovement(e);
                return (
                  <li key={e.id} className="money-row">
                    <span className="money-what">
                      {m.what} {m.chips.toLocaleString('en-US')} chips · {m.amount} · {m.statusText}
                    </span>
                    {m.ref ? (
                      <code className="mono money-ref" title={m.ref}>
                        {shortRef(m.ref)}
                      </code>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </details>
    </section>
  );
}
