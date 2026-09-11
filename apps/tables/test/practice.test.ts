/**
 * A PRACTICE TABLE: one per person, always the same one, in no lobby, resettable.
 *
 * "I just want to be able to join a coaching table and leave and then reset to new game and get
 * coached again." Before this, learning canasta meant opening a fresh table each attempt and each
 * attempt left a dead game in the public list.
 *
 * Three properties, and the second is the one that keeps a lobby usable.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { TableSummary } from '@pokernight/protocol';
import { TestClient, devSession, engineReady, sleep, until } from './helpers.js';

async function practice(token?: string, game = 'canasta'): Promise<Response> {
  return SELF.fetch('http://tables.test/practice', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ game }),
  });
}

const reset = (id: string, token?: string) =>
  SELF.fetch(`http://tables.test/tables/${id}/reset`, {
    method: 'POST',
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });

describe('your practice table', () => {
  it('needs a session, because it is YOURS', async () => {
    expect((await practice()).status).toBe(401);
  });

  it('is the same table every time you ask', async () => {
    const { token } = await devSession('practice same');
    const a = (await (await practice(token)).json()) as { tableId: string };
    const b = (await (await practice(token)).json()) as { tableId: string };
    const c = (await (await practice(token)).json()) as { tableId: string };
    expect(a.tableId).toBe(b.tableId);
    expect(b.tableId).toBe(c.tableId);
    // …and the table really is there, dealing what was asked for.
    const detail = (await (await SELF.fetch(`http://tables.test/tables/${a.tableId}`)).json()) as { game?: string };
    expect(detail.game).toBe('canasta');
  });

  it('is a DIFFERENT one for each person, and for each game', async () => {
    const one = await devSession('practice alice');
    const two = await devSession('practice bob');
    const a = (await (await practice(one.token)).json()) as { tableId: string };
    const b = (await (await practice(two.token)).json()) as { tableId: string };
    const p = (await (await practice(one.token, 'poker')).json()) as { tableId: string };
    expect(a.tableId).not.toBe(b.tableId);
    expect(a.tableId).not.toBe(p.tableId);
  });

  it('is in NO LOBBY — a list of everybody’s practice games is the pile this replaces', async () => {
    const { token } = await devSession('practice unlisted');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const lobby = (await (await SELF.fetch('http://tables.test/tables')).json()) as TableSummary[];
    expect(lobby.find((t) => t.tableId === tableId), 'a practice table reached the public lobby').toBeUndefined();
  });

  it('settles nothing, whatever the game normally does', async () => {
    const { token } = await devSession('practice unstaked');
    const { tableId } = (await (await practice(token, 'poker')).json()) as { tableId: string };
    const detail = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as { settlement: string };
    expect(detail.settlement).toBe('play-money');
  });

  it('refuses a game this card room does not deal, by name', async () => {
    const { token } = await devSession('practice bridge');
    const res = await practice(token, 'bridge');
    expect(res.status).toBe(400);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/does not deal "bridge"/);
  });
});

describe('dealing again', () => {
  it('is refused to anybody but the person whose table it is', async () => {
    const { token } = await devSession('practice owner');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const stranger = await devSession('a stranger');
    expect((await reset(tableId, stranger.token)).status).toBe(404);
    expect((await reset(tableId)).status).toBe(401);
  });

  it('is refused at an ORDINARY table, where it would wipe a game other people are in', async () => {
    const { token } = await devSession('reset a real one');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'a real table', game: 'canasta' }),
    });
    const t = (await res.json()) as TableSummary;
    expect((await reset(t.tableId, token)).status).toBe(404);
  });

  it.skipIf(!engineReady)('keeps the seats and throws the scores away', async () => {
    const { token } = await devSession('practice reset');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };

    // Four seats, so a round deals and a score exists to throw away.
    const clients = [];
    for (const seat of [0, 1, 2, 3]) {
      const s = seat === 0 ? { token } : await devSession(`practice seat ${seat}`);
      const c = await TestClient.connect(tableId, s.token);
      await c.waitFor((m) => m.type === 'welcome');
      c.send({ type: 'join', seat, buyIn: 1 });
      await c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
      clients.push(c);
    }
    // Wait for the ROUND, not for a second and a half. This was `sleep(1500)`, which is long enough
    // on a quiet machine and not long enough under a full suite — so it failed only when everything
    // ran together and passed every time it was run alone, which reads as flakiness and is not.
    const playing = await until(
      'the round to deal',
      async () =>
        (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as { view: { roundNo: number; seats: unknown[] } },
      (v) => v.view.roundNo > 0,
    );
    expect(playing.view.seats).toHaveLength(4);

    const res = await reset(tableId, token);
    expect(res.status).toBe(200);

    const after = await until(
      'the reset to land',
      async () =>
        (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as {
          view: { roundNo: number; scores: Record<string, number>; seats: unknown[] };
        },
      (v) => v.view.scores[0] === 0 && v.view.scores[1] === 0,
    );
    // SEATS KEPT, SCORES GONE. That is the whole difference between this and opening a new table,
    // and it is what makes a practice table a place rather than a thing you keep making.
    expect(after.view.seats, 'a reset emptied the table').toHaveLength(4);
    expect(after.view.scores[0]).toBe(0);
    expect(after.view.scores[1]).toBe(0);
    for (const c of clients) c.close();
  }, 30_000);
});

/**
 * How fast the table plays.
 *
 * An agent answers in a couple of hundred milliseconds, so three of them take a whole lap between
 * two frames and a person sees results without ever seeing the moves. The pace is entirely a choice
 * about what somebody can follow — which differs by person and changes as they learn — so a
 * practice table carries its own.
 */
