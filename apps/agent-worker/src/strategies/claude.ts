/**
 * The `claude` strategy: an Anthropic Messages call, with the rules baseline underneath it.
 *
 * Shape of the call (per the claude-api skill):
 *   - model from `LLM_MODEL` (default `claude-opus-5`), `max_tokens: 2000`.
 *   - `output_config.effort` from `LLM_EFFORT`, default "low" — a poker turn lives inside the table's
 *     action clock, so depth is traded for latency.
 *   - Adaptive thinking is the DEFAULT on this model family: no `budget_tokens`, and no
 *     `thinking: { type: 'disabled' }`. Setting either would fight the model, not help it.
 *   - STRUCTURED OUTPUTS via `output_config.format = { type: 'json_schema', schema }`, so the reply is
 *     one text block of schema-valid JSON and there is no prose to strip. (Assistant-turn prefills are
 *     a 400 on this family; structured outputs are their replacement.)
 *
 * `amount` is REQUIRED by the schema rather than optional — strict structured output is far more
 * reliable with a closed object, and 0 is the documented "not applicable" value for fold/check/call/
 * all-in. The executor drops it for those types anyway.
 *
 * Every failure path lands on the rules strategy, never on a fold: no key, a rate limit, an API error,
 * a timeout, or JSON that does not validate. A table would rather have a competent baseline action than
 * a folded hand.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Action } from '@pokernight/engine';
import { PokerActOutputSchema, type PokerActInput, type PokerActOutput } from '@pokernight/protocol';
import { llmEffort, llmModel } from '../env.js';
import { renderSituation } from '../table-text.js';
import { rulesStrategy } from './rules.js';
import type { Strategy, StrategyContext } from './types.js';

/** The structured-output schema. Closed object, every field required. */
export const ACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'object',
      description: 'The single action you are taking.',
      properties: {
        type: {
          type: 'string',
          enum: ['fold', 'check', 'call', 'bet', 'raise', 'all-in'],
          description: 'Must be one of the legal actions listed for this spot.',
        },
        amount: {
          // No `minimum` here: structured outputs reject numeric bounds on an integer
          // ("For 'integer' type, property 'minimum' is not supported"). The range is stated in the
          // description and enforced for real by `legalize`, which is the only thing that can be trusted.
          type: 'integer',
          description:
            'For "bet" and "raise": the TOTAL street bet in chips you are betting/raising TO, inside the listed legal range. For every other type: 0.',
        },
      },
      required: ['type', 'amount'],
      additionalProperties: false,
    },
    note: {
      type: 'string',
      description: 'One short sentence (max 200 characters) saying why. Logged with the hand history.',
    },
  },
  required: ['action', 'note'],
  additionalProperties: false,
} as const;

const SYSTEM_RULES = [
  '',
  'You are seated at a real no-limit Texas hold’em table and it is your turn. You will be shown the table',
  'state as text. Choose exactly ONE action from the legal actions listed for this spot and answer with',
  'the JSON object the schema describes — nothing else.',
  '',
  'Rules that are never negotiable:',
  '- Pick only from the legal actions shown. An illegal action is discarded and replaced by check-or-fold.',
  '- "bet" and "raise" amounts are the TOTAL street bet you are moving to, not the increment, and must',
  '  fall inside the printed range. For fold, check, call and all-in, set amount to 0.',
  '- Chips are integers. Never invent chips you do not have.',
  '- Answer fast. This is a live table with a clock.',
].join('\n');

/** Logged once per isolate, not once per hand: a missing key is a deployment fact, not a turn event. */
let warnedNoKey = false;

function firstTextBlock(message: Anthropic.Message): string | null {
  for (const block of message.content) if (block.type === 'text') return block.text;
  return null;
}

/** The structured object -> a protocol `Action`, dropping the placeholder amount where it means nothing. */
function toAction(raw: { type: string; amount?: number }): Action | null {
  const amount = Number.isFinite(raw.amount) ? Math.round(raw.amount as number) : 0;
  switch (raw.type) {
    case 'fold':
    case 'check':
    case 'call':
    case 'all-in':
      return { type: raw.type };
    case 'bet':
    case 'raise':
      // `legalize` clamps this into the legal range; a non-positive amount would fail the wire schema,
      // so it becomes the smallest legal bet/raise there instead of being rejected here.
      return { type: raw.type, amount: Math.max(1, amount) };
    default:
      return null;
  }
}

function parseReply(text: string): PokerActOutput | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const obj = json as { action?: unknown; note?: unknown };
  if (!obj.action || typeof obj.action !== 'object') return null;
  const action = toAction(obj.action as { type: string; amount?: number });
  if (!action) return null;
  const note = typeof obj.note === 'string' ? obj.note.slice(0, 280) : undefined;
  const parsed = PokerActOutputSchema.safeParse({ action, ...(note ? { note } : {}) });
  return parsed.success ? parsed.data : null;
}

export const claudeStrategy: Strategy = async (input: PokerActInput, ctx: StrategyContext): Promise<PokerActOutput> => {
  const apiKey = ctx.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        `[agent-worker] ANTHROPIC_API_KEY is not set; persona "${ctx.persona.agentName}" plays the rules baseline. ` +
          'Set it with `wrangler secret put ANTHROPIC_API_KEY --env <env>` (or in .dev.vars locally).',
      );
    }
    return rulesStrategy(input, ctx);
  }

  const fallback = async (reason: string): Promise<PokerActOutput> => {
    const out = await rulesStrategy(input, ctx);
    return { action: out.action, note: `[${reason}; rules fallback] ${out.note ?? ''}`.trim().slice(0, 280) };
  };

  try {
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    const message = await client.messages.create(
      {
        model: llmModel(ctx.env),
        max_tokens: 2000,
        system: `${ctx.persona.persona ?? ctx.persona.description}\n${SYSTEM_RULES}`,
        // Adaptive thinking is the default here — deliberately no `thinking` block of any kind.
        output_config: {
          effort: llmEffort(ctx.env),
          format: { type: 'json_schema', schema: ACTION_JSON_SCHEMA as unknown as Record<string, unknown> },
        },
        messages: [{ role: 'user', content: renderSituation(input) }],
      },
      { signal: ctx.signal },
    );

    const text = firstTextBlock(message);
    if (!text) return fallback('no text block');
    const parsed = parseReply(text);
    if (!parsed) return fallback('unparseable reply');
    return parsed;
  } catch (err) {
    // Typed handling: a rate limit is a capacity signal, an APIError is the service, everything else is
    // ours (abort, network). None of them is a reason to fold a hand.
    if (err instanceof Anthropic.RateLimitError) {
      console.warn(`[agent-worker] ${ctx.persona.agentName}: rate limited (429), playing the rules baseline`);
      return fallback('rate limited');
    }
    if (err instanceof Anthropic.APIUserAbortError || (err instanceof Error && err.name === 'AbortError')) {
      return fallback('deadline');
    }
    if (err instanceof Anthropic.APIError) {
      console.warn(`[agent-worker] ${ctx.persona.agentName}: Anthropic APIError ${err.status ?? '?'}: ${err.message}`);
      return fallback(`api error ${err.status ?? '?'}`);
    }
    console.warn(`[agent-worker] ${ctx.persona.agentName}: LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    return fallback('llm error');
  }
};
