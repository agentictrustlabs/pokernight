import { describe, expect, it } from 'vitest';
import { fullDeck, type ActionRecord, type Card, type LegalActions, type Street, type TableView } from '@pokernight/engine';
import { POKER_ACT_SKILL, type PokerActInput } from '@pokernight/protocol';
import { decide, isLegal, legalize } from './strategy.js';
import { fakeEvaluate, legalFor, makeInput, makeView, seededRng } from './test-helpers.js';

const opts = { evaluate: fakeEvaluate, rng: seededRng(1) };

/* ------------------------------------------------------ fixture generator */

function randomFixture(rng: () => number): PokerActInput {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

  const nSeats = int(2, 9);
  const seatNos = Array.from({ length: nSeats }, (_, i) => i);
  const viewer = pick(seatNos);
  const button = pick(seatNos);
  const street = pick<Street>(['preflop', 'flop', 'turn', 'river', 'showdown']);
  const boardLen = street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  const bb = pick([2, 10, 50]);

  // Deal distinct cards.
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const board = deck.splice(0, boardLen) as Card[];
  const hole = deck.splice(0, rng() < 0.9 ? 2 : 0) as Card[];

  const currentBet = rng() < 0.5 ? 0 : int(1, 20) * bb;
  const seats = seatNos.map((seat) => {
    const folded = seat !== viewer && rng() < 0.3;
    const out = seat !== viewer && rng() < 0.15;
    const streetBet = folded || out ? 0 : rng() < 0.5 ? currentBet : int(0, currentBet);
    return {
      seat,
      stack: rng() < 0.1 ? 0 : int(1, 300) * bb,
      folded,
      out,
      streetBet,
      totalBet: streetBet + int(0, 10) * bb,
      hole: seat === viewer ? hole : undefined,
    };
  });
  const me = seats.find((s) => s.seat === viewer)!;
  me.streetBet = Math.min(me.streetBet, currentBet);

  const actions: ActionRecord[] = [];
  const nActions = int(0, 6);
  for (let i = 0; i < nActions; i++) {
    const type = pick(['fold', 'check', 'call', 'bet', 'raise', 'all-in'] as const);
    const amount = int(0, 10) * bb;
    actions.push({
      seat: pick(seatNos),
      street: pick<Street>(['preflop', 'flop', 'turn', 'river']),
      action: type === 'bet' || type === 'raise' ? { type, amount: Math.max(1, amount) } : { type },
      amount,
    });
  }

  const noHand = rng() < 0.05;
  const view = makeView({
    seats,
    button,
    viewer,
    street,
    board,
    potAmount: int(0, 100) * bb,
    currentBet,
    minRaise: bb * int(1, 5),
    actions,
    noHand,
    config: { bigBlind: bb, smallBlind: bb / 2, seats: nSeats },
  });

  // Legal actions: mostly consistent with the view, sometimes deliberately odd.
  let legal: LegalActions;
  if (rng() < 0.7 && !noHand) {
    legal = legalFor(view);
  } else {
    const check = rng() < 0.5;
    const call = check ? (rng() < 0.5 ? null : 0) : rng() < 0.8 ? int(1, 200) : null;
    const range = () => {
      const min = int(1, 100);
      return { min, max: min + int(0, 400) };
    };
    legal = {
      fold: rng() < 0.7,
      check,
      call,
      bet: rng() < 0.4 ? range() : null,
      raise: rng() < 0.4 ? range() : null,
      allIn: rng() < 0.7 ? int(1, 500) : 0,
    };
  }
  // Guarantee at least one legal action exists.
  if (!legal.fold && !legal.check && !(legal.call && legal.call > 0) && !legal.bet && !legal.raise && legal.allIn === 0) {
    legal.fold = true;
  }
  return { skill: POKER_ACT_SKILL, tableId: 't', handNo: 7, seat: viewer, view, legal, deadlineMs: 1000 };
}

