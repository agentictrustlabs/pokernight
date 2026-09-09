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
import {
  DEFAULT_BUY_IN_POLICY,
  createTreasuryClient,
  type BuyInMandatePolicy,
  type MandateEnforcers,
  type TreasuryClient,
  type TreasuryDeployments,
} from '@pokernight/treasury';
import type { HomeApiConfig } from './home-api.js';
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

/**
 * The DEPLOYMENT DEFAULT rate: asset base units per chip for a table created right now.
 * `1000000` = 1 Sheqel per chip at 6 decimals.
 *
 * This is the rate a NEW table is stamped with. It is never the rate an EXISTING table settles at:
 * a stack bought at one rate must cash out at that same rate, whatever the operator has since
 * changed this variable to. Every settlement reads the table's own pinned rate — see
 * {@link pinnedChipValue} and `PokerTableDO`.
 */
export function chipValue(env: Env): bigint {
  const raw = (env.CHIP_VALUE ?? '').trim();
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new TreasuryConfigError('CHIP_VALUE', `CHIP_VALUE is "${env.CHIP_VALUE}", which is not a positive integer of asset base units`);
  }
  return BigInt(raw);
}

/** The deployment default, or null where none is configured. For NEW tables, never for settlements. */
export function defaultChipValue(env: Env): bigint | null {
  try {
    return chipValue(env);
  } catch {
    return null;
  }
}

/**
 * The rate every table created BEFORE rates were pinned has been settling at.
 *
 * It exists because "today's default" is the wrong answer for an old table the moment `CHIP_VALUE`
 * moves — and the deploy that introduces pinning is exactly the deploy that moves it. An unstamped
 * table would be stamped on its first load with a rate it never had, which is the hundredfold
 * overpay this whole change exists to prevent, arriving through the fix instead of the bug.
 *
 * So it is a separate, explicit variable, and it is NOT a default for anything new. Once every
 * table has loaded once (they stamp themselves on first load) it can be deleted; while it is set,
 * it is the truth about the tables that predate the field.
 */
export function legacyChipValue(env: Env): bigint | null {
  const raw = (env.LEGACY_CHIP_VALUE ?? '').trim();
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) return null;
  return BigInt(raw);
}

/** What an unstamped table has been settling at: the legacy rate, else today's default. */
export function unstampedChipValue(env: Env): bigint | null {
  return legacyChipValue(env) ?? defaultChipValue(env);
}

/**
 * The rate a table settles at: the one stamped on it, or — for a table created before rates were
 * pinned — the rate such tables have been settling at (`LEGACY_CHIP_VALUE`, falling back to the
 * deployment default where no such tables can exist). The caller writes the answer back onto the
 * table's meta the first time it loads, and from then on this function only ever returns the
 * stamped value.
 *
 * Null means no rate is known at all (no `CHIP_VALUE` anywhere), which a settled table cannot be:
 * it could not have been created without one.
 */
export function pinnedChipValue(meta: { chipValue?: string } | null | undefined, env: Env): bigint | null {
  const raw = (meta?.chipValue ?? '').trim();
  if (/^\d+$/.test(raw) && BigInt(raw) > 0n) return BigInt(raw);
  return unstampedChipValue(env);
}

/* ---------------------------------------------------------------- the settlement asset */

/**
 * The DEPLOYMENT DEFAULT settlement asset: the token a table created RIGHT NOW is stamped with.
 *
 * The card room settles in exactly one currency — Sheqel — so this and {@link pinnedAsset} always
 * agree. The pin is kept anyway, and deliberately: one field on the table recording which coin it
 * settles in is a few bytes, and it makes "which currency is this table?" answerable from the
 * table's own data instead of from a deployment variable that could be repointed. What was removed
 * with the currency was the LEGACY fallback and the first-load migration that stamped an old coin
 * onto older tables — not the record itself.
 */
export function defaultAsset(env: Env): `0x${string}` | null {
  const v = (env.ASSET ?? '').trim();
  return ADDRESS_RE.test(v) ? (v as `0x${string}`) : null;
}

