/**
 * The dual-unit formatter. Pure, so it is tested at the edges rather than looked at in a browser:
 * nothing, one chip at both of the rates this deployment has ever used, a stack big enough to break
 * a float, and a rate that does not divide into round money.
 */
import { describe, expect, it } from 'vitest';
import {
  affordableChips,
  describeMode,
  buyInShortfall,
  describeRange,
  describeRate,
  dualAmount,
  fmtAsset,
  tableRate,
} from './money';

/** The rate every table created before this change carries: 1 chip = 0.01 SHQ. */
const CENT = tableRate('mandate-transfer', '10000');
/** The deployment default now: 1 chip = 1 SHQ. */
const DOLLAR = tableRate('mandate-transfer', '1000000');

describe('tableRate', () => {
  it('is null on a play-money table — chips are the whole story there', () => {
    expect(tableRate('play-money', '1000000')).toBeNull();
  });

  it('is null when the table has not said what a chip is worth, rather than guessing one', () => {
    expect(tableRate('mandate-transfer', null)).toBeNull();
    expect(tableRate('mandate-transfer', undefined)).toBeNull();
    expect(tableRate('mandate-transfer', '')).toBeNull();
    expect(tableRate('mandate-transfer', '0')).toBeNull();
    expect(tableRate('mandate-transfer', 'one dollar')).toBeNull();
    expect(tableRate(undefined, '1000000')).toBeNull();
  });

  /**
   * The card room minted a coin of its own, so the ticker is a property of the TABLE and arrives on
   * the wire with the rate. A table that names none is one that predates the coin, and those settle
   * in SHQ — putting today's ticker on them would be the wrong word beside a real amount of money.
   */
  it('names the currency the TABLE states, and falls back to SHQ only for a table that states none', () => {
    expect(tableRate('mandate-transfer', '1000000', 'SHQ')?.asset).toBe('SHQ');
    expect(tableRate('mandate-transfer', '1000000')?.asset).toBe('SHQ');
    expect(tableRate('mandate-transfer', '1000000', '  ')?.asset).toBe('SHQ');
    expect(dualAmount(200, tableRate('mandate-transfer', '1000000', 'SHQ')).assetLabel).toBe('200.00 SHQ');
    expect(describeRate(tableRate('mandate-transfer', '1000000', 'SHQ'))).toBe('1 chip = 1.00 SHQ');
    // Two tables, two coins, at the same instant. Neither label is the deployment's.
    expect(describeMode('mandate-transfer', tableRate('mandate-transfer', '1000000', 'SHQ')).label).toBe('SHQ');
    expect(describeMode('mandate-transfer', tableRate('mandate-transfer', '10000')).label).toBe('SHQ');
  });

  it('reads a settled table’s pinned rate', () => {
    expect(CENT).toEqual({ chipValue: 10_000n, asset: 'SHQ' });
    expect(DOLLAR).toEqual({ chipValue: 1_000_000n, asset: 'SHQ' });
  });
});

describe('fmtAsset', () => {
  it('shows money with cents, never bare', () => {
    expect(fmtAsset(0n)).toBe('0.00');
    expect(fmtAsset(1_000_000n)).toBe('1.00');
    expect(fmtAsset(1_500_000n)).toBe('1.50');
    expect(fmtAsset(10_000n)).toBe('0.01');
  });

  it('keeps every place a non-round rate produces rather than rounding money away', () => {
    expect(fmtAsset(1_234_567n)).toBe('1.234567');
    expect(fmtAsset(333_333n)).toBe('0.333333');
    expect(fmtAsset(1n)).toBe('0.000001');
  });

  it('groups thousands and keeps the sign', () => {
    expect(fmtAsset(1_234_000_000n)).toBe('1,234.00');
    expect(fmtAsset(-2_500_000n)).toBe('-2.50');
  });
});

