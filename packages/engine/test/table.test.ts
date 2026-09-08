import { describe, expect, it } from 'vitest';
import type { Action, EngineEvent, TableState } from '../src/index.js';
import {
  EngineError,
  addChips,
  applyAction,
  canStartHand,
  createTable,
  legalActions,
  redactEvent,
  setActionDeadline,
  sitDown,
  sitIn,
  sitOut,
  standUp,
  startHand,
  timeoutAction,
  viewFor,
} from '../src/index.js';
import { handSeed } from './random-play.js';

/* ---------------------------------------------------------------------------
 * Helpers. Every engine call is wrapped so the input is asserted unchanged.
 * ------------------------------------------------------------------------ */

function frozen<T>(state: TableState, fn: () => T): T {
  const before = JSON.stringify(state);
  const out = fn();
  expect(JSON.stringify(state), 'input state must not be mutated').toBe(before);
  return out;
}

const start = (s: TableState, seedNo = 1): { state: TableState; events: EngineEvent[] } =>
  frozen(s, () => startHand(s, handSeed(seedNo)));

const act = (s: TableState, seat: number, action: Action): { state: TableState; events: EngineEvent[] } =>
  frozen(s, () => applyAction(s, seat, action));

const CASH = { seats: 6, smallBlind: 1, bigBlind: 2, minBuyIn: 2, maxBuyIn: 1000 };

function table(stacks: Record<number, number>, config: Partial<Parameters<typeof createTable>[0]> = {}): TableState {
  let s = createTable({ ...CASH, ...config });
  for (const [seat, stack] of Object.entries(stacks)) s = sitDown(s, Number(seat), `p${seat}`, stack);
  return s;
}

const stack = (s: TableState, seat: number): number => s.seats.find((x) => x.seat === seat)!.stack;
const types = (events: EngineEvent[]): string[] => events.map((e) => e.type);

