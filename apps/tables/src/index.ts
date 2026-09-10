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
 *   POST /clubs CreateClubRequest       → ClubSummary (201)         (auth required)
 *   GET  /clubs                         → the clubs this player has standing in (auth required)
 *   GET  /clubs/:clubId                 → ClubView, or 404 to anyone with no standing (auth required)
 *   GET  /clubs/:clubId/members         → the roster (auth required; members and hosts)
 *   POST /clubs/:clubId/members InviteMemberRequest → adds one (auth required; HOSTS only)
 *   DELETE /clubs/:clubId/members/:member → removes one (auth required; HOSTS only)
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
  CreateClubRequestSchema,
  CreateTableRequestSchema,
  DevSessionRequestSchema,
  ClubInviteRequestSchema,
  InviteMemberRequestSchema,
  POKER_ACT_SKILL,
  SeatAgentRequestSchema,
  type ClubInvite,
  type ClubView,
  type KnownPerson,
  type SeatStandUpFailure,
  type SeatStoodUp,
  SetScheduleRequestSchema,
  icsCalendar,
  type ClubStanding,
  type Night,
  type SignOutResult,
  type TableSummary,
} from '@pokernight/protocol';
import { agentKindFromCard, fetchAgentCard, hasActSkill, resolveAgentBase } from './a2a.js';
import { HOME_SESSION_TTL_MS, dropSessionRecord, mintDevSession, mintHomeSessionToken, putSessionRecord, resolveSession } from './auth.js';
import { a2aTimeoutMs, allowedOrigins, isDevAuth, siteOrigin, type Env } from './env.js';
import { OPERATOR_HEADER, checkOperator } from './operator.js';
import {
  BUY_IN_TEMPLATE,
  CLUB_PURPOSE,
  CLUB_TEMPLATE,
  HomeAuthError,
  cleanProfileName,
  completeCharterCeremony,
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
import { CLUB_ID_RE, belongs, clubStub, memberIdOf, resolveInvitee, standingAt } from './clubs.js';
import { mailInvite } from './invite-mail.js';
import { gameFor } from './games.js';
import { ensurePracticeTable } from './practice.js';
import { feedPlayer, feedToken } from './feed-token.js';
import type { AddMemberRequest, ClaimInviteRequest, CreateInviteRequest, InitClubRequest } from './club-do.js';

export { PokerTableDO } from './table-do.js';
export { LobbyDO } from './lobby-do.js';
export { SessionDO } from './session-do.js';
export { ClubDO, ClubIndexDO } from './club-do.js';

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
      /** …and the one that charters a club as its own `.workspace` agent, with the `purpose` its
       *  link carries at the Home so a person can see WHY that agent exists in their list. */
      clubTemplate: CLUB_TEMPLATE,
      clubPurpose: CLUB_PURPOSE,
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
async function standUpEverywhere(env: Env, playerId: string): Promise<{ stoodUp: SeatStoodUp[]; failed: SeatStandUpFailure[] }> {
  const stoodUp: SeatStoodUp[] = [];
  const failed: SeatStandUpFailure[] = [];
  const lobbies: (string | undefined)[] = [undefined];
  try {
    const res = await env.CLUB_INDEX.get(env.CLUB_INDEX.idFromName(playerId)).fetch('https://index/list');
    if (res.ok) {
      const body = (await res.json()) as { clubs?: { clubId: string }[] };
      for (const c of body.clubs ?? []) lobbies.push(c.clubId);
    }
  } catch (e) {
    // Not fatal: the pickup lobby is still swept, and saying so beats sweeping nothing.
    console.error('sign-out: could not list clubs', e);
  }
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

app.post('/dev/session', async (c) => {
  if (!isDevAuth(c.env)) return c.json({ error: 'dev auth disabled' }, 404);
  const parsed = DevSessionRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return c.json(await mintDevSession(c.env, parsed.data.name));
});

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
  const res = await table(env, tableId).fetch('https://table/summary');
  if (!res.ok) return undefined;
  return ((await res.json()) as { club?: string }).club;
}

type Gate = { clubId: string; playerId: string; standing: 'host' | 'member' } | { refused: Response };

/**
 * Resolve the caller and require at least `need` standing at the club named in the path.
 *
 * Both failures answer 404 rather than 403 on purpose: a stranger must not be able to tell a club
 * they are not in from a club that is not there. A MEMBER who needs to be a HOST is the one case
 * that gets a real refusal, because they already know the club exists and the useful answer is which
 * authority they are missing.
 */
async function requireStanding(c: Context<{ Bindings: Env }>, need: 'host' | 'member'): Promise<Gate> {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return { refused: c.json({ error: 'unauthenticated' }, 401) };
  const clubId = c.req.param('clubId') ?? '';
  if (!CLUB_ID_RE.test(clubId)) return { refused: c.json({ error: 'no such club' }, 404) };
  const answer = await standingAt(c.env, clubId, session.playerId);
  if (!answer || !belongs(answer.standing)) return { refused: c.json({ error: 'no such club' }, 404) };
  if (need === 'host' && answer.standing !== 'host') {
    return { refused: c.json({ error: `only a host of this club can do that — ${answer.because}` }, 403) };
  }
  return { clubId, playerId: session.playerId, standing: answer.standing as 'host' | 'member' };
}

/**
 * The gate a TABLE puts in front of itself once it belongs to a club: `null` to allow, a 404 to
 * refuse. A pickup table (no club) passes straight through, which is every table that exists today.
 */
async function clubGate(c: Context<{ Bindings: Env }>, clubId: string | undefined): Promise<Response | null> {
  if (!clubId) return null;
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  const answer = await standingAt(c.env, clubId, session?.playerId ?? null);
  return !answer || !belongs(answer.standing) ? c.json({ error: 'no such table' }, 404) : null;
}

/**
 * The two gates every club route needs, said once.
 *
 * `clubMember` is "may you see this club at all"; `clubHost` is "may you change it". Both resolve the
 * session, DERIVE standing from the club's own roster, and refuse in the two different ways the whole
 * design turns on:
 *
 *   NO STANDING → 404, identical to a club that does not exist, because confirming that a club is
 *   real is confirming a fact about other people's private arrangements.
 *   MEMBER, where a host is needed → 403 BY NAME. They can already see the club, so telling them who
 *   may do this leaks nothing, and "only a host can" is a sentence somebody can act on.
 */
type ClubGate = { refused: Response } | { clubId: string; session: { playerId: string; name?: string }; standing: ClubStanding };

async function clubMember(c: Context<{ Bindings: Env }>): Promise<ClubGate> {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return { refused: c.json({ error: 'unauthenticated' }, 401) };
  const clubId = c.req.param('clubId') ?? '';
  const answer = await standingAt(c.env, clubId, session.playerId);
  if (!answer || !belongs(answer.standing)) return { refused: c.json({ error: 'no such club' }, 404) };
  return { clubId, session, standing: answer.standing };
}

async function clubHost(c: Context<{ Bindings: Env }>): Promise<ClubGate> {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate;
  if (gate.standing !== 'host') {
    return { refused: c.json({ error: `only a host of this club can do that — you are on its roster, not running it` }, 403) };
  }
  return gate;
}

/* ------------------------------------------------------------------ clubs */

/**
 * A club is the group a poker night belongs to (`docs/WORKSPACES.md`). Every route here resolves the
 * session, DERIVES the caller's standing from the club's own roster, and then decides — and every
 * refusal says what is missing, because "you are not a member of Thursday Night" is a sentence
 * somebody can act on and a bare 403 is not.
 *
 * A club nobody has standing in is INDISTINGUISHABLE from one that does not exist: 404, never 403.
 * Confirming that a club exists is confirming a fact about other people's private arrangements.
 */
app.post('/clubs', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = CreateClubRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  const clubId = crypto.randomUUID();
  const init: InitClubRequest = {
    clubId,
    name: parsed.data.name,
    createdBy: session.playerId,
    createdByName: session.name,
  };
  const res = await clubStub(c.env, clubId).fetch('https://club/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(init),
  });
  return passthrough(res);
});

