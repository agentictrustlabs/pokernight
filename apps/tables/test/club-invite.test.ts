/**
 * The three ways a host names somebody, and the one that does not name them at all.
 *
 * A club roster is an authorization: whoever is on it can see a private lobby and sit at a private
 * table. So the question "who is this?" has to be answered exactly, and the shapes a host can answer
 * it in are the point of these tests:
 *
 *   an address        — always worked, and is the one a host is LEAST likely to have
 *   a playerId        — what one part of this service calls another
 *   an agent name     — `carol.me`, resolved on chain; the way people actually know each other
 *   an email          — names nobody, so it opens a pending invitation and grants nothing until
 *                       somebody signs in and claims it
 *
 * The fourth is the interesting one, and the rule it holds is that AN INVITATION IS NOT A MEMBERSHIP:
 * a club with an outstanding invitation has exactly the standing it had before, for everybody.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ClubInvite, ClubSummary, ClubView, InviteGreeting, KnownPerson } from '@pokernight/protocol';
import { createClubViaHttp, devSession } from './helpers.js';

async function get(path: string, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function del(path: string, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, {
    method: 'DELETE',
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
}

async function hostWithClub(name = 'Friday Group'): Promise<{ club: ClubSummary; host: { token: string; playerId: string } }> {
  const host = await devSession(`host ${crypto.randomUUID().slice(0, 6)}`);
  return { club: await createClubViaHttp(host.token, name), host };
}

/** Send one invitation and hand back what the host was told. */
async function invite(club: string, token: string, email: string, name?: string) {
  const res = await post(`/clubs/${club}/invites`, { email, ...(name ? { name } : {}) }, token);
  const body = (await res.json()) as { invite?: ClubInvite; joinUrl?: string; delivery?: string; deliveryError?: string; error?: string };
  return { status: res.status, ...body };
}

/* ------------------------------------------------------------- by what you know */

