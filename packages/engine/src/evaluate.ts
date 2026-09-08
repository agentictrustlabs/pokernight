import type { Card, HandCategory, HandRank } from './types.js';

/**
 * Evaluate the best 5-card poker hand from 5, 6, or 7 cards.
 *
 * `value` must be a total order over all hands: any straight flush beats any
 * quads, etc., and within a category the usual kicker rules apply. Equal value
 * means an exact tie (split pot). Wheel (A-2-3-4-5) is the lowest straight.
 *
 * Encoding:
 *   value = category * 15^5 + k0*15^4 + k1*15^3 + k2*15^2 + k3*15 + k4
 * where category is 0..8 in the order of HandCategory and k0..k4 are the
 * significant rank values (14 = ace) in tie-break order, zero-padded.
 *
 * Implementation: brute force over the C(n,5) five-card subsets (21 for seven
 * cards) with an allocation-free five-card ranker working on module-level
 * scratch buffers. The only allocations are for the returned HandRank.
 */

const CATEGORIES: readonly HandCategory[] = [
  'high-card',
  'pair',
  'two-pair',
  'three-of-a-kind',
  'straight',
  'flush',
  'full-house',
  'four-of-a-kind',
  'straight-flush',
];

const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';

const P1 = 15;
const P2 = 225;
const P3 = 3375;
const P4 = 50625;
const P5 = 759375;

const NAMES = ['', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
const PLURALS = ['', '', 'twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];

/* Scratch buffers (single-threaded; never escape this module). */
const R = new Uint8Array(7); // rank per input card (2..14)
const S = new Uint8Array(7); // suit per input card (0..3)
const SORTED = new Uint8Array(5);
const G_LEN = new Uint8Array(5);
const G_RANK = new Uint8Array(5);

function parseInto(cards: readonly Card[]): void {
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i] as string;
    const r = RANK_CHARS.indexOf(c[0] as string);
    const s = SUIT_CHARS.indexOf(c[1] as string);
    if (c.length !== 2 || r < 0 || s < 0) throw new Error(`bad card ${c}`);
    R[i] = r + 2;
    S[i] = s;
  }
}

/** Rank the five cards at indices a..e of R/S. Returns the encoded value. */
function rank5(a: number, b: number, c: number, d: number, e: number): number {
  // Gather ranks and insertion-sort descending.
  SORTED[0] = R[a] as number;
  SORTED[1] = R[b] as number;
  SORTED[2] = R[c] as number;
  SORTED[3] = R[d] as number;
  SORTED[4] = R[e] as number;
  for (let i = 1; i < 5; i++) {
    const v = SORTED[i] as number;
    let j = i - 1;
    while (j >= 0 && (SORTED[j] as number) < v) {
      SORTED[j + 1] = SORTED[j] as number;
      j--;
    }
    SORTED[j + 1] = v;
  }
  const flush = S[a] === S[b] && S[a] === S[c] && S[a] === S[d] && S[a] === S[e];

  // Group equal ranks (contiguous because sorted).
  let ng = 0;
  for (let i = 0; i < 5; i++) {
    if (i > 0 && SORTED[i] === SORTED[i - 1]) {
      G_LEN[ng - 1] = (G_LEN[ng - 1] as number) + 1;
    } else {
      G_LEN[ng] = 1;
      G_RANK[ng] = SORTED[i] as number;
      ng++;
    }
  }

  const s0 = SORTED[0] as number;
  const s1 = SORTED[1] as number;
  const s2 = SORTED[2] as number;
  const s3 = SORTED[3] as number;
  const s4 = SORTED[4] as number;

  if (ng === 5) {
    let straightHigh = 0;
    if (s0 - s4 === 4) straightHigh = s0;
    else if (s0 === 14 && s1 === 5 && s4 === 2) straightHigh = 5; // wheel
    if (straightHigh) return (flush ? 8 : 4) * P5 + straightHigh * P4;
    const kick = s0 * P4 + s1 * P3 + s2 * P2 + s3 * P1 + s4;
    return (flush ? 5 : 0) * P5 + kick;
  }

  // Sort groups by (length desc, rank desc); at most 4 groups.
  for (let i = 1; i < ng; i++) {
    const l = G_LEN[i] as number;
    const r = G_RANK[i] as number;
    let j = i - 1;
    while (j >= 0 && ((G_LEN[j] as number) < l || ((G_LEN[j] as number) === l && (G_RANK[j] as number) < r))) {
      G_LEN[j + 1] = G_LEN[j] as number;
      G_RANK[j + 1] = G_RANK[j] as number;
      j--;
    }
    G_LEN[j + 1] = l;
    G_RANK[j + 1] = r;
  }

  let category: number;
  const l0 = G_LEN[0] as number;
  const l1 = G_LEN[1] as number;
  if (l0 === 4) category = 7;
  else if (l0 === 3 && l1 === 2) category = 6;
  else if (l0 === 3) category = 3;
  else if (l0 === 2 && l1 === 2) category = 2;
  else category = 1;

  let value = category * P5;
  let mult = P4;
  for (let i = 0; i < ng; i++) {
    value += (G_RANK[i] as number) * mult;
    mult /= 15;
  }
  return value;
}

