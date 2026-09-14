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
 *   GET  /clubs                         → the clubs this person is in, from their Home (auth required)
 *   GET  /clubs/invitations             → the clubs they were invited to and have not joined (auth required)
 *   POST /clubs/charter {code…}         → the workspace-create ceremony's return leg: {clubId, idToken}
 *   POST /clubs/:clubId/found {name}    → the first act as the club: its profile (host only)
 *   GET  /admin/signer-address?identity= · POST /admin/service-wire {wire}   (the Home's wire ceremony)
 *   GET  /clubs/:clubId                 → ClubView from the club's own agent, or 404 to anyone with no standing
 *   GET  /clubs/:clubId/members · /schedule · /nights · /calendar   (members and hosts)
 *   PUT  /clubs/:clubId/welcome · /schedule · POST …/nights/:id/cancel · DELETE /clubs/:clubId   (hosts)
 *   GET  /clubs/:clubId/resolve?who=    → an agent name or address, resolved (hosts; the invite names it)
 *   GET  /tables                        → open PICKUP tables; ?club= for a club's own (auth for a club)
 *   POST /tables CreateTableRequest     → TableSummary (201)         (auth required; ?club= needs host)
 *   GET  /tables/:id                    → spectator view {tableId, name, settlement, view, names}
 *   GET  /tables/:id/hands/:handNo      → stored hand record (seed reveal, actions, agent calls, result)
 *   POST /tables/:id/seat-agent SeatAgentRequest → seats an A2A agent (auth required) → PlayerInfo (201)
 *   DELETE /tables/:id/seat-agent/:seat → stands that agent up and cashes it out (auth required)
 *   DELETE /tables/:id/seat/:seat       → OPERATOR: clears an abandoned seat and cashes it out
 *                                       (x-operator-token, plus three conditions about the seat)
 *   DELETE /tables/:id                  → OPERATOR: retires a table nobody is sitting at
 *                                       (x-operator-token; refused while anyone is seated)
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
  POKER_ACT_SKILL,
  SeatAgentRequestSchema,
  type SeatStandUpFailure,
  type SeatStoodUp,
  CANASTA_ADVISE_SKILL,
  CANASTA_RECORD_SKILL,
  CANASTA_REVIEW_SKILL,
  CARD_ROOM_SKILLS,
  cardRoomGameOf,
  POKER_ADVISE_SKILL,
  POKER_COACH_SKILL,
  agentNameToHost,
  POKER_RECORD_SKILL,
  POKER_REVIEW_SKILL,
  SetScheduleRequestSchema,
  icsCalendar,
  type ClubStanding,
  type Night,
  type SignOutResult,
  type TableSummary,
} from '@pokernight/protocol';
import { agentKindFromCard, callCoachStatus, callReview, fetchAgentCard, hasActSkill, messageUrlFromCard, resolveAgentBase } from './a2a.js';
import { addressOfAgent, advertisedOnChain, looksLikeAgentName, nameOfAgent } from './naming.js';
import { MISSION_REGISTRY_ID, missionRegistryProfile, orgOfEntryId } from '@pokernight/missions';
import { admitMission, missionRegistryConfigured, operatorAgentId, receiptFor, receiptHashOf, verifyOperatorReceipt, type MissionEnrolmentPayload } from './missions.js';
import type { RegistrationReceiptV1 } from '@agenticprimitives/registry-kit';
import { HOME_SESSION_TTL_MS, dropSessionRecord, mintHomeSessionToken, putSessionRecord, resolveSession } from './auth.js';
import { a2aReviewTimeoutMs, a2aTimeoutMs, allowedOrigins, siteOrigin, type Env } from './env.js';
import { OPERATOR_HEADER, checkOperator } from './operator.js';
import {
  BUY_IN_TEMPLATE,
  CLUB_PURPOSE,
  CLUB_TEMPLATE,
  HomeAuthError,
  cleanProfileName,
  completeCharterCeremony,
  completeCoachCeremony,
  completeMissionCeremony,
  completeDemoSignIn,
  completeHomeSignIn,
  completeMandateCeremony,
  homePlayerId,
  homeRedirectUri,
  verifyHomeIdToken,
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
import { CLUB_ID_RE, CLUB_WIRE_SKILLS, belongs, clubDelegateAddress, clubViewFor, knownPeople, myClubs, myInvitations, nightsOf, readClub, scheduleFrom, standingAt, storeClubWire, writeClubRecord } from './clubs.js';
import { resolveAgentName } from './naming.js';
import { gameFor } from './games.js';
import { ensurePracticeTable, practiceTableId } from './practice.js';
import { feedPlayer, feedToken } from './feed-token.js';

export { PokerTableDO } from './table-do.js';
export { LobbyDO } from './lobby-do.js';
export { MissionRegistryDO } from './missions.js';
export { SessionDO } from './session-do.js';

const app = new Hono<{ Bindings: Env }>();

const corsMiddleware = cors({
  origin: (origin, c) => (allowedOrigins(c.env as Env).includes(origin) ? origin : null),
  // PUT is here because replacing a club's schedule IS a PUT — one resource, replaced whole, and
  // idempotent, which POST is not. It was missing, so the browser's preflight refused the request
  // before it left, the route was never reached, and the failure arrived as a bare TypeError with no
  // status on it. Nothing in the test suite could have caught that: `SELF.fetch` in the Workers pool
  // calls the Worker directly and never preflights anything.
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization', OPERATOR_HEADER],
  maxAge: 600,
});

/**
 * RATE LIMITS, at the door. Nothing here is expensive on its own, but a club read is a round-trip to the Home
 * (four vault reads and a standing derivation) and a sign-in is a code exchange there — so one browser in a
 * loop was one person's Home doing sustained work for a stranger. Keyed by SESSION where there is one (a
 * person, not a NAT), by IP otherwise; sign-in by IP. The limiter is a Workers binding; absent (dev, tests)
 * it limits nothing. A refusal is 429 with `retry-after`, and says which door.
 */
const RATE_LIMITED = /^\/(clubs|auth|me|people|practice|coaches|geo)(\/|$)|^\/missions\/enrol$|^\/tables\/[^/]+\/(ws|advice|review|adviser)$/;
app.use('*', async (c, next) => {
  const path = c.req.path;
  // `RATE_LIMITS = "off"` is for the test runner, where every request shares one address and the suite
  // would limit itself. Never set on a deployment.
  if (c.env.RATE_LIMITS === 'off' || !RATE_LIMITED.test(path)) return next();
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (path.startsWith('/auth/')) {
    const ok = c.env.RL_AUTH ? (await c.env.RL_AUTH.limit({ key: `auth:${ip}` }).catch(() => ({ success: true }))).success : true;
    if (!ok) return c.json({ error: 'too many sign-in attempts from this address — try again in a minute' }, 429, { 'retry-after': '60' });
    return next();
  }
  const token = sessionToken(c.req.raw) ?? c.req.query('token') ?? '';
  const key = token ? `s:${token.slice(-24)}` : `ip:${ip}`;
  const ok = c.env.RL_SESSION ? (await c.env.RL_SESSION.limit({ key }).catch(() => ({ success: true }))).success : true;
  if (!ok) return c.json({ error: 'slow down — this card room answers a person, not a loop; try again in a few seconds' }, 429, { 'retry-after': '10' });
  return next();
});

// SECURITY HEADERS on every answer. The API serves JSON to one origin; these cost nothing and close the
// sniffing, framing and downgrade doors the browser would otherwise leave open.
app.use('*', async (c, next) => {
  await next();
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') return;
  c.res.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  c.res.headers.set('x-content-type-options', 'nosniff');
  c.res.headers.set('x-frame-options', 'DENY');
  c.res.headers.set('referrer-policy', 'no-referrer');
  if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
});

// THE HOME'S OWN CALLS. The `service-agent-wire` ceremony runs in the host's browser AT THE HOME and asks this
// card room, cross-origin, for its signing key and hands the signed wire back (`/admin/*`). Those two routes
// admit the Home's origin and nothing else does; the page's own origin is the ordinary allowlist below.
const homeCors = cors({
  origin: (origin, c) => ((c.env as Env).HOME_ORIGIN ?? '').replace(/\/$/, '') === origin.replace(/\/$/, '') ? origin : null,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization'],
  maxAge: 600,
});
app.use('/admin/*', homeCors);

// WebSocket upgrades are not CORS requests; keep the 101 response untouched.
app.use('*', (c, next) => (c.req.header('upgrade')?.toLowerCase() === 'websocket' ? next() : c.req.path.startsWith('/admin/') ? next() : corsMiddleware(c, next)));

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
    devAuth: false,
    home: {
      clientId: c.env.HOME_CLIENT_ID ?? '',
      origin: c.env.HOME_ORIGIN ?? '',
      zone: c.env.HOME_ZONE ?? '',
      delegate: c.env.HOME_DELEGATE ?? '',
      redirectUri,
      /** The delegation template a buy-in authorisation asks the Home to run. */
      buyInTemplate: BUY_IN_TEMPLATE,
      /** …and the one that charters a club as its own `.workspace` agent, with the `purpose` its
       *  link carries at the Home so a person can see WHY that agent exists in their list. */
      clubTemplate: CLUB_TEMPLATE,
      clubPurpose: CLUB_PURPOSE,
      /** …and the one that hires a coach (a specialist in the playbook + a study grant), when the Home has it. */
      coachTemplate: (c.env.HOME_COACH_TEMPLATE ?? '').trim() || null,
      /** The Home's A2A worker the browser talks to for a club HUDDLE (spec 378), when this deployment has one. */
      a2aOrigin: (c.env.HOME_A2A_ORIGIN ?? '').trim() || null,
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

/**
 * Ask every table this player could be sitting at to stand them up, and collect what happened.
 *
 * EVERY LOBBY THEY CAN REACH, not just the pickup one. A club's tables live in the club's own lobby,
 * so a sweep of `default` alone would sign somebody out while their chips were still on a club table
 * — their money, left on a table they can no longer reach. The player's club index is exactly the
 * list of lobbies to sweep, and this is the first thing that needed it.
 *
 * The index is a projection and may be briefly behind. A club missing from it means a seat that is
 * not stood up now; it is stood up by the operator seat-clear, which is what that gate is for.
 */
/** The lobbies of this person's clubs — their clubs are their own links at their Home. Not fatal when the
 *  Home cannot be asked: the pickup lobby is still swept, and saying so beats sweeping nothing. */
async function lobbiesOf(env: Env, playerId: string, log: string): Promise<string[]> {
  const agent = playerId.match(/^home:(0x[0-9a-f]{40})$/i)?.[1]?.toLowerCase();
  if (!agent) return [];
  const clubs = await myClubs(env, agent).catch((e: unknown) => { console.error(`${log}: could not list clubs`, e); return null; });
  return (clubs ?? []).map((c) => c.clubId);
}

/** Every table this person could have sat at: the pickup lobby's, and each of their clubs'. */
async function tablesAround(env: Env, playerId: string, log = 'sweep'): Promise<string[]> {
  const lobbies: (string | undefined)[] = [undefined, ...(await lobbiesOf(env, playerId, log))];
  const tableIds: string[] = [];
  for (const which of lobbies) {
    try {
      const res = await lobby(env, which).fetch('https://lobby/ids');
      if (!res.ok) continue;
      tableIds.push(...(((await res.json()) as { tableIds?: string[] }).tableIds ?? []));
    } catch (e) {
      console.error(`${log}: could not list tables`, e);
    }
  }
  return tableIds;
}

async function standUpEverywhere(env: Env, playerId: string): Promise<{ stoodUp: SeatStoodUp[]; failed: SeatStandUpFailure[] }> {
  const stoodUp: SeatStoodUp[] = [];
  const failed: SeatStandUpFailure[] = [];
  const lobbies: (string | undefined)[] = [undefined, ...(await lobbiesOf(env, playerId, 'sign-out'))];
  const tableIds: string[] = [];
  for (const which of lobbies) {
    try {
      const res = await lobby(env, which).fetch('https://lobby/ids');
      if (!res.ok) continue;
      tableIds.push(...(((await res.json()) as { tableIds?: string[] }).tableIds ?? []));
    } catch (e) {
      console.error('sign-out: could not list tables', e);
    }
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

/**
 * The lobby that holds a club's tables — or, with no club, the PICKUP lobby.
 *
 * One `LobbyDO` per club is what `docs/DESIGN.md` §7 always said ("one per circle"), and it is what
 * makes a club's tables private without filtering: they are simply not in the public lobby's index.
 * `default` is the pickup lobby, and naming it is the whole change from before.
 */
function lobby(env: Env, clubId: string | undefined) {
  return env.LOBBIES.get(env.LOBBIES.idFromName(clubId ?? 'default'));
}

function table(env: Env, tableId: string) {
  return env.TABLES.get(env.TABLES.idFromName(tableId));
}

/** The A2A skill an agent seat at this table must advertise — the table's own game's. */
async function tableActSkill(env: Env, tableId: string): Promise<string> {
  const res = await table(env, tableId).fetch('https://table/summary');
  if (!res.ok) return POKER_ACT_SKILL;
  const game = ((await res.json()) as { game?: string }).game;
  try {
    return gameFor(game).actSkill;
  } catch {
    // A table stamped with a game this deployment lost: the seat is refused a moment later anyway,
    // and guessing a skill here would be guessing which game somebody is sitting down to.
    return POKER_ACT_SKILL;
  }
}

/** The club a table belongs to, from the table's own record. `undefined` for a pickup table. */
async function tableClub(env: Env, tableId: string): Promise<string | undefined> {
  return (await tableMeta(env, tableId))?.club;
}

/** The table's own record of whose it is: its club (if any) and, for a practice table, its owner. */
async function tableMeta(env: Env, tableId: string): Promise<{ club?: string; practiceFor?: string } | null> {
  const res = await table(env, tableId).fetch('https://table/summary');
  if (!res.ok) return null;
  return (await res.json()) as { club?: string; practiceFor?: string };
}


/* ------------------------------------------------------------------ clubs */

/**
 * A CLUB IS ITS WORKSPACE AGENT AT THE HOME, and every route here asks that agent (`clubs.ts`).
 *
 * The session says who is asking (a Home sign-in carries their agent address); the club's own agent,
 * asked as the club under the wire its host signed, says what they are to it — host, member, none —
 * from ITS records and the chain. Nothing about a club is kept here but the wire. A club nobody has
 * standing in answers 404, never 403: confirming that a club exists is confirming a fact about other
 * people's arrangements, and a club this card room holds no wire for is, to it, no club at all.
 */
type Gate = { clubId: string; agent: string; name: string; standing: 'host' | 'member' } | { refused: Response };

/** The person's agent address from their session — what every club question is asked about. */
function agentOf(session: { playerId: string } & { address?: string }): string | null {
  const a = String(session.address ?? '').toLowerCase();
  return CLUB_ID_RE.test(a) ? a : null;
}

async function requireStanding(c: Context<{ Bindings: Env }>, need: 'host' | 'member'): Promise<Gate> {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return { refused: c.json({ error: 'unauthenticated' }, 401) };
  const clubId = (c.req.param('clubId') ?? '').toLowerCase();
  if (!CLUB_ID_RE.test(clubId)) return { refused: c.json({ error: 'no such club' }, 404) };
  const agent = agentOf(session);
  if (!agent) return { refused: c.json({ error: 'a club needs your own agent — sign in through your Home' }, 403) };
  const answer = await standingAt(c.env, clubId, agent);
  if (!answer || !belongs(answer.standing)) return { refused: c.json({ error: 'no such club' }, 404) };
  if (need === 'host' && answer.standing !== 'host') {
    return { refused: c.json({ error: `only a host of this club can do that — ${answer.because}` }, 403) };
  }
  return { clubId, agent, name: session.name, standing: answer.standing as 'host' | 'member' };
}

/**
 * The gate a TABLE puts in front of itself once it belongs to a club: `null` to allow, a 404 to
 * refuse. A pickup table (no club) passes straight through.
 */
async function clubGate(c: Context<{ Bindings: Env }>, clubId: string | undefined): Promise<Response | null> {
  if (!clubId) return null;
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  const agent = session ? agentOf(session) : null;
  const answer = agent ? await standingAt(c.env, clubId, agent) : null;
  return !answer || !belongs(answer.standing) ? c.json({ error: 'no such table' }, 404) : null;
}

const clubMember = (c: Context<{ Bindings: Env }>) => requireStanding(c, 'member');
const clubHost = (c: Context<{ Bindings: Env }>) => requireStanding(c, 'host');

/** The clubs this person is in — their own links at their Home, filtered to this card room's clubs. */
app.get('/clubs', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const agent = agentOf(session);
  if (!agent) return c.json({ clubs: [] });
  const clubs = await myClubs(c.env, agent);
  return c.json({ clubs: clubs ?? [] });
});

/** The clubs this person has been invited to and not joined: the host's agent told them at their Home, and the
 *  rail says so here too, with the door. */
// ───────────────────────────────────────────────────────────────────────── the mission registry
// docs/MISSION-REGISTRY.md. The registry is on chain; this is its OPERATOR: the public projection (the map,
// the pickers), the return leg that admits a registration, the profile a consumer reads, the geocoder the
// register form uses. The operator's store is one Durable Object.

function missions(env: Env) {
  return env.MISSIONS.get(env.MISSIONS.idFromName(MISSION_REGISTRY_ID));
}

/** The registry's own profile (spec 279 §3.1) — what it admits and how, for anybody. */
app.get('/missions/registry', (c) => {
  const operator = missionRegistryConfigured(c.env) ? operatorAgentId(c.env) : '';
  return c.json({ ...missionRegistryProfile(operator), chainId: Number(c.env.CHAIN_ID), registryAddress: c.env.AGENT_REGISTRY_BASE ?? null, configured: missionRegistryConfigured(c.env) });
});

/** Every registered mission, projected for the map — coarse points per the ceiling, no contact, ever. */
app.get('/missions', async (c) => {
  const r = await missions(c.env).fetch('https://do/list');
  return c.json(await r.json());
});

/** The mission's receipt alone, so a consumer can verify it. Registered BEFORE the one-mission route: the
 *  entry id carries a slash, so the generic route would swallow `/receipt` as part of the id. */
app.get('/missions/:entryId{.+?}/receipt', async (c) => {
  const entryId = c.req.param('entryId') ?? '';
  const r = await missions(c.env).fetch(`https://do/entry?id=${encodeURIComponent(entryId)}`);
  if (!r.ok) return c.json({ error: 'no such mission' }, 404);
  const b = (await r.json()) as { receipt: RegistrationReceiptV1 | null };
  // `?verify=1` — the card room checks its own operator's signature the way any consumer would, and says so.
  const verification = b.receipt && c.req.query('verify') === '1' ? await verifyOperatorReceipt(c.env, b.receipt) : undefined;
  return c.json({ receipt: b.receipt, operator: operatorAgentId(c.env), howToVerify: 'session-key scheme: unwrap the operator wire from proof.signature, check it on chain (delegator = operator, ERC-1271 over the delegation digest, not revoked), then ECDSA over receiptDigest(hashReceiptBody(receipt)) must recover the wire\'s delegate', ...(verification ? { verification } : {}) });
});

/** One mission: its listing, the operator's receipt, and its lifecycle events. */
app.get('/missions/:entryId{.+?}', async (c) => {
  const entryId = c.req.param('entryId') ?? '';
  if (!orgOfEntryId(entryId)) return c.json({ error: 'no such mission' }, 404);
  const r = await missions(c.env).fetch(`https://do/entry?id=${encodeURIComponent(entryId)}`);
  return c.json(await r.json(), r.status as 200);
});

/**
 * THE RETURN LEG of the org-create that registers a mission. The browser did the front half at the Home;
 * this exchanges the code, checks the identity against the session, then runs the admission pipeline —
 * every hash against the chain's entry, the covenant's signature against the steward's agent — and signs
 * a receipt as the registry operator. A registration that fails admission is refused by name and nothing
 * is projected: the chain may hold the entry, and the map will not show it until the checks pass.
 */
app.post('/missions/enrol', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  if (!missionRegistryConfigured(c.env)) return c.json({ error: 'this card room operates no mission registry' }, 503);
  const parsed = HomeAuthRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  let result;
  try {
    result = await completeMissionCeremony(c.env, parsed.data);
  } catch (e) {
    if (e instanceof HomeAuthError) return c.json({ error: e.reason }, 401);
    console.error('mission enrol', e);
    return c.json({ error: 'the registration could not be completed' }, 401);
  }
  if (homePlayerId(result.identity.address) !== session.playerId) return c.json({ error: 'that ceremony was run by somebody else' }, 403);
  const payload = result.registry as MissionEnrolmentPayload;
  const admission = await admitMission(c.env, payload, result.identity.address);
  if ('error' in admission) return c.json({ error: `the registration could not be read — ${admission.error}` }, 400);
  if (!admission.ok) {
    console.log(`[missions] refused ${payload.entryId}: ${admission.failed.map((f) => `${f.check}: ${f.reason}`).join('; ')}`);
    return c.json({ error: `the registration did not pass admission — ${admission.failed.map((f) => f.reason).join('; ')}`, failed: admission.failed }, 422);
  }
  const receipt = await receiptFor(c.env, admission, payload);
  const receiptHash = await receiptHashOf(receipt);
  // The confidential contact came back on the org payload only because the Home put it in the org's vault
  // first; it goes into the operator's store and nowhere public.
  const contact = typeof (payload as unknown as { contact?: unknown }).contact === 'string' ? (payload as unknown as { contact: string }).contact : null;
  const r = await missions(c.env).fetch('https://do/admit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ presence: admission.presence, covenant: admission.covenant, orgName: admission.orgName ?? result.orgName ?? null, contact, receipt, receiptHash, expiresAt: payload.expiresAt, act: payload.act, ...(payload.txHash ? { txHash: payload.txHash } : {}) }),
  });
  const b = (await r.json()) as { listing: unknown };
  console.log(`[missions] ${payload.act} ${payload.entryId} (${admission.orgName ?? 'nameless'}) — ${admission.verified.length} verified, ${admission.notVerified.length} not verified`);
  return c.json({ ok: true, listing: b.listing, receipt, act: payload.act }, 201);
});

/**
 * THE GEOCODER for the register form — Photon (komoot), proxied so the browser's CSP names one origin and
 * the key of the person typing never reaches a third party as a referer. Signed-in people only, and
 * rate-limited with everything else that costs a round trip.
 */
app.get('/geo/search', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const q = (c.req.query('q') ?? '').trim().slice(0, 120);
  if (q.length < 2) return c.json({ places: [] });
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!res || !res.ok) return c.json({ error: 'the geocoder did not answer' }, 502);
  const g = (await res.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, string> }> };
  const places = (g.features ?? []).flatMap((f) => {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lng !== 'number' || !p.countrycode) return [];
    const label = [p.name, p.city && p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(', ');
    return [{ label, country: String(p.countrycode).toUpperCase(), lat, lng, kind: p.osm_value ?? p.type ?? '' }];
  });
  return c.json({ places });
});

