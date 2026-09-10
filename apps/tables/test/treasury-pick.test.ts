/**
 * Which treasury funds play, when the person has not said.
 *
 * The case that matters: somebody arrives with a funded treasury their Home already knows about. The
 * card room used to leave `chosen` null, tell them they had no stake, and offer to CREATE one — so a
 * person with money ended up with a second empty account, and then a third.
 */
import { describe, expect, it } from 'vitest';
import { pickTreasury, type Candidate } from '../src/treasury-pick.js';

const t = (over: Partial<Candidate> = {}): Candidate => ({ address: `0x${'1'.repeat(40)}`, balance: '0', ...over });

describe('choosing for somebody who has not chosen', () => {
  it('takes the funded one over the empty ones', () => {
    // Alice's actual state: five treasuries, one holding 10,000 and none selected.
    const got = pickTreasury([
      t({ address: '0xaaa', name: 'alice3.treasury', balance: '0' }),
      t({ address: '0xbbb', name: 'alice2.treasury', balance: '10000000000' }),
      t({ address: '0xccc', name: '', balance: '0' }),
    ]);
    expect(got?.address).toBe('0xbbb');
  });

  it('takes the largest when several are funded', () => {
    expect(pickTreasury([t({ address: '0xa', balance: '5' }), t({ address: '0xb', balance: '900' }), t({ address: '0xc', balance: '90' })])?.address).toBe('0xb');
  });

  it('compares as NUMBERS, not as strings — "9" is not more than "10000000000"', () => {
    expect(pickTreasury([t({ address: '0xa', balance: '9' }), t({ address: '0xb', balance: '10000000000' })])?.address).toBe('0xb');
  });

  it('prefers a NAMED treasury when the money is equal — it is the one they will recognise', () => {
    const got = pickTreasury([t({ address: '0xa', name: '', balance: '0' }), t({ address: '0xb', name: 'alice2.treasury', balance: '0' })]);
    expect(got?.address).toBe('0xb');
  });

  it('is stable across reads, so a refresh never moves somebody’s money', () => {
    const list = [t({ address: '0xa', name: 'one', balance: '5' }), t({ address: '0xb', name: 'two', balance: '5' })];
    expect(pickTreasury(list)?.address).toBe('0xa');
    expect(pickTreasury(list)?.address).toBe('0xa');
  });

  it('never chooses one whose balance could not be read', () => {
    // It might be empty, it might be fine — binding a buy-in mandate to a guess is not a thing to do.
    const got = pickTreasury([t({ address: '0xa', error: 'rpc timed out', balance: null }), t({ address: '0xb', balance: '1' })]);
    expect(got?.address).toBe('0xb');
    expect(pickTreasury([t({ address: '0xa', error: 'rpc timed out', balance: null })])).toBeNull();
  });

  it('still chooses when everything is empty — a sixth account is not the fix for five empty ones', () => {
    expect(pickTreasury([t({ address: '0xa', balance: '0' })])?.address).toBe('0xa');
  });

  it('has nothing to choose when there is nothing', () => {
    expect(pickTreasury([])).toBeNull();
  });

  it('ignores a balance that is not a number rather than trusting it', () => {
    expect(pickTreasury([t({ address: '0xa', balance: 'lots' as string })])).toBeNull();
  });
});
