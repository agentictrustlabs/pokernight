/**
 * `TreasuryTransferAdapter` — the `mandate-transfer` settlement mode, for real.
 *
 * It lives here rather than in `@pokernight/ledger` because the dependency runs one way: ledger owns
 * the `SettlementAdapter` interface and knows nothing about chains; treasury already depends on
 * ledger and owns the asset movement. Putting the adapter in ledger would invert that and drag viem
 * into a package that has no business with it.
 *
 * The two directions are NOT symmetric, and the asymmetry is the whole design:
 *
 *   cash-out   house treasury → player treasury. The house is spending its own funds, so the house
 *              custodian signs the UserOp and it settles today.
 *   buy-in     player treasury → house treasury. The money is the player's. The house can move it
 *              only by redeeming a `Delegation` the player signed at their Home. Without that
 *              signature there is NO authority, and this adapter says so and stops. It never falls
 *              back to play money: a table configured as settled either settles or refuses the seat.
 *
 * Everything chain-shaped is injected (`TreasuryClient`, addresses, chip value); this file names no
 * host, no chain id and no contract.
 */

import type {
  BuyInRequest,
  CashOutRequest,
  SettlementAdapter,
  SettlementReceipt,
} from '@pokernight/ledger';
import type { TreasuryClient } from './client.js';
import { buildBuyInRedemption, checkBuyInMandate, type Delegation, type MandateEnforcers } from './mandate.js';
import { TREASURY_SETTLEMENT_MODE, toSettlementReceipt } from './settlement.js';
import { TreasuryError, type Address } from './types.js';
import { chipsToUsdc, formatUsdc } from './units.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** What the adapter needs to know about a player before it can move their money. */
export interface PlayerFunding {
  /** The treasury Smart Agent the player chose when they connected. */
  treasury: Address;
  /**
   * The signed buy-in mandate, when the player has one. `undefined` means the player has not
   * authorised anything, which is a refusal, not a fallback.
   */
  mandate?: Delegation;
}

export interface TreasuryTransferAdapterOpts {
  client: TreasuryClient;
  /** House treasury Smart Agent: buy-ins land here, cash-outs leave here. */
  houseTreasury: Address;
  /**
   * The house Smart Agent that REDEEMS a player's mandate. It must be the `delegate` the player's
   * delegation names, and the house custodian must custody it. Absent, buy-ins refuse by name.
   */
  houseDelegate?: Address;
  /** Asset base units per chip (`CHIP_VALUE`). */
  chipValue: bigint;
  chainId: number;
  /** Where a mandate is redeemed; absent, buy-ins refuse by name. */
  delegationManager?: Address;
  /** The mandate's spend/frequency enforcer; absent, buy-ins refuse by name. */
  enforcers?: Partial<MandateEnforcers>;
  /** The DelegationManager's "any redeemer" sentinel, when the host knows it. Injected: an address. */
  openDelegate?: Address;
  /**
   * Look up the player's chosen treasury and their signed mandate. The host owns this because it is
   * the host that holds sessions; the adapter only ever asks.
   */
  resolvePlayer(req: { playerId: string; playerAddress?: string; delegation?: unknown }): Promise<PlayerFunding | null>;
  /** Gas for the inner `redeemDelegation` call. Default 600_000 — enforcers plus an ERC-20 transfer. */
  redeemGasLimit?: bigint;
  /** How long one buy-in charge stays valid, in seconds. Default 600. */
  chargeTtlSeconds?: number;
  now?(): number;
}

/**
 * Why a buy-in cannot be settled right now, said in one sentence that names the missing thing.
 * Returned by `authorizeBuyIn` (so no seat is ever credited against money that cannot move) and
 * thrown by `settleBuyIn` (so an op that somehow got queued still fails closed).
 */
