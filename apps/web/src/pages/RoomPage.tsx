import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { AppSession } from '../lib/types';
import { RoomSocket } from '../lib/roomSocket';
import { roomApi as api } from '../lib/api';
import { HuddleAffordance } from '../components/huddle/ClubHuddleDock';
import { useClubHuddle } from '../components/huddle/ClubHuddleProvider';
import { clubScope } from '../lib/huddle';
import { SpatialVoice } from '../components/room/SpatialVoice';
import { clubHash, HOME_HASH } from '../lib/routes';

/** The scene is a separate chunk — three.js never loads for a page that has no room (the Leaflet rule). */
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
  const webgl = useRef<boolean>(typeof document !== 'undefined' && (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })());
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
      <Suspense fallback={<div className="lounge-loading"><p className="hint">Loading the lounge…</p></div>}>
        {s ? <Lounge socket={s} state={s.state} onZone={onZone} /> : null}
      </Suspense>
      {s && inThisHuddle ? <SpatialVoice state={s.state} /> : null}
      <div className="room-bar">
        {seatedTable ? (
          <div className="room-table-card">
            <strong>{seatedTable.name}</strong> <span className="hint">seat {(meNow!.seatedAt!.seat) + 1} · {seatedTable.seated}/{seatedTable.seats} seated</span>
            <a className="button primary" href={`#/t/${encodeURIComponent(seatedTable.tableId)}`}>Back to your cards →</a>
          </div>
        ) : table ? (
          <div className="room-table-card">
            <strong>{table.name}</strong> <span className="hint">{table.seated}/{table.seats} seated</span>
            <a className="button primary" href={`#/t/${encodeURIComponent(table.tableId)}`}>Sit down at the table →</a>
          </div>
        ) : <span className="hint">Walk up to a table to look in.</span>}
        <form className="room-say" onSubmit={(e) => { e.preventDefault(); if (line.trim()) { s?.say(line.trim()); setLine(''); } }}>
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="Say something to the room" maxLength={140} />
          <button type="submit" disabled={!line.trim()}>Say</button>
        </form>
      </div>
      <aside className="room-people">
        <h3 className="eyebrow-h">Here now</h3>
        <ul>{people.map((p) => <li key={p.playerId}>{p.name}{p.playerId === s?.state.you ? ' (you)' : ''}{p.zone ? <span className="hint"> · {manifest?.tables.find((t) => t.tableId === p.zone)?.name ?? p.zone}</span> : null}</li>)}</ul>
      </aside>
    </div>
  );
}
