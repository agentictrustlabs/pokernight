import type { Card, Rank, Suit } from './types.js';

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];

/** 2 → 2 … T → 10, J → 11, Q → 12, K → 13, A → 14 */
export function rankValue(rank: Rank): number {
  const i = RANKS.indexOf(rank);
  if (i < 0) throw new Error(`bad rank ${rank}`);
  return i + 2;
}

export function parseCard(s: string): { rank: Rank; suit: Suit } {
  if (s.length !== 2) throw new Error(`bad card ${s}`);
  const rank = s[0] as Rank;
  const suit = s[1] as Suit;
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) throw new Error(`bad card ${s}`);
  return { rank, suit };
}

export function cardToString(rank: Rank, suit: Suit): Card {
  return `${rank}${suit}`;
}

/** The 52-card deck in a fixed canonical order (ranks ascending, suits s h d c). */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(cardToString(r, s));
  return deck;
}