app.get('/clubs/invitations', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const agent = agentOf(session);
  if (!agent) return c.json({ invitations: [] });
  return c.json({ invitations: (await myInvitations(c.env, agent)) ?? [] });
});

/**
 * THE WIRE CEREMONY'S TWO CALLS — what the Home's `service-agent-wire` template asks of the service it is
 * authorising (`authorizeServiceAgentWire` at the Home). The bearer is the Home's own id_token for the
 * person running the ceremony, verified here as at sign-in; `identity` is the club's agent the card room is
 * to act as. The custodian then signs AS that agent at their Home — which nobody but the workspace's
 * custodian can do — and hands the wire back to be checked and kept (`storeClubWire`).
 */
app.get('/admin/signer-address', async (c) => {
  const who = await ceremonyPerson(c);
  if (!who.ok) return c.json({ error: who.error }, 401);
  const identity = String(c.req.query('identity') ?? '').toLowerCase();
  if (!CLUB_ID_RE.test(identity)) return c.json({ error: 'identity (the club\'s agent) required' }, 400);
  const delegate = clubDelegateAddress(c.env);
  if (!delegate) return c.json({ error: 'this card room has no signing key to be authorised' }, 503);
  return c.json({ identity, delegate, skills: [...CLUB_WIRE_SKILLS] });
});

