/**
 * What ending a session means, as a pure decision.
 *
 * There are two ways a session ends and they must land in the SAME place — the sign-in page — because
 * the alternative is a signed-out person looking at a lobby they cannot use, or a table that has
 * stopped updating. The only difference is whether we owe them an explanation: a person who clicked
 * "sign out" knows what happened; a person whose token was refused mid-hand does not.
 */

import { looksLikeAddress } from './format';
import { SIGNIN_HASH } from './routes';
import type { SignOutResult } from './types';

export type SignOutReason =
  /** The person asked to sign out. */
  | 'user'
  /** The API refused the session token (expired, signed out elsewhere, server restarted). */
  | 'expired'
  /**
   * The session was ended somewhere else in this browser — the `/sso-logout` page, run because the
   * person signed out at their Home, or another tab of this app. The seats have ALREADY been given
   * up and the token has already been revoked by whoever did it, so this tab must catch up without
   * doing any of it a second time.
   */
  | 'elsewhere';

export interface SignOutOutcome {
  /** Always null: the whole point is that no session survives this. */
  session: null;
  /** A sentence to show on the sign-in page, or null when none is owed. */
  notice: string | null;
  /** Where the person ends up. */
  hash: string;
  /** Whether the server-side session record is worth trying to drop (pointless once it is refused). */
  revoke: boolean;
  /**
   * Whether this ending should also GIVE UP the person's seats — standing them up and, on a settled
   * table, cashing them out.
   *
   * True only when the person asked to sign out. That is them saying they are finished, and leaving
   * their USDC committed to a seat they have walked away from is the bug this closes.
   *
   * False when the session merely expired, which must behave like a dropped connection instead: the
   * socket closes, the table sits them out, and their seat and chips stay exactly where they are. An
   * expired token is not consent to move somebody's money — and a person whose session lapsed
   * mid-night is far more likely to sign back in and keep playing than to have meant to leave.
   */
  standUp: boolean;
}

export const SESSION_ENDED_NOTICE = 'Your session ended. Sign in again to take your seat.';
export const SIGNED_OUT_ELSEWHERE_NOTICE = 'You were signed out. Your seats were given up when the sign-out ran.';

export function signOutTo(reason: SignOutReason): SignOutOutcome {
  return {
    session: null,
    notice: reason === 'expired' ? SESSION_ENDED_NOTICE : reason === 'elsewhere' ? SIGNED_OUT_ELSEWHERE_NOTICE : null,
    hash: SIGNIN_HASH,
    // Only 'user' does the work. 'expired' has nothing left to revoke, and 'elsewhere' is this tab
    // finding out about a sign-out that has already stood the player up and killed the token —
    // repeating either would be a second stand-up against a seat that is already gone.
    revoke: reason === 'user',
    standUp: reason === 'user',
  };
}

/**
 * What to tell someone about the seats their sign-out gave up.
 *
 * The one rule here is that a QUEUED cash-out is not a completed one. On a settled table the money
 * leaves through the table's outbox with retries behind it, and it has not landed when this response
 * comes back — so the sentence says "on its way", never "back in your treasury". Saying the money is
 * home when it is not is worse than saying nothing, because it is the sentence that stops someone
 * checking.
 */
export function describeSignOut(result: SignOutResult): string | null {
  const parts: string[] = [];
  if (result.stoodUp.length > 0) {
    const pending = result.stoodUp.filter((s) => s.pending);
    const settled = result.stoodUp.filter((s) => !s.pending);
    if (settled.length > 0) {
      parts.push(`You were stood up from ${seatList(settled.map((s) => s.tableName ?? s.tableId))}.`);
    }
    if (pending.length > 0) {
      parts.push(
        `Your chips at ${seatList(pending.map((s) => s.tableName ?? s.tableId))} are being cashed out — the USDC is on its way back to your treasury and has not landed yet.`,
      );
    }
  }
  for (const f of result.failed) {
    parts.push(`We could not stand you up from ${f.tableName ?? f.tableId}: ${f.reason}. Your chips are still on that seat.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function seatList(names: string[]): string {
  if (names.length === 1) return names[0] as string;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* ------------------------------------------------------- who you are, on screen */

/**
 * The name to put on screen for a signed-in person.
 *
 * A Home that knows someone as a phone number or an email address asserts no agent name, and hands
 * back their Smart Agent address as the display name. Printing that in the top bar puts a raw
 * address in the one place every screen shows — so it becomes "You", and the address stays on the
 * element's title and in the details, where someone who wants it can find it.
 */
export function displayName(session: { name: string; agentName?: string | undefined; address?: string | undefined }): string {
  const agent = session.agentName?.trim();
  if (agent && !looksLikeAddress(agent)) return agent;
  const name = session.name?.trim() ?? '';
  if (name && !looksLikeAddress(name)) return name;
  return 'You';
}

