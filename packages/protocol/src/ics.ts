/**
 * A CALENDAR FEED — the club's nights, in the one format every calendar reads.
 *
 * WHY A FEED OF DISCRETE EVENTS RATHER THAN ONE RRULE. The obvious shape is a single recurring event
 * carrying `RRULE:FREQ=WEEKLY;BYDAY=TH`, and it is the wrong one here for three reasons:
 *
 *   The nights are already MATERIALISED, each with an instant resolved once and pinned. Emitting an
 *   RRULE would ask every calendar client in the world to re-derive those instants from a rule and a
 *   zone — and they do not all agree with each other, or with us, across a daylight-saving boundary.
 *   Sending the answers instead of the question removes a whole class of "my calendar says seven".
 *
 *   A cancelled night is a FACT, not an absence. With an RRULE it would need an EXDATE, and a skipped
 *   one another; as discrete events it is `STATUS:CANCELLED`, which every client shows as a struck-out
 *   entry rather than silently removing — so somebody who was coming finds out.
 *
 *   A recurring event with a TZID needs a VTIMEZONE block with its own transition rules, which is a
 *   second copy of the tz database inside an .ics file and a well-known source of bugs. Discrete
 *   events in UTC need none of it: the instant is the instant.
 *
 * The feed is meant to be SUBSCRIBED to, not downloaded once — that is what makes it recurring in
 * practice. A client re-fetches it, and nights added, moved or cancelled since simply appear.
 *
 * Everything here is pure text assembly, which is why it is here and not in the Worker: the escaping
 * and folding rules in RFC 5545 are exactly the sort of thing that is quietly wrong until somebody
 * puts a comma in a club name.
 */

export interface CalendarNight {
  nightId: string;
  startsAt: number;
  /** How long to block out. Nobody knows when a poker night ends; three hours is the polite guess. */
  minutes?: number;
  title: string;
  description?: string;
  /** Where the game is — a link that opens it. */
  url?: string;
  /** `cancelled` and `skipped` both become STATUS:CANCELLED; the rest are confirmed. */
  status?: string;
}

/** Three hours: long enough to mean "the evening", short enough not to swallow the next day. */
const DEFAULT_MINUTES = 180;

/**
 * RFC 5545 text escaping. Backslash first, or the escapes escape each other.
 *
 * A club called "Tuesday, Thursday & Co." is not exotic, and an unescaped comma in a SUMMARY silently
 * truncates it in some clients and breaks the file in others.
 */
export function icsEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * Fold a line at 75 OCTETS, not 75 characters.
 *
 * The difference matters the moment a club name has an emoji or an accent in it: counting characters
 * splits a multi-byte sequence down the middle and produces a file that fails to parse. Continuation
 * lines begin with a single space, which the reader strips.
 */
export function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // 75 on the first line, 74 on the rest — the leading space counts toward the octet limit.
    const limit = out.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    // Never split a UTF-8 sequence: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] as number) >= 0x80 && (bytes[end] as number) < 0xc0) end--;
    out.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
  }
  return out.join('\r\n ');
}

/** `20260313T020000Z` — the only date form that needs no VTIMEZONE and no interpretation. */
export function icsInstant(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * The whole feed.
 *
 * `PUBLISH` rather than `REQUEST`: this is a calendar somebody chose to follow, not a meeting request
 * demanding an answer. `REQUEST` makes clients show accept/decline buttons that would send replies
 * nobody is listening for — answering a night happens in the card room, not in a mail client.
 */
export function icsCalendar(opts: {
  /** The club's name — what the calendar is called in a subscription list. */
  name: string;
  description?: string;
  nights: readonly CalendarNight[];
  /** The domain UIDs are scoped to, so two deployments never collide in one person's calendar. */
  domain: string;
  now?: number;
}): string {
  const stamp = icsInstant(opts.now ?? Date.now());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Poker Night//Club Nights//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    // Half an hour: nights change rarely, and a client that re-reads too eagerly is a client somebody
    // turns off. Advisory in every implementation, which is why it is a hint and not a promise.
    'X-PUBLISHED-TTL:PT30M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
  ];
  if (opts.description) lines.push(`X-WR-CALDESC:${icsEscape(opts.description)}`);

  for (const n of opts.nights) {
    const end = n.startsAt + (n.minutes ?? DEFAULT_MINUTES) * 60_000;
    const off = n.status === 'cancelled' || n.status === 'skipped';
    lines.push(
      'BEGIN:VEVENT',
      // Stable per night and scoped to the deployment, so re-reading the feed UPDATES the entry
      // rather than adding a second copy of the same Thursday.
      `UID:${n.nightId}@${opts.domain}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsInstant(n.startsAt)}`,
      `DTEND:${icsInstant(end)}`,
      `SUMMARY:${icsEscape(n.title)}`,
    );
    if (n.description) lines.push(`DESCRIPTION:${icsEscape(n.description)}`);
    if (n.url) lines.push(`URL:${icsEscape(n.url)}`);
    // A night that was called off stays in the feed, struck out. Dropping it would take it off
    // somebody's calendar with no explanation, which is how people turn up to an empty room.
    lines.push(`STATUS:${off ? 'CANCELLED' : 'CONFIRMED'}`);
    if (off) lines.push('SEQUENCE:1');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // CRLF, always. LF-only files are rejected outright by some clients and silently mis-parsed by others.
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
