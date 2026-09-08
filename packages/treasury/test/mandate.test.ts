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
  buyInMandateTerms,
  checkBuyInMandate,
  describeBuyInMandate,
  TreasuryError,
  unsignedBuyInMandate,
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

/**
 * `checkBuyInMandate` is where a stored mandate meets the movement it is supposed to authorise. It
 * runs off chain, before a seat is credited, so that a refusal names the missing thing instead of
 * arriving as a reverted UserOp — which means these tests are about the WORDS as much as the answer.
 */
describe('checkBuyInMandate', () => {
  const now = 1_700_000_000_000;
  const policy = { maxBuyInChips: 20_000, maxBuyIns: 5, windowSeconds: 43_200, validForSeconds: 43_200 };
  const terms = buyInMandateTerms({ payee: HOUSE, asset: ASSET, enforcers: ENFORCERS, chipValue: 10_000n, policy, now });
  const signed = (over: Partial<Delegation> = {}): Delegation => ({
    ...unsignedBuyInMandate({ treasury: PLAYER, houseDelegate: HOUSE_DELEGATE, terms, salt: 1n }),
    signature: `0x${'ab'.repeat(65)}` as Hex,
    ...over,
  });
  const expect_ = {
    treasury: PLAYER,
    houseDelegate: HOUSE_DELEGATE,
    payee: HOUSE,
    asset: ASSET,
    paymentEnforcer: ENFORCERS.payment,
    now,
  };

  it('accepts the mandate this table would have asked for', () => {
    expect(checkBuyInMandate(signed(), { ...expect_, amount: 2_000_000n })).toBeNull();
  });

  it('survives the round trip through JSON, where a bigint salt becomes a string', () => {
    const wire = JSON.parse(JSON.stringify({ ...signed(), salt: signed().salt.toString() })) as unknown;
    expect(checkBuyInMandate(wire, expect_)).toBeNull();
  });

  it('refuses a mandate signed by a different treasury, naming both', () => {
    const other = `0x${'b2'.repeat(20)}` as Address;
    const reason = checkBuyInMandate(signed({ delegator: other }), expect_);
    expect(reason).toContain(other);
    expect(reason).toContain(PLAYER);
  });

  it('accepts the open-delegation sentinel the HOST names, which any redeemer may redeem', () => {
    // The sentinel is an address, so it is injected rather than known here (`packages/*` rules).
    const open = '0x0000000000000000000000000000000000000a11' as Address;
    expect(checkBuyInMandate(signed({ delegate: open }), { ...expect_, openDelegate: open })).toBeNull();
    // …and without the host naming it, it is just another stranger.
    expect(checkBuyInMandate(signed({ delegate: open }), expect_)).toContain(open);
  });

  it('refuses one delegated to somebody else entirely', () => {
    const stranger = `0x${'de'.repeat(20)}` as Address;
    expect(checkBuyInMandate(signed({ delegate: stranger }), expect_)).toContain(stranger);
  });

  it('refuses one that pays a treasury which is not the house’s', () => {
    const elsewhere = buyInMandateTerms({ payee: `0x${'99'.repeat(20)}` as Address, asset: ASSET, enforcers: ENFORCERS, chipValue: 10_000n, policy, now });
    const mandate = { ...unsignedBuyInMandate({ treasury: PLAYER, houseDelegate: HOUSE_DELEGATE, terms: elsewhere, salt: 1n }), signature: `0x${'ab'.repeat(65)}` as Hex };
    expect(checkBuyInMandate(mandate, expect_)).toMatch(/not this card room's treasury/);
  });

  it('refuses a buy-in bigger than the cap, quoting both amounts', () => {
    const reason = checkBuyInMandate(signed(), { ...expect_, amount: 500_000_000n });
    expect(reason).toContain('200.000000');
    expect(reason).toContain('500.000000');
  });

  it('refuses an expired mandate, and says when it expired', () => {
    const later = now + (policy.validForSeconds + 60) * 1000;
    expect(checkBuyInMandate(signed(), { ...expect_, now: later })).toMatch(/expired at/);
  });

  it('refuses an unsigned delegation rather than treating it as authority', () => {
    expect(checkBuyInMandate(signed({ signature: '0x' as Hex }), expect_)).toMatch(/carries no signature/);
  });

  it('refuses something that is not a delegation at all', () => {
    expect(checkBuyInMandate({ hello: 'world' }, expect_)).toMatch(/not a delegation/);
    expect(checkBuyInMandate(null, expect_)).toMatch(/not a delegation/);
  });

  it('refuses a mandate with no payment caveat — nothing on chain would cap it', () => {
    expect(checkBuyInMandate(signed({ caveats: [] }), expect_)).toMatch(/no payment caveat/);
  });
});

describe('buyInMandateTerms', () => {
  it('derives the asset caps from chips and the chip value, so one number decides both', () => {
    const t = buyInMandateTerms({
      payee: HOUSE,
      asset: ASSET,
      enforcers: ENFORCERS,
      chipValue: 10_000n,
      policy: { maxBuyInChips: 200, maxBuyIns: 3, windowSeconds: 3600, validForSeconds: 3600 },
      now: 1_700_000_000_000,
    });
    expect(t.maxAmountPerCharge).toBe(2_000_000n);
    expect(t.maxAggregate).toBe(6_000_000n);
    expect(t.maxRedemptionsPerWindow).toBe(3);
    expect(t.validUntil).toBe(1_700_000_000 + 3600);
  });

  it('refuses to build terms from a nonsense policy rather than capping at zero', () => {
    const bad = { payee: HOUSE, asset: ASSET, enforcers: ENFORCERS, chipValue: 10_000n, now: 1 };
    expect(() => buyInMandateTerms({ ...bad, policy: { maxBuyInChips: 0, maxBuyIns: 3, windowSeconds: 60, validForSeconds: 60 } })).toThrow(TreasuryError);
    expect(() => buyInMandateTerms({ ...bad, policy: { maxBuyInChips: 10, maxBuyIns: 0, windowSeconds: 60, validForSeconds: 60 } })).toThrow(TreasuryError);
  });
});