function buyInBlocker(opts: TreasuryTransferAdapterOpts, funding: PlayerFunding | null, req: BuyInRequest): string | null {
  const amount = chipsToUsdc(req.chips, opts.chipValue);
  if (!funding || !funding.treasury) {
    return (
      `no treasury is selected for ${req.playerId} — choose the treasury Smart Agent chartered under ` +
      `your person agent before sitting at a settled table`
    );
  }
  if (!ADDRESS_RE.test(funding.treasury)) {
    return `the treasury recorded for ${req.playerId} ("${funding.treasury}") is not an address`;
  }
  if (!funding.mandate) {
    // State what IS missing, not why it might be. This used to assert that the Home had not curated
    // the template — a claim this code cannot check and which went stale the moment the Home did.
    return (
      `${req.playerId} has not signed a buy-in mandate, so the card room has no authority to move ` +
      `${formatUsdc(amount)} USDC out of ${funding.treasury}. ` +
      `A mandate is signed at the player's Home and authorises this table, up to a cap, for this session.`
    );
  }
  if (!opts.delegationManager) {
    return 'DELEGATION_MANAGER is not configured for this deployment, so a signed buy-in mandate cannot be redeemed';
  }
  if (!opts.enforcers?.payment) {
    return 'PAYMENT_ENFORCER is not configured for this deployment, so a buy-in mandate has no on-chain spend cap to redeem against';
  }
  if (!opts.houseDelegate) {
    return 'HOUSE_DELEGATE is not configured for this deployment, so there is no house agent to redeem the buy-in mandate as';
  }
  // The same arithmetic the on-chain enforcers do, said BEFORE a seat is credited: which treasury the
  // mandate was signed by, who it pays, in what asset, up to how much, and until when.
  return checkBuyInMandate(funding.mandate, {
    treasury: funding.treasury,
    houseDelegate: opts.houseDelegate,
    payee: opts.houseTreasury,
    asset: opts.client.deployments.asset,
    paymentEnforcer: opts.enforcers.payment,
    ...(opts.openDelegate ? { openDelegate: opts.openDelegate } : {}),
    amount,
    now: (opts.now ?? (() => Date.now()))(),
  });
}