app.post('/admin/service-wire', async (c) => {
  const who = await ceremonyPerson(c);
  if (!who.ok) return c.json({ error: who.error }, 401);
  const body = (await c.req.json().catch(() => null)) as { wire?: unknown } | null;
  if (!body?.wire || typeof body.wire !== 'object') return c.json({ error: 'wire required' }, 400);
  const kept = await storeClubWire(c.env, body.wire as Parameters<typeof storeClubWire>[1]);
  if (!kept.ok) return c.json({ ok: false, error: kept.error }, 400);
  return c.json({ ok: true, club: kept.club, expiresAt: kept.expiresAt });
});

/** The person a ceremony's bearer names: a Home id_token for this client, verified as at sign-in. */
async function ceremonyPerson(c: Context<{ Bindings: Env }>): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return { ok: false, error: 'the ceremony\'s bearer is required' };
  try {
    const identity = await verifyHomeIdToken(c.env, c.env.HOME_ORIGIN ?? '', bearer, '', Date.now());
    return { ok: true, address: identity.address.toLowerCase() };
  } catch (e) {
    return { ok: false, error: e instanceof HomeAuthError ? e.reason : 'the ceremony\'s bearer did not verify' };
  }
}

/**
 * STARTING A CLUB is two ceremonies at the host's Home, and this is the return leg of each.
 *
 *   1. `workspace-create` charters the club's agent. The Worker exchanges the code, checks the identity
 *      against the session, and answers with the agent's address and the id_token the wire ceremony needs
 *      as its bearer — nothing is written yet, because nothing can be: the card room cannot act as the
 *      club until the club has authorised it.
 *   2. `service-agent-wire` (the Home calls `/admin/*` above and keeps nothing) authorises this card room
 *      to act as the club. Then `POST /clubs/:clubId/found` writes the club's profile — the first act as
 *      the club — after the club's own agent has said the person asking is its host.
 */
