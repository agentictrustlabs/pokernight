/**
 * Rules-based tight-aggressive baseline strategy.
 *
 * `decide` never throws on odd input and always returns an action that is
 * legal per `input.legal`. Randomness (c-bet frequency, semi-bluffs) comes only
 * from the injected `rng`, so decisions are reproducible in tests.
 */

import type { Action, LegalActions, TableView } from '@pokernight/engine';
import type { PokerActInput, PokerActOutput } from '@pokernight/protocol';
import { chartDecision } from './preflop-chart.js';
import { postflopChartDecision } from './postflop-chart.js';
import { classifyPreflop, preflopDecision, type Facing, type TableSize } from './preflop.js';
import { madeAtLeast, postflopStrength, type Evaluator, type PostflopStrength } from './strength.js';
import {
  effectiveStack,
  inPosition,
  myHoleCards,
  myStack,
  playersInHand,
  position,
  potOdds,
  potTotal,
  raisesOnStreet,
  street,
  toCall,
  wasAggressor,
} from './view.js';

export interface DecideOptions {
  evaluate?: Evaluator;
  /** Uniform [0,1) source. Defaults to Math.random. */
  rng?: () => number;
}

/* --------------------------------------------------------------- legalize */

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Check, then a cheap call, then fold, then whatever is left. */
function fallback(legal: LegalActions, view: TableView): Action {
  if (legal.check) return { type: 'check' };
  const call = legal.call;
  const bb = view.config.bigBlind;
  const stack = myStack(view);
  if (call !== null && call > 0 && call <= Math.max(2 * bb, stack * 0.05)) return { type: 'call' };
  if (legal.fold) return { type: 'fold' };
  if (call !== null) return call > 0 ? { type: 'call' } : { type: 'check' };
  if (legal.allIn > 0) return { type: 'all-in' };
  if (valid(legal.bet)) return { type: 'bet', amount: legal.bet!.min };
  if (valid(legal.raise)) return { type: 'raise', amount: legal.raise!.min };
  return { type: 'fold' };
}

/** A usable bet/raise range (hosts should never send an inverted one, but never trust it). */
function valid(range: { min: number; max: number } | null): range is { min: number; max: number } {
  return range !== null && range.max >= range.min;
}

/**
 * Snap a desired action into `legal`. Bet/raise amounts are clamped into the
 * legal range; a raise-to at the maximum becomes an all-in when that is legal.
 */
export function legalize(desired: Action, legal: LegalActions, view: TableView): Action {
  switch (desired.type) {
    case 'fold':
      return legal.fold ? desired : fallback(legal, view);
    case 'check':
      return legal.check ? desired : fallback(legal, view);
    case 'call':
      if (legal.call !== null && legal.call > 0) return desired;
      if (legal.check) return { type: 'check' };
      return fallback(legal, view);
    case 'all-in':
      if (legal.allIn > 0) return desired;
      if (valid(legal.raise)) return { type: 'raise', amount: legal.raise.max };
      if (valid(legal.bet)) return { type: 'bet', amount: legal.bet.max };
      if (legal.call !== null && legal.call > 0) return { type: 'call' };
      return fallback(legal, view);
    case 'bet':
    case 'raise': {
      const bet = valid(legal.bet) ? legal.bet : null;
      const raise = valid(legal.raise) ? legal.raise : null;
      const range = desired.type === 'bet' ? (bet ?? raise) : (raise ?? bet);
      const kind: 'bet' | 'raise' = range !== null && range === bet ? 'bet' : 'raise';
      if (range) {
        const amount = clamp(desired.amount, range.min, range.max);
        if (amount >= range.max && legal.allIn > 0) return { type: 'all-in' };
        return { type: kind, amount };
      }
      if (legal.allIn > 0 && desired.amount >= myStack(view)) return { type: 'all-in' };
      // Cannot raise: calling is the aggressive-most option left.
      if (legal.call !== null && legal.call > 0) return { type: 'call' };
      return fallback(legal, view);
    }
  }
}

