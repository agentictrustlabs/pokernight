/**
 * A CALENDAR CLIENT CANNOT SIGN IN.
 *
 * A subscribed calendar fetches a URL every half hour, from a phone, with no session, no cookies and
 * no way to be prompted for anything. So the URL itself has to carry the authority — and that makes
 * getting it right the whole of the security of this feature.
 *
 * THE TOKEN SAYS WHO, AND THE CLUB STILL DECIDES. It carries the player id and an HMAC over it, so
 * the Worker can tell whose feed is being asked for; then it asks the club, exactly as every other
 * club route does, whether that person still has standing. A token is therefore not a capability
 * that outlives membership: leave the club and the feed stops answering, with no revocation list and
 * nothing to remember to clean up.
 *
 * Scoped to ONE club, so a token that does leak — pasted into a shared calendar, mailed on — exposes
 * one group's dates and not everything the person is in.
 *
 * It is a bearer secret in a URL, which is a real trade and worth naming: calendar URLs end up in
 * screenshots, in sync logs, and in whatever a phone backs up. What it buys is a night that appears
 * in somebody's calendar without them doing anything; what it risks is one club's dates. It carries
 * no ability to act — no seat, no money, no roster change — because it is only ever read.
 */

import type { Env } from './env.js';

const PREFIX = 'pokernight:calendar:v1';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(v: string): string {
  const padded = v.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

async function mac(env: Env, message: string): Promise<string> {
  const secret = (env.SESSION_SECRET ?? '').trim();
  // No secret, no feed. Signing with a constant would make every token forgeable by anybody who read
  // this file, which is worse than the feature not existing.
  if (!secret) throw new Error('no SESSION_SECRET: calendar feeds are unavailable on this deployment');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig)).slice(0, 43);
}

/** The token for this person's feed of this club. Stable, so a subscription keeps working. */
export async function feedToken(env: Env, clubId: string, playerId: string): Promise<string> {
  const who = b64url(new TextEncoder().encode(playerId));
  return `${who}.${await mac(env, `${PREFIX}:${clubId}:${playerId}`)}`;
}

/**
 * Who a token is for, or null.
 *
 * The comparison is constant-time. A timing oracle on an HMAC is a slow but real forgery, and the
 * three lines it costs to do properly are three lines.
 */
export async function feedPlayer(env: Env, clubId: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  let playerId: string;
  try {
    playerId = unb64url(token.slice(0, dot));
  } catch {
    return null;
  }
  if (!playerId) return null;
  let expected: string;
  try {
    expected = await mac(env, `${PREFIX}:${clubId}:${playerId}`);
  } catch {
    return null;
  }
  const got = token.slice(dot + 1);
  if (got.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 ? playerId : null;
}