app.post('/clubs/charter', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = HomeAuthRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  let result;
  try {
    result = await completeCharterCeremony(c.env, parsed.data);
  } catch (e) {
    if (e instanceof HomeAuthError) return c.json({ error: e.reason }, 401);
    console.error('charter ceremony', e);
    return c.json({ error: 'the club could not be chartered' }, 401);
  }
  if (homePlayerId(result.identity.address) !== session.playerId) {
    return c.json({ error: 'that ceremony was completed by a different person than this session' }, 403);
  }
  return c.json({ clubId: result.agent, ...(result.agentName ? { agentName: result.agentName } : {}), idToken: result.idToken });
});

const FoundClubSchema = z.object({ name: z.string().min(1).max(64), games: z.array(z.string().max(32)).max(8).optional() });

app.post('/clubs/:clubId/found', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const clubId = (c.req.param('clubId') ?? '').toLowerCase();
  if (!CLUB_ID_RE.test(clubId)) return c.json({ error: 'no such club' }, 404);
  const agent = agentOf(session);
  if (!agent) return c.json({ error: 'a club needs your own agent — sign in through your Home' }, 403);
  const parsed = FoundClubSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  const read = await readClub(c.env, clubId, agent);
  if (!read) return c.json({ error: 'this card room holds no authorisation from that club yet — run the ceremony at your Home' }, 404);
  if (read.you?.standing !== 'host') return c.json({ error: `only the club's steward can found it — ${read.you?.because ?? 'the club does not know you'}` }, 403);
  if (read.profile?.name) return c.json({ error: `${read.profile.name} is already founded — a club is founded once` }, 409);
  const profile = { name: parsed.data.name.trim(), foundedBy: agent, charteredAt: Date.now(), ...(parsed.data.games?.length ? { games: parsed.data.games } : {}) };
  const w = await writeClubRecord(c.env, clubId, 'profile', profile);
  if (!w.ok) return c.json({ error: w.error }, w.status as 502);
  const view = await clubViewFor(c.env, clubId, agent);
  return view ? c.json(view, 201) : c.json({ clubId, name: profile.name }, 201);
});

/**
 * A CLUB'S HUDDLE, FROM THE CARD ROOM (Home spec 378, `club` scope). The Home's huddle service decides who may
 * start, join or end and Cloudflare carries the media; this route is the person's road to it: their card-room
 * session says who they are, and the card room calls the Home server-to-server under the paired secret,
 * naming them — the Home derives their standing at the club from ITS records (the workspace's membership).
 * What comes back — the run, and on start/join the ONE credential the browser SDK needs — is passed through
 * once, kept nowhere and logged nowhere.
 */
app.post('/clubs/:clubId/huddle/:op', async (c) => {
  const op = String(c.req.param('op') ?? '');
  if (!['start', 'join', 'get', 'leave', 'end'].includes(op)) return c.json({ ok: false, error: 'unknown huddle operation' }, 404);
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  const a2a = (c.env.HOME_A2A_ORIGIN ?? '').trim().replace(/\/$/, '');
  const secret = (c.env.CLUB_ROSTER_SECRET ?? '').trim();
  if (!a2a || !secret) return c.json({ ok: false, error: 'huddles_not_configured' }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { displayName?: string; key?: string };
  const r = await fetch(`${a2a}/huddles/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ actor: gate.agent, scope: { kind: 'club', principal: gate.clubId, id: gate.clubId }, displayName: (body.displayName ?? gate.name ?? '').toString().slice(0, 80), key: (body.key ?? '').toString().slice(0, 120) || `${op}:${gate.agent}:${Date.now()}` }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e: unknown) => ({ ok: false, status: 502, json: async () => ({ ok: false, error: e instanceof Error ? e.message : String(e) }) }) as unknown as Response);
  const out = (await r.json().catch(() => ({ ok: false, error: `the Home answered ${r.status}` }))) as Record<string, unknown>;
  return c.json(out, (r.status >= 200 && r.status < 600 ? r.status : 502) as 200);
});

/** A club, to somebody with standing in it: ONE read of the club's agent. */
app.get('/clubs/:clubId', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const clubId = (c.req.param('clubId') ?? '').toLowerCase();
  const agent = agentOf(session);
  if (!CLUB_ID_RE.test(clubId) || !agent) return c.json({ error: 'no such club' }, 404);
  const view = await clubViewFor(c.env, clubId, agent);
  return view ? c.json(view) : c.json({ error: 'no such club' }, 404);
});

/** What the host wants said about their club — the profile, rewritten with the new words. */
app.put('/clubs/:clubId/welcome', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const body = (await c.req.json().catch(() => null)) as { welcome?: unknown } | null;
  if (typeof body?.welcome !== 'string') return c.json({ error: 'welcome must be text' }, 400);
  const read = await readClub(c.env, gate.clubId, gate.agent);
  if (!read?.profile) return c.json({ error: 'no such club' }, 404);
  const text = body.welcome.trim().slice(0, 2000);
  const { welcome: _old, ...rest } = read.profile;
  const w = await writeClubRecord(c.env, gate.clubId, 'profile', { ...rest, ...(text ? { welcome: text } : {}) });
  if (!w.ok) return c.json({ error: w.error }, w.status as 502);
  return c.json({ welcome: text || undefined });
});

/**
 * THE CLUB'S NIGHTS, AS A CALENDAR SUBSCRIPTION. A calendar client fetches this every half hour from a
 * phone with no session, so the URL carries the authority (`feed-token.ts`); membership is still asked of
 * the club's agent on every fetch, so a feed stops answering when somebody leaves.
 */
app.get('/clubs/:clubId/calendar/:token', async (c) => {
  const clubId = (c.req.param('clubId') ?? '').toLowerCase();
  const token = (c.req.param('token') ?? '').replace(/\.ics$/, '');
  const agent = await feedPlayer(c.env, clubId, token);
  if (!agent || !CLUB_ID_RE.test(agent)) return c.json({ error: 'no such calendar' }, 404);
  const view = await clubViewFor(c.env, clubId, agent);
  if (!view) return c.json({ error: 'no such calendar' }, 404);
  const site = siteOrigin(c.env);
  const url = `${site}/#/clubs/${encodeURIComponent(clubId)}`;
  const body = icsCalendar({
    name: view.name,
    ...(view.welcome ? { description: view.welcome } : {}),
    domain: new URL(site).hostname,
    nights: view.nights.map((n) => ({
      nightId: n.nightId,
      startsAt: n.startsAt,
      title: n.game ? `${n.title ?? view.name} — ${gameName(n.game)}` : (n.title ?? view.name),
      description: `${view.name} at ${site.replace(/^https?:\/\//, '')}\n\n${view.welcome ?? ''}`.trim(),
      url,
      ...(n.status ? { status: n.status } : {}),
    })),
  });
  const asFile = c.req.query('download') === '1';
  const file = `${view.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'club'}.ics`;
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `${asFile ? 'attachment' : 'inline'}; filename="${file}"`,
      'cache-control': 'no-store',
    },
  });
});

/** What a game is called, for a calendar entry. */
function gameName(game: string): string {
  return game === 'canasta' ? 'Canasta' : game === 'poker' ? "Texas Hold'em" : game;
}

/** The subscription URL for the caller's own feed of this club. */
app.get('/clubs/:clubId/calendar', async (c) => {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  let token: string;
  try {
    token = await feedToken(c.env, gate.clubId, gate.agent);
  } catch {
    return c.json({ error: 'this card room cannot publish calendars' }, 503);
  }
  const api = new URL(c.req.url).origin;
  const url = `${api}/clubs/${encodeURIComponent(gate.clubId)}/calendar/${token}.ics`;
  return c.json({ url, webcal: url.replace(/^https?:/, 'webcal:') });
});

/**
 * WHEN THIS CLUB MEETS. The schedule is a RULE (`cardroom.club.schedule`) and the nights are DERIVED from it
 * at read time, with the host's exceptions (`cardroom.club.nights`) laid over — nothing is materialised and
 * nothing has to be kept in step. Reading is a member's; setting is a host's.
 */
app.get('/clubs/:clubId/schedule', async (c) => {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  const view = await clubViewFor(c.env, gate.clubId, gate.agent);
  return c.json({ schedule: view?.schedule ?? null });
});

app.put('/clubs/:clubId/schedule', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const parsed = SetScheduleRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  const made = scheduleFrom(gate.clubId, parsed.data, gate.agent);
  if (!made.ok) return c.json({ error: made.error }, 400);
  const w = await writeClubRecord(c.env, gate.clubId, 'schedule', made.schedule);
  if (!w.ok) return c.json({ error: w.error }, w.status as 502);
  return c.json({ schedule: made.schedule, nights: nightsOf(gate.clubId, made.schedule, null) });
});

app.delete('/clubs/:clubId/schedule', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const read = await readClub(c.env, gate.clubId, gate.agent);
  if (!read?.schedule) return c.json({ retired: true });
  const w = await writeClubRecord(c.env, gate.clubId, 'schedule', { ...read.schedule, status: 'retired' });
  if (!w.ok) return c.json({ error: w.error }, w.status as 502);
  return c.json({ retired: true });
});

app.get('/clubs/:clubId/nights', async (c) => {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  const view = await clubViewFor(c.env, gate.clubId, gate.agent);
  return c.json({ nights: view?.nights ?? [] });
});

