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
  encodeAdviseParts,
  A2A_AGENT_CARD_PATH,
  A2A_JSONRPC_PATH,
  A2A_SEND_MESSAGE,
  POKER_ACT_SKILL,
  agentNameToHost,
  decodeActReply,
  decodeAdviseReply,
  encodeActParts,
  type ActInput,
  type ActOutput,
  type AdviseInput,
  type AdviseOutput,
} from '@pokernight/protocol';
import { a2aTimeoutMs, agentBaseUrl, allowAgentEndpoint, type Env } from './env.js';
import { houseAuthorization } from './house-caller.js';

export { a2aTimeoutMs };

/** The part of `AgentCardV1` (@agenticprimitives/a2a/standard) this app depends on. */
export interface AgentCardLike {
  name?: string;
  description?: string;
  version?: string;
  skills?: Array<{ id?: string; name?: string; description?: string; tags?: string[] } | null>;
  /** Where the agent says to send it messages. Read, never built, when present. */
  supportedInterfaces?: Array<{ url?: string; protocolBinding?: string } | null>;
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
  /**
   * A PUBLIC AGENT IS NAMED BY ITS HOST, and that is the whole of its address.
   *
   * An agent published in the card room's agent zone answers at its own name — `alice.faithnet.at`
   * serves `/.well-known/agent-card.json` and the A2A endpoint beside it. So a name that already ends
   * in the zone IS the host, and transforming it further would be inventing a different one.
   *
   * Checked BEFORE the single-host base, because that base is how this deployment reaches its own
   * house personas — bare labels with no zone on them — and a person's published agent must not be
   * looked for underneath it.
   */
  const zoneSuffix = (env.AGENT_CARD_ZONE ?? '').trim().toLowerCase();
  const named = agentName.trim().toLowerCase();
  if (zoneSuffix && named.endsWith(`.${zoneSuffix}`)) {
    const scheme = zoneSuffix === 'localhost' || zoneSuffix.endsWith('.localhost') ? 'http' : 'https';
    return `${scheme}://${named}`;
  }

  /**
   * A HOSTNAME IS ITS OWN ADDRESS, whatever zone it is in.
   *
   * The estate serves a person's card on more than one zone — `alice.faithnet.io` and
   * `alice.faithnet.ai` are the same released card — and a person who types the name their agent is
   * actually published under should not be told it lives somewhere else. An agent NAME is two labels
   * (`alice.me`, `sharkbot.svc`) or a scoped form with an `@`; three or more labels and no `@` is a
   * DNS host, and the only honest thing to do with a host is to ask it.
   */
  if (!named.includes('@') && named.split('.').length >= 3 && /^[a-z0-9.-]+$/.test(named)) {
    const scheme = named.endsWith('.localhost') ? 'http' : 'https';
    return `${scheme}://${named}`;
  }

  const zone = (env.AGENT_CARD_ZONE ?? '').trim();
  const scheme = zone === 'localhost' || zone.endsWith('.localhost') ? 'http' : 'https';

  /**
   * A PERSON'S AGENT LIVES AT THE ESTATE, never on the house worker.
   *
   * `alice.me` is a person: the estate serves it at `alice-me.<zone>` (and `alice.<zone>`), and the
   * house base serves only the house's own personas. Sending a `.me` name to the house base first
   * asked `agents.faithnet.io/alice.me/…`, got the 404 that base gives every name it does not have,
   * and stopped there — so "your own agent" could never be named, whatever its card said. The house
   * base is the right FIRST answer for the house's `*.svc` personas and the wrong one for a person.
   */
  if (zone && named.endsWith('.me')) return `${scheme}://${agentNameToHost(agentName, zone)}`;

  // A single-host deployment names the persona in the path instead of the hostname. This is how the
  // HOUSE agents are reached; a published agent took one of the branches above.
  const base = agentBaseUrl(env);
  if (base) return `${base}/${encodeURIComponent(agentName)}`;

  if (!zone) throw new Error('AGENT_CARD_ZONE is not configured; pass an explicit endpoint');
  return `${scheme}://${agentNameToHost(agentName, zone)}`;
}

