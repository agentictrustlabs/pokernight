/**
 * Session tokens.
 *
 * BOTH sign-in paths mint the SAME token, so nothing downstream cares which one you used:
 *   base64url(JSON payload) "." base64url(HMAC-SHA256(SESSION_SECRET, `${playerId}.${name}.${exp}`))
 * verified with the same HMAC via WebCrypto.
 *
 *   dev  (DEV_AUTH=true)  playerId = `dev:<slug(name)>`   — any name, no proof. Localhost only.
 *   home (Home OIDC)      playerId = `home:0x<sa address>` — minted only after the Worker itself has
 *                         exchanged the code and verified the id_token (`home.ts`). The browser's
 *                         claim about who it is never reaches this file.
 *
 * A `home:` token additionally has a server-side record in `SessionDO` carrying the person's Smart
 * Agent address and the SA-signed delegation the Home issued (phase 3 spends against it). The token
 * stays small: the delegation never rides on the wire, and the address is re-derivable from
 * `playerId`. `verifyHomeSession` below is the accessor for that record, and the record's existence
 * is what makes sign-out a real revocation.
 */

import type { Env } from './env.js';
import { isHomePlayerId } from './home.js';
import type { SessionRecord } from './session-do.js';

export interface SessionClaims {
  playerId: string;
  name: string;
  /** Absolute ms expiry. */
  exp: number;
}

/** A resolved Home session: the token claims plus the parts kept server-side. */
export interface HomeSessionClaims extends SessionClaims {
  address: string;
  agentName?: string;
  homeOrigin: string;
  /** Opaque SA-signed delegation. Phase 3 reads it; nothing here interprets it. */
  delegation?: unknown;
  /** The treasury Smart Agent this session chose to fund play with, lowercased (see session-do.ts). */
  treasury?: string;
  /** The signed poker-buyin mandate, when the player has one. Opaque. */
  buyInMandate?: unknown;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
/** Used only when DEV_AUTH=true and no SESSION_SECRET is configured, so `wrangler dev` works without .dev.vars. */
const INSECURE_DEV_SECRET = 'pokernight-dev-insecure-secret';

export function sessionSecret(env: Env): string | null {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  return env.DEV_AUTH === 'true' ? INSECURE_DEV_SECRET : null;
}

export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return s || 'anon';
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function signingInput(c: SessionClaims): Uint8Array {
  return new TextEncoder().encode(`${c.playerId}.${c.name}.${c.exp}`);
}

export async function mintSessionToken(secret: string, claims: SessionClaims): Promise<string> {
  const key = await hmacKey(secret, 'sign');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, signingInput(claims)));
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  return `${b64url(payload)}.${b64url(sig)}`;
}

/** Returns the claims if the signature is valid and the token has not expired, else null. */
export async function verifySessionToken(secret: string, token: string, now = Date.now()): Promise<SessionClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payloadBytes = b64urlDecode(parts[0] ?? '');
  const sig = b64urlDecode(parts[1] ?? '');
  if (!payloadBytes || !sig) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  const key = await hmacKey(secret, 'verify');
  const ok = await crypto.subtle.verify('HMAC', key, sig, signingInput(claims));
  if (!ok) return null;
  if (claims.exp <= now) return null;
  return claims;
}

function isClaims(x: unknown): x is SessionClaims {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.playerId === 'string' && typeof o.name === 'string' && typeof o.exp === 'number' && o.playerId.length > 0;
}

/** Dev login: DEV_AUTH=true only. */
export async function mintDevSession(env: Env, name: string, now = Date.now()): Promise<{ token: string; playerId: string; name: string }> {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const playerId = `dev:${slug(name)}`;
  const token = await mintSessionToken(secret, { playerId, name, exp: now + DEFAULT_TTL_MS });
  return { token, playerId, name };
}

/**
 * Mint the session for a person who has just proved themselves at their Home (see `home.ts`).
 *
 * Refuses the INSECURE_DEV_SECRET fallback for a real Home. That fallback exists so `wrangler dev`
 * works with no `.dev.vars`, but its value is in this file — a deployment that reached a real Home and
 * then signed the session with it would be handing out forgeable identities. Failing loudly here is
 * the only way an operator finds out before a player does.
 */