/** Play a list of [seat, action] pairs. */
function play(s: TableState, steps: [number, Action][]): { state: TableState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  for (const [seat, action] of steps) {
    const r = act(s, seat, action);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const call: Action = { type: 'call' };
const check: Action = { type: 'check' };
const fold: Action = { type: 'fold' };
const allIn: Action = { type: 'all-in' };
const raise = (amount: number): Action => ({ type: 'raise', amount });
const bet = (amount: number): Action => ({ type: 'bet', amount });

function expectCode(fn: () => unknown, code: EngineError['code']): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
}

/** Search hand seeds until the finished hand satisfies `pred`. */
function findSeed(s: TableState, steps: [number, Action][], pred: (final: TableState) => boolean, max = 5000): number {
  for (let i = 1; i < max; i++) {
    let st = startHand(s, handSeed(i)).state;
    for (const [seat, action] of steps) {
      if (!st.hand || st.hand.result) break;
      st = applyAction(st, seat, action).state;
    }
    if (st.hand?.result && pred(st)) return i;
  }
  throw new Error('no seed found');
}

/* ---------------------------------------------------------------------------
 * Table lifecycle
 * ------------------------------------------------------------------------ */

describe('createTable / seating', () => {
  it('validates config', () => {
    expectCode(() => createTable({ seats: 1 }), 'seat-invalid');
    expectCode(() => createTable({ seats: 10 }), 'seat-invalid');
    expectCode(() => createTable({ smallBlind: 2, bigBlind: 2 }), 'illegal-action');
    expectCode(() => createTable({ minBuyIn: 300, maxBuyIn: 200 }), 'buy-in-range');
    expectCode(() => createTable({ bigBlind: 50, minBuyIn: 40 }), 'buy-in-range');
    const t = createTable();
    expect(t.config.seats).toBe(6);
    expect(t.button).toBeNull();
    expect(t.hand).toBeNull();
  });

  it('sitDown validates and does not mutate', () => {
    const t = createTable();
    const s1 = frozen(t, () => sitDown(t, 2, 'alice', 100));
    expect(t.seats).toEqual([]);
    expect(s1.seats[0]).toMatchObject({ seat: 2, playerId: 'alice', stack: 100, status: 'active', waitingForBigBlind: true, timeouts: 0 });
    expectCode(() => sitDown(s1, 2, 'bob', 100), 'seat-taken');
    expectCode(() => sitDown(s1, 6, 'bob', 100), 'seat-invalid');
    expectCode(() => sitDown(s1, -1, 'bob', 100), 'seat-invalid');
    expectCode(() => sitDown(s1, 3, 'alice', 100), 'player-seated');
    expectCode(() => sitDown(s1, 3, 'bob', 10), 'buy-in-range');
    expectCode(() => sitDown(s1, 3, 'bob', 201), 'buy-in-range');
    expectCode(() => sitDown(s1, 3, 'bob', 50.5), 'buy-in-range');
    expect(canStartHand(s1)).toBe(false);
    expect(canStartHand(sitDown(s1, 3, 'bob', 100))).toBe(true);
  });

  it('standUp, sitOut, sitIn, addChips outside a hand', () => {
    let s = table({ 0: 100, 1: 100 });
    expectCode(() => standUp(s, 4), 'not-seated');
    expectCode(() => sitOut(s, 4), 'not-seated');
    expectCode(() => addChips(s, 4, 10), 'not-seated');
    expectCode(() => addChips(s, 0, 901), 'buy-in-range');
    expectCode(() => addChips(s, 0, 0), 'buy-in-range');
    s = frozen(s, () => addChips(s, 0, 50));
    expect(stack(s, 0)).toBe(150);
    s = frozen(s, () => sitOut(s, 1));
    expect(s.seats[1]!.status).toBe('sitting-out');
    expect(canStartHand(s)).toBe(false);
    s = frozen(s, () => sitIn(s, 1));
    expect(canStartHand(s)).toBe(true);
    const r = frozen(s, () => standUp(s, 0));
    expect(r.cashOut).toBe(150);
    expect(r.events).toEqual([]);
    expect(r.state.seats.map((x) => x.seat)).toEqual([1]);
    expectCode(() => startHand(r.state, handSeed(1)), 'not-enough-players');
  });
});

/* ---------------------------------------------------------------------------
 * Blinds and order
 * ------------------------------------------------------------------------ */

describe('heads-up', () => {
  it('button posts the small blind, acts first preflop and last postflop', () => {
    const t = table({ 0: 100, 3: 100 });
    const { state: s, events } = start(t);
    expect(s.button).toBe(0);
    expect(s.hand!.smallBlindSeat).toBe(0);
    expect(s.hand!.bigBlindSeat).toBe(3);
    expect(s.hand!.toAct).toBe(0);
    expect(types(events)).toEqual(['hand-started', 'blind-posted', 'blind-posted', 'hole-cards', 'hole-cards', 'pots', 'turn']);
    expect(events[1]).toEqual({ type: 'blind-posted', seat: 0, kind: 'small', amount: 1 });
    expect(events[2]).toEqual({ type: 'blind-posted', seat: 3, kind: 'big', amount: 2 });
    // Deal order starts left of the button.
    expect((events[3] as { seat: number }).seat).toBe(3);
    expect((events[4] as { seat: number }).seat).toBe(0);
    expect(events[5]).toEqual({ type: 'pots', pots: [{ amount: 2, eligible: [0, 3] }, { amount: 1, eligible: [3] }] });
    expect(s.hand!.seedCommit).toMatch(/^[0-9a-f]{64}$/);
    expect(s.hand!.seedReveal).toBeUndefined();
    expect(s.hand!.deck.length).toBe(48);
    expect(s.seats.every((x) => !x.waitingForBigBlind)).toBe(true);

    const legal = legalActions(s, 0);
    expect(legal).toEqual({ fold: true, check: false, call: 1, bet: null, raise: { min: 4, max: 100 }, allIn: 99 });
    expect(legalActions(s, 3)).toEqual({ fold: false, check: false, call: null, bet: null, raise: null, allIn: 0 });

    const r1 = act(s, 0, call);
    expect(r1.state.hand!.toAct).toBe(3);
    expect(legalActions(r1.state, 3).check).toBe(true);
    const r2 = act(r1.state, 3, check);
    expect(r2.state.hand!.street).toBe('flop');
    expect(r2.state.hand!.board.length).toBe(3);
    expect(types(r2.events)).toEqual(['action', 'pots', 'street', 'turn']);
    expect(r2.state.hand!.toAct).toBe(3);
    expect(r2.state.hand!.currentBet).toBe(0);
    expect(legalActions(r2.state, 3).bet).toEqual({ min: 2, max: 98 });
  });

  it('button alternates between hands', () => {
    const t = table({ 0: 100, 3: 100 });
    const h1 = play(start(t).state, [[0, fold]]).state;
    expect(h1.hand!.result).toBeDefined();
    expect(h1.button).toBe(3);
    const h2 = start(h1, 2).state;
    expect(h2.hand!.button).toBe(3);
    expect(h2.hand!.smallBlindSeat).toBe(3);
    expect(h2.hand!.bigBlindSeat).toBe(0);
    expect(h2.hand!.toAct).toBe(3);
    expect(h2.handNo).toBe(2);
  });
});

describe('3- and 6-handed order', () => {
  it('3-handed: SB left of button, BB next, UTG (button) first preflop, SB first postflop', () => {
    const { state: s } = start(table({ 0: 100, 1: 100, 2: 100 }));
    expect(s.hand!.button).toBe(0);
    expect(s.hand!.smallBlindSeat).toBe(1);
    expect(s.hand!.bigBlindSeat).toBe(2);
    expect(s.hand!.toAct).toBe(0);
    const r = play(s, [[0, call], [1, call]]);
    expect(r.state.hand!.toAct).toBe(2); // BB option
    expect(legalActions(r.state, 2).raise).toEqual({ min: 4, max: 100 });
    const f = act(r.state, 2, check);
    expect(f.state.hand!.street).toBe('flop');
    expect(f.state.hand!.toAct).toBe(1);
  });

  it('6-handed order and button progression', () => {
    const t = table({ 0: 100, 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 });
    const { state: s, events } = start(t);
    expect(s.hand!.button).toBe(0);
    expect(s.hand!.smallBlindSeat).toBe(1);
    expect(s.hand!.bigBlindSeat).toBe(2);
    expect(s.hand!.toAct).toBe(3);
    expect((events[0] as { seats: number[] }).seats).toEqual([0, 1, 2, 3, 4, 5]);
    const hole = events.filter((e) => e.type === 'hole-cards').map((e) => (e as { seat: number }).seat);
    expect(hole).toEqual([1, 2, 3, 4, 5, 0]);
    const r = play(s, [[3, call], [4, fold], [5, call], [0, call], [1, call], [2, check]]);
    expect(r.state.hand!.street).toBe('flop');
    expect(r.state.hand!.toAct).toBe(1);
    expect(r.state.hand!.pots).toEqual([{ amount: 10, eligible: [0, 1, 2, 3, 5] }]);
    const done = play(r.state, [[1, check], [2, check], [3, check], [5, check], [0, bet(10)], [1, fold], [2, fold], [3, fold], [5, fold]]).state;
    expect(done.hand!.result).toBeDefined();
    expect(done.button).toBe(1);
    const h2 = start(done, 2).state;
    expect(h2.hand!.button).toBe(1);
    expect(h2.hand!.smallBlindSeat).toBe(2);
    expect(h2.hand!.bigBlindSeat).toBe(3);
    expect(h2.hand!.toAct).toBe(4);
  });

  it('button skips a seat that sat out', () => {
    const t = table({ 0: 100, 1: 100, 2: 100, 3: 100 });
    let s = play(start(t).state, [[3, fold], [0, fold], [1, fold]]).state;
    s = sitOut(s, 1);
    const h2 = start(s, 2).state;
    expect(h2.hand!.button).toBe(2);
    expect(h2.hand!.seats.map((x) => x.seat)).toEqual([0, 2, 3]);
  });
});

/* ---------------------------------------------------------------------------
 * Betting legality
 * ------------------------------------------------------------------------ */

describe('betting legality', () => {
  it('preflop uses raise, min raise is one big blind, bet is illegal', () => {
    const { state: s } = start(table({ 0: 100, 1: 100, 2: 100 }));
    expectCode(() => applyAction(s, 0, bet(4)), 'illegal-action');
    expectCode(() => applyAction(s, 0, raise(3)), 'illegal-action');
    expectCode(() => applyAction(s, 0, raise(101)), 'illegal-action');
    expectCode(() => applyAction(s, 0, raise(4.5)), 'illegal-action');
    expectCode(() => applyAction(s, 0, check), 'illegal-action');
    expectCode(() => applyAction(s, 1, call), 'not-your-turn');
    const r = act(s, 0, raise(4));
    expect(r.state.hand!.currentBet).toBe(4);
    expect(r.state.hand!.minRaise).toBe(2);
    expect(r.state.hand!.lastAggressor).toBe(0);
    expect(stack(r.state, 0)).toBe(96);
    // A raise of 6 sets the min raise to 6.
    const r2 = act(r.state, 1, raise(10));
    expect(r2.state.hand!.minRaise).toBe(6);
    expect(legalActions(r2.state, 2).raise).toEqual({ min: 16, max: 100 });
    expect(legalActions(r2.state, 2).call).toBe(8);
    expectCode(() => applyAction(r2.state, 2, raise(15)), 'illegal-action');
  });

  it('postflop bet range, check, and raise-to semantics', () => {
    const s = play(start(table({ 0: 100, 1: 100, 2: 100 })).state, [[0, call], [1, call], [2, check]]).state;
    expect(s.hand!.street).toBe('flop');
    const legal = legalActions(s, 1);
    expect(legal).toEqual({ fold: true, check: true, call: null, bet: { min: 2, max: 98 }, raise: null, allIn: 98 });
    expectCode(() => applyAction(s, 1, bet(1)), 'illegal-action');
    expectCode(() => applyAction(s, 1, bet(99)), 'illegal-action');
    expectCode(() => applyAction(s, 1, raise(10)), 'illegal-action');
    expectCode(() => applyAction(s, 1, call), 'illegal-action');
    const r = act(s, 1, bet(6));
    expect(r.state.hand!.minRaise).toBe(6);
    expect(legalActions(r.state, 2)).toEqual({ fold: true, check: false, call: 6, bet: null, raise: { min: 12, max: 98 }, allIn: 98 });
    expectCode(() => applyAction(r.state, 2, raise(10)), 'illegal-action');
    const r2 = act(r.state, 2, raise(12));
    expect(legalActions(r2.state, 0).raise).toEqual({ min: 18, max: 98 });
    // Bet for the whole stack marks all-in.
    const r3 = act(r2.state, 0, raise(98));
    expect(r3.state.hand!.seats[0]!.allIn).toBe(true);
    expect(stack(r3.state, 0)).toBe(0);
  });

  it('errors outside a hand', () => {
    const t = table({ 0: 100, 1: 100 });
    expectCode(() => applyAction(t, 0, call), 'no-hand');
    expectCode(() => timeoutAction(t, 0), 'no-hand');
    expectCode(() => setActionDeadline(t, 1), 'no-hand');
    expect(legalActions(t, 0).fold).toBe(false);
    const s = start(t).state;
    expectCode(() => startHand(s, handSeed(1)), 'hand-in-progress');
    const d = frozen(s, () => setActionDeadline(s, 12345));
    expect(d.hand!.actionDeadline).toBe(12345);
    expect(s.hand!.actionDeadline).toBeNull();
  });
});

describe('short all-in does not reopen action', () => {
  it('a player who already acted may only call or fold', () => {
    const t = table({ 0: 100, 1: 100, 2: 7 });
    const s = play(start(t).state, [[0, call], [1, call], [2, check]]).state;
    expect(s.hand!.street).toBe('flop');
    // Seat 1 bets 4 (min raise now 4), seat 2 shoves for 5 (raise of 1: short).
    const r = play(s, [[1, bet(4)], [2, allIn]]);
    expect(r.state.hand!.currentBet).toBe(5);
    expect(r.state.hand!.minRaise).toBe(4);
    // Seat 0 has not acted this street: it may raise, min 9.
    expect(legalActions(r.state, 0).raise).toEqual({ min: 9, max: 98 });
    const r2 = act(r.state, 0, call);
    // Seat 1 already bet: facing a short all-in it cannot raise.
    const legal = legalActions(r2.state, 1);
    expect(legal.raise).toBeNull();
    expect(legal.call).toBe(1);
    expect(legal.check).toBe(false);
    expectCode(() => applyAction(r2.state, 1, raise(20)), 'illegal-action');
    const r3 = act(r2.state, 1, call);
    expect(r3.state.hand!.street).toBe('turn');
    expect(r3.state.hand!.pots).toEqual([{ amount: 21, eligible: [0, 1, 2] }]);
  });

  it('a full all-in raise does reopen action', () => {
    const t = table({ 0: 100, 1: 100, 2: 20 });
    const s = play(start(t).state, [[0, call], [1, call], [2, check]]).state;
    const r = play(s, [[1, bet(4)], [2, allIn]]);
    // Seat 2 had 18 behind after posting the big blind: raise of 14 on top of 4.
    expect(r.state.hand!.currentBet).toBe(18);
    expect(r.state.hand!.minRaise).toBe(14);
    const r2 = act(r.state, 0, call);
    expect(legalActions(r2.state, 1).raise).toEqual({ min: 32, max: 98 });
  });
});

/* ---------------------------------------------------------------------------
 * Pots and awards
 * ------------------------------------------------------------------------ */

describe('side pots', () => {
  const t = table({ 0: 50, 1: 100, 2: 200 });
  const steps: [number, Action][] = [[0, allIn], [1, allIn], [2, call]];

  it('three-way all-in with different stacks builds correct pots and runs out', () => {
    const s = start(t).state;
    const r = play(s, steps);
    const st = r.state;
    expect(st.hand!.result).toBeDefined();
    expect(st.hand!.street).toBe('showdown');
    expect(st.hand!.board.length).toBe(5);
    expect(st.hand!.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 100, eligible: [1, 2] },
    ]);
    // The last call closes preflop, then the board is run out in one call.
    const last = r.events.slice(r.events.findIndex((e) => e.type === 'action' && e.record.seat === 2));
    expect(types(last)).toEqual(['action', 'pots', 'street', 'street', 'street', 'showdown', 'hand-ended']);
    expect(stack(st, 2)).toBeGreaterThanOrEqual(100);
    const result = st.hand!.result!;
    expect(result.shown.map((x) => x.seat)).toEqual([0, 1, 2]);
    expect(result.rake).toBe(0);
    expect(Object.values(result.net).reduce((a, b) => a + b, 0)).toBe(0);
    expect(result.awards.reduce((a, b) => a + b.amount, 0)).toBe(250);
    // Awards are consistent with the shown ranks.
    const value = (seat: number): number => result.shown.find((x) => x.seat === seat)!.rank.value;
    for (const pot of st.hand!.pots) {
      const best = Math.max(...pot.eligible.map(value));
      const winners = pot.eligible.filter((seat) => value(seat) === best);
      const awarded = result.awards.filter((a) => a.potIndex === st.hand!.pots.indexOf(pot)).map((a) => a.seat);
      expect(awarded.sort()).toEqual(winners.sort());
    }
    expect(st.hand!.seedReveal).toBeDefined();
    expect(st.hand!.seed).toBeUndefined();
    expect(st.hand!.toAct).toBeNull();
    expect(st.seats.find((x) => x.seat === 0)!.status).toBe(stack(st, 0) === 0 ? 'sitting-out' : 'active');
  });

  it('short stack wins the main pot only, middle stack wins the side pot', () => {
    const value = (st: TableState, seat: number): number => st.hand!.result!.shown.find((x) => x.seat === seat)!.rank.value;
    const seedNo = findSeed(t, steps, (st) => value(st, 0) > value(st, 1) && value(st, 1) > value(st, 2));
    const st = play(start(t, seedNo).state, steps).state;
    expect(st.hand!.result!.awards).toEqual([
      { potIndex: 0, amount: 150, seat: 0, rank: expect.anything() },
      { potIndex: 1, amount: 100, seat: 1, rank: expect.anything() },
    ]);
    expect(st.hand!.result!.net).toEqual({ 0: 100, 1: 0, 2: -100 });
    expect(stack(st, 0)).toBe(150);
    expect(stack(st, 1)).toBe(100);
    expect(stack(st, 2)).toBe(100);
    for (const e of st.hand!.result!.awards) expect(e.rank!.label).toBeTypeOf('string');
  });

  it('uncalled bet is returned to the bettor', () => {
    // Fold: raise to 20, big blind folds.
    const s = start(table({ 0: 100, 3: 100 })).state;
    const r = play(s, [[0, raise(20)], [3, fold]]);
    expect(types(r.events.slice(-3))).toEqual(['action', 'pots', 'hand-ended']);
    expect(r.state.hand!.result!.awards).toEqual([{ potIndex: 0, amount: 4, seat: 0 }]);
    expect(r.state.hand!.result!.net).toEqual({ 0: 2, 3: -2 });
    expect(r.state.hand!.result!.shown).toEqual([]);
    expect(r.events.some((e) => e.type === 'showdown')).toBe(false);
    expect(stack(r.state, 0)).toBe(102);
    expect(stack(r.state, 3)).toBe(98);
    expect(r.state.hand!.pots).toEqual([{ amount: 4, eligible: [0] }]);

    // All-in for less: the excess comes back as soon as the street closes.
    const t2 = table({ 0: 100, 1: 30 });
    const s2 = start(t2).state;
    const r2 = play(s2, [[0, raise(60)], [1, allIn]]);
    expect(r2.state.hand!.result).toBeDefined();
    const seat0 = r2.state.hand!.seats[0]!;
    expect(seat0.totalBet).toBe(30);
    expect(r2.state.hand!.pots).toEqual([{ amount: 60, eligible: [0, 1] }]);
    expect(Object.values(r2.state.hand!.result!.net).reduce((a, b) => a + b, 0)).toBe(0);
    expect(stack(r2.state, 0) + stack(r2.state, 1)).toBe(130);
  });

  it('split pot gives the odd chip to the first winner left of the button', () => {
    // Button raises to 5, SB folds (1 dead), BB calls: pot 11.
    const t3 = table({ 0: 100, 1: 100, 2: 100 });
    const steps3: [number, Action][] = [[0, raise(5)], [1, fold], [2, call], [2, check], [0, check], [2, check], [0, check], [2, check], [0, check]];
    const seedNo = findSeed(t3, steps3, (st) => {
      const shown = st.hand!.result!.shown;
      return shown.length === 2 && shown[0]!.rank.value === shown[1]!.rank.value;
    });
    const st = play(start(t3, seedNo).state, steps3).state;
    expect(st.hand!.pots).toEqual([{ amount: 11, eligible: [0, 2] }]);
    const awards = st.hand!.result!.awards;
    expect(awards.map((a) => [a.seat, a.amount])).toEqual([
      [2, 6],
      [0, 5],
    ]);
    expect(st.hand!.result!.net).toEqual({ 0: 0, 1: -1, 2: 1 });
  });

  it('dead money from a folded seat goes into the top pot', () => {
    const t4 = table({ 0: 100, 1: 100, 2: 10 });
    const s = play(start(t4).state, [[0, raise(30)], [1, call], [2, allIn]]).state;
    expect(s.hand!.street).toBe('flop');
    expect(s.hand!.pots).toEqual([
      { amount: 30, eligible: [0, 1, 2] },
      { amount: 40, eligible: [0, 1] },
    ]);
    const done = play(s, [[1, bet(20)], [0, fold]]).state;
    expect(done.hand!.result).toBeDefined();
    expect(done.hand!.pots).toEqual([
      { amount: 30, eligible: [1, 2] },
      { amount: 40, eligible: [1] },
    ]);
    expect(done.hand!.result!.net[0]).toBe(-30);
  });

  it('antes are posted before blinds and short stacks post what they can', () => {
    const t5 = table({ 0: 100, 1: 100, 2: 3 }, { ante: 2 });
    const { state: s, events } = start(t5);
    const blinds = events.filter((e) => e.type === 'blind-posted');
    expect(blinds).toEqual([
      { type: 'blind-posted', seat: 1, kind: 'ante', amount: 2 },
      { type: 'blind-posted', seat: 2, kind: 'ante', amount: 2 },
      { type: 'blind-posted', seat: 0, kind: 'ante', amount: 2 },
      { type: 'blind-posted', seat: 1, kind: 'small', amount: 1 },
      { type: 'blind-posted', seat: 2, kind: 'big', amount: 1 },
    ]);
    expect(s.hand!.seats[2]!.allIn).toBe(true);
    expect(s.hand!.currentBet).toBe(2);
    expect(s.hand!.seats[2]!.streetBet).toBe(1);
    expect(s.hand!.seats[2]!.totalBet).toBe(3);
    expect(legalActions(s, 0).call).toBe(2);
    expect(s.hand!.pots).toEqual([
      { amount: 6, eligible: [0, 1, 2] },
      { amount: 2, eligible: [1, 2] },
    ]);
  });
});

