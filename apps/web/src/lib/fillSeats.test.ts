/**
 * Who ends up on your side when the house fills the table.
 *
 * Canasta's partnerships are fixed by seat — 0 and 2 against 1 and 3 — so filling "the empty chairs
 * in order" decides who you play with by accident. These are the cases where it matters.
 */
import { describe, expect, it } from 'vitest';
import { fillOutcome, opponentsOf, partnerOf, seatsToFill } from './fillSeats';

describe('the partnerships', () => {
  it('puts the seat across from you on your side', () => {
    expect(partnerOf(0)).toBe(2);
    expect(partnerOf(1)).toBe(3);
    expect(partnerOf(3)).toBe(1);
    expect(opponentsOf(0).sort()).toEqual([1, 3]);
    expect(opponentsOf(1).sort()).toEqual([0, 2]);
  });
});

describe('filling every chair', () => {
  it('takes them all, so the round deals', () => {
    expect(seatsToFill([1, 2, 3], 0, { kind: 'all' })).toEqual([1, 2, 3]);
  });

  it('says what the table will look like before anybody presses it', () => {
    expect(fillOutcome([1, 2, 3], 0, { kind: 'all' }, 3)).toBe('Seats 3 house players — one across from you and two against you. The round deals.');
  });
});

describe('keeping a chair for somebody', () => {
  it('ON YOUR SIDE keeps the seat across from you, and fills the two against you', () => {
    // The two of you against the house — which is the arrangement most people asking for a friend
    // actually mean, and the one "fill the empty seats in order" gets right only by luck.
    expect(seatsToFill([1, 2, 3], 0, { kind: 'keep-partner' })).toEqual([1, 3]);
    expect(seatsToFill([0, 2, 3], 1, { kind: 'keep-partner' })).toEqual([0, 2]);
  });

  it('AGAINST YOU keeps a seat beside you, and fills your partner’s chair', () => {
    expect(seatsToFill([1, 2, 3], 0, { kind: 'keep-opponent' })).toEqual([2, 3]);
  });

  it('says whose chair is being kept, in those words', () => {
    expect(fillOutcome([1, 2, 3], 0, { kind: 'keep-partner' }, 3)).toContain('across from you, on your side');
    expect(fillOutcome([1, 2, 3], 0, { kind: 'keep-opponent' }, 3)).toContain('beside you, against you');
    expect(fillOutcome([1, 2, 3], 0, { kind: 'keep-partner' }, 3)).toContain('The round deals when somebody takes it');
  });
});

describe('when somebody is already sitting in the chair that would be kept', () => {
  it('has nothing to keep, and just fills what is empty', () => {
    // Two people already seated opposite each other: the partner chair is taken, so "keep my
    // partner's seat" cannot mean anything and must not mean "fill nothing".
    expect(seatsToFill([1, 3], 0, { kind: 'keep-partner' })).toEqual([1, 3]);
  });

  it('keeps the other opponent seat when one of them is taken', () => {
    expect(seatsToFill([2, 3], 0, { kind: 'keep-opponent' })).toEqual([2]);
  });
});

describe('somebody who has not sat down yet', () => {
  it('has no side, so every plan fills what is empty', () => {
    // There is no "across from you" until you are somewhere.
    for (const plan of [{ kind: 'all' }, { kind: 'keep-partner' }, { kind: 'keep-opponent' }] as const) {
      expect(seatsToFill([0, 1, 2, 3], null, plan)).toEqual([0, 1, 2, 3]);
    }
    // And it does not speak of "across from you" to somebody who is not sitting anywhere.
    const said = fillOutcome([0, 1, 2, 3], null, { kind: 'all' }, 3);
    expect(said).toBe('Seats 3 house players and leaves one seat empty. The round deals when somebody takes it.');
    expect(said).not.toMatch(/your side|beside you|across from you/);
  });
});

describe('fewer agents than chairs', () => {
  it('counts what it can actually seat, and says how many are left', () => {
    // LEFT OVER is not KEPT BACK: the house ran out of players, nobody chose to save a chair.
    const short = fillOutcome([1, 2, 3], 0, { kind: 'all' }, 2);
    expect(short).toContain('Seats 2 house players and leaves one seat empty');
    expect(short).not.toMatch(/keeps/);
    expect(fillOutcome([1, 2, 3], 0, { kind: 'all' }, 0)).toBe('There is nobody to seat.');
  });
});
