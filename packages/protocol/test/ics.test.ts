/**
 * The calendar feed, checked against the rules that are quietly wrong until somebody's club has a
 * comma in its name.
 */
import { describe, expect, it } from 'vitest';
import { icsCalendar, icsEscape, icsFold, icsInstant } from '../src/ics';

const THURSDAY = Date.UTC(2026, 2, 13, 2, 0); // 2026-03-12 20:00 America/Denver

const feed = (over: Partial<Parameters<typeof icsCalendar>[0]> = {}): string =>
  icsCalendar({
    name: 'Thursday Night',
    domain: 'poker.faithnet.io',
    now: Date.UTC(2026, 0, 1),
    nights: [{ nightId: 'n1', startsAt: THURSDAY, title: 'Thursday Night' }],
    ...over,
  });

describe('the shape every calendar expects', () => {
  it('is a VCALENDAR of VEVENTs, CRLF throughout', () => {
    const out = feed();
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // LF-only is rejected outright by some clients and silently mis-parsed by others.
    expect(out.split('\r\n').length).toBeGreaterThan(5);
    expect(/[^\r]\n/.test(out)).toBe(false);
  });

  it('PUBLISHes rather than REQUESTs — this is a feed, not a meeting demanding a reply', () => {
    // REQUEST makes clients show accept/decline buttons that would send replies nobody reads.
    expect(feed()).toContain('METHOD:PUBLISH');
    expect(feed()).not.toContain('METHOD:REQUEST');
  });

  it('gives each night a UID scoped to the deployment, so re-reading updates rather than duplicates', () => {
    expect(feed()).toContain('UID:n1@poker.faithnet.io');
  });

  it('writes instants in UTC, needing no VTIMEZONE to interpret', () => {
    expect(icsInstant(THURSDAY)).toBe('20260313T020000Z');
    expect(feed()).toContain('DTSTART:20260313T020000Z');
    expect(feed()).not.toContain('VTIMEZONE');
  });

  it('blocks out three hours by default, and takes a length when one is known', () => {
    expect(feed()).toContain('DTEND:20260313T050000Z');
    expect(feed({ nights: [{ nightId: 'n1', startsAt: THURSDAY, title: 'x', minutes: 60 }] })).toContain('DTEND:20260313T030000Z');
  });

  it('carries the link that opens the game', () => {
    expect(feed({ nights: [{ nightId: 'n1', startsAt: THURSDAY, title: 'x', url: 'https://poker.faithnet.io/#/clubs/c1' }] })).toContain(
      'URL:https://poker.faithnet.io/#/clubs/c1',
    );
  });
});

describe('a night that was called off', () => {
  it('stays in the feed, struck out — dropping it takes it off a calendar with no explanation', () => {
    const out = feed({ nights: [{ nightId: 'n1', startsAt: THURSDAY, title: 'Thursday Night', status: 'cancelled' }] });
    expect(out).toContain('STATUS:CANCELLED');
    // Bumped, so a client that has already seen the event takes the update.
    expect(out).toContain('SEQUENCE:1');
    expect(out).toContain('UID:n1@poker.faithnet.io');
  });

  it('treats a skipped one the same way, because both mean "not happening"', () => {
    expect(feed({ nights: [{ nightId: 'n1', startsAt: THURSDAY, title: 'x', status: 'skipped' }] })).toContain('STATUS:CANCELLED');
  });

  it('confirms the ones that are happening', () => {
    expect(feed()).toContain('STATUS:CONFIRMED');
  });
});

describe('escaping, which is wrong until somebody has a comma in their club name', () => {
  it('escapes the four characters RFC 5545 reserves, backslash first', () => {
    expect(icsEscape('Tuesday, Thursday & Co.')).toBe('Tuesday\\, Thursday & Co.');
    expect(icsEscape('a;b')).toBe('a\;b');
    expect(icsEscape('a\\b')).toBe('a\\\\b');
    expect(icsEscape('one\ntwo')).toBe('one\\ntwo');
    // Backslash first, or the escapes escape each other: `\,` must not become `\\,`.
    expect(icsEscape('a\\,b')).toBe('a\\\\\\,b');
  });

  it('escapes a real club name inside the file', () => {
    expect(feed({ name: 'Tuesday, Thursday' })).toContain('X-WR-CALNAME:Tuesday\\, Thursday');
  });
});

describe('folding, which is octets and not characters', () => {
  it('leaves a short line alone', () => {
    expect(icsFold('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds a long one with a leading space on each continuation', () => {
    const folded = icsFold(`SUMMARY:${'a'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true);
    // Unfolding gives back exactly what went in.
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(`SUMMARY:${'a'.repeat(200)}`);
  });

  it('never splits a multi-byte character down the middle', () => {
    // Counting CHARACTERS here produces a file that fails to parse the first time a club has an
    // accent or an emoji in its name.
    const line = `SUMMARY:${'é'.repeat(80)}`;
    const folded = icsFold(line);
    const back = folded
      .split('\r\n')
      .map((p, i) => (i === 0 ? p : p.slice(1)))
      .join('');
    expect(back).toBe(line);
    for (const p of folded.split('\r\n')) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
  });

  it('folds emoji without corrupting them', () => {
    const line = `SUMMARY:${'🂡'.repeat(40)}`;
    const back = icsFold(line)
      .split('\r\n')
      .map((p, i) => (i === 0 ? p : p.slice(1)))
      .join('');
    expect(back).toBe(line);
  });
});

describe('a whole club’s feed', () => {
  it('holds every night, in order, each one findable by its own id', () => {
    const nights = [0, 7, 14].map((d) => ({ nightId: `n${d}`, startsAt: THURSDAY + d * 86_400_000, title: 'Thursday Night' }));
    const out = feed({ nights });
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    for (const n of nights) expect(out).toContain(`UID:${n.nightId}@poker.faithnet.io`);
    expect(out.indexOf('UID:n0@')).toBeLessThan(out.indexOf('UID:n14@'));
  });

  it('is still a valid empty calendar when the club has no nights', () => {
    const out = feed({ nights: [] });
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).not.toContain('BEGIN:VEVENT');
  });
});
