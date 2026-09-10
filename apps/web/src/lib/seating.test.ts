/**
 * The two silences this table used to keep, and the sentences that break them.
 *
 * The bug behind these tests is the one the user hit: two people at a table, both out of the deal,
 * nothing on screen to say so, and an action bar telling them both it was "not your turn" — when the
 * truth was that no hand existed and none could start.
 */
import { describe, expect, it } from 'vitest';
import { DEALT_IN_SOON, MIN_PLAYERS_TO_DEAL, dealState, satOutAction, satOutHeadline, sitOutNotice, waitingToBeDealtIn } from './seating';
import { emptyView, flopView, seat } from './mockServer';

describe('dealState', () => {
  it('says nothing while a hand is running', () => {
    const s = dealState(flopView(0));
    expect(s.handRunning).toBe(true);
    expect(s.waiting).toBeNull();
  });

  it('says nothing when two seats are sitting in and could be dealt', () => {
    const view = emptyView([seat(0, 'p-alice', 100), seat(1, 'p-bob', 100)]);
    expect(dealState(view).activeCount).toBe(MIN_PLAYERS_TO_DEAL);
    expect(dealState(view).waiting).toBeNull();
  });

  it('says an empty table is empty', () => {
    const s = dealState(emptyView([]));
    expect(s.waiting).toContain('Nobody is seated yet');
  });

  it('says one player is not enough', () => {
    const s = dealState(emptyView([seat(0, 'p-alice', 100)]));
    expect(s.activeCount).toBe(1);
    expect(s.waiting).toContain('Only one player is seated');
  });

  /**
   * THE case from the bug report: two people are seated, both sitting out, and the table falls
   * silent. `toAct` is null, no hand can start, and until now nothing said why.
   */
  it('says so when everyone at the table is sitting out', () => {
    const view = emptyView([seat(0, 'p-alice', 100, { status: 'sitting-out' }), seat(1, 'p-bob', 100, { status: 'sitting-out' })]);
    const s = dealState(view);
    expect(s.seatedCount).toBe(2);
    expect(s.activeCount).toBe(0);
    expect(s.waiting).toBe('All 2 players at this table are sitting out, so no hand can start.');
  });

  it('says so when only one of the two is sitting in', () => {
    const view = emptyView([seat(0, 'p-alice', 100), seat(1, 'p-bob', 100, { status: 'sitting-out' })]);
    expect(dealState(view).waiting).toContain('Only one player is sitting in');
  });

  /** A seat with no chips cannot be dealt in either — the engine's own rule, mirrored honestly. */
  it('does not count a busted seat as a player who can be dealt in', () => {
    const view = emptyView([seat(0, 'p-alice', 100), seat(1, 'p-bob', 0)]);
    expect(dealState(view).activeCount).toBe(1);
    expect(dealState(view).waiting).not.toBeNull();
  });

  /**
   * THE second bug report: "when one player gets out of money the game gets stuck". Being broke and
   * being sat out are the same seat STATUS and different situations, and a table that says "sitting
   * out" to a room full of busted players is telling them to press a button that cannot help.
   */
  it('says everyone has run out of chips, not that everyone is sitting out', () => {
    const view = emptyView([seat(0, 'p-alice', 0, { status: 'sitting-out' }), seat(1, 'p-bob', 0, { status: 'sitting-out' })]);
    const s = dealState(view);
    expect(s.brokeCount).toBe(2);
    expect(s.waiting).toContain('have run out of chips');
    expect(s.waiting).toContain('Buying back in starts the next hand');
    expect(s.waiting).not.toContain('sitting out');
  });

  it('says so for a single busted player', () => {
    const view = emptyView([seat(0, 'p-alice', 0, { status: 'sitting-out' })]);
    expect(dealState(view).waiting).toContain('has run out of chips');
  });

  it('names both kinds when both are in the way, because the fix differs', () => {
    const view = emptyView([
      seat(0, 'p-alice', 0, { status: 'sitting-out' }),
      seat(1, 'p-bob', 100, { status: 'sitting-out' }),
      seat(2, 'p-cara', 0, { status: 'sitting-out' }),
    ]);
    const s = dealState(view);
    expect(s.brokeCount).toBe(2);
    expect(s.waiting).toContain('1 player is sitting out');
    expect(s.waiting).toContain('2 players have run out of chips');
  });

  it('still says plain "sitting out" when nobody is broke', () => {
    const view = emptyView([seat(0, 'p-alice', 100, { status: 'sitting-out' }), seat(1, 'p-bob', 100, { status: 'sitting-out' })]);
    expect(dealState(view).waiting).toBe('All 2 players at this table are sitting out, so no hand can start.');
  });
});

