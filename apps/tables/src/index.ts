/**
 * pokernight-tables Worker.
 *
 * Routes
 *   GET  /health
 *   POST /dev/session {name}            → {token, playerId, name}   (DEV_AUTH=true only)
 *   GET  /tables                        → TableSummary[]            (LobbyDO "default", or ?circle=)
 *   POST /tables CreateTableRequest     → TableSummary (201)
 *   GET  /tables/:id                    → spectator view {tableId, name, settlement, view, names}
 *   GET  /tables/:id/hands/:handNo      → stored hand record (seed reveal, actions, result once ended)
 *   GET  /tables/:id/ws?token=...       → WebSocket to the table DO (no/invalid token = spectator)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CreateTableRequestSchema, DevSessionRequestSchema } from '@pokernight/protocol';
import { mintDevSession, resolveSession } from './auth.js';
import { allowedOrigins, isDevAuth, type Env } from './env.js';

export { PokerTableDO } from './table-do.js';
export { LobbyDO } from './lobby-do.js';

const app = new Hono<{ Bindings: Env }>();

const corsMiddleware = cors({
  origin: (origin, c) => (allowedOrigins(c.env as Env).includes(origin) ? origin : null),
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization'],
  maxAge: 600,
});

// WebSocket upgrades are not CORS requests; keep the 101 response untouched.
app.use('*', (c, next) => (c.req.header('upgrade')?.toLowerCase() === 'websocket' ? next() : corsMiddleware(c, next)));

app.get('/health', (c) => c.json({ ok: true, service: 'pokernight-tables', chainId: c.env.CHAIN_ID }));

app.post('/dev/session', async (c) => {
  if (!isDevAuth(c.env)) return c.json({ error: 'dev auth disabled' }, 404);
  const parsed = DevSessionRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return c.json(await mintDevSession(c.env, parsed.data.name));
});

function lobby(env: Env, circle: string | undefined) {
  return env.LOBBIES.get(env.LOBBIES.idFromName(circle ?? 'default'));
}

function table(env: Env, tableId: string) {
  return env.TABLES.get(env.TABLES.idFromName(tableId));
}

app.get('/tables', async (c) => {
  const res = await lobby(c.env, c.req.query('circle')).fetch('https://lobby/list');
  return passthrough(res);
});

app.post('/tables', async (c) => {
  const parsed = CreateTableRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  const res = await lobby(c.env, parsed.data.circle).fetch('https://lobby/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  return passthrough(res);
});

app.get('/tables/:id', async (c) => passthrough(await table(c.env, c.req.param('id')).fetch('https://table/view')));

app.get('/tables/:id/hands/:handNo', async (c) => {
  const n = Number(c.req.param('handNo'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'bad hand number' }, 400);
  return passthrough(await table(c.env, c.req.param('id')).fetch(`https://table/hand/${n}`));
});

app.get('/tables/:id/ws', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'expected websocket upgrade' }, 426);
  const session = await resolveSession(c.env, c.req.query('token'));
  const headers = new Headers({ Upgrade: 'websocket' });
  if (session) {
    headers.set('x-player-id', session.playerId);
    headers.set('x-player-name', encodeURIComponent(session.name));
  }
  // Forward the upgrade to the DO; the 101 response (with the client socket) is returned as-is.
  return table(c.env, c.req.param('id')).fetch('https://table/ws', { headers });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal error' }, 500);
});

/** Re-wrap a DO response so hono can own the headers (CORS) without touching the body. */
function passthrough(res: Response): Response {
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}

export default app;
