/**
 * The treasury routes: which Smart Agent funds a player's night, and what is in it.
 *
 * A player signs in as an identity; that says who they are, not what they can spend. Before they can
 * sit at a settled table they pick a TREASURY — a Smart Agent they custody — and that choice is
 * recorded on the server session (`SessionDO`), not in the browser. Everything downstream (the
 * table's buy-in authority, the cash-out payee) reads it from there, so the browser never gets to
 * name the address that money moves to.
 *
 *   GET  /treasury                 the chosen treasury, its live balance, and the candidates
 *   POST /treasury/select {address}  choose one — refused unless the caller custodies it
 *   POST /treasury/fund {amount}     mint test USDC, faithchain's open-mint MockUSDC only
 *
 * All three require a session. All three name the exact reason for every refusal: a money route that
 * answers "failed" is a money route nobody can debug.
 */

import { z } from 'zod';
import type { Context } from 'hono';
import { formatUsdc, parseUsdc, TreasuryError, type Address } from '@pokernight/treasury';
import { readSessionRecord, setSessionTreasury, type SessionClaims } from './auth.js';
import type { Env } from './env.js';
import {
  TreasuryConfigError,
  chainId,
  chipValue,
  custodialTreasury,
  deployments,
  isAddress,
  isTestAsset,
  readOnlyTreasury,
} from './treasury.js';

export const SelectTreasurySchema = z.object({ address: z.string().trim().min(1).max(64) });
/** A decimal USDC amount, e.g. "100" or "12.50". Capped so a demo faucet stays a demo faucet. */
export const FundTreasurySchema = z.object({ amount: z.string().trim().min(1).max(32).optional() });

/** Biggest single faucet grant. Test money, but an unbounded mint button is still a bad button. */
export const MAX_FUND_USDC = 100_000_000_000n; // 100_000 USDC in base units

/** One treasury the player could choose, with why it is on the list. */
export interface TreasuryCandidate {
  address: string;
  label: string;
  /** Where it came from: the identity the Home asserted, or something the player added. */
  source: 'home-agent' | 'chosen';
  balance: string | null;
  balanceUsdc: string | null;
  /** Present when the balance could not be read, saying why. */
  error?: string;
}

export interface TreasuryView {
  chainId: number;
  asset: string;
  /** Asset base units per chip, as a decimal string (bigints do not survive JSON). */
  chipValue: string;
  /** The treasury this session funds play from, or null when the player has not chosen yet. */
  chosen: string | null;
  balance: string | null;
  balanceUsdc: string | null;
  candidates: TreasuryCandidate[];
  /** Whether `POST /treasury/fund` will work here, and if not, why not. */
  faucet: { available: boolean; asset: string | null; reason: string | null };
  /** Why the money layer is unavailable, when it is. Null when everything needed is configured. */
  unavailable: string | null;
}

type Ctx = Context<{ Bindings: Env }>;

