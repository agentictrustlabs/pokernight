/**
 * The Home's demo users (quick-connect, spec 295) — the PURE half.
 *
 * A Home may offer a small roster of pre-custodied identities that any registered app can connect as.
 * They are real Smart Agents whose keys the Home holds, so a session minted from one carries a real
 * id_token and a real site-login delegation: the tables Worker verifies it exactly as it verifies a
 * redirect sign-in (`POST /auth/home/demo`). Nothing here fabricates a session.
 *
 * WHETHER THE FEATURE APPEARS IS THE HOME'S DECISION, NOT OURS. `listQuickConnect` answers `[]` for a
 * Home that does not offer it, an unreachable Home, or anything that is not a Home — so an empty list
 * means "render nothing", and this module never invents a roster to fill the gap.
 *
 * `POST /connect/demo-signin` reads the Home's CURATED client registry rather than its self-service
 * one, so whether this app may connect as a demo user is the Home's decision too. When it answers
 * `400 {"error":"a registered client_id is required"}` that one refusal is named plainly
 * (`DEMO_NOT_ENABLED`) instead of being hidden behind a generic failure or an empty list.
 */

import type { QuickConnectIdentity } from '@agenticprimitives/connect-client';
import { PRODUCT_NAME } from './brand';
import { shortAddress } from './format';

/** One demo user, ready to render. */
export interface DemoPersona {
  /** Short stable id the Home identifies them by; what we send back to connect. */
  handle: string;
  /** Their Smart Agent address, lowercased — the identity itself. */
  sa: string;
  /** `0xb0d11ce1…303b3d11`. */
  shortSa: string;
  name: string;
  /** One line about who they are, when the Home wrote one. Often absent. */
  blurb: string | null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Map what the Home sent into what we draw. Drops anything without a handle and a real address —
 * a roster entry we cannot connect as is worse than one fewer row — and de-duplicates by handle.
 */
export function mapDemoPersonas(list: readonly QuickConnectIdentity[] | null | undefined): DemoPersona[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: DemoPersona[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const handle = typeof p.handle === 'string' ? p.handle.trim() : '';
    const sa = typeof p.sa === 'string' ? p.sa.trim() : '';
    if (!handle || !ADDRESS_RE.test(sa)) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const address = sa.toLowerCase();
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : handle;
    const blurb = typeof p.blurb === 'string' && p.blurb.trim() ? p.blurb.trim() : null;
    out.push({ handle, sa: address, shortSa: shortAddress(address), name, blurb });
  }
  return out;
}

/** The Home refused this client for its demo users. An operator change there, not a bug here. */
export const DEMO_NOT_ENABLED =
  `Demo sign-in is not enabled for this app yet — the Home has not registered ${PRODUCT_NAME} for its demo users. Sign in with your own Home instead.`;

/**
 * Turn a failure from either half of the demo path — the Home refusing to mint, or the card room
 * refusing to accept — into a sentence that says what actually happened.
 */
export function describeDemoError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (/registered client_id/i.test(msg)) return DEMO_NOT_ENABLED;
  if (/not a trusted issuer/i.test(msg)) {
    return 'The card room does not trust that Home, so a demo sign-in cannot be completed on this deployment.';
  }
  if (/incomplete session/i.test(msg)) {
    return 'The Home returned a partial sign-in (no delegation), so there is nothing to seat you with.';
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Could not reach the Home to connect as that demo user.';
  return msg ? `Could not connect as that demo user — ${msg}` : 'Could not connect as that demo user.';
}
