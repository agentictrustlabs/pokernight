/**
 * The dealing primitives, tested without a deck.
 *
 * They belong to no game, so nothing here mentions a card: a shuffle that is a pure function of a
 * seed is the property, and it holds for any array. Poker's own test shuffles poker's deck and
 * checks the same primitive against the thing it actually deals.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomSeed, seedCommit, seededShuffle } from '../src/index.js';

const seed = (n: number): Uint8Array => new Uint8Array(32).fill(n);
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('the seed and its commitment', () => {
  it('draws 32 bytes, and two draws differ', () => {
    const a = randomSeed();
    expect(a).toHaveLength(32);
    expect(bytesToHex(a)).not.toBe(bytesToHex(randomSeed()));
  });

  it('commits to the seed as hex sha256, which is what a player can check afterwards', () => {
    const s = seed(7);
    expect(seedCommit(s)).toBe(bytesToHex(sha256(s)));
    expect(seedCommit(s)).toHaveLength(64);
  });

  it('round-trips hex, so a revealed seed is the seed that was committed', () => {
    const s = randomSeed();
    expect(bytesToHex(hexToBytes(bytesToHex(s)))).toBe(bytesToHex(s));
    expect(() => hexToBytes('abc')).toThrow(/odd hex/);
  });
});

describe('the shuffle', () => {
  it('is a pure function of the seed — the whole fairness claim', () => {
    expect(seededShuffle(range(52), seed(1))).toEqual(seededShuffle(range(52), seed(1)));
    expect(seededShuffle(range(52), seed(1))).not.toEqual(seededShuffle(range(52), seed(2)));
  });

  it('is a permutation: everything dealt, nothing invented', () => {
    const out = seededShuffle(range(108), seed(3));
    expect(out).toHaveLength(108);
    expect([...out].sort((a, b) => a - b)).toEqual(range(108));
  });

  it('does not mutate what it was given', () => {
    const input = range(20);
    const before = input.slice();
    seededShuffle(input, seed(4));
    expect(input).toEqual(before);
  });

  it('refuses a seed too short to be one', () => {
    // Failing loudly beats shuffling from a seed with less entropy than it claims.
    expect(() => seededShuffle(range(10), new Uint8Array(8))).toThrow(/at least 16 bytes/);
  });

  it('handles the degenerate sizes without special-casing at the call site', () => {
    expect(seededShuffle([], seed(5))).toEqual([]);
    expect(seededShuffle(['only'], seed(5))).toEqual(['only']);
  });

  it('reaches many different orderings, so it is not quietly degenerate', () => {
    const seen = new Set(range(200).map((i) => seededShuffle(range(8), seed(i % 200 + 1)).join('')));
    expect(seen.size).toBeGreaterThan(100);
  });
});
