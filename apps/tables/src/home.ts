/**
 * Home sign-in (DESIGN.md §3/§4) — the SERVER half of the OIDC ceremony.
 *
 * The browser runs the front half: it builds a `site-login` authorize request to the person's Home
 * (`HOME_ORIGIN`, PKCE S256 + state + nonce), the Home runs the credential ceremony, and the person
 * comes back to the registered redirect URI with `?code&state`. The browser then hands us
 * `{ code, codeVerifier, authOrigin, nonce }` — and nothing else is trusted.
 *
 * This module does the back half INSIDE the Worker: exchange the code at the Home's `/token`, verify
 * the returned id_token against the Home's `/jwks` (ES256, alg-pinned, iss/aud/nonce/exp bound), and
 * only then map the person to a player. The browser never tells us who it is; it only tells us where
 * to go and ask. That is the whole point of doing this here instead of trusting a client assertion.
 *
 * `@agenticprimitives/connect-client` runs unchanged in a Worker for the two calls we use
 * (`exchangeCode`, `verifyIdToken`): both are plain `fetch` + WebCrypto. The package's browser-only
 * surface (popup, FedCM) is never called here and touches no globals at import time.
 */

import { createConnectClient, type ConnectClient, type IdTokenClaims, type WireDelegation } from '@agenticprimitives/connect-client';
import type { Address } from '@agenticprimitives/types';
import type { Env } from './env.js';

/** OIDC scope for this client. `profile` is NOT in `pokernight`'s allowed_scopes — asking for it fails. */
export const HOME_SCOPE = 'openid agent';

/** Labels a Home subdomain may use. Same charset the name registry permits. */
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A 0x-prefixed 20-byte address, as the id_token carries it. */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** id_token clock skew we tolerate on `iat` (the Home and we are both on NTP; a minute is plenty). */
const IAT_SKEW_MS = 2 * 60 * 1000;
/** An id_token older than this is stale even if it has not expired — a replayed code exchange. */
const IAT_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * SEC-018 issuer allowlist. Mirrors `isAllowedHomeOrigin` on the platform side: an issuer is trusted
 * only when it is the deployment's Home zone apex or a SINGLE-label subdomain of it, over https, with
 * no path/query/fragment. A localhost Home is trusted only by a deployment whose zone IS localhost,
 * so production can never be talked into verifying against a developer's machine.
 */
export function isAllowedHomeOrigin(env: Env, origin: string): boolean {
  const zone = (env.HOME_ZONE ?? '').trim().toLowerCase();
  if (!zone) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.pathname !== '/' && u.pathname !== '') return false;
  if (u.search !== '' || u.hash !== '') return false;
  const host = u.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) return zone === 'localhost';
  if (u.protocol !== 'https:') return false;
  if (host === zone) return true;
  if (!host.endsWith(`.${zone}`)) return false;
  return LABEL_RE.test(host.slice(0, -(zone.length + 1)));
}

/**
 * The redirect URI we send to `/token`. It must be byte-identical to the one the browser put on the
 * authorize request AND to the URI registered for `HOME_CLIENT_ID` — the Home binds the code to it.
 * Configured explicitly (`HOME_REDIRECT_URI`); falls back to the first allowed browser origin so
 * `wrangler dev` works with no extra config.
 */
export function homeRedirectUri(env: Env): string {
  const configured = (env.HOME_REDIRECT_URI ?? '').trim();
  if (configured) return configured;
  const first = (env.ALLOWED_ORIGINS ?? '').split(',')[0]?.trim();
  if (!first) throw new Error('HOME_REDIRECT_URI is not configured and ALLOWED_ORIGINS is empty');
  return new URL('/', first).toString();
}

