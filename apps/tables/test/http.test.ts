import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { TableSummary } from '@pokernight/protocol';
import { pokerConfigOf } from '@pokernight/protocol';
import { createTableViaHttp, devSession, engineReady, soloClub } from './helpers.js';

describe('HTTP API', () => {
  it('GET /health', async () => {
    const res = await SELF.fetch('http://tables.test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: 'pokernight-tables', chainId: '31337' });
  });

  it('applies CORS only for allowed origins', async () => {
    const ok = await SELF.fetch('http://tables.test/health', { headers: { Origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const no = await SELF.fetch('http://tables.test/health', { headers: { Origin: 'https://evil.example' } });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('there is no dev login any more — everyone comes through a Home', async () => {
    const s = await devSession('Alice Smith');
    expect(s.playerId).toMatch(/^home:0x[0-9a-f]{40}$/);
    expect(s.name).toBe('Alice Smith');
    expect(s.token.split('.')).toHaveLength(2);
    const gone = await SELF.fetch('http://tables.test/dev/session', { method: 'POST', body: '{"name":"x"}' });
    expect(gone.status).toBe(404);
  });

  it('GET /tables lists the PICKUP lobby to anyone, signed in or not', async () => {
    const res = await SELF.fetch('http://tables.test/tables');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  // A club nobody has standing in is indistinguishable from one that does not exist. 404, never 403
  // — a 403 would confirm that this club is real, which is a fact about other people's arrangements.
  it('GET /tables?club= says there is no such club to a stranger', async () => {
    const res = await SELF.fetch(`http://tables.test/tables?club=${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such club' });
  });

  it('opening a table now needs a session at all', async () => {
    const res = await SELF.fetch('http://tables.test/tables', { method: 'POST', body: JSON.stringify({ name: 'anon' }) });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed create request', async () => {
    const { token } = await devSession('malformed');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ config: { seats: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown table', async () => {
    const res = await SELF.fetch('http://tables.test/tables/nope');
    expect(res.status).toBe(404);
  });

  // Needs engine.createTable / viewFor.
  it.skipIf(!engineReady)('creates a table, lists it and serves the spectator view', async () => {
    const club = await soloClub('Friday night club');
    const created = await createTableViaHttp('Friday night', { smallBlind: 5, bigBlind: 10 }, club);
    expect(created.name).toBe('Friday night');
    // The GENERIC setup is on `config`; poker's own blinds ride on `gameConfig`, which only a
    // client that knows poker reads. Both are asserted because both are part of the contract.
    expect(created.config.seats).toBe(6);
    expect(pokerConfigOf(created)?.bigBlind).toBe(10);
    expect(created.settlement).toBe('play-money');
    expect(created.seated).toBe(0);
    // A pickup table: no club stamped (a club is its agent at a Home, which a test cannot charter).
    expect(created.club).toBeUndefined();

    const pickup = (await (await SELF.fetch('http://tables.test/tables')).json()) as TableSummary[];
    expect(pickup.map((t) => t.tableId)).toContain(created.tableId);

    const viewRes = await SELF.fetch(`http://tables.test/tables/${created.tableId}`, { headers: { authorization: `Bearer ${club.token}` } });
    const view = (await viewRes.json()) as { tableId: string; view: { seats: unknown[]; hand: unknown } };
    expect(view.tableId).toBe(created.tableId);
    expect(view.view.hand).toBeNull();

    const hand = await SELF.fetch(`http://tables.test/tables/${created.tableId}/hands/1`);
    expect(hand.status).toBe(404);
  });
});
