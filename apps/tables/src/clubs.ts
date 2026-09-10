/**
 * The Worker's half of a club: resolve the caller, DERIVE their standing, then decide.
 *
 * `ClubDO` holds the roster and answers what somebody is; nothing here duplicates that. What lives
 * here is the part that must not live in the object — turning a session into a player, turning a
 * typed-in name into a member id, and turning a standing into an allowed or refused request, in
 * words the person can act on.
 *
 * Every refusal in this file names what is missing. "You are not a member of Thursday Night" is a
 * useful sentence; 403 with no body is not, and an empty list is worse than either, because it reads
 * as "this club has nobody in it" — a different and false statement.
 */

import type { ClubStanding } from '@pokernight/protocol';
import type { Env } from './env.js';
import { homePlayerId } from './home.js';
import { looksLikeAgentName, resolveAgentName } from './naming.js';
import type { StandingAnswer } from './club-do.js';

export const CLUB_ID_RE = /^[0-9a-f-]{36}$/;

export function clubStub(env: Env, clubId: string) {
  return env.CLUBS.get(env.CLUBS.idFromName(clubId));
}

/**
 * What `player` is to `clubId`, from the club's own records.
 *
 * `null` means there is no such club — which the caller turns into a 404 rather than a refusal,
 * because a club nobody has standing in must be indistinguishable from one that does not exist.
 */
export async function standingAt(env: Env, clubId: string, playerId: string | null): Promise<StandingAnswer | null> {
  if (!CLUB_ID_RE.test(clubId)) return null;
  const res = await clubStub(env, clubId).fetch(`https://club/standing?player=${encodeURIComponent(playerId ?? '')}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as StandingAnswer;
}

/** True for a standing that may see a club at all. */
export function belongs(standing: ClubStanding): boolean {
  return standing === 'host' || standing === 'member';
}

/**
 * Read a member out of what a host typed.
 *
 * A `playerId` passes through. A bare Smart Agent address is read as the person it identifies, which
 * is how a host invites somebody by the only identifier they are likely to have of them. Anything
 * else is refused BY NAME rather than stored as an id that will never match a session — a roster row
 * nobody can ever satisfy is the kind of quiet failure that looks like a working invitation.
 */
export function memberIdOf(raw: string): { ok: true; member: string } | { ok: false; error: string } {
  const v = (raw ?? '').trim();
  if (!v) return { ok: false, error: 'who?' };
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { ok: true, member: homePlayerId(v) };
  if (/^(home:0x[0-9a-fA-F]{40}|dev:[a-z0-9-]{1,64})$/.test(v)) return { ok: true, member: v.toLowerCase() };
  return {
    ok: false,
    error: `"${v}" is not somebody this card room can recognise — invite them by their agent name or their Smart Agent address`,
  };
}

/** What a host typed, read as WHICH KIND of identifier it is. Shape only; nothing is looked up. */
export type InviteeShape = 'player' | 'address' | 'name' | 'email' | 'unknown';

export function inviteeShape(raw: string): InviteeShape {
  const v = (raw ?? '').trim();
  if (!v) return 'unknown';
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return 'address';
  if (/^(home:0x[0-9a-fA-F]{40}|dev:[a-z0-9-]{1,64})$/i.test(v)) return 'player';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (looksLikeAgentName(v)) return 'name';
  return 'unknown';
}

/**
 * Read a member out of what a host typed, INCLUDING an agent name.
 *
 * The sync `memberIdOf` above handles the two shapes that are already identifiers. This one adds the
 * shape a host actually knows people by — `carol.me` — which costs one on-chain read and is the
 * reason a poker night's host no longer has to ask their friends for a hex string.
 *
 * An EMAIL is refused here on purpose, and refused with the thing to do instead. It is not a
 * variation on this call: nothing maps an inbox to an agent, so an email opens a pending invitation
 * on a different route and becomes a roster row only when somebody signs in and claims it.
 */
export async function resolveInvitee(
  env: Env,
  raw: string,
): Promise<{ ok: true; member: string; name?: string } | { ok: false; error: string }> {
  const v = (raw ?? '').trim();
  switch (inviteeShape(v)) {
    case 'address':
    case 'player':
      return memberIdOf(v);
    case 'name': {
      const answer = await resolveAgentName(env, v);
      if (!answer.ok) return { ok: false, error: answer.error };
      // The NAME travels with the id, so the roster can show "carol.me" rather than an address the
      // host would have to recognise to know the invitation went to the right person.
      return { ok: true, member: homePlayerId(answer.address), name: answer.name };
    }
    case 'email':
      return { ok: false, error: `${v} is an email address — send them an invitation instead, and they join by opening it` };
    default:
      return memberIdOf(v);
  }
}
