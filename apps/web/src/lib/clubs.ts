/**
 * Clubs, as the browser reasons about them.
 *
 * Everything here is pure, because everything here is a sentence somebody reads before they press
 * something. What a host may do, what a member may not, and whether the thing they typed is somebody
 * the card room can recognise — all answerable without a round trip, and all worth being able to
 * test as text rather than as a rendered page.
 *
 * The card room is still the authority on every one of these. This is what the client says FIRST, so
 * a person is not sent to a refusal they could have been told about while they were typing.
 */

import type { ClubStanding } from './types';

/** A host runs the club: the roster, the tables, and later the schedule. */
export function canInvite(standing: ClubStanding): boolean {
  return standing === 'host';
}

/** Opening a table for a club is a host's act. A member sits at it. */
export function canOpenTable(standing: ClubStanding): boolean {
  return standing === 'host';
}

/** "Host" / "Member" — what to put next to a club's name. */
export function standingLabel(standing: ClubStanding): string {
  return standing === 'host' ? 'Host' : standing === 'member' ? 'Member' : '';
}

/**
 * WHICH KIND of identifier a host typed, read on the client so the form can act on it.
 *
 * Four shapes reach a roster, and they do not all take the same road:
 *
 *   `address` / `player`  an identifier already — straight onto the roster
 *   `name`                `carol.me`, which the card room resolves on chain — also straight on
 *   `email`               names nobody. It opens an INVITATION, and becomes a membership when
 *                         somebody signs in and claims it.
 *
 * The client reads the shape only to choose which call to make and what to say while typing. The
 * card room decides, every time; a client that decided would be a client that could be lied to.
 */
export type MemberShape = 'address' | 'player' | 'name' | 'email' | 'unknown' | 'empty';

/** A dotted agent name: at least two labels, so `carol.me` is one and `carol` is not. */
const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function memberShape(raw: string): MemberShape {
  const v = (raw ?? '').trim();
  if (!v) return 'empty';
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return 'address';
  if (/^(home:0x[0-9a-fA-F]{40}|dev:[a-z0-9-]{1,64})$/i.test(v)) return 'player';
  if (EMAIL_RE.test(v)) return 'email';
  if (NAME_RE.test(v)) return 'name';
  return 'unknown';
}

export type MemberCheck = { ok: true; shape: MemberShape } | { ok: false; shape: MemberShape; hint: string };

/**
 * Is this somebody the card room can be asked about?
 *
 * Everything but `unknown` is now a yes, including an email — which does not go onto a roster, but
 * IS a thing a host can do something with, and telling them it is not is how this form spent its
 * first month sending people to look for a hex string they had no way to get.
 *
 * Empty is NOT an error. Nobody has typed anything yet, and a form that goes red before you start is
 * telling you off for arriving.
 */
export function checkMember(raw: string): MemberCheck {
  const shape = memberShape(raw);
  if (shape === 'unknown') {
    return {
      ok: false,
      shape,
      hint: 'That is not a name, an email address or a Smart Agent address. An agent name looks like carol.me.',
    };
  }
  return { ok: true, shape };
}

/**
 * What the button will DO with what has been typed — the sentence under the field.
 *
 * The two roads have different consequences and the host should know which one they are on before
 * they press it: adding somebody is immediate and private to the club, sending an invitation puts
 * their address in an email and waits for them.
 */
export function memberAction(raw: string): { label: string; hint: string } {
  switch (memberShape(raw)) {
    case 'email':
      return { label: 'Send an invitation', hint: 'They get a link. They are on the roster once they open it and sign in.' };
    case 'name':
      return { label: 'Add to the club', hint: 'Looked up by name, and added straight away.' };
    case 'address':
    case 'player':
      return { label: 'Add to the club', hint: 'Added straight away.' };
    default:
      return { label: 'Add to the club', hint: 'A name like carol.me, an email address, or a Smart Agent address.' };
  }
}

/**
 * What to say about a club's tables when there are none.
 *
 * Split by standing because the two people are stuck on different things: a host can fix it, and a
 * member cannot and should not be told to. Offering a member a button they will be refused at is
 * worse than saying nothing.
 */
export function noTablesLine(standing: ClubStanding, clubName: string): string {
  return canOpenTable(standing)
    ? `No tables are open at ${clubName}. Open one below and it is private to its members.`
    : `No tables are open at ${clubName} right now. A host opens them.`;
}

/* ------------------------------------------------------------------- retiring one */

/**
 * WHAT CLOSING A CLUB ACTUALLY DOES, said before it is done.
 *
 * A club was permanent until there was a route to retire one, and the thing that replaces "permanent"
 * has to be honest about its own reach, because the host cannot check afterwards. Each line is one
 * consequence, and the last one is the one nobody expects: the card room cannot touch the club's Smart
 * Agent, so an agent the host chartered goes on existing at their own Home.
 */
