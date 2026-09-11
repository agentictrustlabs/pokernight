/**
 * THE POSTFLOP CHART — a solver's decisions, keyed on what the seat can compute about its spot.
 *
 * The preflop chart keys on four facts. Postflop there is no finite list of spots, so the key is a
 * FEATURE VECTOR every seat can derive from its own view and nothing else: the street, whether it acts
 * last, what it is facing and how big, whether it had the initiative on the previous street, what its
 * two cards have made and are drawing to, what the board looks like, and how deep the money behind is
 * against the pot. Each spot in PokerBench's 500k solver-labelled postflop set is reduced to that vector
 * (`bench/build-postflop-chart.mts`), and the majority action and median size are kept per vector.
 *
 * ONE FUNCTION FOR BOTH SIDES. `postflopKey` is called by the builder over the benchmark and by `decide`
 * at a live table; if the two ever computed different keys for the same spot the chart would be
 * answering questions nobody asked. That is why it is here and not in the bench.
 *
 * Sizes are relative — a bet as a fraction of the pot, a raise as a multiple of the bet faced — so a
 * spot at 1/2 blinds and a spot at 50/100 read the same line.
 */

import type { Action, Card, LegalActions, Street, TableView } from '@pokernight/engine';
import chart from './postflop-chart.json' with { type: 'json' };
import { postflopStrength, type MadeHand } from './strength.js';
import { aggressorOnStreet, inPosition, myHoleCards, potTotal, raisesOnStreet } from './view.js';

interface Entry { a: 'bet' | 'raise' | 'call' | 'check' | 'fold'; n: number; p: number; f?: number; x?: number }
const CHART = (chart as { keys: Record<string, Entry> }).keys;
/** Spots a chart entry must have behind it before it outranks the rules. */
const MIN_SPOTS = 8;

const RANKS = '23456789TJQKA';
const rankOf = (c: Card): number => RANKS.indexOf(c[0]!);
const suitOf = (c: Card): string => c[1]!;

/** Five buckets of made hand — the ones a decision turns on — and a draw flag. */
function madeBucket(m: MadeHand): string {
  switch (m) {
    case 'nothing': return 'air';
    case 'pair': return 'pair';
    case 'top-pair': case 'overpair': return 'tp';
    case 'two-pair': case 'set': return 'two+';
    default: return 'big';
  }
}

/** Paired, how flushy, how connected — the three things "board texture" means at a decision. */
export function boardTexture(board: readonly Card[]): string {
  const ranks = board.map(rankOf).sort((a, b) => a - b);
  const paired = new Set(ranks).size < ranks.length ? 'p' : 'u';
  const suits = new Map<string, number>();
  for (const c of board) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1);
  const most = Math.max(...suits.values());
  const flush = most >= 3 ? 'fl' : most === 2 ? '2t' : 'rb';
  let connected = 'dry';
  for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2]! - ranks[i]! <= 4) connected = 'wet';
  return `${paired}${flush}${connected}`;
}

const prevStreet = (s: Street): Street | null => (s === 'turn' ? 'flop' : s === 'river' ? 'turn' : s === 'flop' ? 'preflop' : null);

/** The feature key for the viewer's spot, or null when this is not a postflop decision it can key. */
export function postflopKey(view: TableView, legal: LegalActions): string | null {
  const seat = view.viewerSeat;
  const hand = view.hand;
  if (seat === null || !hand || hand.street === 'preflop' || hand.street === 'showdown' || hand.board.length < 3) return null;
  const hole = myHoleCards(view);
  if (hole.length !== 2) return null;
  const me = view.seats.find((s) => s.seat === seat);
  if (!me) return null;
  const pot = potTotal(view);
  const toCall = legal.call ?? 0;
  const raises = raisesOnStreet(view, hand.street);
  const facing = legal.check ? 'chk' : raises >= 2 ? 'rz' : toCall / Math.max(1, pot - toCall) <= 0.4 ? 'sm' : toCall / Math.max(1, pot - toCall) <= 0.8 ? 'md' : 'lg';
  const prev = prevStreet(hand.street);
  const initiative = prev && aggressorOnStreet(view, prev) === seat ? 'agg' : 'pas';
  const s = postflopStrength(hole, hand.board);
  const draw = s.draws.flush ? 'fd' : s.draws.openEnded ? 'sd' : s.draws.gutshot ? 'gs' : 'nd';
  const spr = pot > 0 ? me.stack / pot : 99;
  const sprB = spr <= 1 ? 's1' : spr <= 3 ? 's3' : spr <= 7 ? 's7' : 's9';
  return [hand.street, inPosition(view) ? 'ip' : 'oop', facing, initiative, madeBucket(s.made), draw, boardTexture(hand.board), sprB].join('|');
}

export interface PostflopHit { action: Action; spots: number; agree: number; key: string }

/** The chart's answer for a postflop spot, legalised, or null when it has none it can stand on. */
export function postflopChartDecision(view: TableView, legal: LegalActions): PostflopHit | null {
  const key = postflopKey(view, legal);
  if (!key) return null;
  const e = CHART[key];
  if (!e || e.n < MIN_SPOTS) return null;
  const seat = view.viewerSeat as number;
  const me = view.seats.find((s) => s.seat === seat)!;
  const pot = potTotal(view);
  const all = (me.inHand?.streetBet ?? 0) + me.stack;
  const cur = view.hand!.currentBet;
  let action: Action;
  switch (e.a) {
    case 'check': action = legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' }; break;
    case 'call': action = legal.call !== null ? { type: 'call' } : legal.check ? { type: 'check' } : { type: 'fold' }; break;
    case 'fold': action = legal.fold ? { type: 'fold' } : legal.check ? { type: 'check' } : { type: 'fold' }; break;
    case 'bet': {
      if (legal.bet) { const to = Math.max(legal.bet.min, Math.min(legal.bet.max, Math.round(pot * (e.f ?? 0.5)))); action = to >= all ? { type: 'all-in' } : { type: 'bet', amount: to }; }
      else if (legal.raise) { const to = Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(cur * (e.x ?? 2.5)))); action = to >= all ? { type: 'all-in' } : { type: 'raise', amount: to }; }
      else action = legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' };
      break;
    }
    case 'raise': {
      if (legal.raise) { const to = Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(cur * (e.x ?? 2.5)))); action = to >= all ? { type: 'all-in' } : { type: 'raise', amount: to }; }
      else if (legal.bet) { const to = Math.max(legal.bet.min, Math.min(legal.bet.max, Math.round(pot * (e.f ?? 0.66)))); action = to >= all ? { type: 'all-in' } : { type: 'bet', amount: to }; }
      else action = legal.call !== null ? { type: 'call' } : legal.check ? { type: 'check' } : { type: 'fold' };
      break;
    }
  }
  return { action, spots: e.n, agree: e.p, key };
}