/** What that asset calls itself (`SHQ`), for the places that put a ticker next to a number. */
export function defaultAssetSymbol(env: Env): string | null {
  const v = (env.ASSET_SYMBOL ?? '').trim();
  return v === '' ? null : v.slice(0, 12);
}

/**
 * The asset a table settles in: the one stamped on it, else the deployment's. A table stamped at
 * creation only ever returns its own stamp; the fallback is for a table that predates the field,
 * and there is nothing else it could honestly be — this card room has one currency.
 */
export function pinnedAsset(meta: { asset?: string } | null | undefined, env: Env): `0x${string}` | null {
  const raw = (meta?.asset ?? '').trim();
  if (ADDRESS_RE.test(raw)) return raw as `0x${string}`;
  return defaultAsset(env);
}

/** What a given currency is CALLED, if this deployment knows — `SHQ`, else null. An address this
 *  card room does not settle in is named by its address; inventing a ticker for it would be a label
 *  nobody checked. */
export function assetSymbolFor(env: Env, asset: string | null | undefined): string | null {
  const a = (asset ?? '').trim().toLowerCase();
  if (!ADDRESS_RE.test(a)) return null;
  return a === defaultAsset(env)?.toLowerCase() ? defaultAssetSymbol(env) : null;
}

/** The symbol for {@link pinnedAsset}. A stamped table carries its own, so a table can never be
 *  labelled with a coin it does not pay in. */
export function pinnedAssetSymbol(meta: { asset?: string; assetSymbol?: string } | null | undefined, env: Env): string | null {
  const raw = (meta?.asset ?? '').trim();
  if (ADDRESS_RE.test(raw)) {
    const sym = (meta?.assetSymbol ?? '').trim();
    return sym === '' ? null : sym.slice(0, 12);
  }
  return defaultAssetSymbol(env);
}

export function rpcUrl(env: Env): string {
  const v = (env.RPC_URL ?? '').trim();
  if (!v) throw new TreasuryConfigError('RPC_URL', 'RPC_URL is not set, so the card room cannot reach the chain');
  return v;
}

/**
 * The contract set both client shapes need. Buy-in-only addresses are read separately.
 *
 * `asset` overrides the deployment default with the token a PARTICULAR TABLE is pinned to. Every
 * caller that is acting for a table passes it; the ones that are not (the faucet, a balance read,
 * the terms of a fresh mandate) get today's default, which is the right answer for them because
 * they are about what happens NEXT rather than about money already committed to a table.
 */
export function deployments(env: Env, asset?: string): TreasuryDeployments {
  const pinned = (asset ?? '').trim();
  if (asset !== undefined && !ADDRESS_RE.test(pinned)) {
    throw new TreasuryConfigError('ASSET', `"${asset}" is not the address of a settlement asset`);
  }
  const base: TreasuryDeployments = {
    asset: pinned === '' ? addr(env, 'ASSET', 'the card room does not know which token it settles in') : (pinned as `0x${string}`),
    entryPoint: addr(env, 'ENTRY_POINT', 'a Smart Agent UserOp cannot be built'),
    agentAccountFactory: addr(env, 'AGENT_ACCOUNT_FACTORY', 'a Smart Agent address cannot be derived'),
    paymaster: addr(env, 'SMART_AGENT_PAYMASTER', 'nothing would sponsor the gas for a settlement'),
  };
  // Optional: only the buy-in half needs these, and it says so by name when they are absent.
  if (isAddress(env.DELEGATION_MANAGER)) base.delegationManager = env.DELEGATION_MANAGER.trim() as `0x${string}`;
  if (isAddress(env.PAYMENT_ENFORCER)) base.paymentEnforcer = env.PAYMENT_ENFORCER.trim() as `0x${string}`;
  if (isAddress(env.TIMESTAMP_ENFORCER)) base.timestampEnforcer = env.TIMESTAMP_ENFORCER.trim() as `0x${string}`;
  if (isAddress(env.ALLOWED_TARGETS_ENFORCER)) base.allowedTargetsEnforcer = env.ALLOWED_TARGETS_ENFORCER.trim() as `0x${string}`;
  if (isAddress(env.ALLOWED_METHODS_ENFORCER)) base.allowedMethodsEnforcer = env.ALLOWED_METHODS_ENFORCER.trim() as `0x${string}`;
  return base;
}