/** Call one off (`cancelled`), or take just this one out of the series (`skipped`): an exception on the record. */
app.post('/clubs/:clubId/nights/:nightId/cancel', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const nightId = decodeURIComponent(c.req.param('nightId') ?? '');
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string; skip?: boolean };
  const read = await readClub(c.env, gate.clubId, gate.agent);
  if (!read) return c.json({ error: 'no such club' }, 404);
  const schedule = read.schedule && read.schedule.status === 'active' ? read.schedule : null;
  const night = nightsOf(gate.clubId, schedule, read.nights).find((n) => n.nightId === nightId);
  if (!night) return c.json({ error: 'no such night' }, 404);
  const exceptions = { ...(read.nights?.exceptions ?? {}), [nightId]: { status: (body.skip === true ? 'skipped' : 'cancelled') as 'skipped' | 'cancelled', cancelledAt: Date.now(), ...((body.reason ?? '').trim() ? { reason: (body.reason ?? '').trim() } : {}) } };
  const w = await writeClubRecord(c.env, gate.clubId, 'nights', { ...(read.nights ?? {}), exceptions });
  if (!w.ok) return c.json({ error: w.error }, w.status as 502);
  const after = nightsOf(gate.clubId, schedule, { exceptions }).find((n) => n.nightId === nightId);
  return c.json({ night: after ?? night });
});

/**
 * RETIRING A CLUB. It LOOKS FIRST and refuses (409, naming them) if anybody is seated at one of the club's
 * tables; then closes the club's tables; then marks the club's profile retired at its Home and lets go of
 * the wire. The club's agent is NOT ours to retire: it lives at the host's Home and this card room never
 * held its key — the answer says so.
 */
app.delete('/clubs/:clubId', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const listed = await lobby(c.env, gate.clubId).fetch('https://lobby/list');
  const tables = listed.ok ? ((await listed.json()) as TableSummary[]) : [];
  const busy = tables.filter((t) => t.seated > 0);
  if (busy.length > 0) {
    return c.json(
      {
        error:
          `somebody is still sitting at ${busy.length === 1 ? 'a table' : `${busy.length} tables`} in this club — ` +
          `${busy.map((t) => `${t.name} (${t.seated} seated)`).join(', ')}. Stand them up first; nothing has been closed.`,
        seated: busy.map((t) => ({ tableId: t.tableId, name: t.name, seated: t.seated })),
      },
      409,
    );
  }
  const closed: string[] = [];
  for (const t of tables) {
    const res = await lobby(c.env, gate.clubId).fetch('https://lobby/retire', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: t.tableId }) });
    if (res.ok) closed.push(t.name);
  }
  const read = await readClub(c.env, gate.clubId, gate.agent);
  const name = read?.profile?.name ?? gate.clubId;
  if (read?.profile) {
    const w = await writeClubRecord(c.env, gate.clubId, 'profile', { ...read.profile, retiredAt: Date.now() });
    if (!w.ok) return c.json({ error: w.error }, w.status as 502);
  }
  await c.env.CLUB_WIRES?.delete(`wire:${gate.clubId}`);
  return c.json({ retired: gate.clubId, name, agent: gate.clubId, tablesClosed: closed }, 200);
});

app.get('/clubs/:clubId/members', async (c) => {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  const view = await clubViewFor(c.env, gate.clubId, gate.agent);
  return c.json({ members: view?.roster ?? [] });
});

/**
 * WHOM A HOST MEANS, by name or address — resolved on chain so a host never has to find a hex string. The
 * membership itself is two ceremonies at the Home (invite, join); this only turns "carol.me" into the
 * agent the invitation names.
 */
app.get('/clubs/:clubId/resolve', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const raw = (c.req.query('who') ?? '').trim();
  if (CLUB_ID_RE.test(raw)) return c.json({ agent: raw.toLowerCase() });
  if (!looksLikeAgentName(raw)) return c.json({ error: `"${raw}" is not an agent name or address` }, 400);
  const answer = await resolveAgentName(c.env, raw);
  if (!answer.ok) return c.json({ error: answer.error }, 400);
  return c.json({ agent: answer.address.toLowerCase(), name: answer.name });
});

/** The people this person already plays with: everyone on the rosters of their clubs, but them. */
app.get('/people', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const agent = agentOf(session);
  if (!agent) return c.json({ people: [] });
  return c.json({ people: await knownPeople(c.env, agent) });
});

app.get('/agents', async (c) => {
  const base = (c.env.AGENT_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) return c.json({ agents: [] });
  const game = c.req.query('game') ?? '';
  try {
    const res = await fetch(`${base}/agents${game ? `?game=${encodeURIComponent(game)}` : ''}`, {
      signal: AbortSignal.timeout(a2aTimeoutMs(c.env)),
    });
    if (!res.ok) return c.json({ agents: [] });
    return c.json((await res.json()) as Record<string, unknown>);
  } catch {
    // A card room whose agent host is down still deals to people. An empty list says "nobody to
    // seat right now", which is true, rather than failing the page that asked.
    return c.json({ agents: [] });
  }
});

/* ----------------------------------------------------------------- tables */

app.get('/tables', async (c) => {
  // No club named: the PICKUP lobby, which is public and is what every table was before clubs
  // existed. A club's own tables are never in it and are never listed to a stranger.
  const clubId = c.req.query('club') ?? c.req.query('circle');
  if (!clubId) return passthrough(await lobby(c.env, undefined).fetch('https://lobby/list'));
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  const agent = session ? agentOf(session) : null;
  const answer = agent ? await standingAt(c.env, clubId, agent) : null;
  if (!answer || !belongs(answer.standing)) return c.json({ error: 'no such club' }, 404);
  return passthrough(await lobby(c.env, clubId).fetch('https://lobby/list'));
});

/**
 * Open a table.
 *
 * A SESSION IS NOW REQUIRED where none was before. This route accepted anonymous calls and created
 * tables in any lobby, forever — the deliberate breaking change named in `docs/WORKSPACES.md` §6.3.
 *
 * With a `club`, the caller must be a HOST of it and the table is stamped with it. Without one, it
 * is a pickup table: public, joinable by anyone with a session, exactly as before.
 */
app.post('/tables', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = CreateTableRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  const clubId = parsed.data.club;
  let clubName: string | undefined;
  if (clubId) {
    const agent = agentOf(session);
    const read = agent ? await readClub(c.env, clubId, agent) : null;
    if (!read || !read.you || !belongs(read.you.standing)) return c.json({ error: 'no such club' }, 404);
    if (read.you.standing !== 'host') {
      return c.json({ error: `only a host of this club can open a table for it — ${read.you.because}` }, 403);
    }
    clubName = read.profile?.name;
  }
  const res = await lobby(c.env, clubId).fetch('https://lobby/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // WHO OPENED IT travels with the request, so the table can let them close it again.
    body: JSON.stringify({ ...parsed.data, createdBy: session.playerId, ...(clubId ? { club: clubId, clubName } : {}) }),
  });
  return passthrough(res);
});

/**
 * YOUR PRACTICE TABLE — the same one every time, in no lobby, ready to be reset.
 *
 * "I just want to be able to join a coaching table and leave and then reset to new game and get
 * coached again." Before this, learning canasta meant opening a fresh table each attempt, and each
 * attempt left a dead game in the public list.
 *
 * Idempotent twice over: the id is derived from the person and the game rather than stored, and the
 * table's own `init` returns its summary untouched when it already exists. Pressing this a hundred
 * times produces one table.
 */
app.post('/practice', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const body = (await c.req.json().catch(() => null)) as { game?: unknown } | null;
  const wanted = typeof body?.game === 'string' && body.game.trim() ? body.game.trim() : 'canasta';
  try {
    gameFor(wanted);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const made = await ensurePracticeTable(c.env, session.playerId, session.name, wanted);
  if (!made.ok) return c.json({ error: made.error }, 400);
  return c.json({ tableId: made.tableId, game: wanted }, 200);
});

/**
 * Deal again from the start, keeping the seats.
 *
 * ONLY THE PERSON WHOSE TABLE IT IS. The table itself records that, so this is a question about the
 * table's own data rather than a list somewhere else agreeing — and a reset at an ordinary table is
 * refused by the object, whoever asks, because it would wipe a game other people are in.
 */
/** Stop the table, or start it again. The person whose practice table it is. */
app.post('/tables/:id/pause', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const tableId = c.req.param('id');
  const got = await table(c.env, tableId).fetch('https://table/summary');
  if (!got.ok) return passthrough(got);
  if (((await got.json()) as { practiceFor?: string }).practiceFor !== session.playerId) {
    return c.json({ error: 'that is not your practice table' }, 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as { paused?: unknown };
  return passthrough(
    await table(c.env, tableId).fetch('https://table/pause', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: body?.paused === true }),
    }),
  );
});

