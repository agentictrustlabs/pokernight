/**
 * A NIGHT, as a sentence somebody reads.
 *
 * All pure, because every line here is something a person acts on — turning up, or not — and being
 * wrong about a date is the kind of wrong nobody notices until the room is empty.
 *
 * THE TRAP THIS EXISTS TO AVOID. A night has a zone of its own: the club's. A member reading it may be
 * somewhere else entirely, and "Thursday at 8" is then true for the club and false for them — a
 * Denver game at eight is three in the morning in London, the NEXT day. So the club's own time is
 * what is shown, because that is when the game is, and the reader's local time is shown BESIDE it
 * whenever the two disagree. Showing only one of them is how somebody misses a game by eight hours.
 */

import type { Night } from './types';


/** The zone this browser is in, or UTC when it will not say. */
export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function fmt(at: number, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...opts }).format(new Date(at));
  } catch {
    // An unknown zone must not take the whole panel down; the instant is still true.
    return new Intl.DateTimeFormat('en-GB', opts).format(new Date(at));
  }
}

/** "Thursday 12 March" in the given zone. */
export function dayOf(at: number, timezone: string): string {
  return fmt(at, timezone, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "8:00 pm" in the given zone. */
export function timeOf(at: number, timezone: string): string {
  return fmt(at, timezone, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])m$/i, (_m, p) => `${p}m`);
}

/**
 * How far off it is, in the words people use.
 *
 * Counted in the NIGHT'S OWN days, not in 24-hour blocks: a game at eight tonight is "tonight" at
 * seven and at eleven this morning alike, and one at eight tomorrow is "tomorrow" even though the gap
 * might be twenty-six hours. Elapsed-hours arithmetic gets both of those wrong at exactly the times
 * of day people are actually looking.
 */
export function whenPhrase(at: number, now: number, timezone: string): string {
  const dayKey = (ms: number): string => fmt(ms, timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (at < now) return 'under way';
  const today = dayKey(now);
  const then = dayKey(at);
  if (then === today) return 'tonight';
  const tomorrow = dayKey(now + 86_400_000);
  if (then === tomorrow) return 'tomorrow';
  const days = Math.round((at - now) / 86_400_000);
  if (days <= 6) return `in ${days} days`;
  if (days <= 13) return 'next week';
  return `in ${Math.round(days / 7)} weeks`;
}

export interface NightWhen {
  /** "Thursday 12 March", in the club's own zone. */
  day: string;
  /** "8:00pm", in the club's own zone. */
  time: string;
  /** "tonight" / "in 3 days". */
  phrase: string;
  /**
   * The same moment where the READER is, when that is a different clock face. Absent when the two
   * agree, because repeating the same time in two places reads as a mistake.
   */
  alsoYours?: string;
}

export function nightWhen(night: Pick<Night, 'startsAt' | 'timezone'>, now: number, viewer = viewerZone()): NightWhen {
  const day = dayOf(night.startsAt, night.timezone);
  const time = timeOf(night.startsAt, night.timezone);
  const yourDay = dayOf(night.startsAt, viewer);
  const yourTime = timeOf(night.startsAt, viewer);
  const same = yourDay === day && yourTime === time;
  return {
    day,
    time,
    phrase: whenPhrase(night.startsAt, now, night.timezone),
    // The DAY is included when the reader's day differs, because that is the case that actually
    // catches people out — a night that is Thursday for the club and Friday morning for them.
    ...(same ? {} : { alsoYours: yourDay === day ? yourTime : `${yourTime}, ${yourDay}` }),
  };
}

/** The next night that is still going to happen, or null. Cancelled and skipped ones are not it. */
export function nextNight<T extends Pick<Night, 'startsAt' | 'status'>>(nights: readonly T[] | null, now: number): T | null {
  if (!nights) return null;
  return nights.find((n) => n.startsAt >= now && n.status !== 'cancelled' && n.status !== 'skipped') ?? null;
}

/** "Every Thursday at 8:00pm" — a recurrence as the sentence a host would say. */
export function scheduleLine(s: { startLocal: string; recurrence: Recurrence } | null): string {
  if (!s) return 'No nights are scheduled.';
  const time = s.startLocal;
  const r = s.recurrence;
  const named: Record<string, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
  const list = (days: readonly string[]): string => {
    const words = days.map((d) => named[d] ?? d);
    if (words.length === 1) return words[0] as string;
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  };
  const ordinal: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last' };
  switch (r.kind) {
    case 'once':
      return `Once, at ${time}.`;
    case 'weekly': {
      const every = !r.interval || r.interval === 1 ? 'Every' : r.interval === 2 ? 'Every other' : `Every ${r.interval}`;
      const weeks = !r.interval || r.interval <= 2 ? '' : ' weeks on';
      return `${every}${weeks} ${list(r.weekdays)} at ${time}.`;
    }
    case 'monthly-nth':
      return `The ${ordinal[String(r.nth)] ?? String(r.nth)} ${named[r.weekday] ?? r.weekday} of the month, at ${time}.`;
  }
}

/** The recurrence shapes this client can draw. Mirrors the protocol's, which is the authority. */
export type Recurrence =
  | { kind: 'once' }
  | { kind: 'weekly'; weekdays: string[]; interval?: 1 | 2 | 3 | 4 }
  | { kind: 'monthly-nth'; weekday: string; nth: 1 | 2 | 3 | 4 | -1 };
