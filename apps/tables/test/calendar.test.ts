/**
 * THE CALENDAR FEED, and the authority a URL carries.
 *
 * A calendar client fetches this from a phone with no session and no way to be prompted, so the URL
 * is the credential. Everything worth testing is about what that token can and cannot do: it names a
 * person, it is scoped to one club, it cannot be forged, and it stops working the moment that person
 * is no longer a member — because membership is checked on every fetch rather than baked in.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createClubViaHttp, devSession } from './helpers.js';

async function req(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
}

const THURSDAYS = {
  startLocal: '20:00',
  timezone: 'America/Denver',
  recurrence: { kind: 'weekly', weekdays: ['thu'] },
  defaults: { title: 'Thursday Night', game: 'texas-holdem' },
};

/** A club with a schedule, its host, and a member. */
async function club(): Promise<{ id: string; host: { token: string; playerId: string }; member: { token: string; playerId: string } }> {
  const host = await devSession(`cal host ${crypto.randomUUID().slice(0, 6)}`);
  const member = await devSession(`cal member ${crypto.randomUUID().slice(0, 6)}`);
  const made = await createClubViaHttp(host.token, 'Thursday Night');
  await req(`/clubs/${made.clubId}/members`, { method: 'POST', body: JSON.stringify({ member: member.playerId, name: 'Marcus' }) }, host.token);
  await req(`/clubs/${made.clubId}/schedule`, { method: 'PUT', body: JSON.stringify(THURSDAYS) }, host.token);
  return { id: made.clubId, host, member };
}

const feedUrl = async (id: string, token: string): Promise<string> =>
  ((await (await req(`/clubs/${id}/calendar`, {}, token)).json()) as { url: string }).url;

describe('getting a subscription URL', () => {
  it('is a MEMBER’s to have, not only a host’s', async () => {
    const { id, member } = await club();
    const res = await req(`/clubs/${id}/calendar`, {}, member.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; webcal: string };
    expect(body.url).toMatch(/\/calendar\/.+\.ics$/);
    // `webcal:` is what makes a phone offer to SUBSCRIBE rather than import once — the difference
    // between a calendar that keeps up with the club and eight events frozen at download.
    expect(body.webcal.startsWith('webcal:')).toBe(true);
  });

  it('is 404 to a stranger, like everything else about a club', async () => {
    const { id } = await club();
    const stranger = await devSession('cal stranger');
    expect((await req(`/clubs/${id}/calendar`, {}, stranger.token)).status).toBe(404);
  });

  it('gives each person their OWN token, so one that leaks names one person', async () => {
    const { id, host, member } = await club();
    expect(await feedUrl(id, host.token)).not.toBe(await feedUrl(id, member.token));
  });

  it('is stable, so a subscription keeps working', async () => {
    const { id, member } = await club();
    expect(await feedUrl(id, member.token)).toBe(await feedUrl(id, member.token));
  });
});

describe('fetching the feed', () => {
  it('needs no session at all — that is the whole point', async () => {
    const { id, member } = await club();
    const url = new URL(await feedUrl(id, member.token));
    const res = await SELF.fetch(`http://tables.test${url.pathname}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/calendar/);
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('SUMMARY:Thursday Night');
  });

  it('carries a link that opens the game', async () => {
    const { id, member } = await club();
    const url = new URL(await feedUrl(id, member.token));
    const body = await (await SELF.fetch(`http://tables.test${url.pathname}`)).text();
    expect(body).toMatch(new RegExp(`URL:.*#/clubs/${id}`));
  });

  it('is never cached in between — a night called off has to reach a subscriber', async () => {
    const { id, member } = await club();
    const url = new URL(await feedUrl(id, member.token));
    expect((await SELF.fetch(`http://tables.test${url.pathname}`)).headers.get('cache-control')).toBe('no-store');
  });

  it('shows a cancelled night as CANCELLED rather than dropping it', async () => {
    // Dropping it takes the night off somebody's calendar with no explanation, which is how people
    // turn up to an empty room.
    const { id, host, member } = await club();
    const nights = (await (await req(`/clubs/${id}/nights`, {}, host.token)).json()) as { nights: { nightId: string }[] };
    await req(`/clubs/${id}/nights/${nights.nights[0]!.nightId}/cancel`, { method: 'POST', body: '{}' }, host.token);
    const url = new URL(await feedUrl(id, member.token));
    const body = await (await SELF.fetch(`http://tables.test${url.pathname}`)).text();
    expect(body).toContain('STATUS:CANCELLED');
    expect(body).toContain(`UID:${nights.nights[0]!.nightId}@`);
  });
});

describe('what the token cannot do', () => {
  it('is refused when tampered with', async () => {
    const { id, member } = await club();
    const url = new URL(await feedUrl(id, member.token));
    const bad = url.pathname.replace(/(.)(\.ics)$/, (_m, _c, ext) => `X${ext}`);
    expect((await SELF.fetch(`http://tables.test${bad}`)).status).toBe(404);
  });

  it('does not work on a DIFFERENT club — it is scoped to one', async () => {
    const a = await club();
    const b = await club();
    const url = new URL(await feedUrl(a.id, a.member.token));
    const swapped = url.pathname.replace(a.id, b.id);
    expect((await SELF.fetch(`http://tables.test${swapped}`)).status).toBe(404);
  });

  it('STOPS ANSWERING once that person is no longer a member', async () => {
    // The property that makes a bearer URL acceptable here: it is not a capability that outlives
    // membership. Nothing is revoked and nothing is remembered — the club is asked every fetch.
    const { id, host, member } = await club();
    const url = new URL(await feedUrl(id, member.token));
    expect((await SELF.fetch(`http://tables.test${url.pathname}`)).status).toBe(200);

    const removed = await req(`/clubs/${id}/members/${encodeURIComponent(member.playerId)}`, { method: 'DELETE' }, host.token);
    expect(removed.status).toBe(200);

    expect((await SELF.fetch(`http://tables.test${url.pathname}`)).status).toBe(404);
  });

  it('is 404 for a club that does not exist, the same as for one you are not in', async () => {
    const { id, member } = await club();
    const url = new URL(await feedUrl(id, member.token));
    const elsewhere = url.pathname.replace(id, crypto.randomUUID());
    expect((await SELF.fetch(`http://tables.test${elsewhere}`)).status).toBe(404);
  });
});