/** How fast this table plays, for the person whose practice table it is. */
app.post('/tables/:id/pace', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const tableId = c.req.param('id');
  const got = await table(c.env, tableId).fetch('https://table/summary');
  if (!got.ok) return passthrough(got);
  if (((await got.json()) as { practiceFor?: string }).practiceFor !== session.playerId) {
    return c.json({ error: 'that is not your practice table' }, 404);
  }
  return passthrough(
    await table(c.env, tableId).fetch('https://table/pace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ms: (await c.req.json().catch(() => ({}))).ms }),
    }),
  );
});

app.post('/tables/:id/reset', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const tableId = c.req.param('id');
  const res = await table(c.env, tableId).fetch('https://table/summary');
  if (!res.ok) return passthrough(res);
  const summary = (await res.json()) as { practiceFor?: string };
  // A table that is not theirs is not distinguished from one that is not a practice table: neither
  // is a thing they may reset, and saying which would say whose it is.
  if (summary.practiceFor !== session.playerId) return c.json({ error: 'that is not your practice table' }, 404);
  return passthrough(await table(c.env, tableId).fetch('https://table/reset', { method: 'POST' }));
});

app.get('/tables/:id', async (c) => {
  const res = await table(c.env, c.req.param('id')).fetch('https://table/view');
  if (!res.ok) return passthrough(res);
  const view = (await res.json()) as { club?: string; practiceFor?: string };
  // A PRACTICE TABLE IS NOT A PUBLIC ROOM. Its id is derived from its owner's address, so anyone who knew the
  // address could have watched them practise — cards redacted, but that they were there, and their stack,
  // was not. A signed-in person may still look (the owner brings friends to their own table: the tests seat
  // three); a stranger with a computed id gets the same 404 a club gives.
  if (view.practiceFor && !(await resolveSession(c.env, sessionToken(c.req.raw)))) return c.json({ error: 'no such table' }, 404);
  const gate = await clubGate(c, view.club);
  return gate ?? c.json(view as Record<string, unknown>);
});

/**
 * WHAT WOULD A GOOD PLAYER DO IN MY SEAT, and why.
 *
 * Three gates, and each closes a different door. A SESSION, because advice is about a seat and a
 * seat belongs to somebody. The CLUB gate, because a club's table is not a thing a stranger may
 * read anything about. And the seat itself: you may ask about YOUR OWN seat and no other — a coach
 * that answered about the seat across the table would be a device for reading somebody's hand.
 *
 * The coach sees only what the seat sees. That is enforced inside the game, not here, and it is the
 * property that makes this teaching rather than cheating.
 */
app.get('/tables/:id/advice', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const tableId = c.req.param('id');
  const gate = await clubGate(c, await tableClub(c.env, tableId));
  if (gate) return gate;

  const res = await table(c.env, tableId).fetch('https://table/view');
  if (!res.ok) return passthrough(res);
  const view = (await res.json()) as { view?: { seats?: { seat: number; playerId: string }[] } };
  const mine = (view.view?.seats ?? []).find((s) => s.playerId === session.playerId);
  // Not seated is not an error worth a 403: you are watching, and there is nothing to advise.
  if (!mine) return c.json({ error: 'you are not seated at this table' }, 404);

  // WHO IS ASKING travels with it, because the adviser is theirs: two people at one table may each
  // have named their own, and neither should get the other's.
  return passthrough(
    await table(c.env, tableId).fetch(
      `https://table/advice?seat=${mine.seat}&player=${encodeURIComponent(session.playerId)}` +
        // The person's own question, when they asked one. Carried, never read.
        (c.req.query('q') ? `&q=${encodeURIComponent(c.req.query('q') as string)}` : ''),
    ),
  );
});

/**
 * NAME THE AGENT THAT ADVISES YOU HERE — your own, not the house's.
 *
 * The card room's coach is one strategy, the same for everybody. A person's own agent carries THEIR
 * style, written as their own artifacts somewhere this card room never reaches; naming it here says
 * where to ask, and nothing else. The reasoning stays theirs.
 *
 * Refused unless the agent's card advertises the ADVISE skill for this table's game — a skill
 * deliberately separate from `*.act`, so an agent that only ever meant to talk is never handed a turn.
 *
 * `DELETE` goes back to the house coach.
 */
/**
 * YOUR OWN AGENT, by name — so the coach panel can offer it without anybody typing.
 *
 * The session holds the Smart Agent's ADDRESS (asserted by the Home's id_token) and whatever the Home
 * put in `agent_name`, which for an account with no handle is a profile name like "Alice Okoro". A
 * profile name is not something an agent card can be fetched for. The registry's reverse record is,
 * so this answers with that when there is one, and says plainly when there is not.
 */
app.get('/me/agent', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  // Only a Home session has an agent at all: a dev session is a name and nothing behind it.
  const home = 'address' in session ? (session as { address?: string; agentName?: string }) : null;
  const address = home?.address ?? null;
  const resolved = address ? await nameOfAgent(c.env, address) : null;
  // The asserted field is offered ONLY when it is shaped like a name: "Alice Okoro" would otherwise
  // be fetched as `agents.faithnet.io/Alice%20Okoro/…`, which is what happened.
  const asserted = home?.agentName && looksLikeAgentName(home.agentName) ? home.agentName : null;
  return c.json({ address, agentName: resolved ?? asserted, asserted: home?.agentName ?? null });
});

/**
 * YOUR OWN AGENT'S CARD, for the two acts below that are not about any one table. The session's address,
 * reverse-resolved to a name, fetched as a card, checked for the skill the act needs — the same three steps
 * naming an adviser at a table runs, without the table.
 */
async function myAgentCard(c: Context<{ Bindings: Env }>, skill: string): Promise<{ ok: true; agentName: string; endpoint: string; displayName: string } | { ok: false; status: number; error: string }> {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return { ok: false, status: 401, error: 'unauthenticated' };
  const home = 'address' in session ? (session as { address?: string; agentName?: string }) : null;
  const address = home?.address ?? null;
  const agentName = (address ? await nameOfAgent(c.env, address) : null) ?? (home?.agentName && looksLikeAgentName(home.agentName) ? home.agentName : null);
  if (!agentName) return { ok: false, status: 404, error: 'this card room could not find a name for your agent — sign in through your Home' };
  let base: string;
  try { base = resolveAgentBase(c.env, agentName); } catch (e) { return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e) }; }
  const card = await fetchAgentCard(base, a2aTimeoutMs(c.env));
  if (!card.ok) return { ok: false, status: 400, error: card.error };
  // The served card OR the chain: a released card is a snapshot, and the agent answers what its profile says.
  if (!hasActSkill(card.card, skill) && !(address && (await advertisedOnChain(c.env, address)).includes(skill))) {
    return { ok: false, status: 400, error: `${agentName} does not advertise the ${skill} skill` };
  }
  return { ok: true, agentName, endpoint: messageUrlFromCard(card.card, base), displayName: card.card.name ?? agentName };
}

/**
 * HOW HAVE I BEEN PLAYING, OVER THE LAST N DAYS — not about any one table. Your own question, to your own
 * agent, which forwards it to the coach you hired with your study grant; the coach reads the hands the card
 * room recorded to your vault over that span (seven days unless you say) and answers in its own name. The
 * card room carries the question and shows the answer; it holds no hands of yours and reads none.
 */
app.get('/me/review', async (c) => {
  // PER GAME (`?game=canasta`): the review skill, the coach the person's agent consults, and the cabinet
  // the coach reads are each the game's own; hold'em unless said.
  const game = cardRoomGameOf(c.req.query('game'));
  const skills = CARD_ROOM_SKILLS[game];
  const me = await myAgentCard(c, skills.review);
  if (!me.ok) return c.json({ error: me.error }, me.status as 400);
  const days = Math.min(30, Math.max(1, Number(c.req.query('days') ?? 7) || 7));
  const q = (c.req.query('q') ?? '').trim();
  const unit = game === 'canasta' ? 'rounds' : 'hands';
  const asked = await callReview(me.endpoint, { skill: skills.review, tableId: '', seat: -1, question: q || `How have I been playing over the last ${days} days? Name my two biggest leaks from my recorded ${unit}, with the count behind each, and one thing to change next session.`, days }, a2aReviewTimeoutMs(c.env), c.env);
  if (!asked.ok) return c.json({ error: `${me.displayName} could not review — ${asked.error}` }, 502);
  const { source: coach, ...review } = asked.output;
  return c.json({ ...review, days, game, source: { agent: me.agentName, displayName: me.displayName, ...(coach ? { coach } : {}) } });
});

/**
 * GIVE YOUR COACH YOUR PAST HANDS. Every hand you were dealt in the last N days, at every table this card
 * room can find you at — your practice table, the pickup lobby's, your clubs' — sent to YOUR OWN AGENT as
 * `poker.record`, one per hand, through each table's outbox (retried, never lost, never awaited here). Your
 * agent files them in your vault by the day they were played; the coach you hired reads them there under
 * your grant. The card room sends and forgets: it keeps no copy of yours and the coach gets nothing from it.
 */
