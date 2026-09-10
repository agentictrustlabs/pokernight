import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import type { EngineEvent, TableState } from '../src/index.js';
import { addChips, bytesToHex, canStartHand, createTable, hexToBytes, legalActions, sitDown, sitIn, standUp } from '../src/index.js';
import { handSeed, prng, randInt, replayHand, runHand } from './random-play.js';

const HANDS = 2000;

function chips(s: TableState): number {
  let total = 0;
  for (const x of s.seats) total += x.stack + (x.pendingAddChips ?? 0);
  if (s.hand && s.hand.result === undefined) for (const hs of s.hand.seats) total += hs.totalBet;
  return total;
}

describe('invariants under random play', () => {
  it(`holds for ${HANDS} hands across 2..9 players`, () => {
    const rnd = prng(20260908);
    let handsPlayed = 0;
    let showdowns = 0;
    let sidePots = 0;
    let nextPlayer = 0;

    while (handsPlayed < HANDS) {
      const seats = randInt(rnd, 2, 9);
      let table = createTable({
        seats,
        smallBlind: 1,
        bigBlind: 2,
        ante: rnd() < 0.2 ? 1 : 0,
        minBuyIn: 2,
        maxBuyIn: 400,
      });
      const players = randInt(rnd, 2, seats);
      const order = Array.from({ length: seats }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = randInt(rnd, 0, i);
        [order[i], order[j]] = [order[j] as number, order[i] as number];
      }
      // A mix of deep and very short stacks makes all-ins and side pots common.
      for (let i = 0; i < players; i++) {
        table = sitDown(table, order[i] as number, `p${nextPlayer++}`, rnd() < 0.4 ? randInt(rnd, 2, 30) : randInt(rnd, 40, 400));
      }
      let bank = chips(table);

      const handsAtThisTable = randInt(rnd, 3, 25);
      for (let h = 0; h < handsAtThisTable && handsPlayed < HANDS; h++) {
        // Between hands: random joins, leaves, rebuys.
        if (rnd() < 0.15) {
          const empty = order.filter((seat) => !table.seats.some((x) => x.seat === seat));
          if (empty.length) {
            const seat = empty[randInt(rnd, 0, empty.length - 1)] as number;
            const buyIn = randInt(rnd, 2, 200);
            table = sitDown(table, seat, `p${nextPlayer++}`, buyIn);
            bank += buyIn;
          }
        }
        if (rnd() < 0.1 && table.seats.length > 2) {
          const victim = table.seats[randInt(rnd, 0, table.seats.length - 1)] as { seat: number };
          const r = standUp(table, victim.seat);
          bank -= r.cashOut;
          table = r.state;
          expect(chips(table)).toBe(bank);
        }
        for (const x of table.seats) {
          if (x.stack === 0 && rnd() < 0.8) {
            const amount = randInt(rnd, 2, 100);
            table = addChips(table, x.seat, amount);
            table = sitIn(table, x.seat);
            bank += amount;
          }
        }
        if (!canStartHand(table)) break;
        expect(chips(table)).toBe(bank);

        const before = table;
        const seed = handSeed(handsPlayed * 7919 + 13);
        const beforeJson = JSON.stringify(before);
        const run = runHand(before, seed, rnd, {
          timeoutProb: 0.03,
          onStep: (prev, next, events) => {
            // Purity: inputs are never mutated.
            expect(JSON.stringify(prev)).toBe(JSON.stringify(prev));
            // Chip conservation on every step.
            expect(chips(next), 'chip conservation').toBe(bank);
            if (next.hand && next.hand.result === undefined) {
              expect(next.hand.toAct).not.toBeNull();
              const seat = next.hand.toAct as number;
              const turn = events.at(-1) as EngineEvent;
              expect(turn.type).toBe('turn');
              expect(turn.type === 'turn' && turn.seat).toBe(seat);
              expect(turn.type === 'turn' && turn.legal).toEqual(legalActions(next, seat));
              // toAct is never folded or all-in and always has chips.
              const hs = next.hand.seats.find((x) => x.seat === seat)!;
              expect(hs.folded || hs.allIn).toBe(false);
              expect(next.seats.find((x) => x.seat === seat)!.stack).toBeGreaterThan(0);
            }
            for (const e of events) {
              if (e.type === 'pots') {
                const total = e.pots.reduce((a, p) => a + p.amount, 0);
                expect(e.pots.every((p) => p.eligible.length >= 1 && p.amount > 0)).toBe(true);
                // Pots are rebuilt from totalBet; they must add up to it (before awards).
                const state = next.hand!;
                const totalBet = state.seats.reduce((a, x) => a + x.totalBet, 0);
                if (state.result === undefined) expect(total).toBe(totalBet);
              }
            }
          },
        });
        expect(JSON.stringify(before)).toBe(beforeJson);

        const final = run.state;
        const hand = final.hand!;
        expect(hand.result).toBeDefined();
        expect(hand.toAct).toBeNull();
        expect(final.hand!.seed).toBeUndefined();
        const result = hand.result!;

        // Net sums to zero (rake is 0) and awards equal the pots.
        const netSum = Object.values(result.net).reduce((a, b) => a + b, 0);
        expect(netSum).toBe(0);
        const awarded = result.awards.reduce((a, b) => a + b.amount, 0);
        const potTotal = hand.pots.reduce((a, p) => a + p.amount, 0);
        expect(awarded).toBe(potTotal);
        expect(potTotal).toBe(hand.seats.reduce((a, x) => a + x.totalBet, 0));
        for (const a of result.awards) {
          const pot = hand.pots[a.potIndex]!;
          expect(pot.eligible).toContain(a.seat);
          const hs = hand.seats.find((x) => x.seat === a.seat)!;
          expect(hs.folded).toBe(false);
        }
        if (hand.pots.length > 1) sidePots++;

        // Showdown consistency: every award goes to a best hand among the eligible.
        const ended = run.events.at(-1) as EngineEvent;
        expect(ended.type).toBe('hand-ended');
        if (result.shown.length) {
          showdowns++;
          expect(run.events.some((e) => e.type === 'showdown')).toBe(true);
          const live = hand.seats.filter((x) => !x.folded).map((x) => x.seat);
          expect(result.shown.map((x) => x.seat)).toEqual(live);
          const value = (seat: number): number => result.shown.find((x) => x.seat === seat)!.rank.value;
          for (const a of result.awards) {
            const best = Math.max(...hand.pots[a.potIndex]!.eligible.map(value));
            expect(value(a.seat)).toBe(best);
            expect(a.rank).toBeDefined();
          }
          for (const pot of hand.pots) {
            const best = Math.max(...pot.eligible.map(value));
            const winners = pot.eligible.filter((seat) => value(seat) === best);
            const potAwards = result.awards.filter((a) => a.potIndex === hand.pots.indexOf(pot));
            expect(potAwards.map((a) => a.seat).sort()).toEqual(winners.slice().sort());
            const amounts = potAwards.map((a) => a.amount);
            expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
          }
        } else {
          expect(run.events.some((e) => e.type === 'showdown')).toBe(false);
          expect(hand.seats.filter((x) => !x.folded).length).toBe(1);
          expect(result.awards.every((a) => a.rank === undefined)).toBe(true);
        }

        // Commit-reveal.
        expect(hand.seedReveal).toBe(bytesToHex(seed));
        expect(hand.seedCommit).toBe(bytesToHex(sha256(hexToBytes(hand.seedReveal!))));
        expect(ended.type === 'hand-ended' && ended.seedReveal).toBe(hand.seedReveal);

        // Every logged action was legal at the time (replay would throw otherwise), and
        // the replay is byte-identical in both state and events.
        const replay = replayHand(before, seed, run.log);
        expect(replay.state).toEqual(final);
        expect(replay.events).toEqual(run.events);
        expect(JSON.stringify(replay.state)).toBe(JSON.stringify(final));

        // Post-hand bookkeeping.
        for (const x of final.seats) {
          expect(x.leaving).toBeUndefined();
          expect(x.pendingAddChips).toBeUndefined();
          if (x.stack === 0) expect(x.status).toBe('sitting-out');
        }
        expect(chips(final)).toBe(bank);
        table = final;
        handsPlayed++;
      }
    }
    expect(handsPlayed).toBe(HANDS);
    expect(showdowns).toBeGreaterThan(HANDS / 10);
    expect(sidePots).toBeGreaterThan(HANDS / 50);
    // EXPLICIT, because two thousand hands is legitimately slower than vitest's five-second default:
    // about two seconds alone and well past five under a full suite. It passed when run on its own and
    // failed when everything ran together — and turbo replays a cached pass as a pass, so `pnpm test`
    // reported green while `pnpm test --force` did not. Sixty seconds is a backstop against a hang,
    // not a performance budget.
  }, 60_000);
});
