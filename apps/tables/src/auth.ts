/**
 * Session tokens.
 *
 * Phase 1 (DEV_AUTH=true): the Worker mints a token for any name. The token is
 *   base64url(JSON payload) "." base64url(HMAC-SHA256(SESSION_SECRET, `${playerId}.${name}.${exp}`))
 * and is verified with the same HMAC via WebCrypto. playerId = `dev:<slug(name)>`.
 *
 * Phase 2/3: `verifyHomeSession` (below) validates a session established through the Home OIDC
 * flow (HOME_ORIGIN) and maps the subject to a Smart Agent address. Not implemented yet.
 */

import type { Env } from './env.js';

export interface SessionClaims {
  playerId: string;
  name: string;
  /** Absolute ms expiry. */
  exp: number;
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
 * Resolve a bearer/query token to a session. Tries the HMAC token first, then the Home session
 * extension point. Returns null for spectators (no or invalid token).
 */
export async function resolveSession(env: Env, token: string | null | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  const secret = sessionSecret(env);
  if (secret) {
    const claims = await verifySessionToken(secret, token);
    if (claims) return claims;
  }
  return verifyHomeSession(env, token);
}

/**
 * EXTENSION POINT (phase 2/3): validate a session issued by the Home OIDC flow at HOME_ORIGIN and map
 * it to `{ playerId: <smart agent address or name>, name }`. Until then every non-HMAC token is rejected.
 */
export async function verifyHomeSession(env: Env, token: string): Promise<SessionClaims | null> {
  void env;
  void token;
  return null;
}
