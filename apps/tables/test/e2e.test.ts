/**
 * End-to-end: two clients join, the auto-start alarm deals a hand, the seat to act applies an action.
 *
 * DEPENDS ON THE ENGINE IMPLEMENTATION LANDING: @pokernight/engine currently throws "not implemented"
 * from createTable/sitDown/startHand/applyAction, so this test is skipped (via `engineReady`) until the
 * engine is real. It runs automatically once createTable() stops throwing.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hexToBytes, seedCommit } from '@pokernight/engine';
import type { ServerMessage } from '@pokernight/protocol';
import { TestClient, createTableViaHttp, devSession, engineReady, waitForAny } from './helpers.js';

describe('end to end (engine required)', () => {
  it.skipIf(!engineReady)('two players join, a hand starts, and an action is applied', async () => {
    const table = await createTableViaHttp('e2e', { minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 30_000 });
    const aliceS = await devSession('Alice');
    const bobS = await devSession('Bob');
    const alice = await TestClient.connect(table.tableId, aliceS.token);
    const bob = await TestClient.connect(table.tableId, bobS.token);
    expect(await alice.next()).toMatchObject({ type: 'welcome', playerId: aliceS.playerId });
    expect(await bob.next()).toMatchObject({ type: 'welcome', playerId: bobS.playerId });

    alice.send({ type: 'join', seat: 0, buyIn: 100 });
    const joinedA = await alice.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    expect(joinedA).toMatchObject({ type: 'event', event: { seat: 0, playerId: aliceS.playerId, name: 'Alice', stack: 100 } });
    await bob.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');

    bob.send({ type: 'join', seat: 1, buyIn: 100 });
    await alice.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 1);
    await bob.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 1);

    // The DO schedules an alarm 1.5 s after the second player sits; miniflare fires it in real time.
    const startedA = await alice.waitFor((m) => m.type === 'event' && m.event.type === 'hand-started', 8000);
    expect(startedA).toMatchObject({ type: 'event', event: { handNo: 1 } });
    if (startedA.type !== 'event' || startedA.event.type !== 'hand-started') throw new Error('unreachable');
    expect(startedA.event.seedCommit).toMatch(/^[0-9a-f]{64}$/);
    expect(startedA.view.hand?.street).toBe('preflop');

    // Each player sees only their own hole cards.
    const holeA = await alice.waitFor((m) => m.type === 'event' && m.event.type === 'hole-cards');
    if (holeA.type !== 'event' || holeA.event.type !== 'hole-cards') throw new Error('unreachable');
    expect(holeA.event.seat).toBe(0);
    expect(holeA.event.cards).toHaveLength(2);

    // Exactly one client receives `turn`; it acts with a legal move.
    const isTurn = (m: ServerMessage) => m.type === 'turn';
    const { message: turn } = await waitForAny([alice, bob], isTurn, 8000);
    if (turn.type !== 'turn') throw new Error('unreachable');
    expect(turn.handNo).toBe(1);
    expect(turn.deadline).toBeGreaterThan(Date.now());
    const actor = turn.seat === 0 ? alice : bob;
    const action = turn.legal.check ? { type: 'check' } : turn.legal.call !== null ? { type: 'call' } : { type: 'fold' };

    // A stale hand number is rejected before the engine sees it.
    actor.send({ type: 'act', handNo: 99, action });
    expect(await actor.waitFor((m) => m.type === 'error')).toMatchObject({ type: 'error', code: 'stale-hand' });

    actor.send({ type: 'act', handNo: 1, action });
    const applied = await alice.waitFor((m) => m.type === 'event' && m.event.type === 'action', 8000);
    if (applied.type !== 'event' || applied.event.type !== 'action') throw new Error('unreachable');
    expect(applied.event.record.seat).toBe(turn.seat);
    expect(applied.event.record.action.type).toBe(action.type);
    expect(applied.view.hand?.actions.length).toBeGreaterThan(0);

    // Whoever is on the clock now folds, so the hand ends without a showdown and the seed is revealed.
    const { message: turn2 } = await waitForAny([alice, bob], isTurn, 8000);
    if (turn2.type !== 'turn') throw new Error('unreachable');
    (turn2.seat === 0 ? alice : bob).send({ type: 'act', handNo: 1, action: { type: 'fold' } });
    const ended = await bob.waitFor((m) => m.type === 'event' && m.event.type === 'hand-ended', 8000);
    if (ended.type !== 'event' || ended.event.type !== 'hand-ended') throw new Error('unreachable');
    expect(seedCommit(hexToBytes(ended.event.seedReveal))).toBe(startedA.event.seedCommit);
    const net = Object.values(ended.event.result.net).reduce((a, b) => a + b, 0);
    expect(net + ended.event.result.rake).toBe(0);
    expect(ended.view.hand?.result).toBeDefined();

    // Regression: the finished hand stays on the state with `result`; the next hand must still auto-start
    // from the alarm (it used to check for `hand === null` and never dealt hand 2).
    const started2 = await alice.waitFor((m) => m.type === 'event' && m.event.type === 'hand-started' && m.event.handNo === 2, 10000);
    expect(started2).toMatchObject({ type: 'event', event: { type: 'hand-started', handNo: 2 } });

    // The stored hand record is public once ended: reveal, action log and result.
    const rec = (await (await SELF.fetch(`http://tables.test/tables/${table.tableId}/hands/1`)).json()) as {
      handNo: number;
      seedCommit: string;
      seedReveal: string;
      actions: unknown[];
      events: unknown[];
      result: { net: Record<string, number> };
    };
    expect(rec.handNo).toBe(1);
    expect(rec.seedCommit).toBe(startedA.event.seedCommit);
    expect(rec.seedReveal).toBe(ended.event.seedReveal);
    expect(rec.actions.length).toBe(2);
    expect(rec.events.length).toBeGreaterThan(rec.actions.length);
    expect(rec.result.net).toEqual(ended.event.result.net);

    // Leaving cashes out through the ledger + outbox and is announced to the table.
    alice.send({ type: 'leave' });
    const left = await bob.waitFor((m) => m.type === 'event' && m.event.type === 'seat-left', 8000);
    expect(left).toMatchObject({ type: 'event', event: { seat: 0, playerId: aliceS.playerId } });

    alice.close();
    bob.close();
  }, 20_000);
});