app.get('/clubs', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const res = await c.env.CLUB_INDEX.get(c.env.CLUB_INDEX.idFromName(session.playerId)).fetch('https://index/list');
  return passthrough(res);
});

app.get('/clubs/:clubId', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const clubId = c.req.param('clubId') ?? '';
  if (!CLUB_ID_RE.test(clubId)) return c.json({ error: 'no such club' }, 404);
  const res = await clubStub(c.env, clubId).fetch(`https://club/view?player=${encodeURIComponent(session.playerId)}`);
  return passthrough(res);
});

/**
 * WHAT THE HOST WANTS SAID about their club.
 *
 * This is the invitation's content. The Home's mailer composes the email itself and takes only an
 * address, a link and a name — so a host's own words cannot ride in the mail, and this is what the
 * link opens onto instead. Which is the better place for it: mail clients strip formatting and block
 * images, and a page can show the schedule and the next few dates as they actually are.
 */
app.put('/clubs/:clubId/welcome', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const body = (await c.req.json().catch(() => null)) as { welcome?: unknown } | null;
  if (typeof body?.welcome !== 'string') return c.json({ error: 'welcome must be text' }, 400);
  return passthrough(
    await clubStub(c.env, gate.clubId).fetch('https://club/welcome', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ welcome: body.welcome }),
    }),
  );
});