/** True when `action` is allowed by `legal`. Exported for tests and hosts. */
export function isLegal(action: Action, legal: LegalActions): boolean {
  switch (action.type) {
    case 'fold':
      return legal.fold;
    case 'check':
      return legal.check;
    case 'call':
      return legal.call !== null && legal.call > 0;
    case 'all-in':
      return legal.allIn > 0;
    case 'bet':
      return !!legal.bet && Number.isInteger(action.amount) && action.amount >= legal.bet.min && action.amount <= legal.bet.max;
    case 'raise':
      return (
        !!legal.raise && Number.isInteger(action.amount) && action.amount >= legal.raise.min && action.amount <= legal.raise.max
      );
  }
}

/* ---------------------------------------------------------------- preflop */

function preflopFacing(view: TableView): { facing: Facing; limpers: number } {
  const hand = view.hand!;
  const bb = view.config.bigBlind;
  const raises = raisesOnStreet(view, 'preflop');
  if (raises >= 2) return { facing: '3bet', limpers: 0 };
  if (raises === 1 || hand.currentBet > bb) return { facing: 'raise', limpers: 0 };
  // Nobody raised: count voluntary limpers (calls of the big blind).
  const limpers = hand.actions.filter((a) => a.street === 'preflop' && a.action.type === 'call').length;
  return { facing: limpers > 0 ? 'limp' : 'none', limpers };
}

function decidePreflop(input: PokerActInput, rng: () => number): { action: Action; note: string } {
  const { view, legal } = input;
  const hand = view.hand!;
  const bb = view.config.bigBlind;
  const hole = myHoleCards(view);
  const cls = classifyPreflop(hole);
  const pos = position(view) ?? 'middle';
  const tableSize: TableSize = view.config.seats >= 7 ? 'fullring' : '6max';
  const { facing, limpers } = preflopFacing(view);
  const call = toCall(legal);
  const eff = effectiveStack(view);
  const stack = myStack(view);
  const pot = potTotal(view);

  const decision = preflopDecision(cls, {
    position: pos,
    tableSize,
    facing,
    toCallBB: call / bb,
    effectiveBB: eff / bb,
    freeCheck: legal.check,
  });
  const tag = `${cls.label} (${cls.strength}) ${pos} vs ${facing}`;

  if (decision === 'raise') {
    // Short stacks: shove rather than raise-fold.
    if (stack <= 12 * bb || (facing !== 'none' && facing !== 'limp' && stack <= 3 * hand.currentBet + pot)) {
      return { action: { type: 'all-in' }, note: `${tag}: short, shove` };
    }
    let target: number;
    if (facing === 'none' || facing === 'limp') {
      target = (2.5 + limpers) * bb + (rng() < 0.5 ? bb * 0.5 : 0);
    } else if (facing === 'raise') {
      const callers = hand.actions.filter((a) => a.street === 'preflop' && a.action.type === 'call').length;
      target = hand.currentBet * (inPosition(view) ? 3 : 3.5) + callers * hand.currentBet;
    } else {
      target = hand.currentBet * 2.3;
    }
    // Never raise-fold most of the stack; commit instead.
    if (target >= stack * 0.4) return { action: { type: 'all-in' }, note: `${tag}: raise commits, shove` };
    return { action: { type: 'raise', amount: Math.round(target) }, note: `${tag}: raise` };
  }

  if (decision === 'call') {
    if (call === 0) return { action: { type: 'check' }, note: `${tag}: free check` };
    // Do not call off a big chunk of the stack with a speculative hand.
    if (call > stack * 0.35 && cls.strength < 10) return { action: { type: 'fold' }, note: `${tag}: too expensive` };
    return { action: { type: 'call' }, note: `${tag}: call` };
  }

  if (call === 0) return { action: { type: 'check' }, note: `${tag}: free check` };
  return { action: { type: 'fold' }, note: `${tag}: fold` };
}

