/**
 * Where the money layer meets this deployment's configuration.
 *
 * `@pokernight/treasury` names no host, chain or address on purpose, so SOMETHING has to read
 * `wrangler.toml` and the secrets and hand it the real ones. That is this file, and only this file:
 * everywhere else in the Worker asks for a client and gets either a working one or a sentence
 * naming the variable that is missing.
 *
 * Two shapes of client, because they need different things:
 *   readOnlyTreasury(env)  balances, custody checks. No key. Works wherever ASSET is configured.
 *   custodialTreasury(env) moves money. Needs HOUSE_CUSTODIAN_KEY, a secret, never a var.
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { createTreasuryClient, type TreasuryClient, type TreasuryDeployments } from '@pokernight/treasury';
import type { Env } from './env.js';

/** A configuration failure that names the variable a human has to set. */
export class TreasuryConfigError extends Error {
  constructor(readonly missing: string, message: string) {
    super(message);
    this.name = 'TreasuryConfigError';
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function isAddress(v: string | null | undefined): v is string {
  return typeof v === 'string' && ADDRESS_RE.test(v.trim());
}

function addr(env: Env, key: keyof Env, why: string): `0x${string}` {
  const v = (env[key] as string | undefined)?.trim() ?? '';
  if (!ADDRESS_RE.test(v)) {
    throw new TreasuryConfigError(String(key), `${String(key)} is not set to an address, so ${why}`);
  }
  return v as `0x${string}`;
}

export function chainId(env: Env): number {
  const n = Number(env.CHAIN_ID);
  if (!Number.isInteger(n) || n <= 0) {
    throw new TreasuryConfigError('CHAIN_ID', `CHAIN_ID is "${env.CHAIN_ID}", which is not a chain id`);
  }
  return n;
}

/** Asset base units per chip. `10000` = 0.01 USDC per chip at 6 decimals. */
export function chipValue(env: Env): bigint {
  const raw = (env.CHIP_VALUE ?? '').trim();
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new TreasuryConfigError('CHIP_VALUE', `CHIP_VALUE is "${env.CHIP_VALUE}", which is not a positive integer of asset base units`);
  }
  return BigInt(raw);
}

export function rpcUrl(env: Env): string {
  const v = (env.RPC_URL ?? '').trim();
  if (!v) throw new TreasuryConfigError('RPC_URL', 'RPC_URL is not set, so the card room cannot reach the chain');
  return v;
}

/** The contract set both client shapes need. Buy-in-only addresses are read separately. */
export function deployments(env: Env): TreasuryDeployments {
  const base: TreasuryDeployments = {
    asset: addr(env, 'ASSET', 'the card room does not know which token it settles in'),
    entryPoint: addr(env, 'ENTRY_POINT', 'a Smart Agent UserOp cannot be built'),
    agentAccountFactory: addr(env, 'AGENT_ACCOUNT_FACTORY', 'a Smart Agent address cannot be derived'),
    paymaster: addr(env, 'SMART_AGENT_PAYMASTER', 'nothing would sponsor the gas for a settlement'),
  };
  // Optional: only the buy-in half needs these, and it says so by name when they are absent.
  if (isAddress(env.DELEGATION_MANAGER)) base.delegationManager = env.DELEGATION_MANAGER.trim() as `0x${string}`;
  if (isAddress(env.PAYMENT_ENFORCER)) base.paymentEnforcer = env.PAYMENT_ENFORCER.trim() as `0x${string}`;
  return base;
}

/** Balances and custody. Needs no key, so it works in every environment that has ASSET configured. */
export function readOnlyTreasury(env: Env): TreasuryClient {
  return createTreasuryClient({ rpcUrl: rpcUrl(env), chainId: chainId(env), deployments: deployments(env) });
}

/**
 * The client that can move money. The custodian key SIGNS userOpHashes and nothing else — the asset
 * itself lives in the house Smart Agents — but it is still a key, so it is read here, used here, and
 * never logged, echoed or returned.
 */
export function custodialTreasury(env: Env): TreasuryClient {
  const key = (env.HOUSE_CUSTODIAN_KEY ?? '').trim();
  if (!PRIVATE_KEY_RE.test(key)) {
    throw new TreasuryConfigError(
      'HOUSE_CUSTODIAN_KEY',
      'HOUSE_CUSTODIAN_KEY is not set to a private key, so the house cannot sign a settlement ' +
        '(set it with `wrangler secret put HOUSE_CUSTODIAN_KEY --env <env>`)',
    );
  }
  return createTreasuryClient({
    rpcUrl: rpcUrl(env),
    chainId: chainId(env),
    deployments: deployments(env),
    signer: privateKeyToAccount(key as `0x${string}`),
  });
}

export function houseTreasury(env: Env): `0x${string}` {
  const v = (env.HOUSE_TREASURY_SA ?? env.HOUSE_SA ?? '').trim();
  if (!ADDRESS_RE.test(v)) {
    throw new TreasuryConfigError('HOUSE_TREASURY_SA', 'HOUSE_TREASURY_SA is not set to an address, so the table bankroll has no home');
  }
  return v as `0x${string}`;
}

/** The house agent a player's buy-in mandate is delegated TO. Optional: the buy-in half needs it. */
export function houseDelegate(env: Env): `0x${string}` | undefined {
  const v = (env.HOUSE_DELEGATE ?? '').trim();
  return ADDRESS_RE.test(v) ? (v as `0x${string}`) : undefined;
}

const ERC20_NAME_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

/**
 * Whether the settlement asset is a TEST asset with an open mint.
 *
 * The faucet route is only ever allowed to exist against play money, and "the operator set a flag"
 * is not proof of that — the token itself is. MockUSDC calls itself "Mock USD Coin"; a real USDC
 * does not, and would revert on `mint` anyway. Reading the name means the refusal is grounded in
 * what is actually deployed rather than in configuration that could be wrong.
 */
export async function isTestAsset(env: Env): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  let name: string;
  try {
    const client = createPublicClient({ transport: http(rpcUrl(env)) });
    name = (await client.readContract({ address: deployments(env).asset, abi: ERC20_NAME_ABI, functionName: 'name' })) as string;
  } catch (e) {
    return { ok: false, reason: `could not read the settlement asset's name: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!/mock|test/i.test(name)) {
    return {
      ok: false,
      reason: `the settlement asset calls itself "${name}", which is not a test asset — there is no faucet for real money`,
    };
  }
  return { ok: true, name };
}
