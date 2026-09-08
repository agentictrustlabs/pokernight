/**
 * The loose-passive variant is a BIAS OVER `decide`, not a second strategy. These tests pin the two
 * things that makes it: it calls where the baseline folds, and it flats where the baseline raises.
 */

import { describe, expect, it } from 'vitest';
import { isLegal } from '@pokernight/agent-kit';
import type { Card } from '@pokernight/engine';
import { decideWithStyle } from '../src/strategies/rules.js';
import { legalFor, makeInput, makeView, randomInput, seededRng } from './fixtures.js';

/** Seat 3 preflop with a weak hand facing a raise: the tight baseline folds this. */
function marginalSpot() {
  const view = makeView({
    seats: [
      { seat: 1, stack: 200, streetBet: 6, totalBet: 6 },
      { seat: 3, stack: 200, streetBet: 2, totalBet: 2, hole: ['9c', '7d'] as Card[] },
      { seat: 5, stack: 200, streetBet: 0, totalBet: 0 },
    ],
    button: 5,
    viewer: 3,
    street: 'preflop',
    currentBet: 6,
    minRaise: 4,
    actions: [{ seat: 1, street: 'preflop', action: { type: 'raise', amount: 6 }, amount: 6 }],
  });
  return makeInput(view, legalFor(view));
}

/** Seat 3 on the flop with a set and nothing to call: the tight baseline value-bets this. */
function valueSpot() {
  const view = makeView({
    seats: [
      { seat: 1, stack: 200, streetBet: 0, totalBet: 12 },
      { seat: 3, stack: 200, streetBet: 0, totalBet: 12, hole: ['8c', '8d'] as Card[] },
    ],
    button: 1,
    viewer: 3,
    street: 'flop',
    board: ['8h', 'Kc', '2s'] as Card[],
    potAmount: 24,
    currentBet: 0,
    minRaise: 2,
    actions: [{ seat: 1, street: 'flop', action: { type: 'check' }, amount: 0 }],
  });
  return makeInput(view, legalFor(view));
}

describe('rules styles', () => {
  it('loose-passive calls the marginal spot the tight baseline folds', () => {
    const input = marginalSpot();
    const tight = decideWithStyle(input, { style: 'tight-aggressive', rng: seededRng(1) });
    const loose = decideWithStyle(input, { style: 'loose-passive', rng: seededRng(1) });
    expect(tight.action.type).toBe('fold');
    expect(loose.action.type).toBe('call');
  });

  it('loose-passive mostly flats where the tight baseline bets', () => {
    const input = valueSpot();
    const tight = decideWithStyle(input, { style: 'tight-aggressive', rng: seededRng(2) });
    expect(tight.action.type).toBe('bet');

    let passive = 0;
    for (let s = 1; s <= 40; s++) {
      const out = decideWithStyle(input, { style: 'loose-passive', rng: seededRng(s) });
      expect(isLegal(out.action, input.legal)).toBe(true);
      if (out.action.type === 'check' || out.action.type === 'call') passive++;
    }
    // aggression = 0.2, so roughly four in five bets are downgraded.
    expect(passive).toBeGreaterThan(24);
  });

  it('both styles stay legal on random input', () => {
    const gen = seededRng(4242);
    for (let i = 0; i < 60; i++) {
      const input = randomInput(gen);
      for (const style of ['tight-aggressive', 'loose-passive'] as const) {
        const out = decideWithStyle(input, { style, rng: seededRng(i) });
        expect(isLegal(out.action, input.legal), `${style} #${i}: ${JSON.stringify(out.action)}`).toBe(true);
      }
    }
  });
});
