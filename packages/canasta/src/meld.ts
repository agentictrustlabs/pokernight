/**
 * Melds: what may be laid down, and what a side must lay to open.
 *
 * This is where canasta stops resembling any other card game, and it is worth being exact. A meld is
 * three or more cards of one rank. Wild cards may stand in, but never more than three of them and
 * never more than the naturals — a meld is a set of sevens with help, not a pile of twos with a
 * seven in it. Seven cards or more is a CANASTA: clean if it has no wild, mixed if it has any, and
 * a side cannot go out without one.
 */

import { cardValue, isBlackThree, isMeldableRank, isWild, naturalsOfRank, rankOf } from './cards.js';
import type { Card, Meld, MeldSpec, Rank, TeamId } from './types.js';

/** The most wild cards one meld may ever hold, however long it grows. */
export const MAX_WILDS_PER_MELD = 3;
export const MIN_MELD = 3;
export const CANASTA_SIZE = 7;

export interface MeldCheck {
  ok: boolean;
  /** Why not, in words a player can act on. */
  reason?: string;
}

/**
 * The minimum a side's FIRST meld of a round must be worth, from its score going into that round.
 *
 * Rises as a side pulls ahead, which is the whole point of it: the leader has to work harder to get
 * started. A side in the red needs almost nothing, which is the mercy rule that keeps a bad round
 * from becoming a bad game.
 */
export function initialMeldMinimum(score: number): number {
  if (score < 0) return 15;
  if (score < 1500) return 50;
  if (score < 3000) return 90;
  return 120;
}

/** Is this collection, as a whole, a legal meld of `rank`? */
export function isLegalMeld(rank: Rank, cards: readonly Card[]): MeldCheck {
  if (cards.length < MIN_MELD) return { ok: false, reason: `a meld needs at least ${MIN_MELD} cards` };
  if (rank === '3') {
    // Black threes only, only as a complete meld, and only when going out — the caller checks that
    // last part, because whether you are going out is not a property of the cards.
    if (cards.some((c) => !isBlackThree(c))) return { ok: false, reason: 'threes cannot be melded' };
    return { ok: true };
  }
  if (!isMeldableRank(rank)) return { ok: false, reason: `${rank} is not a rank you can meld` };

  const wilds = cards.filter(isWild);
  const naturals = cards.filter((c) => !isWild(c));
  if (naturals.some((c) => rankOf(c) !== rank)) {
    return { ok: false, reason: `every card in a meld of ${rank}s must be a ${rank} or a wild card` };
  }
  if (naturals.length < 2) return { ok: false, reason: 'a meld needs at least two natural cards' };
  if (wilds.length > MAX_WILDS_PER_MELD) return { ok: false, reason: `a meld can hold at most ${MAX_WILDS_PER_MELD} wild cards` };
  if (wilds.length > naturals.length) return { ok: false, reason: 'a meld cannot hold more wild cards than natural ones' };
  return { ok: true };
}

export function isCanasta(meld: Meld): boolean {
  return meld.cards.length >= CANASTA_SIZE;
}

export function isNaturalCanasta(meld: Meld): boolean {
  return isCanasta(meld) && !meld.cards.some(isWild);
}

/** Has this side completed a canasta? Nothing may go out without one. */
export function hasCanasta(melds: readonly Meld[]): boolean {
  return melds.some(isCanasta);
}

export function findMeld(melds: readonly Meld[], rank: Rank): Meld | undefined {
  return melds.find((m) => m.rank === rank);
}

/**
 * What laying these specs would leave on the table, or why it cannot be done.
 *
 * PURE, and it takes the side's existing melds rather than the whole state, because the question
 * "is this a legal set of melds" has nothing to do with whose turn it is. The caller checks the turn,
 * the hand and the opening minimum; this checks the cards.
 *
 * A spec whose rank the side already has on the table ADDS to it — a side never holds two melds of
 * one rank, and asking for one is asking to split a canasta in half.
 */