app.post('/me/hands/backfill', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const game = cardRoomGameOf(c.req.query('game'));
  const me = await myAgentCard(c, CARD_ROOM_SKILLS[game].record);
  if (!me.ok) return c.json({ error: me.error }, me.status as 400);
  const days = Math.min(30, Math.max(1, Number(c.req.query('days') ?? 7) || 7));
  const since = Date.now() - days * 86_400_000;
  // The game's practice table plus every table around the person; a table of the OTHER game answers its
  // own backfill with its own record skill, which the agent advertises too, so nothing is sent twice.
  const ids = new Set<string>([await practiceTableId(session.playerId, game), ...(await tablesAround(c.env, session.playerId, 'backfill'))]);
  const tables: Array<{ tableId: string; found: number; queued: number }> = [];
  for (const tableId of [...ids].slice(0, 40)) {
    try {
      const res = await table(c.env, tableId).fetch('https://table/record-backfill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: session.playerId, endpoint: me.endpoint, since, ...(c.req.query('again') === '1' ? { again: true } : {}) }) });
      if (!res.ok) continue;
      const r = (await res.json()) as { found?: number; queued?: number };
      if (r.found) tables.push({ tableId, found: r.found ?? 0, queued: r.queued ?? 0 });
    } catch (e) {
      console.error('backfill: table refused', tableId, e);
    }
  }
  const queued = tables.reduce((n, t) => n + t.queued, 0);
  const found = tables.reduce((n, t) => n + t.found, 0);
  const unit = game === 'canasta' ? 'round' : 'hand';
  return c.json({ ok: true, days, game, agent: me.agentName, tables: tables.length, found, queued, note: queued ? `${queued} ${unit}${queued === 1 ? '' : 's'} on the way to ${me.agentName}; ask for a review in a minute or two.` : found ? `those ${unit}s were already sent.` : `no ${unit}s of yours in the last ${days} days at the tables this card room knows.` });
});

/**
 * COACHES FOR HIRE — the coaching SERVICES this card room knows, each read from its card. A coach is a
 * service somebody custodies (`bob-coach.svc`), never a person; the card room lists it, and the hiring is
 * done at the person's own Home (the specialist in their playbook, the study grant they sign). Nothing here
 * grants anything.
 */
app.get('/coaches', async (c) => {
  // PER GAME: a coach knows one game, and is listed for the one whose advise skill its card advertises.
  const game = cardRoomGameOf(c.req.query('game'));
  const skills = CARD_ROOM_SKILLS[game];
  const names = (c.env.COACH_SERVICES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /\.svc$/.test(s));
  const coaches = await Promise.all(names.map(async (agentName) => {
    try {
      // A coach is an ESTATE service (`bob-coach.svc` at `bob-coach-svc.<zone>`), not a house persona: the
      // house base — where `resolveAgentBase` sends a bare `.svc` — serves only the house's own bots.
      const zone = (c.env.AGENT_CARD_ZONE ?? '').trim();
      const base = zone ? `${zone === 'localhost' || zone.endsWith('.localhost') ? 'http' : 'https'}://${agentNameToHost(agentName, zone)}` : resolveAgentBase(c.env, agentName);
      const card = await fetchAgentCard(base, a2aTimeoutMs(c.env));
      if (!card.ok || !hasActSkill(card.card, skills.advise)) return null;
      const listed = (card.card.skills ?? []).filter((s): s is NonNullable<typeof s> => s != null);
      const ids = listed.map((s) => s.id);
      const advise = listed.find((s) => s.id === skills.advise);
      return { agentName, displayName: card.card.name ?? agentName, description: advise?.description ?? card.card.description ?? '', skills: ids, reviews: ids.includes(skills.review), game };
    } catch { return null; }
  }));
  return c.json({ game, coaches: coaches.filter((x): x is NonNullable<typeof x> => x !== null), hireable: !!(c.env.HOME_COACH_TEMPLATE ?? '').trim() });
});

/**
 * THE RETURN LEG OF HIRING A COACH. The person ran the `coach-hire` ceremony at their Home; the Worker
 * exchanges the code, checks the identity is this session's, and records nothing — the arrangement lives
 * in the person's playbook and their grant, at their Home. The answer is for the screen.
 */
app.post('/me/coach', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = HomeAuthRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  let result;
  try {
    result = await completeCoachCeremony(c.env, parsed.data);
  } catch (e) {
    if (e instanceof HomeAuthError) return c.json({ error: e.reason }, 401);
    console.error('coach-hire', e);
    return c.json({ error: 'the coach could not be hired' }, 401);
  }
  if (homePlayerId(result.identity.address) !== session.playerId) return c.json({ error: 'that ceremony was run by somebody else' }, 403);
  return c.json({ ok: true, coach: result.coach });
});

/**
 * DO YOU HAVE A COACH, AND HAVE YOU BEEN ASKED — read from your own agent, which answers from your playbook
 * and your own preferences record. The card room keeps nothing: the "asked once" lives in your vault, so a
 * different browser or a different card room deployment does not ask again.
 */
app.get('/me/coach', async (c) => {
  const game = cardRoomGameOf(c.req.query('game'));
  const me = await myAgentCard(c, CARD_ROOM_SKILLS[game].coach);
  if (!me.ok) {
    // AN AGENT WITHOUT THE CARD-ROOM SKILLS has no coach either — it cannot even be asked. Said as a fact with
    // the agent's name (a 200, not a refusal), so the screen can still offer a coach and say what the agent
    // is missing; the "asked once" then has to live in the browser until the skills are on the card.
    if (me.status === 400 && /does not advertise/.test(me.error)) {
      const session = await resolveSession(c.env, sessionToken(c.req.raw));
      const home = session && 'address' in session ? (session as { address?: string; agentName?: string }) : null;
      const agentName = (home?.address ? await nameOfAgent(c.env, home.address) : null) ?? (home?.agentName && looksLikeAgentName(home.agentName) ? home.agentName : null);
      console.log(`[me/coach] ${game} ${agentName ?? 'nameless'}: no skills on the card`);
      return c.json({ agent: agentName, coach: null, asked: null, advertises: false, note: me.error, game });
    }
    // WHY A PERSON HAS NO COACH is the commonest question at the door, so the answer is in the tail (no
    // secrets: a game, a status and the reason the card room gave).
    console.log(`[me/coach] ${game} ${me.status}: ${me.error}`);
    return c.json({ error: me.error, coach: null, asked: null, agent: null, game }, me.status as 400);
  }
  const r = await callCoachStatus(me.endpoint, { skill: CARD_ROOM_SKILLS[game].coach }, a2aTimeoutMs(c.env), c.env);
  if (!r.ok) { console.log(`[me/coach] ${game} ${me.agentName}: status refused — ${r.error}`); return c.json({ error: r.error, coach: null, asked: null, agent: me.agentName, game }, 502); }
  console.log(`[me/coach] ${game} ${me.agentName}: coach ${r.output.coach ?? 'none'} grant ${r.output.hasGrant ? 'yes' : 'no'}`);
  return c.json({ ...r.output, agent: me.agentName, advertises: true, game });
});

/** You answered the coach question — hired, later, or no. Written to your vault by your own agent; asked once. */
app.post('/me/coach/asked', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { answer?: unknown; game?: unknown } | null;
  const answer = body?.answer === 'hired' || body?.answer === 'later' || body?.answer === 'no' ? body.answer : null;
  if (!answer) return c.json({ error: 'answer must be hired, later or no' }, 400);
  const game = cardRoomGameOf(body?.game);
  const me = await myAgentCard(c, CARD_ROOM_SKILLS[game].coach);
  if (!me.ok) return c.json({ error: me.error }, me.status as 400);
  const r = await callCoachStatus(me.endpoint, { skill: CARD_ROOM_SKILLS[game].coach, answered: answer }, a2aTimeoutMs(c.env), c.env);
  if (!r.ok) return c.json({ error: r.error }, 502);
  return c.json({ ...r.output, agent: me.agentName });
});

/** Whose advice you are getting at this table — yours to ask about, and nobody else's. */
app.get('/tables/:id/adviser', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const tableId = c.req.param('id');
  const gate = await clubGate(c, await tableClub(c.env, tableId));
  if (gate) return gate;
  return passthrough(
    await table(c.env, tableId).fetch(`https://table/adviser?player=${encodeURIComponent(session.playerId)}`),
  );
});

/**
 * HOW HAVE I BEEN PLAYING — the person's own question about their past hands, in their own words,
 * asked of the agent they named. That agent forwards it to their coach with their study grant; the
 * coach reads the hands this table recorded to their vault and answers in its own name. Asked only
 * when the person asks: nothing here runs at a hand's end, and the house coach keeps no hands.
 */