/** Append an A2A path to a base URL, keeping any path prefix AND query string the base carries. */
export function a2aUrl(base: string, path: string): string {
  const u = new URL(base);
  // ALREADY A MESSAGE URL: an endpoint taken off an agent's card carries its own path — the estate's
  // edge addresses an agent as `/api/a2a/<name>` — and appending the path again would ask for a route
  // that does not exist. An endpoint that is a bare base (the house personas, and every adviser stored
  // before cards were read for this) still gets the path appended, so nothing stored has to change.
  if (u.pathname.includes(path)) return u.toString();
  u.pathname = `${u.pathname.replace(/\/+$/, '')}${path}`;
  return u.toString();
}

/**
 * WHERE TO SEND THIS AGENT A MESSAGE — the card's word, when it gives one.
 *
 * A Home agent's card names the estate's EDGE as its message URL (`https://edge…/api/a2a/alice.me`);
 * the host the card was fetched from refuses a direct call with `gateway_assertion_required`. The card
 * room used to build the endpoint from the hostname and never read the card's, so a person's own agent
 * could be named, checked and stored — and then every question to it was refused at the door.
 *
 * Following a card's declared endpoint is what A2A is: a published card is trusted for where it
 * answers. Only http(s) is followed, the same rule an explicit endpoint is held to.
 */
export function messageUrlFromCard(card: AgentCardLike, base: string): string {
  const declared = (card.supportedInterfaces ?? []).find((i) => typeof i?.url === 'string' && (!i.protocolBinding || i.protocolBinding === 'JSONRPC'))?.url;
  if (declared) {
    try {
      const u = new URL(declared);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
    } catch {
      /* not a URL — fall through to the base */
    }
  }
  return a2aUrl(base, A2A_JSONRPC_PATH);
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

/**
 * True when the card advertises the skill this table's game asks agents to answer on.
 *
 * The skill is the GAME's, not this file's: an agent that plays poker cannot play canasta, and the
 * two must not be able to be handed each other's turns. `poker.act` is the default because it is the
 * only skill this deployment deals today.
 */
export function hasActSkill(card: AgentCardLike, skill: string = POKER_ACT_SKILL): boolean {
  return (card.skills ?? []).some(
    (s) => !!s && (s.id === skill || s.name === skill || (s.tags ?? []).includes(skill)),
  );
}

/**
 * A short label for the strategy behind an agent, for `PlayerInfo.agentKind` ("rules", "claude", ...).
 * Convention: the first tag on the `poker.act` skill that is not the skill id or the generic "poker".
 */
export function agentKindFromCard(card: AgentCardLike, want: string = POKER_ACT_SKILL): string | undefined {
  const skill = (card.skills ?? []).find((s) => !!s && (s.id === want || s.name === want));
  // The game's own name is not a strategy label — "rules" and "claude" are, and are what this is for.
  const game = want.split('.')[0] ?? '';
  const tag = (skill?.tags ?? []).find((t) => t && t !== want && t !== game);
  return tag ? tag.slice(0, 32) : undefined;
}

export type ActResult = { ok: true; output: ActOutput } | { ok: false; error: string };

/**
 * One synchronous turn call to an agent seat. Never throws; every failure comes back as `{ ok: false }`.
 *
 * The SKILL rides on the input, so this call is the same for every game and the message says which
 * one is asking. What comes back is an opaque action; the table validates it against the game that
 * asked, because that is the only thing that can tell a legal move from a malformed one.
 */
export async function callAct(base: string, input: ActInput, timeoutMs: number): Promise<ActResult> {
  const url = a2aUrl(base, A2A_JSONRPC_PATH);
  const body = {
    jsonrpc: '2.0',
    id: `${input.tableId}:${input.handNo}:${input.seat}`,
    method: A2A_SEND_MESSAGE,
    params: {
      message: { messageId: crypto.randomUUID(), role: 'user', parts: encodeActParts(input) },
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
    return { ok: false, error: `${input.skill} call to ${url} failed: ${errText(e)}` };
  }
  if (!res.ok) return { ok: false, error: `${input.skill} call to ${url} returned ${res.status}` };
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: `${input.skill} reply from ${url} is not JSON` };
  }
  const env = payload as { error?: { code?: number; message?: string }; result?: unknown };
  if (env && typeof env === 'object' && env.error) {
    return { ok: false, error: `${input.skill} JSON-RPC error ${env.error.code ?? '?'}: ${env.error.message ?? 'unknown'}` };
  }
  const parts = replyParts(env?.result);
  if (parts.length === 0) return { ok: false, error: `${input.skill} reply carried no message parts` };
  const decoded = decodeActReply(parts);
  if ('error' in decoded) return { ok: false, error: decoded.error };
  return { ok: true, output: decoded };
}

