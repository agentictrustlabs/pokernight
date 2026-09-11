/**
 * The rules strategy: a thin wrapper over agent-kit's `decide`.
 *
 * `decide` IS the tight-aggressive baseline and is not forked here. The `loose-passive` variant is an
 * OPTIONS OBJECT over the same function — two knobs applied around it, never a second copy of the logic:
 *
 *   1. `rng` bias. Every optional aggressive line inside `decide` (semi-bluff, c-bet, thin value) is
 *      gated on `rng() < p`; feeding it high samples turns those lines off without touching the code.
 *   2. threshold bias, applied to the decision `decide` returned:
 *        - calls more: a fold becomes a call when the price is small against the pot or the stack;
 *        - raises less: a bet/raise/shove is mostly downgraded to the passive action underneath it.
 *
 * Everything is snapped back through `legalize`, so a biased decision is still a legal one.
 */

import { decide, legalize, potOdds, potTotal, toCall, type DecideOptions } from '@pokernight/agent-kit';
import type { Action } from '@pokernight/engine';
import type { PokerActInput, PokerActOutput } from '@pokernight/protocol';
import type { Strategy, StrategyContext } from './types.js';

export type RulesStyle = 'tight-aggressive' | 'loose-passive' | 'tight-passive' | 'solid' | 'loose-aggressive';

export interface StyleBias {
  /** Maps a uniform sample before `decide` sees it. Identity keeps the baseline frequencies. */
  rng: (u: number) => number;
  /** Call instead of folding when the call is at most this fraction of the pot after calling. */
  callOddsCeiling: number;
  /** …or at most this fraction of the remaining stack. */
  callStackCeiling: number;
  /** Probability an intended bet/raise/shove survives instead of being downgraded. */
  aggression: number;
}

export const STYLES: Record<RulesStyle, StyleBias> = {
  // The baseline, unmodified: `decide` as agent-kit ships it.
  'tight-aggressive': { rng: (u) => u, callOddsCeiling: 0, callStackCeiling: 0, aggression: 1 },
  // Calls three times as wide, and only one raise in five survives.
  'loose-passive': { rng: (u) => 0.65 + u * 0.35, callOddsCeiling: 0.42, callStackCeiling: 0.2, aggression: 0.2 },
  // THE ROCK. The baseline's narrow range, and then most of its raises flattened to calls: it waits
  // for a hand and then does not tell you it has one. Exists so a practice table can be four-handed
  // without a language model in a chair — three rules-based players, three different mistakes to
  // learn to punish, and nothing spent per turn.
  'tight-passive': { rng: (u) => u, callOddsCeiling: 0, callStackCeiling: 0, aggression: 0.3 },
  // THE SOLVER'S LINE, UNBIASED. The baseline as `decide` ships it — the preflop chart, the postflop
  // rules — with every mixed line taken (rng identity keeps the base frequencies). This is the house's
  // best player and costs nothing per turn; it is what a person's own agent starts from.
  'solid': { rng: (u) => u, callOddsCeiling: 0.1, callStackCeiling: 0.05, aggression: 1 },
  // PRESSURE. Every intended bet or raise survives, and a fold facing a cheap bet becomes a call more
  // often than the baseline's — the loose-aggressive shape, made from the same rules by bias rather
  // than by a model. It was a language model once; it is not now, because no house player should be
  // spending a person's tokens.
  'loose-aggressive': { rng: (u) => u * 0.5, callOddsCeiling: 0.35, callStackCeiling: 0.15, aggression: 1 },
};

export interface RulesOptions extends DecideOptions {
  style?: RulesStyle;
}

/** The passive action sitting under an intended aggressive one. */
function passiveUnder(input: PokerActInput): Action | null {
  const { legal } = input;
  if (legal.call !== null && legal.call > 0) return { type: 'call' };
  if (legal.check) return { type: 'check' };
  return null;
}

function biasDecision(out: PokerActOutput, input: PokerActInput, bias: StyleBias, rng: () => number): PokerActOutput {
  const { view, legal } = input;
  const call = toCall(legal);

  if (out.action.type === 'fold' && call > 0) {
    const cheapVsPot = potTotal(view) > 0 && potOdds(legal, view) <= bias.callOddsCeiling;
    const cheapVsStack = call <= Math.max(view.config.bigBlind, (view.seats.find((s) => s.seat === view.viewerSeat)?.stack ?? 0) * bias.callStackCeiling);
    if (cheapVsPot || cheapVsStack) {
      return { action: legalize({ type: 'call' }, legal, view), note: `${out.note ?? ''} | loose: call anyway`.trim().slice(0, 280) };
    }
  }

  const aggressive = out.action.type === 'bet' || out.action.type === 'raise' || out.action.type === 'all-in';
  if (aggressive && rng() >= bias.aggression) {
    const passive = passiveUnder(input);
    if (passive) {
      return { action: legalize(passive, legal, view), note: `${out.note ?? ''} | passive: flat instead`.trim().slice(0, 280) };
    }
  }

  return out;
}

/** Run agent-kit's `decide` with the given style. Always returns an action legal per `input.legal`. */
export function decideWithStyle(input: PokerActInput, opts: RulesOptions = {}): PokerActOutput {
  const style: RulesStyle = opts.style ?? 'tight-aggressive';
  const bias = STYLES[style];
  const base = opts.rng ?? Math.random;
  const out = decide(input, { ...opts, rng: () => bias.rng(base()) });
  if (style === 'tight-aggressive') return out;
  return biasDecision(out, input, bias, base);
}

export const rulesStrategy: Strategy = async (input: PokerActInput, ctx: StrategyContext) => {
  return decideWithStyle(input, { style: ctx.persona.style ?? 'tight-aggressive', ...(ctx.rng ? { rng: ctx.rng } : {}) });
};