/** The relying-party client for this deployment. Never handed to the browser. */
export function homeClient(env: Env): ConnectClient {
  const clientId = (env.HOME_CLIENT_ID ?? '').trim();
  const delegate = (env.HOME_DELEGATE ?? '').trim();
  if (!clientId) throw new Error('HOME_CLIENT_ID is not configured');
  if (!ADDRESS_RE.test(delegate)) throw new Error('HOME_DELEGATE is not an address');
  const redirectUri = homeRedirectUri(env);
  return createConnectClient({
    clientId,
    delegate: delegate as Address,
    redirectUri: () => redirectUri,
    // One mechanism, no fallback chain: this deployment has exactly one Home origin.
    resolveAuthOrigin: () => env.HOME_ORIGIN,
    isAllowedIssuerOrigin: (o) => isAllowedHomeOrigin(env, o),
    scope: HOME_SCOPE,
  });
}

/** What the browser POSTs to `/auth/home`. `state` is the browser's own CSRF binding; we require it
 *  to be present but the binding we enforce is the PKCE verifier + the nonce. */
export interface HomeAuthRequest {
  code: string;
  codeVerifier: string;
  authOrigin: string;
  nonce: string;
  state: string;
}

export interface HomeIdentity {
  /** The person's Smart Agent address, lowercased. */
  address: string;
  /** `agent_name` from the id_token, when the Home issued one. */
  agentName?: string;
  /** Display name: `agent_name`, else a truncated address. */
  name: string;
  /** The Home origin the id_token was actually minted at (== `iss`). */
  homeOrigin: string;
  /** The SA-signed scoped delegation the Home issued to `HOME_DELEGATE`. Opaque here; phase 3 spends
   *  against it. Never travels in a bearer token. */
  delegation?: WireDelegation;
  /**
   * The PAYMENT mandate the Home minted in the same ceremony, when it minted one.
   *
   * Sign-in asks for the `poker-buyin` template rather than `site-login`, and the Home's payment
   * ceremony issues the mandate DURING the enrol — one visit, consent and authority together. So a
   * sign-in can come back carrying both halves, and this is the second one. `undefined` means the
   * ceremony returned none, which is a fact about that exchange and not an inference about the
   * Home: the session is established either way and the separate authorisation path still exists.
   */
  paymentDelegation?: unknown;
  claims: IdTokenClaims & { iat?: number };
  expiresAt: number;
  /**
   * The id_token itself. Held server-side so the Worker can ask the person's Home what agents they
   * have; never returned to the browser and never put on a pokernight session token.
   */
  idToken: string;
}

/** A failure a caller should turn into a 401 with `reason` shown to the user. */
export class HomeAuthError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'HomeAuthError';
  }
}

/** `0x89d13c59…a820ffd0` — enough to recognise, short enough for a seat label. */
export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

/** `home:0x…` (lowercased) — stable across sessions, distinct from `dev:<slug>`. */
export function homePlayerId(address: string): string {
  return `home:${address.toLowerCase()}`;
}

export function isHomePlayerId(playerId: string): boolean {
  return playerId.startsWith('home:');
}

/**
 * Verify an id_token minted by a Home, and turn it into an identity.
 *
 * This is the part of the ceremony that DECIDES WHO SOMEONE IS, factored out so every path that ends
 * with a Home-signed id_token runs exactly the same checks: the issuer allowlist, the Home's JWKS,
 * ES256 pinning, iss/aud/exp, and (where the caller chose one) the nonce. Pass an empty
 * `expectedNonce` only where the ceremony had no nonce to bind — the id_token is then bounded by
 * `iat` age instead, and that is the whole of the replay window.
 */