export function retireConsequences(clubName: string, tables: number, agent: string | undefined): string[] {
  const lines = [`${clubName} disappears from everybody's list, not only yours.`];
  if (tables > 0) {
    lines.push(`Its ${tables === 1 ? 'table closes' : `${tables} tables close`}. Nobody can be sitting at one when you do this.`);
  }
  lines.push('Invitations that have not been opened yet stop working.');
  if (agent) {
    // The one thing this does NOT do. Saying "deleted" over an agent that is still out there in the
    // estate with the host's name on it is the misleading half of an otherwise complete answer.
    lines.push('Its Smart Agent is NOT removed — that lives at your Home and this card room has never held its key.');
  }
  lines.push('There is no undo.');
  return lines;
}

/**
 * Does what they typed mean the club they are looking at?
 *
 * Case and surrounding space are forgiven. The point of typing a name back is DELIBERATENESS — that
 * the hand doing this knows which club it is closing — and a confirmation that also demands exact
 * capitalisation is testing typing, which is a different thing and one people defeat by pasting.
 */
export function confirmsRetire(typed: string, clubName: string): boolean {
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(typed) !== '' && norm(typed) === norm(clubName);
}

/** What to say once it is done, in the order the host cares about. */
export function retiredLine(result: { name: string; tablesClosed: readonly string[]; agent?: string }): string {
  const parts = [`${result.name} is closed.`];
  if (result.tablesClosed.length > 0) {
    parts.push(`${result.tablesClosed.length === 1 ? 'Its table was closed' : `Its ${result.tablesClosed.length} tables were closed`} with it.`);
  }
  if (result.agent) parts.push('Its Smart Agent is untouched and still yours, at your Home.');
  return parts.join(' ');
}

/* ----------------------------------------------------------- the club's own agent */

/**
 * What to say about a club's Smart Agent — the `<label>.workspace` its host charters at their Home.
 *
 * A club works without one: the roster, the tables and the standing all answer today. What the agent
 * adds is that the club becomes a thing in the estate rather than only a thing in this card room —
 * its own vault, its own name, and (later) its own messages. So this is an OFFER, never a blocker,
 * and it is only ever offered to the person who can accept it.
 */
export type CharterState =
  | { kind: 'chartered'; agent: string }
  | { kind: 'offer' }
  | { kind: 'unavailable' }
  | { kind: 'hidden' };

export function charterState(
  club: { agent?: string; you: { standing: ClubStanding } },
  /** Whether this deployment's Home is registered to run the ceremony at all. */
  hasTemplate: boolean,
): CharterState {
  // A fact about the club, shown to anyone who can see the club.
  if (club.agent) return { kind: 'chartered', agent: club.agent };
  // Not a host: not their errand, and offering it would be offering a refusal.
  if (club.you.standing !== 'host') return { kind: 'hidden' };
  return hasTemplate ? { kind: 'offer' } : { kind: 'unavailable' };
}

/** The sentence under the charter offer. Says what it gets them, not what it is. */
export const CHARTER_BLURB =
  'Give this club an agent of its own at your Home. You keep the keys; the card room never holds them.';

/* ------------------------------------------------------ membership at the Home */

/**
 * WHERE ONE MEMBERSHIP STANDS AT THE HOME, for the roster row and for the banner (WORKSPACES.md §5, 2026-09-13).
 *
 *   steward   the host: the club's agent is theirs, there is nothing to join
 *   joined    the Home records them — the club's agent knows them, its huddle lets them in
 *   invited   the host has invited them at their Home; they have not joined yet
 *   pending   the club is chartered and this membership exists only in the card room
 *   none      no Home is involved: the club is not chartered, or this member has no agent (a dev session)
 */
export type HomeMembership = 'steward' | 'joined' | 'invited' | 'pending' | 'none';

export function membershipAtHome(
  club: { agent?: string; createdBy: string },
  member: { member: string; home?: 'invited' | 'joined' },
): HomeMembership {
  if (!club.agent) return 'none';
  if (member.member === club.createdBy) return 'steward';
  if (!member.member.startsWith('home:')) return 'none';
  return member.home ?? 'pending';
}

/** The agent address a `home:0x…` player id names, or null for anybody else. */
export function agentOfPlayer(playerId: string): string | null {
  const m = playerId.match(/^home:(0x[0-9a-fA-F]{40})$/);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** The row's word about it. Empty where there is nothing to say (the host, an unchartered club). */
export function homeMembershipLabel(state: HomeMembership): string {
  switch (state) {
    case 'joined': return 'joined at Home';
    case 'invited': return 'invited at Home';
    case 'pending': return 'not yet at Home';
    default: return '';
  }
}