/**
 * THE CLUB'S NIGHTS, AS A CALENDAR SUBSCRIPTION.
 *
 * "A recurring calendar invite that shows up in their calendar with a link that takes them right into
 * the game." A calendar client fetches this every half hour from a phone with no session and no way
 * to be prompted for anything, so the URL carries the authority — see `feed-token.ts` for what that
 * token is and is not.
 *
 * MEMBERSHIP IS STILL CHECKED, every fetch. The token says who is asking; the club says whether they
 * still belong. So a feed stops answering when somebody leaves, with nothing to revoke and nothing to
 * remember to clean up.
 *
 * Discrete events rather than one RRULE, and why, is in `packages/protocol/src/ics.ts`.
 */
app.get('/clubs/:clubId/calendar/:token', async (c) => {
  const clubId = c.req.param('clubId') ?? '';
  // `.ics` on the end is what makes a phone open this with a calendar rather than a text viewer.
  const token = (c.req.param('token') ?? '').replace(/\.ics$/, '');
  const player = await feedPlayer(c.env, clubId, token);
  if (!player) return c.json({ error: 'no such calendar' }, 404);
  const answer = await standingAt(c.env, clubId, player);
  if (!answer || !belongs(answer.standing)) return c.json({ error: 'no such calendar' }, 404);

  const sum = await clubStub(c.env, clubId).fetch('https://club/summary');
  if (!sum.ok) return c.json({ error: 'no such calendar' }, 404);
  const club = (await sum.json()) as { name: string; welcome?: string };
  const got = await clubStub(c.env, clubId).fetch('https://club/nights?limit=50');
  const nights = got.ok ? ((await got.json()) as { nights: Night[] }).nights : [];

  const site = siteOrigin(c.env);
  // THE LINK THAT OPENS THE GAME. The club's page: it is where that night's table appears when it is
  // opened, and it is a link that is true today rather than one pointing at a table id that does not
  // exist yet.
  const url = `${site}/#/clubs/${encodeURIComponent(clubId)}`;
  const body = icsCalendar({
    name: club.name,
    ...(club.welcome ? { description: club.welcome } : {}),
    domain: new URL(site).hostname,
    nights: nights.map((n) => ({
      nightId: n.nightId,
      startsAt: n.startsAt,
      // A phone's calendar shows the SUMMARY and often nothing else, so the game goes in it. "Thursday
      // Night" and "Thursday Night — Canasta" are the difference between a reminder and a decision.
      title: n.game ? `${n.title ?? club.name} — ${gameName(n.game)}` : (n.title ?? club.name),
      description: `${club.name} at ${site.replace(/^https?:\/\//, '')}\n\n${club.welcome ?? ''}`.trim(),
      url,
      ...(n.status ? { status: n.status } : {}),
    })),
  });
  // `?download=1` asks for a FILE rather than a subscription. It matters because the two are
  // different answers to different questions: a subscription keeps up with the club and is invisible
  // in Google Calendar for hours, and a download appears the moment it is opened and never changes
  // again. `attachment` is what makes a browser save it rather than show it as text — and the
  // `download` attribute on a link cannot do that job here, because the feed is on another origin.
  const asFile = c.req.query('download') === '1';
  const file = `${club.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'club'}.ics`;
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `${asFile ? 'attachment' : 'inline'}; filename="${file}"`,
      // Never cached by anything in between: a night called off has to reach a subscriber.
      'cache-control': 'no-store',
    },
  });
});

/** What a game is called, for a calendar entry. The client has the full list; this needs the names. */
function gameName(game: string): string {
  return game === 'canasta' ? 'Canasta' : game === 'poker' ? "Texas Hold'em" : game;
}

