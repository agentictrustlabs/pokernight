/**
 * Alarm paths: turn clock timeout (default action, timedOut flag) and ledger/outbox persistence.
 * Requires the engine (createTable/startHand/timeoutAction).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { PokerTableDO } from '../src/table-do.js';
import { TestClient, createTableViaHttp, devSession, engineReady, waitForAny } from './helpers.js';

describe('alarms and persistence (engine required)', () => {
  it.skipIf(!engineReady)('applies the default action when the turn clock expires', async () => {
    const table = await createTableViaHttp('clock', { actionTimeoutMs: 1000 });
    const a = await TestClient.connect(table.tableId, (await devSession('Ann')).token);
    const b = await TestClient.connect(table.tableId, (await devSession('Ben')).token);
    a.send({ type: 'join', seat: 0, buyIn: 100 });
    await a.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    b.send({ type: 'join', seat: 1, buyIn: 100 });
    await b.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 1);

    const { message: turn } = await waitForAny([a, b], (m) => m.type === 'turn', 8000);
    if (turn.type !== 'turn') throw new Error('unreachable');
    expect(turn.deadline - Date.now()).toBeLessThanOrEqual(1000);

    // Nobody acts: the alarm fires at the deadline and the engine applies check-or-fold with timedOut.
    const timedOut = await a.waitFor((m) => m.type === 'event' && m.event.type === 'action', 8000);
    if (timedOut.type !== 'event' || timedOut.event.type !== 'action') throw new Error('unreachable');
    expect(timedOut.event.record.seat).toBe(turn.seat);
    expect(timedOut.event.record.timedOut).toBe(true);
    expect(timedOut.view.seats.find((s) => s.seat === turn.seat)).toBeDefined();

    const stub = env.TABLES.get(env.TABLES.idFromName(table.tableId));
    await runInDurableObject(stub, async (_instance: PokerTableDO, state) => {
      const seat = state.storage.sql.exec<{ json: string }>('SELECT json FROM actions WHERE hand_no = 1 ORDER BY idx').toArray();
      expect(seat.length).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(seat[0]?.json ?? '{}')).toMatchObject({ seat: turn.seat, timedOut: true });
      // The seed is held privately in KV until the hand ends, then moves to hands.seed_reveal.
      const hand = state.storage.sql.exec<{ ended_at: number | null; seed_reveal: string | null }>('SELECT ended_at, seed_reveal FROM hands WHERE hand_no = 1').one();
      const seed = await state.storage.get<string>('seed');
      if (hand.ended_at === null) {
        expect(seed).toMatch(/^[0-9a-f]{64}$/);
        expect(hand.seed_reveal).toBeNull();
      } else {
        expect(seed).toBeUndefined();
        expect(hand.seed_reveal).toMatch(/^[0-9a-f]{64}$/);
      }
    });
    a.close();
    b.close();
  }, 20_000);

  it.skipIf(!engineReady)('writes ledger rows for buy-in and cash-out and settles the outbox', async () => {
    const table = await createTableViaHttp('ledger');
    const cara = await devSession('Cara');
    const a = await TestClient.connect(table.tableId, cara.token);
    a.send({ type: 'join', seat: 2, buyIn: 150 });
    await a.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    a.send({ type: 'add-chips', amount: 20 });
    await a.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status');
    a.send({ type: 'leave' });
    const left = await a.waitFor((m) => m.type === 'event' && m.event.type === 'seat-left');
    expect(left).toMatchObject({ type: 'event', event: { seat: 2, playerId: cara.playerId, stack: 170 } });

    const stub = env.TABLES.get(env.TABLES.idFromName(table.tableId));
    // The outbox alarm was scheduled for "now"; run it directly rather than waiting on the clock.
    await runInDurableObject(stub, async (instance: PokerTableDO) => instance.alarm());
    await runInDurableObject(stub, async (_instance: PokerTableDO, state) => {
      const rows = state.storage.sql
        .exec<{ kind: string; chips: number; receipt_json: string | null }>('SELECT kind, chips, receipt_json FROM ledger WHERE player_id = ? ORDER BY at, kind', cara.playerId)
        .toArray();
      expect(rows.map((r) => [r.kind, r.chips])).toEqual([
        ['buy-in', 150],
        ['add-chips', 20],
        ['cash-out', -170],
      ]);
      expect(rows.every((r) => r.receipt_json !== null)).toBe(true);
      const outbox = state.storage.sql.exec<{ done_at: number | null; attempts: number }>('SELECT done_at, attempts FROM outbox').toArray();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.done_at).not.toBeNull();
    });
    a.close();
  }, 20_000);
});
