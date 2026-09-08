import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from '../App';
import type { AppSession, CreateTableRequest, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { dualAmount, tableRate } from '../lib/money';
import { SettlementTag } from '../components/SettlementTag';
import { StartPanel } from '../components/StartPanel';
import { stakeStage } from '../lib/stake';
import type { TreasuryView } from '../lib/treasury';
import { SignInPage } from './SignInPage';

const POLL_MS = 5000;

/**
 * The lobby, for a signed-in person: what is running, and a form to open something new.
 *
 * A signed-out caller gets the sign-in page. The app routes signed-out visitors to the landing page
 * (`#/`) or to `#/signin` before it gets here, so this is the last line rather than the front door —
 * but a lobby that rendered nothing without a session would be the one outcome nobody can act on.
 */
export function Lobby({ session, auth, onLogin }: { session: AppSession | null; auth: AuthState; onLogin: (s: AppSession) => void }) {
  if (!session) return <SignInPage auth={auth} onLogin={onLogin} />;
  return <SignedInLobby session={session} auth={auth} />;
}

function SignedInLobby({ session, auth }: { session: AppSession; auth: AuthState }) {
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Both reads live HERE. The same treasury answer decides what the set-up card offers and whether
  // a table row can promise a seat; the same table list decides where "take a seat" goes. Two
  // copies of either could disagree, and disagreeing about money is the one thing not allowed.
  const loadTreasury = useCallback(async () => {
    try {
      setTreasury(await api.getTreasury(session.token));
    } catch {
      /* the panel says its own piece; a lobby that cannot read money still lists tables */
    }
  }, [session.token]);
  useEffect(() => {
    void loadTreasury();
  }, [loadTreasury]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const t = await api.listTables(session.token);
        if (alive) {
          setTables(t);
          setErr(null);
        }
      } catch (ex) {
        if (alive) setErr(ex instanceof ApiError ? `${ex.status}: ${ex.message}` : 'Could not reach the table service');
      }
    };
    void load();
    const h = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [session.token]);

  const ready = stakeStage(treasury) === 'ready';
  // Where "take a seat" goes once someone is set up: a money table with room, because that is what
  // they just got set up FOR. Falls back to anything with a free seat.
  const target = pickSeat(tables);

  return (
    <div className="lobby">
      <TableList tables={tables} err={err} />
      <div className="lobby-side">
        {/* Everything between signing in and sitting down, as one action, above everything else —
            it is what makes a money table playable at all. */}
        <StartPanel
          session={session}
          config={auth.config}
          treasury={treasury}
          onChanged={loadTreasury}
          {...(ready && target ? { playHref: `#/t/${encodeURIComponent(target.tableId)}`, playLabel: `Take a seat at ${target.name}` } : {})}
        />
        {/* Opening a table is a thing a host does, not a step in playing, so it is folded shut. */}
        <details className="panel lobby-create">
          <summary>Open your own table</summary>
          <CreateTable session={session} />
        </details>
      </div>
    </div>
  );
}

/**
 * The table to send a set-up player to: one that settles and has a free seat, else any free seat.
 * Null when the room is full or has not been read yet — never a table they could not sit at.
 */
export function pickSeat(tables: readonly TableSummary[] | null): TableSummary | null {
  if (!tables) return null;
  const open = tables.filter((t) => t.seated < t.config.seats);
  return open.find((t) => t.settlement !== 'play-money') ?? open[0] ?? null;
}