/** The subscription URL for the caller's own feed of this club. A member's, not a host's, to have. */
app.get('/clubs/:clubId/calendar', async (c) => {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  let token: string;
  try {
    token = await feedToken(c.env, gate.clubId, gate.session.playerId);
  } catch {
    // A deployment with no signing secret has no feeds, and says so rather than handing out a URL
    // that will 404 forever.
    return c.json({ error: 'this card room cannot publish calendars' }, 503);
  }
  // This Worker's own origin, because that is what a calendar client will fetch.
  const api = new URL(c.req.url).origin;
  const url = `${api}/clubs/${encodeURIComponent(gate.clubId)}/calendar/${token}.ics`;
  return c.json({
    url,
    // `webcal:` is what makes a phone offer to SUBSCRIBE rather than to import once — the difference
    // between a calendar that keeps up with the club and eight events frozen at the moment of download.
    webcal: url.replace(/^https?:/, 'webcal:'),
  });
});

/**
 * WHEN THIS CLUB MEETS, and the nights that come of it.
 *
 * READING is a member's right and SETTING is a host's — the same split as every other club route, and
 * the same 404 for anybody with no standing, because a club they are not in must stay
 * indistinguishable from one that does not exist.
 *
 * The schedule is a RULE and stores a wall clock; a night is one OCCURRENCE and stores an instant
 * resolved once, at materialisation, and never resolved again (`packages/protocol/src/when.ts`).
 * Nights are materialised AHEAD, because an invitation cannot be sent to an occurrence that does not
 * exist and "who is coming on the 12th" cannot be asked of a formula.
 *
 * Everything the materialiser cannot honour is refused by NAME at this boundary rather than stored:
 * a schedule accepted and silently misread produces nights at the wrong time for months, and nobody
 * looks at the schedule again because it was accepted.
 */
app.get('/clubs/:clubId/schedule', async (c) => {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  return passthrough(await clubStub(c.env, gate.clubId).fetch('https://club/schedule'));
});

app.put('/clubs/:clubId/schedule', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const parsed = SetScheduleRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  return passthrough(
    await clubStub(c.env, gate.clubId).fetch('https://club/schedule', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...parsed.data, createdBy: gate.session.playerId }),
    }),
  );
});

/**
 * Stop meeting on a rule.
 *
 * The nights it already made are LEFT ALONE. People were told about those; withdrawing a recurrence
 * is not the same as calling off a Thursday, and deleting somebody's night because the host edited a
 * rule is exactly the behaviour that makes people stop trusting a calendar.
 */
app.delete('/clubs/:clubId/schedule', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  return passthrough(await clubStub(c.env, gate.clubId).fetch('https://club/schedule', { method: 'DELETE' }));
});

app.get('/clubs/:clubId/nights', async (c) => {
  const gate = await clubMember(c);
  if ('refused' in gate) return gate.refused;
  const q = new URLSearchParams();
  if (c.req.query('from')) q.set('from', c.req.query('from') as string);
  if (c.req.query('limit')) q.set('limit', c.req.query('limit') as string);
  return passthrough(await clubStub(c.env, gate.clubId).fetch(`https://club/nights?${q.toString()}`));
});

