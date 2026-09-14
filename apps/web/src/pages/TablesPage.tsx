import { useState } from 'react';
import type { AppSession, CreateTableRequest, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { dualAmount, tableRate } from '../lib/money';
import { SettlementTag } from '../components/SettlementTag';
import { mayClose, seatsFree, stakeLabel } from '../lib/lobby';
import { BOARDS, DRAWN_GAME, gameLabel, hasBoard } from '../lib/games';
import { HOME_HASH, MONEY_HASH } from '../lib/routes';

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
      {/* Opening a table is a thing a host does, not a step in playing, so it is folded shut. */}
      <details className="panel lobby-create">
        <summary>Open your own table</summary>
        <CreateTable session={session} money={money} club={null} ready={ready} />
      </details>
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
                return (
                  <tr key={t.tableId}>
                    <td>
                      <a href={`#/t/${encodeURIComponent(t.tableId)}`}>{t.name}</a>
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
                              // The card room refuses a SEATED table by name, and that sentence is the
                              // useful one — somebody has to stand up before this can happen.
                              setCloseErr(e instanceof ApiError ? e.message : `${t.name} could not be closed.`);
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

export function CreateTable({
  session,
  money,
  club,
  ready = true,
}: {
  session: AppSession;
  money: string;
  club: string | null;
  /**
   * Whether this person could actually SIT at a money table — a treasury, some money in it, and a
   * signed buy-in authority (`stakeStage(treasury) === 'ready'`).
   *
   * It does not gate the form. Opening a table for other people is a real thing a host does, and
   * refusing them would be refusing that. What it does is stop the surprise: this select offered
   * money settlement to everybody and said nothing, so somebody could open a table and then be
   * refused the first seat at it — their own.
   */
  ready?: boolean;
}) {
  const [name, setName] = useState('');
  /**
   * WHICH GAME. This form opened poker tables and only poker tables for as long as poker was the
   * only one, and kept doing so for a while after it was not — so the card room could deal canasta
   * and nobody could ask it to. The list is the games this client has a BOARD for: opening a table
   * nobody here can draw would be opening one nobody here can sit at.
   */
  const [game, setGame] = useState<string>(DRAWN_GAME);
  const [settlement, setSettlement] = useState<'play-money' | 'mandate-transfer'>('play-money');
  const [seats, setSeats] = useState(6);
  const [sb, setSb] = useState(1);
  const [bb, setBb] = useState(2);
  const [minBuy, setMinBuy] = useState(40);
  const [maxBuy, setMaxBuy] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const poker = game === DRAWN_GAME;
  // Canasta is four-handed partnership and played for score. It has no blinds, no buy-in and no
  // seat count to choose, so the form does not ask for four numbers it would then have to discard.
  const valid = name.trim().length > 0 && (!poker || (seats >= 2 && seats <= 9 && sb > 0 && bb >= sb && minBuy > 0 && maxBuy >= minBuy));

  return (
    <form
      className="panel form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setErr(null);
        const req: CreateTableRequest = {
          name: name.trim(),
          // A canasta table settles nothing — `canastaGame.staked` is false — so it is never
          // opened in money whatever this control last said.
          settlement: poker ? settlement : 'play-money',
          game,
          config: poker ? { seats, smallBlind: sb, bigBlind: bb, minBuyIn: minBuy, maxBuyIn: maxBuy } : {},
          // The club whose page this form is on. The card room checks that this person is one of its
          // hosts and refuses by name if they are not — the club is never taken on the client's word.
          ...(club ? { club } : {}),
        };
        try {
          const t = await api.createTable(req, session.token);
          location.hash = `#/t/${encodeURIComponent(t.tableId)}`;
        } catch (ex) {
          setErr(ex instanceof Error ? ex.message : String(ex));
        } finally {
          setBusy(false);
        }
      }}
    >
      {/* No heading: this form only ever sits behind a `<details>` whose summary already says what it
          opens, and two headings saying the same thing read as two different things. */}
      {club ? (
        <p className="hint">Only this club&rsquo;s members will see it, and only they can sit at it.</p>
      ) : (
        <p className="hint">Anyone signed in can see this one and sit at it. A club&rsquo;s own page opens a private one.</p>
      )}
      <label>
        Name
        <input type="text" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Tuesday night" />
      </label>
      <label>
        Game
        <select value={game} onChange={(e) => setGame(e.target.value)}>
          {BOARDS.map((g) => (
            <option key={g} value={g}>
              {gameLabel(g)}
            </option>
          ))}
        </select>
      </label>
      {!poker ? (
        <p className="hint">
          Four players in two partnerships — seats 1 and 3 against 2 and 4 — played to 5,000. No stakes: canasta is
          played for score.
        </p>
      ) : null}
      <label hidden={!poker}>
        Seats
        <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
          {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="pair" hidden={!poker}>
        <label>
          Small blind
          <input type="number" min={1} value={sb} onChange={(e) => setSb(Number(e.target.value))} />
        </label>
        <label>
          Big blind
          <input type="number" min={1} value={bb} onChange={(e) => setBb(Number(e.target.value))} />
        </label>
      </div>
      <div className="pair" hidden={!poker}>
        <label>
          Min buy-in
          <input type="number" min={1} value={minBuy} onChange={(e) => setMinBuy(Number(e.target.value))} />
        </label>
        <label>
          Max buy-in
          <input type="number" min={1} value={maxBuy} onChange={(e) => setMaxBuy(Number(e.target.value))} />
        </label>
      </div>
      <label hidden={!poker}>
        Settlement
        <select value={settlement} onChange={(e) => setSettlement(e.target.value as 'play-money' | 'mandate-transfer')}>
          <option value="play-money">play money</option>
          <option value="mandate-transfer">{money} (mandate transfer)</option>
        </select>
      </label>
      {poker && settlement === 'mandate-transfer' && !ready ? (
        <p className="hint form-warn">
          You are not set up to take a seat at a money table yet. You can still open one for other people —{' '}
          <a href={MONEY_HASH}>get set up</a> and you can sit at it too.
        </p>
      ) : null}
      {poker && settlement === 'mandate-transfer' ? (
        <p className="hint">
          Buy-ins and cash-outs move {money} — this card room's own money — between each player's own account and the
          house. Before a seat here, a player needs an account of their own, {money} in it, and to have authorised this
          table to take the buy-in. A seat missing one of those is refused and told which, rather than quietly played
          for nothing.
        </p>
      ) : null}
      {err ? <div className="form-error">{err}</div> : null}
      <button className="primary" type="submit" disabled={busy || !valid}>
        {busy ? 'Opening…' : 'Open table'}
      </button>
    </form>
  );
}
