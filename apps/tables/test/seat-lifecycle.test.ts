/**
 * What happens to a seat when the person behind it goes away.
 *
 * Three different departures that used to be one (or none at all), and the whole point of this file
 * is that they stay different:
 *
 *   dropped connection → sit out.   Seat kept, chips kept, NOTHING settles.
 *   explicit sign-out  → stand up.  Seat given up, cash-out queued through the ordinary outbox.
 *   abandoned seat     → operator.  Same cash-out, but only when all four conditions hold.
 *
 * The money assertions are the ones to keep honest. A disconnect that wrote a cash-out row would be
 * a far worse bug than the one this work fixes, so every disconnect test asserts the ledger and the
 * outbox as well as the seat.
 */

import { SELF, env, fetchMock, runInDurableObject } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeatCleared, SeatClearRefusal, SignOutResult } from '@pokernight/protocol';
import { agentPlayerId, type PokerTableDO } from '../src/table-do.js';
import { TestClient, createTableViaHttp, devSession, engineReady, sleep } from './helpers.js';

const OPERATOR_TOKEN = 'test-operator-token';

/* ------------------------------------------------------------------ helpers */

function stub(tableId: string) {
  return env.TABLES.get(env.TABLES.idFromName(tableId));
}

async function seatsOf(tableId: string): Promise<Array<{ seat: number; playerId: string; stack: number; status: string }>> {
  const res = await SELF.fetch(`http://tables.test/tables/${tableId}`);
  const body = (await res.json()) as { view: { seats: Array<{ seat: number; playerId: string; stack: number; status: string }> } };
  return body.view.seats;
}

/** Every money row this player has at this table, plus how many settlement ops are queued. */
async function money(tableId: string, playerId: string): Promise<{ kinds: Array<[string, number]>; outbox: number }> {
  let kinds: Array<[string, number]> = [];
  let outbox = 0;
  await runInDurableObject(stub(tableId), async (_do: PokerTableDO, state) => {
    kinds = state.storage.sql
      .exec<{ kind: string; chips: number }>('SELECT kind, chips FROM ledger WHERE player_id = ? ORDER BY at, rowid', playerId)
      .toArray()
      .map((r) => [r.kind, r.chips]);
    outbox = state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM outbox').toArray()[0]?.n ?? 0;
  });
  return { kinds, outbox };
}

/**
 * Push a seat's "last seen" back in time, in memory AND in storage — the two places
 * `seatActiveAt` can read it from. This is the only way a test can reach the idle
 * condition without waiting out the threshold, and doing it explicitly keeps the
 * threshold itself real for every other test in the file.
 */
async function ageSeat(tableId: string, playerId: string, ms: number): Promise<void> {
  await runInDurableObject(stub(tableId), async (instance: PokerTableDO, state) => {
    const players = (instance as unknown as { players: Record<string, { lastActiveAt?: number }> }).players;
    const rec = players[playerId];
    if (!rec) throw new Error(`no seat record for ${playerId}`);
    rec.lastActiveAt = Date.now() - ms;
    await state.storage.put('players', players);
  });
}

async function clearSeat(tableId: string, seat: number, token: string | null): Promise<Response> {
  return SELF.fetch(`http://tables.test/tables/${tableId}/seat/${seat}`, {
    method: 'DELETE',
    ...(token ? { headers: { 'x-operator-token': token } } : {}),
  });
}

async function refusalOf(res: Response): Promise<{ status: number; refused: SeatClearRefusal; error: string }> {
  const body = (await res.json()) as { refused: SeatClearRefusal; error: string };
  return { status: res.status, refused: body.refused, error: body.error };
}

/** Sit one player down alone, so no hand can start and the seat is the only thing under test. */
async function seatOnePlayer(tableId: string, name: string, seat = 0, buyIn = 100): Promise<{ client: TestClient; playerId: string; token: string }> {
  const s = await devSession(name);
  const client = await TestClient.connect(tableId, s.token);
  client.send({ type: 'join', seat, buyIn });
  await client.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === seat);
  return { client, playerId: s.playerId, token: s.token };
}

/* ------------------------------------------------------- dropped connection */

