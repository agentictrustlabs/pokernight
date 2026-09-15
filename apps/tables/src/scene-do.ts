/**
 * THE ROOM — presence, one Durable Object per room (`docs/SPATIAL-ROOM.md` §3.2).
 *
 * A room is a place; a table is a thing in it. This object holds who is standing where, at what, and
 * saying what — and NOTHING about cards. A table in the room is a `PokerTableDO` the person already knows
 * how to sit at, over its own socket; the room lays the club's tables out on anchors and tells a body which
 * zone it is in. Seat state comes from the table alone: a person is drawn in a chair because the TABLE said
 * so (`seatedAt`, reported by the client from its own table socket's `welcome`/`seat` events, and shown to
 * others as a fact about presence, never as authority).
 *
 * Hibernatable WebSockets: an idle room costs nothing; presence lives in SQLite so a wake restores it.
 * Poses arrive at ≤10 Hz and are fanned out in 100 ms batches. Nothing here outlives the session.
 */
import { DurableObject } from 'cloudflare:workers';
import { RoomClientMessageSchema, type RoomAnchor, type RoomManifest, type RoomPerson, type RoomServerMessage } from '@pokernight/protocol';
import type { Env } from './env.js';

interface Attachment { playerId: string; name: string; agent?: string }
interface PersonRow extends Record<string, SqlStorageValue> { player_id: string; name: string; agent: string | null; body: string; x: number; y: number; yaw: number; zone: string | null; seated_json: string | null; said_json: string | null; updated_at: number }

/** THE LOUNGE — a built-in scene with named anchors, in metres, y up on the plane (x east, y north). */
export const LOUNGE_ANCHORS: Record<string, RoomAnchor> = {
  door: { x: 0, y: -9, yaw: 0, radius: 1.5 },
  bar: { x: -7, y: 4, yaw: Math.PI / 2, radius: 2.5 },
  fire: { x: 7, y: 5, yaw: -Math.PI / 2, radius: 2.5 },
  lectern: { x: 7, y: -3, yaw: -Math.PI / 2, radius: 2 },
  'table.1': { x: -3, y: -2, yaw: 0, radius: 3.2 },
  'table.2': { x: 3, y: -2, yaw: 0, radius: 3.2 },
  'table.3': { x: -3, y: 4, yaw: 0, radius: 3.2 },
  'table.4': { x: 2, y: 5, yaw: 0, radius: 3.2 },
};
/**
 * How long a body stays put after its socket closes. Long enough to cross from the room to a seat's own page
 * (or to refresh), short enough that somebody who really left is gone before anyone wonders.
 */
const LINGER_MS = 12_000;
/** Tests want this short; nothing else sets it. */
const lingerMs = (env: { ROOM_LINGER_MS?: string }): number => {
  const n = Number(env.ROOM_LINGER_MS);
  return Number.isFinite(n) && n >= 0 ? n : LINGER_MS;
};

export const BODIES = ['oak', 'slate', 'brass', 'rose', 'moss', 'ink'] as const;
const TABLE_ANCHORS = Object.keys(LOUNGE_ANCHORS).filter((k) => k.startsWith('table.'));

/** Which anchor a point is in the zone of — a table wins over a bar; nearest wins otherwise. */
export function zoneOf(anchors: Record<string, RoomAnchor>, x: number, y: number, tables: RoomManifest['tables']): string | null {
  let best: { key: string; d: number } | null = null;
  for (const [key, a] of Object.entries(anchors)) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d <= (a.radius ?? 2) && (!best || d < best.d)) best = { key, d };
  }
  if (!best) return null;
  const t = tables.find((tb) => tb.anchor === best!.key);
  return t ? t.tableId : best.key === 'door' ? null : best.key;
}

