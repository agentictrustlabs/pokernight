import { describe, expect, it } from 'vitest';
import {
  TreasuryError,
  ASSET_DECIMALS,
  ASSET_UNIT,
  chipsToAsset,
  formatMoney,
  formatAmount,
  parseAmount,
  assetRemainder,
  assetToChips,
} from '../src/index.js';

// CHIP_VALUE from apps/tables wrangler.toml: 10 000 base units = 0.01 of the asset per chip.
const CHIP_VALUE = 10_000n;

describe('asset constants', () => {
  it('is a 6-decimal asset', () => {
    expect(ASSET_DECIMALS).toBe(6);
    expect(ASSET_UNIT).toBe(1_000_000n);
  });
});

describe('chipsToAsset', () => {
  it('converts a buy-in to base units', () => {
    expect(chipsToAsset(10_000, CHIP_VALUE)).toBe(100_000_000n); // 10k chips = 100 units
    expect(chipsToAsset(1, CHIP_VALUE)).toBe(10_000n);
    expect(chipsToAsset(0, CHIP_VALUE)).toBe(0n);
  });

  it('stays exact past Number precision', () => {
    // 2^53 base units would lose precision as a double; bigint keeps it.
    expect(chipsToAsset(9_007_199_254, 1_000_000n)).toBe(9_007_199_254_000_000n);
  });

  it('rejects non-integer, negative, and unsafe chip counts', () => {
    expect(() => chipsToAsset(1.5, CHIP_VALUE)).toThrow(TreasuryError);
    expect(() => chipsToAsset(-1, CHIP_VALUE)).toThrow(/non-negative/);
    expect(() => chipsToAsset(Number.MAX_SAFE_INTEGER + 2, CHIP_VALUE)).toThrow(TreasuryError);
  });

  it('rejects a zero or negative chip value', () => {
    expect(() => chipsToAsset(1, 0n)).toThrow(/chipValue/);
    expect(() => chipsToAsset(1, -1n)).toThrow(/chipValue/);
  });
});

describe('assetToChips', () => {
  it('is the inverse of chipsToAsset on exact multiples', () => {
    for (const chips of [0, 1, 7, 100, 12_345, 1_000_000]) {
      expect(assetToChips(chipsToAsset(chips, CHIP_VALUE), CHIP_VALUE)).toBe(chips);
    }
  });

  it('rounds DOWN so a seat is never credited chips that did not arrive', () => {
    expect(assetToChips(19_999n, CHIP_VALUE)).toBe(1);
    expect(assetRemainder(19_999n, CHIP_VALUE)).toBe(9_999n);
    expect(assetToChips(9_999n, CHIP_VALUE)).toBe(0);
  });

  it('never loses value: chips*chipValue + remainder === amount', () => {
    for (const amount of [0n, 1n, 9_999n, 10_000n, 10_001n, 123_456_789n]) {
      const chips = assetToChips(amount, CHIP_VALUE);
      expect(chipsToAsset(chips, CHIP_VALUE) + assetRemainder(amount, CHIP_VALUE)).toBe(amount);
    }
  });

  it('rejects negative amounts and overflowing chip counts', () => {
    expect(() => assetToChips(-1n, CHIP_VALUE)).toThrow(TreasuryError);
    expect(() => assetToChips((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * CHIP_VALUE, CHIP_VALUE)).toThrow(
      /MAX_SAFE_INTEGER/,
    );
  });
});

describe('formatAmount / parseAmount', () => {
  it('formats base units with six decimal places', () => {
    expect(formatAmount(0n)).toBe('0.000000');
    expect(formatAmount(1n)).toBe('0.000001');
    expect(formatAmount(1_000_000n)).toBe('1.000000');
    expect(formatAmount(1_000_000_000_000n)).toBe('1000000.000000');
    expect(formatAmount(-2_500_000n)).toBe('-2.500000');
  });

  it('round-trips', () => {
    for (const v of [0n, 1n, 999_999n, 1_000_000n, 1_000_000_000_000n]) {
      expect(parseAmount(formatAmount(v))).toBe(v);
    }
  });

  it('accepts short decimals and rejects over-precise or malformed input', () => {
    expect(parseAmount('1.5')).toBe(1_500_000n);
    expect(parseAmount('42')).toBe(42_000_000n);
    expect(() => parseAmount('1.0000001')).toThrow(/decimal places/);
    expect(() => parseAmount('abc')).toThrow(TreasuryError);
  });
});

describe('formatMoney', () => {
  it('writes an amount the way a price is written: grouped, two places, no tail of zeros', () => {
    expect(formatMoney(10_000_000_000n)).toBe('10,000.00');
    expect(formatMoney(200_000_000n)).toBe('200.00');
    expect(formatMoney(1_500_000n)).toBe('1.50');
    expect(formatMoney(0n)).toBe('0.00');
  });

  it('keeps the places an amount genuinely has, rather than rounding money away', () => {
    expect(formatMoney(1_234_567n)).toBe('1.234567');
    expect(formatMoney(10_000n)).toBe('0.01');
    expect(formatMoney(1n)).toBe('0.000001');
  });

  it('keeps the sign', () => {
    expect(formatMoney(-2_000_000n)).toBe('-2.00');
  });

  /** `formatAmount` stays the exact form; a receipt is not a sentence. */
  it('does not replace the exact form', () => {
    expect(formatAmount(200_000_000n)).toBe('200.000000');
  });
});