/* --------------------------------------------------------------- postflop */

/** Rough equity of a drawing hand against a made hand, by cards to come. */
function drawEquity(s: PostflopStrength, cardsToCome: number): number {
  const outs = Math.max(0, s.outs);
  if (outs === 0) return 0;
  // Rule of 2 and 4, slightly discounted for reverse implied odds.
  return Math.min(0.6, (outs * (cardsToCome === 2 ? 4 : 2)) / 100) * 0.95;
}

function decidePostflop(input: PokerActInput, evaluate: Evaluator | undefined, rng: () => number): { action: Action; note: string } {
  const { view, legal } = input;
  const hand = view.hand!;
  const hole = myHoleCards(view);
  const s = postflopStrength(hole, hand.board, evaluate);
  const st = hand.street;
  const cardsToCome = st === 'flop' ? 2 : st === 'turn' ? 1 : 0;
  const pot = potTotal(view);
  const call = toCall(legal);
  const stack = myStack(view);
  const spr = pot > 0 ? stack / pot : Number.POSITIVE_INFINITY;
  const opponents = playersInHand(view).length - 1;
  const strongDraw = s.draws.flush || s.draws.openEnded;
  const tag = `${s.rank.label ?? s.made} [${s.made}${strongDraw ? '+draw' : s.draws.gutshot ? '+gutshot' : ''}] ${st}`;

  const strong = madeAtLeast(s.made, 'two-pair');
  const good = madeAtLeast(s.made, 'top-pair');
  const weakPair = s.made === 'pair';

  /* ---- no bet to face: check or bet ---- */
  if (call === 0) {
    const betTo = (frac: number) => hand.currentBet + Math.max(view.config.bigBlind, Math.round(pot * frac));
    if (good && spr < 1) return { action: { type: 'all-in' }, note: `${tag}: SPR<1, shove` };
    if (strong) return { action: { type: 'bet', amount: betTo(0.7) }, note: `${tag}: value bet` };
    if (good) return { action: { type: 'bet', amount: betTo(0.65) }, note: `${tag}: value bet top pair+` };
    if (strongDraw && cardsToCome > 0 && rng() < 0.6) {
      return { action: { type: 'bet', amount: betTo(0.6) }, note: `${tag}: semi-bluff` };
    }
    if (st === 'flop' && wasAggressor(view) && opponents <= 2 && rng() < 0.65) {
      return { action: { type: 'bet', amount: betTo(0.65) }, note: `${tag}: c-bet` };
    }
    if (weakPair && st === 'river' && opponents === 1 && inPosition(view) && rng() < 0.3) {
      return { action: { type: 'bet', amount: betTo(0.4) }, note: `${tag}: thin value` };
    }
    return { action: { type: 'check' }, note: `${tag}: check` };
  }

  /* ---- facing a bet ---- */
  const potBefore = Math.max(1, pot - call);
  const betToPot = call / potBefore;
  const odds = potOdds(legal, view);

  if (strong) {
    if (spr < 1 || stack <= call * 2.5) return { action: { type: 'all-in' }, note: `${tag}: strong, shove` };
    const raiseTo = Math.round(hand.currentBet * 3);
    if (raiseTo >= stack * 0.6) return { action: { type: 'all-in' }, note: `${tag}: strong, commit` };
    // Mix in slow-play with monsters when deep to keep opponents guessing.
    if (madeAtLeast(s.made, 'straight') && spr > 4 && cardsToCome > 0 && rng() < 0.25) {
      return { action: { type: 'call' }, note: `${tag}: slow-play` };
    }
    return { action: { type: 'raise', amount: raiseTo }, note: `${tag}: raise for value` };
  }

  if (good) {
    if (spr < 1) return { action: { type: 'all-in' }, note: `${tag}: SPR<1 with top pair+, shove` };
    if (betToPot <= 1.2 || call <= stack * 0.25) return { action: { type: 'call' }, note: `${tag}: call` };
    if (s.made === 'overpair' && betToPot <= 2) return { action: { type: 'call' }, note: `${tag}: call overbet with overpair` };
    return { action: { type: 'fold' }, note: `${tag}: fold to big bet` };
  }

  if (cardsToCome > 0 && (strongDraw || s.draws.gutshot)) {
    const equity = drawEquity(s, cardsToCome);
    // Implied odds: a completed draw usually wins more than what is in the pot now.
    const implied = stack > call * 3 ? 1.25 : 1.0;
    if (equity * implied >= odds) return { action: { type: 'call' }, note: `${tag}: call, odds ${odds.toFixed(2)} vs equity ${equity.toFixed(2)}` };
    if (strongDraw && stack <= call * 2) return { action: { type: 'all-in' }, note: `${tag}: draw, short, shove` };
    return { action: { type: 'fold' }, note: `${tag}: fold, odds ${odds.toFixed(2)} > equity ${equity.toFixed(2)}` };
  }

  if (weakPair) {
    if (betToPot <= 0.4 && odds <= 0.3) return { action: { type: 'call' }, note: `${tag}: call small bet` };
    return { action: { type: 'fold' }, note: `${tag}: fold pair to bet` };
  }

  // Air: fold unless the bet is negligible.
  if (call <= view.config.bigBlind && odds < 0.1) return { action: { type: 'call' }, note: `${tag}: call negligible bet` };
  return { action: { type: 'fold' }, note: `${tag}: fold` };
}

