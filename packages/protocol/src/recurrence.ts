/**
 * WHEN A CLUB MEETS, and which actual dates that comes to.
 *
 * RFC 5545's `RRULE` is the standard and it is enormous. This is the subset a poker night actually
 * uses, shaped as a strict subset of `RRULE` semantics so that emitting a real `RRULE` later is a
 * serialisation change rather than a redesign (`docs/WORKSPACES.md` §7.2). Daily, hourly,
 * by-month-day, `COUNT` and `BYSETPOS` are not implemented, and are refused BY NAME when a schedule
 * is set rather than accepted and quietly ignored.
 *
 * `weekly` takes a SET of weekdays, not one — `docs/MISSION.md` §4 supersedes the original single
 * `weekday`, because a group meeting Tuesday and Thursday at seven is the common case and one
 * weekday cannot say it. Different times on different days still need separate schedules.
 *
 * EVERYTHING HERE WORKS IN LOCAL DATES, never in instants. "A week later" is seven calendar days,
 * which is 167, 168 or 169 hours depending on the week; doing it in milliseconds is how a recurring
 * event drifts an hour twice a year. The instant is derived once per occurrence, at the end, by
 * `instantAt` — and is then pinned to the night and never re-derived.
 */

import { WEEKDAYS, addDays, instantAt, isLocalTime, isTimezone, localDateIn, weekdayOf, type LocalDate, type LocalTime, type Weekday } from './when.js';

export type Recurrence =
  /** One night, on the schedule's own start date. */
  | { kind: 'once' }
  /** Every week, or every `interval` weeks, on each of these weekdays. */
  | { kind: 'weekly'; weekdays: Weekday[]; interval?: 1 | 2 | 3 | 4 }
  /** The nth such weekday of the month; `-1` is the last one. */
  | { kind: 'monthly-nth'; weekday: Weekday; nth: 1 | 2 | 3 | 4 | -1 };

/** What a schedule needs to say to produce dates. The stored `ClubScheduleV1` is this plus bookkeeping. */
export interface Recurring {
  /** Local wall clock, `HH:MM`. Not an instant. */
  startLocal: LocalTime;
  /** IANA zone the wall clock is read in. */
  timezone: string;
  recurrence: Recurrence;
  /** Nothing before this instant. Its LOCAL DATE is also the anchor an interval counts from. */
  activeFrom: number;
  /** …and nothing after this one. Absent is open-ended. */
  activeUntil?: number;
}

/** One materialised occurrence: the date it falls on, and the instant that resolved to. */
export interface Occurrence {
  /** `YYYY-MM-DD` in the schedule's own zone. The idempotency key, with the schedule id. */
  localDate: LocalDate;
  /** Pinned at materialisation and never re-derived. */
  startsAt: number;
}

/**
 * Why a recurrence cannot be used, or null when it can.
 *
 * Refusing BY NAME matters more here than almost anywhere else: a schedule that was accepted and
 * silently misread produces nights at the wrong time for months, and nobody looks at the schedule
 * again because it was accepted.
 */
export function recurrenceProblem(r: Recurrence): string | null {
  if (!r || typeof r !== 'object') return 'a recurrence is required';
  switch (r.kind) {
    case 'once':
      return null;
    case 'weekly': {
      if (!Array.isArray(r.weekdays) || r.weekdays.length === 0) return 'a weekly schedule needs at least one weekday';
      const bad = r.weekdays.find((d) => !WEEKDAYS.includes(d));
      if (bad !== undefined) return `"${String(bad)}" is not a day — use ${WEEKDAYS.join(', ')}`;
      if (new Set(r.weekdays).size !== r.weekdays.length) return 'that lists the same weekday twice';
      if (r.interval !== undefined && ![1, 2, 3, 4].includes(r.interval)) return 'a weekly interval is 1, 2, 3 or 4 weeks';
      return null;
    }
    case 'monthly-nth': {
      if (!WEEKDAYS.includes(r.weekday)) return `"${String(r.weekday)}" is not a day — use ${WEEKDAYS.join(', ')}`;
      if (![1, 2, 3, 4, -1].includes(r.nth)) return 'a monthly schedule is the 1st, 2nd, 3rd, 4th or last (-1) of the month';
      return null;
    }
    default:
      // Every other RRULE frequency lands here, which is the point: named and refused, not ignored.
      return `"${String((r as { kind: unknown }).kind)}" is not a recurrence this card room runs — use once, weekly or monthly-nth`;
  }
}

