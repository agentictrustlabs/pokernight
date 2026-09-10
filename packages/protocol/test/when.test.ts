/**
 * The wall clock, across every daylight-saving boundary that matters.
 *
 * This is the part of scheduling that is quietly wrong in most products, so it is tested against real
 * transitions rather than against a mock — northern and southern hemispheres, a zone that moves on a
 * different date from the others, a zone with a half-hour offset, and a zone that does not move at all.
 */
import { describe, expect, it } from 'vitest';
import { addDays, instantAt, isLocalDate, isLocalTime, isTimezone, localDateIn, localTimeIn, weekdayOf } from '../src/when';

/** What a zone shows at an instant, as one readable string, for assertions that read like the claim. */
const shows = (ms: number, tz: string): string => `${localDateIn(ms, tz)} ${localTimeIn(ms, tz)}`;

describe('a local time is a time in a place', () => {
  it('resolves an ordinary evening', () => {
    const at = instantAt('2026-06-11', '20:00', 'America/Denver');
    expect(shows(at, 'America/Denver')).toBe('2026-06-11 20:00');
    // …and is a different instant from the same clock face in another zone.
    expect(instantAt('2026-06-11', '20:00', 'Europe/London')).not.toBe(at);
  });

  it('keeps the game at eight through a spring transition, not at seven or nine', () => {
    // THE BUG THIS EXISTS TO PREVENT. Store an instant and every Thursday after the clocks change is
    // an hour out. Two Thursdays either side of the US transition, both at eight.
    const before = instantAt('2026-03-05', '20:00', 'America/Denver');
    const after = instantAt('2026-03-12', '20:00', 'America/Denver');
    expect(shows(before, 'America/Denver')).toBe('2026-03-05 20:00');
    expect(shows(after, 'America/Denver')).toBe('2026-03-12 20:00');
    // Seven days of wall clock, 167 hours of real time — which is the whole point.
    expect(after - before).toBe(167 * 3600_000);
  });

  it('keeps it at eight through an autumn transition too — 169 hours that week', () => {
    const before = instantAt('2026-10-29', '20:00', 'America/Denver');
    const after = instantAt('2026-11-05', '20:00', 'America/Denver');
    expect(after - before).toBe(169 * 3600_000);
  });

  it('works south of the equator, where the transitions run the other way', () => {
    const a = instantAt('2026-03-26', '19:30', 'Australia/Sydney');
    const b = instantAt('2026-04-09', '19:30', 'Australia/Sydney');
    expect(shows(a, 'Australia/Sydney')).toBe('2026-03-26 19:30');
    expect(shows(b, 'Australia/Sydney')).toBe('2026-04-09 19:30');
  });

  it('works in a zone that moves on a different date from the others', () => {
    // Europe changes on the last Sunday in March; the US on the second Sunday. For three weeks a year
    // the usual offset between them is simply wrong, which is why nothing here stores an offset.
    const uk = instantAt('2026-03-19', '20:00', 'Europe/London');
    expect(shows(uk, 'Europe/London')).toBe('2026-03-19 20:00');
    expect(shows(uk, 'America/Denver')).toBe('2026-03-19 14:00');
  });

  it('works in a half-hour zone, and one that never changes at all', () => {
    expect(shows(instantAt('2026-06-11', '20:00', 'Asia/Kolkata'), 'Asia/Kolkata')).toBe('2026-06-11 20:00');
    expect(shows(instantAt('2026-12-11', '20:00', 'Asia/Kolkata'), 'Asia/Kolkata')).toBe('2026-12-11 20:00');
    expect(shows(instantAt('2026-01-15', '20:00', 'UTC'), 'UTC')).toBe('2026-01-15 20:00');
  });

  it('handles midnight, which some formatters call 24:00', () => {
    // `hour12: false` yields "24" for midnight in some ICU builds. Read as hour 24 the answer lands a
    // day out, silently, and only ever for the one time of day nobody tests.
    const at = instantAt('2026-06-11', '00:00', 'America/Denver');
    expect(shows(at, 'America/Denver')).toBe('2026-06-11 00:00');
  });
});

