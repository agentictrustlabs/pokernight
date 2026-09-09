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
 *   POST /auth/signout                  → SignOutResult (auth required; stands the player up from every
 *                                       seat they hold, then drops the server-side session record)
 *   POST /dev/session {name}            → {token, playerId, name}   (DEV_AUTH=true only)
 *   GET  /tables                        → TableSummary[]            (LobbyDO "default", or ?circle=)
 *   POST /tables CreateTableRequest     → TableSummary (201)
 *   GET  /tables/:id                    → spectator view {tableId, name, settlement, view, names}
 *   GET  /tables/:id/hands/:handNo      → stored hand record (seed reveal, actions, agent calls, result)
 *   POST /tables/:id/seat-agent SeatAgentRequest → seats an A2A agent (auth required) → PlayerInfo (201)
 *   DELETE /tables/:id/seat-agent/:seat → stands that agent up and cashes it out (auth required)
 *   DELETE /tables/:id/seat/:seat       → OPERATOR: clears an abandoned seat and cashes it out
 *                                       (x-operator-token, plus three conditions about the seat)
 *   GET  /tables/:id/settlement         → this player's money rows at a table (auth required)
 *   GET  /tables/:id/ws?token=...       → WebSocket to the table DO (no/invalid token = spectator)
 *   GET  /treasury                      → chosen treasury + balance + candidates + mandate (auth required)
 *   POST /treasury/quick-start          → treasury + stake + buy-in authority, in one call (auth required)
 *   POST /treasury/select {address}     → choose the treasury that funds play (auth required)
 *   POST /treasury/create {label?}      → charter one under the player's person agent (auth required)
 *   POST /treasury/mandate {delegation?}→ sign or record the buy-in mandate (auth required)
 *   POST /treasury/fund {amount}        → mint the test settlement asset into it (auth required; open-mint
 *                                       assets only — see `isTestAsset`)
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import {
  CreateTableRequestSchema,
  DevSessionRequestSchema,
  POKER_ACT_SKILL,
  SeatAgentRequestSchema,
  type SeatStandUpFailure,
  type SeatStoodUp,
  type SignOutResult,
} from '@pokernight/protocol';
import { agentKindFromCard, fetchAgentCard, hasPokerActSkill, resolveAgentBase } from './a2a.js';
import { HOME_SESSION_TTL_MS, dropSessionRecord, mintDevSession, mintHomeSessionToken, putSessionRecord, resolveSession } from './auth.js';
import { a2aTimeoutMs, allowedOrigins, isDevAuth, type Env } from './env.js';
import { OPERATOR_HEADER, checkOperator } from './operator.js';
import {
  BUY_IN_TEMPLATE,
  HomeAuthError,
  cleanProfileName,
  completeDemoSignIn,
  completeHomeSignIn,
  completeMandateCeremony,
  homePlayerId,
  homeRedirectUri,
  type HomeIdentity,
} from './home.js';
import {
  CreateTreasurySchema,
  FundTreasurySchema,
  MandateSchema,
  SelectTreasurySchema,
  buyInOffer,
  createTreasury,
  fundTreasury,
  getTreasury,
  quickStart,
  selectTreasury,
  signMandate,
} from './routes-treasury.js';
import type { SessionRecord } from './session-do.js';
import type { SeatAgentBody } from './table-do.js';

export { PokerTableDO } from './table-do.js';
export { LobbyDO } from './lobby-do.js';
export { SessionDO } from './session-do.js';

const app = new Hono<{ Bindings: Env }>();

const corsMiddleware = cors({
  origin: (origin, c) => (allowedOrigins(c.env as Env).includes(origin) ? origin : null),
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization', OPERATOR_HEADER],
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
      /** The delegation template a buy-in authorisation asks the Home to run. */
      buyInTemplate: BUY_IN_TEMPLATE,
      /**
       * The spending ceiling signing in will ALSO ask the player to approve, or null where this
       * deployment cannot ask for one.
       *
       * Sign-in and the buy-in authorisation used to be two separate trips to the player's Home.
       * They are one now — the Home mints the mandate during the same ceremony that establishes the
       * session — which means signing in is also approving a ceiling. The screen that sends them
       * there has to say so, in these numbers, before they go. Null here means the client asks for a
       * plain sign-in and promises nothing about money, which is what a deployment with no mandate
       * configuration must do.
       */
      buyIn: buyInOffer(c.env),
    },
  });
});

