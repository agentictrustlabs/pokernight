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
    // this is where `pending: true` would say the money has not landed.
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

/* ------------------------------------------------------------ retiring a table */

async function retireTable(tableId: string, token: string | null, circle?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test/tables/${tableId}${circle ? `?circle=${circle}` : ''}`, {
    method: 'DELETE',
    ...(token ? { headers: { 'x-operator-token': token } } : {}),
  });
}

async function lobbyIds(circle?: string): Promise<string[]> {
  const res = await SELF.fetch(`http://tables.test/tables${circle ? `?circle=${circle}` : ''}`);
  return ((await res.json()) as Array<{ tableId: string }>).map((t) => t.tableId);
}

/**
 * DELETE /tables/:id — the operator retire.
 *
 * There was no way to close a table at all, so an unplayable one stayed in the lobby forever. This
 * is that way, gated on the SAME `OPERATOR_TOKEN` mechanism as the seat clear — a separate header,
 * a constant-time compare, and nothing at all on a deployment that has set no secret.
 *
 * The one condition about the table is that nobody is sitting at it: a seated table holds somebody's
 * chips, and at a settled table those chips are their money.
 */
describe('DELETE /tables/:id — the operator retire', () => {
  it('refuses without the operator token, and never echoes it back', async () => {
    const circle = crypto.randomUUID();
    const table = await createTableViaHttp('unretired', {}, circle);

    const missing = (await (await retireTable(table.tableId, null, circle)).json()) as { error: string };
    expect(missing.error).toContain('x-operator-token');

    const res = await retireTable(table.tableId, 'not-the-token', circle);
    expect(res.status).toBe(403);
    const wrong = (await res.json()) as { error: string };
    expect(wrong.error).not.toContain(OPERATOR_TOKEN);

    // Still there: a refused retire changes nothing.
    expect(await lobbyIds(circle)).toContain(table.tableId);
  });

  it.skipIf(!engineReady)('refuses while anyone is seated, and says how many', async () => {
    const circle = crypto.randomUUID();
    const table = await createTableViaHttp('occupied', {}, circle);
    const { client } = await seatOnePlayer(table.tableId, 'Sitting', 0, 100);

    const res = await retireTable(table.tableId, OPERATOR_TOKEN, circle);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; refused: string; seated: number };
    expect(body.refused).toBe('seated');
    expect(body.seated).toBe(1);
    expect(body.error).toContain('1 player');
    expect(body.error).toContain('Stand them up first');

    client.close();
  }, 20_000);

  it('retires an empty table: gone from the lobby, and gone from the table itself', async () => {
    const circle = crypto.randomUUID();
    const doomed = await createTableViaHttp('retire me', {}, circle);
    const keep = await createTableViaHttp('keep me', {}, circle);

    const res = await SELF.fetch(`http://tables.test/tables/${doomed.tableId}?circle=${circle}`, {
      method: 'DELETE',
      headers: { 'x-operator-token': OPERATOR_TOKEN },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ retired: true, tableId: doomed.tableId, name: 'retire me' });

    const listed = ((await (await SELF.fetch(`http://tables.test/tables?circle=${circle}`)).json()) as Array<{ tableId: string }>).map((t) => t.tableId);
    expect(listed).toEqual([keep.tableId]);
    // A retired table is gone, not hidden: the spectator view has nothing to show.
    expect((await SELF.fetch(`http://tables.test/tables/${doomed.tableId}`)).status).toBe(404);
  });
});

/* ------------------------------------------------ running out of chips */

/**
 * Force a seat into the state the engine leaves a busted player in: no chips, sitting out.
 *
 * How it got there is the engine's business and the engine tests it (`stack === 0 → sitting-out` at
 * hand end). What is under test here is what the TABLE does about it, so the state is set directly
 * rather than played out over several hands.
 */
