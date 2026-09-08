import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore pokersolver ships no types
import pokersolver from 'pokersolver';
import type { Card } from '../src/index.js';
import { compareHands, evaluateHand, fullDeck } from '../src/index.js';
import { prng } from './random-play.js';

const { Hand } = pokersolver as { Hand: { solve(cards: string[]): unknown; winners(hands: unknown[]): unknown[] } };

const c = (s: string): Card[] => s.split(' ') as Card[];

describe('evaluateHand categories', () => {
  it('high card', () => {
    const h = evaluateHand(c('As Kd 9h 7c 2s'));
    expect(h.category).toBe('high-card');
    expect(h.label).toBe('High card, ace');
    expect(h.cards).toEqual(c('As Kd 9h 7c 2s'));
  });
  it('pair', () => {
    const h = evaluateHand(c('9s 9d Ah 7c 2s'));
    expect(h.category).toBe('pair');
    expect(h.label).toBe('Pair of nines');
    expect(h.cards).toEqual(c('9s 9d Ah 7c 2s'));
  });
  it('two pair', () => {
    const h = evaluateHand(c('8s Ad 8h Ac 2s'));
    expect(h.category).toBe('two-pair');
    expect(h.label).toBe('Two pair, aces and eights');
    expect(h.cards).toEqual(c('Ad Ac 8s 8h 2s'));
  });
  it('three of a kind', () => {
    const h = evaluateHand(c('Qs Qd Qh 7c 2s'));
    expect(h.category).toBe('three-of-a-kind');
    expect(h.label).toBe('Three of a kind, queens');
  });
  it('straight', () => {
    const h = evaluateHand(c('Ts 9d 8h 7c 6s'));
    expect(h.category).toBe('straight');
    expect(h.label).toBe('Straight, ten high');
    expect(h.cards).toEqual(c('Ts 9d 8h 7c 6s'));
  });
  it('flush', () => {
    const h = evaluateHand(c('Ks 9s 7s 4s 2s'));
    expect(h.category).toBe('flush');
    expect(h.label).toBe('Flush, king high');
  });
  it('full house', () => {
    const h = evaluateHand(c('Ks 4d Kh 4c Kc'));
    expect(h.category).toBe('full-house');
    expect(h.label).toBe('Full house, kings over fours');
    expect(h.cards).toEqual(c('Ks Kh Kc 4d 4c'));
  });
  it('four of a kind', () => {
    const h = evaluateHand(c('9s 9d 9h 9c As'));
    expect(h.category).toBe('four-of-a-kind');
    expect(h.label).toBe('Four of a kind, nines');
  });
  it('straight flush and royal flush', () => {
    const h = evaluateHand(c('9h 8h 7h 6h 5h'));
    expect(h.category).toBe('straight-flush');
    expect(h.label).toBe('Straight flush, nine high');
    expect(evaluateHand(c('Ah Kh Qh Jh Th')).label).toBe('Royal flush');
  });
  it('value encodes category * 15^5 + kickers', () => {
    const h = evaluateHand(c('As Kd 9h 7c 2s'));
    expect(h.value).toBe(14 * 50625 + 13 * 3375 + 9 * 225 + 7 * 15 + 2);
    const q = evaluateHand(c('9s 9d 9h 9c As'));
    expect(q.value).toBe(7 * 759375 + 9 * 50625 + 14 * 3375);
  });
});