export async function verifyHomeIdToken(
  env: Env,
  authOrigin: string,
  idToken: string,
  expectedNonce: string,
  now = Date.now(),
): Promise<Omit<HomeIdentity, 'delegation'>> {
  if (!isAllowedHomeOrigin(env, authOrigin)) {
    throw new HomeAuthError(`home origin "${authOrigin}" is not a trusted issuer for this deployment`);
  }
  let client: ConnectClient;
  try {
    client = homeClient(env);
  } catch (e) {
    // Misconfiguration, not the caller's fault — but still nothing to hand back but a refusal.
    throw new HomeAuthError(`home sign-in is not configured: ${e instanceof Error ? e.message : String(e)}`);
  }

  let claims: IdTokenClaims & { iat?: number };
  try {
    claims = (await client.verifyIdToken(authOrigin, idToken, expectedNonce)) as IdTokenClaims & { iat?: number };
  } catch (e) {
    throw new HomeAuthError(`id_token rejected: ${e instanceof Error ? e.message : String(e)}`);
  }

  // `verifyIdToken` already binds iss/aud/exp and pins ES256; re-assert the ones that decide who the
  // player IS, so a future change to the library cannot silently widen them here.
  if (claims.aud !== (env.HOME_CLIENT_ID ?? '').trim()) throw new HomeAuthError('id_token aud is not this client');
  if (expectedNonce && claims.nonce !== expectedNonce) throw new HomeAuthError('id_token nonce does not match the sign-in request');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new HomeAuthError('id_token has expired');
  if (typeof claims.iat === 'number') {
    if (claims.iat * 1000 > now + IAT_SKEW_MS) throw new HomeAuthError('id_token iat is in the future');
    if (claims.iat * 1000 < now - IAT_MAX_AGE_MS) throw new HomeAuthError('id_token iat is too old');
  }

  let address: string;
  try {
    address = client.personAddressFromIdToken(idToken);
  } catch {
    throw new HomeAuthError('id_token carries no Smart Agent address');
  }
  if (!ADDRESS_RE.test(address)) throw new HomeAuthError(`id_token subject "${address}" is not a Smart Agent address`);
  address = address.toLowerCase();

  const agentName = typeof claims.agent_name === 'string' && claims.agent_name.trim() ? claims.agent_name.trim() : undefined;
  return {
    address,
    agentName,
    name: agentName ?? shortAddress(address),
    homeOrigin: authOrigin,
    claims,
    expiresAt: claims.exp * 1000,
    idToken,
  };
}

/**
 * Run the server half of the ceremony. Throws `HomeAuthError` with a reason a human can act on for
 * every rejection; the route turns that into a 401.
 */
