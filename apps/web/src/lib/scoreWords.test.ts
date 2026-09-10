/**
 * The numbers at the top, explained.
 *
 * "I would also like it to talk to the points that go into the numbers up top." A scoreboard that
 * says 1135 to 435 teaches nothing on its own — the six parts it is made of are the thing a
 * beginner is missing, and two of them are SUBTRACTIONS, which is exactly the bit people get wrong.
 */
import { describe, expect, it } from 'vitest';
import { roundOpening, scoreLines, scoreParts, scoreSummary, type RoundResult, type TeamScore } from './scoreWords';

const team = (over: Partial<TeamScore> = {}): TeamScore => ({
  melds: 0,
  canastas: 0,
  redThrees: 0,
  goingOut: 0,
  inHand: 0,
  total: 0,
  naturalCanastas: 0,
  mixedCanastas: 0,
  ...over,
});

const result = (us: TeamScore, them: TeamScore): RoundResult => ({
  wentOut: 0,
  concealed: false,
  scores: { 0: us, 1: them },
  totals: { 0: us.total, 1: them.total },
});

describe('the parts of a round', () => {
  it('names each one in the words the rule is in', () => {
    const parts = scoreParts(team({ melds: 425, canastas: 500, naturalCanastas: 1, redThrees: 200, goingOut: 100, inHand: -90, total: 1135 }));
    expect(parts).toEqual([
      '425 for the cards on the table',
      '500 for 1 natural canasta',
      '200 for red threes',
      '100 for going out',
      '90 taken off for the cards still in hand',
    ]);
  });

  it('leaves out what did not happen, so the numbers that moved are not buried', () => {
    // "nothing for canastas, nothing for red threes, nothing for going out" hides the two that count.
    expect(scoreParts(team({ melds: 60, inHand: -30, total: 30 }))).toEqual([
      '60 for the cards on the table',
      '30 taken off for the cards still in hand',
    ]);
    expect(scoreParts(team())).toEqual([]);
  });

  it('says a SUBTRACTION is one, because that is the half people get wrong', () => {
    expect(scoreParts(team({ inHand: -140 }))[0]).toMatch(/taken off/);
  });

  it('calls out red threes going NEGATIVE, which is the rule nobody expects', () => {
    // A side that never melded is CHARGED for its red threes rather than paid for them.
    const parts = scoreParts(team({ redThrees: -200, inHand: -50 }));
    expect(parts[0]).toMatch(/200 LOST on red threes/);
    expect(parts[0]).toMatch(/never melded/);
  });

  it('counts natural and mixed canastas separately, because they are worth different things', () => {
    const parts = scoreParts(team({ canastas: 800, naturalCanastas: 1, mixedCanastas: 1 }));
    expect(parts[0]).toBe('800 for 1 natural canasta and 1 mixed canasta');
  });
});

describe('reading the round out', () => {
  const r = result(
    team({ melds: 425, canastas: 500, naturalCanastas: 1, redThrees: 200, goingOut: 100, inHand: -90, total: 1135 }),
    team({ melds: 145, canastas: 300, mixedCanastas: 1, redThrees: 200, inHand: -210, total: 435 }),
  );

  it('says WHO ENDED IT first, then what happened, then why, then where that leaves you', () => {
    // Seat 2 went out; the viewer is in seat 0, so it was not them.
    const lines = scoreLines({ ...r, wentOut: 2 }, 0, (s) => `Seat ${s + 1}`, 0);
    expect(lines).toHaveLength(4);
    // The thing that just happened, before the arithmetic about it.
    expect(lines[0]).toBe('Seat 3 went out.');
    expect(lines[1]).toBe('Your side scored 1135 this round. They scored 435.');
    expect(lines[2]).toMatch(/^That is 425 for the cards on the table/);
    expect(lines[3]).toBe('You are on 1135, they are on 435.');
  });

  it('tells YOU going out from your PARTNER doing it — a seat is not a team', () => {
    // Comparing the seat that went out to a team number said "you" whenever the two happened to be
    // the same digit, which for seat 0 on team 0 is always.
    expect(scoreLines(r, 0, undefined, 0)[0]).toBe('You went out.');
    expect(scoreLines({ ...r, wentOut: 2 }, 0, undefined, 0)[0]).toBe('Your partner went out.');
    expect(scoreLines({ ...r, wentOut: 1 }, 0, undefined, 0)[0]).toBe('They went out.');
  });

  it('says the stock ran out when nobody went out', () => {
    const dry = { ...r, wentOut: null };
    expect(scoreLines(dry, 0)[0]).toMatch(/stock ran out/);
  });

  it('reads it from the OTHER side when that is where you are sitting', () => {
    const lines = scoreLines(r, 1, (s) => `Seat ${s + 1}`);
    expect(lines[1]).toBe('Your side scored 435 this round. They scored 1135.');
    expect(lines[3]).toBe('You are on 435, they are on 1135.');
  });

  it('gives a spectator no side, rather than telling them one is theirs', () => {
    const lines = scoreLines(r, null);
    expect(lines[1]).toMatch(/^The first side scored/);
    expect(lines[3]).toMatch(/^The running total is/);
  });

  it('skips the "that is" line when a side scored nothing at all', () => {
    const nil = result(team(), team({ melds: 60, total: 60 }));
    expect(scoreLines(nil, 0)).toHaveLength(3);
  });
});

describe('the same thing to read', () => {
  it('is one sentence under the scoresheet', () => {
    const r = result(team({ melds: 200, goingOut: 100, inHand: -40, total: 260 }), team({ total: 0 }));
    expect(scoreSummary(r, 0)).toBe(
      "Your side's 260 is 200 for the cards on the table, 100 for going out, 40 taken off for the cards still in hand.",
    );
  });

  it('says so plainly when a side scored nothing', () => {
    expect(scoreSummary(result(team(), team()), 0)).toBe('Your side scored nothing this round.');
  });
});

/**
 * The line that opens a round.
 *
 * A round starting is the moment a person most needs the score: the target has not moved, but how
 * far off it they are is the whole reason to care about the next twenty minutes. The scoreboard is
 * on screen and says nothing about itself.
 */
describe('opening a round', () => {
  it('says what the first one is playing for', () => {
    expect(roundOpening(1, { 0: 0, 1: 0 }, 0, 5000)).toBe('Round one. First to 5000.');
  });

  it('says where the game stands from where you are sitting', () => {
    expect(roundOpening(2, { 0: 780, 1: 610 }, 0, 5000)).toBe('Round 2. You are ahead, 780 to 610.');
    expect(roundOpening(2, { 0: 780, 1: 610 }, 1, 5000)).toBe('Round 2. You are behind, 610 to 780.');
  });

  it('says level when it is level, rather than picking a winner', () => {
    expect(roundOpening(3, { 0: 400, 1: 400 }, 0, 5000)).toMatch(/Level, 400 each/);
  });

  it('gives a spectator the two numbers and no side', () => {
    expect(roundOpening(2, { 0: 780, 1: 610 }, null, 5000)).toBe('Round 2. 780 against 610.');
  });
});