describe('evaluateHand ordering', () => {
  const gt = (a: string, b: string): void => {
    expect(compareHands(evaluateHand(c(a)), evaluateHand(c(b))), `${a} > ${b}`).toBeGreaterThan(0);
  };
  const eq = (a: string, b: string): void => {
    expect(compareHands(evaluateHand(c(a)), evaluateHand(c(b))), `${a} == ${b}`).toBe(0);
  };

  it('categories rank in order', () => {
    const ladder = [
      'As Kd 9h 7c 2s',
      '9s 9d Ah 7c 2s',
      '8s Ad 8h Ac 2s',
      'Qs Qd Qh 7c 2s',
      '6s 5d 4h 3c 2s',
      'Ks 9s 7s 4s 2s',
      'Ks 4d Kh 4c Kc',
      '9s 9d 9h 9c As',
      '9h 8h 7h 6h 5h',
    ];
    for (let i = 1; i < ladder.length; i++) gt(ladder[i] as string, ladder[i - 1] as string);
  });

  it('kicker tie-breaks', () => {
    gt('As Kd 9h 7c 3s', 'As Kd 9h 7c 2s');
    gt('9s 9d Ah 7c 2s', '9s 9d Kh 7c 2s');
    gt('Ts Td Ah 7c 2s', '9s 9d Kh Qc Js');
    gt('8s Ad 8h Ac 3s', '8s Ad 8h Ac 2s');
    gt('9s Ad 9h Ac 2s', '8s Ad 8h Ac 2s');
    gt('Qs Qd Qh 7c 3s', 'Qs Qd Qh 7c 2s');
    gt('Ks 9s 7s 4s 3s', 'Ks 9s 7s 4s 2s');
    gt('Ks 4d Kh 4c Kc', 'Qs Ad Qh Ac Qc');
    gt('Ks 5d Kh 5c Kc', 'Ks 4d Kh 4c Kc');
    gt('9s 9d 9h 9c Ks', '9s 9d 9h 9c Qs');
  });

  it('wheel is the lowest straight; six-high beats it', () => {
    const wheel = evaluateHand(c('As 2d 3h 4c 5s'));
    expect(wheel.category).toBe('straight');
    expect(wheel.label).toBe('Straight, five high');
    expect(wheel.cards).toEqual(c('5s 4c 3h 2d As'));
    gt('6s 2d 3h 4c 5s', 'As 2d 3h 4c 5s');
    gt('As 2d 3h 4c 5s', 'As Ad Ah Kc Qs');
    const sfWheel = evaluateHand(c('As 2s 3s 4s 5s'));
    expect(sfWheel.category).toBe('straight-flush');
    expect(sfWheel.label).toBe('Straight flush, five high');
  });

  it('flush beats straight', () => {
    gt('2s 4s 7s 9s Js', 'As Kd Qh Jc Ts');
  });

  it('exact ties', () => {
    eq('As Kd 9h 7c 2s', 'Ah Kc 9d 7s 2h');
    eq('Ks 9s 7s 4s 2s', 'Kh 9h 7h 4h 2h');
    eq('As 2d 3h 4c 5s', 'Ad 2c 3s 4h 5d');
  });

  it('picks the best five from six and seven cards', () => {
    const six = evaluateHand(c('As Ad 3h 3c 3s Kd'));
    expect(six.category).toBe('full-house');
    expect(six.label).toBe('Full house, threes over aces');
    const seven = evaluateHand(c('2h 3h 4h 5h Kd Kc 6h'));
    expect(seven.category).toBe('straight-flush');
    expect(seven.label).toBe('Straight flush, six high');
    const flushOverStraight = evaluateHand(c('2h 3h 4h 5h 6d 9h Kc'));
    expect(flushOverStraight.category).toBe('flush');
    expect(flushOverStraight.cards).toEqual(c('9h 5h 4h 3h 2h'));
    const twoPairFromThree = evaluateHand(c('As Ad Ks Kd Qs Qd 2c'));
    expect(twoPairFromThree.label).toBe('Two pair, aces and kings');
    expect(twoPairFromThree.cards).toEqual(c('As Ad Ks Kd Qs'));
  });

  it('rejects the wrong number of cards', () => {
    expect(() => evaluateHand(c('As Kd 9h 7c'))).toThrow();
    expect(() => evaluateHand(c('As Kd 9h 7c 2s 3s 4s 5s'))).toThrow();
  });
});

describe('cross-check against pokersolver', () => {
  it('agrees on 20,000 random 7-card pairs', () => {
    const rnd = prng(0xc0ffee);
    const deck = fullDeck();
    let ties = 0;
    for (let i = 0; i < 20_000; i++) {
      // Partial Fisher-Yates: draw 14 distinct cards.
      const d = deck.slice();
      for (let k = 0; k < 14; k++) {
        const j = k + Math.floor(rnd() * (52 - k));
        const t = d[k] as Card;
        d[k] = d[j] as Card;
        d[j] = t;
      }
      const a = d.slice(0, 7);
      const b = d.slice(7, 14);
      const ours = Math.sign(compareHands(evaluateHand(a), evaluateHand(b)));
      const ha = Hand.solve(a);
      const hb = Hand.solve(b);
      const winners = Hand.winners([ha, hb]);
      const theirs = winners.length === 2 ? 0 : winners[0] === ha ? 1 : -1;
      if (theirs === 0) ties++;
      if (ours !== theirs) {
        throw new Error(`disagree on ${a.join(' ')} vs ${b.join(' ')}: ours ${ours}, pokersolver ${theirs}`);
      }
    }
    expect(ties).toBeGreaterThan(0);
  });
});