export async function completeHomeSignIn(env: Env, req: HomeAuthRequest, now = Date.now()): Promise<HomeIdentity> {
  if (!isAllowedHomeOrigin(env, req.authOrigin)) {
    throw new HomeAuthError(`home origin "${req.authOrigin}" is not a trusted issuer for this deployment`);
  }
  try {
    // Not used for the exchange (see below) — called for its configuration checks, which refuse
    // with the name of the variable that is missing rather than failing at the Home.
    homeClient(env);
  } catch (e) {
    // Misconfiguration, not the caller's fault — but still nothing to hand back but a refusal.
    throw new HomeAuthError(`home sign-in is not configured: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Exchanged directly rather than through `client.exchangeCode`, which returns the id_token and the
  // site-login delegation and DROPS everything else — and `paymentDelegation` is precisely the field
  // it drops. Sign-in now asks for the payment template, so that field is half the answer.
  const token = await exchangeAtHome(env, req);

  if (!req.nonce) throw new HomeAuthError('id_token nonce does not match the sign-in request');
  const identity = await verifyHomeIdToken(env, req.authOrigin, token.idToken, req.nonce, now);
  return {
    ...identity,
    delegation: token.delegation,
    ...(token.paymentDelegation ? { paymentDelegation: token.paymentDelegation } : {}),
  };
}

/**
 * POST the authorization code to the Home's `/token`, and keep EVERY half of the answer.
 *
 * One function so the sign-in ceremony and the standalone authorisation ceremony ask the same
 * question the same way; the only thing that ever differed between them was which fields the caller
 * bothered to read, which is exactly the kind of difference that goes stale.
 */
/**
 * What a `workspace-create` ceremony hands back, on the `org` field of the Home's `/token` answer.
 *
 * `org` for a workspace as well as an organization: one field, because to the Home both are "the
 * agent this ceremony deployed under you". The card room reads only what it needs — the address, the
 * name it was given, and the stewardship wire that proves the person custodies it.
 */
export interface HomeWorkspacePayload {
  orgAgent?: string;
  orgName?: string;
  person?: string;
  purpose?: string;
  delegation?: unknown;
  /** An org-create that ended with the org LISTED in the mission registry carries the Home's outcome here. */
  registry?: unknown;
}

async function exchangeAtHome(
  env: Env,
  req: HomeAuthRequest,
): Promise<{ idToken: string; delegation?: WireDelegation; paymentDelegation?: unknown; org?: HomeWorkspacePayload }> {
  const clientId = (env.HOME_CLIENT_ID ?? '').trim();
  if (!clientId) throw new HomeAuthError('home sign-in is not configured: HOME_CLIENT_ID is not set');
  let body: { id_token?: string; delegation?: WireDelegation; paymentDelegation?: unknown; org?: HomeWorkspacePayload; error?: string };
  try {
    const res = await fetch(new URL('/token', req.authOrigin).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: req.code,
        code_verifier: req.codeVerifier,
        client_id: clientId,
        redirect_uri: homeRedirectUri(env),
      }),
    });
    body = (await res.json().catch(() => ({}))) as typeof body;
    if (!res.ok || !body.id_token) {
      throw new HomeAuthError(`code exchange failed at ${req.authOrigin}: ${body.error ?? `HTTP ${res.status}`}`);
    }
  } catch (e) {
    if (e instanceof HomeAuthError) throw e;
    throw new HomeAuthError(`code exchange failed at ${req.authOrigin}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    idToken: body.id_token,
    ...(body.delegation ? { delegation: body.delegation } : {}),
    ...(body.paymentDelegation ? { paymentDelegation: body.paymentDelegation } : {}),
    ...(body.org ? { org: body.org } : {}),
  };
}

/**
 * What the browser POSTs to `/auth/home/demo` after `connectAsQuickConnect` (spec 295): the SAME two
 * halves an OIDC sign-in yields — an id_token that authenticates and a site-login delegation that
 * authorizes — minus the code exchange, because the Home already ran it.
 */
export interface DemoAuthRequest {
  idToken: string;
  delegation?: unknown;
  authOrigin: string;
}

/**
 * Accept a quick-connect result.
 *
 * The browser did the asking, so it hands us a finished id_token rather than a code. That is the ONLY
 * difference: everything that decides identity — issuer allowlist, JWKS, ES256, iss/aud/exp, `iat`
 * age — runs exactly as it does for a redirect sign-in, in `verifyHomeIdToken`. What we lose without
 * the exchange is the nonce binding, so an id_token intercepted inside its `iat` window could be
 * replayed here; the Home mints these for identities that exist to be shared, which is precisely the
 * property that makes that acceptable and makes this path unsuitable for anything else.
 */
export async function completeDemoSignIn(env: Env, req: DemoAuthRequest, now = Date.now()): Promise<HomeIdentity> {
  const identity = await verifyHomeIdToken(env, req.authOrigin, req.idToken, '', now);
  const delegation = req.delegation && typeof req.delegation === 'object' ? (req.delegation as WireDelegation) : undefined;
  return { ...identity, delegation };
}


/**
 * A display name, made safe to put in front of other players: one line, no control or zero-width
 * characters, collapsed whitespace, short enough for a seat plate — and never something that reads
 * as a Smart Agent address, because a player able to call themselves `0x…` could pass their seat off
 * as somebody else's. Returns '' for anything that survives none of that, which the caller treats
 * exactly like no name at all.
 */
export function cleanProfileName(input: string | undefined): string {
  const clean = (input ?? '')
    // Whitespace FIRST, so a newline becomes a space and does not weld two words together; then the
    // characters that have no business in a name at all.
    .replace(/\s+/g, ' ')
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .trim()
    .slice(0, PROFILE_NAME_MAX);
  return /^0x[0-9a-fA-F]/.test(clean) ? '' : clean;
}

/** As long as a display name may be. A seat plate is narrow, and this is a name, not a sentence. */
export const PROFILE_NAME_MAX = 24;

/* ------------------------------------------------------- the buy-in authorisation */

/** The delegation template this card room asks a player's Home to run for a buy-in mandate. */
export const BUY_IN_TEMPLATE = 'poker-buyin';

export interface HomeMandateResult {
  identity: Omit<HomeIdentity, 'delegation'>;
  /**
   * The payment mandate the Home issued, when it issued one. Undefined means the ceremony completed
   * and returned none — which is a fact about that exchange, not an inference about the Home.
   */
  paymentDelegation?: unknown;
}

/**
 * Finish a `poker-buyin` ceremony: exchange the code and take BOTH halves of the answer.
 *
 * The FALLBACK path, kept deliberately. Sign-in now asks for the payment template itself, so most
 * players never come here — but a player who signed in before that change, or whose mandate expired
 * or was revoked at their Home, must be able to authorise again without signing out first. Same
 * exchange (`exchangeAtHome`), same identity verification as every other sign-in path, so nothing
 * about who the player is rests on this route.
 */
/** The curated template that charters a club as a `<label>.workspace` Smart Agent at the Home. */
export const CLUB_TEMPLATE = 'workspace-create';

/** The `purpose` a club's link carries at the Home, so a person can see WHY that agent exists. */
export const CLUB_PURPOSE = 'poker-club';

export interface HomeCharterResult {
  identity: HomeIdentity;
  /** The workspace Smart Agent the Home deployed, lowercased. */
  agent: string;
  /** The Home's id_token for the host — the bearer the wire ceremony that follows presents to `/admin/*`.
   *  Handed to the browser for that one trip and kept nowhere here. */
  idToken: string;
  /** What it was named at the Home. May be absent; the club keeps its own name either way. */
  agentName?: string;
  /** The workspace → person stewardship wire. Kept because it is the evidence the person custodies
   *  the club, and the thing a later vault read would present. Never inspected here. */
  stewardship?: unknown;
}

/**
 * Finish a `workspace-create` ceremony the host ran at their Home.
 *
 * The SAME shape as the mandate ceremony and for the same reason: the browser does the front half,
 * the Worker exchanges the code, and the identity in the id_token is checked against the session
 * before anything is recorded — so a charter completed by one person can never be recorded onto
 * another person's club.
 *
 * A ceremony that comes back with no workspace address is a FAILURE, not a partial success. The Home
 * returning an id_token means somebody signed in; it does not mean an agent was deployed, and
 * recording a club as chartered when nothing was chartered is the worst of the three outcomes.
 */
export async function completeCharterCeremony(env: Env, req: HomeAuthRequest, now = Date.now()): Promise<HomeCharterResult> {
  if (!isAllowedHomeOrigin(env, req.authOrigin)) {
    throw new HomeAuthError(`home origin "${req.authOrigin}" is not a trusted issuer for this deployment`);
  }
  if (!req.nonce) throw new HomeAuthError('id_token nonce does not match the authorisation request');

  const token = await exchangeAtHome(env, req);
  const identity = await verifyHomeIdToken(env, req.authOrigin, token.idToken, req.nonce, now);
  const agent = (token.org?.orgAgent ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(agent)) {
    throw new HomeAuthError('your Home completed the ceremony but deployed no club agent, so there is nothing to record');
  }
  return {
    identity,
    agent,
    idToken: token.idToken,
    ...(token.org?.orgName ? { agentName: token.org.orgName } : {}),
    ...(token.org?.delegation ? { stewardship: token.org.delegation } : {}),
  };
}

export interface HomeMissionResult {
  identity: HomeIdentity;
  /** The organization the Home chose or created, lowercased, and what it named it. */
  org: string;
  orgName?: string;
  /** The registry outcome, exactly as the Home handed it back — verified by the operator, never trusted. */
  registry: unknown;
}

/**
 * Finish the org-create that REGISTERS A MISSION (`docs/MISSION-REGISTRY.md`). The same exchange as the
 * charter; what must come back is an organization AND the registry outcome — an org-create that reached
 * `/token` without one means the listing did not happen, and saying "registered" then would be a lie the
 * map repeats.
 */
export async function completeMissionCeremony(env: Env, req: HomeAuthRequest, now = Date.now()): Promise<HomeMissionResult> {
  if (!isAllowedHomeOrigin(env, req.authOrigin)) {
    throw new HomeAuthError(`home origin "${req.authOrigin}" is not a trusted issuer for this deployment`);
  }
  if (!req.nonce) throw new HomeAuthError('id_token nonce does not match the authorisation request');
  const token = await exchangeAtHome(env, req);
  const identity = await verifyHomeIdToken(env, req.authOrigin, token.idToken, req.nonce, now);
  const org = (token.org?.orgAgent ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(org)) throw new HomeAuthError('your Home completed the ceremony but named no organization');
  if (!token.org?.registry || typeof token.org.registry !== 'object') throw new HomeAuthError('your Home created the organization but did not list it in the registry — nothing was registered');
  // The site grant the ceremony minted rides with the identity, so a session issued from this leg carries it
  // like one from the plain sign-in.
  return { identity: { ...identity, ...(token.delegation ? { delegation: token.delegation } : {}) }, org, ...(token.org.orgName ? { orgName: token.org.orgName } : {}), registry: token.org.registry };
}

/** The template that HIRES A COACH at the person's Home: names the coach service as the specialist for
 *  `poker.advise` / `poker.review` in the person's playbook, and signs the study grant that lets the service
 *  read the person's card-room records. Both are custodial acts only the Home can do. */
export const COACH_TEMPLATE = 'coach-hire';

export interface HomeCoachResult {
  identity: HomeIdentity;
  /** The coach service the Home bound, by name, and its address. */
  coach: { name: string; agent?: string; grantHash?: string };
}

/**
 * Finish a `coach-hire` ceremony the person ran at their Home. Same shape as the charter: the browser does
 * the front half, the Worker exchanges the code, the identity is checked against the session. What the Home
 * hands back on the `coach` field of its `/token` answer is the evidence the arrangement was made; a
 * ceremony that comes back without it is a failure, not a partial success — the person's agent would keep
 * refusing every question and the house would keep answering, and nobody would know why.
 */
export async function completeCoachCeremony(env: Env, req: HomeAuthRequest, now = Date.now()): Promise<HomeCoachResult> {
  if (!isAllowedHomeOrigin(env, req.authOrigin)) {
    throw new HomeAuthError(`home origin "${req.authOrigin}" is not a trusted issuer for this deployment`);
  }
  if (!req.nonce) throw new HomeAuthError('id_token nonce does not match the authorisation request');
  const token = await exchangeAtHome(env, req);
  const identity = await verifyHomeIdToken(env, req.authOrigin, token.idToken, req.nonce, now);
  const coach = (token as { coach?: { name?: string; agent?: string; grantHash?: string } }).coach;
  if (!coach?.name) throw new HomeAuthError('your Home completed the ceremony but named no coach, so there is nothing to record');
  return { identity, coach: { name: coach.name, ...(coach.agent ? { agent: coach.agent.toLowerCase() } : {}), ...(coach.grantHash ? { grantHash: coach.grantHash } : {}) } };
}

export async function completeMandateCeremony(env: Env, req: HomeAuthRequest, now = Date.now()): Promise<HomeMandateResult> {
  if (!isAllowedHomeOrigin(env, req.authOrigin)) {
    throw new HomeAuthError(`home origin "${req.authOrigin}" is not a trusted issuer for this deployment`);
  }
  if (!req.nonce) throw new HomeAuthError('id_token nonce does not match the authorisation request');

  const token = await exchangeAtHome(env, req);
  const identity = await verifyHomeIdToken(env, req.authOrigin, token.idToken, req.nonce, now);
  return { identity, ...(token.paymentDelegation ? { paymentDelegation: token.paymentDelegation } : {}) };
}

