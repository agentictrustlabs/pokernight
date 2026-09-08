/**
 * The buy-in mandate — the only movement whose authority is NOT the house's.
 *
 * A cash-out is the house spending its own funds, so the house custodian signs it and that is the
 * end of the argument (see `client.transferUsdc`). A buy-in is the opposite: the money is the
 * PLAYER's, and the house may move it only because the player signed a `Delegation` that says so,
 * capped by caveats the player's Home showed them before they signed.
 *
 * This module owns the two halves of that:
 *   1. {@link buildBuyInMandateCaveats} — what the player is asked to sign. Straight
 *      `buildPaymentMandateCaveats` from the platform, so the on-chain enforcers and the consent
 *      screen agree by construction. The enforcer addresses are INJECTED, per `packages/*` rules.
 *   2. {@link buildBuyInRedemption} — what the house submits: `DelegationManager.redeemDelegation`
 *      wrapping `asset.transfer(houseTreasury, amount)`, with the PaymentEnforcer's redeem-time args
 *      filled in. Encoded by the platform's own `x402.buildRedemptionCalldata`, which refuses to
 *      encode a redemption whose delegation carries no PaymentEnforcer caveat.
 *
 * Nothing here reaches the network and nothing here names a chain, a host or an address.
 */

import { buildPaymentMandateCaveats, describePaymentMandate, type Caveat, type Delegation } from '@agenticprimitives/delegation';
import { buildClosedMandate, x402, type PaymentMandate } from '@agenticprimitives/payments';
import { TreasuryError, type Address, type Hex } from './types.js';

export type { Caveat, Delegation, PaymentMandate };

/** The four enforcer addresses a payment mandate composes. Supplied by the app, never hardcoded. */
export interface MandateEnforcers {
  payment: Address;
  timestamp: Address;
  allowedTargets: Address;
  allowedMethods: Address;
}

export interface BuyInMandateTerms {
  /** Where buy-ins land: the house treasury Smart Agent. */
  payee: Address;
  /** The settlement asset (6-decimal USDC). */
  asset: Address;
  enforcers: MandateEnforcers;
  /** Base units the biggest single buy-in or rebuy may move. */
  maxAmountPerCharge: bigint;
  /** Base units the whole night may move — the player's total exposure. */
  maxAggregate: bigint;
  /** How many buy-ins (rebuys included) are allowed inside `windowSeconds`. */
  maxRedemptionsPerWindow: number;
  windowSeconds: number;
  /** Unix SECONDS the mandate stops being valid — the end of the night. */
  validUntil: number;
  validAfter?: number;
}

function assertTerms(t: BuyInMandateTerms): void {
  if (t.maxAmountPerCharge <= 0n) {
    throw new TreasuryError('bad-mandate', `maxAmountPerCharge must be > 0, got ${t.maxAmountPerCharge}`);
  }
  if (t.maxAggregate < t.maxAmountPerCharge) {
    throw new TreasuryError('bad-mandate', `maxAggregate ${t.maxAggregate} is below maxAmountPerCharge ${t.maxAmountPerCharge}`);
  }
  if (!Number.isInteger(t.maxRedemptionsPerWindow) || t.maxRedemptionsPerWindow <= 0) {
    throw new TreasuryError('bad-mandate', `maxRedemptionsPerWindow must be a positive integer, got ${t.maxRedemptionsPerWindow}`);
  }
  if (!Number.isInteger(t.windowSeconds) || t.windowSeconds <= 0) {
    throw new TreasuryError('bad-mandate', `windowSeconds must be a positive integer, got ${t.windowSeconds}`);
  }
  if (!Number.isInteger(t.validUntil) || t.validUntil <= 0) {
    throw new TreasuryError('bad-mandate', `validUntil must be a positive unix time in SECONDS, got ${t.validUntil}`);
  }
}

/**
 * The caveat set a player signs to let the house pull buy-ins from their treasury.
 * `delegator` = the player's treasury Smart Agent, `delegate` = the house.
 */