describe('decide is always legal', () => {
  it('across 500 randomized fixtures', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 500; i++) {
      const input = randomFixture(rng);
      const out = decide(input, { evaluate: fakeEvaluate, rng: seededRng(i) });
      if (!isLegal(out.action, input.legal)) {
        throw new Error(`illegal ${JSON.stringify(out)} for legal=${JSON.stringify(input.legal)} (fixture ${i})`);
      }
      expect(typeof out.note).toBe('string');
      expect(out.note!.length).toBeLessThanOrEqual(280);
    }
  });

  it('is deterministic with an injected rng', () => {
    const fixtures = Array.from({ length: 50 }, () => randomFixture(seededRng(7)));
    for (const f of fixtures) {
      const a = decide(f, { evaluate: fakeEvaluate, rng: seededRng(3) });
      const b = decide(f, { evaluate: fakeEvaluate, rng: seededRng(3) });
      expect(a).toEqual(b);
    }
  });

  it('legalize snaps amounts into range and falls back sensibly', () => {
    const view = makeView({ button: 0, viewer: 1, seats: [{ seat: 0, stack: 100 }, { seat: 1, stack: 100, hole: ['As', 'Ad'] }] });
    const legal: LegalActions = { fold: true, check: false, call: 10, bet: null, raise: { min: 20, max: 60 }, allIn: 0 };
    expect(legalize({ type: 'raise', amount: 5 }, legal, view)).toEqual({ type: 'raise', amount: 20 });
    expect(legalize({ type: 'raise', amount: 500 }, legal, view)).toEqual({ type: 'raise', amount: 60 });
    expect(legalize({ type: 'bet', amount: 30 }, legal, view)).toEqual({ type: 'raise', amount: 30 });
    expect(legalize({ type: 'check' }, legal, view)).toEqual({ type: 'fold' });
    expect(legalize({ type: 'check' }, { ...legal, call: 2 }, view)).toEqual({ type: 'call' });
    expect(legalize({ type: 'all-in' }, legal, view)).toEqual({ type: 'raise', amount: 60 });
    expect(legalize({ type: 'raise', amount: 60 }, { ...legal, allIn: 100 }, view)).toEqual({ type: 'all-in' });
    expect(legalize({ type: 'raise', amount: 40 }, { ...legal, raise: null }, view)).toEqual({ type: 'call' });
  });
});

/* ----------------------------------------------------------- scenarios */

const preflopSix = (hole: Card[], viewer: number, extra: Partial<Parameters<typeof makeView>[0]> = {}) =>
  makeView({
    button: 0,
    viewer,
    street: 'preflop',
    currentBet: 2,
    seats: [
      { seat: 0, stack: 200 },
      { seat: 1, stack: 200, streetBet: 1 },
      { seat: 2, stack: 200, streetBet: 2 },
      { seat: 3, stack: 200 },
      { seat: 4, stack: 200 },
      { seat: 5, stack: 200 },
    ].map((s) => (s.seat === viewer ? { ...s, hole } : s)),
    ...extra,
  });

