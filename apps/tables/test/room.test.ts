/**
 * THE ROOM (docs/SPATIAL-ROOM.md): presence in a place, nothing about cards. The pickup hall is open to any
 * signed-in person; a body joins at the door, walks, is seen by others in batches, finds itself in a table's
 * zone, and leaves when its socket closes.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { RoomServerMessage } from '@pokernight/protocol';
import { LOUNGE_ANCHORS, zoneOf } from '../src/scene-do.js';
import { createTableViaHttp, devSession, sleep } from './helpers.js';

/** The next message for which `pred` holds — presence is batched and re-laid-out, so a socket hears its own join too. */
async function until(next: () => Promise<RoomServerMessage>, pred: (m: RoomServerMessage) => boolean, tries = 8): Promise<RoomServerMessage> {
  for (let i = 0; i < tries; i++) { const m = await next(); if (pred(m)) return m; }
  throw new Error('no such message');
}

function open(token: string): Promise<{ ws: WebSocket; next: () => Promise<RoomServerMessage> }> {
  return new Promise(async (resolve, reject) => {
    const res = await SELF.fetch(`http://tables.test/rooms/hall/ws?token=${token}`, { headers: { upgrade: 'websocket' } });
    const ws = res.webSocket;
    if (!ws) return reject(new Error(`no socket: ${res.status}`));
    ws.accept();
    const queue: RoomServerMessage[] = []; const waiters: Array<(m: RoomServerMessage) => void> = [];
    ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)) as RoomServerMessage; const w = waiters.shift(); if (w) w(m); else queue.push(m); });
    const next = () => new Promise<RoomServerMessage>((r) => { const q = queue.shift(); if (q) r(q); else waiters.push(r); });
    resolve({ ws, next });
  });
}

describe('zones', () => {
  it('names the table standing on an anchor, the bar and the fire by name, and the door as nowhere', () => {
    const tables = [{ tableId: 't1', name: 'one', anchor: 'table.1', seats: 6, seated: 0 }];
    const t1 = LOUNGE_ANCHORS['table.1']!;
    expect(zoneOf(LOUNGE_ANCHORS, t1.x + 0.5, t1.y, tables)).toBe('t1');
    expect(zoneOf(LOUNGE_ANCHORS, LOUNGE_ANCHORS.bar!.x, LOUNGE_ANCHORS.bar!.y, tables)).toBe('bar');
    expect(zoneOf(LOUNGE_ANCHORS, LOUNGE_ANCHORS.door!.x, LOUNGE_ANCHORS.door!.y, tables)).toBeNull();
    expect(zoneOf(LOUNGE_ANCHORS, 0, 0, tables)).toBeNull();
  });
});

describe('the hall', () => {
  it('refuses a visitor, lays its tables out for a person, and is a place two bodies share', async () => {
    expect((await SELF.fetch('http://tables.test/rooms/hall')).status).toBe(401);
    const a = await devSession('walker-a'); const b = await devSession('walker-b');
    await createTableViaHttp('hall table', {}, { token: a.token });
    const read = (await (await SELF.fetch('http://tables.test/rooms/hall', { headers: { authorization: `Bearer ${a.token}` } })).json()) as { manifest: { tables: Array<{ tableId: string; anchor: string }>; anchors: Record<string, unknown> } };
    // The hall has as many lamps as anchors; the lobby's first tables stand under them.
    expect(read.manifest.tables.length).toBeGreaterThan(0);
    expect(read.manifest.tables.length).toBeLessThanOrEqual(4);
    const placed = read.manifest.tables[0]!;
    expect(placed.anchor).toMatch(/^table\./);
    const t = { tableId: placed.tableId };
    expect(Object.keys(read.manifest.anchors)).toContain('bar');

    const A = await open(a.token); A.ws.send(JSON.stringify({ type: 'join', body: 'oak' }));
    const roomA = await A.next();
    expect(roomA.type).toBe('room');
    if (roomA.type !== 'room') throw new Error('no room');
    expect(roomA.you).toBe(a.playerId);
    expect(roomA.people.map((p) => p.playerId)).toContain(a.playerId);

    const B = await open(b.token); B.ws.send(JSON.stringify({ type: 'join' }));
    const roomB = await B.next();
    if (roomB.type !== 'room') throw new Error('no room');
    expect(roomB.people.map((p) => p.playerId).sort()).toEqual([a.playerId, b.playerId].sort());
    // A hears B arrive (batched)
    const arrive = await until(A.next, (m) => m.type === 'people' && m.upserts.some((p) => p.playerId === b.playerId));
    expect(arrive.type).toBe('people');

    // B walks to the table: B is told the zone; A sees B move.
    const anchor = read.manifest.anchors[placed!.anchor] as { x: number; y: number };
    B.ws.send(JSON.stringify({ type: 'pose', x: anchor.x, y: anchor.y + 0.3, yaw: 1, t: Date.now() }));
    const zone = await until(B.next, (m) => m.type === 'zone');
    expect(zone).toEqual({ type: 'zone', zone: t.tableId });
    const moved = await until(A.next, (m) => m.type === 'people' && m.upserts.some((p) => p.playerId === b.playerId && p.zone === t.tableId));
    expect(moved.type).toBe('people');

    // B's SOCKET CLOSES AND B DOES NOT VANISH. Taking a seat by the fire moves somebody to that seat's own
    // page, and the page they came from closes its socket on the way — so a close that removed them at once
    // made everyone else watch them disappear and reappear seconds later. The body lingers instead, and a
    // reconnect inside the grace is seamless: they were never gone.
    B.ws.close(1000, 'bye');
    const vanished = await Promise.race([
      until(A.next, (m) => m.type === 'people' && m.leaves.includes(b.playerId)).then(() => true),
      sleep(600).then(() => false),
    ]);
    expect(vanished).toBe(false);
    const B2 = await open(b.token); B2.ws.send(JSON.stringify({ type: 'join' }));
    const back = await until(B2.next, (m) => m.type === 'room');
    expect(back.type).toBe('room');
    expect((back as { people: Array<{ playerId: string }> }).people.map((p) => p.playerId)).toContain(b.playerId);
    B2.ws.close(1000, 'bye');
    A.ws.close(1000, 'bye');
    await sleep(50);
  });
});