function configFailure(e: unknown): string {
  if (e instanceof TreasuryConfigError) return `the card room is not configured to settle in USDC: ${e.message}`;
  return `the card room could not reach the money layer: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * `GET /treasury` — what funds this player, and what is in it.
 *
 * The default candidate is the player's own Smart Agent, which the session already knows because the
 * Home asserted it at sign-in. A dev session has no Smart Agent at all, and says so rather than
 * offering a made-up address.
 */
export async function getTreasury(c: Ctx, session: SessionClaims): Promise<Response> {
  const record = await readSessionRecord(c.env, session.playerId);
  const homeAgent = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;
  const chosen = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;

  let view: TreasuryView;
  try {
    view = {
      chainId: chainId(c.env),
      asset: deployments(c.env).asset,
      chipValue: chipValue(c.env).toString(),
      chosen,
      balance: null,
      balanceUsdc: null,
      candidates: [],
      faucet: { available: false, asset: null, reason: null },
      unavailable: null,
    };
  } catch (e) {
    return c.json(
      {
        chainId: Number(c.env.CHAIN_ID) || 0,
        asset: '',
        chipValue: '0',
        chosen,
        balance: null,
        balanceUsdc: null,
        candidates: [],
        faucet: { available: false, asset: null, reason: null },
        unavailable: configFailure(e),
      } satisfies TreasuryView,
      200,
    );
  }

  const client = readOnlyTreasury(c.env);
  const addresses = [...new Set([homeAgent, chosen].filter((a): a is string => a !== null))];
  for (const address of addresses) {
    const candidate: TreasuryCandidate = {
      address,
      label: address === homeAgent ? (record?.agentName ?? 'Your Smart Agent') : 'Chosen treasury',
      source: address === homeAgent ? 'home-agent' : 'chosen',
      balance: null,
      balanceUsdc: null,
    };
    try {
      const balance = await client.readUsdcBalance(address as Address);
      candidate.balance = balance.toString();
      candidate.balanceUsdc = formatUsdc(balance);
      if (address === chosen) {
        view.balance = candidate.balance;
        view.balanceUsdc = candidate.balanceUsdc;
      }
    } catch (e) {
      candidate.error = `could not read the balance of ${address}: ${e instanceof Error ? e.message : String(e)}`;
    }
    view.candidates.push(candidate);
  }

  const faucet = await isTestAsset(c.env);
  view.faucet = faucet.ok
    ? { available: true, asset: faucet.name, reason: null }
    : { available: false, asset: null, reason: faucet.reason };

  return c.json(view);
}

/**
 * `POST /treasury/select` — choose the treasury that funds this player's play.
 *
 * The check that matters is `isCustodian`: the player's own Smart Agent must be a custodian of the
 * account they are naming. Without it this route would let anyone point the house's cash-outs at any
 * address on the chain, which is the entire attack. A refusal says which of the two facts failed —
 * the account is not deployed, or the caller does not custody it — because "invalid address" tells
 * nobody anything.
 */
export async function selectTreasury(c: Ctx, session: SessionClaims, address: string): Promise<Response> {
  const wanted = address.trim();
  if (!isAddress(wanted)) return c.json({ error: `"${wanted}" is not a 20-byte address` }, 400);
  const lower = wanted.toLowerCase();

  const record = await readSessionRecord(c.env, session.playerId);
  const homeAgent = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;

  let client;
  try {
    client = readOnlyTreasury(c.env);
  } catch (e) {
    return c.json({ error: configFailure(e) }, 503);
  }

  // The player's own Smart Agent is theirs by definition — the Home asserted it at sign-in and the
  // Worker verified that assertion itself. Anything else has to prove custody on chain.
  if (lower !== homeAgent) {
    if (!homeAgent) {
      return c.json(
        {
          error:
            'this session has no Smart Agent, so there is no identity to check custody against. Sign in through your Home to fund play from a treasury.',
        },
        403,
      );
    }
    let deployed: boolean;
    try {
      deployed = await client.isDeployed(lower as Address);
    } catch (e) {
      return c.json({ error: `could not reach the chain to check ${lower}: ${e instanceof Error ? e.message : String(e)}` }, 502);
    }
    if (!deployed) {
      return c.json({ error: `${lower} has no code on chain ${chainId(c.env)} — it is not a deployed Smart Agent` }, 400);
    }
    let custodian: boolean;
    try {
      custodian = await client.isCustodian(lower as Address, homeAgent as Address);
    } catch (e) {
      return c.json({ error: `could not check custody of ${lower}: ${e instanceof Error ? e.message : String(e)}` }, 502);
    }
    if (!custodian) {
      return c.json(
        { error: `${homeAgent} is not a custodian of ${lower}, so this session may not spend from it` },
        403,
      );
    }
  }

  if (!(await setSessionTreasury(c.env, session.playerId, lower))) {
    return c.json({ error: 'this session is no longer active, so the choice was not recorded' }, 401);
  }

  let balance: string | null = null;
  let balanceUsdc: string | null = null;
  try {
    const b = await client.readUsdcBalance(lower as Address);
    balance = b.toString();
    balanceUsdc = formatUsdc(b);
  } catch {
    /* the choice is recorded either way; the balance is a nicety */
  }
  return c.json({ chosen: lower, balance, balanceUsdc });
}

/**
 * `POST /treasury/fund` — mint test USDC into the chosen treasury.
 *
 * This exists because faithchain's settlement asset is MockUSDC with an open `mint`, and a demo with
 * no money in it demonstrates nothing. It is gated on the asset ITSELF saying it is a mock (see
 * `isTestAsset`), not on a config flag: if this deployment is ever pointed at a real stablecoin, the
 * button disappears rather than reverting in a player's face.
 */
export async function fundTreasury(c: Ctx, session: SessionClaims, amountRaw: string | undefined): Promise<Response> {
  const record = await readSessionRecord(c.env, session.playerId);
  const chosen = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;
  if (!chosen) return c.json({ error: 'choose a treasury before funding one' }, 409);

  const faucet = await isTestAsset(c.env);
  if (!faucet.ok) return c.json({ error: faucet.reason }, 403);

  let amount: bigint;
  try {
    amount = parseUsdc(amountRaw ?? '100');
  } catch (e) {
    return c.json({ error: e instanceof TreasuryError ? e.message : `"${amountRaw}" is not a USDC amount` }, 400);
  }
  if (amount <= 0n) return c.json({ error: `the amount must be greater than zero, got ${formatUsdc(amount)}` }, 400);
  if (amount > MAX_FUND_USDC) {
    return c.json({ error: `${formatUsdc(amount)} is more than the ${formatUsdc(MAX_FUND_USDC)} USDC the test faucet will mint at once` }, 400);
  }

  let client;
  try {
    client = custodialTreasury(c.env);
  } catch (e) {
    return c.json({ error: configFailure(e) }, 503);
  }

  let txHash: string;
  try {
    txHash = await client.mintTestAsset(chosen as Address, amount);
  } catch (e) {
    return c.json({ error: `the test mint did not land: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  let balance: string | null = null;
  let balanceUsdc: string | null = null;
  try {
    const b = await client.readUsdcBalance(chosen as Address);
    balance = b.toString();
    balanceUsdc = formatUsdc(b);
  } catch {
    /* the mint landed; a stale read replica must not turn that into a failure */
  }
  return c.json({
    treasury: chosen,
    minted: amount.toString(),
    mintedUsdc: formatUsdc(amount),
    txHash,
    balance,
    balanceUsdc,
    asset: faucet.name,
    note: 'Test USDC on faithchain. It has no value anywhere else.',
  });
}
