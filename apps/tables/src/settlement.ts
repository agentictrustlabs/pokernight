/**
 * Settlement adapter factory, keyed by the table's settlement mode.
 *
 * play-money       chips never leave the DO. Unchanged, and deliberately untouched by everything
 *                  below: a play-money table must behave exactly as it did before money was real.
 * mandate-transfer the TABLE's settlement asset moves between Smart Agent treasuries on chain —
 *                  Sheqel for a table opened now, MockUSDC for one opened before the card room had
 *                  a coin of its own. Cash-outs are paid by the house custodian out of
 *                  HOUSE_TREASURY_SA; buy-ins are pulled from the player's own treasury by
 *                  redeeming a mandate THEY signed. See `@pokernight/treasury`.
 * table-escrow     phase 4.
 *
 * Everything chain-shaped is read here (`treasury.ts`) and injected. The adapter itself lives in
 * `packages/treasury` and names no host, chain or address.
 */

import { PlayMoneyAdapter, type SettlementAdapter } from '@pokernight/ledger';
import { createTreasuryTransferAdapter, type PlayerFunding } from '@pokernight/treasury';
import type { SettlementMode } from '@pokernight/protocol';
import type { Env } from './env.js';
import {
  OPEN_DELEGATE,
  TreasuryConfigError,
  chainId,
  chipValue,
  custodialTreasury,
  deployments,
  houseDelegate,
  houseTreasury,
} from './treasury.js';

/**
 * How the table tells the adapter who is paying and where to.
 *
 * The host owns this because the host holds sessions: the treasury a seat pays to (and pulls from)
 * is the one recorded server-side when the player connected, never one that arrived on the wire.
 */
export type FundingResolver = (req: { playerId: string; playerAddress?: string; delegation?: unknown }) => Promise<PlayerFunding | null>;

export interface SettlementAdapterOpts {
  /**
   * The TABLE's chip rate, in asset base units per chip. Required for a settled table and passed by
   * the DO from its own meta, because the deployment default may have moved since the table was
   * created — and a stack bought at one rate must never be paid out at another.
   */
  chipValue?: bigint;
  /**
   * The TABLE's settlement asset. Passed by the DO from its own meta for the same reason the chip
   * rate is: the deployment default may have moved to a different currency since the table was
   * created, and a stack bought with one coin must never be paid out in another.
   */
  asset?: string;
  resolveFunding?: FundingResolver;
}

export function createSettlementAdapter(mode: SettlementMode, env: Env, opts: SettlementAdapterOpts = {}): SettlementAdapter {
  switch (mode) {
    case 'play-money':
      return new PlayMoneyAdapter();
    case 'mandate-transfer':
      return createMandateTransferAdapter(env, opts);
    case 'table-escrow':
      // TODO(phase 4): return new TableEscrowAdapter(env)
      throw new Error(`settlement mode not available yet: ${mode}`);
  }
}

/**
 * Build the on-chain adapter, or refuse with the name of the thing that is not configured. A table
 * created in this mode against a half-configured deployment must fail AT CREATION, loudly, rather
 * than seat players and discover at cash-out time that it cannot pay them.
 */
function createMandateTransferAdapter(env: Env, opts: SettlementAdapterOpts): SettlementAdapter {
  let client;
  let house: `0x${string}`;
  let chips: bigint;
  let chain: number;
  let deploys;
  try {
    // The table's own currency wherever the caller knows it, exactly as with the rate below: the
    // client this builds carries `deployments.asset`, and that is the token every transfer, every
    // balance check and every mandate check in this adapter is denominated in.
    client = custodialTreasury(env, opts.asset);
    house = houseTreasury(env);
    // The table's own rate wherever the caller knows it. `chipValue(env)` is the fallback for the
    // one caller that has no table yet — creating one — and is the same value that table is about
    // to be stamped with, so the two can never disagree.
    chips = opts.chipValue ?? chipValue(env);
    chain = chainId(env);
    deploys = deployments(env, opts.asset);
  } catch (e) {
    if (e instanceof TreasuryConfigError) {
      throw new Error(`this deployment cannot settle on chain: ${e.message}`);
    }
    throw e;
  }

  const resolve: FundingResolver =
    opts.resolveFunding ??
    (async (req) => {
      // No resolver wired means the caller has no way to know whose money this is. Answering "null"
      // is right: the adapter turns that into a refusal that names the missing treasury, and no seat
      // is credited against money nobody can locate.
      void req;
      return null;
    });

  const adapterOpts: Parameters<typeof createTreasuryTransferAdapter>[0] = {
    client,
    houseTreasury: house,
    chipValue: chips,
    chainId: chain,
    openDelegate: OPEN_DELEGATE,
    resolvePlayer: resolve,
  };
  const delegate = houseDelegate(env);
  if (delegate) adapterOpts.houseDelegate = delegate;
  if (deploys.delegationManager) adapterOpts.delegationManager = deploys.delegationManager;
  if (deploys.paymentEnforcer) adapterOpts.enforcers = { payment: deploys.paymentEnforcer };

  return createTreasuryTransferAdapter(adapterOpts);
}