async function bust(tableId: string, playerId: string, reason: 'requested' | 'disconnected' | null = null): Promise<void> {
  await runInDurableObject(stub(tableId), async (instance: PokerTableDO, state) => {
    const inst = instance as unknown as {
      state: { seats: Array<{ seat: number; playerId: string; stack: number; status: string }> };
      players: Record<string, { sitOutReason?: string }>;
    };
    const s = inst.state.seats.find((x) => x.playerId === playerId);
    if (!s) throw new Error(`no seat for ${playerId}`);
    s.stack = 0;
    s.status = 'sitting-out';
    await state.storage.put('state', inst.state);
    const rec = inst.players[playerId];
    if (rec) {
      if (reason) rec.sitOutReason = reason;
      else delete rec.sitOutReason;
      await state.storage.put('players', inst.players);
    }
  });
}

async function seatOf(tableId: string, playerId: string): Promise<{ seat: number; stack: number; status: string } | undefined> {
  return (await seatsOf(tableId)).find((s) => s.playerId === playerId);
}

/**
 * "When one player gets out of money the game gets stuck."
 *
 * A player at zero is sat out by the engine, and the only control the table offered them was
 * "Sit in" — which sits them in with nothing, changes nothing, and gets undone at the end of the
 * next hand. The money they need has to arrive in the same press, or the press is a dead end.
 */
