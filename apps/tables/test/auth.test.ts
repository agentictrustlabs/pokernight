import { describe, expect, it } from 'vitest';
import { mintSessionToken, slug, verifySessionToken } from '../src/auth.js';

describe('session tokens', () => {
  const secret = 'unit-test-secret';

  it('round-trips claims through mint and verify', async () => {
    const claims = { playerId: 'dev:alice', name: 'Alice', exp: Date.now() + 60_000 };
    const token = await mintSessionToken(secret, claims);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifySessionToken(secret, token)).toEqual(claims);
  });

  it('rejects a tampered payload, a wrong secret and an expired token', async () => {
    const token = await mintSessionToken(secret, { playerId: 'dev:alice', name: 'Alice', exp: Date.now() + 60_000 });
    const [payload, sig] = token.split('.') as [string, string];
    const forged = `${payload.slice(0, -2)}AA.${sig}`;
    expect(await verifySessionToken(secret, forged)).toBeNull();
    expect(await verifySessionToken('other-secret', token)).toBeNull();
    const expired = await mintSessionToken(secret, { playerId: 'dev:bob', name: 'Bob', exp: Date.now() - 1 });
    expect(await verifySessionToken(secret, expired)).toBeNull();
    expect(await verifySessionToken(secret, 'garbage')).toBeNull();
  });

  it('slugs names deterministically', () => {
    expect(slug('Alice B. Cooper!')).toBe('alice-b-cooper');
    expect(slug('   ')).toBe('anon');
  });
});
