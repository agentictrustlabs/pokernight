/**
 * The rules, one at a time.
 *
 * Canasta's rules are fiddly in ways that are easy to get subtly wrong and hard to notice at a real
 * table: a meld with too many wilds, a frozen pile taken with the wrong pair, a red three counted as
 * a bonus for a side that never melded. Each of those is a test here, and each names the rule rather
 * than the code, because the rule is the thing that has to be right.
 */

import { describe, expect, it } from 'vitest';
import {
  CANASTA_SIZE,
  applyMelds,
  canTakePile,
  canastaBonus,
  cardValue,
  fullDeck,
  handValue,
  initialMeldMinimum,
  isBlackThree,
  isCanasta,
  isLegalMeld,
  isNaturalCanasta,
  isRedThree,
  isWild,
  naturalsOfRank,
  redThreeValue,
  removeCards,
} from '../src/index.js';
import type { Card, Meld } from '../src/index.js';

describe('the deck', () => {
  it('is two packs and four jokers — 108 cards', () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c) => c === 'W*')).toHaveLength(4);
    // Every ordinary card appears exactly twice, because there are two packs.
    expect(deck.filter((c) => c === 'AS')).toHaveLength(2);
    expect(deck.filter((c) => c === '3H')).toHaveLength(2);
  });

  it('holds four red threes and four black ones', () => {
    const deck = fullDeck();
    expect(deck.filter(isRedThree)).toHaveLength(4);
    expect(deck.filter(isBlackThree)).toHaveLength(4);
  });

  it('counts jokers and twos as wild, and nothing else', () => {
    expect(fullDeck().filter(isWild)).toHaveLength(12); // 4 jokers + 8 twos
    expect(isWild('W*')).toBe(true);
    expect(isWild('2H')).toBe(true);
    expect(isWild('AS')).toBe(false);
    expect(isWild('3H')).toBe(false);
  });
});

describe('what a card is worth', () => {
  it('pays the standard values', () => {
    expect(cardValue('W*')).toBe(50);
    expect(cardValue('2C')).toBe(20);
    expect(cardValue('AH')).toBe(20);
    expect(cardValue('KD')).toBe(10);
    expect(cardValue('8S')).toBe(10);
    expect(cardValue('7C')).toBe(5);
    expect(cardValue('4D')).toBe(5);
    expect(cardValue('3S')).toBe(5);
  });

  it('gives a red three no face value, because its value is a bonus and not a card', () => {
    expect(cardValue('3H')).toBe(0);
    expect(cardValue('3D')).toBe(0);
  });

  it('adds a hand up, which is what a player is charged for holding it', () => {
    expect(handValue(['W*', 'AH', '4D'])).toBe(75);
    expect(handValue([])).toBe(0);
  });

  it('makes the whole deck worth what two packs and four jokers are worth', () => {
    // 4 jokers at 50, 8 twos and 8 aces at 20, 48 tens (K Q J T 9 8), 32 fives (7 6 5 4),
    // 4 black threes at 5, and the four red threes at nothing.
    const expected = 4 * 50 + 8 * 20 + 8 * 20 + 48 * 10 + 32 * 5 + 4 * 5;
    expect(expected).toBe(1180);
    expect(handValue(fullDeck())).toBe(expected);
  });
});

describe('what makes a legal meld', () => {
  it('takes three or more of a rank', () => {
    expect(isLegalMeld('7', ['7C', '7D', '7H']).ok).toBe(true);
    expect(isLegalMeld('7', ['7C', '7D']).ok).toBe(false);
  });

  it('lets wilds stand in, up to three of them', () => {
    expect(isLegalMeld('7', ['7C', '7D', 'W*']).ok).toBe(true);
    expect(isLegalMeld('7', ['7C', '7D', '7H', '7S', 'W*', '2C', '2D']).ok).toBe(true);
    const four = isLegalMeld('7', ['7C', '7D', '7H', '7S', 'W*', '2C', '2D', '2H']);
    expect(four.ok).toBe(false);
    expect(four.reason).toMatch(/at most 3 wild/);
  });

  it('needs two natural cards, so a meld is never mostly wild', () => {
    const r = isLegalMeld('7', ['7C', 'W*', '2C']);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/two natural/);
  });

  it('never holds more wilds than naturals', () => {
    // Three naturals and three wilds is legal; two and three is not, even though three wilds is the
    // stated cap — the cap and the ratio are different rules and both apply.
    expect(isLegalMeld('K', ['KC', 'KD', 'KH', 'W*', '2C', '2D']).ok).toBe(true);
    expect(isLegalMeld('K', ['KC', 'KD', 'W*', '2C', '2D']).ok).toBe(false);
  });

  it('refuses a card of the wrong rank', () => {
    expect(isLegalMeld('7', ['7C', '7D', '8H']).ok).toBe(false);
  });

  it('refuses threes and wild ranks as melds of their own', () => {
    expect(isLegalMeld('2', ['2C', '2D', '2H']).ok).toBe(false);
    expect(isLegalMeld('W', ['W*', 'W*', 'W*']).ok).toBe(false);
    // Red threes never. Black threes only as a complete meld, and only when going out — which the
    // caller decides, because whether you are going out is not a property of the cards.
    expect(isLegalMeld('3', ['3H', '3D', '3C']).ok).toBe(false);
    expect(isLegalMeld('3', ['3C', '3S', '3C']).ok).toBe(true);
  });
});

