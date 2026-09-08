/**
 * Deterministic shuffle with commit–reveal.
 *
 * The host draws a 32-byte seed per hand, publishes sha256(seed) at hand start
 * and reveals the seed at hand end. The deck order is a pure function of the
 * seed, so anyone can verify after the fact that the shuffle was fixed before
 * any action was taken.
 *
 * PRNG: xoshiro128** seeded from the first 16 bytes of the seed (the rest is
 * ignored but still part of the commitment). Fisher–Yates with rejection
 * sampling so every permutation is equally likely.
 */

import { sha256 } from '@noble/hashes/sha256';

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) throw new Error('odd hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 32 random bytes from the platform CSPRNG (Web Crypto is present in Node ≥ 19 and Workers). */
export function randomSeed(): Uint8Array {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Hex sha256 of the seed — the public commitment. */
export function seedCommit(seed: Uint8Array): string {
  return bytesToHex(sha256(seed));
}

function xoshiro128ss(seed: Uint8Array): () => number {
  const dv = new DataView(seed.buffer, seed.byteOffset, seed.byteLength);
  let s0 = dv.getUint32(0, true) || 0x9e3779b9;
  let s1 = dv.getUint32(4, true) || 0x243f6a88;
  let s2 = dv.getUint32(8, true) || 0xb7e15162;
  let s3 = dv.getUint32(12, true) || 0x6a09e667;
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0);
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };
}

/** Returns a new array: Fisher–Yates permutation of `items` determined entirely by `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: Uint8Array): T[] {
  if (seed.length < 16) throw new Error('seed must be at least 16 bytes');
  const next = xoshiro128ss(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    // Unbiased integer in [0, i] by rejection sampling.
    const range = i + 1;
    const limit = Math.floor(0x100000000 / range) * range;
    let r: number;
    do r = next();
    while (r >= limit);
    const j = r % range;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
