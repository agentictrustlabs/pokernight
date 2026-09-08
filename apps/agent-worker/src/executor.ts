/**
 * The `poker.act` executor for the standard A2A server.
 *
 * Contract with the table (docs/DESIGN.md §6):
 *   in   one data part `{ skill: 'poker.act', input: PokerActInput }` — exactly `encodePokerActParts`
 *   out  one data part `{ action, note }` — exactly what `decodePokerActReply` reads
 *
 * It answers with `ctx.reply(...)`, which is a MESSAGE and no task, so the whole turn comes back in the
 * SendMessage HTTP response. Anything malformed is `ctx.fail(...)` with a message that says what was
 * missing — a table that sent the wrong shape should learn that, not receive a guessed fold.
 *
 * TWO GUARANTEES, and they hold on every path out of here:
 *   1. LEGALITY. Whatever a strategy returns is snapped through agent-kit's `legalize` and checked with
 *      `isLegal`; anything still illegal becomes check-else-fold. A strategy that throws, hangs, or
 *      returns nonsense cannot produce an illegal action.
 *   2. THE DEADLINE. An AbortController fires at `deadlineMs` minus 1 s of headroom, so the reply is on
 *      the wire before the table's clock applies its own default.
 */

import { isLegal, legalize } from '@pokernight/agent-kit';
import type { Action, LegalActions, TableView } from '@pokernight/engine';
import { POKER_ACT_SKILL, PokerActOutputSchema, type PokerActInput, type PokerActOutput } from '@pokernight/protocol';
import type { ExecutionContext, MessageV1, PartV1, StandardExecutor } from '@agenticprimitives/a2a/standard';
import type { Env } from './env.js';
import type { Persona } from './personas.js';
import { isKnownStrategy, strategyFor, type StrategyContext } from './strategies/index.js';

/**
 * `@pokernight/protocol` tags parts with a `kind` discriminator (`encodePokerActParts` /
 * `decodePokerActReply`); the A2A 1.0 `PartV1` is presence-based and declares no such field. A part is
 * written with BOTH so either reader is satisfied, and read either way.
 */
export type PokerPart = PartV1 & { kind?: 'data' | 'text' };

export function dataPart(data: Record<string, unknown>): PartV1 {
  const part: PokerPart = { kind: 'data', data };
  return part;
}

/** Milliseconds of headroom left for serialising and returning the reply. */
export const DEADLINE_HEADROOM_MS = 1000;
const MIN_BUDGET_MS = 250;
const DEFAULT_DEADLINE_MS = 15_000;

/* --------------------------------------------------------------------- decode */

export type Decoded = { ok: true; input: PokerActInput } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function looksLikeLegal(v: unknown): v is LegalActions {
  if (!isRecord(v)) return false;
  const range = (r: unknown) => r === null || (isRecord(r) && typeof r.min === 'number' && typeof r.max === 'number');
  return (
    typeof v.fold === 'boolean' &&
    typeof v.check === 'boolean' &&
    (v.call === null || typeof v.call === 'number') &&
    range(v.bet) &&
    range(v.raise) &&
    typeof v.allIn === 'number'
  );
}

function looksLikeView(v: unknown): v is TableView {
  return isRecord(v) && isRecord(v.config) && Array.isArray(v.seats) && 'hand' in v;
}

/**
 * Pull a `PokerActInput` out of the request parts. Mirrors `encodePokerActParts` and is deliberately
 * defensive: an untrusted caller gets a precise complaint, never a stack trace.
 */
export function decodePokerActRequest(parts: readonly PartV1[] | undefined): Decoded {
  if (!Array.isArray(parts) || parts.length === 0) return { ok: false, error: 'the message carried no parts' };

  let sawData = false;
  for (const part of parts) {
    let payload: unknown = (part as PokerPart | undefined)?.data;
    // A text part holding the same JSON is accepted too; some clients cannot send data parts.
    if (payload === undefined && typeof part?.text === 'string') {
      try {
        payload = JSON.parse(part.text);
      } catch {
        continue;
      }
    }
    if (!isRecord(payload)) continue;
    sawData = true;

    const skill = typeof payload.skill === 'string' ? payload.skill : undefined;
    // Accept the wrapped form `{ skill, input }` and a bare PokerActInput.
    const candidate = isRecord(payload.input) ? payload.input : 'view' in payload ? payload : null;
    if (skill !== undefined && skill !== POKER_ACT_SKILL) {
      return { ok: false, error: `unsupported skill "${skill}"; this agent registers only "${POKER_ACT_SKILL}"` };
    }
    if (!candidate) continue;

    const missing: string[] = [];
    if (!looksLikeView(candidate.view)) missing.push('view (a redacted TableView with config, seats and hand)');
    if (!looksLikeLegal(candidate.legal)) missing.push('legal (LegalActions: fold, check, call, bet, raise, allIn)');
    if (typeof candidate.seat !== 'number') missing.push('seat (a number)');
    if (missing.length > 0) {
      return { ok: false, error: `${POKER_ACT_SKILL} input is missing or malformed: ${missing.join('; ')}` };
    }

    const deadlineRaw = candidate.deadlineMs;
    return {
      ok: true,
      input: {
        tableId: typeof candidate.tableId === 'string' ? candidate.tableId : '',
        handNo: typeof candidate.handNo === 'number' ? candidate.handNo : (candidate.view as TableView).handNo,
        seat: candidate.seat as number,
        view: candidate.view as TableView,
        legal: candidate.legal as LegalActions,
        deadlineMs: typeof deadlineRaw === 'number' && deadlineRaw > 0 ? deadlineRaw : DEFAULT_DEADLINE_MS,
      },
    };
  }

  return {
    ok: false,
    error: sawData
      ? `no ${POKER_ACT_SKILL} request in the message: expected a data part { skill: "${POKER_ACT_SKILL}", input: { tableId, handNo, seat, view, legal, deadlineMs } }`
      : `the message carried no data part; expected { skill: "${POKER_ACT_SKILL}", input: { … } }`,
  };
}

