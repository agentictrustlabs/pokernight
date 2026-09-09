import { describe, expect, it } from 'vitest';
import { tableRate } from './money';
import {
  describeSettlement,
  fmtUsdc,
  isTreasuryAddress,
  kindLabel,
  seatBlock,
  seatBlocker,
  shortRef,
  statusOf,
  type SettlementEntry,
  type TreasuryView,
} from './treasury';

const entry = (over: Partial<SettlementEntry> = {}): SettlementEntry => ({
  id: 'e1',
  seat: 0,
  kind: 'buy-in',
  chips: 200,
  handNo: null,
  at: 1_700_000_000_000,
  receipt: null,
  ...over,
});

describe('fmtUsdc', () => {
  it('renders base units as USDC without trailing noise', () => {
    expect(fmtUsdc('2000000')).toBe('2');
    expect(fmtUsdc('2500000')).toBe('2.5');
    expect(fmtUsdc('1')).toBe('0.000001');
    expect(fmtUsdc(0n)).toBe('0');
    expect(fmtUsdc('-2000000')).toBe('-2');
  });

  it('answers null for anything it cannot read, rather than "NaN"', () => {
    expect(fmtUsdc(null)).toBeNull();
    expect(fmtUsdc('')).toBeNull();
    expect(fmtUsdc('not a number')).toBeNull();
  });
});

describe('statusOf', () => {
  it('reads a receipt with no status as settled, which is what a play-money row is', () => {
    expect(statusOf({ mode: 'play-money', orderId: 'o', amount: '0', asset: 'play', ref: 'play:o', at: 1 })).toBe('settled');
  });
  it('is null when nothing has been recorded at all', () => {
    expect(statusOf(null)).toBeNull();
  });
});

describe('describeSettlement', () => {
  it('says a pending movement is waiting on the chain', () => {
    const e = entry({ receipt: { mode: 'mandate-transfer', orderId: 'o', amount: '2000000', asset: '0xa5', ref: '', at: 1, status: 'pending' } });
    expect(describeSettlement(e)).toBe('Buy-in of 200 chips (2.00 USDC) — waiting for the chain');
    // The TABLE's currency, where the table names one. A row is about money that already moved at a
    // particular table, so it is labelled with that table's coin and not with the deployment's.
    expect(describeSettlement(e, 'SHQ')).toBe('Buy-in of 200 chips (2.00 SHQ) — waiting for the chain');
  });

  it('carries the reason forward when a movement failed', () => {
    const e = entry({
      kind: 'cash-out',
      chips: -200,
      receipt: {
        mode: 'mandate-transfer',
        orderId: 'o',
        amount: '2000000',
        asset: '0xa5',
        ref: '',
        at: 1,
        status: 'failed',
        error: 'the house treasury holds 1.000000 USDC',
      },
    });
    expect(describeSettlement(e)).toBe('Cash-out of 200 chips (2.00 USDC) — did not settle: the house treasury holds 1.000000 USDC');
  });

  it('never renders a bare "failed" with nothing after it', () => {
    const e = entry({ receipt: { mode: 'mandate-transfer', orderId: 'o', amount: '2000000', asset: '0xa5', ref: '', at: 1, status: 'failed' } });
    expect(describeSettlement(e)).toMatch(/did not settle: no reason recorded/);
  });

  it('calls play money what it is instead of quoting 0 USDC', () => {
    const e = entry({ receipt: { mode: 'play-money', orderId: 'o', amount: '0', asset: 'play', ref: 'play:o', at: 1 } });
    expect(describeSettlement(e)).toBe('Buy-in of 200 chips — play money');
  });

  it('says a row with no receipt at all is not settled', () => {
    expect(describeSettlement(entry())).toBe('Buy-in of 200 chips — not settled');
  });
});

describe('kindLabel', () => {
  it('turns wire kinds into words, and passes unknown ones through untouched', () => {
    expect(kindLabel('buy-in')).toBe('Buy-in');
    expect(kindLabel('add-chips')).toBe('Rebuy');
    expect(kindLabel('cash-out')).toBe('Cash-out');
    expect(kindLabel('something-new')).toBe('something-new');
  });
});

describe('isTreasuryAddress', () => {
  it('accepts a 20-byte hex address and nothing else', () => {
    expect(isTreasuryAddress(`0x${'ab'.repeat(20)}`)).toBe(true);
    expect(isTreasuryAddress(`  0x${'ab'.repeat(20)}  `)).toBe(true);
    expect(isTreasuryAddress('0xabc')).toBe(false);
    expect(isTreasuryAddress('alice.me')).toBe(false);
  });
});

describe('shortRef', () => {
  it('keeps both ends of a hash and elides the middle', () => {
    const tx = `0x${'ab'.repeat(32)}`;
    expect(shortRef(tx)).toBe('0xababab…ababab');
    expect(shortRef('0xabcd')).toBe('0xabcd');
  });
});

