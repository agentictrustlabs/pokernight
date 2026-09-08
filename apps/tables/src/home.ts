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
  claims: IdTokenClaims & { iat?: number };
  expiresAt: number;
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
  let client: ConnectClient;
  try {
    client = homeClient(env);
  } catch (e) {
    // Misconfiguration, not the caller's fault — but still nothing to hand back but a refusal.
    throw new HomeAuthError(`home sign-in is not configured: ${e instanceof Error ? e.message : String(e)}`);
  }

  let token: { idToken: string; delegation?: WireDelegation };
  try {
    token = await client.exchangeCode(req.authOrigin, req.code, req.codeVerifier);
  } catch (e) {
    throw new HomeAuthError(`code exchange failed at ${req.authOrigin}: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!req.nonce) throw new HomeAuthError('id_token nonce does not match the sign-in request');
  const identity = await verifyHomeIdToken(env, req.authOrigin, token.idToken, req.nonce, now);
  return { ...identity, delegation: token.delegation };
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
