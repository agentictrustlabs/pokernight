/**
 * A2A caller for agent seats (DESIGN.md §6).
 *
 * Pokernight speaks the STANDARD A2A profile: an agent is reached with a plain HTTP POST of a
 * JSON-RPC 2.0 `SendMessage` to `<base>/api/a2a`, and the reply message comes back in the SAME
 * response (synchronous), which is what a turn clock needs. The agent card at
 * `<base>/.well-known/agent-card.json` must advertise the `poker.act` skill.
 *
 * Phase 2 sends no authorization. Phase 3 adds the caller assertion / A2A grant from DESIGN.md §6
 * once a seat can move money; the only change here will be an extra header.
 */

import {
  A2A_AGENT_CARD_PATH,
  A2A_JSONRPC_PATH,
  A2A_SEND_MESSAGE,
  POKER_ACT_SKILL,
  agentNameToHost,
  decodePokerActReply,
  encodePokerActParts,
  type PokerActInput,
  type PokerActOutput,
} from '@pokernight/protocol';
import { a2aTimeoutMs, agentBaseUrl, allowAgentEndpoint, type Env } from './env.js';

export { a2aTimeoutMs };

/** The part of `AgentCardV1` (@agenticprimitives/a2a/standard) this app depends on. */
export interface AgentCardLike {
  name?: string;
  description?: string;
  version?: string;
  skills?: Array<{ id?: string; name?: string; description?: string; tags?: string[] } | null>;
}

/**
 * Base URL for an agent seat. An explicit `endpoint` wins (local dev: the agent worker on
 * http://localhost:8788 selects its persona with `?agent=<name>`, and that query survives
 * `a2aUrl` below). Otherwise the name resolves through the deployment's card zone:
 * `sharkbot.svc` in zone `faithnet.ai` → `https://sharkbot-svc.faithnet.ai`.
 */
export function resolveAgentBase(env: Env, agentName: string, endpoint?: string): string {
  if (endpoint) {
    // A caller-supplied endpoint makes the table fetch an arbitrary URL on every turn, which is a
    // server-side request forgery primitive. It is gated on ALLOW_AGENT_ENDPOINT, which a deployment
    // must opt into (local dev does). Otherwise the agent name must resolve inside AGENT_CARD_ZONE,
    // so the set of reachable hosts is exactly the set of published agents.
    if (!allowAgentEndpoint(env)) {
      throw new Error('an explicit endpoint is not accepted here; name the agent and let AGENT_CARD_ZONE resolve it');
    }
    let u: URL;
    try {
      u = new URL(endpoint);
    } catch {
      throw new Error(`endpoint is not a URL: ${endpoint}`);
    }
    // The DO will fetch this URL on every turn; only the two schemes the A2A wire uses are accepted.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`endpoint must be http(s): ${endpoint}`);
    return u.toString();
  }
  // A single-host deployment names the persona in the path instead of the hostname.
  const base = agentBaseUrl(env);
  if (base) return `${base}/${encodeURIComponent(agentName)}`;

  const zone = (env.AGENT_CARD_ZONE ?? '').trim();
  if (!zone) throw new Error('AGENT_CARD_ZONE is not configured; pass an explicit endpoint');
  const host = agentNameToHost(agentName, zone);
  const scheme = zone === 'localhost' || zone.endsWith('.localhost') ? 'http' : 'https';
  return `${scheme}://${host}`;
}

/** Append an A2A path to a base URL, keeping any path prefix AND query string the base carries. */
export function a2aUrl(base: string, path: string): string {
  const u = new URL(base);
  u.pathname = `${u.pathname.replace(/\/+$/, '')}${path}`;
  return u.toString();
}

export type CardResult = { ok: true; card: AgentCardLike } | { ok: false; error: string };