describe('seatBlock', () => {
  /** The rate of a table opened before the default moved, and of one opened after it. */
  const CENT = tableRate('mandate-transfer', '10000');
  const DOLLAR = tableRate('mandate-transfer', '1000000');

  const view = (over: Partial<TreasuryView> = {}): TreasuryView => ({
    chainId: 34348,
    asset: '0xa5',
    chipValue: '10000',
    person: `0x${'11'.repeat(20)}`,
    personName: 'alice.me',
    chosen: null,
    chosenName: null,
    balance: null,
    balanceUsdc: null,
    candidates: [],
    discoveryError: null,
    create: { mode: 'server', portalUrl: null, canName: true },
    mandate: {
      present: false,
      treasury: null,
      maxPerBuyIn: '200000000',
      sessionTotal: '1000000000',
      maxBuyIns: 5,
      validUntil: 2_000_000_000,
      payee: `0x${'a0'.repeat(20)}`,
      asset: '0xa5',
      problem: null,
      unavailable: null,
    },
    faucet: { available: true, asset: 'Mock USD Coin', reason: null },
    notice: null,
    unavailable: null,
    ...over,
  });

  const candidate = { address: `0x${'ab'.repeat(20)}`, name: 'alice.treasury', label: 'alice.treasury', balance: '5000000', balanceUsdc: '5.000000' };
  const ready = (over: Partial<TreasuryView> = {}): TreasuryView =>
    view({
      candidates: [candidate],
      chosen: candidate.address,
      chosenName: candidate.name,
      balance: candidate.balance,
      balanceUsdc: candidate.balanceUsdc,
      ...over,
    });

  it('never blocks a play-money seat', () => {
    expect(seatBlock('play-money', null)).toBeNull();
    expect(seatBlock('play-money', view({ unavailable: 'no ASSET' }))).toBeNull();
  });

  it('passes the deployment’s own reason through when the money layer is down', () => {
    expect(seatBlock('mandate-transfer', view({ unavailable: 'ASSET is not set to an address' }))).toEqual({
      reason: 'ASSET is not set to an address',
      action: 'configure',
    });
  });

  it('asks for a treasury to EXIST before it asks for one to be chosen', () => {
    const b = seatBlock('mandate-transfer', view());
    expect(b?.action).toBe('create-treasury');
    // The whole correction, in the words a player reads: the money account is a thing of their own
    // and separate from the identity they signed in with — never a substitute for it.
    expect(b?.reason).toMatch(/apart from the identity you signed in with/);
  });

  it('asks for a choice once there is something to choose', () => {
    expect(seatBlock('mandate-transfer', view({ candidates: [candidate] }))).toEqual({
      reason: 'Pick which of your money accounts pays for this seat.',
      action: 'choose-treasury',
    });
  });

  it('asks for money before it asks for a signature, and names the shortfall in USDC', () => {
    const b = seatBlock('mandate-transfer', ready(), 100_000, CENT);
    expect(b?.action).toBe('fund-treasury');
    expect(b?.reason).toMatch(/holds 5.00 USDC/);
    expect(b?.reason).toMatch(/100,000-chip buy-in costs 1,000.00 USDC/);
    expect(b?.reason).toMatch(/995.00 USDC short/);
  });

  /**
   * The whole of bug 1, said in the client's voice: the SAME buy-in at the SAME treasury is
   * affordable at the rate its table was created with and unaffordable at the deployment's new
   * one. Only the table's own rate may decide.
   */
  it('prices the buy-in at the TABLE’s rate, never at the deployment default', () => {
    expect(seatBlock('mandate-transfer', ready({ mandate: { ...view().mandate, present: true } }), 200, CENT)).toBeNull();
    const dearer = seatBlock('mandate-transfer', ready({ mandate: { ...view().mandate, present: true } }), 200, DOLLAR);
    expect(dearer?.action).toBe('fund-treasury');
    expect(dearer?.reason).toMatch(/195.00 USDC short/);
  });

  it('does not price the buy-in at all when the table has not said what a chip is worth', () => {
    // A wrong price is worse than no price: without the table's rate the affordability check is
    // skipped and the server has the last word.
    expect(seatBlock('mandate-transfer', ready({ mandate: { ...view().mandate, present: true } }), 100_000)).toBeNull();
  });

  it('asks for a mandate once the treasury is chosen and funded', () => {
    const b = seatBlock('mandate-transfer', ready(), 200, CENT);
    expect(b?.action).toBe('sign-mandate');
    expect(b?.reason).toMatch(/Money leaves your account only under an authority you sign at your Home/);
  });

  it('carries the mandate’s own problem forward rather than saying "not authorised"', () => {
    const b = seatBlock('mandate-transfer', ready({ mandate: { ...view().mandate, problem: 'the buy-in mandate expired at 2026-01-01' } }), 200, CENT);
    expect(b).toEqual({ reason: 'the buy-in mandate expired at 2026-01-01', action: 'sign-mandate' });
  });

  it('clears once there is a funded treasury and a mandate that covers it', () => {
    expect(seatBlock('mandate-transfer', ready({ mandate: { ...view().mandate, present: true } }), 200, CENT)).toBeNull();
    expect(seatBlocker('mandate-transfer', ready({ mandate: { ...view().mandate, present: true } }), 200, CENT)).toBeNull();
  });
});
