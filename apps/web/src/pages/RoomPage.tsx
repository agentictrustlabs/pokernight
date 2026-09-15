import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { AppSession } from '../lib/types';
import { RoomSocket } from '../lib/roomSocket';
import { api as tables, roomApi as api, tableSocketUrl } from '../lib/api';
import { leaveSeat, takeSeat } from '../lib/roomSeat';
import { TableSocket, initialState, reduce, setConnection, type TableState } from '../lib/tableSocket';
import { ActionBar } from '../components/ActionBar';
import { Card } from '../components/Card';
import { DRAWN_GAME } from '../lib/games';
import type { Action } from '../lib/types';
import type { LoungeHandle } from '../components/room/Lounge';
import { HuddleAffordance } from '../components/huddle/ClubHuddleDock';
import { useClubHuddle } from '../components/huddle/ClubHuddleProvider';
import { clubScope } from '../lib/huddle';
import { SpatialVoice } from '../components/room/SpatialVoice';
import { clubHash, HOME_HASH, roomHash } from '../lib/routes';

/** The scene is a separate chunk — three.js never loads for a page that has no room (the Leaflet rule). */
/** Can this browser draw the room? Asked of a throwaway canvas whose context is released at once. */
function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try { const c = document.createElement('canvas'); const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null; if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch { return false; }
}
/** The stack a play-money seat is taken with from the room — the practice table's, for the same reason. */
const ROOM_STACK = 200;
const Lounge = lazy(() => import('../components/room/Lounge').then((m) => ({ default: m.Lounge })));

/**
 * THE ROOM'S PAGE (docs/SPATIAL-ROOM.md, phase 1): a club's lounge (`#/clubs/<id>/room`) or the hall
 * (`#/hall`). It owns the room socket and the page around the scene — who is here, where you are standing,
 * a line to say something, and the way to the table you are standing at (the flat board, until step 5 draws
 * the felt in the room). No WebGL means the flat pages, said plainly.
 */
