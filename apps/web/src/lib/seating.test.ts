/**
 * The two silences this table used to keep, and the sentences that break them.
 *
 * The bug behind these tests is the one the user hit: two people at a table, both out of the deal,
 * nothing on screen to say so, and an action bar telling them both it was "not your turn" — when the
 * truth was that no hand existed and none could start.
 */
import { describe, expect, it } from 'vitest';
import { MIN_PLAYERS_TO_DEAL, dealState, sitOutNotice } from './seating';
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
});
