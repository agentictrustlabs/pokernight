/**
 * The treasury routes, against the DEV configuration (no ASSET, no chain).
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
import { createTableViaHttp, devSession, engineReady } from './helpers.js';

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
    // Dev config has no ASSET, so the answer is a sentence naming it — not a 500.
    expect(body.unavailable).toMatch(/ASSET/);
    expect(body.chosen).toBeNull();
    expect(body.candidates).toEqual([]);
  });
});

describe('POST /treasury/select', () => {
  it('rejects anything that is not a 20-byte address, quoting what it was given', async () => {
    const s = await devSession('Treasury Picker');
    const res = await post('/treasury/select', { address: 'my-wallet' }, s.token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/"my-wallet" is not a 20-byte address/);
  });

  it('refuses when the deployment cannot reach a chain to check custody, naming the gap', async () => {
    const s = await devSession('Treasury Picker Two');
    const res = await post('/treasury/select', { address: '0x' + 'ab'.repeat(20) }, s.token);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/ASSET/);
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
    const res = await post('/tables', { name: 'USDC night', settlement: 'mandate-transfer', circle: crypto.randomUUID() }, undefined);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/cannot settle in USDC/);
  });
});

describe('GET /tables/:id/settlement', () => {
  it('requires a session', async () => {
    expect((await get('/tables/whatever/settlement')).status).toBe(401);
  });

  it.skipIf(!engineReady)('reports this player’s money rows, and nobody else’s', async () => {
    const table = await createTableViaHttp('settlement view', {}, crypto.randomUUID());
    const s = await devSession('Ledger Reader');
    const res = await get(`/tables/${table.tableId}/settlement`, s.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tableId: string; settlement: string; entries: unknown[]; treasury: string | null };
    expect(body.tableId).toBe(table.tableId);
    expect(body.settlement).toBe('play-money');
    expect(body.entries).toEqual([]);
    expect(body.treasury).toBeNull();
  });
});
