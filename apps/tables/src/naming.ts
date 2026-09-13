/**
 * Turning an AGENT NAME into the person behind it.
 *
 * A host knows their friends by name. `carol.me` is a name in exactly the sense a person means it:
 * Carol chose it, it is hers on chain, and it resolves to her Smart Agent. Asking a host to go and
 * find a forty-character hex string before they can add her to their poker night is asking them to
 * do the registry's job by hand — which is the whole reason the registry exists.
 *
 * ONE READ, NO FALLBACK. `AgentNamingClient.resolveName` is a single `readContract` against the
 * universal resolver, and a name with no answer resolves to nobody. There is no log walk, no guess
 * at a similar name and no "assume it is an address if it looks like one" — a club roster row is an
 * authorization, and the wrong person on it is somebody who can sit at a private table.
 *
 * Configured entirely from `apps/tables` env, per the rule in CLAUDE.md: no address is written down
 * in a package, and a deployment with no registry configured says so rather than guessing.
 */

import { createPublicClient, http, keccak256, toBytes } from 'viem';
import { AgentNamingClient, isValidAgentName, normalizeAgentName } from '@agenticprimitives/agent-naming';
import type { Env } from './env.js';
import { chainId, rpcUrl } from './treasury.js';

/** A dotted agent name — at least two labels, so `carol.me` is one and `carol` is not. */
const NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Does this LOOK like an agent name?
 *
 * Shape only. It says which of the four things a host could have typed this is, so the caller can
 * route it; whether the name exists is a question for the chain, one call later.
 */
export function looksLikeAgentName(raw: string): boolean {
  const v = (raw ?? '').trim();
  if (!v || v.includes('@') || v.startsWith('0x')) return false;
  return NAME_RE.test(v) && isValidAgentName(v);
}

/** Whether this deployment can resolve names at all. False in a dev env with no registry wired. */
export function namingConfigured(env: Env): boolean {
  return Boolean(env.AGENT_NAME_REGISTRY && env.AGENT_NAME_UNIVERSAL_RESOLVER && env.RPC_URL);
}

export type NameAnswer = { ok: true; name: string; address: `0x${string}` } | { ok: false; error: string };

/**
 * Resolve an agent name to the address it names.
 *
 * Every refusal names the name. "carol.me is not a name this chain knows" is a sentence a host can
 * act on — they can check the spelling, or ask Carol what hers is; a bare 400 sends them to support.
 */
export async function resolveAgentName(env: Env, raw: string): Promise<NameAnswer> {
  const typed = (raw ?? '').trim();
  if (!namingConfigured(env)) {
    return { ok: false, error: 'this card room cannot look up agent names yet — add them by their Smart Agent address' };
  }
  let name: string;
  try {
    name = normalizeAgentName(typed);
  } catch {
    return { ok: false, error: `"${typed}" is not a well-formed agent name` };
  }
  const client = new AgentNamingClient({
    rpcUrl: rpcUrl(env),
    chainId: chainId(env),
    registry: env.AGENT_NAME_REGISTRY as `0x${string}`,
    universalResolver: env.AGENT_NAME_UNIVERSAL_RESOLVER as `0x${string}`,
  });
  let address: `0x${string}` | null;
  try {
    address = (await client.resolveName(name)) as `0x${string}` | null;
  } catch {
    // The chain is a dependency, not an authority on whether the person exists. Say which it was.
    return { ok: false, error: `the name registry could not be reached to look up ${name}` };
  }
  if (!address) return { ok: false, error: `${name} is not a name this chain knows — check the spelling with them` };
  return { ok: true, name, address };
}

/**
 * THE NAME OF AN AGENT, from its address — the other direction.
 *
 * Needed because the Home's `agent_name` claim is not always a handle: `nameClaimForIdToken` at the
 * Home falls back to the PROFILE name when the account has no handle, so a demo person arrives as
 * "Alice Okoro" while `alice.me` is right there on chain. The address is asserted by the id_token
 * and is the one thing a session can be sure of, so the name is read from the registry's own
 * reverse record rather than trusted from a field that may be a display string.
 *
 * `null` means the chain has no primary name for this address — not an error, and not a guess.
 */
export async function nameOfAgent(env: Env, address: string): Promise<string | null> {
  if (!namingConfigured(env) || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const client = new AgentNamingClient({
    rpcUrl: rpcUrl(env),
    chainId: chainId(env),
    registry: env.AGENT_NAME_REGISTRY as `0x${string}`,
    universalResolver: env.AGENT_NAME_UNIVERSAL_RESOLVER as `0x${string}`,
  });
  try {
    const name = await client.reverseResolve(address as `0x${string}`);
    return name && looksLikeAgentName(name) ? normalizeAgentName(name) : null;
  } catch {
    return null;
  }
}

/**
 * WHAT AN AGENT ANSWERS, FROM THE CHAIN — `atl:capabilities` on its profile, the record the Home's own
 * harness reads to decide which skills an agent answers. A RELEASED card is a snapshot: a person whose Home
 * just put the card room's skills on their agent still serves the card they released last month, and the
 * card room refused to name them "because the card does not advertise poker.coach" — the agent would have
 * answered it. The skills an agent advertises are the union of its served card and this record. Empty
 * when the chain cannot be read or the resolver is not configured; never a guess.
 */
export async function advertisedOnChain(env: Env, address: string): Promise<string[]> {
  const resolver = (env.AGENT_PROFILE_RESOLVER ?? '').trim();
  if (!env.RPC_URL || !/^0x[0-9a-fA-F]{40}$/.test(resolver) || !/^0x[0-9a-fA-F]{40}$/.test(address)) return [];
  try {
    const client = createPublicClient({ transport: http(rpcUrl(env)) });
    const raw = (await client.readContract({
      address: resolver as `0x${string}`,
      abi: [{ type: 'function', name: 'getStringProperty', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'string' }] }] as const,
      functionName: 'getStringProperty',
      args: [address as `0x${string}`, keccak256(toBytes('atl:capabilities'))],
    })) as string;
    return raw.split(',').map((x) => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** A typed name → its Smart Agent, through the registry. Null when it does not resolve. */
export async function addressOfAgent(env: Env, name: string): Promise<string | null> {
  if (!namingConfigured(env)) return null;
  const client = new AgentNamingClient({
    rpcUrl: rpcUrl(env),
    chainId: chainId(env),
    registry: env.AGENT_NAME_REGISTRY as `0x${string}`,
    universalResolver: env.AGENT_NAME_UNIVERSAL_RESOLVER as `0x${string}`,
  });
  try {
    const a = await client.resolveName(name);
    return a ? a.toLowerCase() : null;
  } catch {
    return null;
  }
}