/**
 * The four enforcer addresses a buy-in mandate composes, or a sentence naming the one that is not
 * configured. A mandate is the player's protection: composing it out of three enforcers because the
 * fourth was missing would silently hand the house a wider authority than the consent screen showed,
 * so this refuses instead.
 */
export function mandateEnforcers(env: Env): MandateEnforcers {
  const d = deployments(env);
  const need = (v: `0x${string}` | undefined, name: string, why: string): `0x${string}` => {
    if (!v) throw new TreasuryConfigError(name, `${name} is not set to an address, so ${why}`);
    return v;
  };
  return {
    payment: need(d.paymentEnforcer, 'PAYMENT_ENFORCER', 'a buy-in mandate would have no on-chain spend cap'),
    timestamp: need(d.timestampEnforcer, 'TIMESTAMP_ENFORCER', 'a buy-in mandate would never expire'),
    allowedTargets: need(d.allowedTargetsEnforcer, 'ALLOWED_TARGETS_ENFORCER', 'a buy-in mandate would not be pinned to the settlement asset'),
    allowedMethods: need(d.allowedMethodsEnforcer, 'ALLOWED_METHODS_ENFORCER', 'a buy-in mandate would not be pinned to `transfer`'),
  };
}

/** Where a mandate is redeemed. Named separately because the mandate half needs it and reads may not. */
export function delegationManager(env: Env): `0x${string}` {
  const d = deployments(env);
  if (!d.delegationManager) {
    throw new TreasuryConfigError('DELEGATION_MANAGER', 'DELEGATION_MANAGER is not set to an address, so a buy-in mandate could not be redeemed');
  }
  return d.delegationManager;
}

/** The house policy a mandate is built to. Chips and counts, because that is what a card room means. */
export function mandatePolicy(env: Env): BuyInMandatePolicy {
  const int = (raw: string | undefined, fallback: number): number => {
    const n = Number((raw ?? '').trim());
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    maxBuyInChips: int(env.MANDATE_MAX_BUY_IN_CHIPS, DEFAULT_BUY_IN_POLICY.maxBuyInChips),
    maxBuyIns: int(env.MANDATE_MAX_BUY_INS, DEFAULT_BUY_IN_POLICY.maxBuyIns),
    windowSeconds: int(env.MANDATE_VALID_SECONDS, DEFAULT_BUY_IN_POLICY.windowSeconds),
    validForSeconds: int(env.MANDATE_VALID_SECONDS, DEFAULT_BUY_IN_POLICY.validForSeconds),
  };
}

/** This deployment's view of the Home, for everything after sign-in (`home-api.ts`). */
export function homeApi(env: Env): HomeApiConfig {
  const origin = (env.HOME_ORIGIN ?? '').trim();
  const clientId = (env.HOME_CLIENT_ID ?? '').trim();
  if (!origin) throw new TreasuryConfigError('HOME_ORIGIN', 'HOME_ORIGIN is not set, so the card room cannot reach a Home');
  if (!clientId) throw new TreasuryConfigError('HOME_CLIENT_ID', 'HOME_CLIENT_ID is not set, so the Home would not recognise this card room');
  // The registered redirect URI, passed through byte-for-byte: the Home's treasury ceremony compares
  // it exactly against the registry, so trimming or normalising it here would break the match.
  const redirectUri = (env.HOME_REDIRECT_URI ?? '').trim();
  return { origin, clientId, ...(redirectUri ? { redirectUri } : {}) };
}

