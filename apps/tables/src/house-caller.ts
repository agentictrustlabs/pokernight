/**
 * THE CARD ROOM, NAMING ITSELF — the `Authorization` a Home agent needs before it will answer.
 *
 * A Home agent's standard A2A surface admits two callers: a person's own Home session bearer, or an
 * agent signing with a session wire (spec 350 §8, spec 372 S3c). The card room holds no person's bearer.
 * So when it asks somebody's own agent for advice, it asks AS ITS OWN AGENT: the house service Smart
 * Agent, signing each request with a session key that the custodian delegated to it once, offline
 * (`scripts/mint-house-wire.mts`). The Home verifies every leg on chain per request — delegator, window,
 * pinned selector, the session key recovering, the wire's own signature, and revocation.
 *
 * WHAT IS SIGNED. The assertion binds the method, the exact body bytes, the host and the moment, and the
 * Home spends it once — so a captured request cannot be replayed onto another body, another agent, or
 * later. The body hash is over the RAW string sent, never over a re-serialisation.
 *
 * WHEN IT IS NOT SENT. The house personas live on this deployment's own worker and ask nobody's name;
 * signing calls to them would be ceremony for its own sake. Only a call leaving the house carries this.
 */

import { privateKeyToAccount } from 'viem/accounts';
import { wrapSessionSignature, type DelegationWireV1 } from '@agenticprimitives/a2a';
import { callerAssertionDigest, requestBodyHash, sessionAuthorizationHeader, type CallerAssertionV1 } from '@agenticprimitives/a2a/standard';
import type { Env } from './env.js';

/** Whether this deployment can name itself at all. */
export function houseCallerConfigured(env: Env): boolean {
  return Boolean((env.HOUSE_A2A_WIRE ?? '').trim() && (env.HOUSE_A2A_SESSION_KEY ?? '').trim());
}

/** Whether `url` is the house's own agent worker, which needs no name. */
export function isHouseUrl(env: Env, url: string): boolean {
  const base = (env.AGENT_BASE_URL ?? '').trim();
  if (!base) return false;
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * The `Authorization` header for one request, or null when it should go out unsigned.
 *
 * `raw` is the exact body string that will be sent. Signing anything else — the object before it was
 * serialised, a pretty-printed copy — produces a hash the Home cannot match, and a refusal that says
 * only "refused".
 */
export async function houseAuthorization(env: Env, url: string, method: string, raw: string): Promise<string | null> {
  // THE HOUSE PERSONAS ARE NAMED TO AS WELL (2026-09-13): their door admits only the house now, so a turn
  // sent to `agents.faithnet.io` carries the same assertion a person's agent gets. `isHouseUrl` stays for
  // a dev deployment with no wire, where the door is open and the header would be noise.
  if (!houseCallerConfigured(env)) return null;
  void isHouseUrl;
  let wire: DelegationWireV1;
  try {
    wire = JSON.parse(env.HOUSE_A2A_WIRE as string) as DelegationWireV1;
  } catch {
    return null;
  }
  const session = privateKeyToAccount((env.HOUSE_A2A_SESSION_KEY as string).trim() as `0x${string}`);
  const unsigned: Omit<CallerAssertionV1, 'signature'> = {
    agent: wire.delegator.toLowerCase(),
    method,
    bodyHash: requestBodyHash(raw),
    issuedAt: Math.floor(Date.now() / 1000),
    audience: new URL(url).origin,
  };
  // Raw-digest ECDSA by the session key, wrapped with the wire that authorises it. The Home recovers
  // the key from the digest, checks it is the wire's delegate, and checks the wire against the house
  // agent's own ERC-1271 — the custodian's signature, made once.
  const sig = await session.sign({ hash: callerAssertionDigest(unsigned) });
  return sessionAuthorizationHeader({ ...unsigned, signature: wrapSessionSignature(wire, sig) });
}
