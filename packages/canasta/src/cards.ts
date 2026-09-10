/**
 * The canasta deck, and what a card is worth.
 *
 * TWO PACKS AND FOUR JOKERS — 108 cards — so the same card appears twice and the deck is a bag, not
 * a set. Nothing here identifies an individual card: two `7H`s are interchangeable, removing one
 * from a hand removes the first match, and that is enough for every rule in the game. Giving each
 * physical card an identity would buy nothing and would make a hand impossible to compare.
 */

import type { Card, Rank, Suit } from './types.js';

export const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export const SUITS: readonly Suit[] = ['C', 'D', 'H', 'S'];

/** The joker. One rank, one non-suit, four copies in a deck. */
export const JOKER: Card = 'W*';

export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/** Jokers and twos. They can stand in for any rank, within the limits `meld.ts` enforces. */
export function isWild(card: Card): boolean {
  const r = rankOf(card);
  return r === 'W' || r === '2';
}

export function isRedThree(card: Card): boolean {
  return rankOf(card) === '3' && (suitOf(card) === 'D' || suitOf(card) === 'H');
}

export function isBlackThree(card: Card): boolean {
  return rankOf(card) === '3' && (suitOf(card) === 'C' || suitOf(card) === 'S');
}

/**
 * Can this rank be melded in the ordinary way?
 *
 * Everything from four up, plus the aces. Threes cannot: a red three is a bonus card that never
 * enters a meld, and a black three may only be melded as part of going out. Wilds are not a rank you
 * meld — they join a meld of some other rank.
 */
export function isMeldableRank(rank: Rank): boolean {
  return rank !== '3' && rank !== 'W' && rank !== '2';
}

/**
 * What a card is worth when it is counted, melded or left in a hand.
 *
 * A red three is zero HERE and scored separately: it is worth 100 to the side that holds it, or
 * minus 100 if that side never melded, and neither of those is a property of the card.
 */
export function cardValue(card: Card): number {
  const r = rankOf(card);
  if (r === 'W') return 50;
  if (r === '2' || r === 'A') return 20;
  if (r === '3') return isRedThree(card) ? 0 : 5;
  if (r === '4' || r === '5' || r === '6' || r === '7') return 5;
  return 10;
}

export function handValue(cards: readonly Card[]): number {
  return cards.reduce((n, c) => n + cardValue(c), 0);
}

/** Two full packs plus four jokers, in a fixed order. The shuffle is what makes it a deal. */
export function fullDeck(): Card[] {
  const out: Card[] = [];
  for (let pack = 0; pack < 2; pack++) {
    for (const suit of SUITS) for (const rank of RANKS) out.push(`${rank}${suit}` as Card);
    out.push(JOKER, JOKER);
  }
  return out;
}

/** Remove ONE copy of each card in `take` from `from`, or `null` if any of them is not there. */
export function removeCards(from: readonly Card[], take: readonly Card[]): Card[] | null {
  const rest = from.slice();
  for (const card of take) {
    const at = rest.indexOf(card);
    if (at === -1) return null;
    rest.splice(at, 1);
  }
  return rest;
}

/** How many of `cards` are the given rank and not wild. Used to judge taking the discard pile. */
export function naturalsOfRank(cards: readonly Card[], rank: Rank): Card[] {
  return cards.filter((c) => !isWild(c) && rankOf(c) === rank);
}
