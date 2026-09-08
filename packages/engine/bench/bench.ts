/**
 * Engine micro-benchmarks. Run with `pnpm --filter @pokernight/engine bench`.
 *
 * Reports:
 *   - µs per applyAction (6-handed random play, including hand start/end steps)
 *   - µs per showdown (three 7-card evaluations + winner selection)
 *   - hands per second for 6-handed random play
 *
 * Targets: < 1 ms per action, < 100 µs per showdown, > 10,000 hands/s.
 */
import type { Card, TableState } from '../src/index.js';
import { applyAction, createTable, evaluateHand, fullDeck, legalActions, seededShuffle, sitDown, startHand } from '../src/index.js';
import { handSeed, prng, randomAction } from '../test/random-play.js';

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function benchShowdown(): void {
  const decks: Card[][] = [];
  for (let i = 0; i < 2000; i++) decks.push(seededShuffle(fullDeck(), handSeed(i)));
  const run = (n: number): number => {
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const d = decks[i % decks.length] as Card[];
      const board = d.slice(0, 5);
      const a = evaluateHand(board.concat(d.slice(5, 7)));
      const b = evaluateHand(board.concat(d.slice(7, 9)));
      const c = evaluateHand(board.concat(d.slice(9, 11)));
      let best = a.value;
      let winners = 1;
      for (const v of [b.value, c.value]) {
        if (v > best) {
          best = v;
          winners = 1;
        } else if (v === best) winners++;
      }
      acc += winners;
    }
    const dt = performance.now() - t0;
    if (acc < 0) throw new Error('unreachable');
    return (dt * 1000) / n;
  };
  run(20_000); // warm up
  const us = run(200_000);
  console.log(`showdown (3 x 7-card eval + winners): ${fmt(us)} µs  ${us < 100 ? 'OK' : 'SLOW'} (target < 100 µs)`);
}

function makeTable(): TableState {
  let t = createTable({ seats: 6, smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 200 });
  for (let i = 0; i < 6; i++) t = sitDown(t, i, `p${i}`, 200);
  return t;
}

function benchPlay(): void {
  const rnd = prng(42);
  const run = (hands: number): { actionUs: number; handsPerSec: number } => {
    let table = makeTable();
    let actions = 0;
    let actionMs = 0;
    const t0 = performance.now();
    for (let h = 0; h < hands; h++) {
      // Keep the table healthy: top everyone back up when someone busts.
      if (table.seats.some((s) => s.stack === 0) || table.seats.length < 6) table = makeTable();
      let st = startHand(table, handSeed(h)).state;
      while (st.hand && st.hand.result === undefined) {
        const seat = st.hand.toAct as number;
        const action = randomAction(legalActions(st, seat), rnd);
        const a0 = performance.now();
        st = applyAction(st, seat, action).state;
        actionMs += performance.now() - a0;
        actions++;
      }
      table = st;
    }
    const total = performance.now() - t0;
    return { actionUs: (actionMs * 1000) / actions, handsPerSec: hands / (total / 1000) };
  };
  run(2000); // warm up
  const { actionUs, handsPerSec } = run(20_000);
  console.log(`applyAction: ${fmt(actionUs)} µs  ${actionUs < 1000 ? 'OK' : 'SLOW'} (target < 1 ms)`);
  console.log(`6-handed random play: ${fmt(handsPerSec, 0)} hands/s  ${handsPerSec > 10_000 ? 'OK' : 'SLOW'} (target > 10,000)`);
}

benchShowdown();
benchPlay();
