import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, fullDeck, hexToBytes, randomSeed, seedCommit, seededShuffle } from '../src/index.js';
import { handSeed } from './random-play.js';

describe('rng', () => {
  it('seededShuffle is deterministic', () => {
    const seed = handSeed(7);
    const a = seededShuffle(fullDeck(), seed);
    const b = seededShuffle(fullDeck(), seed);
    expect(a).toEqual(b);
    expect(a).not.toEqual(fullDeck());
  });

  it('seededShuffle is a permutation and does not mutate its input', () => {
    const deck = fullDeck();
    const snapshot = deck.slice();
    for (let i = 0; i < 200; i++) {
      const out = seededShuffle(deck, handSeed(i));
      expect(out.length).toBe(52);
      expect(new Set(out).size).toBe(52);
      expect(out.slice().sort()).toEqual(snapshot.slice().sort());
    }
    expect(deck).toEqual(snapshot);
  });

  it('different seeds give different orders', () => {
    const a = seededShuffle(fullDeck(), handSeed(1));
    const b = seededShuffle(fullDeck(), handSeed(2));
    expect(a).not.toEqual(b);
  });

  it('rejects short seeds', () => {
    expect(() => seededShuffle(fullDeck(), new Uint8Array(8))).toThrow();
  });

  it('seedCommit is sha256 hex and hex helpers round-trip', () => {
    const seed = randomSeed();
    expect(seed.length).toBe(32);
    const commit = seedCommit(seed);
    expect(commit).toMatch(/^[0-9a-f]{64}$/);
    expect(commit).toBe(bytesToHex(sha256(seed)));
    expect(hexToBytes(bytesToHex(seed))).toEqual(seed);
  });
});
