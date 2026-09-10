/**
 * Four bots, two hundred rounds, and the engine as the judge.
 *
 * THE CORE PROPERTY IS THAT NOTHING THE STRATEGY RETURNS IS EVER REFUSED. `chooseCanastaAction` is
 * the last thing between a seat and the host's timeout default, so an illegal move does not read as
 * a weak bot — it reads as a seat that walked away. Every move below goes straight into
 * `applyAction` with no filtering and no retry: the only way this file passes is if every decision
 * was one the engine would have accepted from a person.
 *
 * Alongside that, the same card conservation the engine's own property test asserts — a hundred and
 * eight cards go into a round and a hundred and eight come out — because a strategy that hands the
 * engine a card the seat does not hold would show up here first.
 *
 * And one assertion that is about the strategy rather than the rules: across two hundred rounds the
 * bots must reach canastas and actually GO OUT. A player that only ever draws and discards is legal
 * for all of the above and is not a player.
 */

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createTable,
  hasCanasta,
  isRedThree,
  legalFor,
  sitDown,
  startRound,
  viewFor,
  type CanastaAction,
  type CanastaState,
  type Card,
  type RoundState,
} from '@pokernight/canasta';
import { chooseCanastaAction } from '../src/index.js';

const ROUNDS = 200;
const MOVE_CAP = 4000;

const round = (s: CanastaState): RoundState => s.round as RoundState;

function seedOf(n: number): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (n * 97 + i * 41) % 256;
  return b;
}

function seated(): CanastaState {
  let s = createTable();
  for (let i = 0; i < 4; i++) s = sitDown(s, i, `bot${i}`);
  return s;
}

/** Every card in play, wherever it has got to. Copied from the engine's own property test. */
function allCards(r: RoundState): Card[] {
  return [
    ...Object.values(r.hands).flat(),
    ...r.stock,
    ...r.discard,
    ...r.melds[0].flatMap((m) => m.cards),
    ...r.melds[1].flatMap((m) => m.cards),
    ...r.redThrees[0],
    ...r.redThrees[1],
  ];
}

interface Played {
  state: CanastaState;
  moves: { seat: number; action: CanastaAction }[];
  /** True at any point during the round, not only at the end. */
  sawCanasta: boolean;
}

/** Play one seeded round to its end with four bots, checking the table after every single move. */
function playRound(n: number): Played {
  let state = startRound(seated(), seedOf(n)).state;
  const moves: { seat: number; action: CanastaAction }[] = [];
  let sawCanasta = false;

  expect(allCards(round(state)), `round ${n} deal`).toHaveLength(108);

  for (let move = 0; move < MOVE_CAP; move++) {
    const r = round(state);
    if (r.result) return { state, moves, sawCanasta };
    const seat = r.toAct as number;

    const decision = chooseCanastaAction(viewFor(state, seat), legalFor(state, seat), seat);
    // No try/catch and no fallback: a refusal here IS the failure this file exists to catch.
    state = applyAction(state, seat, decision.action).state;
    moves.push({ seat, action: decision.action });

    const after = round(state);
    expect(allCards(after), `round ${n} move ${move} (${decision.action.type}): cards in play`).toHaveLength(108);
    for (const [seatNo, hand] of Object.entries(after.hands)) {
      expect(hand.filter(isRedThree), `round ${n} move ${move}: red three left in seat ${seatNo}`).toHaveLength(0);
    }
    if (hasCanasta(after.melds[0]) || hasCanasta(after.melds[1])) sawCanasta = true;
  }
  throw new Error(`round ${n} did not finish in ${MOVE_CAP} moves`);
}

describe('four bots at a real table', () => {
  const played = Array.from({ length: ROUNDS }, (_, i) => playRound(i + 1));

  it('never offers the engine a move it refuses, over 200 rounds', () => {
    // Every move in `played` was applied without a throw; this asserts the rounds were real ones and
    // not a handful of moves each.
    const total = played.reduce((n, p) => n + p.moves.length, 0);
    expect(total).toBeGreaterThan(ROUNDS * 20);
    for (const p of played) expect(p.moves.length).toBeGreaterThan(0);
  });

  it('ends every round, and scores it', () => {
    for (const [i, p] of played.entries()) {
      const result = round(p.state).result;
      expect(result, `round ${i + 1} did not finish`).toBeDefined();
      if (!result) continue;
      expect(p.state.scores).toEqual(result.totals);
      for (const team of [0, 1] as const) {
        const s = result.scores[team];
        expect(s.total).toBe(s.melds + s.canastas + s.redThrees + s.goingOut + s.inHand);
      }
      // A seat that went out is a seat holding nothing.
      if (result.wentOut !== null) expect(round(p.state).hands[result.wentOut]).toHaveLength(0);
    }
  });

  it('conserves all 108 cards at every step', () => {
    // Asserted inside `playRound` after each move; this holds the end state as well.
    for (const [i, p] of played.entries()) {
      expect(allCards(round(p.state)), `round ${i + 1} end`).toHaveLength(108);
    }
  });

  it('builds canastas and goes out — it is playing, not merely surviving', () => {
    const canastas = played.filter((p) => p.sawCanasta).length;
    const wentOut = played.filter((p) => round(p.state).result?.wentOut !== null).length;
    expect(canastas, 'no round ever produced a canasta').toBeGreaterThan(ROUNDS * 0.5);
    expect(wentOut, 'no round ever ended with a seat going out').toBeGreaterThan(ROUNDS * 0.25);
  });

  it('is deterministic: the same seed replays the same round, move for move', () => {
    for (const n of [1, 7, 42, 199]) {
      const a = playRound(n);
      const b = playRound(n);
      expect(JSON.stringify(b.moves)).toBe(JSON.stringify(a.moves));
      expect(JSON.stringify(round(b.state).result)).toBe(JSON.stringify(round(a.state).result));
    }
  });
});
