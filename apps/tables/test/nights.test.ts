/**
 * WHEN A CLUB MEETS — the schedule, and the nights it comes to.
 *
 * The pure half is tested in `packages/protocol` (the wall clock, the recurrence, ten years of
 * Thursdays). What is tested here is the half that has state and callers: who may set a schedule, who
 * may only read it, what a materialised night is, and the two promises that make a calendar
 * trustworthy — that running the materialiser again changes nothing, and that a rule being edited does
 * not silently move or delete a night people were already told about.
 *
 * See `docs/WORKSPACES.md` §7.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ClubSchedule, Night } from '@pokernight/protocol';
import { createClubViaHttp, devSession } from './helpers.js';

async function req(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
}

const setSchedule = (club: string, body: unknown, token: string) => req(`/clubs/${club}/schedule`, { method: 'PUT', body: JSON.stringify(body) }, token);
const getNights = (club: string, token: string, q = '') => req(`/clubs/${club}/nights${q}`, {}, token);

/** Every Thursday at eight in Denver, starting on a Thursday. */
const THURSDAYS = {
  startLocal: '20:00',
  timezone: 'America/Denver',
  recurrence: { kind: 'weekly', weekdays: ['thu'] },
  defaults: { title: 'Thursday Night', seatCap: 8, game: 'poker' },
};

/** A club, its host, and somebody on the roster who is not. */
async function clubWithMember(): Promise<{ club: string; host: { token: string; playerId: string }; member: { token: string; playerId: string } }> {
  const host = await devSession(`night host ${crypto.randomUUID().slice(0, 6)}`);
  const member = await devSession(`night member ${crypto.randomUUID().slice(0, 6)}`);
  const club = await createClubViaHttp(host.token, 'Thursday Night');
  const added = await req(`/clubs/${club.clubId}/members`, { method: 'POST', body: JSON.stringify({ member: member.playerId, name: 'Marcus' }) }, host.token);
  if (added.status !== 201) throw new Error(`add failed: ${added.status}`);
  return { club: club.clubId, host, member };
}

describe('who may set when the club meets', () => {
  it('needs a session', async () => {
    const { club } = await clubWithMember();
    expect((await setSchedule(club, THURSDAYS, '')).status).toBe(401);
  });

  it('is 404 to a stranger — the same answer a club that does not exist gives', async () => {
    const { club } = await clubWithMember();
    const stranger = await devSession('night stranger');
    const res = await setSchedule(club, THURSDAYS, stranger.token);
    expect(res.status).toBe(404);
    const missing = await setSchedule(crypto.randomUUID(), THURSDAYS, stranger.token);
    expect(await res.json()).toEqual(await missing.json());
  });

  it('is 403 BY NAME to a member — they can see the club, so who may set it leaks nothing', async () => {
    const { club, member } = await clubWithMember();
    const res = await setSchedule(club, THURSDAYS, member.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/only a host/i);
  });

  it('lets a MEMBER read it, because that is what it is for', async () => {
    const { club, host, member } = await clubWithMember();
    expect((await setSchedule(club, THURSDAYS, host.token)).status).toBe(200);
    const res = await req(`/clubs/${club}/schedule`, {}, member.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { schedule: ClubSchedule }).schedule.startLocal).toBe('20:00');
  });
});

