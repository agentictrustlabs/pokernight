import { describe, expect, it } from 'vitest';
import {
  effectiveStack,
  inPosition,
  myHoleCards,
  playersInHand,
  position,
  potOdds,
  potTotal,
  seatsFromButton,
  street,
  toCall,
  wasAggressor,
} from './view.js';
import { legalFor, makeView } from './test-helpers.js';

const sixMax = (viewer: number, button = 0) =>
  makeView({
    button,
    viewer,
    seats: [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, stack: 200, hole: ['As', 'Kd'] })),
  });

describe('view helpers', () => {
  it('myHoleCards returns the viewer cards and nothing for spectators', () => {
    expect(myHoleCards(sixMax(2))).toEqual(['As', 'Kd']);
    const spectator = { ...sixMax(2), viewerSeat: null };
    expect(myHoleCards(spectator)).toEqual([]);
    expect(myHoleCards(makeView({ button: 0, viewer: 1, noHand: true, seats: [{ seat: 1, stack: 10 }] }))).toEqual([]);
  });

  it('potTotal sums collected pots and current street bets', () => {
    const view = makeView({
      button: 0,
      viewer: 2,
      street: 'flop',
      potAmount: 30,
      currentBet: 10,
      seats: [
        { seat: 0, stack: 100, streetBet: 10 },
        { seat: 1, stack: 100, streetBet: 0, folded: true },
        { seat: 2, stack: 100, streetBet: 0, hole: ['2c', '3c'] },
      ],
    });
    expect(potTotal(view)).toBe(40);
    expect(potTotal({ ...view, hand: null })).toBe(0);
  });

  it('toCall and potOdds', () => {
    const view = makeView({
      button: 0,
      viewer: 2,
      street: 'flop',
      potAmount: 30,
      currentBet: 10,
      seats: [
        { seat: 0, stack: 100, streetBet: 10 },
        { seat: 2, stack: 100, hole: ['2c', '3c'] },
      ],
    });
    const legal = legalFor(view);
    expect(toCall(legal)).toBe(10);
    expect(potOdds(legal, view)).toBeCloseTo(10 / 50);
    expect(toCall({ ...legal, call: null })).toBe(0);
    expect(potOdds({ ...legal, call: null }, view)).toBe(0);
  });

  it('playersInHand excludes folded and undealt seats', () => {
    const view = makeView({
      button: 0,
      viewer: 2,
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 100, folded: true },
        { seat: 2, stack: 100 },
        { seat: 3, stack: 100, out: true },
      ],
    });
    expect(playersInHand(view).map((s) => s.seat)).toEqual([0, 2]);
  });

  it('effectiveStack is min(own, biggest live opponent) including chips committed', () => {
    const view = makeView({
      button: 0,
      viewer: 2,
      seats: [
        { seat: 0, stack: 50, totalBet: 10 },
        { seat: 1, stack: 500, folded: true },
        { seat: 2, stack: 300, totalBet: 10 },
        { seat: 3, stack: 120, totalBet: 10 },
      ],
    });
    expect(effectiveStack(view)).toBe(130);
    const shortMe = { ...view, seats: view.seats.map((s) => (s.seat === 2 ? { ...s, stack: 20 } : s)) };
    expect(effectiveStack(shortMe)).toBe(30);
  });

  it('street', () => {
    expect(street(sixMax(1))).toBe('preflop');
    expect(street(makeView({ button: 0, viewer: 1, street: 'turn', seats: [{ seat: 1, stack: 1 }] }))).toBe('turn');
    expect(street(makeView({ button: 0, viewer: 1, noHand: true, seats: [{ seat: 1, stack: 1 }] }))).toBeNull();
  });

  it('seatsFromButton orders seats clockwise from the button, button last', () => {
    expect(seatsFromButton(sixMax(0, 2))).toEqual([3, 4, 5, 0, 1, 2]);
  });

  it('position: 6-max labels', () => {
    // Button 0: SB 1, BB 2, UTG 3, HJ 4, CO 5.
    expect(position(sixMax(1))).toBe('blinds');
    expect(position(sixMax(2))).toBe('blinds');
    expect(position(sixMax(3))).toBe('early');
    expect(position(sixMax(4))).toBe('middle');
    expect(position(sixMax(5))).toBe('late');
    expect(position(sixMax(0))).toBe('late');
  });

  it('position: full ring and heads-up', () => {
    const ring = (viewer: number) =>
      makeView({ button: 8, viewer, seats: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((seat) => ({ seat, stack: 100 })) });
    expect(position(ring(0))).toBe('blinds');
    expect(position(ring(1))).toBe('blinds');
    expect(position(ring(2))).toBe('early');
    expect(position(ring(3))).toBe('early');
    expect(position(ring(4))).toBe('early');
    expect(position(ring(5))).toBe('middle');
    expect(position(ring(6))).toBe('middle');
    expect(position(ring(7))).toBe('late');
    expect(position(ring(8))).toBe('late');

    const hu = (viewer: number) => makeView({ button: 3, viewer, seats: [{ seat: 3, stack: 10 }, { seat: 5, stack: 10 }] });
    expect(position(hu(3))).toBe('late');
    expect(position(hu(5))).toBe('blinds');
    expect(position({ ...hu(3), viewerSeat: null })).toBeNull();
  });

  it('inPosition and wasAggressor', () => {
    const view = makeView({
      button: 0,
      viewer: 0,
      street: 'flop',
      seats: [
        { seat: 0, stack: 100, hole: ['As', 'Ad'] },
        { seat: 1, stack: 100, folded: true },
        { seat: 2, stack: 100 },
      ],
      actions: [
        { seat: 0, street: 'preflop', action: { type: 'raise', amount: 6 }, amount: 6 },
        { seat: 2, street: 'preflop', action: { type: 'call' }, amount: 4 },
      ],
    });
    expect(inPosition(view)).toBe(true);
    expect(inPosition({ ...view, viewerSeat: 2 })).toBe(false);
    expect(wasAggressor(view)).toBe(true);
    expect(wasAggressor({ ...view, viewerSeat: 2 })).toBe(false);
  });
});
