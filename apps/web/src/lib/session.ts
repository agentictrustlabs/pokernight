/**
 * What ending a session means, as a pure decision.
 *
 * There are two ways a session ends and they must land in the SAME place — the sign-in page — because
 * the alternative is a signed-out person looking at a lobby they cannot use, or a table that has
 * stopped updating. The only difference is whether we owe them an explanation: a person who clicked
 * "sign out" knows what happened; a person whose token was refused mid-hand does not.
 */

import { SIGNIN_HASH } from './routes';

export type SignOutReason =
  /** The person asked to sign out. */
  | 'user'
  /** The API refused the session token (expired, signed out elsewhere, server restarted). */
  | 'expired';

export interface SignOutOutcome {
  /** Always null: the whole point is that no session survives this. */
  session: null;
  /** A sentence to show on the sign-in page, or null when none is owed. */
  notice: string | null;
  /** Where the person ends up. */
  hash: string;
  /** Whether the server-side session record is worth trying to drop (pointless once it is refused). */
  revoke: boolean;
}

export const SESSION_ENDED_NOTICE = 'Your session ended. Sign in again to take your seat.';

export function signOutTo(reason: SignOutReason): SignOutOutcome {
  return {
    session: null,
    notice: reason === 'expired' ? SESSION_ENDED_NOTICE : null,
    hash: SIGNIN_HASH,
    revoke: reason === 'user',
  };
}
