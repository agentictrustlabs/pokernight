/**
 * The buy-in mandate: what a player is asked to sign, and what the house may do with it.
 *
 * These are the caveats that stand between "the house can take a buy-in" and "the house can empty a
 * player's treasury", so the tests assert the shape of the authority rather than the plumbing: four
 * caveats, one per enforcer, and a redemption that cannot be encoded without the one caveat that
 * caps the spend.
 */

import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { ROOT_AUTHORITY } from '@agenticprimitives/delegation';
import {
  buildBuyInMandateCaveats,
  buildBuyInRedemption,
  describeBuyInMandate,
  TreasuryError,
  type Delegation,
} from '../src/index.js';

const ASSET = '0x00000000000000000000000000000000000000a5' as Address;
const HOUSE = '0x00000000000000000000000000000000000000a0' as Address;
const HOUSE_DELEGATE = '0x00000000000000000000000000000000000000de' as Address;
const PLAYER = '0x00000000000000000000000000000000000000b1' as Address;
const DELEGATION_MANAGER = '0x00000000000000000000000000000000000000dd' as Address;
const ENFORCERS = {
  payment: '0x00000000000000000000000000000000000000ee' as Address,
  timestamp: '0x00000000000000000000000000000000000000e1' as Address,
  allowedTargets: '0x00000000000000000000000000000000000000e2' as Address,
  allowedMethods: '0x00000000000000000000000000000000000000e3' as Address,
};

const TERMS = {
  payee: HOUSE,
  asset: ASSET,
  enforcers: ENFORCERS,
  maxAmountPerCharge: 2_000_000n,
  maxAggregate: 8_000_000n,
  maxRedemptionsPerWindow: 4,
  windowSeconds: 86_400,
  validUntil: 2_000_000_000,
};

function delegation(caveats = buildBuyInMandateCaveats(TERMS)): Delegation {
  return {
    delegator: PLAYER,
    delegate: HOUSE_DELEGATE,
    authority: ROOT_AUTHORITY,
    caveats,
    salt: 7n,
    signature: ('0x' + '33'.repeat(65)) as Hex,
  };
}

describe('buildBuyInMandateCaveats', () => {
  it('composes exactly the four enforcers the payment mandate needs', () => {
    const caveats = buildBuyInMandateCaveats(TERMS);
    expect(caveats.map((c) => c.enforcer)).toEqual([
      ENFORCERS.payment,
      ENFORCERS.timestamp,
      ENFORCERS.allowedTargets,
      ENFORCERS.allowedMethods,
    ]);
    // Terms are set at mint; `args` are filled by the redeemer at redemption time.
    for (const c of caveats) expect(c.terms).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('refuses a session budget smaller than one buy-in', () => {
    expect(() => buildBuyInMandateCaveats({ ...TERMS, maxAggregate: 1_000_000n })).toThrow(TreasuryError);
  });

  it('refuses an expiry that is not a positive unix time', () => {
    expect(() => buildBuyInMandateCaveats({ ...TERMS, validUntil: 0 })).toThrow(/validUntil/);
  });
});

describe('describeBuyInMandate', () => {
  it('says what the player is agreeing to, in base units the caller formats', () => {
    expect(describeBuyInMandate(TERMS)).toEqual({
      recipient: HOUSE,
      asset: ASSET,
      maxAmountPerCharge: 2_000_000n,
      sessionBudget: 8_000_000n,
      maxRedemptionsPerWindow: 4,
      windowSeconds: 86_400,
      expiresAt: 2_000_000_000,
      revocable: true,
    });
  });
});

describe('buildBuyInRedemption', () => {
  const base = {
    payer: PLAYER,
    payee: HOUSE,
    asset: ASSET,
    amount: 2_000_000n,
    chainId: 34348,
    delegationManager: DELEGATION_MANAGER,
    paymentEnforcer: ENFORCERS.payment,
    nonce: 42n,
    expiresAt: 2_000_000_000,
  };

  it('targets the DelegationManager and carries the payee and amount', () => {
    const plan = buildBuyInRedemption({ ...base, delegation: delegation() });
    expect(plan.to).toBe(DELEGATION_MANAGER);
    expect(plan.value).toBe(0n);
    expect(plan.data).toContain(HOUSE.slice(2).toLowerCase());
    expect(plan.mandate.payer).toBe(PLAYER);
    expect(plan.mandate.payee).toBe(HOUSE);
    expect(plan.mandate.maxRedemptions).toBe(1);
  });

  it('refuses to spend from an account the mandate was not signed by', () => {
    const other = '0x00000000000000000000000000000000000000ff' as Address;
    expect(() => buildBuyInRedemption({ ...base, payer: other, delegation: delegation() })).toThrow(
      /was signed by 0x00000000000000000000000000000000000000b1, but the buy-in is being taken from/,
    );
  });

  it('refuses to encode a payment with no on-chain spend cap attached', () => {
    const noPaymentCaveat = buildBuyInMandateCaveats(TERMS).slice(1);
    expect(() => buildBuyInRedemption({ ...base, delegation: delegation(noPaymentCaveat) })).toThrow(
      /cannot be redeemed/,
    );
  });

  it('refuses a non-positive amount', () => {
    expect(() => buildBuyInRedemption({ ...base, amount: 0n, delegation: delegation() })).toThrow(/amount must be > 0/);
  });
});