/* -------------------------------------------------------------------- legality */

/** The action a table applies when nobody answers: check if it is free, else fold. */
export function safeDefault(legal: LegalActions): Action {
  if (legal.check) return { type: 'check' };
  if (legal.fold) return { type: 'fold' };
  if (legal.call !== null && legal.call > 0) return { type: 'call' };
  if (legal.allIn > 0) return { type: 'all-in' };
  return { type: 'fold' };
}

/** Snap any action into `legal`; anything that still is not legal becomes check-else-fold. */
export function ensureLegal(desired: Action, view: TableView, legal: LegalActions): Action {
  try {
    const snapped = legalize(desired, legal, view);
    if (isLegal(snapped, legal)) return snapped;
  } catch {
    /* fall through to the default */
  }
  const fallback = safeDefault(legal);
  return isLegal(fallback, legal) ? fallback : { type: 'fold' };
}

/* -------------------------------------------------------------------- executor */

export interface ExecutorOptions {
  /** Injected in tests so a decision is reproducible. */
  rng?: () => number;
  /** Injected in tests to force a strategy regardless of what the persona names. */
  strategyName?: string;
}

export function createPokerActExecutor(persona: Persona, env: Env, opts: ExecutorOptions = {}): StandardExecutor {
  // The persona names its own strategy; DEFAULT_STRATEGY is the floor when it names nothing, or names
  // something this build does not have (a persona added ahead of its strategy).
  const named = opts.strategyName ?? persona.strategy;
  const strategy = isKnownStrategy(named) ? strategyFor(named) : strategyFor(env.DEFAULT_STRATEGY);

  return {
    async execute(ctx: ExecutionContext): Promise<void> {
      const message: MessageV1 = ctx.message;
      const decoded = decodePokerActRequest(message.parts);
      if (!decoded.ok) {
        await ctx.fail([{ text: `${persona.agentName}: ${decoded.error}` }]);
        return;
      }
      const { input } = decoded;

      const controller = new AbortController();
      const budget = Math.max(MIN_BUDGET_MS, input.deadlineMs - DEADLINE_HEADROOM_MS);
      const timer = setTimeout(() => controller.abort(), budget);

      let out: PokerActOutput;
      try {
        const sctx: StrategyContext = { persona, env, signal: controller.signal, ...(opts.rng ? { rng: opts.rng } : {}) };
        // The race is belt-and-braces: the signal is what a well-behaved strategy honours, and this is
        // what happens when one does not. Either way an answer leaves before the table's clock.
        out = await Promise.race([
          strategy(input, sctx),
          new Promise<PokerActOutput>((resolve) => {
            controller.signal.addEventListener('abort', () => {
              resolve({ action: safeDefault(input.legal), note: 'deadline reached, default action' });
            });
          }),
        ]);
      } catch (err) {
        out = {
          action: safeDefault(input.legal),
          note: `strategy error (${err instanceof Error ? err.message : String(err)}), default action`.slice(0, 280),
        };
      } finally {
        clearTimeout(timer);
      }

      const action = ensureLegal(out.action, input.view, input.legal);
      const note = (out.note ?? '').slice(0, 280);
      // Validate on the way out so a strategy bug can never put a malformed artifact on the wire.
      const reply = PokerActOutputSchema.safeParse({ action, ...(note ? { note } : {}) });
      const body: Record<string, unknown> = reply.success
        ? { action: reply.data.action, ...(reply.data.note ? { note: reply.data.note } : {}) }
        : { action: safeDefault(input.legal), note: 'output failed validation, default action' };

      await ctx.reply([dataPart(body)]);
    },
  };
}
