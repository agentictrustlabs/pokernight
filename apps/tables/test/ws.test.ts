import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { TestClient, createTableViaHttp, devSession, engineReady } from './helpers.js';

describe('WebSocket', () => {
  it('refuses a non-upgrade request', async () => {
    const res = await SELF.fetch('http://tables.test/tables/whatever/ws');
    expect(res.status).toBe(426);
  });

  // Needs engine.createTable / viewFor for the welcome view.
  it.skipIf(!engineReady)('spectator gets welcome, pong, and cannot send commands', async () => {
    const table = await createTableViaHttp();
    const c = await TestClient.connect(table.tableId);
    const welcome = await c.next();
    expect(welcome).toMatchObject({ type: 'welcome', tableId: table.tableId, playerId: null, names: {} });
    c.send({ type: 'ping' });
    expect(await c.next()).toMatchObject({ type: 'pong' });
    c.send({ type: 'join', seat: 0, buyIn: 100 });
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unauthenticated' });
    c.send('not json at all');
    expect(await c.next()).toMatchObject({ type: 'error', code: 'bad-command' });
    c.close();
  });

  it.skipIf(!engineReady)('authenticated client is welcomed with its playerId', async () => {
    const table = await createTableViaHttp();
    const s = await devSession('Bob');
    const c = await TestClient.connect(table.tableId, s.token);
    expect(await c.next()).toMatchObject({ type: 'welcome', playerId: 'dev:bob' });
    c.close();
  });
});