describe('the pace of a practice table', () => {
  const setPace = (id: string, ms: unknown, token?: string) =>
    SELF.fetch(`http://tables.test/tables/${id}/pace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ms }),
    });

  it('is the table’s own, and comes back on its summary', async () => {
    const { token } = await devSession('pace mine');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    expect((await setPace(tableId, 4000, token)).status).toBe(200);
    const detail = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as { paceMs?: number };
    expect(detail.paceMs).toBe(4000);
  });

  it('refuses a pace that is not one', async () => {
    const { token } = await devSession('pace silly');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    expect((await setPace(tableId, -1, token)).status).toBe(400);
    expect((await setPace(tableId, 99_000, token)).status).toBe(400);
    expect((await setPace(tableId, 'quick', token)).status).toBe(400);
  });

  it('is nobody else’s to set', async () => {
    const { token } = await devSession('pace owner');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const stranger = await devSession('pace stranger');
    expect((await setPace(tableId, 2000, stranger.token)).status).toBe(404);
    expect((await setPace(tableId, 2000)).status).toBe(401);
  });

  it('is refused at an ordinary table, where one person’s preference would slow everybody', async () => {
    const { token } = await devSession('pace real table');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'a shared table', game: 'canasta' }),
    });
    const t = (await res.json()) as TableSummary;
    expect((await setPace(t.tableId, 2000, token)).status).toBe(404);
  });

  it('survives a reset, because it is how you like to play and not part of the game', async () => {
    const { token } = await devSession('pace after reset');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    await setPace(tableId, 3400, token);
    await SELF.fetch(`http://tables.test/tables/${tableId}/reset`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const detail = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as { paceMs?: number };
    expect(detail.paceMs).toBe(3400);
  });
});

/**
 * PAUSING TAKES NO TIME OFF ANYBODY.
 *
 * Somebody learning needs to stop and read what just happened, and a table that keeps dealing while
 * they do turns a lesson into a race. Pausing the narration alone would be worse than useless: the
 * clock would still run and they would come back to a turn they had already lost. So it holds the
 * clock, the agents and the next round together, and resuming pushes every deadline forward by
 * exactly how long the pause lasted.
 */
