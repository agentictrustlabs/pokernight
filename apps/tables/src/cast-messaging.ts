/**
 * A CHARACTER'S WHISPER IS A DIRECT MESSAGE FROM ITS OWN AGENT — the card room as each cast agent's runtime.
 *
 * WHAT A WHISPER IS. In both games a whisper is private and 1:1 — exactly the shape of a direct message between
 * two agents at their Homes. Sending it over A2A puts Ilse's words in Teodor's inbox UNDER ILSE'S NAME, where the
 * person custodying Teodor (or the person playing him tonight, at their own Home) reads it beside every other
 * message they have. The transcript in the room is unchanged; this is the same line arriving where a person
 * actually looks.
 *
 * WHY THE HOUSE CANNOT SEND IT. `messaging.direct.send` runs only AS the agent whose run it is: asked as the
 * house, the character's harness refuses ("a direct message is sent as you, and there is no signed-in person on
 * this run"). And the recipient's delivery door (`messaging.deliver`, on the agent's own subdomain) is behind the
 * estate's gateway assertion, which this Worker does not hold and must not. So the card room asks the CHARACTER'S
 * OWN AGENT, on the standard surface, as the character — spec 400 W2a, an outside runtime as the agent's own:
 *
 *   · the ASK WIRE (character → this Worker's session key, `harness.ask`) makes the card room the character's
 *     principal-by-wire, so the run is the agent's own;
 *   · the run parks AUTH_REQUIRED naming exactly what it needs (the capability, the recipient, an intent digest);
 *   · the card room DERIVES that mandate from the STANDING GRANT the custodian signed once (character → session
 *     key, `messaging.direct.send`, bounded to the cast and the players, no intent binding), signs the child with
 *     its own key and continues the same task presenting [child, standing];
 *   · the character's harness verifies every link where it is used, and the message leaves on the character's
 *     own messaging rail — the sender's copy and the recipient's copy in one conversation.
 *
 * Both delegations arrive already signed, in `CAST_MESSAGING` (minted by the estate's `equip-cast-messaging.mts`
 * with each custodian's own credential); this Worker can only spend them inside their caveats, and a custodian
 * revokes either on chain without a redeploy. A part played by a PERSON has no entry here: what they whisper they
 * typed themselves, and a message sent in their name would be the forgery this whole arrangement exists to refuse.
 *
 * The ask, the derivation and the continuation are `@agenticprimitives/runtime-member`'s own steps — the same road a
 * hosted runtime member walks, because that is what the card room is here (see the note on the helpers below).
 */
import type { TaskV1 } from '@agenticprimitives/a2a/standard';
import type { DelegationWireV1 } from '@agenticprimitives/a2a';
import { CAPABILITY_RAR_TYPE, DEFAULT_SUBSET_HANDLERS, deriveMandate, hashDelegation, ROOT_AUTHORITY, type Delegation, type MandateRequirementV1 } from '@agenticprimitives/delegation';
import { sign } from 'viem/accounts';
import { toHex, type Address, type Hex } from 'viem';
import { wireAuthorization } from './house-caller.js';
import type { Env } from './env.js';

/*
 * THE HELPERS BELOW ARE `@agenticprimitives/runtime-member`'s (`standing.ts`, `client.ts`), carried here rather than
 * imported: that package's index pulls in its keystore (node:os) and its CLI, which a Worker cannot load, and its
 * subpaths were not exported at 0.0.0-alpha.2. When a pin arrives with `./standing` and `./client` exported, these
 * go and the imports come back. The shapes are kept identical on purpose.
 */