describe('a player who has run out of chips', () => {
  it.skipIf(!engineReady)('is dealt back in by the rebuy itself, not by a second button', async () => {
    const table = await createTableViaHttp('busted', {}, crypto.randomUUID());
    const { client, playerId, token } = await seatOnePlayer(table.tableId, 'Busted', 0, 100);
    await bust(table.tableId, playerId);
    expect(await seatOf(table.tableId, playerId)).toMatchObject({ stack: 0, status: 'sitting-out' });

    client.send({ type: 'add-chips', amount: 40 });
    await client.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status' && m.event.status === 'active');

    // Chips AND a seat that will be dealt in: one press, both halves.
    expect(await seatOf(table.tableId, playerId)).toMatchObject({ stack: 40, status: 'active' });
    // …and it settled through the ordinary money path, so the ledger says what happened.
    const { kinds } = await money(table.tableId, playerId);
    expect(kinds).toEqual([
      ['buy-in', 100],
      ['add-chips', 40],
    ]);
    // The SAME path a buy-in takes, receipt and all: a rebuy is money moving, so it is authorised
    // (`authorizeBuyIn` — the mandate cap on a settled table) and receipted like one. On a settled
    // table an unaffordable rebuy is refused by name before the chips appear, exactly as a buy-in
    // is; that half is proven against a real mandate in `@pokernight/treasury`'s adapter tests.
    const view = (await (
      await SELF.fetch(`http://tables.test/tables/${table.tableId}/settlement`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { entries: Array<{ kind: string; chips: number; receipt: unknown }> };
    const rebuy = view.entries.find((e) => e.kind === 'add-chips');
    expect(rebuy).toMatchObject({ chips: 40 });
    expect(rebuy?.receipt).not.toBeNull();
    client.close();
  }, 20_000);

  it.skipIf(!engineReady)('is refused by name when the rebuy would break the table’s cap, and stays sat out', async () => {
    const table = await createTableViaHttp('busted cap', {}, crypto.randomUUID());
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Greedy', 0, 200);

    // At the table maximum already: there is no room for a rebuy on top.
    client.send({ type: 'add-chips', amount: 10 });
    const err = await client.waitFor((m) => m.type === 'error');
    expect(err.type === 'error' && err.message).toMatch(/maxBuyIn/);
    expect(await seatOf(table.tableId, playerId)).toMatchObject({ stack: 200, status: 'active' });
    client.close();
  }, 20_000);

  /**
   * The one thing a rebuy must NOT do: undo a sit-out the player chose. Somebody who asked to sit
   * out and then tops up is topping up, not asking to be dealt in.
   */
  it.skipIf(!engineReady)('does not sit a player in who chose to sit out and still had chips', async () => {
    const table = await createTableViaHttp('deliberate', {}, crypto.randomUUID());
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Deliberate', 0, 100);
    client.send({ type: 'sit-out' });
    await client.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status' && m.event.status === 'sitting-out');

    client.send({ type: 'add-chips', amount: 40 });
    await client.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status' && m.event.stack === 140);
    expect(await seatOf(table.tableId, playerId)).toMatchObject({ stack: 140, status: 'sitting-out' });
    client.close();
  }, 20_000);
});

/**
 * Reconnecting undoes the sit-out the DROP caused — and only that one.
 *
 * A disconnect sit-out was never the player's decision: it is a guard that keeps a vanished seat
 * from bleeding blinds, and it has done its job the moment its owner is back. Two players with
 * chips left sat out after reconnecting is how a table ended up with nobody to deal to.
 */
describe('reconnecting', () => {
  it.skipIf(!engineReady)('sits a dropped player back in when they come back with chips', async () => {
    const table = await createTableViaHttp('dropped', {}, crypto.randomUUID());
    const s = await devSession('Dropper');
    const first = await TestClient.connect(table.tableId, s.token);
    first.send({ type: 'join', seat: 3, buyIn: 120 });
    await first.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 3);

    first.close();
    await sleep(600);
    expect(await seatOf(table.tableId, s.playerId)).toMatchObject({ status: 'sitting-out' });

    const again = await TestClient.connect(table.tableId, s.token);
    await sleep(600);
    expect(await seatOf(table.tableId, s.playerId)).toMatchObject({ stack: 120, status: 'active' });
    again.close();
  }, 20_000);

  it.skipIf(!engineReady)('leaves a player who ASKED to sit out exactly where they put themselves', async () => {
    const table = await createTableViaHttp('asked', {}, crypto.randomUUID());
    const s = await devSession('Asker');
    const first = await TestClient.connect(table.tableId, s.token);
    first.send({ type: 'join', seat: 4, buyIn: 120 });
    await first.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 4);
    first.send({ type: 'sit-out' });
    await first.waitFor((m) => m.type === 'event' && m.event.type === 'seat-status' && m.event.status === 'sitting-out');
    first.close();
    await sleep(600);

    const again = await TestClient.connect(table.tableId, s.token);
    await sleep(600);
    expect(await seatOf(table.tableId, s.playerId)).toMatchObject({ status: 'sitting-out' });
    again.close();
  }, 20_000);

  /** No chips means the sit-out that matters is being broke. Sitting them in would hide the rebuy. */
  it.skipIf(!engineReady)('does not sit a busted player in on reconnect, because that would change nothing', async () => {
    const table = await createTableViaHttp('dropped broke', {}, crypto.randomUUID());
    const s = await devSession('Dropped Broke');
    const first = await TestClient.connect(table.tableId, s.token);
    first.send({ type: 'join', seat: 2, buyIn: 100 });
    await first.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 2);
    first.close();
    await sleep(600);
    await bust(table.tableId, s.playerId, 'disconnected');

    const again = await TestClient.connect(table.tableId, s.token);
    await sleep(600);
    expect(await seatOf(table.tableId, s.playerId)).toMatchObject({ stack: 0, status: 'sitting-out' });
    again.close();
  }, 20_000);
});

/* --------------------------------------------------- an AGENT that runs out */

/**
 * An agent at zero chips is the same deadlock as a human at zero, with nobody to press the button.
 *
 * A bot holds no session, no treasury and no opinion, so it cannot be OFFERED a rebuy — it has to be
 * decided for it. `Friday Night` reached exactly this state: three agents on zero, one player left,
 * and a table that could no longer deal. On play money the table tops the bot back up to the minimum
 * buy-in (play chips cost nobody anything, and the house was the source of every chip on the table
 * already); on a settled table there is no account to charge, so the seat is stood up instead. This
 * is the play-money half; the settled half needs a chain and cannot be created in this environment.
 */