export function createTreasuryTransferAdapter(opts: TreasuryTransferAdapterOpts): SettlementAdapter {
  const { client, houseTreasury, chipValue, chainId } = opts;
  const asset = client.deployments.asset;
  const now = opts.now ?? (() => Date.now());
  const chargeTtl = opts.chargeTtlSeconds ?? 600;

  if (!ADDRESS_RE.test(houseTreasury)) {
    throw new TreasuryError('not-configured', `houseTreasury "${houseTreasury}" is not an address`);
  }
  if (chipValue <= 0n) throw new TreasuryError('bad-chip-value', `chipValue must be > 0, got ${chipValue}`);

  async function resolve(req: { playerId: string; playerAddress?: string; delegation?: unknown }): Promise<PlayerFunding | null> {
    return opts.resolvePlayer(req);
  }

  return {
    mode: TREASURY_SETTLEMENT_MODE,
    chipValue,
    asset,

    /**
     * Nothing is credited until this passes: the player has a treasury, that treasury actually holds
     * the USDC the buy-in is worth, and there is an authority to move it. A seat credited against
     * money that cannot move is the one failure this mode must never produce.
     */
    async authorizeBuyIn(req: BuyInRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
      const amount = chipsToUsdc(req.chips, chipValue);
      let funding: PlayerFunding | null;
      try {
        funding = await resolve(req);
      } catch (e) {
        return { ok: false, reason: `could not read the treasury for ${req.playerId}: ${e instanceof Error ? e.message : String(e)}` };
      }

      if (funding?.treasury && ADDRESS_RE.test(funding.treasury)) {
        let balance: bigint;
        try {
          balance = await client.readUsdcBalance(funding.treasury);
        } catch (e) {
          return { ok: false, reason: `could not read the USDC balance of ${funding.treasury}: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (balance < amount) {
          // Name the SHORTFALL, not just the two numbers: "not enough" a player has to subtract is
          // not something they can act on. The client says the same thing in the same shape before
          // the button is pressed (`buyInShortfall` in apps/web).
          return {
            ok: false,
            reason:
              `${funding.treasury} holds ${formatUsdc(balance)} USDC; a ${req.chips}-chip buy-in costs ${formatUsdc(amount)} USDC — ` +
              `${formatUsdc(amount - balance)} USDC short. Fund the treasury or buy in for less.`,
          };
        }
      }

      const blocker = buyInBlocker(opts, funding, req);
      return blocker ? { ok: false, reason: blocker } : { ok: true };
    },

    /**
     * Pull the buy-in out of the player's treasury by redeeming their signed mandate, as the house.
     * Fails closed and by name whenever the authority is missing — it is never quietly downgraded.
     */
    async settleBuyIn(req: BuyInRequest): Promise<SettlementReceipt> {
      const amount = chipsToUsdc(req.chips, chipValue);
      const funding = await resolve(req);
      const blocker = buyInBlocker(opts, funding, req);
      if (blocker) throw new TreasuryError(funding?.mandate ? 'not-configured' : 'no-mandate', blocker);

      // Narrowed by buyInBlocker, which returns non-null for every one of these.
      const payer = (funding as PlayerFunding).treasury;
      const mandate = (funding as PlayerFunding).mandate as Delegation;
      const delegationManager = opts.delegationManager as Address;
      const paymentEnforcer = (opts.enforcers as MandateEnforcers).payment;
      const houseDelegate = opts.houseDelegate as Address;

      const balance = await client.readUsdcBalance(payer);
      if (balance < amount) {
        throw new TreasuryError(
          'insufficient-balance',
          `${payer} holds ${formatUsdc(balance)} USDC, which does not cover the ${formatUsdc(amount)} USDC buy-in — ` +
            `${formatUsdc(amount - balance)} USDC short`,
        );
      }

      const plan = buildBuyInRedemption({
        delegation: mandate,
        payer,
        payee: houseTreasury,
        asset,
        amount,
        chainId,
        delegationManager,
        paymentEnforcer,
        nonce: orderNonce(req.orderId),
        expiresAt: Math.floor(now() / 1000) + chargeTtl,
      });

      const { txHash } = await client.executeCall({
        from: houseDelegate,
        to: plan.to,
        value: plan.value,
        data: plan.data,
        callGasLimit: opts.redeemGasLimit ?? 600_000n,
      });
      return toSettlementReceipt({ orderId: req.orderId, amount, asset, txHash, at: now() });
    },

    /**
     * Pay the player out of the house treasury. The house owns these funds, so the house custodian's
     * signature is the whole authority — this is what settles today.
     */
    async settleCashOut(req: CashOutRequest): Promise<SettlementReceipt> {
      const amount = chipsToUsdc(req.chips, chipValue);
      const to = req.playerAddress;
      if (!to || !ADDRESS_RE.test(to)) {
        throw new TreasuryError(
          'not-configured',
          `seat ${req.seat} at ${req.tableId} has no payout treasury recorded (${req.playerId}), so ${formatUsdc(amount)} USDC has nowhere to go`,
        );
      }
      if (amount === 0n) {
        // A player who leaves with nothing is a settled row, not a zero-value chain write.
        return { mode: TREASURY_SETTLEMENT_MODE, orderId: req.orderId, amount: '0', asset, ref: `empty:${req.orderId}`, at: now(), status: 'settled' };
      }

      const balance = await client.readUsdcBalance(houseTreasury);
      if (balance < amount) {
        throw new TreasuryError(
          'insufficient-balance',
          `the house treasury ${houseTreasury} holds ${formatUsdc(balance)} USDC, which does not cover the ${formatUsdc(amount)} USDC ` +
            `cash-out for ${req.playerId} — ${formatUsdc(amount - balance)} USDC short`,
        );
      }

      const { txHash } = await client.transferUsdc({ from: houseTreasury, to: to as Address, amount });
      return toSettlementReceipt({ orderId: req.orderId, amount, asset, txHash, at: now() });
    },
  };
}

/**
 * Turn the ledger's order id into the mandate nonce. The nonce is what makes a redemption one-shot
 * on chain, so it must be stable for one buy-in and different for every other: a plain FNV-1a over
 * the order id gives both without needing a hash import.
 */
export function orderNonce(orderId: string): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < orderId.length; i++) {
    h = (h ^ BigInt(orderId.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h;
}
