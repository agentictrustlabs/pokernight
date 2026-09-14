import { describe, expect, it } from 'vitest';
import { guestOf, nightId, nightsOf, oneOffFrom, scheduleFrom, visitOf } from '../src/clubs.js';

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

describe('the guest of a night', () => {
  const club = '0x00000000000000000000000000000000000000c1';
  const host = '0x00000000000000000000000000000000000000d1';
  const now = Date.parse('2026-09-14T12:00:00Z');
  const bob = { entryId: 'urn:ap:registry-entry:gamenight-missions/0x00000000000000000000000000000000000000ab', org: '0x00000000000000000000000000000000000000ab', name: 'Hope for the City' };
  const carol = { ...bob, entryId: 'urn:ap:registry-entry:gamenight-missions/0x00000000000000000000000000000000000000ac', org: '0x00000000000000000000000000000000000000ac', name: 'Bread and Roses' };

  it('is the series’ standing guest unless the night says otherwise — a mission, or none', () => {
    const made = scheduleFrom(club, { startLocal: '20:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] }, defaults: { mission: bob } }, host, now);
    if (!made.ok) throw new Error(made.error);
    const nights = nightsOf(club, made.schedule, null, now, 3);
    expect(nights.map((n) => n.mission?.name)).toEqual(['Hope for the City', 'Hope for the City', 'Hope for the City']);
    const first = nights[0]!.nightId;
    const second = nights[1]!.nightId;
    const record = { guests: { [first]: carol, [second]: null } };
    const over = nightsOf(club, made.schedule, record, now, 3);
    expect(over.map((n) => n.mission?.name)).toEqual(['Bread and Roses', undefined, 'Hope for the City']);
    expect(guestOf(made.schedule, record, second)).toBeNull();
    expect(guestOf(made.schedule, record, nights[2]!.nightId)).toEqual(bob);
  });
});

describe('a one-time night, and a visit', () => {
  const club = '0x00000000000000000000000000000000000000c2';
  const host = '0x00000000000000000000000000000000000000d2';
  const now = Date.parse('2026-09-14T12:00:00Z');
  const bob = { entryId: 'urn:ap:registry-entry:gamenight-missions/0x00000000000000000000000000000000000000ab', org: '0x00000000000000000000000000000000000000ab', name: 'Hope for the City' };

  it('sits beside the series, sorted by start, and stands alone without one', () => {
    const one = oneOffFrom({ localDate: '2026-09-20', startLocal: '19:00', timezone: 'America/Denver', title: 'Harvest night', game: 'canasta' }, host, now);
    if (!one.ok) throw new Error(one.error);
    expect(one.id).toMatch(/^one:/);
    const alone = nightsOf(club, null, { oneOffs: { [one.id]: one.night } }, now);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatchObject({ nightId: one.id, oneOff: true, title: 'Harvest night', game: 'canasta', status: 'scheduled' });
    const made = scheduleFrom(club, { startLocal: '20:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] } }, host, now);
    if (!made.ok) throw new Error(made.error);
    const both = nightsOf(club, made.schedule, { oneOffs: { [one.id]: one.night } }, now, 3);
    expect(both.map((n) => n.oneOff ?? false)).toEqual([false, true, false, false]);
    expect(both.every((n, i) => i === 0 || n.startsAt >= both[i - 1]!.startsAt)).toBe(true);
    expect(oneOffFrom({ localDate: '2020-01-01', startLocal: '19:00', timezone: 'America/Denver' }, host, now)).toMatchObject({ ok: false });
    expect(oneOffFrom({ localDate: '2026-09-20', startLocal: '19:00', timezone: 'Mars/Olympus' }, host, now)).toMatchObject({ ok: false });
  });

  it('carries who comes on the mission’s behalf, and the old guest shape reads as an invited visit', () => {
    const made = scheduleFrom(club, { startLocal: '20:00', timezone: 'America/Denver', recurrence: { kind: 'weekly', weekdays: ['thu'] }, defaults: { mission: bob } }, host, now);
    if (!made.ok) throw new Error(made.error);
    const [first, second] = nightsOf(club, made.schedule, null, now, 2).map((n) => n.nightId) as [string, string];
    const record = { guests: { [first]: bob }, visits: { [second]: { mission: bob, representative: { name: 'Dana Ruiz', email: 'dana@hope.example' }, status: 'confirmed' as const } } };
    expect(visitOf(made.schedule, record, first)).toEqual({ mission: bob, status: 'invited' });
    const n2 = nightsOf(club, made.schedule, record, now, 2)[1]!;
    expect(n2.visit?.representative?.name).toBe('Dana Ruiz');
    expect(n2.visit?.status).toBe('confirmed');
    expect(n2.mission?.name).toBe('Hope for the City');
    expect(visitOf(made.schedule, { visits: { [first]: null } }, first)).toBeNull();
  });
});
