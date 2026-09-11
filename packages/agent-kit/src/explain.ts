/**
 * READING A HOLD'EM HAND FROM ONE SEAT — the numbers that actually decide, said in words.
 *
 * The twin of `@pokernight/canasta-agent`'s `explainMove`, and it lives in the AGENT rather than in
 * the card room for the same reason that one does: advice is the agent's business. The card room's
 * part is to ask and to say whose answer it is showing.
 *
 * WHAT IT REFUSES TO DO is invent. A seat sees its own two cards and the board, so anything said
 * about another player is a reading of what they DID — position, how much, how often — and is worth
 * saying that way. "They raised early and bet twice, so they are weighted strong" is evidence.
 * "They have ace-king" is a lie with a rule of thumb behind it.
 */

import type { LegalActions, TableView } from '@pokernight/engine';
// `inPosition` is this package's own: it walks the real order from the button rather than
// re-deriving it. A second implementation of who acts last is a second chance to be wrong.
import { inPosition } from './view.js';

export interface Read {
  /** One sentence, mid-hand, for somebody with a clock running. */
  say: string;
  /** The reason, which is the half that teaches and the half they can disagree with. */
  because: string;
}

/** What is in the pots right now, before this decision. */
export function potSize(view: TableView): number {
  return (view.hand?.pots ?? []).reduce((a, p) => a + p.amount, 0);
}

/**
 * The price a call is being offered, as the percentage of the time it has to be good.
 *
 * Calling `toCall` into a pot of `pot` risks `toCall` to win `pot + toCall`, so the break-even share
 * is `toCall / (pot + toCall)`. Said as a percentage on purpose: a ratio is a puzzle mid-hand, and
 * the number somebody needs is "how often does this have to be best".
 */
export function priceToCall(pot: number, toCall: number): number | null {
  if (toCall <= 0) return null;
  const total = pot + toCall;
  return total <= 0 ? null : Math.round((toCall / total) * 100);
}

/**
 * Roughly how often a draw arrives, from a count of outs.
 *
 * The two-and-four rule: about 2% per out with one card to come, 4% with two. It is a rule of thumb
 * and is said as one — a number presented as exact that is not is worse than a rough number labelled
 * rough.
 */
export function chanceFromOuts(outs: number, cardsToCome: number): number {
  if (outs <= 0 || cardsToCome <= 0) return 0;
  return Math.min(95, outs * (cardsToCome >= 2 ? 4 : 2));
}

/** How many cards are still to come after this street. */
export function cardsToCome(street: string): number {
  return street === 'preflop' ? 5 : street === 'flop' ? 2 : street === 'turn' ? 1 : 0;
}

/** How many opponents are still in the hand — the single biggest thing a hand's strength depends on. */
export function liveOpponents(view: TableView, seat: number): number {
  return (view.seats ?? []).filter((s) => s.seat !== seat && s.inHand && !s.inHand.folded).length;
}

/** "the flop", "the turn" — the street as a person names it. */
function streetName(street: string): string {
  return street === 'preflop' ? 'before the flop' : street === 'flop' ? 'on the flop' : street === 'turn' ? 'on the turn' : 'on the river';
}

/**
 * The read for one seat, right now.
 *
 * Deliberately built from what is CERTAIN — the price, the number of opponents, position, the stack
 * behind — rather than from a hand-strength model. A confident equity figure would be the most
 * impressive and least honest thing this could return: it would have to assume ranges nobody stated.
 */
export function readHand(view: TableView, seat: number, legal: LegalActions | null): Read {
  const hand = view.hand;
  if (!hand) return { say: 'No hand is running.', because: 'The table is between hands.' };

  const me = (view.seats ?? []).find((s) => s.seat === seat);
  const pot = potSize(view);
  const toCall = legal?.call ?? 0;
  const price = priceToCall(pot, toCall);
  const others = liveOpponents(view, seat);
  const behind = me?.stack ?? 0;
  const where = streetName(hand.street);
  const position = inPosition(view) ? 'You act last' : 'You act before somebody';

  const parts: string[] = [];
  if (price !== null) {
    parts.push(
      `Calling ${toCall} into ${pot} needs this to be best about ${price}% of the time.`,
    );
  } else if (legal?.check) {
    parts.push('Checking is free — there is no price to pay to see another card.');
  }
  parts.push(`${position} ${where}, against ${others === 1 ? 'one player' : `${others} players`}.`);
  if (behind > 0 && pot > 0) {
    const spr = Math.round((behind / pot) * 10) / 10;
    parts.push(`You have ${behind} behind, ${spr} times the pot — that is what is actually at risk.`);
  }

  const say =
    price !== null
      ? `You are being asked ${toCall} into ${pot} — about ${price}%.`
      : legal?.check
        ? 'Nothing to call. You can see another card for free.'
        : 'Your turn.';

  return { say, because: parts.join(' ') };
}