describe('setting one materialises the nights', () => {
  it('fills the horizon at once, so there is something to invite people to', async () => {
    const { club, host } = await clubWithMember();
    const res = await setSchedule(club, THURSDAYS, host.token);
    expect(res.status).toBe(200);
    const { nights } = (await res.json()) as { nights: Night[] };
    // Eight is the horizon: a couple of months of a weekly game.
    expect(nights).toHaveLength(8);
    expect(nights.every((n) => n.status === 'scheduled')).toBe(true);
    // In order, in the future, and every one of them a Thursday at eight in Denver.
    for (let i = 1; i < nights.length; i++) expect(nights[i]!.startsAt).toBeGreaterThan(nights[i - 1]!.startsAt);
    for (const n of nights) {
      expect(n.startsAt).toBeGreaterThan(Date.now());
      expect(n.startLocal).toBe('20:00');
      expect(n.timezone).toBe('America/Denver');
      expect(new Date(n.startsAt).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short' })).toBe('Thu');
    }
  });

  it('carries the schedule’s defaults onto each night', async () => {
    const { club, host } = await clubWithMember();
    const { nights } = (await (await setSchedule(club, THURSDAYS, host.token)).json()) as { nights: Night[] };
    expect(nights[0]).toMatchObject({ title: 'Thursday Night', seatCap: 8, game: 'poker' });
  });

  it('is IDEMPOTENT — reading the nights again materialises nothing new', async () => {
    // The whole reason `(scheduleId, localDate)` is the key: a daily alarm and every read can both
    // run the materialiser without coordinating, and neither creates a duplicate Thursday.
    const { club, host } = await clubWithMember();
    await setSchedule(club, THURSDAYS, host.token);
    const first = (await (await getNights(club, host.token, '?limit=20')).json()) as { nights: Night[] };
    const again = (await (await getNights(club, host.token, '?limit=20')).json()) as { nights: Night[] };
    expect(again.nights.map((n) => n.nightId)).toEqual(first.nights.map((n) => n.nightId));
    expect(new Set(first.nights.map((n) => n.localDate)).size).toBe(first.nights.length);
  });
});

describe('editing the rule does not rewrite what people were told', () => {
  it('keeps the nights the old schedule made, rather than moving them', async () => {
    // A night somebody has been told about is theirs as much as the host's. Changing a recurrence is
    // not a reason for their Thursday to quietly become a Tuesday.
    const { club, host } = await clubWithMember();
    const before = (await (await setSchedule(club, THURSDAYS, host.token)).json()) as { nights: Night[] };
    const thursday = before.nights[0] as Night;

    const after = (await (
      await setSchedule(club, { ...THURSDAYS, recurrence: { kind: 'weekly', weekdays: ['tue'] } }, host.token)
    ).json()) as { nights: Night[] };

    // The original Thursday is still there, at the same instant, under the same id.
    const kept = after.nights.find((n) => n.nightId === thursday.nightId);
    expect(kept).toBeDefined();
    expect(kept?.startsAt).toBe(thursday.startsAt);
    // …and Tuesdays have appeared alongside it.
    expect(after.nights.some((n) => n.localDate !== thursday.localDate)).toBe(true);
  });

  it('leaves the nights alone when the schedule is withdrawn altogether', async () => {
    const { club, host } = await clubWithMember();
    const before = (await (await setSchedule(club, THURSDAYS, host.token)).json()) as { nights: Night[] };
    expect((await req(`/clubs/${club}/schedule`, { method: 'DELETE' }, host.token)).status).toBe(200);
    const after = (await (await getNights(club, host.token, '?limit=20')).json()) as { nights: Night[] };
    expect(after.nights.map((n) => n.nightId)).toEqual(before.nights.map((n) => n.nightId));
    expect(((await (await req(`/clubs/${club}/schedule`, {}, host.token)).json()) as { schedule: unknown }).schedule).toBeNull();
  });
});

describe('calling a night off', () => {
  it('marks it CANCELLED and keeps the row, so the materialiser cannot put it back', async () => {
    const { club, host } = await clubWithMember();
    const { nights } = (await (await setSchedule(club, THURSDAYS, host.token)).json()) as { nights: Night[] };
    const target = nights[1] as Night;

    const res = await req(`/clubs/${club}/nights/${target.nightId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'the hall is booked' }) }, host.token);
    expect(res.status).toBe(200);
    expect((await res.json()) as { night: Night }).toMatchObject({ night: { status: 'cancelled', reason: 'the hall is booked' } });

    // Still listed — deleting it would let the materialiser recreate it, since the date is the identity.
    const after = (await (await getNights(club, host.token, '?limit=20')).json()) as { nights: Night[] };
    const found = after.nights.find((n) => n.nightId === target.nightId);
    expect(found?.status).toBe('cancelled');
  });

  it('tells SKIPPED from CANCELLED, because they are different things', async () => {
    // The schedule generated this one and the host removed just it, versus the host called it off.
    // Both stop the night; only one is a thing that happened to the people who were coming.
    const { club, host } = await clubWithMember();
    const { nights } = (await (await setSchedule(club, THURSDAYS, host.token)).json()) as { nights: Night[] };
    const res = await req(`/clubs/${club}/nights/${nights[2]!.nightId}/cancel`, { method: 'POST', body: JSON.stringify({ skip: true }) }, host.token);
    expect(((await res.json()) as { night: Night }).night.status).toBe('skipped');
  });

  it('is a host’s act — a member is refused by name', async () => {
    const { club, host, member } = await clubWithMember();
    const { nights } = (await (await setSchedule(club, THURSDAYS, host.token)).json()) as { nights: Night[] };
    const res = await req(`/clubs/${club}/nights/${nights[0]!.nightId}/cancel`, { method: 'POST', body: '{}' }, member.token);
    expect(res.status).toBe(403);
  });

  it('404s on a night that is not this club’s', async () => {
    const { club, host } = await clubWithMember();
    await setSchedule(club, THURSDAYS, host.token);
    expect((await req(`/clubs/${club}/nights/${crypto.randomUUID()}/cancel`, { method: 'POST', body: '{}' }, host.token)).status).toBe(404);
  });
});

describe('it refuses a rule it cannot honour, by name', () => {
  const bad = async (body: unknown, match: RegExp) => {
    const { club, host } = await clubWithMember();
    const res = await setSchedule(club, body, host.token);
    expect(res.status).toBe(400);
    const said = JSON.stringify(await res.json());
    expect(said).toMatch(match);
  };

  it('will not take a zone it does not know', () => bad({ ...THURSDAYS, timezone: 'Mars/Olympus' }, /time zone/i));
  it('will not take a time that is not one', () => bad({ ...THURSDAYS, startLocal: '8pm' }, /bad request|not a time/i));
  it('will not take a frequency this card room does not run', () => bad({ ...THURSDAYS, recurrence: { kind: 'daily' } }, /bad request|recurrence/i));
  it('will not take a weekly rule with no days', () => bad({ ...THURSDAYS, recurrence: { kind: 'weekly', weekdays: [] } }, /bad request|weekday/i));
});
