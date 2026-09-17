/**
 * ASKING A PART, AND ASKING THE DIRECTOR — for a Great Commission night (docs/GREAT-COMMISSION.md §10).
 *
 * A PART IS ASKED THE WAY A CHARACTER IS ASKED. `commission.act` travels the road `mystery.act` travels: the
 * staging signs the exact bytes it sends AS THE HOUSE, the agent answers at whatever endpoint its own card
 * names, and what comes back is opaque until the ENGINE validates it. An agent whose card does not advertise
 * the skill is not asked. Only the SHAPE of the ask differs — the verbs are a different game's — so the send,
 * the card check and the director's road are the mystery's own, reused rather than copied.
 */
import { COMMISSION_ACT_SKILL, COMMISSION_DIRECT_SKILL, decodeSceneReply, encodeCommissionParts, type SceneInput, type SceneOutput } from '@pokernight/protocol';
import { fetchAgentCard, hasActSkill, messageUrlFromCard, resolveAgentBase } from './a2a.js';
import { sendSigned } from './mystery-a2a.js';
import type { Env } from './env.js';

export { askDirector } from './mystery-a2a.js';

/** Does this agent play a part in a commission at all? Asked of its own card, once per call. */
export async function playsParts(env: Env, agentName: string, timeoutMs: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const base = resolveAgentBase(env, agentName);
  const card = await fetchAgentCard(base, timeoutMs);
  if (!card.ok) return { ok: false, error: card.error };
  if (!hasActSkill(card.card, COMMISSION_ACT_SKILL)) return { ok: false, error: `${agentName} does not advertise ${COMMISSION_ACT_SKILL}` };
  return { ok: true, url: messageUrlFromCard(card.card, base) };
}

export type PartResult = { ok: true; output: SceneOutput; agent: string } | { ok: false; error: string };

/** One part's moment, asked of the agent that plays it. */
export async function askPart(env: Env, agentName: string, input: SceneInput, timeoutMs: number): Promise<PartResult> {
  const road = await playsParts(env, agentName, Math.min(timeoutMs, 6_000));
  if (!road.ok) return road;
  const sent = await sendSigned(road.url, `${input.stagingId}:${input.act}:${input.role}`, encodeCommissionParts(input), timeoutMs, env);
  if (!sent.ok) return sent;
  const decoded = decodeSceneReply(sent.parts);
  if ('error' in decoded) return { ok: false, error: `${decoded.error}: ${JSON.stringify(sent.parts).slice(0, 400)}` };
  return { ok: true, output: decoded, agent: agentName };
}

export { COMMISSION_ACT_SKILL, COMMISSION_DIRECT_SKILL };