function TableList({ tables, err }: { tables: TableSummary[] | null; err: string | null }) {
  return (
    <section className="panel">
      <h2>Tables</h2>
      {err ? <div className="form-error">{err}</div> : null}
      {tables == null ? (
        <p className="hint">Loading…</p>
      ) : tables.length === 0 ? (
        <p className="hint">No tables are open. You can open one yourself, on the right.</p>
      ) : (
        <div className="tables-wrap">
          <table className="tables">
            <thead>
              <tr>
                <th>Table</th>
                <th>Blinds</th>
                <th className="num">Seats</th>
                <th className="num">Buy-in (chips)</th>
                <th className="num">Hand</th>
                <th>Settlement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                // The rate this table was OPENED at, so a 40–200 buy-in is never read against a
                // balance in a different unit. Null on play money, where chips are the whole story.
                const rate = tableRate(t.settlement, t.chipValue);
                const lo = dualAmount(t.config.minBuyIn, rate);
                const hi = dualAmount(t.config.maxBuyIn, rate);
                return (
                  <tr key={t.tableId}>
                    <td>
                      <a href={`#/t/${encodeURIComponent(t.tableId)}`}>{t.name}</a>
                    </td>
                    <td className="mono">
                      {t.config.smallBlind}/{t.config.bigBlind}
                    </td>
                    <td className="num">
                      {t.seated}/{t.config.seats}
                    </td>
                    <td className="num buyin-cell">
                      <span>
                        {lo.chipsText}–{hi.chipsText}
                      </span>
                      {lo.assetText && hi.assetText ? (
                        <span className="cost-asset">
                          {lo.assetText}–{hi.assetText} USDC
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{t.handNo}</td>
                    <td>
                      <SettlementTag settlement={t.settlement} rate={rate} />
                    </td>
                    <td>
                      <a className="small" href={`#/t/${encodeURIComponent(t.tableId)}`}>
                        Join →
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginBottom: 0 }}>
        Refreshes every {POLL_MS / 1000} s.
      </p>
    </section>
  );
}

function CreateTable({ session }: { session: AppSession }) {
  const [name, setName] = useState('');
  const [settlement, setSettlement] = useState<'play-money' | 'mandate-transfer'>('play-money');
  const [seats, setSeats] = useState(6);
  const [sb, setSb] = useState(1);
  const [bb, setBb] = useState(2);
  const [minBuy, setMinBuy] = useState(40);
  const [maxBuy, setMaxBuy] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = name.trim().length > 0 && seats >= 2 && seats <= 9 && sb > 0 && bb >= sb && minBuy > 0 && maxBuy >= minBuy;

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
          settlement,
          config: { seats, smallBlind: sb, bigBlind: bb, minBuyIn: minBuy, maxBuyIn: maxBuy },
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
      <h2>Open a table</h2>
      <label>
        Name
        <input type="text" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Tuesday night" />
      </label>
      <label>
        Seats
        <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
          {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="pair">
        <label>
          Small blind
          <input type="number" min={1} value={sb} onChange={(e) => setSb(Number(e.target.value))} />
        </label>
        <label>
          Big blind
          <input type="number" min={1} value={bb} onChange={(e) => setBb(Number(e.target.value))} />
        </label>
      </div>
      <div className="pair">
        <label>
          Min buy-in
          <input type="number" min={1} value={minBuy} onChange={(e) => setMinBuy(Number(e.target.value))} />
        </label>
        <label>
          Max buy-in
          <input type="number" min={1} value={maxBuy} onChange={(e) => setMaxBuy(Number(e.target.value))} />
        </label>
      </div>
      <label>
        Settlement
        <select value={settlement} onChange={(e) => setSettlement(e.target.value as 'play-money' | 'mandate-transfer')}>
          <option value="play-money">play money</option>
          <option value="mandate-transfer">USDC (mandate transfer)</option>
        </select>
      </label>
      {settlement === 'mandate-transfer' ? (
        <p className="hint">
          Buy-ins and cash-outs move USDC between Smart Agent treasuries on faithchain. Before a seat here, every player
          needs a treasury (a Smart Agent chartered under their person agent — not the person agent itself), USDC in it,
          and a signed mandate authorising this table to take the buy-in. A seat that is missing one of those is refused
          and told which, rather than quietly played for nothing.
        </p>
      ) : null}
      {err ? <div className="form-error">{err}</div> : null}
      <button className="primary" type="submit" disabled={busy || !valid}>
        {busy ? 'Opening…' : 'Open table'}
      </button>
    </form>
  );
}
