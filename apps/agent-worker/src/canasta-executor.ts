/**
 * The `canasta.act` executor.
 *
 * The poker executor's twin, and deliberately its own file rather than a branch inside it: the two
 * games share the ENVELOPE — one data part in, one data part out, a reply that is a message and not
 * a task, a deadline with headroom — and share nothing else. A canasta view has no pot, a canasta
 * action has no amount, and a file that served both would be two executors wearing one name.
 *
 * ONE GUARANTEE, and it holds on every path out of here: whatever comes back is a move the engine
 * will accept. `chooseCanastaAction` verifies its own plans against the engine's pure helpers before
 * returning them, and anything that throws falls back to drawing or to the cheapest legal discard —
 * because the alternative is the table's timeout default, which is worse for the player's partner
 * than a weak move.
 */

import { chooseCanastaAction } from '@pokernight/canasta-agent';
import type { CanastaLegal, CanastaView } from '@pokernight/canasta';
import { CANASTA_ACT_SKILL } from '@pokernight/protocol';
import type { ExecutionContext, PartV1, StandardExecutor } from '@agenticprimitives/a2a/standard';
import type { Persona } from './personas.js';
import { dataPart } from './executor.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Enough of a canasta view to act on. Checked, not trusted: an untrusted caller gets a complaint. */
function looksLikeView(v: unknown): v is CanastaView {
  return isRecord(v) && Array.isArray(v.seats) && isRecord(v.melds) && 'phase' in v && 'stock' in v;
}

function looksLikeLegal(v: unknown): v is CanastaLegal {
  return (
    isRecord(v) &&
    (v.phase === 'draw' || v.phase === 'play') &&
    typeof v.canDraw === 'boolean' &&
    typeof v.canTakePile === 'boolean' &&
    Array.isArray(v.discardable)
  );
}

export interface CanastaDecoded {
  view: CanastaView;
  legal: CanastaLegal;
  seat: number;
}

export function decodeCanastaRequest(parts: readonly PartV1[] | undefined): CanastaDecoded | { error: string } {
  if (!Array.isArray(parts) || parts.length === 0) return { error: 'the message carried no parts' };
  for (const part of parts) {
    let payload: unknown = (part as { data?: unknown } | undefined)?.data;
    // A text part holding the same JSON is accepted too; some clients cannot send data parts.
    if (payload === undefined) {
      const text = (part as { text?: unknown } | undefined)?.text;
      if (typeof text === 'string') {
        try {
          payload = JSON.parse(text);
        } catch {
          continue;
        }
      }
    }
    if (!isRecord(payload)) continue;
    const input = isRecord(payload.input) ? payload.input : 'view' in payload ? payload : null;
    if (!input) continue;
    const missing: string[] = [];
    if (!looksLikeView(input.view)) missing.push('view (a redacted CanastaView with seats, melds, phase and stock)');
    if (!looksLikeLegal(input.legal)) missing.push('legal (CanastaLegal: phase, canDraw, canTakePile, discardable)');
    if (typeof input.seat !== 'number') missing.push('seat (a number)');
    if (missing.length > 0) return { error: `${CANASTA_ACT_SKILL} input is missing or malformed: ${missing.join('; ')}` };
    return { view: input.view as CanastaView, legal: input.legal as CanastaLegal, seat: input.seat as number };
  }
  return { error: `no ${CANASTA_ACT_SKILL} input in the message` };
}

export function createCanastaActExecutor(persona: Persona): StandardExecutor {
  return {
    async execute(ctx: ExecutionContext): Promise<void> {
      const decoded = decodeCanastaRequest(ctx.message?.parts as PartV1[] | undefined);
      if ('error' in decoded) {
        // A table that sent the wrong shape should learn that, not receive a guessed draw.
        await ctx.fail([{ text: `${persona.agentName}: ${decoded.error}` }]);
        return;
      }
      const { action, note } = chooseCanastaAction(decoded.view, decoded.legal, decoded.seat);
      await ctx.reply([dataPart({ action: action as unknown as Record<string, unknown>, ...(note ? { note } : {}) })]);
    },
  };
}