export class SceneDO extends DurableObject<Env> {
  private tables: RoomManifest['tables'] = [];
  private roomId = '';
  private roomName = '';
  private pending = new Map<string, RoomPerson>();
  private leaves = new Set<string>();
  /** People whose socket has closed but who are not gone yet — see `leave`. */
  private going = new Map<string, ReturnType<typeof setTimeout>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS people (
          player_id   TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          agent       TEXT,
          body        TEXT NOT NULL,
          x REAL NOT NULL, y REAL NOT NULL, yaw REAL NOT NULL,
          zone        TEXT,
          seated_json TEXT,
          said_json   TEXT,
          updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS room (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
      const rows = ctx.storage.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM room`).toArray();
      for (const r of rows) {
        if (r.k === 'tables') this.tables = JSON.parse(r.v) as RoomManifest['tables'];
        if (r.k === 'roomId') this.roomId = r.v;
        if (r.k === 'roomName') this.roomName = r.v;
      }
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/layout') {
      // The Worker lays the room's tables out on anchors — the club's open tables, in order; the pickup hall's.
      const b = (await request.json()) as { roomId: string; name: string; tables: Array<{ tableId: string; name: string; game?: string; seats: number; seated: number; occupants?: Array<{ seat: number; playerId: string; kind: string }> }> };
      this.roomId = b.roomId; this.roomName = b.name;
      this.tables = b.tables.slice(0, TABLE_ANCHORS.length).map((t, i) => ({ ...t, anchor: TABLE_ANCHORS[i]! }));
      // A body in the room whose person the table seats is drawn in that chair; one no table seats stands.
      const seatOf = new Map<string, { tableId: string; seat: number }>();
      for (const t of this.tables) for (const o of t.occupants ?? []) seatOf.set(o.playerId, { tableId: t.tableId, seat: o.seat });
      for (const p of this.people()) {
        const now = seatOf.get(p.playerId) ?? undefined;
        const was = p.seatedAt;
        if ((now?.tableId ?? null) !== (was?.tableId ?? null) || (now?.seat ?? null) !== (was?.seat ?? null)) { const { seatedAt: _s, ...rest } = p; const next = { ...rest, ...(now ? { seatedAt: now } : {}) }; this.put(next); this.queue(next); }
      }
      this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO room (k, v) VALUES ('tables', ?), ('roomId', ?), ('roomName', ?)`, JSON.stringify(this.tables), this.roomId, this.roomName);
      // Everybody hears the new layout; zones are re-derived on their next pose.
      this.broadcast({ type: 'room', manifest: this.manifest(), you: '', people: this.people() }, true);
      return json({ ok: true, manifest: this.manifest() });
    }
    if (request.method === 'GET' && url.pathname === '/manifest') return json({ manifest: this.manifest(), people: this.people() });
    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket upgrade' }, 426);
      const playerId = request.headers.get('x-player-id');
      const name = decodeURIComponent(request.headers.get('x-player-name') ?? '');
      const agent = request.headers.get('x-player-agent') ?? undefined;
      if (!playerId) return json({ error: 'a body needs a person' }, 401);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [playerId]);
      const attachment: Attachment = { playerId, name, ...(agent ? { agent } : {}) };
      server.serializeAttachment(attachment);
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not found' }, 404);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment;
    let parsed;
    try { parsed = RoomClientMessageSchema.safeParse(JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))); } catch { parsed = null; }
    if (!parsed?.success) { this.send(ws, { type: 'error', code: 'bad-message', message: 'not a room message' }); return; }
    const m = parsed.data;
    if (m.type === 'ping') return;
    if (m.type === 'join') {
      // ONE BODY PER PERSON: the socket that says `join` is the tab that is here; every other socket of theirs
      // is told it was replaced. Decided at `join` rather than at the upgrade, because two upgrades from one
      // tab (React mounting an effect twice) can land in either order and the survivor must be the one that
      // speaks, not the one that arrived last.
      for (const other of this.ctx.getWebSockets(who.playerId)) if (other !== ws) { try { other.close(4001, 'replaced'); } catch { /* gone */ } }
      // They are back before the grace ran out: nothing to remove.
      const pending = this.going.get(who.playerId);
      if (pending) { clearTimeout(pending); this.going.delete(who.playerId); }
      const body = m.body && (BODIES as readonly string[]).includes(m.body) ? m.body : BODIES[hash(who.playerId) % BODIES.length]!;
      const existing = this.row(who.playerId);
      const door = LOUNGE_ANCHORS.door!;
      const spread = (hash(who.playerId + 'x') % 200) / 100 - 1;
      const base: RoomPerson = existing ? { ...rowToPerson(existing), name: who.name, body } : { playerId: who.playerId, ...(who.agent ? { agent: who.agent } : {}), name: who.name, body, x: door.x + spread, y: door.y + 0.5, yaw: 0, zone: null };
      // Seated somewhere the layout knows? Then the body is drawn in that chair from the first frame.
      const seat = this.tables.flatMap((t) => (t.occupants ?? []).filter((o) => o.playerId === who.playerId).map((o) => ({ tableId: t.tableId, seat: o.seat })))[0];
      const { seatedAt: _s, ...rest } = base;
      const person: RoomPerson = { ...rest, ...(seat ? { seatedAt: seat } : {}) };
      this.put(person);
      this.send(ws, { type: 'room', manifest: this.manifest(), you: who.playerId, people: this.people() });
      this.queue(person);
      return;
    }
    const row = this.row(who.playerId);
    if (!row) { this.send(ws, { type: 'error', code: 'not-joined', message: 'say join first' }); return; }
    const person = rowToPerson(row);
    if (m.type === 'pose') {
      // Clamped to the lounge; a pose older than the last is dropped on the client side, here it is just taken.
      const x = Math.max(-10, Math.min(10, m.x)); const y = Math.max(-10, Math.min(10, m.y));
      const zone = zoneOf(LOUNGE_ANCHORS, x, y, this.tables);
      const next: RoomPerson = { ...person, x, y, yaw: m.yaw, zone };
      this.put(next);
      if (zone !== person.zone) this.send(ws, { type: 'zone', zone });
      this.queue(next);
      return;
    }
    if (m.type === 'say') {
      const next: RoomPerson = { ...person, said: { text: m.text, at: Date.now() } };
      this.put(next);
      this.queue(next);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> { this.leave(ws); }
  override async webSocketError(ws: WebSocket): Promise<void> { this.leave(ws); }

  /**
   * A CLOSED SOCKET IS NOT SOMEBODY LEAVING THE ROOM — not yet.
   *
   * Taking a seat by the fire moves the person from the 3D room to that seat's own page, and the page they came
   * from closes its socket on the way. Removing them the instant it closed made everybody else watch them
   * VANISH and then, seconds later, reappear sitting down. The same flicker happens on every refresh and every
   * hiccup in a phone's connection.
   *
   * So a closing socket starts a GRACE: the body stays exactly where it was, and only if nothing has reconnected
   * by the time it expires is the person really gone. Coming back within it is seamless — the reconnect simply
   * finds them still there. The seat itself is not in question here; this is only about a body in a room.
   */
  private leave(ws: WebSocket): void {
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who) return;
    // Still connected on another socket (a replaced tab closing late)? Then they are still here.
    if (this.ctx.getWebSockets(who.playerId).some((s) => s !== ws)) return;
    const id = who.playerId;
    const timer = this.going.get(id);
    if (timer) clearTimeout(timer);
    this.going.set(id, setTimeout(() => {
      this.going.delete(id);
      // Reconnected in the meantime? Then they never left.
      if (this.ctx.getWebSockets(id).length > 0) return;
      this.ctx.storage.sql.exec(`DELETE FROM people WHERE player_id = ?`, id);
      this.pending.delete(id);
      this.leaves.add(id);
      this.flushSoon();
    }, lingerMs(this.env as unknown as { ROOM_LINGER_MS?: string })));
  }

  // ── presence, batched ──
  private queue(p: RoomPerson): void { this.pending.set(p.playerId, p); this.flushSoon(); }
  private flushSoon(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 100);
  }
  private flush(): void {
    if (!this.pending.size && !this.leaves.size) return;
    const msg: RoomServerMessage = { type: 'people', upserts: [...this.pending.values()], leaves: [...this.leaves] };
    this.pending.clear(); this.leaves.clear();
    this.broadcast(msg);
  }
  private broadcast(msg: RoomServerMessage, includeYou = false): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (includeYou && msg.type === 'room') { const who = ws.deserializeAttachment() as Attachment; ws.send(JSON.stringify({ ...msg, you: who.playerId })); } else ws.send(text);
      } catch { /* a closing socket */ }
    }
  }
  private send(ws: WebSocket, msg: RoomServerMessage): void { try { ws.send(JSON.stringify(msg)); } catch { /* closing */ } }

  // ── rows ──
  private manifest(): RoomManifest {
    return { roomId: this.roomId, name: this.roomName, scene: 'lounge', anchors: LOUNGE_ANCHORS, tables: this.tables, bodies: [...BODIES] };
  }
  private row(playerId: string): PersonRow | null {
    return (this.ctx.storage.sql.exec<PersonRow>(`SELECT * FROM people WHERE player_id = ?`, playerId).toArray()[0] as PersonRow | undefined) ?? null;
  }
  private people(): RoomPerson[] {
    return this.ctx.storage.sql.exec<PersonRow>(`SELECT * FROM people`).toArray().map((r) => rowToPerson(r as PersonRow));
  }
  private put(p: RoomPerson): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO people (player_id, name, agent, body, x, y, yaw, zone, seated_json, said_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.playerId, p.name, p.agent ?? null, p.body, p.x, p.y, p.yaw, p.zone, p.seatedAt ? JSON.stringify(p.seatedAt) : null, p.said ? JSON.stringify(p.said) : null, Date.now(),
    );
  }
}

function rowToPerson(r: PersonRow): RoomPerson {
  return {
    playerId: r.player_id, name: r.name, ...(r.agent ? { agent: r.agent } : {}), body: r.body, x: r.x, y: r.y, yaw: r.yaw, zone: r.zone,
    ...(r.seated_json ? { seatedAt: JSON.parse(r.seated_json) as RoomPerson['seatedAt'] } : {}),
    ...(r.said_json ? { said: JSON.parse(r.said_json) as RoomPerson['said'] } : {}),
  };
}

function hash(s: string): number { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
