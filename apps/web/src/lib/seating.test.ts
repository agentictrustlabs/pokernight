/**
 * The two silences this table used to keep, and the sentences that break them.
 *
 * The bug behind these tests is the one the user hit: two people at a table, both out of the deal,
 * nothing on screen to say so, and an action bar telling them both it was "not your turn" — when the
 * truth was that no hand existed and none could start.
 */
import { describe, expect, it } from 'vitest';
import { MIN_PLAYERS_TO_DEAL, dealState, satOutAction, satOutHeadline, sitOutNotice } from './seating';
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
