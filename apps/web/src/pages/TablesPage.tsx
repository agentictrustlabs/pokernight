import { useState } from 'react';
import type { AppSession, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { dualAmount, tableRate } from '../lib/money';
import { SettlementTag } from '../components/SettlementTag';
import { mayClose, seatsFree, stakeLabel } from '../lib/lobby';
import { gameLabel, hasBoard } from '../lib/games';
import { newTableHash, roomHash, HOME_HASH } from '../lib/routes';

/**
 * TABLES — what is running, and a form to open something new.
 *
 * Second row in the rail, and where LEAVING A TABLE lands: "when I leave a table it needs to return me
 * to the open tables screen". It is first for everybody who comes back and second for everybody
 * arriving, which is exactly the order of these two rows.
 *
 * A table with no club is a PICKUP table — public, and what every table was before clubs existed. A
 * club's tables are on the club's own page, not filtered into this list, because a club is a place you
 * go rather than a lens you look through.
 */
export function TablesPage({
  session,
  tables,
  err,
  money,
  ready = true,
  hostOf = [],
  onChanged,
}: {
  session: AppSession;
  /** Read by the shell, so the money that gates a seat and the list that offers one agree. */
  tables: TableSummary[] | null;
  err: string | null;
  /** The settlement asset's ticker, for the create form's own words. */
  money: string;
  /** Whether this person could sit at a money table. Same read as the seat gate uses. */
  ready?: boolean;
  /** The clubs this person hosts, so a club table's row can offer to close it. */
  hostOf?: readonly string[];
  /** Re-read the list once a table is closed. */
  onChanged?: () => void;
}) {
  return (
    <div className="stack">
      <TableList
        tables={tables}
        err={err}
        playerId={session.playerId}
        hostOf={hostOf}
        session={session}
        {...(onChanged ? { onChanged } : {})}
      />
      {/* Opening a table is a thing a host does, not a step in playing — it has its own page. */}
      <p className="lobby-create-link"><a className="button" href={newTableHash()}>+ Open your own table</a> <a className="button" href={roomHash()} title="Walk into the hall — the open tables in a room">Enter the hall</a></p>
    </div>
  );
}

/**
 * The public tables. Also drawn on a club's page, with that club's tables and its own empty line —
 * one list, so a row reads the same wherever it is.
 */
export function TableList({
  tables,
  err,
  title = 'Open tables',
  empty,
  playerId = null,
  hostOf = [],
  session = null,
  onChanged,
}: {
  tables: TableSummary[] | null;
  err: string | null;
  title?: string;
  /** What to say when there are none. The public list and a club's differ; the rows do not. */
  empty?: React.ReactNode;
  /** Who is looking, so a row can offer to close a table they may actually close. */
  playerId?: string | null;
  /** The clubs they host — a club's table is the club's, whoever opened it. */
  hostOf?: readonly string[];
  session?: AppSession | null;
  /** Re-read the list once a table is gone. */
  onChanged?: () => void;
}) {
  const [closing, setClosing] = useState<string | null>(null);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>{title}</h2>
      {err ? <div className="form-error">{err}</div> : null}
      {closeErr ? <div className="form-error">{closeErr}</div> : null}
      {tables == null ? (
        <p className="hint">Loading…</p>
      ) : tables.length === 0 ? (
        empty ? <p className="hint">{empty}</p> : <p className="room-quiet"><span>The room is quiet — nobody has opened a table. Open one below, or <a href={HOME_HASH}>deal yourself a hand</a> against the house.</span></p>
      ) : (
        <div className="tables-wrap">
          <table className="tables">
            <thead>
              <tr>
                <th>Table</th>
                {/* Blinds at a poker table; the game's name at one dealing something else, which is
                    all this client can honestly say about another game's stakes. */}
                <th>Stakes</th>
                <th className="num">Seats</th>
                <th className="num">Buy-in (chips)</th>
                <th className="num">Hand</th>
                <th>Settlement</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                // The rate this table was OPENED at, so a 40–200 buy-in is never read against a
                // balance in a different unit. Null on play money, where chips are the whole story.
                const rate = tableRate(t.settlement, t.chipValue, t.assetSymbol);
                const lo = dualAmount(t.config.minStake, rate);
                const hi = dualAmount(t.config.maxStake, rate);
                // Whether this client can draw the table it is about to offer a seat at.
                const drawable = hasBoard(t.game);
                const room = seatsFree(t) > 0;
                // TWO TABLES WITH THE SAME NAME are two rows nobody can tell apart — and a night's tables are
                // all named for the night, so this is the normal case rather than a corner one. Where a name
                // repeats, the table's own short id goes beside it; where it does not, nothing is added.
                const sameName = tables.filter((x) => x.name === t.name).length > 1;
                return (
                  <tr key={t.tableId}>
                    <td>
                      <a href={`#/t/${encodeURIComponent(t.tableId)}`}>{t.name}</a>
                      {sameName ? <span className="table-which mono" title={t.tableId}>#{t.tableId.slice(0, 4)}</span> : null}
                      {t.mission ? <span className="table-guest">♦ {t.mission.name}</span> : null}
                    </td>
                    <td className="mono">{stakeLabel(t)}</td>
                    <td className="num">
                      {t.seated}/{t.config.seats}
                    </td>
                    <td className="num buyin-cell">
                      <span>
                        {lo.chipsText}–{hi.chipsText}
                      </span>
                      {lo.assetText && hi.assetText ? (
                        <span className="cost-asset">
                          {lo.assetText}–{hi.assetText} {rate?.asset ?? 'SHQ'}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{t.handNo}</td>
                    <td>
                      <SettlementTag settlement={t.settlement} rate={rate} />
                    </td>
                    <td className="row-close">
                      {/* CLOSING IT. Offered only to whoever opened it or a host of its club, because
                          a button that will be refused is worse than no button. A table opened before
                          tables recorded an opener belongs to nobody here and stays operator-only. */}
                      {session && mayClose(t, playerId, hostOf) ? (
                        <button
                          type="button"
                          className="link-button"
                          disabled={closing === t.tableId}
                          onClick={async () => {
                            setClosing(t.tableId);
                            setCloseErr(null);
                            try {
                              await api.closeTable(t.tableId, session.token, t.club);
                              onChanged?.();
                            } catch (e) {
                              // A SEATED TABLE IS REFUSED, and until now that was the end of it: the host was
                              // told to stand them up first with no way to do it, which pins a table open for
                              // good once somebody walks away from a seat. Offer it, say exactly what it does.
                              const msg = e instanceof ApiError ? e.message : `${t.name} could not be closed.`;
                              const seated = /still has \d+ player/.test(msg);
                              if (seated && window.confirm(`${msg}\n\nStand everybody up and close it? Their chips are cashed out the ordinary way — the same path their own "leave" takes.`)) {
                                try {
                                  const detail = await api.getTable(t.tableId, session.token);
                                  const seats = (detail.view?.seats ?? []) as Array<{ seat: number }>;
                                  for (const st of seats) await api.clearSeat(t.tableId, st.seat, session.token).catch(() => undefined);
                                  await api.closeTable(t.tableId, session.token, t.club);
                                  onChanged?.();
                                } catch (e2) {
                                  setCloseErr(e2 instanceof ApiError ? e2.message : `${t.name} could not be closed.`);
                                }
                              } else setCloseErr(msg);
                            } finally {
                              setClosing(null);
                            }
                          }}
                        >
                          {closing === t.tableId ? 'Closing…' : 'Close'}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      {/* "Join" is a promise of a seat, and it is only made when both halves of it
                          hold: this client can draw the game, and there is a chair. A full table is
                          still worth watching, so it says so rather than going blank. */}
                      {!drawable ? (
                        <span className="hint">{gameLabel(t.game)} — no seat here yet</span>
                      ) : room ? (
                        <a className="small" href={`#/t/${encodeURIComponent(t.tableId)}`}>
                          Join →
                        </a>
                      ) : (
                        <a className="small" href={`#/t/${encodeURIComponent(t.tableId)}`}>
                          Watch →
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

