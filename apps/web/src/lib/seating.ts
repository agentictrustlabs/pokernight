/**
 * Why the table is not dealing, and why you are not in it, as pure decisions.
 *
 * Both questions used to have the same answer on screen: nothing. A table short of players simply
 * went quiet — no hand started, no message appeared, and the action bar said "Not your turn", which
 * is a sentence about a hand that did not exist. A player who had been sat out found a small "Sit in"
 * button among the other controls with nothing to say why they were out. This module turns both into
 * sentences, so the screen can say what is true.
 */

import type { SitOutReason, TableView } from './types';

/* ------------------------------------------------------- can this table deal? */

export interface DealState {
  /** True while a hand is actually running. */
  handRunning: boolean;
  /** Seats that would be dealt into the next hand: sitting in, with chips. */
  activeCount: number;
  /** Seats occupied at all, however they are sitting. */
  seatedCount: number;
  /**
   * Seats with no chips left.
   *
   * Counted separately because "sitting out" and "out of chips" are the same seat status and
   * completely different situations: one is undone by a button, the other needs money. A table that
   * cannot deal because everybody is broke must say THAT, or the people at it press Sit in, nothing
   * happens, and the table reads as broken — which is what happened.
   */
  brokeCount: number;
  /**
   * Why no hand can start, or null when one can (or one is already running). The headline is always
   * "Waiting for another player"; this is the line under it that says which kind of waiting it is.
   */
  waiting: string | null;
}

/** A hand needs two seats that are sitting in and have chips — the engine's own `canStartHand`. */
export const MIN_PLAYERS_TO_DEAL = 2;

/**
 * What the table can and cannot do right now.
 *
 * Mirrors the engine's `candidates()`: active status, chips in front of you. Deliberately re-derived
 * on the client rather than asked for, because the view already carries every seat's status and stack
 * and a client that can compute it can also explain it — including the case the user hit, where two
 * people are seated, both sat out, and the table falls silent with no hand and no reason given.
 */
export function dealState(view: Pick<TableView, 'seats' | 'hand'>): DealState {
  const handRunning = view.hand != null && view.hand.result == null;
  const seatedCount = view.seats.length;
  const activeCount = view.seats.filter((s) => s.status === 'active' && s.stack > 0).length;
  const brokeCount = view.seats.filter((s) => s.stack === 0).length;
  if (handRunning || activeCount >= MIN_PLAYERS_TO_DEAL) {
    return { handRunning, activeCount, seatedCount, brokeCount, waiting: null };
  }
  const blocked = seatedCount - activeCount;
  const satOut = blocked - brokeCount;
  const players = (n: number): string => `${n} ${n === 1 ? 'player' : 'players'}`;
  let waiting: string;
  if (seatedCount === 0) {
    waiting = 'Nobody is seated yet. A hand needs two players.';
  } else if (brokeCount > 0 && satOut === 0) {
    // Everybody who is not playing is broke. Naming money rather than seat status is the whole
    // point: it is the difference between "press Sit in" and "buy back in".
    waiting =
      blocked === seatedCount
        ? brokeCount === 1
          ? 'The one player at this table has run out of chips, so no hand can start. Buying back in starts the next hand.'
          : `All ${players(brokeCount)} at this table have run out of chips, so no hand can start. Buying back in starts the next hand.`
        : `Only one player has chips. ${brokeCount === 1 ? 'The other seat has' : `${players(brokeCount)} have`} run out, so no hand can start.`;
  } else if (brokeCount > 0) {
    // Both kinds at once — say both, because the fix is different for each of them.
    waiting = `No hand can start: ${players(satOut)} ${satOut === 1 ? 'is' : 'are'} sitting out and ${players(brokeCount)} ${brokeCount === 1 ? 'has' : 'have'} run out of chips.`;
  } else if (activeCount === 0) {
    waiting =
      blocked === 1
        ? 'The one player at this table is sitting out, so no hand can start.'
        : `All ${players(blocked)} at this table are sitting out, so no hand can start.`;
  } else if (blocked > 0) {
    waiting = `Only one player is sitting in. ${blocked === 1 ? 'The other seat is' : `${blocked} other seats are`} sitting out, so no hand can start.`;
  } else {
    waiting = 'Only one player is seated. A hand needs two.';
  }
  return { handRunning, activeCount, seatedCount, brokeCount, waiting };
}

