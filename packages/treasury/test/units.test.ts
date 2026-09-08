import { describe, expect, it } from 'vitest';
import {
  TreasuryError,
  USDC_DECIMALS,
  USDC_UNIT,
  chipsToUsdc,
  formatUsdc,
  parseUsdc,
  usdcRemainder,
  usdcToChips,
} from '../src/index.js';

// CHIP_VALUE from apps/tables wrangler.toml: 10 000 base units = 0.01 USDC per chip.
const CHIP_VALUE = 10_000n;

describe('usdc constants', () => {
  it('is a 6-decimal asset', () => {
    expect(USDC_DECIMALS).toBe(6);
    expect(USDC_UNIT).toBe(1_000_000n);
  });
});

describe('chipsToUsdc', () => {
  it('converts a buy-in to base units', () => {
    expect(chipsToUsdc(10_000, CHIP_VALUE)).toBe(100_000_000n); // 10k chips = 100 USDC
    expect(chipsToUsdc(1, CHIP_VALUE)).toBe(10_000n);
    expect(chipsToUsdc(0, CHIP_VALUE)).toBe(0n);
  });

  it('stays exact past Number precision', () => {
    // 2^53 base units would lose precision as a double; bigint keeps it.
    expect(chipsToUsdc(9_007_199_254, 1_000_000n)).toBe(9_007_199_254_000_000n);
  });

  it('rejects non-integer, negative, and unsafe chip counts', () => {
    expect(() => chipsToUsdc(1.5, CHIP_VALUE)).toThrow(TreasuryError);
    expect(() => chipsToUsdc(-1, CHIP_VALUE)).toThrow(/non-negative/);
    expect(() => chipsToUsdc(Number.MAX_SAFE_INTEGER + 2, CHIP_VALUE)).toThrow(TreasuryError);
  });

  it('rejects a zero or negative chip value', () => {
    expect(() => chipsToUsdc(1, 0n)).toThrow(/chipValue/);
    expect(() => chipsToUsdc(1, -1n)).toThrow(/chipValue/);
  });
});

describe('usdcToChips', () => {
  it('is the inverse of chipsToUsdc on exact multiples', () => {
    for (const chips of [0, 1, 7, 100, 12_345, 1_000_000]) {
      expect(usdcToChips(chipsToUsdc(chips, CHIP_VALUE), CHIP_VALUE)).toBe(chips);
    }
  });

  it('rounds DOWN so a seat is never credited chips that did not arrive', () => {
    expect(usdcToChips(19_999n, CHIP_VALUE)).toBe(1);
    expect(usdcRemainder(19_999n, CHIP_VALUE)).toBe(9_999n);
    expect(usdcToChips(9_999n, CHIP_VALUE)).toBe(0);
  });

  it('never loses value: chips*chipValue + remainder === amount', () => {
    for (const amount of [0n, 1n, 9_999n, 10_000n, 10_001n, 123_456_789n]) {
      const chips = usdcToChips(amount, CHIP_VALUE);
      expect(chipsToUsdc(chips, CHIP_VALUE) + usdcRemainder(amount, CHIP_VALUE)).toBe(amount);
    }
  });

  it('rejects negative amounts and overflowing chip counts', () => {
    expect(() => usdcToChips(-1n, CHIP_VALUE)).toThrow(TreasuryError);
    expect(() => usdcToChips((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * CHIP_VALUE, CHIP_VALUE)).toThrow(
      /MAX_SAFE_INTEGER/,
    );
  });
});

describe('formatUsdc / parseUsdc', () => {
  it('formats base units with six decimal places', () => {
    expect(formatUsdc(0n)).toBe('0.000000');
    expect(formatUsdc(1n)).toBe('0.000001');
    expect(formatUsdc(1_000_000n)).toBe('1.000000');
    expect(formatUsdc(1_000_000_000_000n)).toBe('1000000.000000');
    expect(formatUsdc(-2_500_000n)).toBe('-2.500000');
  });

  it('round-trips', () => {
    for (const v of [0n, 1n, 999_999n, 1_000_000n, 1_000_000_000_000n]) {
      expect(parseUsdc(formatUsdc(v))).toBe(v);
    }
  });

  it('accepts short decimals and rejects over-precise or malformed input', () => {
    expect(parseUsdc('1.5')).toBe(1_500_000n);
    expect(parseUsdc('42')).toBe(42_000_000n);
    expect(() => parseUsdc('1.0000001')).toThrow(/decimal places/);
    expect(() => parseUsdc('abc')).toThrow(TreasuryError);
  });
});
