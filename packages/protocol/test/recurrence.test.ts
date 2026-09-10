/**
 * Which dates a schedule actually comes to.
 *
 * The properties worth holding: it produces the dates a person would write on a calendar, it is
 * idempotent so a daily alarm can just run it, it never drifts an hour across a daylight-saving
 * boundary, and it refuses anything it cannot honour BY NAME rather than accepting it and being
 * quietly wrong for months.
 */
import { describe, expect, it } from 'vitest';
import { nthWeekdayOfMonth, occurrencesFrom, recurrenceProblem, schedulingProblem, type Recurring } from '../src/recurrence';
import { instantAt, localTimeIn } from '../src/when';

const DENVER = 'America/Denver';
const at = (d: string, t = '20:00', tz = DENVER): number => instantAt(d, t, tz);

const thursdays: Recurring = {
  startLocal: '20:00',
  timezone: DENVER,
  recurrence: { kind: 'weekly', weekdays: ['thu'] },
  activeFrom: at('2026-01-01'),
};

const dates = (s: Recurring, from: number, n: number): string[] => occurrencesFrom(s, from, n).map((o) => o.localDate);

describe('every Thursday', () => {
  it('is the Thursdays, in order, starting with the next one', () => {
    expect(dates(thursdays, at('2026-01-01'), 4)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22']);
  });

  it('skips one that has already started, rather than materialising the past', () => {
    // Half an hour after the first night began. It is not a night to invite anybody to.
    const half = at('2026-01-01') + 30 * 60_000;
    expect(dates(thursdays, half, 2)).toEqual(['2026-01-08', '2026-01-15']);
  });

  it('pins an instant that reads 20:00 on every one of them, DST or not', () => {
    for (const o of occurrencesFrom(thursdays, at('2026-01-01'), 30)) {
      expect(localTimeIn(o.startsAt, DENVER), o.localDate).toBe('20:00');
    }
  });

  it('is IDEMPOTENT — running it twice produces the same keys, which is what lets an alarm just run it', () => {
    const a = occurrencesFrom(thursdays, at('2026-01-01'), 8);
    const b = occurrencesFrom(thursdays, at('2026-01-01'), 8);
    expect(b).toEqual(a);
  });
});

describe('more than one night a week', () => {
  it('takes a SET of weekdays, because Tuesday and Thursday is the common case', () => {
    // The single-`weekday` shape could not say this at all (`docs/MISSION.md` §4).
    const s: Recurring = { ...thursdays, recurrence: { kind: 'weekly', weekdays: ['tue', 'thu'] } };
    expect(dates(s, at('2026-01-01'), 5)).toEqual(['2026-01-01', '2026-01-06', '2026-01-08', '2026-01-13', '2026-01-15']);
  });

  it('gives them in date order whatever order the weekdays were listed in', () => {
    const s: Recurring = { ...thursdays, recurrence: { kind: 'weekly', weekdays: ['thu', 'tue'] } };
    const got = dates(s, at('2026-01-01'), 4);
    expect(got).toEqual([...got].sort());
  });
});

describe('every other week', () => {
  it('counts from the schedule’s own start, not from whenever it is asked', () => {
    const s: Recurring = { ...thursdays, recurrence: { kind: 'weekly', weekdays: ['thu'], interval: 2 } };
    expect(dates(s, at('2026-01-01'), 4)).toEqual(['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12']);
    // Asked six weeks later it must still land on the same fortnightly beat — an interval that
    // re-anchors on "now" silently moves the whole series every time the alarm runs.
    expect(dates(s, at('2026-02-05'), 2)).toEqual(['2026-02-12', '2026-02-26']);
  });

  it('holds the beat across a daylight-saving change', () => {
    const s: Recurring = { ...thursdays, recurrence: { kind: 'weekly', weekdays: ['thu'], interval: 2 } };
    const got = occurrencesFrom({ ...s, activeFrom: at('2026-02-26') }, at('2026-02-26'), 4);
    expect(got.map((o) => o.localDate)).toEqual(['2026-02-26', '2026-03-12', '2026-03-26', '2026-04-09']);
    for (const o of got) expect(localTimeIn(o.startsAt, DENVER)).toBe('20:00');
  });
});

describe('the nth weekday of the month', () => {
  it('finds the first, the third and the last', () => {
    expect(nthWeekdayOfMonth('2026-05-14', 'fri', 1)).toBe('2026-05-01');
    expect(nthWeekdayOfMonth('2026-05-14', 'fri', 3)).toBe('2026-05-15');
    expect(nthWeekdayOfMonth('2026-05-14', 'fri', -1)).toBe('2026-05-29');
  });

  it('has no fifth Friday in a month with four, and skips that month rather than approximating', () => {
    expect(nthWeekdayOfMonth('2026-06-01', 'fri', 4)).toBe('2026-06-26');
    const s: Recurring = { ...thursdays, recurrence: { kind: 'monthly-nth', weekday: 'fri', nth: -1 } };
    expect(dates(s, at('2026-01-01'), 4)).toEqual(['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24']);
  });

  it('runs the last-Friday game for a year without wandering off the last Friday', () => {
    const s: Recurring = { ...thursdays, recurrence: { kind: 'monthly-nth', weekday: 'fri', nth: -1 } };
    for (const o of occurrencesFrom(s, at('2026-01-01'), 12)) {
      expect(nthWeekdayOfMonth(o.localDate, 'fri', -1)).toBe(o.localDate);
      expect(localTimeIn(o.startsAt, DENVER)).toBe('20:00');
    }
  });
});

describe('a one-off night', () => {
  it('is exactly one, on the schedule’s own start date', () => {
    const s: Recurring = { ...thursdays, recurrence: { kind: 'once' }, activeFrom: at('2026-07-04') };
    expect(dates(s, at('2026-01-01'), 8)).toEqual(['2026-07-04']);
  });

  it('produces nothing once it has passed', () => {
    const s: Recurring = { ...thursdays, recurrence: { kind: 'once' }, activeFrom: at('2026-07-04') };
    expect(dates(s, at('2026-07-05'), 8)).toEqual([]);
  });
});

describe('the window', () => {
  it('stops at activeUntil, and does not fill the horizon past it', () => {
    const s: Recurring = { ...thursdays, activeUntil: at('2026-01-16') };
    expect(dates(s, at('2026-01-01'), 8)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
  });

  it('never materialises before activeFrom, however early it is asked', () => {
    expect(dates(thursdays, at('2025-06-01'), 2)).toEqual(['2026-01-01', '2026-01-08']);
  });
});

describe('it refuses by name rather than being quietly wrong', () => {
  it('will not take an RRULE frequency this card room does not run', () => {
    expect(recurrenceProblem({ kind: 'daily' } as never)).toMatch(/not a recurrence this card room runs/);
    expect(recurrenceProblem({ kind: 'hourly' } as never)).toMatch(/once, weekly or monthly-nth/);
  });

  it('will not take a weekly schedule with no days, a bad day, or the same day twice', () => {
    expect(recurrenceProblem({ kind: 'weekly', weekdays: [] })).toMatch(/at least one weekday/);
    expect(recurrenceProblem({ kind: 'weekly', weekdays: ['thu', 'thu'] })).toMatch(/same weekday twice/);
    expect(recurrenceProblem({ kind: 'weekly', weekdays: ['thursday' as never] })).toMatch(/is not a day/);
  });

  it('will not take an interval or an nth it cannot honour', () => {
    expect(recurrenceProblem({ kind: 'weekly', weekdays: ['thu'], interval: 5 as never })).toMatch(/1, 2, 3 or 4/);
    expect(recurrenceProblem({ kind: 'monthly-nth', weekday: 'fri', nth: 5 as never })).toMatch(/1st, 2nd, 3rd, 4th or last/);
  });

  it('will not take a bad time, an unknown zone, or a window that ends before it starts', () => {
    expect(schedulingProblem({ ...thursdays, startLocal: '8pm' as never })).toMatch(/not a time/);
    expect(schedulingProblem({ ...thursdays, timezone: 'Mars/Olympus' })).toMatch(/not a time zone/);
    expect(schedulingProblem({ ...thursdays, activeUntil: thursdays.activeFrom - 1 })).toMatch(/cannot end before it starts/);
    expect(schedulingProblem(thursdays)).toBeNull();
  });

  it('produces nothing at all for a schedule it would have refused', () => {
    // Belt and braces: the API refuses these, and if one ever got stored it must still not invent
    // dates from a rule nobody validated.
    expect(occurrencesFrom({ ...thursdays, timezone: 'Mars/Olympus' }, at('2026-01-01'), 4)).toEqual([]);
  });
});
