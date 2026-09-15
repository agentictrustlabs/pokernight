/**
 * SITTING DOWN FROM THE ROOM (docs/SPATIAL-ROOM.md §3.4). A seat is the TABLE's own `join` command over its
 * socket, and nothing else grants one — so walking up to a chair in the room ends with a short visit to
 * the table's socket: open, `join`, wait for the table to say the seat is taken (or refused), close. The
 * seat stays taken when this socket closes (a socket is a tab, not a person); the room re-reads the layout
 * and the body sits. Standing up is the same visit with `leave`.
 */
import type { ServerMessage } from '@pokernight/protocol';

export type SeatOutcome = { ok: true } | { ok: false; reason: string };

function visit(url: string, send: object, done: (m: ServerMessage) => SeatOutcome | null, timeoutMs = 8000): Promise<SeatOutcome> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e) { resolve({ ok: false, reason: e instanceof Error ? e.message : 'no socket' }); return; }
    let settled = false;
    const finish = (o: SeatOutcome) => { if (settled) return; settled = true; clearTimeout(t); try { ws.close(); } catch { /* closed */ } resolve(o); };
    const t = setTimeout(() => finish({ ok: false, reason: 'The table did not answer.' }), timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify(send));
    ws.onmessage = (ev) => { try { const o = done(JSON.parse(String(ev.data)) as ServerMessage); if (o) finish(o); } catch { /* not ours */ } };
    ws.onerror = () => finish({ ok: false, reason: 'Could not reach the table.' });
    ws.onclose = () => finish({ ok: false, reason: 'The table closed the door.' });
  });
}

/** Take `seat` at the table behind `url` with `buyIn` chips. */
export function takeSeat(url: string, seat: number, buyIn: number): Promise<SeatOutcome> {
  return visit(url, { type: 'join', seat, buyIn }, (m) => {
    if (m.type === 'error') return { ok: false, reason: m.message };
    if (m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === seat) return { ok: true };
    return null;
  });
}

/** Leave whatever seat this session holds at the table behind `url`. */
export function leaveSeat(url: string): Promise<SeatOutcome> {
  return visit(url, { type: 'leave' }, (m) => {
    if (m.type === 'error') return { ok: false, reason: m.message };
    if (m.type === 'event' && m.event.type === 'seat-left') return { ok: true };
    return null;
  });
}