describe('an agent seat with no chips', () => {
  it.skipIf(!engineReady)('is topped back up to the table minimum between hands, on play money', async () => {
    const table = await createTableViaHttp('busted bot', {}, crypto.randomUUID());
    const s = await devSession('Bot Seater');
    const res = await SELF.fetch(`http://tables.test/tables/${table.tableId}/seat-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ seat: 1, buyIn: 100, agentName: 'sharkbot.svc', endpoint: AGENT_ORIGIN }),
    });
    expect(res.status).toBe(201);
    const bot = agentPlayerId('sharkbot.svc');
    await bust(table.tableId, bot);
    expect(await seatOf(table.tableId, bot)).toMatchObject({ stack: 0, status: 'sitting-out' });

    // Between hands is when this is decided, so put the table there and let the alarm run.
    await runInDurableObject(stub(table.tableId), async (instance: PokerTableDO, state) => {
      await state.storage.put('next-hand-at', Date.now() - 1);
      await instance.alarm();
    });

    // Chips again, sitting in, and a ledger row saying where they came from.
    expect(await seatOf(table.tableId, bot)).toMatchObject({ stack: 40, status: 'active' });
    const { kinds } = await money(table.tableId, bot);
    expect(kinds).toEqual([
      ['buy-in', 100],
      ['add-chips', 40],
    ]);
  }, 20_000);

  /** A human at zero is NOT topped up: their money is theirs, and they are asked. */
  it.skipIf(!engineReady)('leaves a busted HUMAN seat alone — that one is offered a rebuy instead', async () => {
    const table = await createTableViaHttp('busted human untouched', {}, crypto.randomUUID());
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Broke Human', 0, 100);
    await bust(table.tableId, playerId);

    await runInDurableObject(stub(table.tableId), async (instance: PokerTableDO, state) => {
      await state.storage.put('next-hand-at', Date.now() - 1);
      await instance.alarm();
    });

    expect(await seatOf(table.tableId, playerId)).toMatchObject({ stack: 0, status: 'sitting-out' });
    client.close();
  }, 20_000);
});

/**
 * The repair that unstuck the tables that were ALREADY stuck.
 *
 * The alarm is how a table gets from "no hand running" to "deal one", and it is scheduled by
 * whatever last committed. A table whose last commit left it unable to deal scheduled nothing, went
 * to sleep, and had no way to notice that the reason had since been fixable. So a table with seats
 * and no hand running gets exactly one between-hands tick when it loads.
 */
describe('a table that stalled between hands', () => {
  it.skipIf(!engineReady)('wakes itself up when it loads, rather than sleeping forever', async () => {
    const table = await createTableViaHttp('stalled', {}, crypto.randomUUID());
    const { client, playerId } = await seatOnePlayer(table.tableId, 'Stalled', 0, 100);
    client.close();
    await sleep(400);

    // The state a stalled table is in: seats, no hand, no pending work of any kind.
    await runInDurableObject(stub(table.tableId), async (_i: PokerTableDO, state) => {
      await state.storage.delete('next-hand-at');
      await state.storage.deleteAlarm();
      expect(await state.storage.getAlarm()).toBeNull();
    });

    // Loading it again is enough. (`runInDurableObject` reconstructs after an abort, which is what
    // a deploy does to every live table.)
    await runInDurableObject(stub(table.tableId), (_i, state) => {
      state.abort('test: evict so the table loads again');
    }).catch(() => {
      /* aborting is the point */
    });
    await SELF.fetch(`http://tables.test/tables/${table.tableId}`);

    await runInDurableObject(stub(table.tableId), async (_i: PokerTableDO, state) => {
      expect(await state.storage.get<number>('next-hand-at')).toBeGreaterThan(0);
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    expect(await seatOf(table.tableId, playerId)).toMatchObject({ stack: 100 });
  }, 20_000);
});
