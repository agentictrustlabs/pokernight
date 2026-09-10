/**
 * A TABLE PLAYS MANY ROUNDS. It played exactly one.
 *
 * `state.round` holds the finished round after it ends, so its score can still be read. Four places
 * read that as "a round is in progress", and the consequences got worse the further you went:
 *
 *   - a fourth player could not sit down, so a three-handed table could never become four-handed
 *   - a table with four seats could not deal again, so no game to 5000 could ever be won by anybody
 *   - standing up SCORED THE FINISHED ROUND A SECOND TIME, adding its total to the scoreboard twice
 *
 * The last one is the reason this file exists as well as a fix: a wrong score is the one bug at a
 * card table nobody can see happening.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  canStartRound,
  createTable,
  roundRunning,
  sitDown,
  standUp,
  startRound,
  type CanastaState,
} from '../src/index.js';

const seed = (n: number) => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (n * 31 + i * 7) % 256;
  return b;
};

function seated(n = 4): CanastaState {
  let s = createTable();
  for (let i = 0; i < n; i++) s = sitDown(s, i, `p${i}`);
  return s;
}

/** Play a round to its end by drawing and throwing. */
function finish(state: CanastaState): CanastaState {
  let s = state;
  for (let i = 0; i < 4000; i++) {
    const r = s.round;
    if (!r || r.result) return s;
    const seat = r.toAct as number;
    if (r.phase === 'draw') {
      s = applyAction(s, seat, { type: 'draw' }).state;
      continue;
    }
    const card = (r.hands[seat] ?? []).find((c) => !(c[0] === '3' && (c[1] === 'H' || c[1] === 'D')));
    s = applyAction(s, seat, { type: 'discard', card: card as string }).state;
  }
  throw new Error('round did not finish');
}

describe('a finished round is not a running one', () => {
  it('says so', () => {
    let s = startRound(seated(), seed(1)).state;
    expect(roundRunning(s)).toBe(true);
    s = finish(s);
    expect(s.round, 'the finished round is kept, so its score can be read').not.toBeNull();
    expect(roundRunning(s)).toBe(false);
  });
});

describe('dealing again', () => {
  it('is allowed once the last round is scored — a game to 5000 needs many', () => {
    let s = finish(startRound(seated(), seed(1)).state);
    expect(canStartRound(s)).toBe(true);
    s = startRound(s, seed(2)).state;
    expect(s.roundNo).toBe(2);
    expect(roundRunning(s)).toBe(true);
    // …and the running total carries across rounds rather than restarting.
    expect(s.scores[0] + s.scores[1]).not.toBe(0);
  });

  it('keeps dealing, round after round, with the number climbing each time', () => {
    // The player driving this one never melds, so nobody gets near the target — which is the point:
    // what is under test is that the TABLE keeps dealing, not that anybody plays well.
    let s = seated();
    for (let i = 1; i <= 8; i++) {
      expect(canStartRound(s), `could not deal round ${i}`).toBe(true);
      s = finish(startRound(s, seed(i)).state);
      expect(s.roundNo).toBe(i);
      expect(s.round?.result, `round ${i} did not finish`).toBeDefined();
    }
  });

  it('stops dealing once somebody has passed the target', () => {
    // Put the game one round from over rather than playing a hundred: the property under test is
    // that a WON game stops, and the score that wins it is scoring's business, not this file's.
    // Well clear of the target, because this player MELDS NOTHING and is charged for every card
    // left in hand — from exactly 4900 a round can end below 5000 rather than above it.
    let s = seated();
    s = { ...s, scores: { 0: 9000, 1: 200 } };
    s = finish(startRound(s, seed(11)).state);
    expect(s.winner, 'nobody won from 9000 with a target of 5000').toBe(0);
    expect(canStartRound(s), 'a won game kept dealing').toBe(false);
  });
});

describe('taking the fourth seat', () => {
  it('is refused while a round is being played', () => {
    const three = startRound(seated(), seed(1)).state;
    expect(() => sitDown(three, 0, 'late')).toThrow(/taken/);
  });

  it('is ALLOWED between rounds, which is how a table fills up', () => {
    // The deadlock: three seats and a scored round. Sitting down was refused because a round was
    // "in progress", and the next deal needed a fourth seat. The table could never be joined again.
    let s = seated(3);
    // A three-handed table cannot deal at all, so put it in the state a real one gets into: four
    // seats, a round played, then one player leaves.
    s = finish(startRound(seated(), seed(3)).state);
    const scoreAfterRound = { ...s.scores };
    s = standUp(s, 3).state;
    expect(s.seats).toHaveLength(3);
    expect(canStartRound(s), 'three seats cannot deal a four-handed game').toBe(false);

    s = sitDown(s, 3, 'the fourth');
    expect(s.seats).toHaveLength(4);
    expect(canStartRound(s), 'the fourth seat did not unblock the deal').toBe(true);
    // …and standing up did not re-score the round that was already scored.
    expect(s.scores).toEqual(scoreAfterRound);
  });
});

describe('standing up', () => {
  it('ends a RUNNING round, because three cannot play a partnership game', () => {
    const running = startRound(seated(), seed(5)).state;
    const { state, events } = standUp(running, 1);
    expect(events.some((e) => e.type === 'round-ended')).toBe(true);
    expect(roundRunning(state)).toBe(false);
  });

  it('never scores a round that was already scored', () => {
    // The quiet one. Before this, leaving a table after a round added that round's score again.
    const done = finish(startRound(seated(), seed(7)).state);
    const before = { ...done.scores };
    const { state, events } = standUp(done, 2);
    expect(events.some((e) => e.type === 'round-ended'), 'the finished round was ended twice').toBe(false);
    expect(state.scores).toEqual(before);
  });
});
