/**
 * `canasta.advise` and `poker.advise` — the reference adviser. It advertises no `*.record` and no
 * `*.review`, because it keeps nothing.
 *
 * WHY THESE LIVE IN AN AGENT AND NOT IN THE CARD ROOM. The card room's part is to ask the agent a
 * person named and to say whose answer it is showing; the reasoning is the agent's. This worker is an
 * agent, so this is the right side of that line — and it doubles as the worked example somebody
 * points their own Home agent at, rather than building against a contract nobody has exercised.
 *
 * ADVISING IS NOT ACTING, and the skills are separate for that reason: an agent may advertise one
 * without the other, and a table must never hand a turn to something that only meant to talk. Nothing
 * returned here is applied — the `action` in a reply is a suggestion the person may take or ignore.
 *
 * RECORDING AND REVIEWING ARE A PERSON'S OWN AGENT'S. After a round the card room sends the seated
 * person's own agent that round as the seat saw it, to keep in the person's vault (`*.record`); when
 * the person asks how they have been playing, their agent forwards the question to the coach they
 * named (`*.review`). A house persona has no vault of anybody's and no coach: it advertises neither
 * skill, and a request that reaches it anyway is refused by name rather than acknowledged into a
 * memory it does not have (the earlier "noted, kept nothing" reply pretended to a shape it never filled).
 */

import { chooseCanastaAction } from '@pokernight/canasta-agent';
import { explainMove } from '@pokernight/canasta-agent';
import { decide, readHand } from '@pokernight/agent-kit';
import type { LegalActions, TableView } from '@pokernight/engine';
import {
  CANASTA_ADVISE_SKILL,
  POKER_ACT_SKILL,
  POKER_ADVISE_SKILL,
} from '@pokernight/protocol';
import type { ExecutionContext, PartV1, StandardExecutor } from '@agenticprimitives/a2a/standard';
import type { Persona } from './personas.js';
import { dataPart } from './executor.js';
import { decodeCanastaRequest } from './canasta-executor.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The person's own words, when they asked something. Carried by the table, never parsed by it. */
function questionOf(parts: readonly PartV1[] | undefined): string | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const payload = (part as { data?: unknown }).data;
    if (!isRecord(payload)) continue;
    const input = isRecord(payload.input) ? payload.input : payload;
    if (typeof input.question === 'string' && input.question.trim()) return input.question.trim();
  }
  return null;
}

/**
 * Canasta advice: the move this strategy would make, and the rule behind it.
 *
 * Reuses the same chooser the house bots play with, which is the honest thing for a REFERENCE
 * adviser to do — its value is in showing the wire, not in being a better player than the table's own
 * coach. An adviser with somebody's style would differ here, and that difference is the whole point
 * of naming your own.
 */
export function createCanastaAdviseExecutor(persona: Persona): StandardExecutor {
  return {
    async execute(ctx: ExecutionContext): Promise<void> {
      const decoded = decodeCanastaRequest(ctx.message?.parts as PartV1[] | undefined);
      if ('error' in decoded) {
        await ctx.fail([{ text: `${persona.agentName}: ${decoded.error}` }]);
        return;
      }
      const asked = questionOf(ctx.message?.parts as PartV1[] | undefined);
      const { action } = chooseCanastaAction(decoded.view, decoded.legal, decoded.seat);
      const explained = explainMove(decoded.view, decoded.seat, action);
      await ctx.reply([
        dataPart({
          say: explained.say,
          // The question is answered by being addressed, not by being repeated — but saying which
          // question this is about is how somebody knows the answer is to the thing they asked.
          because: asked ? `You asked: ${asked}. ${explained.because}` : explained.because,
          action: action as unknown as Record<string, unknown>,
        }),
      ]);
    },
  };
}

function looksLikePokerView(v: unknown): v is TableView {
  return isRecord(v) && Array.isArray(v.seats) && 'handNo' in v;
}

/**
 * Hold'em advice: THE MOVE, and the price, position and money behind that argue for it.
 *
 * The move matters as much as the words, and leaving it out was not a missing nicety — it broke the
 * table. Canasta's adviser returned one from the start and this one did not, so a person on "tell me"
 * got a sentence and a button with nothing behind it: pressing it sent no action, the card room had
 * nothing to apply, the clock ran out, and after enough of those the table sat them out. Hands went by
 * and they were never dealt in. An adviser that cannot be acted on is worse than one that says
 * nothing, because the screen offers a move that does not exist.
 *
 * Deterministic, like the house coach and for the same reason: advice that changes when you ask again
 * is not advice, and the straightforward line is the one somebody learning can reproduce.
 */