let bestIdx0 = 0, bestIdx1 = 0, bestIdx2 = 0, bestIdx3 = 0, bestIdx4 = 0;

/** Evaluate and return only the numeric value (used by the table for speed). */
export function handValue(cards: readonly Card[]): number {
  const n = cards.length;
  if (n < 5 || n > 7) throw new Error(`evaluateHand needs 5..7 cards, got ${n}`);
  parseInto(cards);
  if (n === 5) {
    bestIdx0 = 0; bestIdx1 = 1; bestIdx2 = 2; bestIdx3 = 3; bestIdx4 = 4;
    return rank5(0, 1, 2, 3, 4);
  }
  let best = -1;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const v = rank5(a, b, c, d, e);
            if (v > best) {
              best = v;
              bestIdx0 = a; bestIdx1 = b; bestIdx2 = c; bestIdx3 = d; bestIdx4 = e;
            }
          }
  return best;
}

function label(category: HandCategory, k0: number, k1: number): string {
  switch (category) {
    case 'high-card': return `High card, ${NAMES[k0]}`;
    case 'pair': return `Pair of ${PLURALS[k0]}`;
    case 'two-pair': return `Two pair, ${PLURALS[k0]} and ${PLURALS[k1]}`;
    case 'three-of-a-kind': return `Three of a kind, ${PLURALS[k0]}`;
    case 'straight': return `Straight, ${NAMES[k0]} high`;
    case 'flush': return `Flush, ${NAMES[k0]} high`;
    case 'full-house': return `Full house, ${PLURALS[k0]} over ${PLURALS[k1]}`;
    case 'four-of-a-kind': return `Four of a kind, ${PLURALS[k0]}`;
    case 'straight-flush': return k0 === 14 ? 'Royal flush' : `Straight flush, ${NAMES[k0]} high`;
  }
}

export function evaluateHand(cards: readonly Card[]): HandRank {
  const value = handValue(cards);
  const catIdx = Math.floor(value / P5);
  const category = CATEGORIES[catIdx] as HandCategory;
  const k0 = Math.floor(value / P4) % 15;
  const k1 = Math.floor(value / P3) % 15;

  // Order the five cards best-first: by multiplicity within the hand, then rank;
  // for a wheel the ace sorts last.
  const idx = [bestIdx0, bestIdx1, bestIdx2, bestIdx3, bestIdx4];
  const wheel = (category === 'straight' || category === 'straight-flush') && k0 === 5;
  const key = (i: number): number => {
    const r = R[i] as number;
    let count = 0;
    for (const j of idx) if (R[j] === r) count++;
    const rr = wheel && r === 14 ? 1 : r;
    return count * 100 + rr;
  };
  idx.sort((x, y) => key(y) - key(x));
  const out: Card[] = idx.map((i) => cards[i] as Card);

  return { category, value, cards: out, label: label(category, k0, k1) };
}

/** Negative if a < b, positive if a > b, 0 on tie. */
export function compareHands(a: HandRank, b: HandRank): number {
  return a.value - b.value;
}