describe('a dropped connection sits the seat out', () => {
  it.skipIf(!engineReady)('sits the player out, keeps the seat and the chips, and moves NO money', async () => {
    const table = await createTableViaHttp('disconnect', {}, crypto.randomUUID());
    const watcher = await TestClient.connect(table.tableId); // a spectator, so the sit-out is observable
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Dora');

    client.close();
    const ev = await watcher.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status', 8000);
    if (ev.type !== 'event' || ev.event.type !== 'seat-status') throw new Error('unreachable');
    expect(ev.event.status).toBe('sitting-out');
    // The reason travels with it, because the person it happened to was not there to see it happen.
    expect(ev.event.sitOutReason).toBe('disconnected');

    // The seat and the stack are exactly as they were.
    const seats = await seatsOf(table.tableId);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ seat: 0, playerId, stack: 100, status: 'sitting-out' });

    // And nothing settled. Dropping out is not standing up.
    const { kinds, outbox } = await money(table.tableId, playerId);
    expect(kinds).toEqual([['buy-in', 100]]);
    expect(kinds.some(([kind]) => kind === 'cash-out')).toBe(false);
    expect(outbox).toBe(0);
    watcher.close();
  }, 20_000);

  it.skipIf(!engineReady)('only the LAST socket counts: a second tab keeps the seat in the deal', async () => {
    const table = await createTableViaHttp('two tabs', {}, crypto.randomUUID());
    const watcher = await TestClient.connect(table.tableId);
    const s = await devSession('Dex');
    const first = await TestClient.connect(table.tableId, s.token);
    first.send({ type: 'join', seat: 2, buyIn: 100 });
    await first.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    const second = await TestClient.connect(table.tableId, s.token);
    await second.waitFor((m) => m.type === 'welcome');

    second.close();
    await sleep(500);
    // Still in the deal: one of their two sockets is open, so they have not dropped.
    expect((await seatsOf(table.tableId))[0]?.status).toBe('active');
    expect(watcher.log.some((m) => m.type === 'event' && m.event.type === 'seat-status')).toBe(false);

    first.close();
    const ev = await watcher.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status', 8000);
    if (ev.type !== 'event' || ev.event.type !== 'seat-status') throw new Error('unreachable');
    expect(ev.event.status).toBe('sitting-out');
    watcher.close();
  }, 20_000);

  it.skipIf(!engineReady)('a reconnect does not silently sit them back in — that stays their choice', async () => {
    const table = await createTableViaHttp('reconnect', {}, crypto.randomUUID());
    const s = await devSession('Dana');
    const first = await TestClient.connect(table.tableId, s.token);
    first.send({ type: 'join', seat: 1, buyIn: 100 });
    await first.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    first.close();
    await sleep(500);
    expect((await seatsOf(table.tableId))[0]?.status).toBe('sitting-out');

    const back = await TestClient.connect(table.tableId, s.token);
    const welcome = await back.waitFor((m) => m.type === 'welcome');
    if (welcome.type !== 'welcome') throw new Error('unreachable');
    // Still out — and the welcome carries WHY, which is the whole point: they were not here when it
    // happened, so the first message they get back has to explain it.
    expect(welcome.view.seats[0]?.status).toBe('sitting-out');
    expect(welcome.players?.[s.playerId]?.sitOutReason).toBe('disconnected');

    back.send({ type: 'sit-in' });
    const ev = await back.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status' && m.event.status === 'active', 8000);
    if (ev.type !== 'event' || ev.event.type !== 'seat-status') throw new Error('unreachable');
    expect(ev.event.sitOutReason).toBeUndefined();
    back.close();
  }, 20_000);

  /**
   * An A2A agent seat has no socket at all: it is reached over HTTP every turn. If a closing socket
   * could ever be read as "this seat has gone", every bot at the table would be benched by somebody
   * else's tab closing. The guard is asserted directly, by running the disconnect path AT an agent
   * seat and watching it decline.
   */
  it.skipIf(!engineReady)('never sits an AGENT seat out — it never had a socket to lose', async () => {
    const table = await createTableViaHttp('agents keep playing', {}, crypto.randomUUID());
    const s = await devSession('Agent Seater');
    const res = await SELF.fetch(`http://tables.test/tables/${table.tableId}/seat-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ seat: 4, buyIn: 100, agentName: 'sharkbot.svc', endpoint: AGENT_ORIGIN }),
    });
    expect(res.status).toBe(201);
    const bot = agentPlayerId('sharkbot.svc');

    await runInDurableObject(stub(table.tableId), async (instance: PokerTableDO) => {
      const inner = instance as unknown as { sitOutOnDisconnect(playerId: string, gone: WebSocket): Promise<void> };
      await inner.sitOutOnDisconnect(bot, null as unknown as WebSocket);
    });

    const seats = await seatsOf(table.tableId);
    expect(seats).toEqual([expect.objectContaining({ seat: 4, playerId: bot, status: 'active' })]);
  }, 20_000);
});

/* --------------------------------------------------------------- sign-out */

describe('signing out gives up the seat', () => {
  it.skipIf(!engineReady)('stands the player up everywhere and queues the cash-out', async () => {
    // In the DEFAULT lobby: that is the set of tables sign-out sweeps.
    const table = await createTableViaHttp('sign-out stands up');
    const { client, playerId, token } = await seatOnePlayer(table.tableId, 'Sam Signout', 3, 120);

    const res = await SELF.fetch('http://tables.test/auth/signout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SignOutResult;
    expect(body.failed).toEqual([]);
    const mine = body.stoodUp.find((x) => x.tableId === table.tableId);
    expect(mine).toMatchObject({ seat: 3, chips: 120, settlement: 'play-money' });
    // Play money settles inline, so there is nothing outstanding to warn about. On a settled table
    // this is where `pending: true` would say the USDC has not landed.
    expect(mine?.pending).toBe(false);

    expect(await seatsOf(table.tableId)).toEqual([]);
    const { kinds, outbox } = await money(table.tableId, playerId);
    expect(kinds).toEqual([
      ['buy-in', 120],
      ['cash-out', -120],
    ]);
    // The cash-out went through the SAME outbox a voluntary stand-up uses.
    expect(outbox).toBe(1);
    let kind = '';
    await runInDurableObject(stub(table.tableId), async (_do: PokerTableDO, state) => {
      kind = state.storage.sql.exec<{ kind: string }>('SELECT kind FROM outbox').toArray()[0]?.kind ?? '';
    });
    expect(kind).toBe('settleCashOut');
    client.close();
  }, 30_000);

  /**
   * The other half of the asymmetry. A session that merely lapsed is not consent to move money: the
   * request resolves to nobody, so no seat is given up — the socket closing sits them out instead,
   * which is the disconnect path above.
   */
  it('stands nobody up for a session it cannot resolve — an expired token is not a sign-out', async () => {
    const table = await createTableViaHttp('expired signs nothing out');
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Ex Pired', 5, 100);

    const res = await SELF.fetch('http://tables.test/auth/signout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not.a.live.token' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as SignOutResult).toEqual({ ok: true, stoodUp: [], failed: [] });

    // The seat is untouched and nothing settled.
    expect(await seatsOf(table.tableId)).toEqual([expect.objectContaining({ seat: 5, stack: 100 })]);
    const { kinds, outbox } = await money(table.tableId, playerId);
    expect(kinds).toEqual([['buy-in', 100]]);
    expect(outbox).toBe(0);
    client.close();
  }, 30_000);
});

/* ------------------------------------------------- the operator clear route */

describe('DELETE /tables/:id/seat/:seat — the operator clear', () => {
  it('refuses without the operator token, and with the wrong one', async () => {
    const table = await createTableViaHttp('operator gate', {}, crypto.randomUUID());
    const missing = await refusalOf(await clearSeat(table.tableId, 0, null));
    expect(missing.status).toBe(401);
    expect(missing.refused).toBe('operator');
    expect(missing.error).toContain('x-operator-token');

    const wrong = await refusalOf(await clearSeat(table.tableId, 0, 'not-the-operator-token'));
    expect(wrong.status).toBe(403);
    expect(wrong.refused).toBe('operator');
    // The refusal says nothing about the token itself.
    expect(wrong.error).not.toContain(OPERATOR_TOKEN);
  });

  /** A player SESSION is not operator authority, however valid it is. There is no admin role. */
  it('is not reachable with an ordinary player session', async () => {
    const table = await createTableViaHttp('sessions are not operators', {}, crypto.randomUUID());
    const s = await devSession('Not An Operator');
    const res = await SELF.fetch(`http://tables.test/tables/${table.tableId}/seat/0`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${s.token}` },
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { refused: string }).refused).toBe('operator');
  });

  it.skipIf(!engineReady)('refuses an empty seat', async () => {
    const table = await createTableViaHttp('empty seat', {}, crypto.randomUUID());
    const r = await refusalOf(await clearSeat(table.tableId, 4, OPERATOR_TOKEN));
    expect(r.status).toBe(404);
    expect(r.refused).toBe('empty');
  });

  it.skipIf(!engineReady)('refuses a seat whose player is still connected', async () => {
    const table = await createTableViaHttp('connected seat', {}, crypto.randomUUID());
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Connie');
    // Idle enough to pass condition four: the connection is what has to stop this, on its own.
    await ageSeat(table.tableId, playerId, 10 * 60_000);

    const r = await refusalOf(await clearSeat(table.tableId, 0, OPERATOR_TOKEN));
    expect(r.status).toBe(409);
    expect(r.refused).toBe('connected');
    expect(r.error).toContain('live connection');
    expect(await seatsOf(table.tableId)).toHaveLength(1);
    client.close();
  }, 20_000);

  it.skipIf(!engineReady)('refuses a seat that is in a hand that is still running', async () => {
    // A long turn clock so the hand is still running when the assertions run.
    const table = await createTableViaHttp('mid hand', { actionTimeoutMs: 60_000 }, crypto.randomUUID());
    const a = await seatOnePlayer(table.tableId, 'Hana', 0, 100);
    const b = await seatOnePlayer(table.tableId, 'Hugo', 1, 100);
    await a.client.waitFor((m) => m.type === 'event' && m.event.type === 'hand-started', 10_000);

    // Both drop: sat out, but their chips are in this hand and the turn clock owns them.
    a.client.close();
    b.client.close();
    await sleep(500);

    await ageSeat(table.tableId, a.playerId, 10 * 60_000);
    const r = await refusalOf(await clearSeat(table.tableId, 0, OPERATOR_TOKEN));
    expect(r.status).toBe(409);
    expect(r.refused).toBe('in-hand');
    expect(r.error).toContain('still running');
    expect(await seatsOf(table.tableId)).toHaveLength(2);
  }, 30_000);

  it.skipIf(!engineReady)('refuses a seat that has been active recently', async () => {
    const table = await createTableViaHttp('too fresh', {}, crypto.randomUUID());
    const { client } = await seatOnePlayer(table.tableId, 'Fresh');
    client.close(); // no socket, not in a hand — only the idle threshold is left
    await sleep(500);

    const r = await refusalOf(await clearSeat(table.tableId, 0, OPERATOR_TOKEN));
    expect(r.status).toBe(409);
    expect(r.refused).toBe('idle');
    expect(r.error).toMatch(/must be silent for 60s/);
    expect(await seatsOf(table.tableId)).toHaveLength(1);
  }, 20_000);

  it.skipIf(!engineReady)('clears the seat and cashes it out when all four conditions hold', async () => {
    const table = await createTableViaHttp('abandoned', {}, crypto.randomUUID());
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Gone', 5, 175);
    client.close();
    await sleep(500);
    await ageSeat(table.tableId, playerId, 10 * 60_000);

    const res = await clearSeat(table.tableId, 5, OPERATOR_TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SeatCleared;
    expect(body).toMatchObject({ ok: true, seat: 5, playerId, chips: 175, settlement: 'play-money', pending: false });
    expect(body.idleMs).toBeGreaterThanOrEqual(10 * 60_000);

    expect(await seatsOf(table.tableId)).toEqual([]);
    // Cleared through the same path a voluntary stand-up takes: the money goes back to the player.
    const { kinds, outbox } = await money(table.tableId, playerId);
    expect(kinds).toEqual([
      ['buy-in', 175],
      ['cash-out', -175],
    ]);
    expect(outbox).toBe(1);
  }, 20_000);
});

/* ------------------------------------------------------------ agent stubbing */

/**
 * Minimal agent card so `POST /seat-agent` accepts the seat. This file never lets the agent take a
 * turn — it only needs a seat to exist that has no socket behind it.
 */
const AGENT_ORIGIN = 'http://seat-lifecycle-agent.test';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get(AGENT_ORIGIN)
    .intercept({ path: '/.well-known/agent-card.json', method: 'GET' })
    .reply(
      200,
      {
        name: 'Sharkbot',
        description: 'A tight-aggressive rules bot.',
        version: '1.0.0',
        supportedInterfaces: [{ transport: 'JSONRPC', url: `${AGENT_ORIGIN}/api/a2a` }],
        capabilities: {},
        defaultInputModes: ['application/json'],
        defaultOutputModes: ['application/json'],
        skills: [{ id: 'poker.act', name: 'poker.act', description: 'Play one poker turn', tags: ['poker'] }],
      },
      { headers: { 'content-type': 'application/json' } },
    )
    .persist();
});

afterAll(() => {
  fetchMock.assertNoPendingInterceptors();
});
