import { describe, expect, it } from 'vitest';
import { progressLine, readyLine, stakeBalance, stakeFailed, stakeName, stakeStage, type StakeResult, type StakeStep, stakeProblem } from './stake';
import type { TreasuryView } from './treasury';

const view = (over: Partial<TreasuryView> = {}): TreasuryView => ({
  chainId: 34348,
  asset: `0x${'da'.repeat(20)}`,
  chipValue: '1000000',
  person: `0x${'11'.repeat(20)}`,
  personName: null,
  chosen: null,
  chosenName: null,
  balance: null,
  balanceText: null,
  candidates: [],
  discoveryError: null,
  create: { mode: 'home-portal', portalUrl: 'https://home.example/treasuries', canName: true },
  mandate: {
    present: false,
    treasury: null,
    maxPerBuyIn: '200000000',
    sessionTotal: '1000000000',
    maxBuyIns: 5,
    validUntil: 1_800_000_000,
    payee: `0x${'a0'.repeat(20)}`,
    asset: `0x${'da'.repeat(20)}`,
    problem: null,
    unavailable: null,
  },
  faucet: { available: true, asset: 'Mock USD Coin', reason: null },
  notice: null,
  unavailable: null,
  ...over,
});

const funded = (over: Partial<TreasuryView> = {}): TreasuryView =>
  view({ chosen: `0x${'ab'.repeat(20)}`, chosenName: 'rowan.treasury', balance: '10000000000', balanceText: '10000.000000', ...over });

const result = (over: Partial<StakeResult> = {}): StakeResult => ({
  ready: false,
  treasury: null,
  treasuryName: null,
  balance: null,
  balanceText: null,
  steps: [],
  next: { action: 'none', said: '' },
  ...over,
});

const step = (over: Partial<StakeStep> = {}): StakeStep => ({ step: 'treasury', status: 'done', said: 'did a thing', ...over });

describe('stakeStage', () => {
  it('says loading before anything has been read, rather than "you have nothing"', () => {
    expect(stakeStage(null)).toBe('loading');
  });

  it('is "unavailable" where the deployment cannot settle at all', () => {
    expect(stakeStage(view({ unavailable: 'ASSET is not set to an address' }))).toBe('unavailable');
    expect(stakeStage(funded({ mandate: { ...view().mandate, unavailable: 'HOUSE_DELEGATE is not set' } }))).toBe('unavailable');
  });

  it('is one action away — "set-up" — with no treasury, and equally with an empty one', () => {
    expect(stakeStage(view())).toBe('set-up');
    expect(stakeStage(view({ chosen: `0x${'ab'.repeat(20)}`, balance: '0' }))).toBe('set-up');
  });

  it('asks for the authority only once there is money to authorise', () => {
    expect(stakeStage(funded())).toBe('authorise');
  });

  /** A mandate with a PROBLEM is not an authorisation; the same one action fixes it. */
  it('is ready only with money and a mandate that has nothing wrong with it', () => {
    expect(stakeStage(funded({ mandate: { ...view().mandate, present: true } }))).toBe('ready');
    expect(stakeStage(funded({ mandate: { ...view().mandate, present: true, problem: 'it expired' } }))).toBe('authorise');
  });
});

describe('what a player is shown instead of an address', () => {
  it('formats the balance as money, with cents', () => {
    expect(stakeBalance(funded())).toBe('10,000.00 SHQ');
    expect(stakeBalance(view({ balance: '0' }))).toBe('0.00 SHQ');
  });

  it('answers null rather than "NaN" for anything it cannot read', () => {
    expect(stakeBalance(null)).toBeNull();
    expect(stakeBalance(view())).toBeNull();
    expect(stakeBalance(view({ balance: 'not a number' }))).toBeNull();
  });

  it('gives the treasury NAME, and nothing at all when it is nameless — never the address', () => {
    expect(stakeName(funded())).toBe('rowan.treasury');
    expect(stakeName(funded({ chosenName: '' }))).toBeNull();
  });
});

describe('progressLine', () => {
  it('shows the most recent step while everything is going well', () => {
    const r = result({ steps: [step({ said: 'first' }), step({ step: 'stake', said: 'second' })] });
    expect(progressLine(r)).toBe('second');
  });

  /** A failure that scrolls off the end of the list is a failure nobody saw. */
  it('shows a failure or a block ahead of whatever came after it', () => {
    const r = result({
      steps: [step({ said: 'account ready' }), step({ step: 'stake', status: 'failed', said: 'the mint did not land' }), step({ said: 'later' })],
    });
    expect(progressLine(r)).toBe('the mint did not land');
    expect(stakeFailed(r)).toBe(true);
  });

  it('has nothing to say before the button has been pressed', () => {
    expect(progressLine(null)).toBeNull();
    expect(stakeFailed(null)).toBe(false);
  });
});

describe('readyLine', () => {
  it('ends on money, not on machinery', () => {
    expect(readyLine(result({ ready: true, balance: '10000000000' }))).toBe("You're set up with 10,000.00 SHQ to play with.");
    // The card room's own currency, where the server states one. There is more than one on the
    // estate now, so the ticker is never assumed.
    expect(readyLine(result({ ready: true, balance: '10000000000' }), 'SHQ')).toBe("You're set up with 10,000.00 SHQ to play with.");
  });

  it('claims nothing while the set-up is unfinished', () => {
    expect(readyLine(result({ ready: false, balance: '10000000000' }))).toBeNull();
  });

  it('surfaces a refused mandate, because the stage collapses back to authorise and loses the reason', () => {
    const refusal = 'the buy-in mandate is delegated to 0xf6F4…5671, but this card room redeems as 0x0347…04DD';
    expect(stakeProblem({ mandate: { problem: refusal } } as never)).toBe(refusal);
    // Nothing to explain: no attempt, an accepted mandate, or an empty string.
    expect(stakeProblem({ mandate: { problem: null } } as never)).toBeNull();
    expect(stakeProblem({ mandate: { problem: '   ' } } as never)).toBeNull();
    expect(stakeProblem(null)).toBeNull();
  });
});