/**
 * Hand a finished round to somebody's adviser, and do not wait for an opinion about it.
 *
 * Deliberately returns nothing useful. A review is the card room telling an agent what happened at
 * its person's seat so the agent can remember it; there is no answer the table would act on, and a
 * reply that failed must not disturb a round that is already over.
 */
export async function callReview(base: string, input: ActInput, timeoutMs: number, env?: Env): Promise<void> {
  const url = a2aUrl(base, A2A_JSONRPC_PATH);
  try {
    // Serialised once; the signature binds these bytes. A review is the moment a personal coach
    // writes to its own memory, so it has to arrive with the card room's name on it like advice does.
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: `${input.tableId}:${input.handNo}:${input.seat}:review`,
      method: A2A_SEND_MESSAGE,
      params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: encodeAdviseParts(input) } },
    });
    const authorization = env ? await houseAuthorization(env, url, A2A_SEND_MESSAGE, raw) : null;
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(authorization ? { authorization } : {}) },
      body: raw,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // An adviser that is down, slow or uninterested costs nothing: the round is finished either way.
  }
}

export type AdviseResult = { ok: true; output: AdviseOutput } | { ok: false; error: string };

/**
 * Ask an agent what the person in a seat should do.
 *
 * The same JSON-RPC call as `callAct` with a different skill and a different reply shape — and the
 * difference matters more than the similarity. `act` hands a turn away; this asks for a sentence. An
 * agent that answers here has taken nobody's turn, and the card room applies nothing it returns.
 */
export async function callAdvise(base: string, input: AdviseInput, timeoutMs: number, deployment?: Env): Promise<AdviseResult> {
  const url = a2aUrl(base, A2A_JSONRPC_PATH);
  const body = {
    jsonrpc: '2.0',
    id: `${input.tableId}:${input.handNo}:${input.seat}:advise`,
    method: A2A_SEND_MESSAGE,
    // Data AND text: the house personas parse the data part; a person's own agent at their Home is
    // handed the text. One request that both kinds of adviser can read.
    params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: encodeAdviseParts(input) } },
  };
  // Serialised ONCE: the signature below binds these exact bytes, and the same string is what is sent.
  const raw = JSON.stringify(body);
  const authorization = deployment ? await houseAuthorization(deployment, url, A2A_SEND_MESSAGE, raw) : null;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // The card room's own name, for an agent that answers nobody it cannot name (a person's own
        // agent at their Home). The house personas get no header: they ask nobody's.
        ...(authorization ? { authorization } : {}),
      },
      body: raw,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, error: `${input.skill} call to ${url} failed: ${errText(e)}` };
  }
  if (!res.ok) return { ok: false, error: `${input.skill} call to ${url} returned ${res.status}` };
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: `${input.skill} reply from ${url} is not JSON` };
  }
  const env = payload as { error?: { code?: number; message?: string }; result?: unknown };
  if (env && typeof env === 'object' && env.error) {
    return { ok: false, error: `${input.skill} JSON-RPC error ${env.error.code ?? '?'}: ${env.error.message ?? 'unknown'}` };
  }
  const parts = replyParts(env?.result);
  if (parts.length === 0) return { ok: false, error: `${input.skill} reply carried no message parts` };
  const decoded = decodeAdviseReply(parts);
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
