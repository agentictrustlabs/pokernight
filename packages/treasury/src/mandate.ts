/**
 * The buy-in mandate — the only movement whose authority is NOT the house's.
 *
 * A cash-out is the house spending its own funds, so the house custodian signs it and that is the
 * end of the argument (see `client.transferAsset`). A buy-in is the opposite: the money is the
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

import {
  ROOT_AUTHORITY,
  buildPaymentMandateCaveats,
  decodePaymentTerms,
  decodeTimestampTerms,
  describePaymentMandate,
  hashDelegation,
  type Caveat,
  type Delegation,
} from '@agenticprimitives/delegation';
import { buildClosedMandate, x402, type PaymentMandate } from '@agenticprimitives/payments';
import { TreasuryError, type Address, type Hex } from './types.js';
import { formatAmount } from './units.js';

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
  /** The settlement asset (6 decimals). */
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
    // No ticker: the symbol is optional metadata and this package names no currency.
    asset: { id: input.asset, decimals: 6 },
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


/* ------------------------------------------------------------------ the terms */

/**
 * The house's policy for what a night's mandate is allowed to be, in TABLE units.
 *
 * Chips and rebuys are what a card room actually thinks in; asset amounts are derived from them and
 * the deployment's `chipValue`, so there is exactly one place a cap is decided and it is the same
 * number the consent screen shows and the on-chain enforcer holds.
 */
export interface BuyInMandatePolicy {
  /** The biggest single buy-in or rebuy the mandate may cover, in chips. */
  maxBuyInChips: number;
  /** How many buy-ins (the first one included) the night may take. */
  maxBuyIns: number;
  /** The window the redemption count is measured over. */
  windowSeconds: number;
  /** How long the mandate stays valid — the end of the night. */
  validForSeconds: number;
}

/** One night, one table's worth of rebuys. Deliberately short: a mandate is not a standing account. */
export const DEFAULT_BUY_IN_POLICY: BuyInMandatePolicy = {
  // 200 chips. The cap a player consents to is a cap in ASSET (`maxBuyInChips × chipValue`), so this
  // number only means anything alongside a rate: at the one-whole-unit chip the apps default to, it
  // is a 200-unit ceiling per buy-in — the same ceiling this policy has always described.
  maxBuyInChips: 200,
  maxBuyIns: 5,
  windowSeconds: 12 * 60 * 60,
  validForSeconds: 12 * 60 * 60,
};

export interface BuyInMandateTermsInput {
  payee: Address;
  asset: Address;
  enforcers: MandateEnforcers;
  /** Asset base units per chip. */
  chipValue: bigint;
  policy: BuyInMandatePolicy;
  /** Milliseconds. Injected so the terms are testable and the caller owns the clock. */
  now: number;
}

/** Turn the house policy plus the chip value into the caveat terms a player is asked to sign. */
export function buyInMandateTerms(input: BuyInMandateTermsInput): BuyInMandateTerms {
  const { policy } = input;
  if (!Number.isInteger(policy.maxBuyInChips) || policy.maxBuyInChips <= 0) {
    throw new TreasuryError('bad-mandate', `maxBuyInChips must be a positive integer, got ${policy.maxBuyInChips}`);
  }
  if (!Number.isInteger(policy.maxBuyIns) || policy.maxBuyIns <= 0) {
    throw new TreasuryError('bad-mandate', `maxBuyIns must be a positive integer, got ${policy.maxBuyIns}`);
  }
  if (input.chipValue <= 0n) throw new TreasuryError('bad-chip-value', `chipValue must be > 0, got ${input.chipValue}`);
  const perCharge = BigInt(policy.maxBuyInChips) * input.chipValue;
  return {
    payee: input.payee,
    asset: input.asset,
    enforcers: input.enforcers,
    maxAmountPerCharge: perCharge,
    maxAggregate: perCharge * BigInt(policy.maxBuyIns),
    maxRedemptionsPerWindow: policy.maxBuyIns,
    windowSeconds: policy.windowSeconds,
    validUntil: Math.floor(input.now / 1000) + policy.validForSeconds,
  };
}

/* ------------------------------------------------------- the unsigned delegation */

