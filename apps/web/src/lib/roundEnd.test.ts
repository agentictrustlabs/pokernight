/**
 * The end of a round, as a moment rather than a number changing.
 *
 * Two properties are being held here. A WIN IS CELEBRATED AND A LOSS IS CREDITED — and the credit is
 * something that side actually did, never sympathy, because "bad luck" teaches nothing and "your three
 * canastas were worth a thousand of that" is a reason to play the next round. And A SPECTATOR HAS NO
 * SIDE: telling somebody who was not playing that they won is the app inventing a stake they never had.
 */
import { describe, expect, it } from 'vitest';
import { celebrates, creditFor, curtainFor, teamOfSeat, theirParts } from './roundEnd';
import type { RoundResult, TeamScore } from './scoreWords';

function score(over: Partial<TeamScore> = {}): TeamScore {
  return {
    melds: 300,
    canastas: 0,
    redThrees: 0,
    goingOut: 0,
    inHand: 0,
    total: 300,
    naturalCanastas: 0,
    mixedCanastas: 0,
    ...over,
  };
}

function result(us: Partial<TeamScore>, them: Partial<TeamScore>, totals: [number, number] = [1000, 800]): RoundResult {
  return {
    wentOut: 0,
    concealed: false,
    // Seat 0 is team 0, so `us` is team 0 throughout these fixtures.
    scores: { 0: score(us), 1: score(them) },
    totals: { 0: totals[0], 1: totals[1] },
  };
}

const nameOf = (s: number) => ['You', 'Sharkbot', 'Your partner', 'Pile Hawk'][s] ?? `Seat ${s + 1}`;

describe('which side you are on', () => {
  it('pairs the seats across the table, and gives a spectator no side at all', () => {
    expect(teamOfSeat(0)).toBe(0);
    expect(teamOfSeat(2)).toBe(0);
    expect(teamOfSeat(1)).toBe(1);
    expect(teamOfSeat(3)).toBe(1);
    expect(teamOfSeat(null)).toBeNull();
  });
});

describe('a round ending', () => {
  it('celebrates the round you actually won', () => {
    const c = curtainFor(result({ total: 700 }, { total: 300 }), 0, null, nameOf);
    expect(c?.scope).toBe('round');
    expect(c?.mood).toBe('won');
    expect(celebrates(c)).toBe(true);
    expect(c?.headline).toBe('Your round');
  });

  it('does not celebrate one you lost, and credits what you did instead', () => {
    const c = curtainFor(result({ total: 300, canastas: 500, naturalCanastas: 1 }, { total: 900 }), 0, null, nameOf);
    expect(c?.mood).toBe('lost');
    expect(celebrates(c)).toBe(false);
    expect(c?.credit).toContain('500');
  });

  it('never puts a consolation on a win — a winner does not need one', () => {
    const c = curtainFor(result({ total: 900, canastas: 500, naturalCanastas: 1 }, { total: 200 }), 0, null, nameOf);
    expect(c?.credit).toBeNull();
  });

  it('says where the game stands, because that is the reason to care about the next round', () => {
    expect(curtainFor(result({}, {}, [1400, 900]), 0, null, nameOf)?.detail).toContain('500 ahead');
    expect(curtainFor(result({}, {}, [900, 1400]), 0, null, nameOf)?.detail).toContain('500 behind');
    expect(curtainFor(result({}, {}, [900, 900]), 0, null, nameOf)?.detail).toContain('level');
  });

  it('reads the score off YOUR side, whichever side that is', () => {
    // Seat 1 is team 1, so the same result is a win for them and a loss for seat 0.
    const r = result({ total: 300 }, { total: 900 });
    expect(curtainFor(r, 0, null, nameOf)?.mood).toBe('lost');
    expect(curtainFor(r, 1, null, nameOf)?.mood).toBe('won');
  });

  it('carries the arithmetic, so somebody with the voice off is not told less', () => {
    const c = curtainFor(result({ total: 700 }, { total: 300 }), 0, null, nameOf);
    expect(c?.lines.length).toBeGreaterThan(2);
    expect(c?.lines.join(' ')).toContain('700');
  });
});

describe('a game ending', () => {
  it('is a bigger moment and says so, rather than reading as another round', () => {
    const c = curtainFor(result({ total: 700 }, { total: 300 }, [5100, 3000]), 0, 0, nameOf);
    expect(c?.scope).toBe('game');
    expect(c?.mood).toBe('won');
    expect(c?.headline).toContain('win the game');
  });

  it('is a loss when the other side reached it, however well your round went', () => {
    // Won the last round, lost the game. The mood follows the GAME, because that is what ended.
    const c = curtainFor(result({ total: 900, canastas: 300, mixedCanastas: 1 }, { total: 100 }, [4000, 5200]), 0, 1, nameOf);
    expect(c?.mood).toBe('lost');
    expect(c?.credit).not.toBeNull();
  });
});

describe('a spectator', () => {
  it('is never told they won, because they were not playing', () => {
    const c = curtainFor(result({ total: 700 }, { total: 300 }), null, null, nameOf);
    expect(c?.mood).toBe('watching');
    expect(celebrates(c)).toBe(false);
    expect(c?.credit).toBeNull();
    expect(c?.headline).not.toContain('Your');
  });

  it('is told who won a finished game, by side', () => {
    const c = curtainFor(result({}, {}, [5200, 3000]), null, 0, nameOf);
    expect(c?.detail).toContain('Side 1');
  });
});

describe('the credit named on a loss', () => {
  it('reaches for canastas first, because that is what the game is played for', () => {
    expect(creditFor(score({ canastas: 800, naturalCanastas: 1, mixedCanastas: 1, total: 1100 }))).toContain('2 canastas');
  });

  it('falls back through going out, red threes, and cards on the table', () => {
    expect(creditFor(score({ melds: 0, total: 100, goingOut: 100 }))).toContain('went out');
    expect(creditFor(score({ melds: 0, total: 200, redThrees: 200 }))).toContain('red threes');
    expect(creditFor(score({ melds: 240, total: 240 }))).toContain('240');
  });

  it('says nothing at all for a side that scored nothing, rather than something limp', () => {
    expect(creditFor(score({ melds: 0, total: 0 }))).toBeNull();
    // A side whose red threes went NEGATIVE because they never melded has nothing to be credited for.
    expect(creditFor(score({ melds: 0, total: -300, redThrees: -300 }))).toBeNull();
    expect(creditFor(undefined)).toBeNull();
  });
});

describe('nothing to show', () => {
  it('has no curtain while a round is still running', () => {
    expect(curtainFor(null, 0, null, nameOf)).toBeNull();
    expect(curtainFor(undefined, 0, null, nameOf)).toBeNull();
  });
});

describe('the other side’s scoresheet', () => {
  it('is read off the side that is not yours', () => {
    const r = result({ melds: 100, total: 100 }, { melds: 555, total: 555 });
    expect(theirParts(r, 0).join(' ')).toContain('555');
    expect(theirParts(r, 1).join(' ')).toContain('100');
    expect(theirParts(null, 0)).toEqual([]);
  });
});
