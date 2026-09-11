/**
 * A finished hand, as counts — read from a REAL engine hand, so that "facing a bet" and "the preflop
 * raiser's first chance on the flop" are the engine's facts and not this test's idea of them.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createTable, sitDown, startHand, viewFor, type Action, type TableState } from '@pokernight/engine';
import { observeRound } from '../src/observe.js';

const seed = new Uint8Array(32).fill(7);

/** Three seats, 100 big blinds each, one hand dealt. */
function dealt(): TableState {
  let s = createTable({ seats: 3, smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 400 });
  s = sitDown(s, 0, 'me', 200);
  s = sitDown(s, 1, 'agent:sharkbot.svc', 200);
  s = sitDown(s, 2, 'agent:rock.svc', 200);
  return startHand(s, seed).state;
}

/** Play the seat to act, in order, until the hand ends or the script runs out. */
function play(state: TableState, script: Action[]): TableState {
  let s = state;
  for (const a of script) {
    const seat = s.hand?.toAct;
    if (seat === null || seat === undefined) break;
    s = applyAction(s, seat, a).state;
  }
  return s;
}

describe('observeRound', () => {
  it('is nothing until the hand has a result', () => {
    const s = dealt();
    expect(observeRound(viewFor(s, 0), 0)).toBeNull();
  });

  it('counts what each seat did, from one seat\'s own view, keyed by player id', () => {
    let s = dealt();
    const order = [s.hand!.toAct!];
    // First to act raises to 6; next calls; last folds. Then the flop is checked around, the raiser
    // bets, the caller folds — the hand ends with no showdown.
    s = play(s, [{ type: 'raise', amount: 6 }, { type: 'call' }, { type: 'fold' }]);
    expect(s.hand?.street).toBe('flop');
    const raiser = order[0]!;
    // On the flop the first to act is whoever is left of the button; script by what is asked.
    while (s.hand && !s.hand.result) {
      const seat = s.hand.toAct!;
      const first = !s.hand.actions.some((a) => a.street === 'flop');
      if (seat === raiser) s = applyAction(s, seat, first ? { type: 'bet', amount: 8 } : { type: 'bet', amount: 8 }).state;
      else s = applyAction(s, seat, first ? { type: 'check' } : { type: 'fold' }).state;
    }
    const view = viewFor(s, 0);
    const obs = observeRound(view, 0)!;
    expect(obs.game).toBe('poker');
    expect(obs.round).toBe(1);
    const ids = Object.keys(obs.subjects).sort();
    expect(ids).toEqual(['agent:rock.svc', 'agent:sharkbot.svc', 'me']);
    const me = obs.subjects.me!;
    expect(me.you).toBe(true);
    for (const id of ids) if (id !== 'me') expect(obs.subjects[id]!.you).toBeUndefined();

    const bySeat = (seat: number) => obs.subjects[view.seats.find((x) => x.seat === seat)!.playerId]!.counters;
    const r = bySeat(raiser);
    expect(r.hands).toBe(1);
    expect(r.vpip).toBe(1);
    expect(r.pfr).toBe(1);
    expect(r.sawFlop).toBe(1);
    expect(r.cbetOpps).toBe(1);
    expect(r.cbet).toBe(1);
    expect(r.won).toBe(1);
    expect(r.showdowns).toBe(0);
    expect(r.netChips).toBeGreaterThan(0);
    // The one who folded before the flop: in, but never voluntarily.
    const folded = s.hand!.actions.find((a) => a.street === 'preflop' && a.action.type === 'fold')!.seat;
    const f = bySeat(folded);
    expect(f.sawFlop).toBe(0);
    expect(f.foldToBetOpps).toBe(1);
    expect(f.foldToBet).toBe(1);
    expect(f.vpip).toBe(0);
    // The caller: paid the raise (voluntary, passive), saw the flop, folded to the bet there.
    const caller = s.hand!.actions.find((a) => a.street === 'preflop' && a.action.type === 'call')!.seat;
    const c = bySeat(caller);
    expect(c.vpip).toBe(1);
    expect(c.pfr).toBe(0);
    expect(c.passive).toBe(1);
    expect(c.sawFlop).toBe(1);
    expect(c.foldToBetOpps).toBe(2);
    expect(c.foldToBet).toBe(1);
    expect(c.netChips).toBeLessThan(0);
    // Sums to zero, as the engine's net does.
    expect(ids.reduce((a, id) => a + obs.subjects[id]!.counters.netChips, 0)).toBe(0);
  });

  it('counts a three-bet as facing a raise and raising again, and a showdown as shown', () => {
    let s = dealt();
    s = play(s, [{ type: 'raise', amount: 6 }, { type: 'raise', amount: 18 }, { type: 'fold' }, { type: 'call' }]);
    const threeBettor = s.hand!.actions[1]!.seat;
    const opener = s.hand!.actions[0]!.seat;
    // Check it down to showdown.
    while (s.hand && !s.hand.result) s = applyAction(s, s.hand.toAct!, { type: 'check' }).state;
    const view = viewFor(s, 0);
    const obs = observeRound(view, 0)!;
    const bySeat = (seat: number) => obs.subjects[view.seats.find((x) => x.seat === seat)!.playerId]!.counters;
    expect(bySeat(threeBettor).threeBetOpps).toBe(1);
    expect(bySeat(threeBettor).threeBet).toBe(1);
    expect(bySeat(threeBettor).pfr).toBe(1);
    expect(bySeat(opener).threeBet).toBe(0);
    expect(bySeat(opener).foldToBetOpps).toBe(1); // faced the three-bet and called
    expect(bySeat(opener).foldToBet).toBe(0);
    const shown = view.hand!.result!.shown.map((x) => x.seat);
    expect(shown.length).toBeGreaterThanOrEqual(1);
    for (const seat of shown) expect(bySeat(seat).showdowns).toBe(1);
    const winners = shown.filter((seat) => (view.hand!.result!.net[seat] ?? 0) > 0);
    for (const seat of winners) expect(bySeat(seat).showdownWins).toBe(1);
    // Nobody's cards are in the observation — counts only.
    expect(JSON.stringify(obs)).not.toMatch(/"holeCards"|"board"|[2-9TJQKA][shdc]"/);
  });
});

describe('facingWhat — what the price is for', () => {
  it('names the blind when nobody has raised, and the raise when somebody has', async () => {
    const { facingWhat } = await import('../src/explain.js');
    const s0 = dealt();
    const first = s0.hand!.toAct!;
    const l0 = (await import('@pokernight/engine')).legalActions(s0, first);
    expect(facingWhat(viewFor(s0, first), first, l0.call ?? 0)).toMatch(/big blind.*nobody has bet or raised/);
    const s1 = applyAction(s0, first, { type: 'raise', amount: 6 }).state;
    const next = s1.hand!.toAct!;
    const l1 = (await import('@pokernight/engine')).legalActions(s1, next);
    expect(facingWhat(viewFor(s1, next), next, l1.call ?? 0)).toBe(`a raise to 6 by seat ${first + 1}`);
  });
});