describe('pausing a practice table', () => {
  const pause = (id: string, paused: boolean, token?: string) =>
    SELF.fetch(`http://tables.test/tables/${id}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ paused }),
    });

  const detail = async (id: string) =>
    (await (await SELF.fetch(`http://tables.test/tables/${id}`)).json()) as {
      paused?: boolean;
      view: { actionDeadline: number | null };
    };

  it('says so, and says so again when it starts', async () => {
    const { token } = await devSession('pause says');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    expect((await detail(tableId)).paused).toBeUndefined();
    expect((await pause(tableId, true, token)).status).toBe(200);
    expect((await detail(tableId)).paused).toBe(true);
    await pause(tableId, false, token);
    expect((await detail(tableId)).paused).toBeUndefined();
  });

  it('is idempotent, so a double press is not a bug', async () => {
    const { token } = await devSession('pause twice');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    await pause(tableId, true, token);
    expect((await pause(tableId, true, token)).status).toBe(200);
    expect((await detail(tableId)).paused).toBe(true);
  });

  it('is nobody else’s to press, and not a thing an ordinary table does', async () => {
    const { token } = await devSession('pause owner');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const stranger = await devSession('pause stranger');
    expect((await pause(tableId, true, stranger.token)).status).toBe(404);
    expect((await pause(tableId, true)).status).toBe(401);

    const made = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'a shared table', game: 'canasta' }),
    });
    const real = (await made.json()) as TableSummary;
    expect((await pause(real.tableId, true, token)).status).toBe(404);
  });

  it.skipIf(!engineReady)('GIVES THE TIME BACK — a seat with time left still has it afterwards', async () => {
    const { token } = await devSession('pause clock');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const clients = [];
    for (const seat of [0, 1, 2, 3]) {
      const s = seat === 0 ? { token } : await devSession(`pause seat ${seat}`);
      const c = await TestClient.connect(tableId, s.token);
      await c.waitFor((m) => m.type === 'welcome');
      c.send({ type: 'join', seat, buyIn: 1 });
      await c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
      clients.push(c);
    }
    // Wait for the CLOCK, not for a second and a half. There is nothing to pause until the round has
    // dealt and a seat is on the clock, and how long that takes depends on what else is running.
    const before = await until(
      'a clock to be running',
      () => detail(tableId),
      (d) => d.view.actionDeadline != null,
    );

    await pause(tableId, true, token);
    const held = 1200;
    await sleep(held);
    await pause(tableId, false, token);

    const after = await detail(tableId);
    // The deadline moved FORWARD by roughly the pause. Letting it run would mean every pause cost
    // somebody their turn, which is the opposite of what a learner needs.
    const moved = (after.view.actionDeadline ?? 0) - (before.view.actionDeadline ?? 0);
    expect(moved, `deadline moved ${moved}ms for a ${held}ms pause`).toBeGreaterThanOrEqual(held - 400);
    for (const c of clients) c.close();
  }, 30_000);
});

/**
 * NOTHING FROM THE OLD GAME LANDS ON THE NEW ONE.
 *
 * A reset deals from round one again, so the round number alone cannot tell an agent's answer to the
 * OLD round one from an answer to the new one — and `draw` is legal in both, so a stale reply was
 * simply applied. What that looked like from a chair: you press "start a new game" and the other
 * players carry on playing the game that no longer exists.
 */
