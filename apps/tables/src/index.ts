/**
 * pokernight-tables Worker.
 *
 * Routes
 *   GET  /health
 *   POST /dev/session {name}            → {token, playerId, name}   (DEV_AUTH=true only)
 *   GET  /tables                        → TableSummary[]            (LobbyDO "default", or ?circle=)
 *   POST /tables CreateTableRequest     → TableSummary (201)
 *   GET  /tables/:id                    → spectator view {tableId, name, settlement, view, names}
 *   GET  /tables/:id/hands/:handNo      → stored hand record (seed reveal, actions, agent calls, result)
 *   POST /tables/:id/seat-agent SeatAgentRequest → seats an A2A agent (auth required) → PlayerInfo (201)
 *   DELETE /tables/:id/seat-agent/:seat → stands that agent up and cashes it out (auth required)
 *   GET  /tables/:id/ws?token=...       → WebSocket to the table DO (no/invalid token = spectator)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CreateTableRequestSchema, DevSessionRequestSchema, POKER_ACT_SKILL, SeatAgentRequestSchema } from '@pokernight/protocol';
import { agentKindFromCard, fetchAgentCard, hasPokerActSkill, resolveAgentBase } from './a2a.js';
import { mintDevSession, resolveSession } from './auth.js';
import { a2aTimeoutMs, allowedOrigins, isDevAuth, type Env } from './env.js';
import type { SeatAgentBody } from './table-do.js';

export { PokerTableDO } from './table-do.js';
export { LobbyDO } from './lobby-do.js';

const app = new Hono<{ Bindings: Env }>();

const corsMiddleware = cors({
  origin: (origin, c) => (allowedOrigins(c.env as Env).includes(origin) ? origin : null),
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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

/**
 * Seat an A2A agent. Requires a session (seating a bot is a table action like any other), then
 * resolves the agent, fetches its card, and refuses anything that is not reachable or does not
 * advertise `poker.act` — so a bad seat fails here rather than as a silent turn timeout later.
 */
app.post('/tables/:id/seat-agent', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = SeatAgentRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  const req = parsed.data;

  let base: string;
  try {
    base = resolveAgentBase(c.env, req.agentName, req.endpoint);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const card = await fetchAgentCard(base, a2aTimeoutMs(c.env));
  if (!card.ok) return c.json({ error: card.error }, 400);
  if (!hasPokerActSkill(card.card)) {
    return c.json({ error: `agent ${req.agentName} does not advertise the ${POKER_ACT_SKILL} skill` }, 400);
  }

  const body: SeatAgentBody = {
    seat: req.seat,
    buyIn: req.buyIn,
    agentName: req.agentName,
    endpoint: base,
    displayName: req.displayName ?? card.card.name ?? req.agentName,
    agentKind: agentKindFromCard(card.card),
  };
  const res = await table(c.env, c.req.param('id')).fetch('https://table/seat-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return passthrough(res);
});

app.delete('/tables/:id/seat-agent/:seat', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const seat = Number(c.req.param('seat'));
  if (!Number.isInteger(seat) || seat < 0 || seat > 8) return c.json({ error: 'bad seat' }, 400);
  return passthrough(await table(c.env, c.req.param('id')).fetch(`https://table/seat-agent/${seat}`, { method: 'DELETE' }));
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

/** Session token from `Authorization: Bearer <token>` or `?token=` (the WebSocket route's form). */
function sessionToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  const bearer = auth && /^bearer\s+(.+)$/i.exec(auth.trim());
  if (bearer) return bearer[1] ?? null;
  return new URL(req.url).searchParams.get('token');
}

/** Re-wrap a DO response so hono can own the headers (CORS) without touching the body. */
function passthrough(res: Response): Response {
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}

export default app;
