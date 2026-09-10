/**
 * Clubs — membership, and the tables that belong to one.
 *
 * The property under test throughout is that STANDING IS DERIVED and that a club is invisible
 * without it. A stranger must not be able to tell a club they are not in from a club that is not
 * there, so almost every refusal in this file is a 404 rather than a 403, and the tests assert that
 * on purpose: a 403 confirms the club exists, which is a fact about other people's arrangements.
 *
 * See `docs/WORKSPACES.md` §5 and §6.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ClubSummary, ClubView, TableSummary } from '@pokernight/protocol';
import { TestClient, createClubViaHttp, createTableViaHttp, devSession, engineReady, soloClub } from './helpers.js';

const OPERATOR_TOKEN = 'test-operator-token';

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

/** A club, its host, and a member who has been admitted to it. */
async function clubWithMember(name = 'Thursday Night'): Promise<{
  club: ClubSummary;
  host: { token: string; playerId: string };
  member: { token: string; playerId: string };
}> {
  const host = await devSession(`host ${crypto.randomUUID().slice(0, 6)}`);
  const member = await devSession(`member ${crypto.randomUUID().slice(0, 6)}`);
  const club = await createClubViaHttp(host.token, name);
  const res = await post(`/clubs/${club.clubId}/members`, { member: member.playerId, name: 'Marcus' }, host.token);
  if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${await res.text()}`);
  return { club, host, member };
}

/* ---------------------------------------------------------------- starting one */

describe('starting a club', () => {
  it('needs a session — a club belongs to whoever started it, so somebody has to have', async () => {
    const res = await post('/clubs', { name: 'Nobody’s club' }, undefined);
    expect(res.status).toBe(401);
  });

  it('makes the creator its host, and puts them on the roster from the first instant', async () => {
    const host = await devSession('Barb');
    const club = await createClubViaHttp(host.token, 'Thursday Night');
    expect(club.name).toBe('Thursday Night');
    expect(club.createdBy).toBe(host.playerId);
    // One member, not zero: a club whose creator is not on its own roster answers "who is in this?"
    // one way and "what am I to it?" another, which is how two answers to one question drift apart.
    expect(club.members).toBe(1);

    const view = (await (await get(`/clubs/${club.clubId}`, host.token)).json()) as ClubView;
    expect(view.you.standing).toBe('host');
    expect(view.you.because).toContain('Thursday Night');
    expect(view.roster.map((m) => m.member)).toEqual([host.playerId]);
  });

  it('has no workspace agent yet, and does not pretend to', async () => {
    const host = await devSession('unchartered');
    const club = await createClubViaHttp(host.token, 'Unchartered');
    // The charter ceremony has not run, so there is no `.workspace` Smart Agent. The field is absent
    // rather than filled with the club id — the whole reason `clubId` is opaque and separate.
    expect(club.agent).toBeUndefined();
  });

  it('lists the clubs you are in, and nobody else’s', async () => {
    const a = await devSession('lister a');
    const b = await devSession('lister b');
    const mine = await createClubViaHttp(a.token, 'Mine');
    await createClubViaHttp(b.token, 'Theirs');

    const listed = (await (await get('/clubs', a.token)).json()) as { clubs: { clubId: string; name: string }[] };
    expect(listed.clubs.map((c) => c.name)).toEqual(['Mine']);
    expect(listed.clubs[0]?.clubId).toBe(mine.clubId);
  });

  it('has the new club in the listing the INSTANT the create answers', async () => {
    // The index write used to be fire-and-forget (`void this.indexAdd(...)`), on the reasoning that a
    // projection must never fail a membership. The reasoning is right and the `void` was not: the
    // `catch` inside is what makes it best-effort, so awaiting costs nothing and closes a real race.
    //
    // What that race broke: a new host presses "Start it", the client asks "which clubs am I in?", and
    // the club they just made is not in the answer — so the club they were sent to has no row in the
    // rail, which is the only place they can go next.
    //
    // There is no `await` between the create and the list here ON PURPOSE. This test cannot prove the
    // ordering on its own (the test pool may settle pending work between requests), but it states the
    // contract, and it is the shape a regression would have to pass.
    const host = await devSession('instant lister');
    const made = await createClubViaHttp(host.token, 'Straight away');
    const listed = (await (await get('/clubs', host.token)).json()) as { clubs: { clubId: string }[] };
    expect(listed.clubs.map((c) => c.clubId)).toContain(made.clubId);
  });
});

/* ------------------------------------------------------------------ invisibility */

describe('a club is invisible without standing', () => {
  it('answers 404 to a stranger, never 403 — a refusal would confirm it exists', async () => {
    const host = await devSession('private host');
    const stranger = await devSession('stranger');
    const club = await createClubViaHttp(host.token, 'Private');

    const res = await get(`/clubs/${club.clubId}`, stranger.token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such club' });
  });

  it('answers 404 for a club id that is not a club id at all, in the same words', async () => {
    const stranger = await devSession('shape stranger');
    expect((await get('/clubs/not-a-uuid', stranger.token)).status).toBe(404);
    expect((await get(`/clubs/${crypto.randomUUID()}`, stranger.token)).status).toBe(404);
  });

  it('will not show its roster to somebody who is not in it', async () => {
    const { club } = await clubWithMember();
    const stranger = await devSession('roster stranger');
    const res = await get(`/clubs/${club.clubId}/members`, stranger.token);
    expect(res.status).toBe(404);
  });
});

/* ---------------------------------------------------------------------- members */

describe('membership', () => {
  it('admits somebody a host names, and they can see the club from then on', async () => {
    const { club, member } = await clubWithMember();
    const view = (await (await get(`/clubs/${club.clubId}`, member.token)).json()) as ClubView;
    expect(view.you.standing).toBe('member');
    expect(view.roster.map((m) => m.name)).toContain('Marcus');
    // …and it appears in THEIR list of clubs, which is the index the club writes to.
    const listed = (await (await get('/clubs', member.token)).json()) as { clubs: { clubId: string }[] };
    expect(listed.clubs.map((c) => c.clubId)).toContain(club.clubId);
  });

  it('reads a bare Smart Agent address as the person it identifies', async () => {
    const host = await devSession('address host');
    const club = await createClubViaHttp(host.token, 'By address');
    const address = `0x${'ab'.repeat(20)}`;
    const res = await post(`/clubs/${club.clubId}/members`, { member: address, name: 'Elena' }, host.token);
    expect(res.status).toBe(201);
    const view = (await (await get(`/clubs/${club.clubId}`, host.token)).json()) as ClubView;
    expect(view.roster.map((m) => m.member)).toContain(`home:${address}`);
  });

  it('refuses somebody it cannot recognise BY NAME, rather than storing an id nothing will match', async () => {
    const host = await devSession('typo host');
    const club = await createClubViaHttp(host.token, 'Typos');
    const res = await post(`/clubs/${club.clubId}/members`, { member: 'not an identifier at all' }, host.token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('Smart Agent address');
  });

  it('will not admit the same person twice', async () => {
    const { club, host, member } = await clubWithMember();
    const again = await post(`/clubs/${club.clubId}/members`, { member: member.playerId }, host.token);
    expect(again.status).toBe(409);
  });

  it('lets a MEMBER see the roster but not change it', async () => {
    const { club, member } = await clubWithMember();
    expect((await get(`/clubs/${club.clubId}/members`, member.token)).status).toBe(200);

    const outsider = await devSession('brought along');
    const res = await post(`/clubs/${club.clubId}/members`, { member: outsider.playerId }, member.token);
    expect(res.status).toBe(403);
    // A member already knows the club exists, so this is the one case that gets a real refusal —
    // and it says which authority is missing rather than only that something was refused.
    expect(((await res.json()) as { error: string }).error).toContain('host');
  });

  it('takes a removed member’s standing away with them', async () => {
    const { club, host, member } = await clubWithMember();
    expect((await del(`/clubs/${club.clubId}/members/${member.playerId}`, host.token)).status).toBe(200);
    expect((await get(`/clubs/${club.clubId}`, member.token)).status).toBe(404);
    const listed = (await (await get('/clubs', member.token)).json()) as { clubs: { clubId: string }[] };
    expect(listed.clubs.map((c) => c.clubId)).not.toContain(club.clubId);
  });

  it('will not remove the person who started it — the way out is to retire the club', async () => {
    const { club, host } = await clubWithMember();
    const res = await del(`/clubs/${club.clubId}/members/${host.playerId}`, host.token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('retire the club');
  });

  it('expires a guest without deleting them — "she played once in March" stays answerable', async () => {
    const host = await devSession('guest host');
    const guest = await devSession('guest');
    const club = await createClubViaHttp(host.token, 'Guests');
    const added = await post(
      `/clubs/${club.clubId}/members`,
      { member: guest.playerId, name: 'Elena', class: 'guest', validUntil: Date.now() - 1000 },
      host.token,
    );
    expect(added.status).toBe(201);

    // The window has passed, so they have no standing…
    expect((await get(`/clubs/${club.clubId}`, guest.token)).status).toBe(404);
    // …and the row is still there, which is the point.
    const view = (await (await get(`/clubs/${club.clubId}`, host.token)).json()) as ClubView;
    const row = view.roster.find((m) => m.member === guest.playerId);
    expect(row?.class).toBe('guest');
    expect(row?.validUntil).toBeLessThan(Date.now());
  });
});

/* ----------------------------------------------------------------- club tables */

describe('a club’s tables', () => {
  it('stamps the club and its name onto the table, and keeps them out of the public lobby', async () => {
    const club = await soloClub('Stamped');
    const t = await createTableViaHttp('club table', {}, club);
    expect(t.club).toBe(club.club);
    expect(t.clubName).toBe('Stamped');

    const pickup = (await (await get('/tables')).json()) as TableSummary[];
    expect(pickup.map((x) => x.tableId)).not.toContain(t.tableId);
  });

  it('lets only a HOST open one', async () => {
    const { club, member } = await clubWithMember();
    const res = await post('/tables', { name: 'not yours', club: club.clubId }, member.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain('host');
  });

  it('answers 404 to a stranger opening one for a club they are not in', async () => {
    const { club } = await clubWithMember();
    const stranger = await devSession('table stranger');
    const res = await post('/tables', { name: 'not yours either', club: club.clubId }, stranger.token);
    expect(res.status).toBe(404);
  });

  it('hides the table itself from a stranger — no view, no hand history', async () => {
    const club = await soloClub('Hidden');
    const t = await createTableViaHttp('hidden', {}, club);
    const stranger = await devSession('peeker');

    expect((await get(`/tables/${t.tableId}`, stranger.token)).status).toBe(404);
    expect((await get(`/tables/${t.tableId}`)).status).toBe(404);
    expect((await get(`/tables/${t.tableId}/hands/1`, stranger.token)).status).toBe(404);
  });

  it('will not seat an agent at somebody else’s club table', async () => {
    const club = await soloClub('No bots');
    const t = await createTableViaHttp('no bots', {}, club);
    const stranger = await devSession('bot pusher');
    const res = await post(`/tables/${t.tableId}/seat-agent`, { seat: 1, buyIn: 100, agentName: 'sharkbot.svc' }, stranger.token);
    expect(res.status).toBe(404);
  });

  it('still opens a PICKUP table for anyone with a session, exactly as before', async () => {
    const anyone = await devSession('pickup opener');
    const res = await post('/tables', { name: 'pickup' }, anyone.token);
    expect(res.status).toBe(201);
    const t = (await res.json()) as TableSummary;
    expect(t.club).toBeUndefined();
    // Public: no token at all, and it is there.
    const pickup = (await (await get('/tables')).json()) as TableSummary[];
    expect(pickup.map((x) => x.tableId)).toContain(t.tableId);
  });

  it.skipIf(!engineReady)('refuses the socket to a stranger and opens it for a member', async () => {
    const { club, host, member } = await clubWithMember();
    const table = await createTableViaHttp('members only', {}, { token: host.token, club: club.clubId });
    const stranger = await devSession('socket stranger');

    // Watching a private game is being at it, so a stranger is refused the socket outright — not
    // admitted as a spectator, which is what an unauthenticated connection gets at a pickup table.
    await expect(TestClient.connect(table.tableId, stranger.token)).rejects.toThrow(/404/);
    await expect(TestClient.connect(table.tableId)).rejects.toThrow(/404/);

    const client = await TestClient.connect(table.tableId, member.token);
    client.send({ type: 'join', seat: 0, buyIn: 100 });
    await client.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 0);
    client.close();
  }, 20_000);

  it.skipIf(!engineReady)('stands a player up from a CLUB table when they sign out', async () => {
    const { club, host, member } = await clubWithMember();
    const table = await createTableViaHttp('sign-out club table', {}, { token: host.token, club: club.clubId });
    const client = await TestClient.connect(table.tableId, member.token);
    client.send({ type: 'join', seat: 0, buyIn: 100 });
    await client.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 0);

    // The sweep used to read the pickup lobby only, so this seat — and the chips on it — would have
    // survived a sign-out at a table the player could no longer reach.
    const out = (await (await post('/auth/signout', {}, member.token)).json()) as { ok: boolean; stoodUp: { tableId: string }[] };
    expect(out.ok).toBe(true);
    expect(out.stoodUp.map((s) => s.tableId)).toContain(table.tableId);

    const view = (await (await get(`/tables/${table.tableId}`, host.token)).json()) as { view: { seats: unknown[] } };
    expect(view.view.seats).toHaveLength(0);
    client.close();
  }, 20_000);

  it('lets the operator retire a club table without belonging to the club', async () => {
    const club = await soloClub('Operator reach');
    const t = await createTableViaHttp('retire from outside', {}, club);
    const res = await SELF.fetch(`http://tables.test/tables/${t.tableId}?club=${club.club}`, {
      method: 'DELETE',
      headers: { 'x-operator-token': OPERATOR_TOKEN },
    });
    expect(res.status).toBe(200);
  });
});