export function createPokerAdviseExecutor(persona: Persona): StandardExecutor {
  return {
    async execute(ctx: ExecutionContext): Promise<void> {
      const parts = ctx.message?.parts as PartV1[] | undefined;
      let view: TableView | null = null;
      let legal: LegalActions | null = null;
      let seat: number | null = null;
      for (const part of parts ?? []) {
        const payload = (part as { data?: unknown }).data;
        if (!isRecord(payload)) continue;
        const input = isRecord(payload.input) ? payload.input : payload;
        if (looksLikePokerView(input.view) && typeof input.seat === 'number') {
          view = input.view as TableView;
          legal = (input.legal ?? null) as LegalActions | null;
          seat = input.seat as number;
          break;
        }
      }
      if (!view || seat === null) {
        await ctx.fail([{ text: `${persona.agentName}: ${POKER_ADVISE_SKILL} input needs a view and a seat` }]);
        return;
      }
      const asked = questionOf(parts);
      const read = readHand(view, seat, legal);
      // The READING and the MOVE come from different places on purpose — the same split the house
      // coach makes. `readHand` says what is true about the spot; `decide` picks the line. A coach
      // that explained itself by restating its own choice would teach the choice.
      const suggested = legal
        ? decide(
            { skill: POKER_ACT_SKILL, tableId: '', handNo: view.hand?.handNo ?? 0, seat, view, legal, deadlineMs: 0 },
            { rng: () => 1 },
          ).action
        : null;
      await ctx.reply([
        dataPart({
          say: read.say,
          because: asked ? `You asked: ${asked}. ${read.because}` : read.because,
          // Only ever a SUGGESTION. Nothing in the card room applies it; the person presses or does not.
          ...(suggested ? { action: suggested as unknown as Record<string, unknown> } : {}),
        }),
      ]);
    },
  };
}

/**
 * A record or a review that reached a house persona — refused, by name.
 *
 * A house persona keeps no hands and coaches nobody: the card room records a finished round to the
 * PERSON's own agent (which advertises `*.record`), and a review is the person's question to their own
 * coach. Neither skill is on this card, so a table never sends one here; a caller that does anyway is
 * told what this agent is rather than given a "noted" that kept nothing.
 */
export function createKeepsNothingExecutor(persona: Persona): StandardExecutor {
  return {
    async execute(ctx: ExecutionContext): Promise<void> {
      await ctx.fail([{ text: `${persona.displayName} is a house persona: it keeps no hands and reviews nobody's. A finished hand is recorded to the seated person's own agent, and a review is that person's question to the coach they named.` }]);
    },
  };
}

export const ADVISE_SKILLS = [CANASTA_ADVISE_SKILL, POKER_ADVISE_SKILL] as const;

/**
 * ONE SERVER, TWO SKILLS — routed by the skill the caller named.
 *
 * The A2A server takes a single executor, and this persona answers two different questions: take a
 * turn, say something. They are separate skills precisely so a caller can ask for one without the
 * other, so the routing reads the SKILL ON THE REQUEST rather than sniffing the payload — a request
 * that means to ask for advice must never fall through into taking a turn. A record or a review named
 * on the request goes to the refusal: neither is a house persona's to answer.
 *
 * An unnamed skill is treated as the act skill, which is what every existing table sends today.
 */
export function createRoutingExecutor(
  persona: Persona,
  act: StandardExecutor,
  advise: StandardExecutor,
  keepsNothing: StandardExecutor,
): StandardExecutor {
  return {
    async execute(ctx: ExecutionContext): Promise<void> {
      const parts = (ctx.message?.parts ?? []) as PartV1[];
      let named = '';
      for (const part of parts) {
        const payload = (part as { data?: unknown }).data;
        if (isRecord(payload) && typeof payload.skill === 'string') {
          named = payload.skill;
          break;
        }
      }
      if (named.endsWith('.advise')) return advise.execute(ctx);
      if (named.endsWith('.review') || named.endsWith('.record')) return keepsNothing.execute(ctx);
      return act.execute(ctx);
    },
  };
}
