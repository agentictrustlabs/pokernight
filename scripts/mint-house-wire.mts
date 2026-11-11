/**
 * MINT THE HOUSE'S A2A SESSION WIRE — how the card room speaks to a person's own agent.
 *
 * A Home agent answers nobody it cannot name. Its standard A2A surface admits two callers: a person's
 * Home session bearer, or an AGENT signing with a session wire. The card room holds no person's bearer
 * (sign-in gives it an id_token and a buy-in delegation, not a session), so when it asks somebody's own
 * agent for advice it must ask AS ITS OWN AGENT — the house service Smart Agent in `house.faithchain.json`.
 *
 * WHY A WIRE AND NOT THE CUSTODIAN KEY. `apps/tables/src/treasury.ts` states the rule: the custodian key
 * signs userOpHashes and nothing else. Signing A2A calls with it would widen what that key does and put
 * it on every request. The estate's design for exactly this (spec 350 §8) is a NARROW delegation, signed
 * once by the custodian here, offline: delegator = the house service agent, delegate = a session key
 * that only this Worker holds, pinned to the ONE selector the standard surface accepts (`harness.ask`),
 * timestamp-bounded. The Worker then signs each request with the session key, wraps it with the wire,
 * and the Home verifies every leg on chain — including revocation, so the custodian can kill it at any
 * time without redeploying anything.
 *
 * What comes out:
 *   .house-a2a-session.json   the session key (gitignored, mode 0600) — `wrangler secret put
 *                             HOUSE_A2A_SESSION_KEY --env faithnet` with its `privateKey`
 *   stdout                    the wire, one line of JSON — `wrangler secret put HOUSE_A2A_WIRE --env faithnet`
 *
 *   npx tsx scripts/mint-house-wire.mts [--days 90] [--rotate]
 *
 * `--rotate` makes a fresh session key even when one exists. Without it, an existing key is reused so a
 * re-mint (a longer window, say) does not force a second secret update.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { ROOT_AUTHORITY, buildCaveat, encodeAllowedMethodsTerms, encodeTimestampTerms, hashDelegation, type Delegation } from '@agenticprimitives/delegation';
import { delegationToWire, skillSelector } from '@agenticprimitives/a2a';
import { STANDARD_SURFACE_SKILL } from '@agenticprimitives/a2a/standard';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/faithchain';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d; };
const DAYS = Number(flag('days', '90'));
const ROTATE = args.includes('--rotate');
// `--as registry`: the SAME session key, delegated by the MISSION REGISTRY's operator agent instead of the
// house service agent — how the card room signs registration receipts and the lifecycle log AS the registry
// (docs/MISSION-REGISTRY.md §2). Secret `MISSIONS_REGISTRY_WIRE`.
const AS = flag('as', 'house');
if (AS !== 'house' && AS !== 'registry') throw new Error('--as must be house or registry');

const house = JSON.parse(readFileSync(resolve(REPO, 'house.faithchain.json'), 'utf8')) as {
  chainId: number; houseServiceSa: Address; missionsRegistrySa?: Address; houseCustodian: Address; contracts: { delegationManager: Address };
};
const delegatorSa = AS === 'registry' ? house.missionsRegistrySa : house.houseServiceSa;
if (!delegatorSa) throw new Error('house.faithchain.json names no missionsRegistrySa — run provision:missions-registry first');
const SECRET_NAME = AS === 'registry' ? 'MISSIONS_REGISTRY_WIRE' : 'HOUSE_A2A_WIRE';
const deployments = CONTRACTS as unknown as Record<string, string>;
const enforcers = { timestamp: deployments.timestampEnforcer as Address, allowedMethods: deployments.allowedMethodsEnforcer as Address };
if (!enforcers.timestamp || !enforcers.allowedMethods) throw new Error('deployments-faithchain.json names no timestamp/allowedMethods enforcer');

// THE CUSTODIAN, read and never printed.
const keyFile = process.env.HOUSE_KEY_FILE ?? resolve(REPO, '.house-key.json');
const custodian = privateKeyToAccount((JSON.parse(readFileSync(keyFile, 'utf8')) as { privateKey: Hex }).privateKey);
if (custodian.address.toLowerCase() !== house.houseCustodian.toLowerCase()) {
  throw new Error(`${keyFile} is ${custodian.address}, but house.faithchain.json says the custodian is ${house.houseCustodian}`);
}

// THE SESSION KEY — the only thing the Worker will hold. Reused unless told to rotate.
const sessionFile = resolve(REPO, '.house-a2a-session.json');
const hadKey = existsSync(sessionFile);
let sessionKey: Hex;
if (!ROTATE && hadKey) {
  sessionKey = (JSON.parse(readFileSync(sessionFile, 'utf8')) as { privateKey: Hex }).privateKey;
} else {
  sessionKey = generatePrivateKey();
  writeFileSync(sessionFile, JSON.stringify({ privateKey: sessionKey, _note: 'The house A2A session key. HOUSE_A2A_SESSION_KEY secret. Never commit.' }, null, 2) + '\n');
  chmodSync(sessionFile, 0o600);
}
const session = privateKeyToAccount(sessionKey);

// THE WIRE. Pinned to the one selector the standard surface will accept, and to a window.
const now = Math.floor(Date.now() / 1000);
const validUntil = now + DAYS * 86_400;
const salt = BigInt(`0x${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')}`);
const leaf: Delegation = {
  delegator: delegatorSa,
  delegate: session.address,
  authority: ROOT_AUTHORITY,
  caveats: [
    buildCaveat(enforcers.timestamp, encodeTimestampTerms(0, validUntil)),
    buildCaveat(enforcers.allowedMethods, encodeAllowedMethodsTerms([skillSelector(STANDARD_SURFACE_SKILL)])),
  ],
  salt,
  signature: '0x',
};
const digest = hashDelegation(leaf, house.chainId, house.contracts.delegationManager);
// The house service agent's ERC-1271 accepts its custodian's ECDSA over a raw digest — the same way the
// custodian signs a userOpHash for it. Signed here, once, and the key goes back in its file.
leaf.signature = await custodian.sign({ hash: digest });
const wire = delegationToWire(leaf);

console.error(`${AS === 'registry' ? 'registry operator   ' : 'house service agent '} ${delegatorSa}`);
console.error(`session key          ${session.address}  (${ROTATE || !hadKey ? 'new' : 'reused'} — ${sessionFile})`);
console.error(`pinned to            ${STANDARD_SURFACE_SKILL}`);
console.error(`valid until          ${new Date(validUntil * 1000).toISOString()} (${DAYS} days)`);
console.error('');
console.error('Now:');
console.error(`  cd apps/tables && wrangler secret put HOUSE_A2A_SESSION_KEY --env faithnet   # paste privateKey from ${sessionFile}`);
console.error(`  cd apps/tables && wrangler secret put ${SECRET_NAME} --env faithnet          # paste the line below`);
console.error('');
console.log(JSON.stringify(wire));
