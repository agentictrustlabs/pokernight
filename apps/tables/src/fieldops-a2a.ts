/**
 * ASKING A PART FOR ITS DAY, AND ASKING THE DIRECTOR — for a Field Operations season (docs/FIELD-OPERATIONS.md).
 *
 * A PART IS ASKED THE WAY A CHARACTER IS ASKED: the season signs the exact bytes it sends AS THE HOUSE, the agent
 * answers at whatever endpoint its own card names, and what comes back is opaque until the ENGINE validates it. An
 * agent whose card does not advertise `fieldops.act` is not asked. The send and the card check are the mystery's own,
 * reused; only the SHAPE of the ask is the field's. The director is asked in the field's words, not a murder mystery's.
 */
import { A2A_JSONRPC_PATH, FIELDOPS_ACT_SKILL, FIELDOPS_DIRECT_SKILL, decodeDirectReply, decodeSceneReply, encodeFieldOpsDirectParts, encodeFieldOpsParts, type DirectInput, type DirectOutput, type SceneInput, type SceneOutput } from '@pokernight/protocol';
import { a2aUrl, fetchAgentCard, hasActSkill, messageUrlFromCard, resolveAgentBase } from './a2a.js';
import { sendSigned } from './mystery-a2a.js';
import type { Env } from './env.js';

/** Does this agent play a part in a season at all? Asked of its own card, once per call. */
export async function playsField(env: Env, agentName: string, timeoutMs: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const base = resolveAgentBase(env, agentName);
  const card = await fetchAgentCard(base, timeoutMs);
  if (!card.ok) return { ok: false, error: card.error };
  if (!hasActSkill(card.card, FIELDOPS_ACT_SKILL)) return { ok: false, error: `${agentName} does not advertise ${FIELDOPS_ACT_SKILL}` };
  return { ok: true, url: messageUrlFromCard(card.card, base) };
}

export type PartResult = { ok: true; output: SceneOutput; agent: string; ms: number; raw: string } | { ok: false; error: string; ms: number };

/** One part's day, asked of the agent that plays it. The time it took is reported: the season is a test of the agents. */
export async function askPart(env: Env, agentName: string, input: SceneInput, timeoutMs: number): Promise<PartResult> {
  const t0 = Date.now();
  const road = await playsField(env, agentName, Math.min(timeoutMs, 6_000));
  if (!road.ok) return { ...road, ms: Date.now() - t0 };
  const sent = await sendSigned(road.url, `${input.stagingId}:${input.act}:${input.role}`, encodeFieldOpsParts(input), timeoutMs, env);
  if (!sent.ok) return { ...sent, ms: Date.now() - t0 };
  const decoded = decodeSceneReply(sent.parts);
  if ('error' in decoded) return { ok: false, error: `${decoded.error}: ${JSON.stringify(sent.parts).slice(0, 400)}`, ms: Date.now() - t0 };
  return { ok: true, output: decoded, agent: agentName, ms: Date.now() - t0, raw: JSON.stringify(sent.parts).slice(0, 600) };
}

export type DirectResult = { ok: true; output: DirectOutput; agent: string } | { ok: false; error: string };

/** The week's narration, asked of whoever is directing, in the field's own words. */
export async function askFieldDirector(env: Env, agentName: string, input: DirectInput, timeoutMs: number): Promise<DirectResult> {
  const base = resolveAgentBase(env, agentName);
  const card = await fetchAgentCard(base, Math.min(timeoutMs, 6_000));
  const url = card.ok ? messageUrlFromCard(card.card, base) : a2aUrl(base, A2A_JSONRPC_PATH);
  const sent = await sendSigned(url, `${input.stagingId}:${input.act}:${input.phase}`, encodeFieldOpsDirectParts(input), timeoutMs, env);
  if (!sent.ok) return sent;
  const decoded = decodeDirectReply(sent.parts);
  if ('error' in decoded) return { ok: false, error: `${decoded.error}: ${JSON.stringify(sent.parts).slice(0, 400)}` };
  return { ok: true, output: decoded, agent: agentName };
}

export { FIELDOPS_ACT_SKILL, FIELDOPS_DIRECT_SKILL };
