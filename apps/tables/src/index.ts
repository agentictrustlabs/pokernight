/**
 * pokernight-tables Worker.
 *
 * Routes
 *   GET  /health
 *   GET  /auth/config                   → {devAuth, home:{clientId, origin, zone, delegate, redirectUri}}
 *   POST /auth/home {code, codeVerifier, authOrigin, nonce, state}
 *                                       → {token, playerId, name, agentName?, address?}  (Home OIDC)
 *   POST /auth/home/demo {idToken, delegation?, authOrigin}
 *                                       → same shape (Home quick-connect / demo users)
 *   POST /auth/signout                  → {ok} (auth required; drops the server-side session record)
 *   POST /dev/session {name}            → {token, playerId, name}   (DEV_AUTH=true only)
 *   GET  /tables                        → TableSummary[]            (LobbyDO "default", or ?circle=)
 *   POST /tables CreateTableRequest     → TableSummary (201)
 *   GET  /tables/:id                    → spectator view {tableId, name, settlement, view, names}
 *   GET  /tables/:id/hands/:handNo      → stored hand record (seed reveal, actions, agent calls, result)
 *   POST /tables/:id/seat-agent SeatAgentRequest → seats an A2A agent (auth required) → PlayerInfo (201)
 *   DELETE /tables/:id/seat-agent/:seat → stands that agent up and cashes it out (auth required)
 *   GET  /tables/:id/settlement         → this player's money rows at a table (auth required)
 *   GET  /tables/:id/ws?token=...       → WebSocket to the table DO (no/invalid token = spectator)
 *   GET  /treasury                      → chosen treasury + balance + candidates (auth required)
 *   POST /treasury/select {address}     → choose the treasury that funds play (auth required)
 *   POST /treasury/fund {amount}        → mint test USDC into it (auth required; test assets only)
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { CreateTableRequestSchema, DevSessionRequestSchema, POKER_ACT_SKILL, SeatAgentRequestSchema } from '@pokernight/protocol';
import { agentKindFromCard, fetchAgentCard, hasPokerActSkill, resolveAgentBase } from './a2a.js';
import { HOME_SESSION_TTL_MS, dropSessionRecord, mintDevSession, mintHomeSessionToken, putSessionRecord, resolveSession } from './auth.js';
import { a2aTimeoutMs, allowedOrigins, isDevAuth, type Env } from './env.js';
import { HomeAuthError, completeDemoSignIn, completeHomeSignIn, homePlayerId, homeRedirectUri, type HomeIdentity } from './home.js';
import { FundTreasurySchema, SelectTreasurySchema, fundTreasury, getTreasury, selectTreasury } from './routes-treasury.js';
import type { SessionRecord } from './session-do.js';
import type { SeatAgentBody } from './table-do.js';

export { PokerTableDO } from './table-do.js';
export { LobbyDO } from './lobby-do.js';
export { SessionDO } from './session-do.js';

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

/**
 * What the client needs to draw the sign-in screen, so the SPA does not need a build-time flag: on
 * localhost `devAuth` is true and the dev name box appears; in production only Home sign-in does.
 * Everything here is public (the same values the Home publishes at /connect/client-info).
 */
app.get('/auth/config', (c) => {
  let redirectUri: string | null = null;
  try {
    redirectUri = homeRedirectUri(c.env);
  } catch {
    redirectUri = null;
  }
  return c.json({
    devAuth: isDevAuth(c.env),
    home: {
      clientId: c.env.HOME_CLIENT_ID ?? '',
      origin: c.env.HOME_ORIGIN ?? '',
      zone: c.env.HOME_ZONE ?? '',
      delegate: c.env.HOME_DELEGATE ?? '',
      redirectUri,
    },
  });
});

const HomeAuthRequestSchema = z.object({
  code: z.string().min(1).max(4096),
  codeVerifier: z.string().min(1).max(512),
  authOrigin: z.string().min(1).max(512),
  nonce: z.string().min(1).max(512),
  state: z.string().min(1).max(512),
});

/**
 * Finish a Home sign-in. The browser ran the front half and holds `?code&state`; it hands us the code
 * plus the PKCE verifier and the nonce it generated. WE exchange the code at the Home and verify the
 * id_token — the browser's word for who the person is never enters the decision. See home.ts.
 */