describe('canastas', () => {
  const meld = (cards: Card[]): Meld => ({ rank: '7', cards });

  it('is seven cards or more', () => {
    expect(isCanasta(meld(['7C', '7D', '7H', '7S', '7C', '7D']))).toBe(false);
    expect(isCanasta(meld(['7C', '7D', '7H', '7S', '7C', '7D', '7H']))).toBe(true);
    expect(CANASTA_SIZE).toBe(7);
  });

  it('is natural with no wild in it, and mixed with any', () => {
    const clean = meld(['7C', '7D', '7H', '7S', '7C', '7D', '7H']);
    const dirty = meld(['7C', '7D', '7H', '7S', '7C', '7D', 'W*']);
    expect(isNaturalCanasta(clean)).toBe(true);
    expect(isNaturalCanasta(dirty)).toBe(false);
  });

  it('pays 500 clean and 300 mixed', () => {
    const clean = meld(['7C', '7D', '7H', '7S', '7C', '7D', '7H']);
    const dirty = { rank: 'K' as const, cards: ['KC', 'KD', 'KH', 'KS', 'KC', 'KD', 'W*'] };
    const bonus = canastaBonus([clean, dirty]);
    expect(bonus).toEqual({ total: 800, natural: 1, mixed: 1 });
  });
});

describe('opening', () => {
  it('rises with the score, and is almost nothing when a side is behind', () => {
    expect(initialMeldMinimum(-50)).toBe(15);
    expect(initialMeldMinimum(0)).toBe(50);
    expect(initialMeldMinimum(1495)).toBe(50);
    expect(initialMeldMinimum(1500)).toBe(90);
    expect(initialMeldMinimum(2995)).toBe(90);
    expect(initialMeldMinimum(3000)).toBe(120);
    expect(initialMeldMinimum(9000)).toBe(120);
  });
});

describe('laying melds down', () => {
  it('adds to a meld of the same rank rather than making a second one', () => {
    const r = applyMelds([{ rank: '7', cards: ['7C', '7D', '7H'] }], [{ rank: '7', cards: ['7S'] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.melds).toHaveLength(1);
    expect(r.melds[0]?.cards).toHaveLength(4);
    // Only what was laid THIS move counts toward opening, never what was already down.
    expect(r.laid).toEqual(['7S']);
  });

  it('lets a single wild join a meld that is already legal without it', () => {
    // A wild alone is not a meld; added to four sevens it is fine. The rule is about what the meld
    // BECOMES, which is why an addition is judged on the whole and not on the cards being added.
    const r = applyMelds([{ rank: '7', cards: ['7C', '7D', '7H', '7S'] }], [{ rank: '7', cards: ['W*'] }]);
    expect(r.ok).toBe(true);
  });

  it('refuses an addition that would break the wild limit', () => {
    const r = applyMelds([{ rank: '7', cards: ['7C', '7D', '7H', 'W*', '2C', '2D'] }], [{ rank: '7', cards: ['2H'] }]);
    expect(r.ok).toBe(false);
  });

  it('refuses an empty request rather than quietly doing nothing', () => {
    expect(applyMelds([], []).ok).toBe(false);
    expect(applyMelds([], [{ rank: '7', cards: [] }]).ok).toBe(false);
  });
});

describe('taking the discard pile', () => {
  const base = { frozen: false, melds: [] as Meld[] };

  it('needs two natural cards of the top rank', () => {
    expect(canTakePile({ ...base, top: '7C', hand: ['7D', '7H', 'KS'] }).ok).toBe(true);
    const one = canTakePile({ ...base, top: '7C', hand: ['7D', 'W*', 'KS'] });
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.reason).toMatch(/two natural 7s/);
  });

  it('or a meld of that rank already down, when the pile is not frozen', () => {
    const melds: Meld[] = [{ rank: '7', cards: ['7C', '7D', '7H'] }];
    expect(canTakePile({ top: '7S', frozen: false, hand: ['KS'], melds }).ok).toBe(true);
  });

  it('but a FROZEN pile only opens to the two naturals', () => {
    const melds: Meld[] = [{ rank: '7', cards: ['7C', '7D', '7H'] }];
    const r = canTakePile({ top: '7S', frozen: true, hand: ['KS'], melds });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/frozen/);
    expect(canTakePile({ top: '7S', frozen: true, hand: ['7C', '7D'], melds }).ok).toBe(true);
  });

  it('is stopped dead by a black three on top', () => {
    const r = canTakePile({ ...base, top: '3S', hand: ['3C', '3D'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/black three/);
  });

  it('is stopped dead by a wild on top, however good your hand is', () => {
    const r = canTakePile({ ...base, top: 'W*', hand: ['W*', '2C', '2D'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/wild card/);
  });

  it('says there is nothing to take when the pile is empty', () => {
    expect(canTakePile({ ...base, top: null, hand: ['7C', '7D'] }).ok).toBe(false);
  });
});

describe('red threes', () => {
  it('pay 100 each, and 200 each when a side has all four', () => {
    expect(redThreeValue(0)).toBe(0);
    expect(redThreeValue(1)).toBe(100);
    expect(redThreeValue(3)).toBe(300);
    expect(redThreeValue(4)).toBe(800);
  });
});

describe('taking cards out of a hand', () => {
  it('removes one copy, not every copy — two packs means duplicates are real', () => {
    expect(removeCards(['7C', '7C', 'KD'], ['7C'])).toEqual(['7C', 'KD']);
  });

  it('answers null when a card is not there, rather than silently doing less', () => {
    expect(removeCards(['7C'], ['7D'])).toBeNull();
    expect(removeCards(['7C'], ['7C', '7C'])).toBeNull();
  });

  it('counts naturals of a rank and ignores wilds', () => {
    expect(naturalsOfRank(['7C', '7D', 'W*', '2C'], '7')).toEqual(['7C', '7D']);
    expect(naturalsOfRank(['2C', '2D'], '2')).toEqual([]);
  });
});
