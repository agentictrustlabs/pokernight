/**
 * When a night is, said to somebody who may not be where the club is.
 */
import { describe, expect, it } from 'vitest';
import { dayOf, nextNight, nightWhen, scheduleLine, timeOf, whenPhrase } from './nights';

const DENVER = 'America/Denver';
/** 2026-03-12 20:00 in Denver — a Thursday, after the US clocks have gone forward. */
const THURSDAY = Date.UTC(2026, 2, 13, 2, 0);

describe('the club’s own clock', () => {
  it('names the day and the time where the club is', () => {
    expect(dayOf(THURSDAY, DENVER)).toBe('Thursday 12 March');
    expect(timeOf(THURSDAY, DENVER)).toBe('8:00pm');
  });

  it('shows the reader their own time when it differs — the eight-hour miss', () => {
    // Eight in Denver is two in the morning in London, the NEXT day. Showing only the club's clock is
    // how somebody misses a game entirely; showing only the reader's is how they turn up at the wrong
    // hour and blame the club.
    const w = nightWhen({ startsAt: THURSDAY, timezone: DENVER }, THURSDAY - 86_400_000, 'Europe/London');
    expect(w.day).toBe('Thursday 12 March');
    expect(w.time).toBe('8:00pm');
    expect(w.alsoYours).toBe('2:00am, Friday 13 March');
  });

  it('says nothing extra when the reader is in the club’s own zone', () => {
    // Repeating the same time twice reads as a mistake.
    const w = nightWhen({ startsAt: THURSDAY, timezone: DENVER }, THURSDAY - 86_400_000, DENVER);
    expect(w.alsoYours).toBeUndefined();
  });

  it('gives just the time when the reader’s day is the same but the clock is not', () => {
    const w = nightWhen({ startsAt: THURSDAY, timezone: DENVER }, THURSDAY - 86_400_000, 'America/New_York');
    expect(w.alsoYours).toBe('10:00pm');
  });
});

describe('how far off it is, in days the night owns', () => {
  const at = (h: number) => THURSDAY - h * 3600_000;

  it('is TONIGHT all day on the day, not only within 24 hours', () => {
    // Eleven in the morning is nine hours before an eight o'clock game and both are "tonight".
    // Counting elapsed hours calls that "tomorrow", at exactly the time of day people are looking.
    expect(whenPhrase(THURSDAY, at(9), DENVER)).toBe('tonight');
    expect(whenPhrase(THURSDAY, at(1), DENVER)).toBe('tonight');
    expect(whenPhrase(THURSDAY, at(20), DENVER)).toBe('tonight');
  });

  it('is TOMORROW the day before, even when that is more than 24 hours off', () => {
    expect(whenPhrase(THURSDAY, at(26), DENVER)).toBe('tomorrow');
  });

  it('counts days, then weeks', () => {
    expect(whenPhrase(THURSDAY, THURSDAY - 3 * 86_400_000, DENVER)).toBe('in 3 days');
    expect(whenPhrase(THURSDAY, THURSDAY - 9 * 86_400_000, DENVER)).toBe('next week');
    expect(whenPhrase(THURSDAY, THURSDAY - 21 * 86_400_000, DENVER)).toBe('in 3 weeks');
  });

  it('says a night that has started is under way, not "in 0 days"', () => {
    expect(whenPhrase(THURSDAY, THURSDAY + 60_000, DENVER)).toBe('under way');
  });
});

describe('the next night', () => {
  const n = (startsAt: number, status = 'scheduled') => ({ startsAt, status }) as never;

  it('is the soonest one still going to happen', () => {
    const now = THURSDAY - 86_400_000;
    expect(nextNight([n(THURSDAY), n(THURSDAY + 7 * 86_400_000)], now)).toMatchObject({ startsAt: THURSDAY });
  });

  it('is not a cancelled or skipped one — those are not nights to turn up to', () => {
    const now = THURSDAY - 86_400_000;
    const later = THURSDAY + 7 * 86_400_000;
    expect(nextNight([n(THURSDAY, 'cancelled'), n(later)], now)).toMatchObject({ startsAt: later });
    expect(nextNight([n(THURSDAY, 'skipped'), n(later)], now)).toMatchObject({ startsAt: later });
  });

  it('is null when there is nothing ahead, and null before anything has been read', () => {
    expect(nextNight([n(THURSDAY)], THURSDAY + 1)).toBeNull();
    expect(nextNight(null, THURSDAY)).toBeNull();
  });
});

describe('the rule, as a sentence', () => {
  it('says every Thursday', () => {
    expect(scheduleLine({ startLocal: '20:00', recurrence: { kind: 'weekly', weekdays: ['thu'] } })).toBe('Every Thursday at 20:00.');
  });

  it('says two days the way a person would', () => {
    expect(scheduleLine({ startLocal: '19:00', recurrence: { kind: 'weekly', weekdays: ['tue', 'thu'] } })).toBe(
      'Every Tuesday and Thursday at 19:00.',
    );
  });

  it('says every other week, and every three', () => {
    expect(scheduleLine({ startLocal: '20:00', recurrence: { kind: 'weekly', weekdays: ['thu'], interval: 2 } })).toBe(
      'Every other Thursday at 20:00.',
    );
    expect(scheduleLine({ startLocal: '20:00', recurrence: { kind: 'weekly', weekdays: ['thu'], interval: 3 } })).toBe(
      'Every 3 weeks on Thursday at 20:00.',
    );
  });

  it('says the last Friday of the month', () => {
    expect(scheduleLine({ startLocal: '20:00', recurrence: { kind: 'monthly-nth', weekday: 'fri', nth: -1 } })).toBe(
      'The last Friday of the month, at 20:00.',
    );
    expect(scheduleLine({ startLocal: '20:00', recurrence: { kind: 'monthly-nth', weekday: 'fri', nth: 1 } })).toBe(
      'The first Friday of the month, at 20:00.',
    );
  });

  it('says so plainly when there is no rule at all', () => {
    expect(scheduleLine(null)).toBe('No nights are scheduled.');
  });
});
