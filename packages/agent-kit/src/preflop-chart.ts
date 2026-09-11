/**
 * THE PREFLOP CHART — a solver's decisions, looked up rather than reasoned.
 *
 * Built from PokerBench's 60k solver-labelled spots (`bench/build-preflop-chart.mts`), keyed on the
 * four things that decide a preflop spot: the seat's position at a 6-max table, how many raises have
 * gone in, whether somebody is all in, and the hand class ("AKs", "77", "72o"). The rules coach scored
 * 60% against the same benchmark; this scores 85% held out, and the two failure modes it fixes are the
 * ones a beginner is worst at — it CALLS where a call is right, and it raises where the rules folded.
 *
 * A PRIOR, NOT A PLAYER. `decide` asks here first and falls back to the rules when the chart has no
 * entry (about one spot in twenty), and a person's own agent starts from whatever comes back. Nothing
 * here reads a card the seat cannot see: the key is position, the betting so far, and its own two cards.
 *
 * SIZES ARE THE SOLVER'S, in big blinds, scaled to this table's blind and clamped to what is legal. A
 * chart raise where only a shove is legal shoves; a chart call where nothing is owed checks.
 */

import type { Action, LegalActions, TableView } from '@pokernight/engine';
import chart from './preflop-chart.json' with { type: 'json' };
import { classifyPreflop } from './preflop.js';
import { myHoleCards, raisesOnStreet, seatsFromButton } from './view.js';

interface Entry { a: 'raise' | 'call' | 'check' | 'fold'; n: number; p: number; to?: number }
const FINE = (chart as { fine: Record<string, Entry> }).fine;
/** Spots a chart entry must have behind it before it outranks the rules. */
const MIN_FINE = 3;
const MIN_COARSE = 5;
const COARSE = (chart as { coarse: Record<string, Entry> }).coarse;

/** The 6-max name of a seat, from its distance from the button. A shorter table keeps the names that
 *  exist: four-handed is BTN, SB, BB and CO — the first to act is CO, not UTG, because its range is. */
export function sixMaxPosition(view: TableView, seat: number): string | null {
  const order = seatsFromButton(view);
  const idx = order.indexOf(seat);
  if (idx < 0) return null;
  const n = order.length;
  if (n < 2) return null;
  if (n === 2) return idx === n - 1 ? 'BTN' : 'BB';
  if (idx === 0) return 'SB';
  if (idx === 1) return 'BB';
  const fromButton = n - 1 - idx; // 0 = BTN, 1 = CO, 2 = HJ, 3 = UTG
  return (['BTN', 'CO', 'HJ', 'UTG'] as const)[Math.min(fromButton, 3)]!;
}

export interface ChartHit {
  action: Action;
  /** Which table answered, how many solver spots stood behind it, and what share agreed. */
  from: 'fine' | 'coarse';
  spots: number;
  agree: number;
  key: string;
}

/**
 * The chart's answer for the viewer's seat, or null when it has none. Legal per `legal` — the chart
 * proposes, the table's own legality decides what that becomes.
 */
export function chartDecision(view: TableView, legal: LegalActions): ChartHit | null {
  const seat = view.viewerSeat;
  const hand = view.hand;
  if (seat === null || !hand || hand.street !== 'preflop') return null;
  const hole = myHoleCards(view);
  if (hole.length !== 2) return null;
  const pos = sixMaxPosition(view, seat);
  if (!pos) return null;
  // Raises so far, from the record — and at least one when the bet on the table is above the blind
  // and the record says nothing, so a view without its history still reads as a raised pot.
  const bbSize = view.config.bigBlind || 2;
  const raises = Math.max(raisesOnStreet(view, 'preflop'), hand.currentBet > bbSize ? 1 : 0);
  const facingAllin = hand.actions.some((a) => a.action.type === 'all-in');
  const cls = classifyPreflop(hole).label;
  const fineKey = `${pos}|${raises}|${facingAllin ? 1 : 0}|${cls}`;
  const coarseKey = `${pos}|${raises}|${cls}`;
  // ENOUGH SPOTS TO STAND ON. A solver labelled 60k spots and some keys got one: "BB, unopened, AKs:
  // fold (1 spot)" is a single odd line, not a policy. A fine entry needs a few spots behind it and a
  // coarse one a few more; below that the rules answer, as they do for a key the chart never saw.
  const fine = FINE[fineKey];
  const coarse = COARSE[coarseKey];
  const hit = fine && fine.n >= MIN_FINE ? { e: fine, from: 'fine' as const, key: fineKey } : coarse && coarse.n >= MIN_COARSE ? { e: coarse, from: 'coarse' as const, key: coarseKey } : null;
  if (!hit) return null;
  const bb = view.config.bigBlind || 2;
  const me = view.seats.find((s) => s.seat === seat);
  const stack = me?.stack ?? 0;
  const streetBet = me?.inHand?.streetBet ?? 0;
  const toCall = legal.call ?? 0;
  let action: Action;
  switch (hit.e.a) {
    case 'fold':
      action = legal.fold ? { type: 'fold' } : legal.check ? { type: 'check' } : { type: 'fold' };
      break;
    case 'check':
      action = legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' };
      break;
    case 'call':
      // "Call" from a solver facing a shove is a call of the shove; if the table only lets us shove, shove.
      action = legal.call !== null ? { type: 'call' } : legal.check ? { type: 'check' } : { type: 'all-in' };
      break;
    case 'raise': {
      const wantTo = hit.e.to != null ? Math.round(hit.e.to * bb) : 0;
      const all = streetBet + stack;
      if (hit.e.to != null && hit.e.to >= 100) { action = { type: 'all-in' }; break; }
      if (legal.raise) {
        const to = Math.max(legal.raise.min, Math.min(legal.raise.max, wantTo || legal.raise.min));
        action = to >= all ? { type: 'all-in' } : { type: 'raise', amount: to };
      } else if (legal.bet) {
        const to = Math.max(legal.bet.min, Math.min(legal.bet.max, wantTo || legal.bet.min));
        action = to >= all ? { type: 'all-in' } : { type: 'bet', amount: to };
      } else if (legal.allIn > 0 && (legal.call !== null || toCall > 0)) action = { type: 'all-in' };
      else action = legal.call !== null ? { type: 'call' } : legal.check ? { type: 'check' } : { type: 'fold' };
      break;
    }
  }
  return { action, from: hit.from, spots: hit.e.n, agree: hit.e.p, key: hit.key };
}