export function applyMelds(
  existing: readonly Meld[],
  specs: readonly MeldSpec[],
): { ok: true; melds: Meld[]; laid: Card[] } | { ok: false; reason: string } {
  if (specs.length === 0) return { ok: false, reason: 'nothing to meld' };
  const next: Meld[] = existing.map((m) => ({ rank: m.rank, cards: m.cards.slice() }));
  const laid: Card[] = [];

  for (const spec of specs) {
    if (spec.cards.length === 0) return { ok: false, reason: `no cards given for the ${spec.rank}s` };
    const target = findMeld(next, spec.rank);
    const combined = target ? [...target.cards, ...spec.cards] : spec.cards.slice();

    // A NEW meld must be legal on its own. An ADDITION is judged on what the meld becomes, so a
    // single wild may join a meld of four sevens even though a wild alone is not a meld.
    const check = isLegalMeld(spec.rank, combined);
    if (!check.ok) return { ok: false, reason: check.reason ?? 'that is not a legal meld' };

    if (target) target.cards = combined;
    else next.push({ rank: spec.rank, cards: combined });
    laid.push(...spec.cards);
  }
  return { ok: true, melds: next, laid };
}

/**
 * The card value a side is credited with for OPENING, which is not the same as what it melds.
 *
 * Only the cards laid down this turn count, and only their face values. The red threes on the table
 * and the bonus a canasta will eventually pay are not part of it: a side opens with cards it played,
 * not with what it happens to be holding.
 */
export function openingValue(laid: readonly Card[]): number {
  return laid.reduce((n, c) => n + cardValue(c), 0);
}

/** Every rank this side already has down — the ranks it may add to freely. */
export function meldedRanks(melds: readonly Meld[]): Rank[] {
  return melds.map((m) => m.rank);
}

/**
 * Can `seat`'s side take a discard pile whose top card is `top`?
 *
 * Three doors, and the pile decides which are open.
 *
 *  - A black three or a wild on top shuts all of them. A pile is not takeable through either.
 *  - FROZEN: the only way in is two natural cards of the top rank, from the hand.
 *  - NOT FROZEN: those two naturals, or a meld of that rank already on the table to add it to.
 */
export function canTakePile(input: {
  top: Card | null;
  frozen: boolean;
  hand: readonly Card[];
  melds: readonly Meld[];
}): { ok: true } | { ok: false; reason: string } {
  const { top, frozen, hand, melds } = input;
  if (!top) return { ok: false, reason: 'there is no discard pile to take' };
  if (isBlackThree(top)) return { ok: false, reason: 'a black three on top stops the pile' };
  if (isWild(top)) return { ok: false, reason: 'a wild card on top stops the pile' };

  const rank = rankOf(top);
  if (!isMeldableRank(rank)) return { ok: false, reason: `you cannot meld ${rank}s, so you cannot take the pile` };

  const naturals = naturalsOfRank(hand, rank);
  if (naturals.length >= 2) return { ok: true };
  if (frozen) return { ok: false, reason: `the pile is frozen — you need two natural ${rank}s in your hand to take it` };
  if (findMeld(melds, rank)) return { ok: true };
  return { ok: false, reason: `you need two natural ${rank}s, or a meld of ${rank}s already down, to take the pile` };
}

/** Bonus for a side's canastas: 500 a clean one, 300 a mixed one. */
export function canastaBonus(melds: readonly Meld[]): { total: number; natural: number; mixed: number } {
  let natural = 0;
  let mixed = 0;
  for (const m of melds) {
    if (!isCanasta(m)) continue;
    if (isNaturalCanasta(m)) natural++;
    else mixed++;
  }
  return { total: natural * 500 + mixed * 300, natural, mixed };
}

/** What every card on a side's table is worth by face value, before any bonus. */
export function meldedCardValue(melds: readonly Meld[]): number {
  let n = 0;
  for (const m of melds) for (const c of m.cards) n += cardValue(c);
  return n;
}

export type { TeamId };
