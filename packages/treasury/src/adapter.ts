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
import { chipsToAsset, formatAmount } from './units.js';

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
  /**
   * Why the host WITHHELD a mandate it holds — set only when there is one and it does not apply
   * here.
   *
   * "You have not authorised anything" and "what you authorised is not about this table" are
   * different facts, and a player who has just signed a mandate is owed the second one rather than
   * being told the first. The host knows which it is (a mandate bound to another treasury, or
   * denominated in another currency); the adapter cannot see the difference, so it is told.
   */
  mandateProblem?: string;
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
  /**
   * What the settlement asset is CALLED (`SHQ`), for the refusals a player reads.
   *
   * Injected, and optional, for the same reason every address here is: this package names no
   * currency. Absent, a money sentence states the number and no ticker — which is right, because a
   * ticker nobody configured next to a real amount of somebody's money is worse than none.
   */
  assetSymbol?: string;
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
 * How to write an amount in a sentence a player reads: `40.000000 SHQ`, or just `40.000000` where the
 * host has not said what its money is called. The ticker is the host's to supply (`assetSymbol`) —
 * this package names no currency, and there is exactly one on the estate for the host to name.
 */
function amountIn(symbol: string | undefined): (v: bigint) => string {
  const ticker = (symbol ?? '').trim();
  return ticker === '' ? (v) => formatAmount(v) : (v) => `${formatAmount(v)} ${ticker}`;
}

/**
 * Why a buy-in cannot be settled right now, said in one sentence that names the missing thing.
 * Returned by `authorizeBuyIn` (so no seat is ever credited against money that cannot move) and
 * thrown by `settleBuyIn` (so an op that somehow got queued still fails closed).
 */
function buyInBlocker(opts: TreasuryTransferAdapterOpts, funding: PlayerFunding | null, req: BuyInRequest): string | null {
  const amount = chipsToAsset(req.chips, opts.chipValue);
  const money = amountIn(opts.assetSymbol);
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
    // The host held a mandate and decided it does not apply here. That is a different fact from
    // "you have not authorised anything", and it is the one the player needs.
    if (funding.mandateProblem) return funding.mandateProblem;
    // State what IS missing, not why it might be. This used to assert that the Home had not curated
    // the template — a claim this code cannot check and which went stale the moment the Home did.
    return (
      `${req.playerId} has not signed a buy-in mandate, so the card room has no authority to move ` +
      `${money(amount)} out of ${funding.treasury}. ` +
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
    // The house treasury is also this house. A mandate the Home minted with no declared redeemer
    // names the payee, so accept that too rather than refusing every mandate issued before the
    // Home's config named a redeemer.
    alsoAcceptedDelegates: [opts.houseTreasury],
    payee: opts.houseTreasury,
    asset: opts.client.deployments.asset,
    // The ticker the host gave this adapter, so the mandate's own cap refusal reads as money too.
    ...(opts.assetSymbol ? { assetSymbol: opts.assetSymbol } : {}),
    paymentEnforcer: opts.enforcers.payment,
    ...(opts.openDelegate ? { openDelegate: opts.openDelegate } : {}),
    amount,
    now: (opts.now ?? (() => Date.now()))(),
  });
}

export function createTreasuryTransferAdapter(opts: TreasuryTransferAdapterOpts): SettlementAdapter {
  const { client, houseTreasury, chipValue, chainId } = opts;
  const asset = client.deployments.asset;
  const money = amountIn(opts.assetSymbol);
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
     * the asset the buy-in is worth, and there is an authority to move it. A seat credited against
     * money that cannot move is the one failure this mode must never produce.
     */
    async authorizeBuyIn(req: BuyInRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
      const amount = chipsToAsset(req.chips, chipValue);
      let funding: PlayerFunding | null;
      try {
        funding = await resolve(req);
      } catch (e) {
        return { ok: false, reason: `could not read the treasury for ${req.playerId}: ${e instanceof Error ? e.message : String(e)}` };
      }

      if (funding?.treasury && ADDRESS_RE.test(funding.treasury)) {
        let balance: bigint;
        try {
          balance = await client.readBalance(funding.treasury);
        } catch (e) {
          return { ok: false, reason: `could not read the balance of ${funding.treasury}: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (balance < amount) {
          // Name the SHORTFALL, not just the two numbers: "not enough" a player has to subtract is
          // not something they can act on. The client says the same thing in the same shape before
          // the button is pressed (`buyInShortfall` in apps/web).
          return {
            ok: false,
            reason:
              `${funding.treasury} holds ${money(balance)}; a ${req.chips}-chip buy-in costs ${money(amount)} — ` +
              `${money(amount - balance)} short. Fund the treasury or buy in for less.`,
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
      const amount = chipsToAsset(req.chips, chipValue);
      const funding = await resolve(req);
      const blocker = buyInBlocker(opts, funding, req);
      if (blocker) throw new TreasuryError(funding?.mandate ? 'not-configured' : 'no-mandate', blocker);

      // Narrowed by buyInBlocker, which returns non-null for every one of these.
      const payer = (funding as PlayerFunding).treasury;
      const mandate = (funding as PlayerFunding).mandate as Delegation;
      const delegationManager = opts.delegationManager as Address;
      const paymentEnforcer = (opts.enforcers as MandateEnforcers).payment;
      // Present it as the account the mandate NAMES. The check above accepted either house account,
      // so redeeming as a hardcoded one would fail on chain for the other — the DelegationManager
      // compares the caller against the delegate, and both are custodied by the same key anyway.
      const eqAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
      const named = (mandate as { delegate?: string }).delegate;
      const houseDelegate = (
        named && eqAddr(named, houseTreasury) ? houseTreasury : opts.houseDelegate
      ) as Address;

      const balance = await client.readBalance(payer);
      if (balance < amount) {
        throw new TreasuryError(
          'insufficient-balance',
          `${payer} holds ${money(balance)}, which does not cover the ${money(amount)} buy-in — ` +
            `${money(amount - balance)} short`,
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
      const amount = chipsToAsset(req.chips, chipValue);
      const to = req.playerAddress;
      if (!to || !ADDRESS_RE.test(to)) {
        throw new TreasuryError(
          'not-configured',
          `seat ${req.seat} at ${req.tableId} has no payout treasury recorded (${req.playerId}), so ${money(amount)} has nowhere to go`,
        );
      }
      if (amount === 0n) {
        // A player who leaves with nothing is a settled row, not a zero-value chain write.
        return { mode: TREASURY_SETTLEMENT_MODE, orderId: req.orderId, amount: '0', asset, ref: `empty:${req.orderId}`, at: now(), status: 'settled' };
      }

      const balance = await client.readBalance(houseTreasury);
      if (balance < amount) {
        throw new TreasuryError(
          'insufficient-balance',
          `the house treasury ${houseTreasury} holds ${money(balance)}, which does not cover the ${money(amount)} ` +
            `cash-out for ${req.playerId} — ${money(amount - balance)} short`,
        );
      }

      const { txHash } = await client.transferAsset({ from: houseTreasury, to: to as Address, amount });
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