/** Spec 400 W2a — the OPEN MANDATE as the estate records it: member → the runtime's key, named capabilities, no intent binding. */
export interface StandingGrantV1 {
  v: 1;
  wire: Record<string, unknown>;
  ref: Hex;
  requirement: Omit<MandateRequirementV1, 'intentDigest'>;
  enforcers: { timestamp: Address; allowedMethods: Address; value: Address; allowedTargets: Address; digestBinding: Address };
  chainId: number;
  delegationManager: Address;
  grantedAt: string;
}
/** What a parked run said it needs — read off the AUTH_REQUIRED task's data part. */
export interface ParkedNeed { requirement: MandateRequirementV1; delegator: Address; delegate: Address }
export function parkedNeedOf(data: unknown): ParkedNeed | null {
  const d = data as { requirement?: MandateRequirementV1; delegator?: string; delegate?: string } | undefined;
  if (!d?.requirement || typeof d.requirement !== 'object' || !d.delegator || !d.delegate) return null;
  if (typeof d.requirement.intentDigest !== 'string' || !Array.isArray(d.requirement.actions)) return null;
  return { requirement: d.requirement, delegator: d.delegator as Address, delegate: d.delegate as Address };
}
export type Signer = (digest: Hex) => Promise<Hex>;
export type Derived = { ok: true; presented: Array<Record<string, unknown>>; childRef: Hex } | { ok: false; reason: string };
/** The child for THIS intent, from the standing grant, signed with the runtime's key — or why not. The run's need must be an
 *  act OF the member (delegator = the member) and ⊆ the grant; anything else stays parked for the steward. */
export async function deriveForNeed(standing: StandingGrantV1, need: ParkedNeed, member: Address, signer: Signer): Promise<Derived> {
  if (need.delegator.toLowerCase() !== member.toLowerCase()) return { ok: false, reason: `the run needs an act of ${need.delegator}, not of ${member}` };
  if (need.requirement.type !== CAPABILITY_RAR_TYPE) return { ok: false, reason: `the run needs a ${need.requirement.type} mandate; the standing grant is a capability` };
  const parent = { ...standing.wire, salt: BigInt(String(standing.wire.salt)) } as unknown as Delegation;
  const salt = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
  // The child's window is the run's need CLAMPED into the grant's; a child may never outlive its parent.
  const validAfter = Math.max(need.requirement.validAfter ?? 0, standing.requirement.validAfter ?? 0);
  const validUntil = Math.min(need.requirement.validUntil, standing.requirement.validUntil);
  const now = Math.floor(Date.now() / 1000);
  if (validAfter > now || validUntil <= now) return { ok: false, reason: `the standing grant's window (until ${new Date(standing.requirement.validUntil * 1000).toISOString().slice(0, 16)}) does not cover now` };
  const out = deriveMandate({
    parent, parentRequirement: { ...standing.requirement, intentDigest: need.requirement.intentDigest } as MandateRequirementV1,
    requirement: { ...need.requirement, validAfter, validUntil }, grantee: need.delegate, enforcers: standing.enforcers as never, chainId: standing.chainId, delegationManager: standing.delegationManager, salt,
    handlers: DEFAULT_SUBSET_HANDLERS,
  });
  if (!out.ok) return { ok: false, reason: out.reason };
  const signature = await signer(out.digest);
  const child = { ...out.delegation, signature, salt: salt.toString() };
  return { ok: true, presented: [child as unknown as Record<string, unknown>, standing.wire], childRef: out.digest };
}
/** The check `deriveForNeed`'s test relies on: a standing grant's ref IS the hash of its wire. */
export const standingRef = (standing: StandingGrantV1): Hex => hashDelegation({ ...standing.wire, salt: BigInt(String(standing.wire.salt)) } as unknown as Delegation, standing.chainId, standing.delegationManager);
void ROOT_AUTHORITY;

