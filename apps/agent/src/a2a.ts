/**
 * `poker.act` A2A skill (phase 2 skeleton).
 *
 * The table DO will call this skill over JSON-RPC (`message/send`) with a
 * `PokerActInput` and expects a `PokerActOutput` artifact back before
 * `deadlineMs`. For now it wraps the rules-based `decide`; the LLM-backed
 * planner and the idagents adapter (docs/DESIGN.md section 6) plug in here later.
 *
 * Registration with `@agenticprimitives/a2a` (not yet a dependency) will look like:
 *
 *   import { buildSkillRegistry } from '@agenticprimitives/a2a';
 *   import { pokerActSkill } from './a2a.js';
 *
 *   const registry = buildSkillRegistry([
 *     {
 *       name: pokerActSkill.name,                 // 'poker.act'
 *       description: pokerActSkill.description,
 *       inputSchema: PokerActInputSchema,         // to be added to @pokernight/protocol
 *       outputSchema: PokerActOutputSchema,
 *       handler: (input, ctx) => pokerActSkill.handle(input, { signal: ctx.signal }),
 *     },
 *   ]);
 *   // The agent card at /.well-known/agent-card.json lists registry.skills; the
 *   // JSON-RPC endpoint at /api/a2a dispatches `message/send` to registry.dispatch.
 *   // The house authorizes with an A2A grant scoped by skillSelector('poker.act').
 */

import { decide, type DecideOptions } from '@pokernight/agent-kit';
import { POKER_ACT_SKILL, PokerActOutputSchema, type PokerActInput, type PokerActOutput } from '@pokernight/protocol';

export interface SkillContext {
  /** Aborted by the host when the table's deadline passes. */
  signal?: AbortSignal;
}

export interface PokerActSkill {
  name: typeof POKER_ACT_SKILL;
  description: string;
  handle(input: PokerActInput, ctx?: SkillContext): Promise<PokerActOutput>;
}

/** Build the skill with optional strategy overrides (evaluator, rng) for tests. */
export function createPokerActSkill(opts: DecideOptions = {}): PokerActSkill {
  return {
    name: POKER_ACT_SKILL,
    description: 'Choose a legal no-limit hold’em action for the given seat, view, and legal actions.',
    async handle(input, ctx) {
      if (ctx?.signal?.aborted) throw new Error('poker.act: deadline already passed');
      const out = decide(input, opts);
      // Validate on the way out so a strategy bug never produces a malformed artifact.
      return PokerActOutputSchema.parse(out);
    },
  };
}

export const pokerActSkill: PokerActSkill = createPokerActSkill();
