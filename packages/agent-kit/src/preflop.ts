/**
 * Preflop hand classification and a simple position-based chart.
 *
 * Strength follows the Chen formula (Bill Chen, "The Mathematics of Poker"),
 * clamped to 0..20: AA = 20, KK = 16, AKs = 12, 72o = 0.
 */

import { parseCard, rankValue, type Card, type Rank } from '@pokernight/engine';
import type { Position } from './view.js';

export type HandShape = 'pair' | 'suited' | 'offsuit';

export interface PreflopClass {
  shape: HandShape;
  /** Higher rank first, e.g. "AKs", "77", "72o". */
  label: string;
  high: Rank;
  low: Rank;
  /** Rank gap between the two cards (0 for connectors and pairs). */
  gap: number;
  /** Chen-formula strength, clamped to 0..20. */
  strength: number;
}

const RANK_ORDER: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function chenHighCard(rank: Rank): number {
  switch (rank) {
    case 'A':
      return 10;
    case 'K':
      return 8;
    case 'Q':
      return 7;
    case 'J':
      return 6;
    default:
      return rankValue(rank) / 2;
  }
}

/** Classify two hole cards. Throws on anything but exactly two valid cards. */
export function classifyPreflop(cards: readonly Card[]): PreflopClass {
  if (cards.length !== 2) throw new Error(`classifyPreflop expects 2 cards, got ${cards.length}`);
  const a = parseCard(cards[0]!);
  const b = parseCard(cards[1]!);
  const [high, low] = rankValue(a.rank) >= rankValue(b.rank) ? [a, b] : [b, a];
  const pair = high.rank === low.rank;
  const suited = !pair && high.suit === low.suit;
  const shape: HandShape = pair ? 'pair' : suited ? 'suited' : 'offsuit';
  const gap = pair ? 0 : rankValue(high.rank) - rankValue(low.rank) - 1;

  let score = chenHighCard(high.rank);
  if (pair) score = Math.max(5, score * 2);
  if (suited) score += 2;
  if (!pair) {
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    // Straight bonus for connectors / one-gappers below queen high.
    if (gap <= 1 && rankValue(high.rank) < rankValue('Q')) score += 1;
  }
  const strength = Math.min(20, Math.max(0, Math.ceil(score)));
  const label = pair ? `${high.rank}${low.rank}` : `${high.rank}${low.rank}${suited ? 's' : 'o'}`;
  return { shape, label, high: high.rank, low: low.rank, gap, strength };
}

/* ------------------------------------------------------------------ chart */

export type TableSize = '6max' | 'fullring';
/** What the viewer is facing when it is their turn preflop. */
export type Facing = 'none' | 'limp' | 'raise' | '3bet';
export type PreflopDecision = 'fold' | 'call' | 'raise';

/** Minimum Chen strength to open-raise from each position. */
export const OPEN_THRESHOLDS: Record<TableSize, Record<Position, number>> = {
  fullring: { early: 10, middle: 9, late: 7, blinds: 8 },
  '6max': { early: 9, middle: 8, late: 7, blinds: 8 },
};

/** Minimum Chen strength to call an open raise (in / out of position). */
export const CALL_THRESHOLDS = { inPosition: 8, outOfPosition: 9 } as const;

/** Hands that 3-bet an opener for value. */
export const THREE_BET_HANDS = new Set(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo', 'AQs']);
/** Hands that continue (4-bet / call) against a 3-bet. */
export const FOUR_BET_HANDS = new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']);
export const CALL_3BET_HANDS = new Set(['JJ', 'TT', '99', 'AQs', 'AQo', 'AJs', 'KQs']);

/** Ranks position labels by how many players act after them. */
function isLate(pos: Position): boolean {
  return pos === 'late';
}

export interface PreflopContext {
  position: Position;
  tableSize: TableSize;
  facing: Facing;
  /** Chips to call, in big blinds (0 when checking is free). */
  toCallBB?: number;
  /** Effective stack in big blinds (used for set-mining calls). */
  effectiveBB?: number;
  /** True when the viewer is in the big blind and can check for free. */
  freeCheck?: boolean;
}

/**
 * Tight-aggressive baseline chart.
 *
 * - No action yet (or limpers): open/iso-raise above the position threshold, otherwise fold
 *   (a free big-blind check is returned as 'call' so the caller can check).
 * - Facing a raise: 3-bet premiums, call medium strength (looser in position),
 *   set-mine small pairs when deep and the raise is small, fold the rest.
 * - Facing a 3-bet: 4-bet QQ+/AK, call JJ/TT/AQs etc., fold the rest.
 */
export function preflopDecision(hand: PreflopClass, ctx: PreflopContext): PreflopDecision {
  const s = hand.strength;
  const toCall = ctx.toCallBB ?? 0;
  const deep = ctx.effectiveBB ?? 100;

  switch (ctx.facing) {
    case 'none':
    case 'limp': {
      const threshold = OPEN_THRESHOLDS[ctx.tableSize][ctx.position];
      if (s >= threshold) return 'raise';
      // Cheap completions: pairs and suited connectors from the blinds / late position over limpers.
      if (ctx.facing === 'limp' && toCall <= 1 && (hand.shape === 'pair' || (hand.shape === 'suited' && hand.gap <= 1)))
        return 'call';
      if (ctx.freeCheck) return 'call';
      return 'fold';
    }
    case 'raise': {
      if (THREE_BET_HANDS.has(hand.label)) return 'raise';
      const threshold = isLate(ctx.position) ? CALL_THRESHOLDS.inPosition : CALL_THRESHOLDS.outOfPosition;
      if (s >= threshold) return 'call';
      // Set mining: any pair when the raise is small relative to the effective stack.
      if (hand.shape === 'pair' && toCall > 0 && deep >= toCall * 15) return 'call';
      // Suited connectors in position with a small raise to call.
      if (hand.shape === 'suited' && hand.gap === 0 && isLate(ctx.position) && toCall <= 4 && deep >= 40) return 'call';
      return 'fold';
    }
    case '3bet': {
      if (FOUR_BET_HANDS.has(hand.label)) return 'raise';
      if (CALL_3BET_HANDS.has(hand.label) && deep >= toCall * 4) return 'call';
      return 'fold';
    }
  }
}

/** Convenience for tests and tooling: label → strength, e.g. "AKs" → 12. */
export function strengthOf(label: string): number {
  const high = label[0] as Rank;
  const low = label[1] as Rank;
  if (!RANK_ORDER.includes(high) || !RANK_ORDER.includes(low)) throw new Error(`bad label ${label}`);
  const suited = label[2] === 's';
  const cards: Card[] = high === low ? [`${high}s`, `${low}h`] : [`${high}s`, `${low}${suited ? 's' : 'h'}`];
  return classifyPreflop(cards).strength;
}
