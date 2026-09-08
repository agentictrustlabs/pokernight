import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { TableSummary } from '@pokernight/protocol';
import { createTableViaHttp, devSession, engineReady } from './helpers.js';

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

  it('POST /dev/session mints a verifiable session (DEV_AUTH=true)', async () => {
    const s = await devSession('Alice Smith');
    expect(s.playerId).toBe('dev:alice-smith');
    expect(s.name).toBe('Alice Smith');
    expect(s.token.split('.')).toHaveLength(2);
    const bad = await SELF.fetch('http://tables.test/dev/session', { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);
  });

  it('GET /tables lists nothing on a fresh lobby', async () => {
    const res = await SELF.fetch(`http://tables.test/tables?circle=${crypto.randomUUID()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('rejects a malformed create request', async () => {
    const res = await SELF.fetch('http://tables.test/tables', { method: 'POST', body: JSON.stringify({ config: { seats: 1 } }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown table', async () => {
    const res = await SELF.fetch('http://tables.test/tables/nope');
    expect(res.status).toBe(404);
  });

  // Needs engine.createTable / viewFor.
  it.skipIf(!engineReady)('creates a table, lists it and serves the spectator view', async () => {
    const circle = crypto.randomUUID();
    const created = await createTableViaHttp('Friday night', { smallBlind: 5, bigBlind: 10 }, circle);
    expect(created.name).toBe('Friday night');
    expect(created.config.bigBlind).toBe(10);
    expect(created.settlement).toBe('play-money');
    expect(created.seated).toBe(0);

    const list = (await (await SELF.fetch(`http://tables.test/tables?circle=${circle}`)).json()) as TableSummary[];
    expect(list.map((t) => t.tableId)).toEqual([created.tableId]);

    const view = (await (await SELF.fetch(`http://tables.test/tables/${created.tableId}`)).json()) as { tableId: string; view: { seats: unknown[]; hand: unknown } };
    expect(view.tableId).toBe(created.tableId);
    expect(view.view.hand).toBeNull();

    const hand = await SELF.fetch(`http://tables.test/tables/${created.tableId}/hands/1`);
    expect(hand.status).toBe(404);
  });
});
