import { describe, expect, it } from 'vitest';
import {
  chipsToUsdcLabel,
  describeSettlement,
  fmtUsdc,
  isTreasuryAddress,
  kindLabel,
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

describe('chipsToUsdcLabel', () => {
  it('multiplies chips by the table chip value', () => {
    expect(chipsToUsdcLabel(200, '10000')).toBe('2');
    expect(chipsToUsdcLabel(1, '10000')).toBe('0.01');
  });

  it('declines to guess when the chip value is missing or nonsense', () => {
    expect(chipsToUsdcLabel(200, null)).toBeNull();
    expect(chipsToUsdcLabel(200, '0')).toBeNull();
    expect(chipsToUsdcLabel(200, 'ten')).toBeNull();
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
    expect(describeSettlement(e)).toBe('Buy-in of 2 USDC — waiting for the chain');
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
    expect(describeSettlement(e)).toBe('Cash-out of 2 USDC — did not settle: the house treasury holds 1.000000 USDC');
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

describe('seatBlocker', () => {
  const view = (over: Partial<TreasuryView> = {}): TreasuryView => ({
    chainId: 34348,
    asset: '0xa5',
    chipValue: '10000',
    chosen: null,
    balance: null,
    balanceUsdc: null,
    candidates: [],
    faucet: { available: true, asset: 'Mock USD Coin', reason: null },
    unavailable: null,
    ...over,
  });

  it('never blocks a play-money seat', () => {
    expect(seatBlocker('play-money', null)).toBeNull();
    expect(seatBlocker('play-money', view({ unavailable: 'no ASSET' }))).toBeNull();
  });

  it('asks for a treasury before a settled seat', () => {
    expect(seatBlocker('mandate-transfer', view())).toMatch(/Choose the treasury/);
  });

  it('passes the deployment’s own reason through when the money layer is down', () => {
    expect(seatBlocker('mandate-transfer', view({ unavailable: 'ASSET is not set to an address' }))).toBe(
      'ASSET is not set to an address',
    );
  });

  it('clears once a treasury is chosen', () => {
    expect(seatBlocker('mandate-transfer', view({ chosen: `0x${'ab'.repeat(20)}` }))).toBeNull();
  });
});