describe('the two awkward moments, decided rather than discovered', () => {
  it('THE GAP: a time that does not exist resolves AFTER the jump, never before it', () => {
    // 2026-03-08, America/Denver: 02:00 becomes 03:00, so 02:30 never happens.
    const at = instantAt('2026-03-08', '02:30', 'America/Denver');
    // The night starts at 03:30 real time. What it must NOT do is start at 01:30 — an hour before
    // anybody expected it, which is the failure people actually notice.
    expect(shows(at, 'America/Denver')).toBe('2026-03-08 03:30');
    expect(at).toBeGreaterThan(instantAt('2026-03-08', '01:30', 'America/Denver'));
  });

  it('THE OVERLAP: a time that happens twice resolves to the FIRST one', () => {
    // 2026-11-01, America/Denver: 02:00 becomes 01:00, so 01:30 happens twice.
    const at = instantAt('2026-11-01', '01:30', 'America/Denver');
    expect(shows(at, 'America/Denver')).toBe('2026-11-01 01:30');
    // The earlier of the two: still on daylight time, six hours behind UTC.
    expect(new Date(at).toISOString()).toBe('2026-11-01T07:30:00.000Z');
  });
});

describe('it refuses rather than guessing', () => {
  it('will not take a malformed date or time', () => {
    expect(() => instantAt('11/06/2026', '20:00', 'UTC')).toThrow(/not a date/);
    expect(() => instantAt('2026-06-11', '8pm', 'UTC')).toThrow(/not a time/);
    expect(() => instantAt('2026-06-11', '24:00', 'UTC')).toThrow(/not a time/);
  });

  it('will not take a zone it cannot resolve — a night at the wrong hour is worse than none', () => {
    expect(() => instantAt('2026-06-11', '20:00', 'Mars/Olympus')).toThrow(/not a time zone/);
    expect(isTimezone('America/Denver')).toBe(true);
    expect(isTimezone('Mars/Olympus')).toBe(false);
    expect(isTimezone('')).toBe(false);
  });

  it('knows a well-formed date and time when it sees one', () => {
    expect(isLocalDate('2026-06-11')).toBe(true);
    expect(isLocalDate('2026-6-11')).toBe(false);
    expect(isLocalTime('20:00')).toBe(true);
    expect(isLocalTime('24:00')).toBe(false);
    expect(isLocalTime('7:30')).toBe(false);
  });
});

describe('calendar arithmetic, which is not millisecond arithmetic', () => {
  it('names the weekday of a date', () => {
    expect(weekdayOf('2026-06-11')).toBe('thu');
    expect(weekdayOf('2026-03-08')).toBe('sun');
  });

  it('adds days across a month, a year and a leap day', () => {
    expect(addDays('2026-06-11', 7)).toBe('2026-06-18');
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('adds a WEEK of days, not 604,800,000 ms — the difference is the DST week', () => {
    // A week after the Thursday before the US transition is the Thursday after it. Adding
    // 7 × 86,400,000 to that night's INSTANT lands an hour out; adding seven days to its DATE does not.
    const next = addDays('2026-03-05', 7);
    expect(next).toBe('2026-03-12');
    expect(weekdayOf(next)).toBe('thu');
    expect(instantAt(next, '20:00', 'America/Denver') - instantAt('2026-03-05', '20:00', 'America/Denver')).toBe(167 * 3600_000);
  });
});

describe('a decade of Thursdays, every one of them at eight', () => {
  it('holds for ten years in four zones — the property the whole design turns on', () => {
    // Not a spot check: every Thursday from 2020 to 2030 in zones that transition on different dates,
    // in different hemispheres, and not at all. If any single one of these reads back as anything but
    // 20:00 then a club somewhere sits down at the wrong hour.
    for (const tz of ['America/Denver', 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata']) {
      let date = '2020-01-02'; // a Thursday
      let checked = 0;
      while (date < '2030-01-01') {
        const at = instantAt(date, '20:00', tz);
        expect(localTimeIn(at, tz), `${date} in ${tz}`).toBe('20:00');
        expect(localDateIn(at, tz), `${date} in ${tz}`).toBe(date);
        date = addDays(date, 7);
        checked++;
      }
      expect(checked).toBeGreaterThan(500);
    }
  }, 30_000);
});
