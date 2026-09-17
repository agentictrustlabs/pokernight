/**
 * ASKING A CHARACTER, AND ASKING THE DIRECTOR (docs/MYSTERY-NIGHT.md §8, §10).
 *
 * A CHARACTER IS ASKED THE WAY A SEAT IS ASKED. `mystery.act` travels the road `poker.act` already travels:
 * the staging signs the exact bytes it sends AS THE HOUSE (`house-caller.ts`), the agent answers at whatever
 * endpoint its own card names, and what comes back is opaque until the ENGINE validates it. An agent whose
 * card does not advertise the skill is not asked — the same rule that stops a poker bot being handed a
 * canasta turn stops a coach being handed a murder.
 *
 * WHOSE MODEL THINKS. The house spends no tokens (the rule that deleted `ANTHROPIC_API_KEY` from the persona
 * worker), so a character with a mind of its own is a PERSON'S agent — theirs, at their Home, reasoning from
 * the role archetype in their playbook and costing their tokens. A character the house plays answers on the
 * engine's own rules policy and costs nobody anything. The night never waits on either: every call has a
 * deadline, and a miss is a character who simply did something sensible instead.
 *
 * THE DIRECTOR IS ASKED FOR WORDS, NOT DECISIONS. It is handed the PUBLIC half of the story and the facts the
 * engine has already decided, and what can come back is narration and at most a hint at a room or a prop that
 * already exists. It cannot invent a clue, move a character or name a killer, because none of those are in
 * the shape of its answer — and the title's own written line runs whenever it is quiet.
 */
import {
  A2A_JSONRPC_PATH, A2A_SEND_MESSAGE, MYSTERY_ACT_SKILL, MYSTERY_DIRECT_SKILL,
  decodeDirectReply, decodeSceneReply, encodeDirectParts, encodeSceneParts,
  type DirectInput, type DirectOutput, type SceneInput, type SceneOutput,
} from '@pokernight/protocol';
import { a2aUrl, fetchAgentCard, hasActSkill, messageUrlFromCard, replyParts, resolveAgentBase } from './a2a.js';
import { houseAuthorization } from './house-caller.js';
import type { Env } from './env.js';

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One signed JSON-RPC `message/send`, and whatever parts come back. Never throws.
 *
 * A MESSAGE GOES WHERE THE CARD SAYS. A Home agent answers at the estate's EDGE (`edge…/api/a2a/<name>`) and
 * refuses its own host with a 401 — which is exactly what this road did until it read the endpoint off the
 * card instead of building one from the zone. `url` is therefore passed in, taken from the card.
 */
export async function sendSigned(url: string, id: string, parts: unknown[], timeoutMs: number, env?: Env): Promise<{ ok: true; parts: unknown } | { ok: false; error: string }> {
  const raw = JSON.stringify({
    jsonrpc: '2.0', id, method: A2A_SEND_MESSAGE,
    params: { message: { messageId: crypto.randomUUID(), role: 'user', parts } },
  });
  const authorization = env ? await houseAuthorization(env, url, A2A_SEND_MESSAGE, raw) : null;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(authorization ? { authorization } : {}) },
      body: raw,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) { return { ok: false, error: `call to ${url} failed: ${errText(e)}` }; }
  if (!res.ok) return { ok: false, error: `call to ${url} returned ${res.status}` };
  let payload: unknown;
  try { payload = await res.json(); } catch { return { ok: false, error: `reply from ${url} is not JSON` }; }
  const envp = payload as { error?: { code?: number; message?: string }; result?: unknown };
  if (envp?.error) return { ok: false, error: `JSON-RPC error ${envp.error.code ?? '?'}: ${envp.error.message ?? 'unknown'}` };
  // A Home answers with a TASK and a persona with a message; one reader knows both (`replyParts`).
  const parts2 = replyParts(envp?.result);
  if (!parts2.length) return { ok: false, error: `reply carried no message parts: ${JSON.stringify(envp?.result ?? {}).slice(0, 220)}` };
  return { ok: true, parts: parts2 };
}

/** Does this agent play a part at all? Asked of its own card, once per call, never memoised into a lie. */
export async function playsCharacters(env: Env, agentName: string, timeoutMs: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const base = resolveAgentBase(env, agentName);
  const card = await fetchAgentCard(base, timeoutMs);
  if (!card.ok) return { ok: false, error: card.error };
  if (!hasActSkill(card.card, MYSTERY_ACT_SKILL)) return { ok: false, error: `${agentName} does not advertise ${MYSTERY_ACT_SKILL}` };
  return { ok: true, url: messageUrlFromCard(card.card, base) };
}

export type SceneResult = { ok: true; output: SceneOutput; agent: string } | { ok: false; error: string };

/** One character's moment, asked of the agent that plays them. */
export async function askCharacter(env: Env, agentName: string, input: SceneInput, timeoutMs: number): Promise<SceneResult> {
  const road = await playsCharacters(env, agentName, Math.min(timeoutMs, 6_000));
  if (!road.ok) return road;
  const sent = await sendSigned(road.url, `${input.stagingId}:${input.act}:${input.role}`, encodeSceneParts(input), timeoutMs, env);
  if (!sent.ok) return sent;
  const decoded = decodeSceneReply(sent.parts);
  // WHAT IT ACTUALLY SAID, when it did not say it in the shape — the only thing that tells you whether to fix
  // the ask, the playbook or the reader.
  if ('error' in decoded) return { ok: false, error: `${decoded.error}: ${JSON.stringify(sent.parts).slice(0, 400)}` };
  return { ok: true, output: decoded, agent: agentName };
}

export type DirectResult = { ok: true; output: DirectOutput; agent: string } | { ok: false; error: string };

/**
 * THE NIGHT'S NARRATION, asked of whoever is directing it.
 *
 * The director is an agent like any other — the host's own, the player's own, or a service somebody custodies
 * — and it is addressed by name. It is not asked whether it advertises `mystery.act`: directing is a different
 * job, and an agent that cannot do it simply does not answer in the shape, which is a miss like any other.
 */
export async function askDirector(env: Env, agentName: string, input: DirectInput, timeoutMs: number): Promise<DirectResult> {
  const base = resolveAgentBase(env, agentName);
  // The director's endpoint comes off its card too; a Home agent refuses its own host.
  const card = await fetchAgentCard(base, Math.min(timeoutMs, 6_000));
  const url = card.ok ? messageUrlFromCard(card.card, base) : a2aUrl(base, A2A_JSONRPC_PATH);
  const sent = await sendSigned(url, `${input.stagingId}:${input.act}:${input.phase}`, encodeDirectParts(input), timeoutMs, env);
  if (!sent.ok) return sent;
  const decoded = decodeDirectReply(sent.parts);
  if ('error' in decoded) return { ok: false, error: `${decoded.error}: ${JSON.stringify(sent.parts).slice(0, 400)}` };
  return { ok: true, output: decoded, agent: agentName };
}

export { MYSTERY_ACT_SKILL, MYSTERY_DIRECT_SKILL };
export type { SceneInput, DirectInput };