describe('adding somebody by an identifier', () => {
  it('takes a playerId and an address, which is what it always did', async () => {
    const { club, host } = await hostWithClub();
    const friend = await devSession('friend');
    expect((await post(`/clubs/${club.clubId}/members`, { member: friend.playerId }, host.token)).status).toBe(201);
    const addr = `0x${'ab'.repeat(20)}`;
    expect((await post(`/clubs/${club.clubId}/members`, { member: addr, name: 'Marcus' }, host.token)).status).toBe(201);
  });

  it('says an EMAIL is not an identifier, and says what to do instead', async () => {
    const { club, host } = await hostWithClub();
    const res = await post(`/clubs/${club.clubId}/members`, { member: 'marcus@example.com' }, host.token);
    expect(res.status).toBe(400);
    // The refusal has to carry the alternative. "That is not an address" alone is a dead end, and it
    // is exactly what a host who typed the one identifier they had was told for a month.
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/send them an invitation/i);
  });

  it('refuses an AGENT NAME where no registry is wired, saying so rather than guessing', async () => {
    // Dev has no naming contracts configured. The honest answer is that this deployment cannot look
    // names up — not a 404 that reads as "no such person", which would be a claim about Carol.
    const { club, host } = await hostWithClub();
    const res = await post(`/clubs/${club.clubId}/members`, { member: 'carol.me' }, host.token);
    expect(res.status).toBe(400);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/cannot look up agent names/i);
  });

  it('still refuses a shape that is nobody at all', async () => {
    const { club, host } = await hostWithClub();
    const res = await post(`/clubs/${club.clubId}/members`, { member: 'marcus' }, host.token);
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------- by email */

describe('inviting by email', () => {
  it('is a HOST’s doing — a member cannot invite, and a stranger cannot see the club', async () => {
    const { club, host } = await hostWithClub();
    const friend = await devSession('friend');
    await post(`/clubs/${club.clubId}/members`, { member: friend.playerId }, host.token);
    expect((await invite(club.clubId, friend.token, 'someone@example.com')).status).toBe(403);
    const stranger = await devSession('stranger');
    expect((await invite(club.clubId, stranger.token, 'someone@example.com')).status).toBe(404);
    expect((await invite(club.clubId, undefined as unknown as string, 'someone@example.com')).status).toBe(401);
  });

  it('writes the invitation and hands back a link, whatever the mailer did', async () => {
    const { club, host } = await hostWithClub();
    const sent = await invite(club.clubId, host.token, 'Marcus@Example.com', 'Marcus');
    expect(sent.status).toBe(201);
    expect(sent.invite?.email).toBe('marcus@example.com');
    expect(sent.invite?.name).toBe('Marcus');
    expect(sent.joinUrl).toContain(`/#/join/${club.clubId}/`);
    // Dev has no Home to mail through. The host is told exactly that and given the link — an
    // invitation that could not be mailed is not an invitation that was lost.
    expect(sent.delivery).toBe('not-sent');
    expect(sent.deliveryError).toBeTruthy();
  });

  it('grants NOTHING until it is claimed — the roster is unchanged and nobody has standing', async () => {
    const { club, host } = await hostWithClub();
    await invite(club.clubId, host.token, 'marcus@example.com', 'Marcus');
    const view = (await (await get(`/clubs/${club.clubId}`, host.token)).json()) as ClubView;
    expect(view.roster).toHaveLength(1);
    expect(view.members).toBe(1);
  });

  it('replaces an outstanding invitation to the same address rather than making a second', async () => {
    const { club, host } = await hostWithClub();
    const first = await invite(club.clubId, host.token, 'marcus@example.com');
    const second = await invite(club.clubId, host.token, 'marcus@example.com');
    expect(first.invite?.token).not.toBe(second.invite?.token);
    const list = (await (await get(`/clubs/${club.clubId}/invites`, host.token)).json()) as { invites: ClubInvite[] };
    expect(list.invites).toHaveLength(1);
    expect(list.invites[0]?.token).toBe(second.invite?.token);
    // …and the first link is dead, because the host meant "send it again", not "let two people in".
    expect((await get(`/clubs/${club.clubId}/invite/${first.invite?.token}`)).status).toBe(404);
  });
});

/* ------------------------------------------------------------------ claiming */

describe('opening an invitation', () => {
  it('tells whoever holds the link who invited them and to what, with NO session', async () => {
    const { club, host } = await hostWithClub('Riverside Wednesday');
    const sent = await invite(club.clubId, host.token, 'marcus@example.com');
    const res = await get(`/clubs/${club.clubId}/invite/${sent.invite?.token}`);
    expect(res.status).toBe(200);
    const greeting = (await res.json()) as InviteGreeting;
    expect(greeting.clubName).toBe('Riverside Wednesday');
    expect(greeting.state).toBe('open');
    expect(greeting.invitedByName).toBeTruthy();
    // The email is NOT echoed. Whoever holds the token has proved only that, and printing the
    // address it was sent to would print it for anybody who guessed one.
    expect(JSON.stringify(greeting)).not.toContain('marcus@example.com');
  });

  it('is not distinguishable from a token that never existed', async () => {
    const { club, host } = await hostWithClub();
    await invite(club.clubId, host.token, 'marcus@example.com');
    expect((await get(`/clubs/${club.clubId}/invite/${'0'.repeat(64)}`)).status).toBe(404);
  });

  it('puts the person who SIGNED IN on the roster, not the address it was sent to', async () => {
    const { club, host } = await hostWithClub();
    const sent = await invite(club.clubId, host.token, 'marcus@example.com', 'Marcus');
    // Anybody could have been forwarded the mail. The club gets whoever actually turned up.
    const opener = await devSession('whoever opened it');
    const claim = await post(`/clubs/${club.clubId}/invite/${sent.invite?.token}/claim`, {}, opener.token);
    expect(claim.status).toBe(201);
    const view = (await (await get(`/clubs/${club.clubId}`, opener.token)).json()) as ClubView;
    expect(view.you.standing).toBe('member');
    expect(view.roster.find((m) => m.member === opener.playerId)?.name).toBe('Marcus');
  });

  it('needs a session, because a membership has to be keyed to somebody', async () => {
    const { club, host } = await hostWithClub();
    const sent = await invite(club.clubId, host.token, 'marcus@example.com');
    expect((await post(`/clubs/${club.clubId}/invite/${sent.invite?.token}/claim`, {})).status).toBe(401);
  });

  it('is spent once: the same person may follow the link twice, a second person may not', async () => {
    const { club, host } = await hostWithClub();
    const sent = await invite(club.clubId, host.token, 'marcus@example.com');
    const marcus = await devSession('marcus');
    const path = `/clubs/${club.clubId}/invite/${sent.invite?.token}/claim`;
    expect((await post(path, {}, marcus.token)).status).toBe(201);
    // Following your own link again is not an error — it is a person pressing back.
    expect((await post(path, {}, marcus.token)).status).toBe(200);
    const other = await devSession('someone else');
    expect((await post(path, {}, other.token)).status).toBe(409);
    const greeting = (await (await get(`/clubs/${club.clubId}/invite/${sent.invite?.token}`)).json()) as InviteGreeting;
    expect(greeting.state).toBe('claimed');
  });

  it('can be taken back before it is used, and not after', async () => {
    const { club, host } = await hostWithClub();
    const sent = await invite(club.clubId, host.token, 'marcus@example.com');
    expect((await del(`/clubs/${club.clubId}/invites/${sent.invite?.token}`, host.token)).status).toBe(200);
    expect((await get(`/clubs/${club.clubId}/invite/${sent.invite?.token}`)).status).toBe(404);

    const used = await invite(club.clubId, host.token, 'elena@example.com');
    const elena = await devSession('elena');
    await post(`/clubs/${club.clubId}/invite/${used.invite?.token}/claim`, {}, elena.token);
    // A spent invitation is history. Undoing the membership is a roster removal, and says so.
    const res = await del(`/clubs/${club.clubId}/invites/${used.invite?.token}`, host.token);
    expect(res.status).toBe(409);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/remove them from the roster/i);
  });
});

/* -------------------------------------------------------- who you already play with */

describe('the people you already play with', () => {
  it('are everyone on the roster of a club you are in, minus yourself', async () => {
    const host = await devSession(`host ${crypto.randomUUID().slice(0, 6)}`);
    const marcus = await devSession('marcus');
    const elena = await devSession('elena');
    const club = await createClubViaHttp(host.token, 'Tuesday');
    await post(`/clubs/${club.clubId}/members`, { member: marcus.playerId, name: 'Marcus' }, host.token);
    await post(`/clubs/${club.clubId}/members`, { member: elena.playerId, name: 'Elena' }, host.token);

    const { people } = (await (await get('/people', host.token)).json()) as { people: KnownPerson[] };
    expect(people.map((p) => p.name)).toEqual(['Elena', 'Marcus']);
    expect(people.every((p) => p.member !== host.playerId)).toBe(true);
    expect(people[0]?.clubs).toEqual(['Tuesday']);
  });

  it('names every club you have in common with them, and only your own clubs', async () => {
    const host = await devSession(`host ${crypto.randomUUID().slice(0, 6)}`);
    const marcus = await devSession('marcus');
    for (const name of ['Tuesday', 'Thursday']) {
      const club = await createClubViaHttp(host.token, name);
      await post(`/clubs/${club.clubId}/members`, { member: marcus.playerId, name: 'Marcus' }, host.token);
    }
    // A club the caller is not in contributes nobody, however many people are in it.
    const other = await devSession('other host');
    const theirs = await createClubViaHttp(other.token, 'Someone else’s');
    await post(`/clubs/${theirs.clubId}/members`, { member: (await devSession('nobody')).playerId, name: 'Nobody' }, other.token);

    const { people } = (await (await get('/people', host.token)).json()) as { people: KnownPerson[] };
    expect(people).toHaveLength(1);
    expect(people[0]?.clubs.sort()).toEqual(['Thursday', 'Tuesday']);
  });

  it('needs a session — this answers "who do YOU play with", never "who is in this card room"', async () => {
    expect((await get('/people')).status).toBe(401);
  });
});