describe('decide scenarios', () => {
  it('AA raises preflop from UTG, 2.5-3x the big blind', () => {
    const view = preflopSix(['As', 'Ad'], 3);
    const out = decide(makeInput(view), opts);
    expect(out.action.type).toBe('raise');
    if (out.action.type === 'raise') {
      expect(out.action.amount).toBeGreaterThanOrEqual(5);
      expect(out.action.amount).toBeLessThanOrEqual(6);
    }
    expect(out.note).toMatch(/AA/);
  });

  it('raise sizing adds a big blind per limper', () => {
    const view = preflopSix(['Ks', 'Kd'], 5, {
      actions: [
        { seat: 3, street: 'preflop', action: { type: 'call' }, amount: 2 },
        { seat: 4, street: 'preflop', action: { type: 'call' }, amount: 2 },
      ],
    });
    const out = decide(makeInput(view), { ...opts, rng: () => 0.9 });
    expect(out.action).toEqual({ type: 'raise', amount: 9 }); // (2.5 + 2 limpers) * 2
  });

  it('72o folds to a raise', () => {
    const view = preflopSix(['7c', '2d'], 5, {
      currentBet: 6,
      actions: [{ seat: 3, street: 'preflop', action: { type: 'raise', amount: 6 }, amount: 6 }],
    });
    const out = decide(makeInput(view), opts);
    expect(out.action).toEqual({ type: 'fold' });
  });

  it('72o checks in the big blind when nobody raised', () => {
    const view = preflopSix(['7c', '2d'], 2, {
      actions: [{ seat: 3, street: 'preflop', action: { type: 'call' }, amount: 2 }],
    });
    const legal = legalFor(view);
    expect(legal.check).toBe(true);
    expect(decide(makeInput(view, legal), opts).action).toEqual({ type: 'check' });
  });

  it('QQ 3-bets an open', () => {
    const view = preflopSix(['Qs', 'Qd'], 0, {
      currentBet: 6,
      actions: [{ seat: 3, street: 'preflop', action: { type: 'raise', amount: 6 }, amount: 6 }],
    });
    const out = decide(makeInput(view), opts);
    expect(out.action.type).toBe('raise');
    if (out.action.type === 'raise') expect(out.action.amount).toBeGreaterThanOrEqual(18);
  });

  it('flush draw calls a half-pot bet with good odds and folds to a big overbet', () => {
    const base = {
      button: 0,
      viewer: 0,
      street: 'flop' as const,
      board: ['7s', '8s', 'Kd'] as Card[],
    };
    const call = makeView({
      ...base,
      potAmount: 40,
      currentBet: 20,
      seats: [
        { seat: 0, stack: 200, hole: ['As', '2s'] },
        { seat: 2, stack: 200, streetBet: 20 },
      ],
    });
    const out = decide(makeInput(call), opts);
    expect(out.action).toEqual({ type: 'call' });
    expect(out.note).toMatch(/draw/);

    const overbet = makeView({
      ...base,
      potAmount: 40,
      currentBet: 160,
      seats: [
        { seat: 0, stack: 400, hole: ['As', '2s'] },
        { seat: 2, stack: 400, streetBet: 160 },
      ],
    });
    expect(decide(makeInput(overbet), opts).action).toEqual({ type: 'fold' });
  });

  it('top pair bets for value when checked to', () => {
    const view = makeView({
      button: 0,
      viewer: 0,
      street: 'flop',
      board: ['Kc', '7h', '2d'],
      potAmount: 20,
      seats: [
        { seat: 0, stack: 200, hole: ['Ks', 'Qs'] },
        { seat: 2, stack: 200 },
      ],
    });
    const out = decide(makeInput(view), opts);
    expect(out.action.type).toBe('bet');
    if (out.action.type === 'bet') expect(out.action.amount).toBe(13); // 65% of 20
  });

  it('air folds to a bet and checks when free', () => {
    const mk = (currentBet: number, oppBet: number) =>
      makeView({
        button: 0,
        viewer: 0,
        street: 'turn',
        board: ['Kc', '7h', '2d', '9c'],
        potAmount: 30,
        currentBet,
        seats: [
          { seat: 0, stack: 200, hole: ['4s', '5d'] },
          { seat: 2, stack: 200, streetBet: oppBet },
        ],
      });
    expect(decide(makeInput(mk(20, 20)), opts).action).toEqual({ type: 'fold' });
    expect(decide(makeInput(mk(0, 0)), { ...opts, rng: () => 0.99 }).action).toEqual({ type: 'check' });
  });

  it('shoves with top pair or better when SPR < 1', () => {
    const view = makeView({
      button: 0,
      viewer: 0,
      street: 'flop',
      board: ['Kc', '7h', '2d'],
      potAmount: 100,
      currentBet: 30,
      seats: [
        { seat: 0, stack: 60, hole: ['Ks', 'Qs'] },
        { seat: 2, stack: 300, streetBet: 30 },
      ],
    });
    expect(decide(makeInput(view), opts).action).toEqual({ type: 'all-in' });
  });

  it('a set raises a bet for value', () => {
    const view = makeView({
      button: 0,
      viewer: 0,
      street: 'flop',
      board: ['Kc', '7h', '2d'],
      potAmount: 30,
      currentBet: 20,
      seats: [
        { seat: 0, stack: 300, hole: ['7s', '7d'] },
        { seat: 2, stack: 300, streetBet: 20 },
      ],
    });
    const out = decide(makeInput(view), { ...opts, rng: () => 0.9 });
    expect(out.action).toEqual({ type: 'raise', amount: 60 });
  });

  it('falls back safely with no hand context', () => {
    const view: TableView = { ...preflopSix(['As', 'Ad'], 3), hand: null };
    const legal: LegalActions = { fold: true, check: false, call: 50, bet: null, raise: null, allIn: 200 };
    expect(decide(makeInput(view, legal), opts).action).toEqual({ type: 'fold' });
    expect(decide(makeInput(view, { ...legal, check: true }), opts).action).toEqual({ type: 'check' });
  });
});