export interface UnsignedBuyInMandateInput {
  /** The PLAYER'S TREASURY. Never their person agent: an identity is not a source of funds. */
  treasury: Address;
  /** The house agent that redeems it — `HOUSE_DELEGATE`. */
  houseDelegate: Address;
  terms: BuyInMandateTerms;
  /** Distinguishes two mandates with identical terms. Milliseconds is plenty. */
  salt: bigint;
}

/**
 * The delegation a player signs, before their signature. Delegator is the TREASURY, which is the
 * account the money leaves; the house is the delegate.
 */
export function unsignedBuyInMandate(input: UnsignedBuyInMandateInput): Delegation {
  return {
    delegator: input.treasury,
    delegate: input.houseDelegate,
    authority: ROOT_AUTHORITY,
    caveats: buildBuyInMandateCaveats(input.terms),
    salt: input.salt,
    signature: '0x' as Hex,
  };
}

/**
 * The EIP-712 digest the treasury's custodian signs. Straight `hashDelegation`, re-exported under a
 * name that says what it is for, so every path — the browser ceremony, a demo persona's server-side
 * signature, and the test script — hashes the SAME bytes.
 */
export function buyInMandateDigest(mandate: Delegation, chainId: number, delegationManager: Address): Hex {
  return hashDelegation(mandate, chainId, delegationManager);
}

/* ------------------------------------------------------------------ checking one */

/** A delegation as it comes back off the wire or out of a session record: strings, not bigints. */
function coerceDelegation(value: unknown): Delegation | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const addr = (v: unknown): Address | null =>
    typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? (v.trim() as Address) : null;
  const delegator = addr(o.delegator);
  const delegate = addr(o.delegate);
  const authority = typeof o.authority === 'string' && /^0x[0-9a-fA-F]{64}$/.test(o.authority) ? (o.authority as Hex) : null;
  const signature = typeof o.signature === 'string' && /^0x[0-9a-fA-F]*$/.test(o.signature) ? (o.signature as Hex) : null;
  if (!delegator || !delegate || !authority || !signature) return null;
  if (!Array.isArray(o.caveats)) return null;
  const caveats: Caveat[] = [];
  for (const raw of o.caveats) {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const enforcer = addr(c.enforcer);
    const terms = typeof c.terms === 'string' && /^0x[0-9a-fA-F]*$/.test(c.terms) ? (c.terms as Hex) : null;
    if (!enforcer || !terms) return null;
    caveats.push({ enforcer, terms, args: (typeof c.args === 'string' ? c.args : '0x') as Hex });
  }
  let salt: bigint;
  try {
    salt = typeof o.salt === 'bigint' ? o.salt : BigInt((o.salt ?? 0) as string | number);
  } catch {
    return null;
  }
  return { delegator, delegate, authority, caveats, salt, signature };
}

/** Read a stored mandate back into a `Delegation`, or null when it is not one. */
export function asBuyInMandate(value: unknown): Delegation | null {
  return coerceDelegation(value);
}

export interface BuyInMandateExpectation {
  /** The treasury this session actually spends from. */
  treasury: Address;
  /** The house agent this deployment redeems as. */
  houseDelegate: Address;
  /**
   * Other house accounts a mandate may legitimately name as its redeemer. The Home decides the
   * redeemer from ITS config, so accepting only one address turns a change there into a flag-day
   * that refuses every mandate minted on the other side of it. What bounds the money is the payment
   * caveat's payee, checked below and enforced on chain.
   */
  alsoAcceptedDelegates?: readonly Address[];
  /** Where buy-ins must land. */
  payee: Address;
  asset: Address;
  paymentEnforcer: Address;
  /**
   * The sentinel `delegate` this chain's DelegationManager treats as "any redeemer" — a mandate
   * carrying it may be redeemed by the house even though it names somebody else. INJECTED, because
   * it is an address and this package names none.
   */
  openDelegate?: Address;
  /** The movement being authorised right now, in base units. Omit to check the mandate alone. */
  amount?: bigint;
  /**
   * What the settlement asset is CALLED (`SHQ`), for the one refusal here that quotes an amount a
   * player has to act on. Optional, and injected: this package names no currency, so absent the
   * sentence states the number and no ticker rather than a ticker nobody configured.
   */
  assetSymbol?: string;
  /** Milliseconds. */
  now: number;
}

