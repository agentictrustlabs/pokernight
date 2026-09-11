/**
 * The numbers a hold'em read is built from.
 *
 * Deliberately the CERTAIN ones — the price, the opponents, position, the stack behind. A confident
 * equity figure would be the most impressive and least honest thing this could return: it would have
 * to assume ranges nobody stated.
 */
import { describe, expect, it } from 'vitest';
import { cardsToCome, chanceFromOuts, priceToCall } from '../src/explain.js';

describe('the price a call is offered', () => {
  it('is the share of the time it has to be best, as a percentage', () => {
    // Call 20 into 80: risking 20 to win 100, so it needs to be good a fifth of the time.
    expect(priceToCall(80, 20)).toBe(20);
    expect(priceToCall(100, 100)).toBe(50);
    expect(priceToCall(150, 50)).toBe(25);
  });

  it('is nothing to pay when there is nothing to call', () => {
    expect(priceToCall(80, 0)).toBeNull();
    expect(priceToCall(0, 0)).toBeNull();
  });
});

describe('a draw, as a rough chance', () => {
  it('is the two-and-four rule, and is labelled rough where it is used', () => {
    expect(chanceFromOuts(9, 2)).toBe(36);
    expect(chanceFromOuts(9, 1)).toBe(18);
    expect(chanceFromOuts(4, 1)).toBe(8);
  });

  it('never claims a certainty', () => {
    expect(chanceFromOuts(40, 2)).toBeLessThanOrEqual(95);
  });

  it('is nothing with no outs or no cards to come', () => {
    expect(chanceFromOuts(0, 2)).toBe(0);
    expect(chanceFromOuts(9, 0)).toBe(0);
  });
});

describe('how much is still to come', () => {
  it('counts the cards, street by street', () => {
    expect(cardsToCome('preflop')).toBe(5);
    expect(cardsToCome('flop')).toBe(2);
    expect(cardsToCome('turn')).toBe(1);
    expect(cardsToCome('river')).toBe(0);
  });
});