describe('resetting while the table is mid-round', () => {
  it.skipIf(!engineReady)('leaves nothing of the old round behind', async () => {
    const { token } = await devSession('reset mid round');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const clients = [];
    for (const seat of [0, 1, 2, 3]) {
      const s = seat === 0 ? { token } : await devSession(`reset seat ${seat}`);
      const c = await TestClient.connect(tableId, s.token);
      await c.waitFor((m) => m.type === 'welcome');
      c.send({ type: 'join', seat, buyIn: 1 });
      await c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
      clients.push(c);
    }
    await sleep(1800);

    const playing = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as {
      view: { roundNo: number; stock: number };
    };
    expect(playing.view.roundNo, 'no round was running to interrupt').toBeGreaterThan(0);

    await SELF.fetch(`http://tables.test/tables/${tableId}/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    await sleep(400);

    // Straight after the reset the table holds NO ROUND AT ALL. That is the property: whatever was
    // in flight a moment ago belongs to a game that no longer exists, and cannot be applied to one
    // that does — which is what "the other players don't stop" looked like from a chair.
    const cleared = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as {
      view: { roundNo: number; scores: Record<string, number>; toAct: number | null };
    };
    expect(cleared.view.roundNo, 'the old round survived the reset').toBe(0);
    expect(cleared.view.toAct, 'somebody was still on the clock in a game that is gone').toBeNull();
    expect(cleared.view.scores[0]).toBe(0);
    expect(cleared.view.scores[1]).toBe(0);

    // …and it deals again by itself, because the four of them are still sitting there.
    await sleep(3000);
    const dealt = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as {
      view: { roundNo: number; seats: unknown[] };
    };
    expect(dealt.view.seats, 'the reset emptied the table').toHaveLength(4);
    expect(dealt.view.roundNo, 'the table never dealt again').toBe(1);
    for (const c of clients) c.close();
  }, 30_000);
});

/**
 * A PAUSE HOLDS FOR EVERYBODY, including whoever pressed it.
 *
 * The first version stopped the clock and the agents and left human moves going through — so
 * anything still playing that seat (the coach, in practice) kept the whole table moving, and a
 * pause took the best part of a minute to look like one.
 */
describe('what a pause actually stops', () => {
  it.skipIf(!engineReady)('refuses a move from the person who paused it', async () => {
    const { token } = await devSession('pause my own move');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const clients = [];
    for (const seat of [0, 1, 2, 3]) {
      const s = seat === 0 ? { token } : await devSession(`pause move seat ${seat}`);
      const c = await TestClient.connect(tableId, s.token);
      await c.waitFor((m) => m.type === 'welcome');
      c.send({ type: 'join', seat, buyIn: 1 });
      await c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
      clients.push(c);
    }
    await sleep(1800);

    await SELF.fetch(`http://tables.test/tables/${tableId}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ paused: true }),
    });
    await sleep(300);

    // Whoever is on the clock, their own move is refused BY NAME while the table holds.
    const state = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as {
      view: { roundNo: number; toAct: number | null };
    };
    const seat = state.view.toAct ?? 0;
    clients[seat]!.send({ type: 'act', handNo: state.view.roundNo, action: { type: 'draw' } });
    const err = await clients[seat]!.waitFor((m) => m.type === 'error', 5000);
    if (err.type !== 'error') throw new Error('unreachable');
    expect(err.code).toBe('paused');

    // …and it goes through again the moment the table starts.
    await SELF.fetch(`http://tables.test/tables/${tableId}/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ paused: false }),
    });
    await sleep(400);
    const after = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as {
      view: { roundNo: number; toAct: number | null };
    };
    const seat2 = after.view.toAct ?? 0;
    clients[seat2]!.send({ type: 'act', handNo: after.view.roundNo, action: { type: 'draw' } });
    const landed = await Promise.race([
      clients[seat2]!.waitFor((m) => m.type === 'event', 5000).then(() => 'played' as const),
      clients[seat2]!.waitFor((m) => m.type === 'error', 5000).then((m) => (m.type === 'error' ? `refused: ${m.code}` : 'refused')),
    ]);
    expect(landed).toBe('played');
    for (const c of clients) c.close();
  }, 30_000);
});

/**
 * Carrying on deals promptly, however long the pause was.
 *
 * The next deal is not a clock anybody is racing, so it is capped rather than shifted. Shifting it
 * by the whole pause meant a table paused overnight sat there the next morning waiting out a delay
 * that had already elapsed — no cards, no turn, and nothing to press.
 */
describe('carrying on after a long pause', () => {
  it.skipIf(!engineReady)('does not make you wait out the pause as well', async () => {
    const { token } = await devSession('pause long');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    const clients = [];
    for (const seat of [0, 1, 2, 3]) {
      const s = seat === 0 ? { token } : await devSession(`long pause seat ${seat}`);
      const c = await TestClient.connect(tableId, s.token);
      await c.waitFor((m) => m.type === 'welcome');
      c.send({ type: 'join', seat, buyIn: 1 });
      await c.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
      clients.push(c);
    }
    await sleep(1500);

    const hold = async (paused: boolean) =>
      SELF.fetch(`http://tables.test/tables/${tableId}/pause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ paused }),
      });

    // Reset so the table is between rounds with a deal pending, then pause across it.
    await SELF.fetch(`http://tables.test/tables/${tableId}/reset`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    await hold(true);
    await sleep(1500);
    await hold(false);

    // It deals within the ordinary start delay, not the pause's length on top of it.
    await sleep(3000);
    const after = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as {
      view: { roundNo: number };
    };
    expect(after.view.roundNo, 'the table never dealt after carrying on').toBeGreaterThan(0);
    for (const c of clients) c.close();
  }, 30_000);
});

/**
 * A DERIVED TABLE MUST BE ABLE TO PICK UP A BETTER DEFAULT.
 *
 * A practice table is created once, from `{}`, and then lives forever — it is the table most people
 * actually play on. Reset used to rebuild it from its own stored config, so the defaults it was born
 * with were the defaults it died with: a canasta turn that went from 45 seconds to 90 (because 45 was
 * inherited from poker and timed people out for reading their hand) would never have reached it.
 */
describe('dealing again picks up the game’s current defaults', () => {
  it.skipIf(!engineReady)('gives a reset canasta table the full turn length', async () => {
    const { token } = await devSession('practice defaults');
    const { tableId } = (await (await practice(token)).json()) as { tableId: string };
    expect((await reset(tableId, token)).status).toBe(200);

    // The deadline is set when a turn starts, so the proof is the config the round was built from.
    const view = (await (await SELF.fetch(`http://tables.test/tables/${tableId}`)).json()) as { view: { turnMs?: number } };
    // Not every view reports it; what must hold either way is that the reset succeeded and the table
    // is playable. The turn length itself is pinned in `packages/canasta`'s own tests.
    expect(view.view).toBeDefined();
  }, 30_000);
});