export function RoomPage({ session, clubId }: { session: AppSession; clubId: string | null }) {
  const roomId = clubId ? `club:${clubId}` : 'hall';
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const sock = useRef<RoomSocket | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [line, setLine] = useState('');
  const lounge = useRef<LoungeHandle | null>(null);
  /** The sit in progress, as a line for the room bar: walking, sitting, refused. */
  const [sitting, setSitting] = useState<{ tableId: string; seat: number; phase: 'walking' | 'sitting' | 'standing' } | null>(null);
  const [sitError, setSitError] = useState<string | null>(null);
  /**
   * THE SEATED TABLE'S OWN SOCKET (spec §3.4, step 5). While you sit at a hold'em table in the room, this page
   * holds a second socket — the table's, reduced exactly as the flat board reduces it — and the lounge draws the
   * view on the felt while the flat ActionBar sits over the scene as the HUD. Byte-identical at the table: it
   * is the same `act` on the same wire. A canasta table keeps the flat board (one board per game; no felt yet).
   */
  const [tableState, setTableState] = useState<TableState>(initialState);
  const tableSock = useRef<TableSocket | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // ASKED ONCE. `useRef(expr)` evaluates `expr` on EVERY render and keeps only the first — so a probe written that
  // way opened a WebGL context per render, and once the page re-rendered every half second (the seated table's
  // clock) the browser hit "too many active WebGL contexts" and LOST THE LOUNGE'S. A lazy initializer runs once.
  const [webglOk] = useState<boolean>(() => hasWebGL());
  const webgl = useRef<boolean>(webglOk);
  useEffect(() => {
    if (!webgl.current) return;
    const s = new RoomSocket(roomId, session.token, undefined, bump);
    sock.current = s;
    bump();
    // THE LAYOUT IS RE-READ every few seconds: a table opened, a seat taken, a hand's count — the room learns
    // it from the tables through the Worker, and everybody in the room hears the new manifest.
    const relayout = setInterval(() => { void api.room(roomId, session.token).catch(() => undefined); }, 8000);
    return () => { clearInterval(relayout); s.close(); sock.current = null; };
  }, [roomId, session.token]);
  const onZone = useCallback((z: string | null) => setZone(z), []);
  const seatedTableId = (() => { const s0 = sock.current; const me = s0?.state.you ? s0.state.people.get(s0.state.you) : undefined; const t = me?.seatedAt && s0?.state.manifest ? s0.state.manifest.tables.find((x) => x.tableId === me.seatedAt!.tableId) : null; return t && (t.game ?? DRAWN_GAME) === DRAWN_GAME ? t.tableId : null; })();
  useEffect(() => {
    if (!seatedTableId) { setTableState(initialState); return; }
    const ts = new TableSocket({ url: tableSocketUrl(seatedTableId, session.token), onMessage: (m) => setTableState((st) => reduce(st, m)), onStatus: (c) => setTableState((st) => setConnection(st, c)) });
    tableSock.current = ts; ts.connect();
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(clock); ts.close(); if (tableSock.current === ts) tableSock.current = null; };
  }, [seatedTableId, session.token]);
  const act = (action: Action) => { const t = tableState.turn; if (!t) return; tableSock.current?.send({ type: 'act', handNo: t.handNo, action }); };
  const board = seatedTableId && tableState.view ? { tableId: seatedTableId, view: tableState.view, names: tableState.names, lastHand: tableState.lastHand } : null;
  const mySeat = board?.view.seats.find((x) => x.seat === board.view.viewerSeat);
  const myHand = mySeat?.inHand;
  // SAT OUT IS NOT BROKEN, AND THE ROOM HAS TO SAY SO. Two turns timed out and the table sits a person out; from
  // the room there was no sign of it and no way back, so a player who stepped away read it as "the game ignores me".
  const sittingOut = mySeat?.status === 'sitting-out';
  /**
   * THE BODY HAS ARRIVED AT A CHAIR. A seat is the table's own `join` (spec §3.4, open question 3): a
   * play-money table is joined from here with the practice stack; a money table stays a button on the flat
   * board, because a buy-in is money and the room forwards nothing that costs any. The room is re-read at once
   * so the body sits without waiting for the next relayout.
   */
  const onSitRequest = useCallback(async (tableId: string, seat: number) => {
    setSitError(null);
    try {
      const t = await tables.getTable(tableId, session.token);
      if (t.settlement !== 'play-money') { location.hash = `#/t/${encodeURIComponent(tableId)}`; return; }
      setSitting({ tableId, seat, phase: 'sitting' });
      // the poker view carries its config; a canasta table has no stake and the number is ignored
      const cfg = ((t.view as { config?: { minBuyIn?: number; maxBuyIn?: number } } | undefined)?.config ?? {});
      const buyIn = Math.min(cfg.maxBuyIn ?? ROOM_STACK, Math.max(cfg.minBuyIn ?? 1, ROOM_STACK));
      const r = await takeSeat(tableSocketUrl(tableId, session.token), seat, buyIn);
      if (!r.ok) setSitError(r.reason);
      await api.room(roomId, session.token).catch(() => undefined);
    } catch (e) { setSitError(e instanceof Error ? e.message : String(e)); } finally { setSitting(null); }
  }, [roomId, session.token]);
  const walkToSeat = (tableId: string, seat: number) => { setSitError(null); if (lounge.current?.walkToSeat(tableId, seat)) setSitting({ tableId, seat, phase: 'walking' }); };
  const standUp = async (tableId: string) => {
    setSitError(null); setSitting({ tableId, seat: -1, phase: 'standing' });
    try { const r = await leaveSeat(tableSocketUrl(tableId, session.token)); if (!r.ok) setSitError(r.reason); await api.room(roomId, session.token).catch(() => undefined); } finally { setSitting(null); }
  };
  const s = sock.current;
  // VOICE IN A CLUB'S LOUNGE: the club's huddle is the room's meeting; while you are in it here, every voice
  // is placed at the body that owns it. The hall has no huddle yet (spec §3.3 — a `hall` scope at the Home).
  const huddle = useClubHuddle();
  const scope = clubId ? clubScope({ clubId }) : null;
  const inThisHuddle = !!(scope && huddle.current && huddle.meeting && huddle.current.scope.id === scope.id);
  const manifest = s?.state.manifest ?? null;
  const meNow = s?.state.you ? s.state.people.get(s.state.you) : undefined;
  const seatedTable = meNow?.seatedAt && manifest ? manifest.tables.find((t) => t.tableId === meNow.seatedAt!.tableId) : null;
  const table = zone && manifest ? manifest.tables.find((t) => t.tableId === zone) : null;
  const people = s ? [...s.state.people.values()] : [];

  if (!webgl.current) {
    return (
      <section className="panel">
        <h2>The room needs WebGL</h2>
        <p className="hint">This browser cannot draw the room. The tables are all still here on the flat pages — <a href={clubId ? clubHash(clubId) : HOME_HASH}>go there</a>.</p>
      </section>
    );
  }
  return (
    <div className="room-page">
      <header className="room-head">
        <div>
          <span className="eyebrow">{manifest?.name ?? 'The room'}</span>
          <h1>{seatedTable ? `Seated at ${seatedTable.name}` : zone ? (table ? `At ${table.name}` : zone === 'bar' ? 'At the bar' : zone === 'fire' ? 'By the fire' : zone === 'lectern' ? 'At the lectern' : 'In the room') : 'In the room'}</h1>
        </div>
        <div className="room-meta">
          {scope ? <HuddleAffordance scope={scope} scopeName={manifest?.name ?? 'the club'} compact /> : null}
          <span className={`conn ${s?.state.connection ?? 'connecting'}`}>{s?.state.connection ?? 'connecting'}</span>
          <span className="hint">{people.length === 1 ? 'You are the only one here' : `${people.length} here`}</span>
          <a className="small" href={clubId ? clubHash(clubId) : HOME_HASH}>Leave the room</a>
        </div>
      </header>
      {s?.state.error ? <div className="form-error">{s.state.error}</div> : null}
      <div className="room-scene">
        <Suspense fallback={<div className="lounge-loading"><p className="hint">Loading the lounge…</p></div>}>
          {s ? <Lounge ref={lounge} socket={s} state={s.state} onZone={onZone} onSitRequest={onSitRequest} board={board} /> : null}
        </Suspense>
      </div>
      {/* THE HUD, UNDER THE SCENE — never over it, so the people at the near side of the felt stay in view: your
          cards in hand, the board and the pot as the flat board draws them (readable whatever the camera does),
          and the flat board's own action bar — the same act on the same wire */}
      {board ? (
        <div className="room-hud">
          <div className="room-hud-cards">
            {myHand?.holeCards?.length ? <div className="room-hand" aria-label="Your cards">{myHand.holeCards.map((c, i) => <Card key={i} card={c} size="lg" />)}</div> : null}
            {board.view.hand ? (
              <div className="room-board" aria-label="The board">
                {board.view.hand.board.map((c, i) => <Card key={i} card={c} />)}
                {Array.from({ length: 5 - board.view.hand.board.length }, (_, i) => <span key={`e${i}`} className="card-slot" aria-hidden="true" />)}
                <span className="room-pot num"><strong>{board.view.hand.pots.reduce((a2, p) => a2 + p.amount, 0) + board.view.seats.reduce((a2, s2) => a2 + (s2.inHand?.streetBet ?? 0), 0)}</strong> pot</span>
              </div>
            ) : null}
          </div>
          {sittingOut ? (
            <div className="room-satout">
              <strong>You are sitting out.</strong> <span className="hint">The table deals past a seat that misses two turns.</span>
              <button type="button" className="primary" onClick={() => tableSock.current?.send({ type: 'sit-in' })}>Sit back in</button>
            </div>
          ) : null}
          <ActionBar turn={tableState.turn} view={board.view} now={now} onAct={act} waitingOn={board.view.hand?.toAct != null && board.view.hand.toAct !== board.view.viewerSeat ? board.names[board.view.seats.find((x) => x.seat === board.view.hand!.toAct)?.playerId ?? ''] ?? null : null} />
        </div>
      ) : null}
      {s && inThisHuddle ? <SpatialVoice state={s.state} /> : null}
      <div className="room-bar">
        {seatedTable ? (
          <div className="room-table-card">
            <strong>{seatedTable.name}</strong> <span className="hint">seat {(meNow!.seatedAt!.seat) + 1} · {seatedTable.seated}/{seatedTable.seats} seated</span>
            <a className="button primary" href={`#/t/${encodeURIComponent(seatedTable.tableId)}`}>Back to your cards →</a>
            <button type="button" className="small" disabled={!!sitting} onClick={() => void standUp(seatedTable.tableId)}>{sitting?.phase === 'standing' ? 'Standing up…' : 'Stand up'}</button>
          </div>
        ) : sitting ? (
          <div className="room-table-card"><span className="hint">{sitting.phase === 'walking' ? `Walking to seat ${sitting.seat + 1}…` : `Sitting down at seat ${sitting.seat + 1}…`}</span></div>
        ) : table ? (
          <div className="room-table-card">
            <strong>{table.name}</strong> <span className="hint">{table.seated}/{table.seats} seated</span>
            {/* THE FREE CHAIRS, as buttons: the same walk a click on the chair starts */}
            <span className="room-chairs">
              {Array.from({ length: table.seats }, (_, i) => i).filter((i) => !(table.occupants ?? []).some((o) => o.seat === i)).map((i) => (
                <button key={i} type="button" className="small" onClick={() => walkToSeat(table.tableId, i)}>Sit at {i + 1}</button>
              ))}
            </span>
            <a className="small" href={`#/t/${encodeURIComponent(table.tableId)}`}>Open the flat table →</a>
          </div>
        ) : <span className="hint">Walk up to a table to look in, or click a free chair to sit.</span>}
        {sitError ? <div className="form-error">{sitError}</div> : null}
        <form className="room-say" onSubmit={(e) => { e.preventDefault(); if (line.trim()) { s?.say(line.trim()); setLine(''); } }}>
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="Say something to the room" maxLength={140} />
          <button type="submit" disabled={!line.trim()}>Say</button>
        </form>
      </div>
      <aside className="room-people">
        {/* WHICH ROOM THIS IS. The hall and every club's lounge are separate scenes with separate presence, and
            they are drawn from the same scenery — so two people in different ones look to each other like a
            presence bug. Naming the room here, beside the only list of who is in it, is what answers that. */}
        <h3 className="eyebrow-h">Here now · {manifest?.name ?? (clubId ? 'this club' : 'the hall')}</h3>
        <ul>{people.map((p) => <li key={p.playerId}>{p.name}{p.playerId === s?.state.you ? ' (you)' : ''}{p.zone ? <span className="hint"> · {manifest?.tables.find((t) => t.tableId === p.zone)?.name ?? p.zone}</span> : null}</li>)}</ul>
        <p className="hint room-elsewhere">Only people in {clubId ? 'this club’s room' : 'the hall'} are here. {clubId ? <>Somebody in <a href={roomHash(null)}>the hall</a> or another club’s room is in a different place.</> : 'Somebody in a club’s own room is in a different place.'}</p>
      </aside>
    </div>
  );
}
