/**
 * Shared helpers for the property test and the benchmark: a tiny seeded PRNG,
 * a random legal-action policy, and a hand runner that records the action log.
 */
import type { Action, EngineEvent, LegalActions, TableState } from '../src/index.js';
import { applyAction, legalActions, startHand, timeoutAction } from '../src/index.js';

/** mulberry32: deterministic, good enough for tests. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

/** A 32-byte hand seed derived from a counter. */
export function handSeed(i: number): Uint8Array {
  const b = new Uint8Array(32);
  let x = (i * 2654435761) >>> 0;
  for (let k = 0; k < 32; k++) {
    x = (Math.imul(x ^ (x >>> 13), 0x5bd1e995) + k) >>> 0;
    b[k] = x & 0xff;
  }
  return b;
}

/** Pick a random legal action. Every amount returned lies inside the advertised ranges. */
export function randomAction(legal: LegalActions, rnd: () => number): Action {
  const opts: Action[] = [];
  if (legal.check) opts.push({ type: 'check' }, { type: 'check' }, { type: 'check' });
  if (legal.call !== null) opts.push({ type: 'call' }, { type: 'call' }, { type: 'call' });
  if (legal.fold) opts.push({ type: 'fold' });
  if (legal.bet) opts.push({ type: 'bet', amount: randInt(rnd, legal.bet.min, legal.bet.max) });
  if (legal.raise) opts.push({ type: 'raise', amount: randInt(rnd, legal.raise.min, legal.raise.max) });
  if (legal.allIn > 0 && rnd() < 0.15) opts.push({ type: 'all-in' });
  return opts[Math.floor(rnd() * opts.length)] as Action;
}

export interface LoggedAction {
  seat: number;
  action: Action;
  timedOut: boolean;
}

export interface HandRun {
  state: TableState;
  events: EngineEvent[];
  log: LoggedAction[];
}

/**
 * Start a hand and play it to the end with random legal actions. `onStep` is
 * called with each intermediate state (for invariant checks).
 */
export function runHand(
  state: TableState,
  seed: Uint8Array,
  rnd: () => number,
  opts: { timeoutProb?: number; onStep?: (before: TableState, after: TableState, events: EngineEvent[]) => void } = {},
): HandRun {
  const timeoutProb = opts.timeoutProb ?? 0;
  const log: LoggedAction[] = [];
  const events: EngineEvent[] = [];
  let r = startHand(state, seed);
  opts.onStep?.(state, r.state, r.events);
  events.push(...r.events);
  let st = r.state;
  let guard = 0;
  while (st.hand && st.hand.result === undefined) {
    if (++guard > 10_000) throw new Error('hand did not terminate');
    const seat = st.hand.toAct as number;
    const before = st;
    if (rnd() < timeoutProb) {
      r = timeoutAction(st, seat);
      log.push({ seat, action: r.events[0]!.type === 'action' ? r.events[0].record.action : { type: 'fold' }, timedOut: true });
    } else {
      const action = randomAction(legalActions(st, seat), rnd);
      r = applyAction(st, seat, action);
      log.push({ seat, action, timedOut: false });
    }
    opts.onStep?.(before, r.state, r.events);
    events.push(...r.events);
    st = r.state;
  }
  return { state: st, events, log };
}

/** Replay a recorded hand from the pre-hand state. */
export function replayHand(state: TableState, seed: Uint8Array, log: readonly LoggedAction[]): HandRun {
  const events: EngineEvent[] = [];
  let r = startHand(state, seed);
  events.push(...r.events);
  let st = r.state;
  for (const entry of log) {
    r = entry.timedOut ? timeoutAction(st, entry.seat) : applyAction(st, entry.seat, entry.action);
    events.push(...r.events);
    st = r.state;
  }
  return { state: st, events, log: log.slice() };
}