/** Call one off (`cancelled`), or take just this one out of the series (`skip: true` → `skipped`). */
app.post('/clubs/:clubId/nights/:nightId/cancel', async (c) => {
  const gate = await clubHost(c);
  if ('refused' in gate) return gate.refused;
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string; skip?: boolean };
  return passthrough(
    await clubStub(c.env, gate.clubId).fetch(`https://club/nights/${encodeURIComponent(c.req.param('nightId') ?? '')}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: body.reason, skip: body.skip === true }),
    }),
  );
});

/**
 * RETIRE A CLUB — the host's own way to close one, and the thing every other refusal points at.
 *
 * Removing the person who started a club is refused with "retire the club instead", and until now that
 * sentence named a route that did not exist: a club, once made, was permanent. Nobody could clear a
 * mistake, a test, or a group that had stopped meeting, and every one of them stayed in its members'
 * navigation for good.
 *
 * ONLY ITS HOST. There is exactly one — `created_by` — so this is not a role that can be shared or
 * handed over, and the refusals split the way every other club refusal does: somebody with NO standing
 * gets 404, because a club they are not in must stay indistinguishable from one that does not exist,
 * and a MEMBER gets 403 by name, because they can already see the club and telling them who may close
 * it leaks nothing.
 *
 * ITS TABLES GO WITH IT, and this is the order that matters:
 *
 *   1. LOOK at every table in the club's lobby, and refuse the whole thing if anybody is seated at
 *      one. A seat holds somebody's chips, and at a settled table those chips are their money —
 *      closing the club out from under them would strand both. Nothing has been destroyed yet when
 *      this refusal happens, and it names the tables in the way so the host knows what to do.
 *   2. Retire the tables. A club's table is private to it, so leaving them behind would leave tables
 *      that no living standing can ever see again — reachable by direct link and by nothing else.
 *   3. Retire the club itself, which drops it from every member's index last.
 *
 * IT DOES NOT TOUCH THE CLUB'S SMART AGENT. The `<label>.workspace` agent was deployed at the host's
 * own Home and this card room has never held its key. The answer says so when there was one, because
 * a host who reads "retired" and assumes the agent went too has been misled about something that is
 * still out there in the estate with their name on it.
 *
 * There is no undo, and no operator override: this is the host's decision about their own group.
 */
app.delete('/clubs/:clubId', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const clubId = c.req.param('clubId') ?? '';
  const answer = await standingAt(c.env, clubId, session.playerId);
  if (!answer || !belongs(answer.standing)) return c.json({ error: 'no such club' }, 404);
  if (answer.standing !== 'host') {
    return c.json({ error: `only the person who started this club can retire it — ${answer.because}` }, 403);
  }

  // 1. Look before touching anything.
  const listed = await lobby(c.env, clubId).fetch('https://lobby/list');
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

  // 2. Its tables. Each one is private to this club, so a table left behind is a table nobody can
  //    ever reach through a listing again.
  const closed: string[] = [];
  for (const t of tables) {
    const res = await lobby(c.env, clubId).fetch('https://lobby/retire', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: t.tableId }),
    });
    if (res.ok) closed.push(t.name);
  }

  // 3. The club, which drops itself from every member's index on the way out.
  const res = await clubStub(c.env, clubId).fetch('https://club/retire', { method: 'POST' });
  if (!res.ok) return passthrough(res);
  const done = (await res.json()) as Record<string, unknown>;
  return c.json({ ...done, tablesClosed: closed }, 200);
});

/**
 * Finish the `workspace-create` ceremony the host ran at their Home, and record what it deployed.
 *
 * Two checks before anything is written, and they are different questions: HOST STANDING says this
 * person may charter this club, and the id_token subject says the ceremony they are handing over is
 * their own. Either alone is not enough — a host could otherwise record somebody else's ceremony,
 * and a stranger could otherwise record their own onto a club they have nothing to do with.
 */
app.post('/clubs/:clubId/charter', async (c) => {
  const gate = await requireStanding(c, 'host');
  if ('refused' in gate) return gate.refused;
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
  if (homePlayerId(result.identity.address) !== gate.playerId) {
    return c.json({ error: 'that ceremony was completed by a different person than this session' }, 403);
  }
  const res = await clubStub(c.env, gate.clubId).fetch('https://club/charter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: result.agent,
      ...(result.agentName ? { agentName: result.agentName } : {}),
      ...(result.stewardship === undefined ? {} : { stewardship: result.stewardship }),
    }),
  });
  return passthrough(res);
});

app.get('/clubs/:clubId/members', async (c) => {
  const gate = await requireStanding(c, 'member');
  if ('refused' in gate) return gate.refused;
  const res = await clubStub(c.env, gate.clubId).fetch(`https://club/view?player=${encodeURIComponent(gate.playerId)}`);
  if (!res.ok) return passthrough(res);
  const view = (await res.json()) as { roster: unknown[] };
  return c.json({ members: view.roster });
});

app.post('/clubs/:clubId/members', async (c) => {
  const gate = await requireStanding(c, 'host');
  if ('refused' in gate) return gate.refused;
  const parsed = InviteMemberRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  // An address, a playerId, or an AGENT NAME — the last resolved on chain, because a host knows
  // their friends by name and should not have to find a hex string to add one.
  const who = await resolveInvitee(c.env, parsed.data.member);
  if (!who.ok) return c.json({ error: who.error }, 400);
  const body: AddMemberRequest = {
    member: who.member,
    name: parsed.data.name ?? who.name ?? who.member,
    class: parsed.data.class,
    invitedBy: gate.playerId,
    ...(parsed.data.validUntil === undefined ? {} : { validUntil: parsed.data.validUntil }),
  };
  const res = await clubStub(c.env, gate.clubId).fetch('https://club/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return passthrough(res);
});

/* ------------------------------------------------------------- invitations */

/** How long an invitation link is good for. A poker night is weekly; a fortnight covers two of them. */
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Where an invitation LANDS. Registered for this app at the Home, which is what makes it mailable. */
function joinUrl(env: Env, clubId: string, token: string): string {
  const origin = new URL(homeRedirectUri(env)).origin;
  return `${origin}/#/join/${encodeURIComponent(clubId)}/${encodeURIComponent(token)}`;
}

/**
 * Invite somebody by EMAIL.
 *
 * The one identifier a host always has and the card room can do nothing with: no chain maps an inbox
 * to an agent. So this writes a pending invitation, asks the host's Home to mail the link, and
 * answers with the link either way — a Home with no mailer configured is a reason to show the host
 * something to paste, never a reason to lose the invitation.
 */
app.post('/clubs/:clubId/invites', async (c) => {
  const gate = await requireStanding(c, 'host');
  if ('refused' in gate) return gate.refused;
  const parsed = ClubInviteRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);

  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const body: CreateInviteRequest = {
    token,
    email: parsed.data.email.trim().toLowerCase(),
    ...(parsed.data.name ? { name: parsed.data.name } : {}),
    class: parsed.data.class,
    invitedBy: gate.playerId,
    invitedByName: session?.name ?? gate.playerId,
    expiresAt: Date.now() + INVITE_TTL_MS,
    ...(parsed.data.validUntil === undefined ? {} : { validUntil: parsed.data.validUntil }),
  };
  const res = await clubStub(c.env, gate.clubId).fetch('https://club/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) return passthrough(res);
  const { invite } = (await res.json()) as { invite: ClubInvite };
  const url = joinUrl(c.env, gate.clubId, token);
  const mail = await mailInvite(c.env, {
    playerId: gate.playerId,
    email: invite.email,
    joinUrl: url,
    clubName: invite.clubName,
  });
  return c.json(
    {
      invite,
      joinUrl: url,
      // Exactly what happened to the mail, in the same words every time: sent, logged by a Home with
      // no mailer, or not sent and why. A host who is told "sent" when nothing was sent will wait.
      delivery: mail.ok ? mail.delivery : 'not-sent',
      ...(mail.ok ? {} : { deliveryError: mail.why }),
    },
    201,
  );
});

/** The club's invitations, for its hosts. Claimed ones stay: they are the record of who let who in. */
app.get('/clubs/:clubId/invites', async (c) => {
  const gate = await requireStanding(c, 'host');
  if ('refused' in gate) return gate.refused;
  return passthrough(await clubStub(c.env, gate.clubId).fetch('https://club/invites'));
});

app.delete('/clubs/:clubId/invites/:token', async (c) => {
  const gate = await requireStanding(c, 'host');
  if ('refused' in gate) return gate.refused;
  const token = c.req.param('token') ?? '';
  return passthrough(
    await clubStub(c.env, gate.clubId).fetch(`https://club/invites/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  );
});

/**
 * What somebody who OPENED an invitation is told — with NO session, because they do not have one yet.
 *
 * This is the whole reason the greeting is smaller than the record: the person reading it has proved
 * nothing except that they hold the token. They get the club's name, who invited them and whether it
 * is still good, which is what they need to decide whether to sign in. Not the email, not the roster.
 */
app.get('/clubs/:clubId/invite/:token', async (c) => {
  const clubId = c.req.param('clubId') ?? '';
  if (!CLUB_ID_RE.test(clubId)) return c.json({ error: 'no such invitation' }, 404);
  const token = c.req.param('token') ?? '';
  return passthrough(await clubStub(c.env, clubId).fetch(`https://club/invite?token=${encodeURIComponent(token)}`));
});

/**
 * Claim it. The membership is keyed by whoever SIGNED IN, never by the email it was sent to.
 *
 * A person could forward the mail; the club gets the agent that actually turned up, which is the only
 * identity a session can present and therefore the only one worth writing down.
 */
app.post('/clubs/:clubId/invite/:token/claim', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const clubId = c.req.param('clubId') ?? '';
  if (!CLUB_ID_RE.test(clubId)) return c.json({ error: 'no such invitation' }, 404);
  const body: ClaimInviteRequest = {
    token: c.req.param('token') ?? '',
    member: session.playerId,
    ...(session.name ? { name: session.name } : {}),
  };
  return passthrough(
    await clubStub(c.env, clubId).fetch('https://club/invite/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
});

/**
 * The people the caller ALREADY PLAYS WITH: everyone on the roster of any club they are in.
 *
 * The most common invitation there is — "add the three of them from Tuesday" — and the one that
 * should need no identifier at all, because the card room already knows these people by name. The
 * caller is left out of their own list, and so is anybody they have no club in common with: this
 * answers "who do YOU play with", never "who is in this card room".
 */
app.get('/people', async (c) => {
  const session = await resolveSession(c.env, sessionToken(c.req.raw));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const listed = await c.env.CLUB_INDEX.get(c.env.CLUB_INDEX.idFromName(session.playerId)).fetch('https://index/list');
  if (!listed.ok) return c.json({ people: [] });
  const { clubs } = (await listed.json()) as { clubs: { clubId: string; name: string }[] };

  const byMember = new Map<string, KnownPerson>();
  for (const club of clubs) {
    const res = await clubStub(c.env, club.clubId).fetch(`https://club/view?player=${encodeURIComponent(session.playerId)}`);
    if (!res.ok) continue;
    const view = (await res.json()) as ClubView;
    for (const m of view.roster) {
      if (m.member === session.playerId) continue;
      const known = byMember.get(m.member);
      if (known) known.clubs.push(view.name);
      else byMember.set(m.member, { member: m.member, name: m.name, clubs: [view.name] });
    }
  }
  return c.json({ people: [...byMember.values()].sort((a, b) => a.name.localeCompare(b.name)) });
});

app.delete('/clubs/:clubId/members/:member', async (c) => {
  const gate = await requireStanding(c, 'host');
  if ('refused' in gate) return gate.refused;
  const who = memberIdOf(c.req.param('member') ?? '');
  if (!who.ok) return c.json({ error: who.error }, 400);
  const res = await clubStub(c.env, gate.clubId).fetch(`https://club/members/${encodeURIComponent(who.member)}`, { method: 'DELETE' });
  return passthrough(res);
});

/**
 * The agents this deployment can seat, for a game.
 *
 * A PROXY, so the browser talks to one API. The card room already knows where the agent worker is
 * (`AGENT_BASE_URL`), and a client that had to reach a second origin to find out who it could seat
 * would need that origin's CORS, its zone and its naming convention — three things the browser has
 * no business knowing and the Worker already does.
 *
 * `game` narrows it, and narrowing it is the point: an agent that plays poker cannot play canasta,
 * and offering one at the other's table is offering a seat that will be refused a moment later.
 */
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
  const answer = await standingAt(c.env, clubId, session?.playerId ?? null);
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
    const answer = await standingAt(c.env, clubId, session.playerId);
    if (!answer || !belongs(answer.standing)) return c.json({ error: 'no such club' }, 404);
    if (answer.standing !== 'host') {
      return c.json({ error: `only a host of this club can open a table for it — ${answer.because}` }, 403);
    }
    const sum = await clubStub(c.env, clubId).fetch('https://club/summary');
    clubName = sum.ok ? ((await sum.json()) as { name: string }).name : undefined;
  }
  const res = await lobby(c.env, clubId).fetch('https://lobby/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...parsed.data, ...(clubId ? { club: clubId, clubName } : {}) }),
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
  const view = (await res.json()) as { club?: string };
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

  return passthrough(await table(c.env, tableId).fetch(`https://table/advice?seat=${mine.seat}`));
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
  const gate = await checkOperator(c.env, c.req.raw);
  // Never logged, never echoed: the refusal says which gate closed and nothing about the token.
  if (!gate.ok) return c.json({ error: gate.reason, refused: 'operator' }, gate.status);
  const res = await lobby(c.env, c.req.query('club') ?? c.req.query('circle')).fetch('https://lobby/retire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId: c.req.param('id') }),
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
  const clubId = await tableClub(c.env, c.req.param('id'));
  if (clubId) {
    const answer = await standingAt(c.env, clubId, session?.playerId ?? null);
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
