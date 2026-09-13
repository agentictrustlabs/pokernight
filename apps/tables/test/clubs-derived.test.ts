import { describe, expect, it } from 'vitest';
import { nightId, nightsOf, scheduleFrom } from '../src/clubs.js';

/**
 * A CLUB'S NIGHTS ARE DERIVED, NOT KEPT. The rule lives at the club's Home (`cardroom.club.schedule`); the
 * occasions come from it at read time, the same every time, with the host's exceptions laid over.
 */
describe('the nights a schedule gives', () => {
  const club = '0x' + 'e'.repeat(40);
  const host = '0x' + 'a'.repeat(40);
  const now = Date.UTC(2026, 8, 13, 12, 0, 0); // a Sunday

  it('composes a schedule from what the host asked for, or says what is wrong with it', () => {
    const made = scheduleFrom(club, { startLocal: '20:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] }, defaults: { game: 'canasta' } }, host, now);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.schedule.club).toBe(club);
    expect(made.schedule.createdBy).toBe(host);
    expect(made.schedule.status).toBe('active');
    const bad = scheduleFrom(club, { startLocal: '25:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] } }, host, now);
    expect(bad.ok).toBe(false);
  });

  it('fills the horizon from the rule, with the same ids every time, and carries the defaults', () => {
    const made = scheduleFrom(club, { startLocal: '20:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] }, defaults: { game: 'canasta', seatCap: 8 } }, host, now);
    if (!made.ok) throw new Error(made.error);
    const a = nightsOf(club, made.schedule, null, now);
    const b = nightsOf(club, made.schedule, null, now);
    expect(a).toHaveLength(8);
    expect(a.map((n) => n.nightId)).toEqual(b.map((n) => n.nightId));
    expect(a[0]!.nightId).toBe(nightId(made.schedule.scheduleId, a[0]!.localDate));
    expect(a.every((n) => n.game === 'canasta' && n.seatCap === 8 && n.status === 'scheduled')).toBe(true);
    expect(a[0]!.startsAt).toBeGreaterThan(now);
  });

  it('lays the host’s exceptions over the rule — cancelled and skipped are different things, and both stay listed', () => {
    const made = scheduleFrom(club, { startLocal: '20:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] } }, host, now);
    if (!made.ok) throw new Error(made.error);
    const [first, second] = nightsOf(club, made.schedule, null, now);
    const nights = nightsOf(club, made.schedule, { exceptions: { [first!.nightId]: { status: 'cancelled', cancelledAt: now, reason: 'flood' }, [second!.nightId]: { status: 'skipped', cancelledAt: now } } }, now);
    expect(nights[0]).toMatchObject({ status: 'cancelled', reason: 'flood', cancelledAt: now });
    expect(nights[1]).toMatchObject({ status: 'skipped' });
    expect(nights[2]!.status).toBe('scheduled');
  });

  it('gives no nights for a retired rule, or none at all', () => {
    const made = scheduleFrom(club, { startLocal: '20:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] } }, host, now);
    if (!made.ok) throw new Error(made.error);
    expect(nightsOf(club, { ...made.schedule, status: 'retired' }, null, now)).toEqual([]);
    expect(nightsOf(club, null, null, now)).toEqual([]);
  });
});