export interface AskOutcome { text: string; state: string; taskId?: string; runRef?: string; parked: boolean; data?: unknown }
/** The structured answer a run returns: the `results` artifact's first step result, else a data part on the status message. */
function dataOf(task: TaskV1 | undefined): unknown {
  if (!task) return undefined;
  const results = task.artifacts?.find((a) => a.name === 'results');
  const rows = results?.parts?.[0]?.data as Array<{ toolId?: string; result?: unknown }> | undefined;
  if (Array.isArray(rows) && rows.length) return rows.length === 1 ? rows[0]!.result : rows.map((r) => r.result);
  for (const p of task.status?.message?.parts ?? []) {
    if (p.data !== undefined && !(typeof p.data === 'object' && p.data && (p.data as { kind?: string }).kind === 'ap.flow-trace.v1')) return p.data;
  }
  return undefined;
}
const outcomeOf = (text: string, task: TaskV1 | undefined, fallback: string): AskOutcome => {
  const state = task?.status?.state ?? fallback;
  const data = dataOf(task);
  return { text, state, ...(task?.id ? { taskId: task.id } : {}), ...(typeof task?.metadata?.runRef === 'string' ? { runRef: task.metadata.runRef as string } : {}), parked: state === 'TASK_STATE_AUTH_REQUIRED' || state === 'TASK_STATE_INPUT_REQUIRED', ...(data !== undefined ? { data } : {}) };
};
const TERMINAL = new Set(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_REJECTED', 'TASK_STATE_CANCELED']);

/**
 * A client addressed at ONE agent by name on the standard surface, signing EVERY request as the wire's delegator
 * with this Worker's key. Written here rather than `createStandardA2aClient` because the pinned a2a (alpha.22) has
 * no `signRequest` — an option it silently drops, which sent the first version of this unsigned and got
 * "admits only an authenticated principal" (2026-09-17). The assertion is over the exact bytes sent.
 */
interface Client { sendMessage(parts: Array<{ text: string }>, opts?: { taskId?: string; metadata?: Record<string, unknown> }): Promise<{ task?: TaskV1; message?: { parts?: Array<{ text?: string }> } }>; getTask(id: string): Promise<TaskV1>; awaitTask(id: string, timeoutMs: number): Promise<TaskV1> }
function clientAs(edge: string, name: string, wire: DelegationWireV1, key: Hex, fetchImpl: typeof fetch = fetch): Client {
  const endpoint = `${edge}/api/a2a/${name}`;
  let seq = 0;
  const rpc = async <T,>(method: string, params: unknown): Promise<T> => {
    const raw = JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params });
    const authorization = await wireAuthorization(wire, key, endpoint, method, raw);
    const res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'a2a-version': '1.0', authorization }, body: raw });
    const body = (await res.json().catch(() => null)) as { result?: T; error?: { code: number; message: string } } | null;
    if (!body) throw new Error(`${endpoint} answered ${res.status} with no JSON-RPC body`);
    if (body.error) throw new Error(`${endpoint} ${method}: ${body.error.code} ${body.error.message}`);
    return body.result as T;
  };
  const hex32 = () => `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const client: Client = {
    sendMessage: (parts, opts) => rpc('SendMessage', { message: { messageId: hex32(), role: 'ROLE_USER', parts, ...(opts?.taskId ? { taskId: opts.taskId } : {}), ...(opts?.metadata ? { metadata: opts.metadata } : {}) } }),
    getTask: (id) => rpc<TaskV1>('GetTask', { id }),
    async awaitTask(id, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let last = await client.getTask(id);
      while (!TERMINAL.has(last.status.state) && last.status.state !== 'TASK_STATE_INPUT_REQUIRED' && last.status.state !== 'TASK_STATE_AUTH_REQUIRED' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        last = await client.getTask(id);
      }
      return last;
    },
  };
  return client;
}
const textOf = (t?: TaskV1, m?: { parts?: Array<{ text?: string }> }): string => {
  const out: string[] = [];
  const take = (ps?: Array<{ text?: string }>) => { for (const p of ps ?? []) if (typeof p.text === 'string' && p.text.trim()) out.push(p.text.trim()); };
  take(m?.parts); take(t?.status?.message?.parts); for (const a of t?.artifacts ?? []) take(a.parts);
  return out.join('\n');
};

export interface CastMessagingPart {
  /** The agent's typed name — the endpoint on the standard surface is `<edge>/api/a2a/<name>`. */
  name: string;
  sa: Address;
  role: string;
  character: string;
  /** The ask wire: character → this Worker's session key, `harness.ask` only. */
  wire: Record<string, unknown>;
  /** The open mandate: character → this Worker's session key, `messaging.direct.send`, no intent binding. */
  standing: StandingGrantV1;
}
export interface CastMessaging {
  sessionKey: Address;
  chainId: number;
  edge: string;
  parts: Record<string, CastMessagingPart>;
}

/** Parse the note as the estate wrote it; null when it is not one. */
export function parseCastMessaging(raw: string): CastMessaging | null {
  try {
    const p = JSON.parse(raw) as { sessionKey?: string; chainId?: number; edge?: string; parts?: Record<string, Omit<CastMessagingPart, 'name'>> };
    if (!p.sessionKey || !p.edge || !p.parts) return null;
    const parts: Record<string, CastMessagingPart> = {};
    for (const [name, part] of Object.entries(p.parts)) {
      if (!part?.sa || !part.wire || !part.standing) continue;
      parts[name] = { ...part, name, sa: part.sa.toLowerCase() as Address };
    }
    return { sessionKey: p.sessionKey as Address, chainId: Number(p.chainId ?? 0), edge: p.edge.replace(/\/$/, ''), parts };
  } catch {
    return null;
  }
}

/** KV, because the note is thirty kilobytes of signed delegations and a Worker secret holds five — the same
 *  namespace the club wires live in, since this is the same kind of thing: a wire the card room was handed. */
export const CAST_MESSAGING_KEY = 'cast-messaging';
let cached: { at: number; value: CastMessaging | null } | null = null;
const CACHE_MS = 60_000;

/** What this deployment holds; null when messaging is not configured (a night then keeps every whisper in the room).
 *  `CAST_MESSAGING` in the environment wins (dev, tests); otherwise KV, read at most once a minute per isolate. */
export async function castMessaging(env: Pick<Env, 'CAST_MESSAGING' | 'HOUSE_A2A_SESSION_KEY' | 'CLUB_WIRES'>): Promise<CastMessaging | null> {
  if (!(env.HOUSE_A2A_SESSION_KEY ?? '').trim()) return null;
  const inline = (env.CAST_MESSAGING ?? '').trim();
  if (inline) return parseCastMessaging(inline);
  if (!env.CLUB_WIRES) return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const raw = await env.CLUB_WIRES.get(CAST_MESSAGING_KEY);
  cached = { at: Date.now(), value: raw ? parseCastMessaging(raw) : null };
  return cached.value;
}

/** Who a cast entry's agent is as an ADDRESS a message can go to: a cast persona (by name), or a person's own agent (`home:<sa>`). */
export function recipientAddress(cm: CastMessaging, agent: string): Address | null {
  const part = cm.parts[agent];
  if (part) return part.sa;
  const m = agent.match(/^home:(0x[0-9a-fA-F]{40})$/);
  if (m) return m[1]!.toLowerCase() as Address;
  if (/^0x[0-9a-fA-F]{40}$/.test(agent)) return agent.toLowerCase() as Address;
  return null;
}

export interface WhisperToCarry { key: string; from: CastMessagingPart; toSa: Address; toName: string; text: string }

/**
 * WHICH WHISPERS GO OVER A2A, AND BETWEEN WHOM. THE CHARACTER IS THE IDENTITY (2026-09-17): a whisper to Dr Wren
 * belongs in Dr Wren's inbox — the part's own persona agent — whoever is playing her tonight; the person reads it at
 * their Home AS that persona. The first version routed a person-played part to the person's own agent, which put a
 * character's mail in alice.me's inbox, and that was wrong: the game addresses characters, never players.
 *
 * So both ends resolve through `personaOf(role)` — the part's STANDING agent from the deployment's cast list,
 * unchanged by a takeover — and the cast entry's `agent` only when a role has no persona at all (a person's own agent
 * playing a part nobody was chartered for). A speaker with no persona in the note stays in the room. Pure.
 */
export function whispersToCarry(
  log: ReadonlyArray<{ type: string }>,
  cast: ReadonlyArray<{ role: string; agent: string; name?: string }>,
  cm: CastMessaging,
  carried: ReadonlySet<string>,
  personaOf: (role: string) => string | null = () => null,
): WhisperToCarry[] {
  const out: WhisperToCarry[] = [];
  const agentOf = (role: string): string | null => personaOf(role) ?? cast.find((c) => c.role === role)?.agent ?? null;
  for (const raw of log) {
    // Both games' `whispered` events carry the same four fields; the union types differ elsewhere, so narrow here.
    const e = raw as { type: string; at?: number; by?: string; to?: string; text?: string };
    if (e.type !== 'whispered' || !e.by || !e.to || !e.text || typeof e.at !== 'number') continue;
    const key = `${e.at}:${e.by}:${e.to}:${e.text.length}`;
    if (carried.has(key)) continue;
    const speaker = agentOf(e.by);
    const hearer = agentOf(e.to);
    if (!speaker || !hearer) continue;
    const from = cm.parts[speaker];
    const toSa = recipientAddress(cm, hearer);
    if (!from || !toSa || toSa === from.sa) continue;
    out.push({ key, from, toSa, toName: cast.find((c) => c.role === e.to)?.name ?? e.to, text: e.text });
  }
  return out;
}

export type WhisperResult = { ok: true; state: string } | { ok: false; error: string };

/** The character's agent, asked to send — and the mandate derived and presented when it parks for one. */
export async function whisperAs(
  env: Pick<Env, 'HOUSE_A2A_SESSION_KEY'>,
  cm: CastMessaging,
  from: CastMessagingPart,
  toSa: Address,
  toName: string,
  text: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<WhisperResult> {
  const key = (env.HOUSE_A2A_SESSION_KEY ?? '').trim() as Hex;
  if (!key) return { ok: false, error: 'no session key' };
  const signer: Signer = (digest) => sign({ hash: digest, privateKey: key, to: 'hex' });
  const client = clientAs(cm.edge, from.name, from.wire as unknown as DelegationWireV1, key, opts.fetch);
  const plan = { steps: [{ toolId: 'messaging.direct.send', args: { recipient: toSa, message: text } }] };
  const timeoutMs = opts.timeoutMs ?? 60_000;
  try {
    // 1. the ask, with the plan supplied (spec 400 W1: a deterministic step costs no planner turn)
    const sent = await client.sendMessage([{ text: `Whisper to ${toName}: ${text}` }], { metadata: { plan } });
    const task0 = sent.task && !TERMINAL.has(sent.task.status.state) ? await client.awaitTask(sent.task.id, timeoutMs) : sent.task;
    const first = outcomeOf(textOf(task0, sent.message), task0, sent.message ? 'MESSAGE' : 'UNKNOWN');
    if (first.state === 'TASK_STATE_COMPLETED') return { ok: true, state: first.state };
    if (!first.parked || !first.taskId) return { ok: false, error: `${first.state}: ${first.text.slice(0, 200)}` };
    // 2. the need it parked on, and the mandate for exactly that, derived from the standing grant
    const need = parkedNeedOf(first.data);
    if (!need) return { ok: false, error: `parked without saying what it needs: ${first.text.slice(0, 200)}` };
    const derived = await deriveForNeed(from.standing, need, from.sa, signer);
    if (!derived.ok) return { ok: false, error: `the standing grant does not cover this: ${derived.reason}` };
    // 3. the same task continued, presenting [child, standing]; the harness verifies the chain where it is used
    const cont = await client.sendMessage([{ text: 'continuing under the standing grant' }], { taskId: first.taskId, metadata: { presented: derived.presented } });
    const task = cont.task && !TERMINAL.has(cont.task.status.state) ? await client.awaitTask(cont.task.id, timeoutMs) : cont.task;
    const second = outcomeOf(textOf(task), task, 'UNKNOWN');
    if (second.state === 'TASK_STATE_COMPLETED') return { ok: true, state: second.state };
    return { ok: false, error: `${second.state}: ${second.text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
