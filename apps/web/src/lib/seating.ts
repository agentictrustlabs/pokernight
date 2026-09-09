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
  if (handRunning || activeCount >= MIN_PLAYERS_TO_DEAL) {
    return { handRunning, activeCount, seatedCount, waiting: null };
  }
  const satOut = seatedCount - activeCount;
  let waiting: string;
  if (seatedCount === 0) {
    waiting = 'Nobody is seated yet. A hand needs two players.';
  } else if (activeCount === 0 && satOut > 0) {
    waiting =
      satOut === 1
        ? 'The one player at this table is sitting out, so no hand can start.'
        : `All ${satOut} players at this table are sitting out, so no hand can start.`;
  } else if (satOut > 0) {
    waiting = `Only one player is sitting in. ${satOut === 1 ? 'The other seat is' : `${satOut} other seats are`} sitting out, so no hand can start.`;
  } else {
    waiting = 'Only one player is seated. A hand needs two.';
  }
  return { handRunning, activeCount, seatedCount, waiting };
}

/* ------------------------------------------------------- why am I sitting out? */

/**
 * The sentence to put next to "Sit in".
 *
 * A sit-out that happened TO someone — a dropped connection, a run of missed turns — is invisible
 * from their side: they come back to a table that is not dealing them in and no explanation for it.
 * Naming the cause is what turns "this is broken" into "press this".
 */
export function sitOutNotice(reason: SitOutReason | undefined): string {
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
