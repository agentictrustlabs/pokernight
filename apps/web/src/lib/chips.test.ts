import { describe, expect, it } from 'vitest';
import { MAX_COLUMNS, MAX_PER_COLUMN, chipBreakdown, chipUnit, chipsFor, denominations, discCount } from './chips';

const plain = (amount: number, bb = 2) => chipsFor(amount, bb).columns.map((c) => [c.value, c.count, c.tone]);

describe('chipUnit', () => {
  it('is 1 at micro blinds and scales by powers of ten', () => {
    expect(chipUnit(2)).toBe(1);
    expect(chipUnit(1)).toBe(1);
    expect(chipUnit(5)).toBe(1);
    expect(chipUnit(20)).toBe(10);
    expect(chipUnit(200)).toBe(100);
  });
  it('never returns zero for nonsense input', () => {
    expect(chipUnit(0)).toBe(1);
    expect(chipUnit(-4)).toBe(1);
    expect(chipUnit(Number.NaN)).toBe(1);
  });
});

describe('denominations', () => {
  it('is the casino ladder scaled by the unit', () => {
    expect(denominations(2).map((d) => d.value)).toEqual([1, 5, 25, 100, 500]);
    expect(denominations(2).map((d) => d.tone)).toEqual(['white', 'red', 'green', 'slate', 'purple']);
    expect(denominations(20).map((d) => d.value)).toEqual([10, 50, 250, 1000, 5000]);
  });
});

describe('chipBreakdown', () => {
  it('gives a 200 stack at 1/2 blinds visible height in green 25s', () => {
    expect(plain(200)).toEqual([[25, 8, 'green']]);
  });

  it('makes change downwards from the top denomination', () => {
    expect(plain(194)).toEqual([
      [25, 7, 'green'],
      [5, 3, 'red'],
      [1, 4, 'white'],
    ]);
    expect(plain(34)).toEqual([
      [5, 6, 'red'],
      [1, 4, 'white'],
    ]);
  });

  it('prefers mass over a wall of small chips', () => {
    // 88 is three greens, two reds and three whites — not seventeen fives.
    expect(plain(88)).toEqual([
      [25, 3, 'green'],
      [5, 2, 'red'],
      [1, 3, 'white'],
    ]);
  });

  it('keeps small amounts as small chips', () => {
    expect(plain(8)).toEqual([[1, 8, 'white']]);
    expect(plain(2)).toEqual([[1, 2, 'white']]);
  });

  it('draws nothing for zero', () => {
    const b = chipsFor(0, 2);
    expect(b.columns).toEqual([]);
    expect(b.truncated).toBe(false);
    expect(discCount(b)).toBe(0);
  });

  it('splits one denomination across columns rather than making a tower', () => {
    // 1000 = ten 100s: two columns, eight and two.
    expect(plain(1000)).toEqual([
      [100, 8, 'slate'],
      [100, 2, 'slate'],
    ]);
  });

  it('caps the drawing and says so; the number carries the precision', () => {
    const b = chipsFor(100_000, 2);
    expect(b.columns).toHaveLength(MAX_COLUMNS);
    expect(b.columns.every((c) => c.count <= MAX_PER_COLUMN)).toBe(true);
    expect(b.amount).toBe(100_000);
    expect(b.drawn).toBeLessThan(b.amount);
    expect(b.truncated).toBe(true);
    expect(discCount(b)).toBe(MAX_COLUMNS * MAX_PER_COLUMN);
  });

  it('respects tighter caps for tight spots', () => {
    const b = chipsFor(194, 2, { maxColumns: 2, maxPerColumn: 4 });
    expect(b.columns).toHaveLength(2);
    expect(b.columns.every((c) => c.count <= 4)).toBe(true);
    expect(b.truncated).toBe(true);
  });

  it('still shows one disc when the amount is below the smallest chip', () => {
    const b = chipsFor(3, 20); // unit 10, so 3 chips is sub-denomination
    expect(b.columns).toEqual([{ value: 10, count: 1, tone: 'white' }]);
    expect(b.truncated).toBe(true);
  });

  it('ignores junk denominations', () => {
    expect(chipBreakdown(10, []).columns).toEqual([]);
    expect(chipBreakdown(-5, denominations(2)).columns).toEqual([]);
  });
});