/**
 * Which control a sat-out player is offered. The rule is the whole fix for "the game is stuck": an
 * action that cannot help is worse than no action, because it looks like the fix.
 */
/**
 * The third silence: seated, sitting in, with chips, and still not in the hand.
 *
 * A newcomer joins at the big blind, which is an ordinary card-room rule. It was on screen as
 * "Waiting for BB" — a phrase for people who already know it, which told everybody else that
 * something was wrong with them and withheld the one thing that mattered: that they are about to be
 * dealt in and need do nothing.
 */
describe('waiting to be dealt in', () => {
  const waiting = (n: number) => seat(n, `p-${n}`, 200, { waitingForBigBlind: true });

  it('says so in a sentence, not in two letters', () => {
    const view = emptyView([seat(0, 'p-alice', 200), seat(1, 'p-bob', 200), waiting(3)], 3);
    const line = waitingToBeDealtIn(view);
    expect(line).toBeTruthy();
    expect(line).toMatch(/big blind/i);
    // The two things a person needs: roughly how long, and that there is nothing for them to do.
    expect(line).toMatch(/hand or two/i);
    expect(line).toMatch(/nothing to do/i);
    expect(line).not.toContain('BB');
  });

  it('is about the VIEWER, never about somebody else at the table', () => {
    const view = emptyView([seat(0, 'p-alice', 200), seat(1, 'p-bob', 200), waiting(3)], 0);
    expect(waitingToBeDealtIn(view)).toBeNull();
    expect(waitingToBeDealtIn(emptyView([seat(0, 'p-alice', 200)], null))).toBeNull();
  });

  it('promises no wait at a table too small to have one', () => {
    // Two players are dealt in together whatever the blinds have done, so the flag can be set and
    // the wait still not be coming. Saying "a hand or two" there would be a promise of a delay that
    // is not going to happen.
    expect(waitingToBeDealtIn(emptyView([seat(0, 'p-alice', 200), waiting(1)], 1))).toBeNull();
  });

  it('says nothing to somebody who is sitting out, who has a different problem', () => {
    const out = seat(3, 'p-3', 200, { waitingForBigBlind: true, status: 'sitting-out' });
    expect(waitingToBeDealtIn(emptyView([seat(0, 'p-alice', 200), seat(1, 'p-bob', 200), out], 3))).toBeNull();
  });

  it('has a badge that is words rather than an abbreviation', () => {
    expect(DEALT_IN_SOON).toBe('Dealt in soon');
  });
});

describe('satOutAction', () => {
  it('offers a rebuy — never a sit-in — to a player with no chips', () => {
    expect(satOutAction(0)).toBe('rebuy');
    expect(satOutHeadline(0)).toBe('You are out of chips');
  });

  it('offers a sit-in to a player who has chips and simply is not being dealt in', () => {
    expect(satOutAction(120)).toBe('sit-in');
    expect(satOutHeadline(120)).toBe('You are sitting out');
  });
});

describe('sitOutNotice', () => {
  it('names a dropped connection, and says the money did not move', () => {
    const said = sitOutNotice('disconnected');
    expect(said).toContain('connection dropped');
    expect(said).toContain('chips were kept');
  });

  it('names missed turns', () => {
    expect(sitOutNotice('timeouts')).toContain('two missed turns');
  });

  it('does not blame the table when the player asked for it', () => {
    expect(sitOutNotice('requested')).toContain('You asked to sit out');
  });

  it('still says something useful when the reason is unknown', () => {
    expect(sitOutNotice(undefined)).toContain('not being dealt in');
  });

  /**
   * An empty stack outranks every other explanation. A player on zero who is told their connection
   * dropped is being given a true fact that is not the one standing between them and the next hand.
   */
  it('talks about money, not connections, once the chips are gone', () => {
    const said = sitOutNotice('disconnected', 0);
    expect(said).toContain('Your chips are gone');
    expect(said).toContain('Buy back in');
    expect(said).not.toContain('connection');
  });

  it('keeps the ordinary explanation for a sat-out player who still has chips', () => {
    expect(sitOutNotice('disconnected', 250)).toContain('connection dropped');
  });
});