app.get('/tables/:id/review', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const tableId = c.req.param('id');
  const gate = await clubGate(c, await tableClub(c.env, tableId));
  if (gate) return gate;
  const res = await table(c.env, tableId).fetch('https://table/view');
  if (!res.ok) return passthrough(res);
  const view = (await res.json()) as { view?: { seats?: { seat: number; playerId: string }[] } };
  const mine = (view.view?.seats ?? []).find((s) => s.playerId === session.playerId);
  if (!mine) return c.json({ error: 'you are not seated at this table' }, 404);
  return passthrough(
    await table(c.env, tableId).fetch(
      `https://table/review?seat=${mine.seat}&player=${encodeURIComponent(session.playerId)}` +
        (c.req.query('q') ? `&q=${encodeURIComponent(c.req.query('q') as string)}` : '') +
        (c.req.query('days') ? `&days=${encodeURIComponent(c.req.query('days') as string)}` : ''),
    ),
  );
});

app.post('/tables/:id/adviser', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const tableId = c.req.param('id');
  const gate = await clubGate(c, await tableClub(c.env, tableId));
  if (gate) return gate;

  const body = (await c.req.json().catch(() => null)) as { agentName?: unknown; endpoint?: unknown } | null;
  const agentName = typeof body?.agentName === 'string' ? body.agentName.trim() : '';
  if (!agentName) return c.json({ error: 'name the agent that should advise you' }, 400);

  const got = await table(c.env, tableId).fetch('https://table/summary');
  if (!got.ok) return c.json({ error: 'no such table' }, 404);
  const game = ((await got.json()) as { game?: string }).game ?? 'poker';
  const skill = game === 'canasta' ? CANASTA_ADVISE_SKILL : POKER_ADVISE_SKILL;
  const recordSkill = game === 'canasta' ? CANASTA_RECORD_SKILL : POKER_RECORD_SKILL;
  const reviewSkill = game === 'canasta' ? CANASTA_REVIEW_SKILL : POKER_REVIEW_SKILL;

  let base: string;
  try {
    base = resolveAgentBase(c.env, agentName, typeof body?.endpoint === 'string' ? body.endpoint : undefined);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const card = await fetchAgentCard(base, a2aTimeoutMs(c.env));
  if (!card.ok) return c.json({ error: card.error }, 400);
  // WHAT THE AGENT ANSWERS: its served card, OR its on-chain profile — a released card is a snapshot, and a
  // person whose Home just put the card room's skills on their agent would otherwise be refused by name.
  const onChain = looksLikeAgentName(agentName) ? await advertisedOnChain(c.env, (await addressOfAgent(c.env, agentName)) ?? '') : [];
  const advertisesHere = (id: string) => hasActSkill(card.card, id) || onChain.includes(id);
  // Refused here rather than at the first question, so nobody discovers mid-hand that their adviser
  // cannot answer.
  if (!advertisesHere(skill)) {
    return c.json({ error: `${agentName} does not advertise the ${skill} skill` }, 400);
  }

  return passthrough(
    await table(c.env, tableId).fetch('https://table/adviser', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The endpoint is the CARD's, not one built from the hostname: a Home agent answers at the
      // estate's edge and refuses its own host.
      // WHAT ELSE THE CARD ANSWERS, read once here: a hand is RECORDED to an agent that advertises
      // `*.record` (a person's own agent, which keeps it in their vault) and never to one that only
      // advises; a REVIEW is offered where `*.review` is. Neither is required to advise.
      body: JSON.stringify({ playerId: session.playerId, agentName, endpoint: messageUrlFromCard(card.card, base), displayName: card.card.name ?? agentName, records: advertisesHere(recordSkill), reviews: advertisesHere(reviewSkill) }),
    }),
  );
});

app.delete('/tables/:id/adviser', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  return passthrough(
    await table(c.env, c.req.param('id')).fetch('https://table/adviser', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: session.playerId }),
    }),
  );
});

app.get('/tables/:id/hands/:handNo', async (c) => {
  const n = Number(c.req.param('handNo'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'bad hand number' }, 400);
  const tableId = c.req.param('id');
  // A completed hand is public PROOF at a pickup table — the seed reveal is what makes the shuffle
  // checkable. At a club table it is the club's history, and follows the club's own gate.
  const gate = await clubGate(c, await tableClub(c.env, tableId));
  if (gate) return gate;
  return passthrough(await table(c.env, tableId).fetch(`https://table/hand/${n}`));
});

/**
 * Seat an A2A agent. Requires a session (seating a bot is a table action like any other), then
 * resolves the agent, fetches its card, and refuses anything that is not reachable or does not
 * advertise `poker.act` — so a bad seat fails here rather than as a silent turn timeout later.
 */
app.post('/tables/:id/seat-agent', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  // Seating a bot is a table action, and at a club table it is a MEMBER's table action. Without this
  // any signed-in stranger could put an agent in somebody else's game.
  const gate = await clubGate(c, await tableClub(c.env, c.req.param('id')));
  if (gate) return gate;
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
  // The skill THIS TABLE'S GAME asks agents to answer on. An agent that plays a different game is
  // refused here rather than seated and then handed turns it cannot read.
  const skill = await tableActSkill(c.env, c.req.param('id'));
  if (!hasActSkill(card.card, skill)) {
    return c.json({ error: `agent ${req.agentName} does not advertise the ${skill} skill` }, 400);
  }

  const body: SeatAgentBody = {
    seat: req.seat,
    buyIn: req.buyIn,
    agentName: req.agentName,
    endpoint: messageUrlFromCard(card.card, base),
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

/**
 * OPERATOR: retire a table.
 *
 * There was no way to close a table at all, so an unplayable one — a table settling in a currency
 * the card room no longer uses, a test table, a table nobody will ever sit at again — stayed in the
 * lobby forever. This is the way, and it is gated exactly as the seat clear is: the same
 * `x-operator-token`, the same constant-time compare, the same 503 on a deployment that has set no
 * secret. There is no admin role, and no session reaches this.
 *
 * The one condition about the TABLE is that nobody is seated at it, checked in the DO where the
 * truth about the seats lives: a seated table holds somebody's chips, and at a settled table those
 * chips are their money. The refusal says so and says how many seats are in the way, so the fix
 * ("stand them up first") is in the answer rather than in someone's head.
 */
app.delete('/tables/:id', async (c) => {
  /**
   * WHOEVER OPENED IT MAY CLOSE IT — and so may a host of the club it belongs to.
   *
   * This was operator-only, and an operator token is a shared secret held by whoever runs the
   * deployment. So a person who opened a table by mistake, or finished a game, had no way to remove
   * it and it stayed in the public list for good. That is the same gap clubs had until they got a
   * retire route, and it produces the same result: a list nobody can tidy.
   *
   * Three roads in, and the operator's is unchanged — it is the one that still works on a table
   * opened before tables recorded who opened them, and the one an operator needs for a table whose
   * owner has gone.
   *
   * The CONDITION is the table's own and is enforced in the object either way: nobody may be seated.
   * A seated table holds somebody's chips, and at a settled table those chips are their money.
   */
  const tableId = c.req.param('id');
  const operator = await checkOperator(c.env, c.req.raw);
  if (!operator.ok) {
    const session = await resolveSession(c.env, sessionToken(c.req.raw));
    // No session and no token: answer as the operator gate did, saying which gate closed and nothing
    // about the token itself.
    if (!session) return c.json({ error: operator.reason, refused: 'operator' }, operator.status);

    const got = await table(c.env, tableId).fetch('https://table/summary');
    if (!got.ok) return c.json({ error: 'no such table' }, 404);
    const meta = (await got.json()) as { createdBy?: string; club?: string };

    let mayClose = meta.createdBy !== undefined && meta.createdBy === session.playerId;
    if (!mayClose && meta.club) {
      // A club's table is the club's, so its host may close it even if somebody else opened it.
      const agent = agentOf(session);
      const answer = agent ? await standingAt(c.env, meta.club, agent) : null;
      mayClose = answer?.standing === 'host';
    }
    if (!mayClose) {
      return c.json(
        {
          error: meta.createdBy
            ? 'only whoever opened this table, or a host of its club, can close it'
            : 'this table was opened before tables recorded who opened them, so only an operator can close it',
        },
        403,
      );
    }
  }
  const res = await lobby(c.env, c.req.query('club') ?? c.req.query('circle')).fetch('https://lobby/retire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId }),
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
  // SEAT ADMISSION, decided here and not in the table. The Worker verifies the caller and derives
  // their standing at the club; the object is handed the answer. A stranger cannot sit at a club
  // table, and cannot spectate one either — watching a private game is being at it.
  const meta = await tableMeta(c.env, c.req.param('id'));
  const clubId = meta?.club;
  // The same rule as the view: a practice table's socket needs a signed-in person.
  if (meta?.practiceFor && !session) return c.json({ error: 'no such table' }, 404);
  if (clubId) {
    const agent = session ? agentOf(session) : null;
    const answer = agent ? await standingAt(c.env, clubId, agent) : null;
    if (!answer || !belongs(answer.standing)) return c.json({ error: 'no such table' }, 404);
  }
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
