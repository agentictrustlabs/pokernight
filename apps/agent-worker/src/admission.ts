/**
 * WHO MAY DRIVE A HOUSE PERSONA — the card room, and nobody else.
 *
 * The personas answer `poker.act` / `canasta.act` for the tables worker. For a year the door admitted every
 * caller ("phase 2: no admission"), which was harmless while every persona was rules-based and a real risk the
 * moment one spent language-model tokens. Now, on a deployment that names the chain, the door admits only the
 * HOUSE: an `A2A-Session` assertion the tables worker signs with its session key over the house wire — the same
 * credential it presents to a person's own agent — verified here exactly as a Home verifies it (wire shape,
 * signature against the house account's ERC-1271, unrevoked on chain, audience = this origin, body bound,
 * ≤120 s old) and then required to BE the house service agent.
 *
 * Verification is memoised by wire digest for a minute: one on-chain pair of reads per wire per minute rather
 * than per turn. The assertion itself is still checked on every request (it binds the body). Replay protection
 * is per isolate (no shared ledger here); the audience, body and age bounds leave a captured assertion worth
 * one identical move for two minutes, which a seat cannot profit from.
 */
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { hashDelegation, type Delegation } from '@agenticprimitives/delegation';
import { sessionWirePrincipal, type Principal } from '@agenticprimitives/a2a/standard';
import type { Env } from './env.js';

const isAddr = (v: string | undefined): v is string => !!v && /^0x[0-9a-fA-F]{40}$/.test(v);

/** The deployment names everything admission needs — otherwise the door stays open (dev, tests). */
export function admissionConfigured(env: Env): boolean {
  return Boolean((env.RPC_URL ?? '').trim() && (env.CHAIN_ID ?? '').trim() && isAddr(env.UNIVERSAL_SIGNATURE_VALIDATOR) && isAddr(env.DELEGATION_MANAGER) && isAddr(env.TIMESTAMP_ENFORCER) && isAddr(env.ALLOWED_METHODS_ENFORCER) && isAddr(env.HOUSE_SERVICE_SA));
}

const VALIDATOR_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
const REVOKED_ABI = [{ type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] }] as const;

const verified = new Map<string, { at: number; ok: boolean }>();
const VERIFY_MEMO_MS = 60_000;

let announced = false;

/** The `principal` for the A2A server, or undefined when admission is not configured (the door stays open). */
export function housePrincipal(env: Env): ((request: Request) => Promise<Principal | null>) | undefined {
  if (!admissionConfigured(env)) {
    if (!announced) { announced = true; console.warn('[agent-worker] ADMISSION OFF — the A2A door admits every caller (no chain configuration)'); }
    return undefined;
  }
  const client = createPublicClient({ transport: http((env.RPC_URL as string).trim()) });
  const chainId = Number(env.CHAIN_ID);
  const dm = (env.DELEGATION_MANAGER as string).trim() as Address;
  const validator = (env.UNIVERSAL_SIGNATURE_VALIDATOR as string).trim() as Address;
  const house = (env.HOUSE_SERVICE_SA as string).trim().toLowerCase();
  const remembered = async (d: Delegation, check: () => Promise<boolean>): Promise<boolean> => {
    const key = hashDelegation(d, chainId, dm);
    const hit = verified.get(key);
    if (hit && Date.now() - hit.at < VERIFY_MEMO_MS) return hit.ok;
    const ok = await check();
    // ONLY A YES IS REMEMBERED. A chain read that failed for a moment answered "no", and a remembered "no"
    // refused the house for a minute — long enough for the table to sit its bots out (seen live, 2026-09-13).
    if (ok) verified.set(key, { at: Date.now(), ok });
    return ok;
  };
  const wire = sessionWirePrincipal({
    enforcers: { timestamp: (env.TIMESTAMP_ENFORCER as string).trim(), allowedMethods: (env.ALLOWED_METHODS_ENFORCER as string).trim() },
    verifyDelegationSig: (d) => remembered(d, async () => (await client.readContract({ address: validator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [d.delegator as Address, hashDelegation(d, chainId, dm) as Hex, d.signature as Hex] }).catch(() => false)) === true),
    // Revocation is asked fresh each time it is asked at all — a revoke must bite within the minute, so it
    // shares the memo's window but not its answer: the memo above is only for the signature.
    isRevoked: async (d) => (await client.readContract({ address: dm, abi: REVOKED_ABI, functionName: 'isRevoked', args: [hashDelegation(d, chainId, dm) as Hex] }).catch(() => true)) === true,
    onRefused: (reason, who) => console.warn(`[agent-worker] refused ${who ?? '?'}: ${reason}`),
  });
  return async (request: Request): Promise<Principal | null> => {
    const p = await wire(request);
    if (!p) return null;
    // Admitted as SOMEBODY is not enough: the personas answer the house and the house alone.
    if (p.agent.toLowerCase() !== house) { console.warn(`[agent-worker] refused ${p.agent}: not the house`); return null; }
    return p;
  };
}