/* -------------------------------------------------------------------- retiring */

/**
 * RETIRING A CLUB — the host's own way out, and the route every other refusal has been pointing at.
 *
 * "The person who started a club cannot be removed from it — retire the club instead" was the answer
 * to removing a host for a long time before there was anything to retire it WITH, so a club, once
 * made, was permanent: a mistake, a test, or a group that stopped meeting stayed in its members'
 * navigation for good.
 *
 * The properties here are the same three the whole file is about — standing is derived, a club you
 * are not in is indistinguishable from one that does not exist, and nobody's money is closed out from
 * under them — plus one that is only true of this route: it does NOT touch the club's Smart Agent, and
 * it says so rather than implying it did.
 */
describe('retiring a club', () => {
  it('needs a session', async () => {
    const { club } = await clubWithMember('Retire me');
    expect((await del(`/clubs/${club.clubId}`)).status).toBe(401);
  });

  it('is 404 to a stranger — the same answer a club that does not exist gives', async () => {
    const { club } = await clubWithMember('Private');
    const stranger = await devSession('retire stranger');
    const res = await del(`/clubs/${club.clubId}`, stranger.token);
    expect(res.status).toBe(404);
    // Word for word what a made-up id answers. A 403 here would confirm the club is real.
    const missing = await del(`/clubs/${crypto.randomUUID()}`, stranger.token);
    expect(missing.status).toBe(404);
    expect(await res.json()).toEqual(await missing.json());
  });

  it('is 403 to a MEMBER, by name — they can already see the club, so who may close it leaks nothing', async () => {
    const { club, member } = await clubWithMember('Not yours to close');
    const res = await del(`/clubs/${club.clubId}`, member.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/only the person who started this club/i);
  });

  it('closes the club, and it is gone for the host and for every member alike', async () => {
    const { club, host, member } = await clubWithMember('Thursday, once');
    const res = await del(`/clubs/${club.clubId}`, host.token);
    expect(res.status).toBe(200);
    expect((await res.json()) as { retired: boolean; members: number }).toMatchObject({ retired: true, members: 2 });

    // Nobody's rail is left holding a club that answers 404 when they press it.
    for (const who of [host, member]) {
      const listed = (await (await get('/clubs', who.token)).json()) as { clubs: { clubId: string }[] };
      expect(listed.clubs.map((c) => c.clubId)).not.toContain(club.clubId);
      expect((await get(`/clubs/${club.clubId}`, who.token)).status).toBe(404);
    }
  });

  it('takes the club’s tables with it — a private table nobody can list is worse than none', async () => {
    const { club, token } = await soloClub('with tables');
    const t = await createTableViaHttp('club night', {}, { club, token });
    expect((await (await get(`/tables?club=${club}`, token)).json() as TableSummary[]).map((x) => x.tableId)).toEqual([t.tableId]);

    const res = await del(`/clubs/${club}`, token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tablesClosed: string[] }).tablesClosed).toEqual(['club night']);
  });

  it.skipIf(!engineReady)('REFUSES while somebody is seated, and closes nothing when it does', async () => {
    // A seat holds chips, and at a settled table those chips are money. The look happens before any
    // of the destroying, so a refusal leaves the club exactly as it was — which this checks, because
    // a refusal that had already closed half the tables would be the worst of both.
    const { club, token } = await soloClub('busy');
    const t = await createTableViaHttp('a table in use', {}, { club, token });
    const player = await TestClient.connect(t.tableId, token);
    player.send({ type: 'join', seat: 0, buyIn: 100 });
    await player.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 0);

    const res = await del(`/clubs/${club}`, token);
    expect(res.status).toBe(409);
    const said = (await res.json()) as { error: string; seated: { name: string; seated: number }[] };
    expect(said.error).toMatch(/a table in use/);
    expect(said.error).toMatch(/nothing has been closed/i);
    expect(said.seated).toHaveLength(1);

    // Still there, still listed, still a club.
    expect((await get(`/clubs/${club}`, token)).status).toBe(200);
    expect(((await (await get(`/tables?club=${club}`, token)).json()) as TableSummary[])).toHaveLength(1);
    player.close();
  }, 20_000);

  it('hands back the Smart Agent rather than pretending it went too', async () => {
    // The `<label>.workspace` agent lives at the host's own Home and this card room has never held its
    // key. Reporting "retired" with no mention of it would leave a host believing something was gone
    // that is still out there in the estate with their name on it.
    const { club, token } = await soloClub('chartered');
    const agent = '0x1111111111111111111111111111111111111111';
    const charter = await SELF.fetch(`http://tables.test/clubs/${club}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ agent }),
    });
    // The charter route needs the Home ceremony, so this may legitimately be refused here. Assert
    // which of the two happened rather than letting a silent skip look like a pass.
    if (charter.ok) {
      const res = await del(`/clubs/${club}`, token);
      expect((await res.json()) as { agent?: string }).toMatchObject({ agent });
    } else {
      // No agent recorded, so none is reported — the field is absent rather than null, because
      // `agent: null` invites a client to say something about an agent to a host who chartered nothing.
      const res = await del(`/clubs/${club}`, token);
      expect(await res.json()).not.toHaveProperty('agent');
    }
  });

  it('cannot be done twice — the second attempt is a club that does not exist', async () => {
    const { club, token } = await soloClub('once only');
    expect((await del(`/clubs/${club}`, token)).status).toBe(200);
    expect((await del(`/clubs/${club}`, token)).status).toBe(404);
  });
});
