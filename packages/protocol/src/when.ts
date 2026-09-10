/**
 * WALL CLOCK, NOT INSTANTS — turning "eight o'clock on Thursday in Denver" into a moment in time.
 *
 * A poker night is at eight. It is at eight in March and it is at eight in November, and the number
 * of hours between two consecutive Thursdays is not always 168. So a schedule stores `20:00` and
 * `America/Denver` and the instant is DERIVED per occurrence — store an instant and the game moves to
 * seven or nine when the clocks change, which is the single most reported bug in every recurring
 * event product there is (`docs/WORKSPACES.md` §7.3).
 *
 * Once derived it is PINNED on the night and never re-derived. Same doctrine as the chip rate and the
 * asset stamp: read once, stamp it, never look again. A tzdata update that shifts a rule must not
 * retroactively move a night people already turned up to.
 *
 * NO DEPENDENCY. Workers ship `Intl.DateTimeFormat` with full IANA data, so the whole of this is one
 * formatter used backwards: format a guessed instant IN the zone, read the wall clock it produced,
 * and see how far off it was.
 *
 * WHAT HAPPENS AT THE TWO AWKWARD MOMENTS. Twice a year a local time is either impossible or
 * ambiguous, and a function that returns a number has to pick:
 *
 *   THE GAP (spring forward). 02:30 does not exist on the day 02:00 becomes 03:00. This returns the
 *   instant AFTER the jump — a night set for 02:30 starts at 03:30 real time rather than 01:30, which
 *   is to say it does not start before people expect it.
 *
 *   THE OVERLAP (fall back). 01:30 happens twice on the day 02:00 becomes 01:00. This returns the
 *   FIRST one — the earlier instant — so the night starts when it first says 01:30 and nobody sits
 *   waiting through an hour that already happened.
 *
 * Both are the conventional choices (they are what RFC 5545 and Temporal's "compatible" mode do), and
 * both are asserted in the tests rather than left to be discovered.
 */

/** A local date, `YYYY-MM-DD`. Not an instant: it means nothing without a zone. */
export type LocalDate = string;
/** A local wall-clock time of day, `HH:MM`, 24-hour. */
export type LocalTime = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(v: string): v is LocalDate {
  return DATE_RE.test(v);
}

export function isLocalTime(v: string): v is LocalTime {
  return TIME_RE.test(v);
}

/**
 * Whether this runtime knows the zone.
 *
 * A schedule naming a zone the runtime cannot resolve would materialise nights at the wrong hour,
 * silently, forever — so it is refused BY NAME when it is set rather than accepted and misread.
 */
export function isTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The parts a zone shows at a given instant, as numbers.
 *
 * `hour12: false` still yields "24" for midnight in some ICU builds, which is a real and much-hit
 * trap: 24 is the same instant as 0 the next day, and treating it as hour 24 puts the answer a day
 * out. It is normalised here, once.
 */
function partsIn(utcMs: number, timezone: string): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const got: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) if (p.type !== 'literal') got[p.type] = p.value;
  const hh = Number(got.hour);
  return {
    y: Number(got.year),
    m: Number(got.month),
    d: Number(got.day),
    hh: hh === 24 ? 0 : hh,
    mm: Number(got.minute),
    ss: Number(got.second),
  };
}

/** How far ahead of UTC the zone is at this instant, in ms. Negative west of Greenwich. */
function offsetAt(utcMs: number, timezone: string): number {
  const p = partsIn(utcMs, timezone);
  // The wall clock the zone shows, read back AS IF it were UTC. The difference is the offset.
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant at which `timezone` reads `localDate` `localTime`.
 *
 * Two passes, and the second is what makes it right across a transition. The first guess uses the
 * offset in force at the naive instant, which is the wrong offset precisely when the clocks move
 * between the two; the second uses the offset in force at the guess, which is the right one. A third
 * pass would change nothing — offsets do not move twice in an hour anywhere on earth.
 *
 * Throws on a malformed date, time or zone rather than returning a plausible wrong number: a night at
 * the wrong hour is worse than a night that could not be scheduled.
 */
export function instantAt(localDate: LocalDate, localTime: LocalTime, timezone: string): number {
  const date = DATE_RE.exec(localDate);
  const time = TIME_RE.exec(localTime);
  if (!date) throw new Error(`"${localDate}" is not a date like 2026-03-08`);
  if (!time) throw new Error(`"${localTime}" is not a time like 20:00`);
  if (!isTimezone(timezone)) throw new Error(`"${timezone}" is not a time zone this runtime knows`);

  const naive = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(time[1]), Number(time[2]));
  const first = naive - offsetAt(naive, timezone);
  const settled = naive - offsetAt(first, timezone);

  // THE GAP. When the wanted wall clock does not exist, the two passes disagree, and `settled` is the
  // one that lands before the jump — i.e. earlier than the transition, showing the wrong hour. Taking
  // the LATER of the two is what puts a 02:30 night at 03:30 rather than 01:30.
  //
  // THE OVERLAP is the opposite case and needs no special handling: both passes agree on a valid
  // instant, and the two-pass form settles on the earlier of the two occurrences by construction.
  const lands = partsIn(settled, timezone);
  const wanted = `${date[1]}-${date[2]}-${date[3]} ${time[1]}:${time[2]}`;
  const shown = `${pad4(lands.y)}-${pad2(lands.m)}-${pad2(lands.d)} ${pad2(lands.hh)}:${pad2(lands.mm)}`;
  if (shown !== wanted) return Math.max(first, settled);
  return settled;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

/** The local date a zone is showing at an instant — `YYYY-MM-DD`. */
export function localDateIn(utcMs: number, timezone: string): LocalDate {
  const p = partsIn(utcMs, timezone);
  return `${pad4(p.y)}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** The local time a zone is showing at an instant — `HH:MM`. */
export function localTimeIn(utcMs: number, timezone: string): LocalTime {
  const p = partsIn(utcMs, timezone);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
}

/* --------------------------------------------------------------- days of the week */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Which weekday a local date falls on. Pure date arithmetic — no zone, because a date has no zone. */
export function weekdayOf(localDate: LocalDate): Weekday {
  const m = DATE_RE.exec(localDate);
  if (!m) throw new Error(`"${localDate}" is not a date like 2026-03-08`);
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return WEEKDAYS[new Date(at).getUTCDay()] as Weekday;
}

/** `n` days after a local date, as a local date. Calendar arithmetic, never 86,400,000 ms. */
export function addDays(localDate: LocalDate, n: number): LocalDate {
  const m = DATE_RE.exec(localDate);
  if (!m) throw new Error(`"${localDate}" is not a date like 2026-03-08`);
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return `${pad4(at.getUTCFullYear())}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
}