export async function mintHomeSessionToken(env: Env, playerId: string, name: string, exp: number): Promise<string> {
  const localHome = (env.HOME_ZONE ?? '').trim().toLowerCase() === 'localhost';
  if (!env.SESSION_SECRET && !localHome) throw new Error('SESSION_SECRET is not configured');
  const secret = sessionSecret(env);
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return mintSessionToken(secret, { playerId, name, exp });
}

/** How long a Home session lasts. Capped by the id_token's own expiry at the call site. */
export const HOME_SESSION_TTL_MS = DEFAULT_TTL_MS;

/**
 * Resolve a bearer/query token to a session. The HMAC is the whole trust decision; a `home:` token is
 * then hydrated from its `SessionDO` record so callers see the Smart Agent address and delegation and
 * so a signed-out session stops working immediately. Returns null for spectators.
 */
export async function resolveSession(env: Env, token: string | null | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  const secret = sessionSecret(env);
  if (secret) {
    const claims = await verifySessionToken(secret, token);
    if (claims) return isHomePlayerId(claims.playerId) ? hydrateHomeSession(env, claims) : claims;
  }
  return verifyHomeSession(env, token);
}

/**
 * Validate a session established through the Home OIDC flow and return it with everything the flow
 * learned: the person's Smart Agent address, their agent name, and the SA-signed delegation the Home
 * issued to this site's delegate. Returns null for anything that is not a live Home session.
 */
export async function verifyHomeSession(env: Env, token: string): Promise<HomeSessionClaims | null> {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const claims = await verifySessionToken(secret, token);
  if (!claims || !isHomePlayerId(claims.playerId)) return null;
  return hydrateHomeSession(env, claims);
}

/**
 * Attach the server-side record to already-verified claims.
 *
 * A MISSING record means the session was signed out (or has expired) — fail closed. A record store
 * that is unreachable is a different thing: the token's HMAC already proved the session, so we
 * degrade to the bare claims rather than logging every player out mid-hand.
 */
async function hydrateHomeSession(env: Env, claims: SessionClaims): Promise<HomeSessionClaims | null> {
  let res: Response;
  try {
    res = await sessionStub(env, claims.playerId).fetch('https://session/record');
  } catch {
    return { ...claims, address: claims.playerId.slice('home:'.length), homeOrigin: env.HOME_ORIGIN };
  }
  if (res.status === 404) return null;
  if (!res.ok) return { ...claims, address: claims.playerId.slice('home:'.length), homeOrigin: env.HOME_ORIGIN };
  const rec = (await res.json()) as SessionRecord;
  return {
    ...claims,
    address: rec.address,
    agentName: rec.agentName,
    homeOrigin: rec.homeOrigin,
    delegation: rec.delegation,
    treasury: rec.treasury,
    buyInMandate: rec.buyInMandate,
  };
}

export function sessionStub(env: Env, playerId: string): DurableObjectStub<import('./session-do.js').SessionDO> {
  return env.SESSIONS.get(env.SESSIONS.idFromName(playerId));
}

/** Write (or replace) the server-side record for a Home session. */
export async function putSessionRecord(env: Env, rec: SessionRecord): Promise<void> {
  const res = await sessionStub(env, rec.playerId).fetch('https://session/record', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rec),
  });
  if (!res.ok) throw new Error(`could not store the session record (${res.status})`);
}

/**
 * Record the treasury this session funds play from. Patch, not replace: the identity half of the
 * record is the part a re-write could lose, and this is called mid-session.
 *
 * Returns false when there is no live record to patch — a signed-out or expired session must not be
 * able to leave a treasury choice behind it.
 */
export async function setSessionTreasury(env: Env, playerId: string, treasury: string | null): Promise<boolean> {
  const res = await sessionStub(env, playerId).fetch('https://session/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ treasury }),
  });
  return res.ok;
}

/**
 * Read the server-side record straight, without the token dance. The table DO uses this: it already
 * knows the playerId of a socket the Worker authenticated, and it needs the parts of the session a
 * token never carries (the chosen treasury, the buy-in mandate).
 */
export async function readSessionRecord(env: Env, playerId: string): Promise<SessionRecord | null> {
  let res: Response;
  try {
    res = await sessionStub(env, playerId).fetch('https://session/record');
  } catch {
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()) as SessionRecord;
}

/** Sign-out: drop the server-side record so the token stops resolving. */
export async function dropSessionRecord(env: Env, playerId: string): Promise<void> {
  await sessionStub(env, playerId).fetch('https://session/record', { method: 'DELETE' });
}
