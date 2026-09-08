/**
 * Postflop hand strength: made-hand class plus draws.
 *
 * The evaluator is injected so this module (and its tests) do not depend on
 * `@pokernight/engine`'s `evaluateHand` body. The made-hand class is derived
 * from the hole cards' relationship to the board, so "pair" means the viewer
 * holds the pair, never a paired board that everyone shares.
 */

import { evaluateHand, parseCard, rankValue, type Card, type HandRank } from '@pokernight/engine';

export type MadeHand =
  | 'nothing'
  | 'pair'
  | 'top-pair'
  | 'overpair'
  | 'two-pair'
  | 'set'
  | 'straight'
  | 'flush'
  | 'full'
  | 'quads'
  | 'straight-flush';

export interface Draws {
  flush: boolean;
  openEnded: boolean;
  gutshot: boolean;
}

export interface PostflopStrength {
  rank: HandRank;
  made: MadeHand;
  draws: Draws;
  /** Approximate number of outs to improve to a strong hand (0 when no draw). */
  outs: number;
}

export type Evaluator = (cards: readonly Card[]) => HandRank;

/** Rank strength order for made hands, useful for comparisons in strategies. */
export const MADE_ORDER: MadeHand[] = [
  'nothing',
  'pair',
  'top-pair',
  'overpair',
  'two-pair',
  'set',
  'straight',
  'flush',
  'full',
  'quads',
  'straight-flush',
];

export function madeAtLeast(made: MadeHand, floor: MadeHand): boolean {
  return MADE_ORDER.indexOf(made) >= MADE_ORDER.indexOf(floor);
}

function usesHole(rank: HandRank, hole: readonly Card[]): boolean {
  // A fake evaluator may not fill `cards`; be permissive then.
  if (!rank.cards || rank.cards.length === 0) return true;
  return rank.cards.some((c) => hole.includes(c));
}

function classifyMade(rank: HandRank, hole: readonly Card[], board: readonly Card[]): MadeHand {
  const h = hole.map((c) => rankValue(parseCard(c).rank));
  const b = board.map((c) => rankValue(parseCard(c).rank));
  const h1 = h[0]!;
  const h2 = h[1]!;
  const pocketPair = h1 === h2;
  const topBoard = Math.max(...b);
  const m1 = b.filter((r) => r === h1).length;
  const m2 = b.filter((r) => r === h2).length;
  const boardPaired = new Set(b).size < b.length;

  switch (rank.category) {
    case 'high-card':
      return 'nothing';
    case 'pair': {
      if (pocketPair) return h1 > topBoard ? 'overpair' : 'pair';
      if (m1 > 0) return h1 === topBoard ? 'top-pair' : 'pair';
      if (m2 > 0) return h2 === topBoard ? 'top-pair' : 'pair';
      return 'nothing';
    }
    case 'two-pair': {
      if (m1 > 0 && m2 > 0 && !pocketPair) return 'two-pair';
      if (pocketPair) {
        // Pocket pair + paired board: still just a pair from our side.
        if (m1 > 0) return 'set'; // (would be trips+; evaluator said two-pair so this is defensive)
        return h1 > topBoard ? 'overpair' : 'pair';
      }
      if (m1 > 0) return boardPaired ? (h1 === topBoard ? 'top-pair' : 'pair') : 'two-pair';
      if (m2 > 0) return boardPaired ? (h2 === topBoard ? 'top-pair' : 'pair') : 'two-pair';
      return 'nothing';
    }
    case 'three-of-a-kind': {
      if (pocketPair && m1 > 0) return 'set';
      if (m1 >= 2 || m2 >= 2) return 'set'; // trips; treated as a set for strategy purposes
      if (m1 > 0 || m2 > 0) return 'pair'; // board trips + our pair? evaluator would say full; defensive
      return 'nothing';
    }
    case 'straight':
      return usesHole(rank, hole) ? 'straight' : 'nothing';
    case 'flush':
      return usesHole(rank, hole) ? 'flush' : 'nothing';
    case 'full-house':
      return usesHole(rank, hole) ? 'full' : 'nothing';
    case 'four-of-a-kind':
      return usesHole(rank, hole) ? 'quads' : 'nothing';
    case 'straight-flush':
      return usesHole(rank, hole) ? 'straight-flush' : 'nothing';
  }
}

/** Distinct rank values with aces counted both high (14) and low (1). */
function straightRanks(values: number[]): Set<number> {
  const set = new Set(values);
  if (set.has(14)) set.add(1);
  return set;
}

/**
 * Count straight outs: distinct ranks that, when added, complete a 5-card
 * straight using at least one hole card the board does not already supply.
 */
function straightOuts(hole: readonly Card[], board: readonly Card[]): number {
  const hv = hole.map((c) => rankValue(parseCard(c).rank));
  const bv = board.map((c) => rankValue(parseCard(c).rank));
  const all = straightRanks([...hv, ...bv]);
  const boardSet = straightRanks(bv);
  const holeSet = straightRanks(hv);
  const holeOnly = [...holeSet].filter((r) => !boardSet.has(r));
  if (holeOnly.length === 0) return 0;
  const outs = new Set<number>();
  for (let out = 1; out <= 14; out++) {
    if (all.has(out)) continue;
    for (let lo = Math.max(1, out - 4); lo <= Math.min(10, out); lo++) {
      let ok = true;
      let involves = false;
      for (let r = lo; r < lo + 5; r++) {
        if (r === out) continue;
        if (!all.has(r)) {
          ok = false;
          break;
        }
        if (holeOnly.includes(r)) involves = true;
      }
      if (ok && involves) {
        outs.add(out === 1 ? 14 : out);
        break;
      }
    }
  }
  return outs.size;
}

function flushDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  const suits = new Map<string, { total: number; hole: number }>();
  for (const c of hole) {
    const s = parseCard(c).suit;
    const e = suits.get(s) ?? { total: 0, hole: 0 };
    e.total++;
    e.hole++;
    suits.set(s, e);
  }
  for (const c of board) {
    const s = parseCard(c).suit;
    const e = suits.get(s) ?? { total: 0, hole: 0 };
    e.total++;
    suits.set(s, e);
  }
  for (const e of suits.values()) if (e.total === 4 && e.hole > 0) return true;
  return false;
}

/**
 * Evaluate hole cards against a board of 3..5 cards.
 * Draws are only reported when there are cards to come (flop, turn).
 */
export function postflopStrength(
  holeCards: readonly Card[],
  board: readonly Card[],
  evaluate: Evaluator = evaluateHand,
): PostflopStrength {
  if (holeCards.length !== 2) throw new Error(`postflopStrength expects 2 hole cards, got ${holeCards.length}`);
  if (board.length < 3 || board.length > 5) throw new Error(`postflopStrength expects a 3..5 card board`);
  const rank = evaluate([...holeCards, ...board]);
  const made = classifyMade(rank, holeCards, board);

  const draws: Draws = { flush: false, openEnded: false, gutshot: false };
  let outs = 0;
  if (board.length < 5 && !madeAtLeast(made, 'straight')) {
    draws.flush = flushDraw(holeCards, board);
    const so = straightOuts(holeCards, board);
    draws.openEnded = so >= 2;
    draws.gutshot = so === 1;
    outs = (draws.flush ? 9 : 0) + so * 4 - (draws.flush && so > 0 ? so : 0); // avoid double-counting overlaps
  }
  return { rank, made, draws, outs };
}
