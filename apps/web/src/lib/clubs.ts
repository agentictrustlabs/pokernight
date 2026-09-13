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
export function retireConsequences(clubName: string, tables: number): string[] {
  const lines = [`${clubName} disappears from everybody's list, not only yours.`];
  if (tables > 0) {
    lines.push(`Its ${tables === 1 ? 'table closes' : `${tables} tables close`}. Nobody can be sitting at one when you do this.`);
  }
  // The one thing this does NOT do. Saying "deleted" over an agent that is still out there in the
  // estate with the host's name on it is the misleading half of an otherwise complete answer.
  lines.push('Its Smart Agent is NOT removed — that lives at your Home and this card room has never held its key; this card room only stops acting as it.');
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

/** The sentence under "Start it": what a club IS. A club is chartered as an agent at the host's Home — it
 *  exists nowhere else, and the card room acts as it under an authorisation the host signs there. */
export const CHARTER_BLURB =
  'The club is chartered as an agent of its own at your Home — you keep the keys, and this card room acts as it only under an authorisation you sign there.';
