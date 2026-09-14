/**
 * THE LEFT RAIL, as a decision rather than as markup.
 *
 * The card room has two kinds of visitor and they arrive wanting opposite things: somebody who wants
 * to be dealt a hand and has never heard of a club, and somebody a club invited. The navigation has
 * to serve both from one screen, and this module is the whole of what it decides.
 *
 * WHY THERE IS NO CONTEXT SWITCHER. The obvious shape — a person/club chooser at the top, everything
 * below it scoped to the choice — was designed (`docs/NAVIGATION.md` §3), researched against eleven
 * products (`docs/NAVIGATION-RESEARCH.md`), and rejected. A switcher is a CONTAINER's instrument: it
 * is right in Discord and Slack because switching genuinely replaces the application. Switch club
 * here and what changes is a roster, a calendar and a leaderboard — your treasury, your identity,
 * your seat and the rules of the game are the same in every club and outside all of them. Not one
 * game product in the survey has one, and the commonest visitor would meet it first, as a menu with
 * a single item in it.
 *
 * So clubs are a PINNED, NAMED LIST inside the rail, and each club is a destination with a page of
 * its own. The list degrades by how many you have, which is the only thing that varies:
 *
 *   none   one row to start one, and one for somebody holding an invitation
 *   one    that club, by its own name — what a switcher would have given them, permanently
 *   more   a short list by name
 *
 * Everything here is pure and takes the route as an argument, so "which row am I on" is testable as
 * data and there is exactly one answer to it.
 */

import type { Route } from './routes';
import { HOME_HASH, MISSIONS_HASH, MONEY_HASH, TABLES_HASH, clubHash } from './routes';

/** One row in the rail. */
export interface NavItem {
  key: string;
  label: string;
  hash: string;
  /** A quiet second line, where the label alone does not say what the row is for. */
  sub?: string;
  /** Whether the current route IS this row. Exactly one row is ever true. */
  here: boolean;
}

/**
 * The three things that are yours wherever you are.
 *
 * Play is first because being dealt a hand is what somebody came for, and because it is the one row
 * that works with no club, no money and — at the practice table — nobody else. Tables is second
 * because it is first for everybody who comes BACK, and it is where leaving a table lands.
 */
export function yourRail(r: Route): NavItem[] {
  return [
    { key: 'play', label: 'Play', hash: HOME_HASH, sub: 'a hand now, against the house', here: r.page === 'home' },
    { key: 'tables', label: 'Tables', hash: TABLES_HASH, sub: 'what is running', here: r.page === 'tables' },
    // MISSIONS is a verb row too — "who could be the guest tonight" — because a mission is invited to any game,
    // not to a club: the registry is the card room's, on a map, and a club's night or a table names one from it.
    { key: 'missions', label: 'Missions', hash: MISSIONS_HASH, sub: 'guests for a night', here: r.page === 'missions' || r.page === 'newMission' || r.page === 'mission' },
    { key: 'money', label: 'Your money', hash: MONEY_HASH, here: r.page === 'money' },
  ];
}

/**
 * The clubs slot.
 *
 * `loading` is its own answer rather than being folded into `none`: telling somebody they are in no
 * clubs before we have asked is telling them something we do not know, and they would read the two
 * offers underneath as the only thing available to them.
 */
export interface ClubRail {
  kind: 'loading' | 'none' | 'list';
  clubs: NavItem[];
}

export function clubRail(clubs: readonly { clubId: string; name: string }[] | null, r: Route): ClubRail {
  if (clubs == null) return { kind: 'loading', clubs: [] };
  if (clubs.length === 0) return { kind: 'none', clubs: [] };
  const here = r.page === 'club' ? r.clubId : null;
  return {
    kind: 'list',
    clubs: clubs.map((c) => ({ key: c.clubId, label: c.name, hash: clubHash(c.clubId), here: c.clubId === here })),
  };
}

/**
 * The heading above the club list.
 *
 * "Your clubs" with one in it reads oddly, and a plural heading over a single named row is the tell
 * that a list was built before anybody checked what it usually holds.
 */
export function clubHeading(count: number): string {
  return count === 1 ? 'Your club' : 'Your clubs';
}

/**
 * Whether the club in the URL is one this person is actually in.
 *
 * Null while the list is still being read — NOT false. A club page that decided "you are not in this"
 * from an unanswered question would bounce somebody off a club they had just been invited to, on a
 * slow connection, every time.
 */
export function inClub(clubs: readonly { clubId: string }[] | null, clubId: string): boolean | null {
  if (clubs == null) return null;
  return clubs.some((c) => c.clubId === clubId);
}