const HomeAuthRequestSchema = z.object({
  code: z.string().min(1).max(4096),
  codeVerifier: z.string().min(1).max(512),
  authOrigin: z.string().min(1).max(512),
  nonce: z.string().min(1).max(512),
  state: z.string().min(1).max(512),
  /**
   * What the person asked to be called, from the field on the sign-in page. A DISPLAY name and
   * nothing more: it names their seat, their line in the hand log and the header, in place of a
   * truncated Smart Agent address. It is NOT a Faithnet handle — these accounts stay nameless in
   * the naming service on purpose — and it is not identity: the id_token decides who this is, and
   * this string cannot change that. Bounded here and cleaned in `cleanProfileName` because it is
   * shown to OTHER players, which is the only reason a browser-supplied string needs any care.
   */
  profileName: z.string().max(200).optional(),
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
  return issueHomeSession(c, identity, parsed.data.profileName);
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
async function issueHomeSession(c: Context<{ Bindings: Env }>, identity: HomeIdentity, profileName?: string): Promise<Response> {
  const playerId = homePlayerId(identity.address);
  // The session never outlives the assertion it rests on.
  const exp = Math.min(Date.now() + HOME_SESSION_TTL_MS, identity.expiresAt);
  // What to call this person, in order of who has the better claim to know:
  //   1. a Faithnet handle the Home actually asserted (`agent_name`) — a name in the naming service,
  //      so it wins, and it is also what a Home-supplied PROFILE name should slot in ahead of once
  //      one exists (a `profile_name`-style id_token claim would be read in `verifyHomeIdToken` and
  //      arrive here as part of the identity, never as something the browser sent);
  //   2. the profile name the person typed on the way in — this room's own display name;
  //   3. a truncated address, which is what `identity.name` already falls back to.
  // Ordered this way so the two cannot fight: whatever the Home says is authoritative, and the field
  // is what fills the silence rather than something that overrides an asserted name.
  const chosen = cleanProfileName(profileName);
  const name = identity.agentName ? identity.name : chosen || identity.name;
  const record: SessionRecord = {
    playerId,
    name,
    address: identity.address,
    agentName: identity.agentName,
    ...(chosen ? { profileName: chosen } : {}),
    homeOrigin: identity.homeOrigin,
    delegation: identity.delegation,
    idToken: identity.idToken,
    // A mandate the Home minted in the SAME ceremony (sign-in asks for the payment template). It is
    // kept unaccepted: a mandate authorises one named account, and which of this person's accounts
    // funds their play is a question only their Home can answer and only `GET /treasury` asks. That
    // route promotes it through the ordinary verification, or drops it. Nothing spends under it here.
    ...(identity.paymentDelegation ? { pendingMandate: identity.paymentDelegation } : {}),
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
    token = await mintHomeSessionToken(c.env, playerId, name, exp);
  } catch (e) {
    console.error('mint home session', e);
    return c.json({ error: 'the card room cannot issue sessions right now (SESSION_SECRET is not configured)' }, 500);
  }
  return c.json({ token, playerId, name, agentName: identity.agentName, address: identity.address });
}

/**
 * Finish a `poker-buyin` authorisation the player ran at their own Home.
 *
 * Requires a live session AND that the ceremony was completed by the same person: an authorisation
 * that arrived for somebody else is not a mandate this session may spend under. The delegation is
 * then checked against this session's treasury before it is kept (`signMandate`) — the browser hands
 * over a signature, never an authority.
 */
app.post('/auth/home/mandate', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = HomeAuthRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);

  let result;
  try {
    result = await completeMandateCeremony(c.env, parsed.data);
  } catch (e) {
    if (e instanceof HomeAuthError) return c.json({ error: e.reason }, 401);
    console.error('mandate ceremony', e);
    return c.json({ error: 'the buy-in authorisation could not be completed' }, 401);
  }
  if (homePlayerId(result.identity.address) !== session.playerId) {
    return c.json({ error: 'that authorisation was completed by a different person than this session' }, 403);
  }
  if (!result.paymentDelegation) {
    return c.json(
      {
        error:
          'your Home completed the authorisation but returned no buy-in mandate, so the card room has been given ' +
          'nothing it could spend under. Nothing was recorded.',
      },
      409,
    );
  }
  return signMandate(c, session, result.paymentDelegation);
});

/**
 * Sign out.
 *
 * An explicit sign-out is a DIFFERENT ACT from a dropped connection, and this is where the difference
 * lives. Dropping a connection sits a player out — seat kept, chips kept, nothing settled — because
 * they have not said they are finished. Signing out says exactly that, so every seat they hold is
 * given up and, on a settled table, cashed out through the ordinary outbox so their money goes home.
 * Leaving a signed-out person's money committed to a seat they have walked away from is the bug this
 * route exists to close.
 *
 * A session that merely EXPIRED never arrives here: the client's `signOutTo('expired')` does not
 * revoke, so an expired session behaves like a disconnect and sits out instead of cashing out. That
 * asymmetry is deliberate — an expired token is not consent to move somebody's money.
 *
 * The seats come back in the response with `pending` on each, and the client says what that means.
 * A queued cash-out is a promise, not a payment, and this route never pretends otherwise.
 *
 * Seats are found by asking every table in the default lobby. That is a handful of subrequests today
 * and it needs no index that could go stale; a table in another circle is not swept, which is why the
 * operator route exists as the backstop.
 */