export async function fetchAgentCard(base: string, timeoutMs: number): Promise<CardResult> {
  const url = a2aUrl(base, A2A_AGENT_CARD_PATH);
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { ok: false, error: `agent card unreachable at ${url}: ${errText(e)}` };
  }
  if (!res.ok) return { ok: false, error: `agent card at ${url} returned ${res.status}` };
  let card: unknown;
  try {
    card = await res.json();
  } catch {
    return { ok: false, error: `agent card at ${url} is not JSON` };
  }
  if (!card || typeof card !== 'object' || !Array.isArray((card as AgentCardLike).skills)) {
    return { ok: false, error: `agent card at ${url} is not an A2A agent card (no skills array)` };
  }
  return { ok: true, card: card as AgentCardLike };
}

/** True when the card advertises `poker.act` as a skill id, name, or tag. */
export function hasPokerActSkill(card: AgentCardLike): boolean {
  return (card.skills ?? []).some(
    (s) => !!s && (s.id === POKER_ACT_SKILL || s.name === POKER_ACT_SKILL || (s.tags ?? []).includes(POKER_ACT_SKILL)),
  );
}

/**
 * A short label for the strategy behind an agent, for `PlayerInfo.agentKind` ("rules", "claude", ...).
 * Convention: the first tag on the `poker.act` skill that is not the skill id or the generic "poker".
 */
export function agentKindFromCard(card: AgentCardLike): string | undefined {
  const skill = (card.skills ?? []).find((s) => !!s && (s.id === POKER_ACT_SKILL || s.name === POKER_ACT_SKILL));
  const tag = (skill?.tags ?? []).find((t) => t && t !== POKER_ACT_SKILL && t !== 'poker');
  return tag ? tag.slice(0, 32) : undefined;
}

export type ActResult = { ok: true; output: PokerActOutput } | { ok: false; error: string };

/** One synchronous `poker.act` turn call. Never throws; every failure comes back as `{ ok: false }`. */
export async function callPokerAct(base: string, input: PokerActInput, timeoutMs: number): Promise<ActResult> {
  const url = a2aUrl(base, A2A_JSONRPC_PATH);
  const body = {
    jsonrpc: '2.0',
    id: `${input.tableId}:${input.handNo}:${input.seat}`,
    method: A2A_SEND_MESSAGE,
    params: {
      message: { messageId: crypto.randomUUID(), role: 'user', parts: encodePokerActParts(input) },
    },
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, error: `poker.act call to ${url} failed: ${errText(e)}` };
  }
  if (!res.ok) return { ok: false, error: `poker.act call to ${url} returned ${res.status}` };
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: `poker.act reply from ${url} is not JSON` };
  }
  const env = payload as { error?: { code?: number; message?: string }; result?: unknown };
  if (env && typeof env === 'object' && env.error) {
    return { ok: false, error: `poker.act JSON-RPC error ${env.error.code ?? '?'}: ${env.error.message ?? 'unknown'}` };
  }
  const parts = replyParts(env?.result);
  if (parts.length === 0) return { ok: false, error: 'poker.act reply carried no message parts' };
  const decoded = decodePokerActReply(parts);
  if ('error' in decoded) return { ok: false, error: decoded.error };
  return { ok: true, output: decoded };
}

/**
 * Collect every candidate part array out of a `SendMessage` result. The standard profile answers
 * `{ message }` for a synchronous reply, but a server that insists on a task is still usable:
 * its status message and artifacts carry the same parts.
 */
function replyParts(result: unknown): unknown[] {
  const out: unknown[] = [];
  const push = (p: unknown): void => {
    if (Array.isArray(p)) out.push(...p);
  };
  if (!result || typeof result !== 'object') return out;
  const r = result as Record<string, unknown>;
  push((r.message as { parts?: unknown })?.parts);
  push(r.parts);
  const task = r.task as { status?: { message?: { parts?: unknown } }; artifacts?: Array<{ parts?: unknown }> } | undefined;
  push(task?.status?.message?.parts);
  for (const a of task?.artifacts ?? []) push(a?.parts);
  return out;
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timed out' : e.message;
  return String(e);
}