/**
 * Why this mandate does not authorise this movement, in one sentence — or null when it does.
 *
 * Everything here is checked OFF chain, before a seat is credited, precisely so the refusal names
 * the missing thing instead of arriving as a reverted UserOp an hour later. The on-chain enforcers
 * remain the authority; this is the same arithmetic, said early.
 */
export function checkBuyInMandate(value: unknown, expect: BuyInMandateExpectation): string | null {
  const mandate = coerceDelegation(value);
  if (!mandate) return 'the stored buy-in mandate is not a delegation this card room can read';
  if (mandate.signature === '0x' || mandate.signature.length < 4) return 'the buy-in mandate carries no signature';
  const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  // How to write an amount in the one refusal here that quotes money. The ticker is the host's.
  const ticker = (expect.assetSymbol ?? '').trim();
  const money = (v: bigint): string => (ticker === '' ? formatAmount(v) : `${formatAmount(v)} ${ticker}`);

  if (!eq(mandate.delegator, expect.treasury)) {
    return (
      `the buy-in mandate was signed by ${mandate.delegator}, but this session spends from ${expect.treasury} — ` +
      `sign a mandate for the treasury you are using`
    );
  }
  // WHICH house account may present the mandate.
  //
  // The Home decides this, and its answer changes with configuration: a `pull` mandate with no
  // declared redeemer names the PAYEE, while one that declares a redeemer names that instead. Both
  // are this card room — the service agent and the treasury share a custodian — so a mandate naming
  // either is legitimate, and pinning a single address here turns a Home config change into a
  // flag-day where every mandate minted on the other side of it is refused. What actually bounds the
  // money is the payment caveat's payee, checked below and enforced on chain; the redeemer only says
  // who may present it.
  const accepted = [expect.houseDelegate, ...(expect.alsoAcceptedDelegates ?? [])];
  const openToAnyone = expect.openDelegate !== undefined && eq(mandate.delegate, expect.openDelegate);
  if (!accepted.some((a) => eq(mandate.delegate, a)) && !openToAnyone) {
    return (
      `the buy-in mandate is delegated to ${mandate.delegate}, but this card room redeems as ` +
      `${accepted.join(' or ')}`
    );
  }

  const payment = mandate.caveats.find((c) => eq(c.enforcer, expect.paymentEnforcer));
  if (!payment) {
    return 'the buy-in mandate has no payment caveat, so nothing on chain caps what the card room could take';
  }
  let terms: ReturnType<typeof decodePaymentTerms>;
  try {
    terms = decodePaymentTerms(payment.terms);
  } catch (e) {
    return `the buy-in mandate's payment caveat cannot be read: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!eq(terms.payee, expect.payee)) {
    return `the buy-in mandate pays ${terms.payee}, which is not this card room's treasury ${expect.payee}`;
  }
  if (!eq(terms.asset, expect.asset)) {
    return `the buy-in mandate is denominated in ${terms.asset}, but this table settles in ${expect.asset}`;
  }
  if (expect.amount !== undefined && terms.maxAmountPerCharge < expect.amount) {
    return (
      `the buy-in mandate allows at most ${money(terms.maxAmountPerCharge)} per buy-in, ` +
      `and this one costs ${money(expect.amount)} — sign a new mandate or buy in for less`
    );
  }

  const timestamp = mandate.caveats.find((c) => c !== payment && isTimestampTerms(c.terms));
  if (timestamp) {
    let window: { validAfter: bigint; validUntil: bigint };
    try {
      window = decodeTimestampTerms(timestamp.terms);
    } catch {
      return null; // not a timestamp caveat after all; the payment cap still stands
    }
    const nowSeconds = BigInt(Math.floor(expect.now / 1000));
    if (window.validUntil > 0n && window.validUntil <= nowSeconds) {
      return `the buy-in mandate expired at ${new Date(Number(window.validUntil) * 1000).toISOString()} — sign a new one`;
    }
    if (window.validAfter > nowSeconds) {
      return `the buy-in mandate is not valid until ${new Date(Number(window.validAfter) * 1000).toISOString()}`;
    }
  }
  return null;
}

/** Timestamp terms are exactly two words; anything else is a different caveat. */
function isTimestampTerms(terms: Hex): boolean {
  return terms.length === 2 + 128;
}
