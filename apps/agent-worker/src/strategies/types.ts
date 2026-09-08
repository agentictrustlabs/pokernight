import type { PokerActInput, PokerActOutput } from '@pokernight/protocol';
import type { Env } from '../env.js';
import type { Persona } from '../personas.js';

export interface StrategyContext {
  persona: Persona;
  env: Env;
  /** Aborted just before the table's `deadlineMs` expires (1 s of headroom). */
  signal: AbortSignal;
  /** Injected in tests so a decision is reproducible. Defaults to Math.random. */
  rng?: () => number;
}

/**
 * A strategy MAY return an illegal action — the executor snaps everything through agent-kit's
 * `legalize` before replying — but it must not throw for anything the executor can recover from.
 */
export type Strategy = (input: PokerActInput, ctx: StrategyContext) => Promise<PokerActOutput>;
