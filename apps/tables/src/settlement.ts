/**
 * Settlement adapter factory, keyed by the table's settlement mode.
 *
 * play-money       chips never leave the DO. Unchanged, and deliberately untouched by everything
 *                  below: a play-money table must behave exactly as it did before money was real.
 * mandate-transfer USDC moves between Smart Agent treasuries on chain. Cash-outs are paid by the
 *                  house custodian out of HOUSE_TREASURY_SA; buy-ins are pulled from the player's
 *                  own treasury by redeeming a mandate THEY signed. See `@pokernight/treasury`.
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

export function createSettlementAdapter(mode: SettlementMode, env: Env, resolveFunding?: FundingResolver): SettlementAdapter {
  switch (mode) {
    case 'play-money':
      return new PlayMoneyAdapter();
    case 'mandate-transfer':
      return createMandateTransferAdapter(env, resolveFunding);
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
function createMandateTransferAdapter(env: Env, resolveFunding?: FundingResolver): SettlementAdapter {
  let client;
  let house: `0x${string}`;
  let chips: bigint;
  let chain: number;
  let deploys;
  try {
    client = custodialTreasury(env);
    house = houseTreasury(env);
    chips = chipValue(env);
    chain = chainId(env);
    deploys = deployments(env);
  } catch (e) {
    if (e instanceof TreasuryConfigError) {
      throw new Error(`this deployment cannot settle in USDC: ${e.message}`);
    }
    throw e;
  }

  const resolve: FundingResolver =
    resolveFunding ??
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