/* ------------------------------------------------- why am I not being dealt in? */

/**
 * The sentence for a player who is seated, sitting in, has chips — and is still not in the hand.
 *
 * A newcomer is not dealt into a hand that is already under way, and joins when the big blind
 * reaches their seat. That is an ordinary card-room rule and the reason for it is fair: dealing
 * somebody in just after the blinds have passed them lets them play a lap for nothing.
 *
 * IT WAS ON SCREEN AS "Waiting for BB", which is a phrase for people who already know it. Somebody
 * who does not is told, in two words they cannot look up, that something is wrong with them — and
 * the thing they actually need to know, that they are about to be dealt in and need do nothing, is
 * not said at all. This is that thing, said.
 *
 * Null when it does not apply, which is the ordinary case.
 */
export function waitingToBeDealtIn(view: Pick<TableView, 'seats' | 'viewerSeat' | 'hand'>): string | null {
  const me = view.viewerSeat == null ? null : view.seats.find((s) => s.seat === view.viewerSeat);
  if (!me || !me.waitingForBigBlind || me.status !== 'active') return null;
  // Two people at a table are dealt in together whatever the blinds have done, so a table this small
  // never leaves anybody out and saying otherwise would be a promise of a wait that is not coming.
  const others = view.seats.filter((s) => s.seat !== me.seat && s.status === 'active' && s.stack > 0);
  if (others.length < MIN_PLAYERS_TO_DEAL) return null;
  return 'You sat down after this hand began. You are dealt in when the big blind reaches your seat — a hand or two. Nothing to do.';
}

/** The same fact in two words, for the badge on a seat. */
export const DEALT_IN_SOON = 'Dealt in soon';

/* ------------------------------------------------------- why am I sitting out? */

/**
 * What a sat-out player is actually being offered.
 *
 * `sit-in` is the answer when they have chips and simply are not being dealt in. It is NOT the
 * answer when their stack is zero: sitting in with nothing changes nothing, the engine sits them
 * straight back out at the end of the next hand, and offering it is worse than offering nothing
 * because it looks like the fix. That was the dead end — a busted player pressing Sit in forever.
 *
 * Read from the STACK rather than from `sitOutReason`, deliberately: an empty stack is proof, and it
 * is right even for a player who was sat out for a different reason and happens also to be broke.
 * Whatever put them in the chair, money is what gets them out of it.
 */
export type SatOutAction = 'sit-in' | 'rebuy';

export function satOutAction(stack: number): SatOutAction {
  return stack > 0 ? 'sit-in' : 'rebuy';
}

/** The headline over that action. Two situations, two sentences, never the wrong one. */
export function satOutHeadline(stack: number): string {
  return stack > 0 ? 'You are sitting out' : 'You are out of chips';
}

/**
 * The sentence to put next to "Sit in".
 *
 * A sit-out that happened TO someone — a dropped connection, a run of missed turns — is invisible
 * from their side: they come back to a table that is not dealing them in and no explanation for it.
 * Naming the cause is what turns "this is broken" into "press this".
 */
export function sitOutNotice(reason: SitOutReason | undefined, stack = 1): string {
  // Being broke outranks every other explanation: it is both why they are out and the only thing
  // that has to change. A player on zero does not need to hear that their connection dropped.
  if (stack <= 0) {
    return 'Your chips are gone, so you are not being dealt in. Buy back in and you are in the next hand.';
  }
  switch (reason) {
    case 'disconnected':
      return 'You were sat out when your connection dropped. Your seat and your chips were kept exactly as they were.';
    case 'timeouts':
      return 'You were sat out after two missed turns. Your seat and your chips were kept exactly as they were.';
    case 'requested':
      return 'You asked to sit out. Your seat and your chips are still yours.';
    default:
      return 'You are sitting out, so you are not being dealt in. Your seat and your chips are still yours.';
  }
}