app.post('/auth/signout', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ ok: true, stoodUp: [], failed: [] } satisfies SignOutResult);
  // Stand up FIRST: the session record is what the treasury lookups hang off, and a seat given up
  // after the record is gone would have a harder time saying where the money should go.
  const { stoodUp, failed } = await standUpEverywhere(c.env, session.playerId);
  await dropSessionRecord(c.env, session.playerId);
  return c.json({ ok: failed.length === 0, stoodUp, failed } satisfies SignOutResult);
});

/** How many tables one sign-out will sweep. A bound, not a policy: today's lobby holds a handful. */
const SIGN_OUT_SWEEP_LIMIT = 100;

/** Ask every table in the default lobby to stand this player up, and collect what happened. */
async function standUpEverywhere(env: Env, playerId: string): Promise<{ stoodUp: SeatStoodUp[]; failed: SeatStandUpFailure[] }> {
  const stoodUp: SeatStoodUp[] = [];
  const failed: SeatStandUpFailure[] = [];
  let tableIds: string[];
  try {
    const res = await lobby(env, undefined).fetch('https://lobby/ids');
    if (!res.ok) return { stoodUp, failed };
    tableIds = ((await res.json()) as { tableIds?: string[] }).tableIds ?? [];
  } catch (e) {
    console.error('sign-out: could not list tables', e);
    return { stoodUp, failed };
  }
  for (const tableId of tableIds.slice(0, SIGN_OUT_SWEEP_LIMIT)) {
    try {
      const res = await table(env, tableId).fetch('https://table/stand-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      const body = (await res.json()) as ({ seated: false } | ({ seated: true } & SeatStoodUp)) & { error?: string };
      if (!res.ok) {
        failed.push({ tableId, reason: body.error ?? `the table refused the stand-up (${res.status})` });
        continue;
      }
      if (body.seated) {
        const { seated: _seated, ...seat } = body;
        stoodUp.push(seat);
      }
    } catch (e) {
      // Said out loud rather than swallowed: a seat we could not give up still has their chips on it.
      failed.push({ tableId, reason: e instanceof Error ? e.message : 'the table could not be reached' });
    }
  }
  return { stoodUp, failed };
}

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

/**
 * OPERATOR: clear an abandoned seat.
 *
 * The one route in this app that can take a seat away from a player who did not ask to leave, which
 * is exactly why it is fenced four ways and refuses by name:
 *
 *   1. operator authority — the `x-operator-token` header, compared in constant time against the
 *      `OPERATOR_TOKEN` secret (`operator.ts`). There is no admin role: no session, however signed
 *      in, can reach this. A deployment that has not set the secret can clear nothing at all.
 *   2. no live socket for that seat  — checked in the DO;
 *   3. the seat is not in a running hand — checked in the DO;
 *   4. the seat has been idle past `SEAT_IDLE_MS` — checked in the DO.
 *
 * All four must hold. Any one of them failing is what makes this useless as a kick tool: a player who
 * is connected, or in a hand, or who did anything in the last few minutes, cannot be cleared by
 * anyone holding any token. The refusal body carries `refused` naming the condition that closed.
 *
 * A cleared seat cashes out through the same path as a voluntary stand-up, so the chips go back to
 * that player's treasury rather than being stranded on the table or quietly kept by the house.
 */
app.delete('/tables/:id/seat/:seat', async (c) => {
  const seat = Number(c.req.param('seat'));
  if (!Number.isInteger(seat) || seat < 0 || seat > 8) return c.json({ error: 'bad seat' }, 400);
  const gate = await checkOperator(c.env, c.req.raw);
  // Never logged, never echoed: the refusal says which gate closed and nothing about the token.
  if (!gate.ok) return c.json({ error: gate.reason, refused: 'operator' }, gate.status);
  return passthrough(await table(c.env, c.req.param('id')).fetch(`https://table/seat/${seat}`, { method: 'DELETE' }));
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

/**
 * Get this player ready to play, in one call: a treasury, a stake in it, and the buy-in authority.
 *
 * The panel that used to ask a newcomer to understand chartered Smart Agents, an open-mint test
 * token and a delegation with caveats is one button now, and this is what the button does. It says
 * what it did — or, when a step belongs to the player's own Home, exactly where to go and why.
 */
app.post('/treasury/quick-start', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  return quickStart(c, session);
});

app.post('/treasury/select', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = SelectTreasurySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return selectTreasury(c, session, parsed.data.address);
});

/**
 * Charter a treasury under this player's person agent. A demo persona's Home does it on request; a
 * real person is handed to their own Home, which is the only place that can create and custody it.
 */
app.post('/treasury/create', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = CreateTreasurySchema.safeParse((await c.req.json().catch(() => null)) ?? {});
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return createTreasury(c, session, parsed.data.label);
});

/**
 * The buy-in mandate. With a `delegation` it records one the player's own Home issued, after checking
 * it authorises THIS table from THIS session's treasury; without one it asks the Home to sign the
 * delegation this table would have asked for, which only works for an identity the Home custodies.
 */
app.post('/treasury/mandate', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = MandateSchema.safeParse((await c.req.json().catch(() => null)) ?? {});
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return signMandate(c, session, parsed.data.delegation);
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
