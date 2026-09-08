import { describe, expect, it } from 'vitest';
import { fmtChips, formatEvent, formatResult, secondsLeft, shortHex } from './format';
import type { HandRank } from './types';

const names: Record<number, string> = { 0: 'Alice', 1: 'Bob', 3: 'Carol' };
const ctx = { seatName: (s: number) => names[s] ?? `Seat ${s + 1}`, viewerSeat: 0 };
const twoPair: HandRank = { category: 'two-pair', value: 1, cards: ['Ah', 'Ad', '8c', '8s', 'Kd'], label: 'Two pair, aces and eights' };

describe('formatEvent', () => {
  it('renders actions', () => {
    expect(formatEvent({ type: 'action', record: { seat: 0, street: 'preflop', action: { type: 'raise', amount: 12 }, amount: 10 } }, ctx)).toEqual(['Alice raises to 12']);
    expect(formatEvent({ type: 'action', record: { seat: 1, street: 'flop', action: { type: 'bet', amount: 6 }, amount: 6 } }, ctx)).toEqual(['Bob bets 6']);
    expect(formatEvent({ type: 'action', record: { seat: 1, street: 'flop', action: { type: 'call' }, amount: 6 } }, ctx)).toEqual(['Bob calls 6']);
    expect(formatEvent({ type: 'action', record: { seat: 3, street: 'flop', action: { type: 'check' }, amount: 0 } }, ctx)).toEqual(['Carol checks']);
    expect(formatEvent({ type: 'action', record: { seat: 3, street: 'flop', action: { type: 'fold' }, amount: 0, timedOut: true } }, ctx)).toEqual(['Carol folds (timed out)']);
    expect(formatEvent({ type: 'action', record: { seat: 0, street: 'river', action: { type: 'all-in' }, amount: 1234 } }, ctx)).toEqual(['Alice goes all-in for 1,234']);
  });

  it('renders streets with only the new cards', () => {
    expect(formatEvent({ type: 'street', street: 'flop', board: ['Ah', '7d', '2c'] }, ctx)).toEqual(['Flop: Ah 7d 2c']);
    expect(formatEvent({ type: 'street', street: 'turn', board: ['Ah', '7d', '2c', 'Kc'] }, ctx)).toEqual(['Turn: Kc']);
    expect(formatEvent({ type: 'street', street: 'river', board: ['Ah', '7d', '2c', 'Kc', '9s'] }, ctx)).toEqual(['River: 9s']);
  });

  it('renders blinds, hole cards, showdown, seats and chat', () => {
    expect(formatEvent({ type: 'blind-posted', seat: 1, kind: 'big', amount: 2 }, ctx)).toEqual(['Bob posts big blind 2']);
    expect(formatEvent({ type: 'blind-posted', seat: 1, kind: 'ante', amount: 1 }, ctx)).toEqual(['Bob posts ante 1']);
    expect(formatEvent({ type: 'hole-cards', seat: 0, cards: ['Ah', 'Kd'], private: true }, ctx)).toEqual(['You are dealt Ah Kd']);
    expect(formatEvent({ type: 'showdown', shown: [{ seat: 1, holeCards: ['8c', '8s'], rank: twoPair }] }, ctx)).toEqual(['Bob shows 8c 8s — Two pair, aces and eights']);
    expect(formatEvent({ type: 'seat-joined', seat: 4, playerId: 'p', name: 'Dave', stack: 100 }, ctx)).toEqual(['Dave sits at seat 5 with 100']);
    expect(formatEvent({ type: 'seat-status', seat: 1, playerId: 'p', status: 'sitting-out' }, ctx)).toEqual(['Bob sits out']);
    expect(formatEvent({ type: 'chat', playerId: 'p', name: 'Bob', text: 'nh', at: 0 }, ctx)).toEqual(['Bob: nh']);
    expect(formatEvent({ type: 'hand-started', handNo: 3, seedCommit: 'x', button: 3, seats: [0, 1, 3] }, ctx)).toEqual(['Hand #3 — button Carol, 3 players']);
  });

  it('is silent for turn events and single pots', () => {
    expect(formatEvent({ type: 'turn', seat: 0, legal: { fold: true, check: true, call: null, bet: null, raise: null, allIn: 0 } }, ctx)).toEqual([]);
    expect(formatEvent({ type: 'pots', pots: [{ amount: 10, eligible: [0, 1] }] }, ctx)).toEqual([]);
    expect(formatEvent({ type: 'pots', pots: [{ amount: 10, eligible: [0, 1] }, { amount: 4, eligible: [1] }] }, ctx)).toEqual(['Side pots: 10 / 4']);
  });
});

describe('formatResult', () => {
  it('aggregates awards per seat and mentions the hand', () => {
    const lines = formatResult(
      {
        awards: [
          { potIndex: 0, amount: 30, seat: 1, rank: twoPair },
          { potIndex: 1, amount: 4, seat: 1, rank: twoPair },
          { potIndex: 2, amount: 9, seat: 0 },
        ],
        net: {},
        shown: [],
        rake: 0,
      },
      ctx,
    );
    expect(lines).toEqual(['Bob wins 34 with Two pair, aces and eights', 'Alice wins 9']);
  });

  it('reports rake', () => {
    expect(formatResult({ awards: [{ potIndex: 0, amount: 9, seat: 0 }], net: {}, shown: [], rake: 1 }, ctx)).toEqual(['Alice wins 9', 'Rake 1']);
  });
});

describe('helpers', () => {
  it('formats chips with thousands separators', () => {
    expect(fmtChips(1234567)).toBe('1,234,567');
  });
  it('truncates hex', () => {
    expect(shortHex('3f9a2c5e7b1d')).toBe('3f9a2c5e…');
    expect(shortHex('abc')).toBe('abc');
  });
  it('counts down without going negative', () => {
    expect(secondsLeft(10_000, 7_400)).toBe(3);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
  });
});
