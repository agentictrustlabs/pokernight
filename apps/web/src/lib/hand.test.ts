import { describe, expect, it } from 'vitest';
import {
  awardedTo,
  blindSeats,
  dealtSeats,
  hasShowdown,
  lastActions,
  netBySeat,
  playersRemaining,
  potTotal,
  shownCards,
  winningCards,
  winningSeats,
} from './hand';
import { emptyView, flopView, seat } from './mockServer';
import type { ActionRecord, HandRank, HandResult, TableView } from './types';

const twoPair: HandRank = { category: 'two-pair', value: 3, cards: ['Ah', 'Ad', '8c', '8s', 'Kd'], label: 'Two pair, aces and eights' };
const flush: HandRank = { category: 'flush', value: 9, cards: ['Ah', 'Th', '8h', '5h', '2h'], label: 'Flush, ace high' };

const showdownResult: HandResult = {
  awards: [{ potIndex: 0, amount: 34, seat: 1, rank: twoPair }],
  net: { 0: -17, 1: 17, 3: 0 },
  shown: [
    { seat: 1, holeCards: ['8c', '8s'], rank: twoPair },
    { seat: 0, holeCards: ['Th', '5h'], rank: flush },
  ],
  rake: 0,
};

const foldResult: HandResult = {
  awards: [{ potIndex: 0, amount: 12, seat: 1 }],
  net: { 0: -6, 1: 6 },
  shown: [],
  rake: 0,
};

const splitResult: HandResult = {
  awards: [
    { potIndex: 0, amount: 20, seat: 0, rank: twoPair },
    { potIndex: 0, amount: 20, seat: 1, rank: twoPair },
    { potIndex: 1, amount: 6, seat: 0, rank: twoPair },
  ],
  net: { 0: 6, 1: 0 },
  shown: [],
  rake: 0,
};

describe('the winning hand', () => {
  it('lights up exactly the five cards that won', () => {
    expect([...winningCards(showdownResult)].sort()).toEqual(['8c', '8s', 'Ad', 'Ah', 'Kd'].sort());
  });

  it('lights up nothing when the pot was won uncontested', () => {
    expect(winningCards(foldResult).size).toBe(0);
    expect(winningCards(null).size).toBe(0);
  });

  it('does not borrow a losing seat cards, even at showdown', () => {
    const cards = winningCards(showdownResult);
    expect(cards.has('Th')).toBe(false);
    expect(cards.has('5h')).toBe(false);
  });

  it('names the winning seats once each, in award order', () => {
    expect(winningSeats(splitResult)).toEqual([0, 1]);
    expect(winningSeats(foldResult)).toEqual([1]);
  });

  it('knows a showdown from a fold-to-one', () => {
    expect(hasShowdown(showdownResult)).toBe(true);
    expect(hasShowdown(foldResult)).toBe(false);
  });

  it('totals each seat awards across side pots', () => {
    expect(awardedTo(splitResult, 0)).toBe(26);
    expect(awardedTo(splitResult, 1)).toBe(20);
    expect(awardedTo(splitResult, 7)).toBe(0);
  });

  it('collects shown cards and non-zero deltas by seat', () => {
    expect(shownCards(showdownResult).get(1)).toEqual(['8c', '8s']);
    expect([...netBySeat(showdownResult).entries()]).toEqual([
      [0, -17],
      [1, 17],
    ]);
    expect(netBySeat(null).size).toBe(0);
  });
});

describe('table shape', () => {
  it('reads the dealt seats, the survivors and the whole pot', () => {
    const v = flopView(0);
    expect(dealtSeats(v).map((s) => s.seat)).toEqual([0, 1, 3]);
    expect(playersRemaining(v)).toBe(2); // seat 3 folded
    expect(potTotal(v)).toBe(10); // pot 4 + Bob's 6 out in front
  });

  it('has no blinds without a hand', () => {
    expect(blindSeats(emptyView([seat(0, 'a', 100), seat(1, 'b', 100)]))).toEqual({ small: null, big: null });
  });

  it('uses the blind seats the server states for the hand', () => {
    // flopView carries smallBlindSeat 0 / bigBlindSeat 1; the server is authoritative.
    expect(blindSeats(flopView(0))).toEqual({ small: 0, big: 1 });
  });

  // The two below exercise the FALLBACK derivation, used only for a view from a server that does
  // not state the blinds. They blank the stated values to reach it.
  const unstated = (v: TableView): TableView =>
    v.hand ? { ...v, hand: { ...v.hand, smallBlindSeat: null, bigBlindSeat: null } } : v;

  it('derives the blinds from the button when the server does not state them', () => {
    // flopView: seats 0, 1, 3 dealt in, button on 1.
    expect(blindSeats(unstated(flopView(0)))).toEqual({ small: 3, big: 0 });
  });

  it('gives the button the small blind heads-up', () => {
    const base = flopView(0);
    const v: TableView = unstated({ ...base, button: 1, seats: base.seats.filter((s) => s.seat !== 3) });
    expect(blindSeats(v)).toEqual({ small: 1, big: 0 });
  });
});

describe('lastActions', () => {
  const actions: ActionRecord[] = [
    { seat: 0, street: 'preflop', action: { type: 'raise', amount: 6 }, amount: 6 },
    { seat: 1, street: 'preflop', action: { type: 'call' }, amount: 6 },
    { seat: 0, street: 'flop', action: { type: 'check' }, amount: 0 },
    { seat: 1, street: 'flop', action: { type: 'bet', amount: 8 }, amount: 8 },
    { seat: 0, street: 'flop', action: { type: 'call' }, amount: 8 },
  ];

  it('keeps only the current street, last action per seat', () => {
    const m = lastActions(actions, 'flop');
    expect(m.get(0)?.action).toEqual({ type: 'call' });
    expect(m.get(1)?.action).toEqual({ type: 'bet', amount: 8 });
    expect(lastActions(actions, 'preflop').get(0)?.action).toEqual({ type: 'raise', amount: 6 });
    expect(lastActions(actions, 'turn').size).toBe(0);
  });
});