export function buildBuyInMandateCaveats(terms: BuyInMandateTerms): Caveat[] {
  assertTerms(terms);
  return buildPaymentMandateCaveats({
    payee: terms.payee,
    asset: terms.asset,
    enforcers: terms.enforcers,
    maxAmountPerCharge: terms.maxAmountPerCharge,
    maxAggregate: terms.maxAggregate,
    maxRedemptionsPerWindow: terms.maxRedemptionsPerWindow,
    windowSeconds: terms.windowSeconds,
    validUntil: terms.validUntil,
    ...(terms.validAfter === undefined ? {} : { validAfter: terms.validAfter }),
  });
}

/** What a consent screen renders for those caveats. Amounts are base units; the caller formats them. */
export function describeBuyInMandate(terms: BuyInMandateTerms): ReturnType<typeof describePaymentMandate> {
  assertTerms(terms);
  return describePaymentMandate({
    payee: terms.payee,
    asset: terms.asset,
    enforcers: terms.enforcers,
    maxAmountPerCharge: terms.maxAmountPerCharge,
    maxAggregate: terms.maxAggregate,
    maxRedemptionsPerWindow: terms.maxRedemptionsPerWindow,
    windowSeconds: terms.windowSeconds,
    validUntil: terms.validUntil,
    ...(terms.validAfter === undefined ? {} : { validAfter: terms.validAfter }),
  });
}

/** 32 zero bytes — no HTTP resource is being bought, so the resource hash is empty. */
const ZERO32 = `0x${'00'.repeat(32)}` as Hex;

export interface BuyInRedemptionInput {
  /** The signed mandate delegation, delegator = the player's treasury. */
  delegation: Delegation;
  /** Player's treasury Smart Agent — must equal `delegation.delegator`. */
  payer: Address;
  /** House treasury Smart Agent — the payee the mandate's PaymentEnforcer terms name. */
  payee: Address;
  asset: Address;
  /** Base units to pull: `chips × chipValue`. */
  amount: bigint;
  chainId: number;
  delegationManager: Address;
  paymentEnforcer: Address;
  /** Stable per-buy-in id; becomes the mandate nonce so a replay is refused on chain. */
  nonce: bigint;
  /** Unix SECONDS this particular charge stops being valid. */
  expiresAt: number;
}

/**
 * The call the house makes: `DelegationManager.redeemDelegation(mandate, asset, 0, transfer(payee, amount))`.
 * Returned as a `{to, value, data}` plan the caller wraps in a sponsored UserOp from the house agent.
 */
export function buildBuyInRedemption(input: BuyInRedemptionInput): { to: Address; value: bigint; data: Hex; mandate: PaymentMandate } {
  if (input.amount <= 0n) throw new TreasuryError('bad-amount', `amount must be > 0, got ${input.amount}`);
  if (input.delegation.delegator.toLowerCase() !== input.payer.toLowerCase()) {
    throw new TreasuryError(
      'bad-mandate',
      `the mandate was signed by ${input.delegation.delegator}, but the buy-in is being taken from ${input.payer}`,
    );
  }

  const mandate = buildClosedMandate({
    payer: input.payer,
    payee: input.payee,
    asset: { id: input.asset, symbol: 'USDC', decimals: 6 },
    amount: input.amount,
    chain: input.chainId,
    rail: 'sponsored-userop',
    nonce: input.nonce,
    expiresAt: input.expiresAt,
  });

  let plan: { to: Address; value: bigint; data: Hex };
  try {
    plan = x402.buildRedemptionCalldata({
      mandate,
      delegation: input.delegation,
      delegationManager: input.delegationManager,
      paymentEnforcer: input.paymentEnforcer,
      asset: input.asset,
      resourceHash: ZERO32,
    });
  } catch (e) {
    // The platform refuses to encode a redemption with no PaymentEnforcer caveat (EXT-PMT-2). Say so
    // in the vocabulary of this package rather than leaking a raw platform message.
    throw new TreasuryError('bad-mandate', `the buy-in mandate cannot be redeemed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ...plan, mandate };
}