app.post('/auth/home', async (c) => {
  const parsed = HomeAuthRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);

  let identity;
  try {
    identity = await completeHomeSignIn(c.env, parsed.data);
  } catch (e) {
    if (e instanceof HomeAuthError) return c.json({ error: e.reason }, 401);
    console.error('home sign-in', e);
    return c.json({ error: 'home sign-in failed' }, 401);
  }
  return issueHomeSession(c, identity);
});

const DemoAuthRequestSchema = z.object({
  idToken: z.string().min(1).max(8192),
  delegation: z.unknown().optional(),
  authOrigin: z.string().min(1).max(512),
});

/**
 * Finish a Home QUICK-CONNECT sign-in (spec 295, the Home's demo users).
 *
 * The Home hands the browser a finished sign-in result — an id_token plus the site-login delegation —
 * instead of a code, so there is nothing left to exchange. Everything else is unchanged: this Worker
 * fetches the Home's JWKS and verifies the id_token itself (`verifyHomeIdToken`), and the browser's
 * word for who it is still never enters the decision. A quick-connect identity is a real Smart Agent
 * whose custodian the Home holds; it is a shared account by design, which is why this route exists at
 * all and why nothing beyond a play-money seat should ever rest on it.
 */
app.post('/auth/home/demo', async (c) => {
  const parsed = DemoAuthRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);

  let identity;
  try {
    identity = await completeDemoSignIn(c.env, parsed.data);
  } catch (e) {
    if (e instanceof HomeAuthError) return c.json({ error: e.reason }, 401);
    console.error('demo sign-in', e);
    return c.json({ error: 'demo sign-in failed' }, 401);
  }
  return issueHomeSession(c, identity);
});

/**
 * Turn a verified Home identity into a pokernight session: the server-side record (address,
 * delegation, Home origin) plus a bearer token that carries claims only. Shared by both Home routes
 * so a session established either way is indistinguishable downstream.
 */
async function issueHomeSession(c: Context<{ Bindings: Env }>, identity: HomeIdentity): Promise<Response> {
  const playerId = homePlayerId(identity.address);
  // The session never outlives the assertion it rests on.
  const exp = Math.min(Date.now() + HOME_SESSION_TTL_MS, identity.expiresAt);
  const record: SessionRecord = {
    playerId,
    name: identity.name,
    address: identity.address,
    agentName: identity.agentName,
    homeOrigin: identity.homeOrigin,
    delegation: identity.delegation,
    issuedAt: Date.now(),
    expiresAt: exp,
  };
  try {
    await putSessionRecord(c.env, record);
  } catch (e) {
    console.error('session record', e);
    return c.json({ error: 'could not store the session' }, 500);
  }
  let token: string;
  try {
    token = await mintHomeSessionToken(c.env, playerId, identity.name, exp);
  } catch (e) {
    console.error('mint home session', e);
    return c.json({ error: 'the card room cannot issue sessions right now (SESSION_SECRET is not configured)' }, 500);
  }
  return c.json({ token, playerId, name: identity.name, agentName: identity.agentName, address: identity.address });
}

/** Sign out: drop the server-side record so the bearer token stops resolving straight away. */
app.post('/auth/signout', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ ok: true });
  await dropSessionRecord(c.env, session.playerId);
  return c.json({ ok: true });
});

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

/**
 * The treasury a player funds their night from. Chosen once per connect and held on the SERVER
 * session, so the table can read it without the browser ever naming an address money moves to.
 */
app.get('/treasury', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  return getTreasury(c, session);
});

app.post('/treasury/select', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = SelectTreasurySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return selectTreasury(c, session, parsed.data.address);
});

app.post('/treasury/fund', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = FundTreasurySchema.safeParse((await c.req.json().catch(() => null)) ?? {});
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return fundTreasury(c, session, parsed.data.amount);
});

/**
 * Where this player's money at this table has got to: pending, settled with a tx reference, or
 * failed with the reason. Scoped to the caller — a settlement state is nobody else's business, and
 * the DO is asked for THIS session's playerId, never one supplied on the query string.
 */
app.get('/tables/:id/settlement', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const url = `https://table/ledger?playerId=${encodeURIComponent(session.playerId)}`;
  return passthrough(await table(c.env, c.req.param('id')).fetch(url));
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
