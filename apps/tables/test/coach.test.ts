/**
 * The coach, and the one property that makes it teaching rather than cheating.
 *
 * IT SEES WHAT THE SEAT SEES. A coach that reasoned from the table's full state would explain moves
 * using cards the learner cannot see, which is worse than not teaching: it produces reasoning they
 * can never reproduce when they are playing on their own. So the advice route is gated on the seat
 * being YOURS, and the coach inside the game reads `viewFor(state, seat)` and nothing else.
 *
 * The other half is that the move it names is a move the table will actually accept — a coach whose
 * advice is refused when you follow it is worse than silence.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { TableSummary } from '@pokernight/protocol';
import { TestClient, devSession, engineReady, sleep } from './helpers.js';

interface Advice {
  action: { type: string };
  say: string;
  because: string;
}

async function canastaTable(name: string): Promise<{ tableId: string; token: string; playerId: string }> {
  const { token, playerId } = await devSession(name);
  const res = await SELF.fetch('http://tables.test/tables', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, game: 'canasta' }),
  });
  const t = (await res.json()) as TableSummary;
  return { tableId: t.tableId, token, playerId };
}

const advice = (tableId: string, token?: string) =>
  SELF.fetch(`http://tables.test/tables/${tableId}/advice`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

describe('asking the coach', () => {
  it('needs a session, because advice is about a seat and a seat belongs to somebody', async () => {
    const { tableId } = await canastaTable('coach anon');
    expect((await advice(tableId)).status).toBe(401);
  });

  it('is refused to somebody who is not seated — there is nothing to advise', async () => {
    const { tableId } = await canastaTable('coach watcher');
    const watcher = await devSession('a watcher');
    const res = await advice(tableId, watcher.token);
    expect(res.status).toBe(404);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/not seated/);
  });

  it.skipIf(!engineReady)('names a move the table will accept, and says why', async () => {
    const { tableId, token } = await canastaTable('coach player');
    const me = await TestClient.connect(tableId, token);
    await me.waitFor((m) => m.type === 'welcome');
    me.send({ type: 'join', seat: 0, buyIn: 1 });
    await me.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');

    // Three more seats, so the round deals.
    const others = [];
    for (const [n, seat] of [['coach two', 1], ['coach three', 2], ['coach four', 3]] as const) {
      const s = await devSession(n);
      const c = await TestClient.connect(tableId, s.token);
      await c.waitFor((m) => m.type === 'welcome');
      c.send({ type: 'join', seat, buyIn: 1 });
      await c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
      others.push(c);
    }
    await sleep(1500);

    // Ask, and if it is our turn the coach answers with something we can actually play.
    const res = await advice(tableId, token);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const a = (await res.json()) as Advice;
      // A turn begins in the draw phase, so the only two moves in the game are these.
      expect(['draw', 'take-pile']).toContain(a.action.type);
      expect(a.say.length, a.say).toBeGreaterThan(4);
      // The teaching half is the point, and it must never be empty.
      expect(a.because.length, a.because).toBeGreaterThan(40);
      // Spoken aloud, so no raw card codes.
      expect(a.say).not.toMatch(/\b[2-9TJQKAW][CDHS*]\b/);

      // And the move it named is one the engine takes: a coach whose advice is refused when you
      // follow it is worse than silence.
      me.send({ type: 'act', handNo: 1, action: a.action });
      const applied = await Promise.race([
        me.waitFor((m) => m.type === 'event', 4000).then(() => 'applied' as const),
        me.waitFor((m) => m.type === 'error', 4000).then(() => 'refused' as const),
      ]);
      expect(applied).toBe('applied');
    }
    me.close();
    for (const c of others) c.close();
  }, 30_000);

  it('says a POKER table has no coach rather than inventing one', async () => {
    const { token } = await devSession('coach at poker');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'coachless poker' }),
    });
    const t = (await res.json()) as TableSummary;
    const me = await TestClient.connect(t.tableId, token);
    await me.waitFor((m) => m.type === 'welcome');
    me.send({ type: 'join', seat: 0, buyIn: 100 });
    await me.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    const res2 = await advice(t.tableId, token);
    // Seated, so the seat gate passes; the game simply declares no coach.
    expect(res2.status).toBe(404);
    expect(String(((await res2.json()) as { error: string }).error)).toMatch(/no coach/);
    me.close();
  }, 20_000);
});

/**
 * A CANASTA TABLE PLAYS MANY ROUNDS, and a refusal from its rules is a refusal, not a broken client.
 *
 * Both of these were live bugs and they compounded: a table that had played one round would not seat
 * a fourth player, and when it refused, the code on the wire said `bad-command` — so the person was
 * told their software was at fault for doing exactly the right thing.
 */
describe('a canasta table between rounds', () => {
  it('reports a rules refusal with the RULE’s code, never bad-command', async () => {
    const { tableId, token } = await canastaTable('refusal code');
    const me = await TestClient.connect(tableId, token);
    await me.waitFor((m) => m.type === 'welcome');
    me.send({ type: 'join', seat: 0, buyIn: 1 });
    await me.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    // Sitting in a seat that is taken is the game's own refusal, from the game's own error type.
    me.send({ type: 'join', seat: 0, buyIn: 1 });
    const err = await me.waitFor((m) => m.type === 'error');
    if (err.type !== 'error') throw new Error('unreachable');
    expect(err.code, `a rules refusal came back as ${err.code}`).not.toBe('bad-command');
    expect(err.message.length).toBeGreaterThan(4);
    me.close();
  }, 20_000);

  it.skipIf(!engineReady)('lets a fourth player take the free seat once a round is scored', async () => {
    const { tableId, token } = await canastaTable('fourth seat');
    const clients = [];
    for (const seat of [0, 1, 2, 3]) {
      const s = seat === 0 ? { token } : await devSession(`fourth ${seat}`);
      const c = await TestClient.connect(tableId, s.token);
      await c.waitFor((m) => m.type === 'welcome');
      c.send({ type: 'join', seat, buyIn: 1 });
      await c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
      clients.push(c);
    }
    await sleep(1200);

    // One player leaves, which ends the running round — three cannot play a partnership game.
    clients[3]!.send({ type: 'leave' });
    await sleep(1200);

    // …and the seat can be taken again. Before this, the finished round read as "in progress" and
    // the table could never be four-handed again: no deal, no game, forever.
    const late = await devSession('the latecomer');
    const c = await TestClient.connect(tableId, late.token);
    await c.waitFor((m) => m.type === 'welcome');
    c.send({ type: 'join', seat: 3, buyIn: 1 });
    const landed = await Promise.race([
      c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined', 6000).then(() => 'seated' as const),
      c.waitFor((m) => m.type === 'error', 6000).then((m) => (m.type === 'error' ? `refused: ${m.code}` : 'refused')),
    ]);
    expect(landed).toBe('seated');
    c.close();
    for (const x of clients) x.close();
  }, 30_000);
});