/* ------------------------------------------------------------------ decide */

/**
 * Decide an action for the viewer. Always legal per `input.legal`.
 */
export function decide(input: PokerActInput, opts: DecideOptions = {}): PokerActOutput {
  const rng = opts.rng ?? Math.random;
  const { view, legal } = input;
  const hole = myHoleCards(view);
  const st = street(view);

  let desired: Action;
  let note: string;
  try {
    if (!view.hand || st === null || st === 'showdown' || hole.length !== 2) {
      desired = fallback(legal, view);
      note = 'no hand context, default';
    } else if (st === 'preflop') {
      // THE SOLVER'S CHART FIRST, the rules as the floor. Measured against PokerBench: the rules alone
      // score 60% on the preflop decision, the chart 85%. The chart answers the ordinary spot; the rules
      // answer the one in twenty it never saw.
      const chart = chartDecision(view, legal);
      if (chart) {
        desired = chart.action;
        note = `chart ${chart.from} ${chart.key}: ${chart.spots} spots, ${chart.agree}% agree`;
      } else ({ action: desired, note } = decidePreflop(input, rng));
    } else if (view.hand.board.length >= 3) {
      // THE SOLVER'S CHART FIRST here too, keyed on the spot's features; the rules answer what it
      // never saw. Measured against PokerBench: the rules alone scored 54% postflop.
      const chart = postflopChartDecision(view, legal);
      if (chart) {
        desired = chart.action;
        note = `chart post ${chart.key}: ${chart.spots} spots, ${chart.agree}% agree`;
      } else ({ action: desired, note } = decidePostflop(input, opts.evaluate, rng));
    } else {
      desired = fallback(legal, view);
      note = 'board missing, default';
    }
  } catch (err) {
    desired = fallback(legal, view);
    note = `error (${err instanceof Error ? err.message : String(err)}), default`;
  }

  const action = legalize(desired, legal, view);
  if (action.type !== desired.type || ('amount' in desired && 'amount' in action && desired.amount !== action.amount)) {
    note += ` -> ${describe(action)}`;
  }
  return { action, note: note.slice(0, 280) };
}

function describe(a: Action): string {
  return 'amount' in a ? `${a.type} ${a.amount}` : a.type;
}