/* ---------------------------------------------------------------------------
 * Hand end variants
 * ------------------------------------------------------------------------ */

describe('hand end', () => {
  it('fold-to-one ends without showdown', () => {
    const s = start(table({ 0: 100, 1: 100, 2: 100 })).state;
    const r = play(s, [[0, fold], [1, fold]]);
    // The uncalled half of the big blind comes back first; the pot is the small blind plus the matched half.
    expect(r.state.hand!.result!.awards).toEqual([{ potIndex: 0, amount: 2, seat: 2 }]);
    expect(r.state.hand!.result!.net).toEqual({ 0: 0, 1: -1, 2: 1 });
    expect(r.state.hand!.result!.shown).toEqual([]);
    expect(types(r.events)).toEqual(['action', 'turn', 'action', 'pots', 'hand-ended']);
    expect(stack(r.state, 2)).toBe(101);
    expect(r.state.hand!.street).toBe('preflop');
    expect(r.state.hand!.toAct).toBeNull();
    expect(legalActions(r.state, 2).fold).toBe(false);
    expectCode(() => applyAction(r.state, 2, check), 'no-hand');
    expect(canStartHand(r.state)).toBe(true);
    const ended = r.events.at(-1) as Extract<EngineEvent, { type: 'hand-ended' }>;
    expect(ended.seedReveal).toBe(r.state.hand!.seedReveal);
  });

  it('heads-up all-in runs out the board in one call and shows both hands', () => {
    const s = start(table({ 0: 100, 3: 100 })).state;
    const r = play(s, [[0, allIn], [3, call]]);
    const last = r.events.slice(r.events.findIndex((e) => e.type === 'action' && e.record.seat === 3));
    expect(types(last)).toEqual(['action', 'pots', 'street', 'street', 'street', 'showdown', 'hand-ended']);
    const streets = last.filter((e) => e.type === 'street') as Extract<EngineEvent, { type: 'street' }>[];
    expect(streets.map((e) => e.street)).toEqual(['flop', 'turn', 'river']);
    expect(streets.map((e) => e.board.length)).toEqual([3, 4, 5]);
    expect(r.state.hand!.result!.shown.length).toBe(2);
    expect(r.state.hand!.seats.every((x) => x.shown)).toBe(true);
    expect(stack(r.state, 0) + stack(r.state, 3)).toBe(200);
    // Whoever busted is sitting out.
    for (const x of r.state.seats) if (x.stack === 0) expect(x.status).toBe('sitting-out');
  });

  it('all-in from the blinds runs out at startHand', () => {
    const t = table({ 0: 2, 1: 100 }, { ante: 1 });
    const { state: s, events } = start(t);
    expect(s.hand!.result).toBeDefined();
    expect(types(events).slice(-3)).toEqual(['street', 'showdown', 'hand-ended']);
    expect(events.filter((e) => e.type === 'turn')).toEqual([]);
    expect(s.hand!.seats[0]!.allIn).toBe(true);
    expect(stack(s, 0) + stack(s, 1)).toBe(102);
  });

  it('busted player rebuys with addChips and sitIn', () => {
    const t = table({ 0: 2, 1: 100 }, { ante: 1 });
    let s = start(t).state;
    const busted = s.seats.find((x) => x.stack === 0);
    if (!busted) return; // the short stack doubled up on this seed
    expect(busted.status).toBe('sitting-out');
    expect(canStartHand(s)).toBe(false);
    s = addChips(s, busted.seat, 50);
    s = sitIn(s, busted.seat);
    expect(canStartHand(s)).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * Joining, leaving, add chips, timeouts
 * ------------------------------------------------------------------------ */

describe('waitingForBigBlind', () => {
  it('a new player is dealt in when the big blind reaches their seat', () => {
    // Seats 0, 2, 4 play; 3 joins mid-hand. Hand 2: button 2, SB 4, BB 0 (3 waits).
    // Hand 3: button 4, SB 0, BB 2 (3 waits). Hand 4: button 0, SB 2, BB 3 -> dealt.
    let s = start(table({ 0: 100, 2: 100, 4: 100 })).state;
    s = sitDown(s, 3, 'late', 100);
    expect(s.seats.find((x) => x.seat === 3)!.waitingForBigBlind).toBe(true);
    s = play(s, [[0, fold], [2, fold]]).state;
    expect(s.hand!.result).toBeDefined();

    const h2 = start(s, 2).state;
    expect(h2.hand!.seats.map((x) => x.seat)).toEqual([0, 2, 4]);
    expect(h2.hand!.button).toBe(2);
    expect(h2.hand!.bigBlindSeat).toBe(0);
    expect(h2.seats.find((x) => x.seat === 3)!.waitingForBigBlind).toBe(true);
    s = play(h2, [[2, fold], [4, fold]]).state;

    const h3 = start(s, 3).state;
    expect(h3.hand!.seats.map((x) => x.seat)).toEqual([0, 2, 4]);
    expect(h3.hand!.button).toBe(4);
    expect(h3.hand!.bigBlindSeat).toBe(2);
    s = play(h3, [[4, fold], [0, fold]]).state;

    const h4 = start(s, 4).state;
    expect(h4.hand!.seats.map((x) => x.seat)).toEqual([0, 2, 3, 4]);
    expect(h4.hand!.button).toBe(0);
    expect(h4.hand!.smallBlindSeat).toBe(2);
    expect(h4.hand!.bigBlindSeat).toBe(3);
    expect(h4.seats.find((x) => x.seat === 3)!.waitingForBigBlind).toBe(false);
    expect(h4.hand!.toAct).toBe(4);
  });

  it('is waived when fewer than two other players would be dealt', () => {
    // Seat 0 has played (not waiting); seat 2 is new. Both are dealt immediately.
    let s = start(table({ 0: 100, 1: 100 })).state;
    s = play(s, [[0, fold]]).state;
    s = standUp(s, 1).state;
    s = sitDown(s, 2, 'new', 100);
    expect(s.seats.find((x) => x.seat === 0)!.waitingForBigBlind).toBe(false);
    expect(s.seats.find((x) => x.seat === 2)!.waitingForBigBlind).toBe(true);
    const h = start(s, 2).state;
    expect(h.hand!.seats.map((x) => x.seat)).toEqual([0, 2]);
    expect(h.seats.every((x) => !x.waitingForBigBlind)).toBe(true);
  });

  it('first hand: everyone is dealt and the button is the lowest seat', () => {
    const h = start(table({ 1: 100, 4: 100, 5: 100 })).state;
    expect(h.hand!.button).toBe(1);
    expect(h.hand!.seats.map((x) => x.seat)).toEqual([1, 4, 5]);
  });
});

describe('standUp during a hand', () => {
  it('folds a seat that is not to act and removes it at hand end', () => {
    const s = start(table({ 0: 100, 1: 100, 2: 100 })).state;
    expect(s.hand!.toAct).toBe(0);
    const r = frozen(s, () => standUp(s, 1));
    expect(r.cashOut).toBe(99);
    expect(r.state.hand!.seats[1]!.folded).toBe(true);
    expect(r.state.hand!.toAct).toBe(0);
    expect(r.state.seats.find((x) => x.seat === 1)!.leaving).toBe(true);
    expect(types(r.events)).toEqual(['action']);
    expect((r.events[0] as { record: { seat: number } }).record.seat).toBe(1);
    // The seat is still there until the hand ends; it cannot be reseated yet.
    expectCode(() => sitDown(r.state, 1, 'x', 100), 'seat-taken');
    const done = play(r.state, [[0, fold]]).state;
    expect(done.hand!.result!.awards).toEqual([{ potIndex: 0, amount: 2, seat: 2 }]);
    expect(stack(done, 2)).toBe(101);
    expect(done.seats.map((x) => x.seat)).toEqual([0, 2]);
    expect(done.button).toBe(2);
    const next = start(done, 2).state;
    expect(next.hand!.seats.map((x) => x.seat)).toEqual([0, 2]);
  });

  it('folds the seat to act and advances the turn', () => {
    const s = start(table({ 0: 100, 1: 100, 2: 100 })).state;
    const r = standUp(s, 0);
    expect(r.cashOut).toBe(100);
    expect(types(r.events)).toEqual(['action', 'turn']);
    expect(r.state.hand!.toAct).toBe(1);
    const done = play(r.state, [[1, call], [2, check]]).state;
    expect(done.hand!.street).toBe('flop');
    expect(done.hand!.seats.map((x) => x.seat)).toEqual([0, 1, 2]);
    expect(done.seats.map((x) => x.seat)).toEqual([0, 1, 2]);
  });

  it('ends the hand when the last opponent leaves', () => {
    const s = start(table({ 0: 100, 3: 100 })).state;
    const r = standUp(s, 3);
    expect(r.state.hand!.result).toBeDefined();
    expect(r.state.hand!.result!.awards).toEqual([{ potIndex: 0, amount: 3, seat: 0 }]);
    expect(r.state.seats.map((x) => x.seat)).toEqual([0]);
    expect(stack(r.state, 0)).toBe(102);
    expect(r.cashOut).toBe(98);
  });

  it('a seat that joined mid-hand leaves immediately', () => {
    let s = start(table({ 0: 100, 1: 100 })).state;
    s = sitDown(s, 4, 'late', 100);
    const r = standUp(s, 4);
    expect(r.cashOut).toBe(100);
    expect(r.state.seats.map((x) => x.seat)).toEqual([0, 1]);
    expect(r.state.hand!.toAct).toBe(0);
  });
});

describe('addChips during a hand', () => {
  it('is deferred to hand end and capped at maxBuyIn', () => {
    const s = start(table({ 0: 100, 1: 100 })).state;
    const a = frozen(s, () => addChips(s, 0, 50));
    expect(stack(a, 0)).toBe(99);
    expect(a.seats[0]!.pendingAddChips).toBe(50);
    expectCode(() => addChips(a, 0, 900), 'buy-in-range');
    const b = addChips(a, 0, 25);
    expect(b.seats[0]!.pendingAddChips).toBe(75);
    const done = play(b, [[0, fold]]).state;
    expect(stack(done, 0)).toBe(99 + 75);
    expect(done.seats[0]!.pendingAddChips).toBeUndefined();
    // A seat not in the running hand gets its chips right away.
    const late = sitDown(s, 4, 'late', 100);
    expect(stack(addChips(late, 4, 40), 4)).toBe(140);
  });
});

describe('timeoutAction', () => {
  it('checks when legal, otherwise folds, and counts consecutive timeouts', () => {
    const t = table({ 0: 100, 1: 100, 2: 100 });
    let s = play(start(t).state, [[0, call], [1, call]]).state;
    expect(s.hand!.toAct).toBe(2);
    let r = frozen(s, () => timeoutAction(s, 2));
    expect(r.events[0]).toEqual({ type: 'action', record: { seat: 2, street: 'preflop', action: { type: 'check' }, amount: 0, timedOut: true } });
    expect(r.state.seats[2]!.timeouts).toBe(1);
    expect(r.state.hand!.street).toBe('flop');
    s = r.state;
    expectCode(() => timeoutAction(s, 2), 'not-your-turn');
    // Seat 1 times out (check), seat 2 times out again (check): counter at 2.
    r = timeoutAction(s, 1);
    expect(r.state.seats[1]!.timeouts).toBe(1);
    r = timeoutAction(r.state, 2);
    expect(r.state.seats[2]!.timeouts).toBe(2);
    // Seat 0 bets; seat 1 times out facing a bet -> fold.
    r = applyAction(r.state, 0, bet(10));
    r = timeoutAction(r.state, 1);
    expect(r.events[0]).toMatchObject({ type: 'action', record: { seat: 1, action: { type: 'fold' }, timedOut: true } });
    expect(r.state.hand!.seats[1]!.folded).toBe(true);
    expect(r.state.seats[1]!.timeouts).toBe(2);
    // A normal action resets the counter.
    r = applyAction(r.state, 2, call);
    expect(r.state.seats[2]!.timeouts).toBe(0);
    expect(r.state.hand!.street).toBe('turn');
  });
});

/* ---------------------------------------------------------------------------
 * Views
 * ------------------------------------------------------------------------ */

describe('viewFor / redactEvent', () => {
  it('redacts the deck, the seed, and other players hole cards', () => {
    let s = start(table({ 0: 100, 1: 100, 2: 100 })).state;
    s = sitDown(s, 5, 'late', 100);
    const v0 = viewFor(s, 0);
    expect(JSON.stringify(v0)).not.toContain('deck');
    expect(JSON.stringify(v0)).not.toContain(s.hand!.seed as string);
    expect(v0.viewerSeat).toBe(0);
    expect(v0.legal).toEqual(legalActions(s, 0));
    expect(v0.seats[0]!.inHand!.holeCards).toEqual(s.hand!.seats[0]!.holeCards);
    expect(v0.seats[1]!.inHand!.holeCards).toBeUndefined();
    expect(v0.seats[3]!.inHand).toBeUndefined();
    expect(v0.hand!.seedCommit).toBe(s.hand!.seedCommit);
    expect(v0.hand!.seedReveal).toBeUndefined();
    const v1 = viewFor(s, 1);
    expect(v1.legal).toBeNull();
    expect(v1.seats[0]!.inHand!.holeCards).toBeUndefined();
    const spec = viewFor(s, null);
    expect(spec.legal).toBeNull();
    expect(spec.seats.every((x) => x.inHand?.holeCards === undefined)).toBe(true);
    expect(viewFor(createTable(), null).hand).toBeNull();

    // After showdown, shown cards are visible to everyone and the seed is revealed.
    const done = play(s, [[0, allIn], [1, call], [2, call]]).state;
    const after = viewFor(done, null);
    expect(after.hand!.result).toBeDefined();
    expect(after.hand!.seedReveal).toBe(done.hand!.seedReveal);
    for (const seat of [0, 1, 2]) expect(after.seats[seat]!.inHand!.holeCards).toEqual(done.hand!.seats[seat]!.holeCards);
  });

  it('redactEvent hides private events and other seats legal actions', () => {
    const hole: EngineEvent = { type: 'hole-cards', seat: 2, cards: ['As', 'Kd'], private: true };
    expect(redactEvent(hole, 2)).toBe(hole);
    expect(redactEvent(hole, 1)).toBeNull();
    expect(redactEvent(hole, null)).toBeNull();
    const turn: EngineEvent = { type: 'turn', seat: 2, legal: { fold: true, check: true, call: null, bet: null, raise: null, allIn: 10 } };
    expect(redactEvent(turn, 2)).toBe(turn);
    expect((redactEvent(turn, 1) as Extract<EngineEvent, { type: 'turn' }>).legal.fold).toBe(false);
  });
});
