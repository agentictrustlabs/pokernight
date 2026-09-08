import { describe, expect, it } from 'vitest';
import {
  actionBadge,
  eventActor,
  fmtChips,
  fmtDelta,
  formatEvent,
  formatResult,
  joinNames,
  potOdds,
  secondsLeft,
  shortHex,
  streetLabel,
  summarizeResult,
} from './format';
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
    // A Home that knows someone only as a phone number asserts no name, and the table service hands
    // back their address. The log says the seat rather than forty characters of hex.
    expect(formatEvent({ type: 'seat-joined', seat: 4, playerId: 'p', name: '0x6a98eff1…4308f341', stack: 200 }, ctx)).toEqual([
      'Seat 5 sits at seat 5 with 200',
    ]);
    // A nameless chatter at a seat is that seat; one who is not seated at all is "Someone".
    const seatedCtx = { ...ctx, seatOf: (id: string) => (id === 'p2' ? 1 : null) };
    expect(formatEvent({ type: 'chat', playerId: 'p2', name: '0x6a98eff1…4308f341', text: 'nh', at: 0 }, seatedCtx)).toEqual(['Seat 2: nh']);
    expect(formatEvent({ type: 'chat', playerId: 'p9', name: '0x6a98eff1…4308f341', text: 'hi', at: 0 }, ctx)).toEqual(['Someone: hi']);
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

describe('summarizeResult', () => {
  const winCtx = { seatName: (s: number) => names[s] ?? `Seat ${s + 1}`, viewerSeat: 0 };

  it('names the hand at showdown', () => {
    const s = summarizeResult(
      { awards: [{ potIndex: 0, amount: 34, seat: 1, rank: twoPair }], net: { 0: -17, 1: 17 }, shown: [], rake: 0 },
      winCtx,
    );
    expect(s.headline).toBe('Bob wins 34');
    expect(s.detail).toBe('Two pair, aces and eights');
    expect(s.line).toBe('Bob wins 34 with Two pair, aces and eights');
    expect(s.showdown).toBe(true);
    expect(s.seats).toEqual([1]);
  });

  it('never invents a hand for a fold-to-one win', () => {
    const s = summarizeResult({ awards: [{ potIndex: 0, amount: 12, seat: 1 }], net: {}, shown: [], rake: 0 }, winCtx);
    expect(s.showdown).toBe(false);
    expect(s.detail).toBe('uncontested');
    expect(s.line).toBe('Bob wins 12 (uncontested)');
  });

  it('reads a split pot as a split', () => {
    const s = summarizeResult(
      {
        awards: [
          { potIndex: 0, amount: 17, seat: 0, rank: twoPair },
          { potIndex: 0, amount: 17, seat: 1, rank: twoPair },
        ],
        net: {},
        shown: [],
        rake: 1,
      },
      winCtx,
    );
    expect(s.headline).toBe('Alice and Bob split 34');
    expect(s.entries).toHaveLength(2);
    expect(s.rake).toBe(1);
  });

  it('borrows the label from the shown cards when the award has none', () => {
    const s = summarizeResult(
      { awards: [{ potIndex: 0, amount: 9, seat: 1 }], net: {}, shown: [{ seat: 1, holeCards: ['8c', '8s'], rank: twoPair }], rake: 0 },
      winCtx,
    );
    expect(s.detail).toBe('Two pair, aces and eights');
  });

  it('lists both hands when side pots went to different hands', () => {
    const other: HandRank = { category: 'flush', value: 9, cards: ['Ah', 'Th', '8h', '5h', '2h'], label: 'Flush, ace high' };
    const s = summarizeResult(
      {
        awards: [
          { potIndex: 0, amount: 20, seat: 1, rank: twoPair },
          { potIndex: 1, amount: 8, seat: 0, rank: other },
        ],
        net: {},
        shown: [],
        rake: 0,
      },
      winCtx,
    );
    expect(s.detail).toBe('Bob: Two pair, aces and eights · Alice: Flush, ace high');
  });
});

describe('joinNames', () => {
  it('reads like a sentence', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Alice'])).toBe('Alice');
    expect(joinNames(['Alice', 'Bob'])).toBe('Alice and Bob');
    expect(joinNames(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob and Carol');
  });
});

describe('table furniture', () => {
  it('labels streets', () => {
    expect(streetLabel('flop')).toBe('Flop');
    expect(streetLabel('showdown')).toBe('Showdown');
    expect(streetLabel('nonsense')).toBe('nonsense');
  });

  it('signs chip deltas', () => {
    expect(fmtDelta(34)).toBe('+34');
    expect(fmtDelta(-1234)).toBe('-1,234');
    expect(fmtDelta(0)).toBe('0');
  });

  it('badges the last action per seat', () => {
    expect(actionBadge({ seat: 0, street: 'flop', action: { type: 'fold' }, amount: 0 })).toBe('Fold');
    expect(actionBadge({ seat: 0, street: 'flop', action: { type: 'check' }, amount: 0 })).toBe('Check');
    expect(actionBadge({ seat: 0, street: 'flop', action: { type: 'call' }, amount: 6 })).toBe('Call 6');
    expect(actionBadge({ seat: 0, street: 'flop', action: { type: 'call' }, amount: 0 })).toBe('Call');
    expect(actionBadge({ seat: 0, street: 'flop', action: { type: 'bet', amount: 8 }, amount: 8 })).toBe('Bet 8');
    expect(actionBadge({ seat: 0, street: 'flop', action: { type: 'raise', amount: 24 }, amount: 18 })).toBe('Raise to 24');
    expect(actionBadge({ seat: 0, street: 'flop', action: { type: 'all-in' }, amount: 1500 })).toBe('All-in 1,500');
  });

  it('quotes pot odds only when there is something to call', () => {
    expect(potOdds(8, 26)).toBe('call 8 to win 34');
    expect(potOdds(0, 26)).toBeNull();
  });

  it('attributes a line to a seat so the log can colour it', () => {
    const seated = { ...ctx, seatOf: (p: string) => (p === 'p-bob' ? 1 : null) };
    expect(eventActor({ type: 'action', record: { seat: 3, street: 'flop', action: { type: 'fold' }, amount: 0 } }, seated)).toBe(3);
    expect(eventActor({ type: 'blind-posted', seat: 1, kind: 'big', amount: 2 }, seated)).toBe(1);
    expect(eventActor({ type: 'chat', playerId: 'p-bob', name: 'Bob', text: 'nh', at: 0 }, seated)).toBe(1);
    expect(eventActor({ type: 'chat', playerId: 'p-zed', name: 'Zed', text: 'hi', at: 0 }, seated)).toBeNull();
    expect(eventActor({ type: 'street', street: 'flop', board: ['Ah', '7d', '2c'] }, seated)).toBeNull();
  });
});