describe('dualAmount', () => {
  it('says chips only where there is no rate', () => {
    const d = dualAmount(200, null);
    expect(d.chipsText).toBe('200');
    expect(d.assetText).toBeNull();
    expect(d.assetLabel).toBeNull();
    expect(d.label).toBe('200 chips');
  });

  it('carries both units at the boundaries', () => {
    expect(dualAmount(0, DOLLAR)).toMatchObject({ chipsText: '0', assetText: '0.00', label: '0 chips · 0.00 SHQ' });
    expect(dualAmount(1, DOLLAR)).toMatchObject({ chipsText: '1', assetLabel: '1.00 SHQ' });
    expect(dualAmount(1, CENT)).toMatchObject({ chipsText: '1', assetLabel: '0.01 SHQ' });
  });

  it('reads the same 200 chips as 2.00 or 200.00 SHQ depending on the TABLE’s rate', () => {
    expect(dualAmount(200, CENT).assetLabel).toBe('2.00 SHQ');
    expect(dualAmount(200, DOLLAR).assetLabel).toBe('200.00 SHQ');
  });

  it('survives a stack far larger than any table deals with, exactly', () => {
    const big = dualAmount(9_007_199_254, DOLLAR);
    expect(big.chipsText).toBe('9,007,199,254');
    expect(big.assetText).toBe('9,007,199,254.00');
    expect(dualAmount(1_000_000_000, CENT).assetText).toBe('10,000,000.00');
  });

  it('shows the odd places a non-round rate produces instead of hiding them', () => {
    const odd = tableRate('mandate-transfer', '333333');
    expect(dualAmount(1, odd).assetLabel).toBe('0.333333 SHQ');
    expect(dualAmount(3, odd).assetLabel).toBe('0.999999 SHQ');
    expect(dualAmount(7, tableRate('mandate-transfer', '1')).assetLabel).toBe('0.000007 SHQ');
  });

  it('reads a broken number as nothing rather than putting NaN on a money surface', () => {
    expect(dualAmount(Number.NaN, DOLLAR)).toMatchObject({ chipsText: '0', assetText: '0.00' });
    expect(dualAmount(12.7, DOLLAR)).toMatchObject({ chipsText: '12', assetText: '12.00' });
  });
});

describe('describeRate and describeRange', () => {
  it('states the terms of the table in one line', () => {
    expect(describeRate(DOLLAR)).toBe('1 chip = 1.00 SHQ');
    expect(describeRate(CENT)).toBe('1 chip = 0.01 SHQ');
    expect(describeRate(null)).toBeNull();
  });

  it('gives a buy-in range in both units, and in chips alone on play money', () => {
    expect(describeRange(40, 200, DOLLAR)).toBe('40–200 chips · 40.00–200.00 SHQ');
    expect(describeRange(40, 200, CENT)).toBe('40–200 chips · 0.40–2.00 SHQ');
    expect(describeRange(40, 200, null)).toBe('40–200 chips');
  });
});

describe('buyInShortfall', () => {
  it('names the shortfall in the asset, not just "not enough"', () => {
    const s = buyInShortfall(200, '1000000', DOLLAR);
    expect(s).not.toBeNull();
    expect(s!.short).toBe(199_000_000n);
    expect(s!.reason).toContain('holds 1.00 SHQ');
    expect(s!.reason).toContain('costs 200.00 SHQ');
    expect(s!.reason).toContain('199.00 SHQ short');
  });

  it('is null when the treasury covers it, exactly to the base unit', () => {
    expect(buyInShortfall(200, '200000000', DOLLAR)).toBeNull();
    expect(buyInShortfall(200, '199999999', DOLLAR)?.short).toBe(1n);
  });

  it('says nothing where there is nothing to say: play money, no balance, no buy-in', () => {
    expect(buyInShortfall(200, '0', null)).toBeNull();
    expect(buyInShortfall(200, null, DOLLAR)).toBeNull();
    expect(buyInShortfall(0, '0', DOLLAR)).toBeNull();
  });
});

describe('affordableChips', () => {
  it('floors: a part-chip buys no chip', () => {
    expect(affordableChips('125000000', DOLLAR)).toBe(125);
    expect(affordableChips('125999999', DOLLAR)).toBe(125);
    expect(affordableChips('125000000', CENT)).toBe(12_500);
    expect(affordableChips('0', DOLLAR)).toBe(0);
    expect(affordableChips('999999', DOLLAR)).toBe(0);
  });

  it('is null where there is no rate or no balance to divide', () => {
    expect(affordableChips('1000000', null)).toBeNull();
    expect(affordableChips(null, DOLLAR)).toBeNull();
  });
});

describe('describeMode', () => {
  it('says what sitting down will actually do, before it is done', () => {
    const money = describeMode('mandate-transfer', DOLLAR);
    expect(money.settles).toBe(true);
    expect(money.label).toBe('SHQ');
    expect(money.line).toContain('moves real money out of your treasury');
    expect(money.line).toContain('1 chip = 1.00 SHQ');
  });

  it('is honest about play money rather than silent about it', () => {
    const play = describeMode('play-money', null);
    expect(play.settles).toBe(false);
    expect(play.label).toBe('Play money');
    expect(play.line).toContain('Nothing moves on chain');
    // An unknown mode is not assumed to be money.
    expect(describeMode(undefined, null).settles).toBe(false);
  });

  it('still names the mode when the rate has not arrived yet', () => {
    expect(describeMode('mandate-transfer', null).line).toBe('Settles in SHQ. Buying in moves real money out of your treasury.');
  });
});