/** What the optional `<label>.treasury` claim needs. Absent, a treasury is created nameless. */
export function treasuryNaming(env: Env): { nameRegistry: `0x${string}`; treasurySubregistry: `0x${string}` } | null {
  if (!isAddress(env.AGENT_NAME_REGISTRY) || !isAddress(env.TREASURY_SUBREGISTRY)) return null;
  return {
    nameRegistry: env.AGENT_NAME_REGISTRY.trim() as `0x${string}`,
    treasurySubregistry: env.TREASURY_SUBREGISTRY.trim() as `0x${string}`,
  };
}

/** Balances and custody. Needs no key, so it works in every environment that has ASSET configured.
 *  `asset` reads a table's PINNED currency instead of the deployment default. */
export function readOnlyTreasury(env: Env, asset?: string): TreasuryClient {
  return createTreasuryClient({ rpcUrl: rpcUrl(env), chainId: chainId(env), deployments: deployments(env, asset) });
}

/**
 * The client that can move money. The custodian key SIGNS userOpHashes and nothing else — the asset
 * itself lives in the house Smart Agents — but it is still a key, so it is read here, used here, and
 * never logged, echoed or returned.
 */
export function custodialTreasury(env: Env, asset?: string): TreasuryClient {
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
    deployments: deployments(env, asset),
    signer: privateKeyToAccount(key as `0x${string}`),
  });
}

/**
 * `address(0xa11)` — what this chain's `DelegationManager` reads as "any redeemer may redeem this".
 * A mandate carrying it is one the house may redeem even though it is not named in it. It lives here
 * rather than in `@pokernight/treasury` because it is an address, and packages name none.
 */
export const OPEN_DELEGATE = '0x0000000000000000000000000000000000000a11' as `0x${string}`;

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

const TEST_ASSET_PROBE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] },
] as const;

/**
 * A caller with no standing whatsoever: no key, no balance, no role in this deployment. The probe
 * below asks the token whether IT may mint, so the address has to be one that could not possibly be
 * privileged. A fixed literal, so the question asked is identical every time and a refusal can be
 * reproduced by hand.
 */
const OPEN_MINT_PROBE = '0x000000000000000000000000000000000f0f0f0f' as `0x${string}`;

/**
 * Whether the settlement asset is a TEST asset — one ANYONE may mint.
 *
 * The faucet, and the seed a new player is given, are only ever allowed to exist against play money,
 * and "the operator set a flag" is not proof of that. The token itself is.
 *
 * This used to read the token's NAME and accept anything calling itself mock or test — a check that
 * is really a list of names, which is configuration by another route and wrong for the next coin.
 *
 * So the check no longer reads the label, and it is deliberately NOT gated on a flag or on the fact
 * that this deployment settles in Sheqel. It asks the CONTRACT the question the faucet actually
 * depends on: simulate `mint(address,uint256)` from an address with no standing in this deployment
 * (`OPEN_MINT_PROBE`) and see whether it would succeed. True of Sheqel, and false of every asset
 * whose supply means something: a real asset has no such function, or gates it behind a minter
 * role, and either way the simulation reverts. Nothing is minted by asking — a simulation changes
 * no state — and the answer is grounded in deployed bytecode rather than in a string the token
 * chose for itself or a variable somebody set.
 *
 * `name` is still read, and still returned, so a refusal can say WHICH token it refused. It just no
 * longer decides anything.
 */
export async function isTestAsset(env: Env): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const client = createPublicClient({ transport: http(rpcUrl(env)) });
  const address = deployments(env).asset;

  let name: string;
  try {
    name = (await client.readContract({ address, abi: TEST_ASSET_PROBE_ABI, functionName: 'name' })) as string;
  } catch (e) {
    return { ok: false, reason: `could not read the settlement asset's name: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    await client.simulateContract({
      address,
      abi: TEST_ASSET_PROBE_ABI,
      functionName: 'mint',
      args: [OPEN_MINT_PROBE, 1n],
      account: OPEN_MINT_PROBE,
    });
  } catch (e) {
    return {
      ok: false,
      reason:
        `"${name}" (${address}) will not let an arbitrary caller mint it, so it is not a test asset — ` +
        `there is no faucet for money whose supply means something (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`,
    };
  }

  return { ok: true, name };
}
