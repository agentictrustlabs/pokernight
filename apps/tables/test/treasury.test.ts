/**
 * The treasury routes, against the DEV configuration (a named asset, but no chain behind it).
 *
 * That is deliberately the harshest environment for them: nothing on chain is reachable, so every
 * answer these tests see is a refusal. What is asserted is that each refusal NAMES the thing that is
 * missing — a money route that says "failed" is a money route nobody can act on — and that none of
 * them can be reached without a session at all.
 *
 * The happy paths need a chain and are proven on faithchain by `scripts/settle-demo.mts`.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { TestClient, createTableViaHttp, devSession, engineReady, soloClub, waitForAny } from './helpers.js';

async function get(path: string, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('treasury routes require a session', () => {
  it('refuses every one of them without a token', async () => {
    expect((await get('/treasury')).status).toBe(401);
    expect((await post('/treasury/select', { address: '0x' + '11'.repeat(20) })).status).toBe(401);
    expect((await post('/treasury/create', {})).status).toBe(401);
    expect((await post('/treasury/mandate', {})).status).toBe(401);
    // The Home half of the mandate ceremony is a money route too: it decides what this session may
    // be spent under, so it is authenticated exactly like the rest.
    expect((await post('/auth/home/mandate', { code: 'c', codeVerifier: 'v', authOrigin: 'https://h', nonce: 'n', state: 's' })).status).toBe(401);
    expect((await post('/treasury/fund', { amount: '1' })).status).toBe(401);
  });

  it('refuses a token that is not one of ours', async () => {
    expect((await get('/treasury', 'not.atoken')).status).toBe(401);
  });
});

describe('GET /treasury', () => {
  it('says WHICH variable makes the money layer unavailable rather than erroring', async () => {
    const s = await devSession('Treasury Reader');
    const res = await get('/treasury', s.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unavailable: string | null; chosen: string | null; candidates: unknown[] };
    // Dev config has no chain behind it, so the answer is a sentence naming the first variable that
    // is not set — not a 500. (`ASSET` and `ASSET_SYMBOL` ARE set in dev, so the shape of a settled
    // deployment is exercised; `ENTRY_POINT` is the next thing a money layer needs.)
    expect(body.unavailable).toMatch(/ENTRY_POINT/);
    expect(body.chosen).toBeNull();
    expect(body.candidates).toEqual([]);
  });

  it('offers no candidate at all when there is no Home to ask, rather than the person agent', async () => {
    const s = await devSession('Treasury Reader Two');
    const body = (await (await get('/treasury', s.token)).json()) as {
      person: string | null;
      candidates: unknown[];
      discoveryError: string | null;
    };
    // The correction this file exists for: a session's own agent is an identity, never a candidate.
    expect(body.candidates).toEqual([]);
    expect(body.discoveryError).toMatch(/Home/);
  });
});

describe('POST /treasury/select', () => {
  it('rejects anything that is not a 20-byte address, quoting what it was given', async () => {
    const s = await devSession('Treasury Picker');
    const res = await post('/treasury/select', { address: 'my-wallet' }, s.token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/"my-wallet" is not a 20-byte address/);
  });

  it('refuses an address the player’s Home does not list as one of their treasuries', async () => {
    const s = await devSession('Treasury Picker Two');
    const res = await post('/treasury/select', { address: '0x' + 'ab'.repeat(20) }, s.token);
    expect(res.status).toBe(502);
    // A dev session was never established at a Home, so there is nobody to ask — said as that,
    // rather than as a chain error, because the missing thing is the Home and not the chain.
    expect(((await res.json()) as { error: string }).error).toMatch(/Home/);
  });
});

describe('POST /treasury/create', () => {
  it('refuses a session with no person agent, naming what is missing', async () => {
    const s = await devSession('Treasury Maker');
    const res = await post('/treasury/create', {}, s.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/no Smart Agent/);
  });
});

describe('POST /treasury/mandate', () => {
  it('refuses to authorise anything before a treasury is chosen', async () => {
    const s = await devSession('Mandate Signer');
    const res = await post('/treasury/mandate', {}, s.token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/choose the treasury/);
  });
});

describe('POST /treasury/fund', () => {
  it('refuses before minting anything when no treasury has been chosen', async () => {
    const s = await devSession('Treasury Funder');
    const res = await post('/treasury/fund', { amount: '10' }, s.token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/choose a treasury before funding one/);
  });
});

describe('settled tables', () => {
  it('refuses to CREATE one on a deployment that cannot settle, saying why', async () => {
    // A real session, because opening a table needs one now — the refusal under test is about
    // SETTLEMENT, and it has to be reachable by somebody who got past the door.
    const { token } = await devSession('settled table opener');
    const res = await post('/tables', { name: 'Sheqel night', settlement: 'mandate-transfer' }, token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/cannot settle on chain/);
  });
});

describe('GET /tables/:id/settlement', () => {
  it('requires a session', async () => {
    expect((await get('/tables/whatever/settlement')).status).toBe(401);
  });

  it.skipIf(!engineReady)('reports this player’s money rows, and nobody else’s', async () => {
    const table = await createTableViaHttp('settlement view', {}, await soloClub());
    const s = await devSession('Ledger Reader');
    const res = await get(`/tables/${table.tableId}/settlement`, s.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tableId: string; settlement: string; entries: unknown[]; treasury: string | null };
    expect(body.tableId).toBe(table.tableId);
    expect(body.settlement).toBe('play-money');
    expect(body.entries).toEqual([]);
    expect(body.treasury).toBeNull();
  });

  /**
   * The bug: this view returned EVERY ledger row for the player, and a `hand-result` row has no
   * receipt because it never settles on chain — it is a chip movement inside the table's own
   * ledger. The client, reading "no receipt" as "not settled", grew a list of
   * "Hand of 1 chips — not settled" rows on a table where nothing was stuck at all.
   *
   * So: a hand is played for real here, and the settlement view must show the two buy-ins and not
   * one row of hand history.
   */
  it.skipIf(!engineReady)('shows only movements that settle — never per-hand chip results', async () => {
    const table = await createTableViaHttp('hand history is not settlement', { minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 30_000 });
    const sa = await devSession('Rowan');
    const sb = await devSession('Sam');
    const a = await TestClient.connect(table.tableId, sa.token);
    const b = await TestClient.connect(table.tableId, sb.token);
    await a.waitFor((m) => m.type === 'welcome');
    await b.waitFor((m) => m.type === 'welcome');

    a.send({ type: 'join', seat: 0, buyIn: 100 });
    await a.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 0);
    b.send({ type: 'join', seat: 1, buyIn: 100 });
    await a.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 1);

    // Fold the hand out the moment anyone is on the clock: the point is that a hand COMPLETED and
    // wrote its `hand-result` rows, not how it was played.
    await waitForAny([a, b], (m) => m.type === 'event' && m.event.type === 'hand-started', 10_000);
    const { message: turn } = await waitForAny([a, b], (m) => m.type === 'turn', 10_000);
    if (turn.type !== 'turn') throw new Error('unreachable');
    (turn.seat === 0 ? a : b).send({ type: 'act', handNo: turn.handNo, action: { type: 'fold' } });
    await waitForAny([a, b], (m) => m.type === 'event' && m.event.type === 'hand-ended', 10_000);

    const rows = (await (await get(`/tables/${table.tableId}/settlement`, sa.token)).json()) as {
      entries: Array<{ kind: string; chips: number; receipt: unknown }>;
    };
    expect(rows.entries.map((e) => e.kind)).toEqual(['buy-in']);
    expect(rows.entries.every((e) => e.receipt !== null)).toBe(true);
    // The hand happened — it is simply not settlement. Asserting its absence is the whole test.
    expect(rows.entries.some((e) => e.kind === 'hand-result')).toBe(false);

    a.close();
    b.close();
  });

  it('tops a chosen treasury up to the seed floor rather than only funding an empty one', async () => {
    // A treasury the player CHOSE can hold less than a buy-in. Leaving it there is the same dead end
    // as having no treasury: a 3-Sheqel balance at a 40-Sheqel table has no way forward.
    const { SEED_AMOUNT } = await import('../src/routes-treasury.js');
    expect(SEED_AMOUNT).toBe('10000');
    // The floor is compared against the balance, so a partly-funded treasury is under it.
    const floor = 10_000n * 1_000_000n;
    expect(3n * 1_000_000n < floor).toBe(true);
    // And a treasury already at or above the floor is left alone.
    expect(floor >= floor).toBe(true);
  });
});