/** Everything wrong with a schedule, said plainly, or null. */
export function schedulingProblem(s: Recurring): string | null {
  if (!isLocalTime(s.startLocal)) return `"${s.startLocal}" is not a time like 20:00`;
  if (!isTimezone(s.timezone)) return `"${s.timezone}" is not a time zone this card room knows`;
  if (!Number.isFinite(s.activeFrom)) return 'a schedule needs a start';
  if (s.activeUntil !== undefined && s.activeUntil <= s.activeFrom) return 'a schedule cannot end before it starts';
  return recurrenceProblem(s.recurrence);
}

/** Whole weeks between two local dates, counting from the Sunday each falls in. */
function weeksBetween(from: LocalDate, to: LocalDate): number {
  const sunday = (d: LocalDate): number => {
    const back = WEEKDAYS.indexOf(weekdayOf(d));
    const s = addDays(d, -back);
    return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  };
  return Math.round((sunday(to) - sunday(from)) / (7 * 86_400_000));
}

/** The date of the nth `weekday` in the month `anyDayInMonth` belongs to, or null when there is no nth. */
export function nthWeekdayOfMonth(anyDayInMonth: LocalDate, weekday: Weekday, nth: 1 | 2 | 3 | 4 | -1): LocalDate | null {
  const y = Number(anyDayInMonth.slice(0, 4));
  const m = Number(anyDayInMonth.slice(5, 7));
  const first = `${anyDayInMonth.slice(0, 8)}01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hits: LocalDate[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(first, d);
    if (weekdayOf(date) === weekday) hits.push(date);
  }
  if (nth === -1) return hits[hits.length - 1] ?? null;
  return hits[nth - 1] ?? null;
}

/** The first day of the month after the one this date is in. */
function nextMonth(d: LocalDate): LocalDate {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * The next `count` occurrences at or after `from`, as durable rows waiting to be written.
 *
 * MATERIALISED AHEAD, NOT COMPUTED ON DEMAND, and that is the whole reason this returns rows rather
 * than being a generator somebody calls at read time: an invitation cannot be sent to an occurrence
 * that does not exist, an answer cannot be recorded against a computed date, and "who is coming on
 * the 12th" cannot be asked of a formula. It is idempotent by `(scheduleId, localDate)`, so running
 * it twice creates nothing — which is what lets a daily alarm just run it.
 *
 * Bounded twice over: by `count`, and by a hard limit on how many candidate dates it will look at, so
 * a schedule whose window contains no matching day can never spin.
 */
export function occurrencesFrom(s: Recurring, from: number, count: number): Occurrence[] {
  if (schedulingProblem(s) !== null || count <= 0) return [];
  const out: Occurrence[] = [];
  const anchor = localDateIn(s.activeFrom, s.timezone);
  // Never look before the schedule's own start, whatever `from` says.
  const begin = from > s.activeFrom ? localDateIn(from, s.timezone) : anchor;

  const take = (date: LocalDate): boolean => {
    if (date < anchor) return true;
    const at = instantAt(date, s.startLocal, s.timezone);
    if (at < from || at < s.activeFrom) return true;
    if (s.activeUntil !== undefined && at > s.activeUntil) return false; // past the window: stop
    out.push({ localDate: date, startsAt: at });
    return out.length < count;
  };

  if (s.recurrence.kind === 'once') {
    // One night, on the schedule's own start date — `activeFrom` IS the occurrence.
    take(anchor);
    return out;
  }

  if (s.recurrence.kind === 'weekly') {
    const { weekdays, interval = 1 } = s.recurrence;
    const wanted = new Set(weekdays);
    let date = begin;
    // Ten years of days is the ceiling; a weekly schedule reaches any horizon long before it.
    for (let i = 0; i < 3700; i++) {
      if (wanted.has(weekdayOf(date)) && weeksBetween(anchor, date) % interval === 0) {
        if (!take(date)) return out;
      }
      date = addDays(date, 1);
    }
    return out;
  }

  const { weekday, nth } = s.recurrence;
  let month = `${begin.slice(0, 8)}01`;
  // A hundred and twenty months, for the same reason.
  for (let i = 0; i < 120; i++) {
    const date = nthWeekdayOfMonth(month, weekday, nth);
    // A month with only four Fridays simply has no fifth; it is skipped, not approximated.
    if (date !== null && date >= begin && !take(date)) return out;
    month = nextMonth(month);
  }
  return out;
}
