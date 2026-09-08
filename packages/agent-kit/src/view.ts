/**
 * Helpers over the redacted `TableView` an agent receives.
 *
 * Everything here is pure and side-effect free: read a view, return a number,
 * a list, or a label. Nothing depends on the engine bodies being implemented.
 */

import type { Card, LegalActions, SeatView, Street, TableView } from '@pokernight/engine';

export type Position = 'blinds' | 'early' | 'middle' | 'late';

/** The viewer's own seat view, or null for spectators / not seated. */
export function mySeat(view: TableView): SeatView | null {
  if (view.viewerSeat === null) return null;
  return view.seats.find((s) => s.seat === view.viewerSeat) ?? null;
}

/** The viewer's hole cards (empty when not in a hand or a spectator). */
export function myHoleCards(view: TableView): Card[] {
  return mySeat(view)?.inHand?.holeCards ?? [];
}

/** The viewer's current stack (0 when not seated). */
export function myStack(view: TableView): number {
  return mySeat(view)?.stack ?? 0;
}

/**
 * Total chips in the middle: collected pots plus everything bet on the
 * current street that has not yet been swept into a pot.
 */
export function potTotal(view: TableView): number {
  const hand = view.hand;
  if (!hand) return 0;
  const pots = hand.pots.reduce((sum, p) => sum + p.amount, 0);
  const street = view.seats.reduce((sum, s) => sum + (s.inHand?.streetBet ?? 0), 0);
  return pots + street;
}

/** Chips the viewer must add to call (0 when checking is free or calling is impossible). */
export function toCall(legal: LegalActions): number {
  return legal.call ?? 0;
}

/**
 * Pot odds as a fraction in [0, 1): the price of a call relative to the pot
 * after the call. 0 when there is nothing to call. Compare against equity.
 */
export function potOdds(legal: LegalActions, view: TableView): number {
  const call = toCall(legal);
  if (call <= 0) return 0;
  const pot = potTotal(view);
  return call / (pot + call);
}

/** Seats dealt into the current hand that have not folded. */
export function playersInHand(view: TableView): SeatView[] {
  return view.seats.filter((s) => s.inHand && !s.inHand.folded);
}

/**
 * Effective stack: the most the viewer can win or lose against the remaining
 * opponents, i.e. min(own stack, largest live opponent stack). Chips already
 * committed this hand count, since they are still in play.
 */
export function effectiveStack(view: TableView): number {
  const me = mySeat(view);
  if (!me) return 0;
  const mine = me.stack + (me.inHand?.totalBet ?? 0);
  const opponents = playersInHand(view).filter((s) => s.seat !== me.seat);
  if (opponents.length === 0) return me.stack;
  const biggest = Math.max(...opponents.map((s) => s.stack + (s.inHand?.totalBet ?? 0)));
  return Math.min(mine, biggest);
}

/** Stack-to-pot ratio for the viewer (Infinity when the pot is empty). */
export function spr(view: TableView): number {
  const pot = potTotal(view);
  const stack = myStack(view);
  return pot > 0 ? stack / pot : Number.POSITIVE_INFINITY;
}

/** Current street, or null outside a hand. */
export function street(view: TableView): Street | null {
  return view.hand?.street ?? null;
}

/**
 * Seats in dealing order starting one past the button. During a hand only
 * dealt seats count (folded ones included, since position is fixed at the
 * deal); between hands, all active seats count.
 */
export function seatsFromButton(view: TableView): number[] {
  const button = view.button;
  const dealt = view.hand
    ? view.seats.filter((s) => s.inHand !== undefined).map((s) => s.seat)
    : view.seats.filter((s) => s.status === 'active').map((s) => s.seat);
  if (dealt.length === 0) return [];
  const sorted = [...dealt].sort((a, b) => a - b);
  if (button === null) return sorted;
  const after = sorted.filter((s) => s > button);
  const before = sorted.filter((s) => s <= button);
  return [...after, ...before]; // button itself comes last
}

/**
 * Coarse table position for the viewer relative to the button.
 *
 * - `late`: button and cutoff (heads-up: the button)
 * - `blinds`: small and big blind (heads-up: the non-button seat)
 * - `early` / `middle`: the remaining seats, first half early, second half middle
 */
export function position(view: TableView): Position | null {
  const me = view.viewerSeat;
  if (me === null) return null;
  const order = seatsFromButton(view);
  const idx = order.indexOf(me);
  if (idx < 0) return null;
  const n = order.length;
  if (n === 1) return 'late';
  const fromButton = n - 1 - idx; // 0 = button, 1 = cutoff, ...
  if (n === 2) return fromButton === 0 ? 'late' : 'blinds';
  if (idx === 0 || idx === 1) return 'blinds';
  if (fromButton <= 1) return 'late';
  // Remaining seats between BB and cutoff.
  const remaining = n - 4; // exclude SB, BB, CO, BTN
  const slot = idx - 2; // 0 = UTG
  const earlyCount = Math.ceil(remaining / 2);
  return slot < earlyCount ? 'early' : 'middle';
}

/** Number of raises (bet/raise actions) on the given street so far. */
export function raisesOnStreet(view: TableView, s: Street): number {
  if (!view.hand) return 0;
  return view.hand.actions.filter(
    (a) => a.street === s && (a.action.type === 'bet' || a.action.type === 'raise' || a.action.type === 'all-in'),
  ).length;
}

/** Seat that made the last bet/raise on the given street, or null. */
export function aggressorOnStreet(view: TableView, s: Street): number | null {
  if (!view.hand) return null;
  for (let i = view.hand.actions.length - 1; i >= 0; i--) {
    const a = view.hand.actions[i]!;
    if (a.street !== s) continue;
    if (a.action.type === 'bet' || a.action.type === 'raise') return a.seat;
    if (a.action.type === 'all-in' && a.amount > 0) return a.seat;
  }
  return null;
}

/** The street before `s` (null for preflop). */
export function previousStreet(s: Street): Street | null {
  switch (s) {
    case 'flop':
      return 'preflop';
    case 'turn':
      return 'flop';
    case 'river':
      return 'turn';
    case 'showdown':
      return 'river';
    default:
      return null;
  }
}

/** True when the viewer made the last aggressive action on the previous street. */
export function wasAggressor(view: TableView): boolean {
  const s = street(view);
  if (!s || view.viewerSeat === null) return false;
  const prev = previousStreet(s);
  if (!prev) return false;
  return aggressorOnStreet(view, prev) === view.viewerSeat;
}

/** Whether the viewer acts after every other live player on this street. */
export function inPosition(view: TableView): boolean {
  const me = view.viewerSeat;
  if (me === null) return false;
  const order = seatsFromButton(view);
  const live = new Set(playersInHand(view).map((s) => s.seat));
  const liveOrder = order.filter((s) => live.has(s));
  return liveOrder.length > 0 && liveOrder[liveOrder.length - 1] === me;
}
