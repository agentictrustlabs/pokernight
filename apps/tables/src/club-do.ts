/**
 * ClubDO — one instance per club. The roster, and the only thing that answers "what is this person
 * to this club?".
 *
 *   SQL `club(club_id PK, name, created_at, created_by, created_by_name, agent)`
 *       `members(member PK, name, class, joined_at, invited_by, valid_until)`
 *       `invites(token PK, email, name, class, invited_by, invited_by_name, created_at, expires_at,
 *                valid_until, claimed_by, claimed_at)`
 *
 * INVITES ARE NOT MEMBERSHIPS, and the two tables say so. A roster row is keyed by a `playerId` and
 * grants standing; an invite is keyed by a token, grants nothing, and is spent when somebody signs
 * in and claims it. Keeping them apart is what stops a club from holding a row that no session can
 * ever match — an invitation that reads as accepted and is not.
 *
 * THREE RULES, and they are the whole object.
 *
 * 1. IT NEVER SEES A SESSION. The Worker verifies the caller and asks this object a question about
 *    its own records; it does not authenticate anybody. That is the same split `HuddleRoomDO` makes
 *    upstream, and it is what keeps one authorization decision in one place instead of two.
 *
 * 2. STANDING IS DERIVED, NEVER ASSERTED. `standingOf` reads the roster and answers. No caller ever
 *    tells this object that somebody is a member — that would be supplying an authorization claim,
 *    which is the pattern ADR-0041 forbids and the reason `deriveStanding` exists upstream.
 *
 * 3. THE VAULT IS THE AUTHORITY, AND IS NOT WIRED YET. `docs/WORKSPACES.md` §10 puts the roster in
 *    the club's own workspace vault, read over a `service-agent-wire` delegation, with this table as
 *    a cache. That ceremony is Phase A's next step and the seam is `agent` below: until a club has
 *    been chartered it has no vault to read, and this table IS the record. When the wire lands, this
 *    becomes the cache it is named for and the vault wins every disagreement. Nothing above this
 *    object has to change for that, which is why it is shaped this way now.
 */

import { DurableObject } from 'cloudflare:workers';
import type { ClubInvite, ClubMember, ClubStanding, ClubSummary, ClubView, InviteGreeting, MembershipClass } from '@pokernight/protocol';
import type { Env } from './env.js';

export interface InitClubRequest {
  clubId: string;
  name: string;
  /** The `playerId` of whoever created it. They are the first host, on the roster from the start. */
  createdBy: string;
  createdByName: string;
  createdAt?: number;
}

/** What the Worker records once the host's Home has deployed the club's workspace agent. */
export interface CharterRequest {
  agent: string;
  agentName?: string;
  stewardship?: unknown;
}

export interface AddMemberRequest {
  member: string;
  name: string;
  class: MembershipClass;
  invitedBy: string;
  validUntil?: number;
}

/** An invitation the Worker has minted a token for and is about to have mailed. */
export interface CreateInviteRequest {
  token: string;
  email: string;
  name?: string;
  class: MembershipClass;
  invitedBy: string;
  invitedByName: string;
  /** How long the LINK is good for. Separate from `validUntil`, which is how long the MEMBERSHIP is. */
  expiresAt: number;
  validUntil?: number;
}

/** Somebody signed in and opened an invitation link. `member` is the agent that actually signed in. */
export interface ClaimInviteRequest {
  token: string;
  member: string;
  /** What their session calls them, used only when the host did not write a name on the invitation. */
  name?: string;
}

/** What the Worker asks about a caller, and what it gets back. `because` is quotable at a person. */
export interface StandingAnswer {
  standing: ClubStanding;
  because: string;
}

type ClubRow = {
  club_id: string;
  name: string;
  created_at: number;
  created_by: string;
  created_by_name: string;
  agent: string | null;
};

type InviteRow = {
  token: string;
  email: string;
  name: string | null;
  class: MembershipClass;
  invited_by: string;
  invited_by_name: string;
  created_at: number;
  expires_at: number;
  valid_until: number | null;
  claimed_by: string | null;
  claimed_at: number | null;
};

type MemberRow = {
  member: string;
  name: string;
  class: MembershipClass;
  joined_at: number;
  invited_by: string | null;
  valid_until: number | null;
};

export class ClubDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS club (
          club_id         TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          created_at      INTEGER NOT NULL,
          created_by      TEXT NOT NULL,
          created_by_name TEXT NOT NULL,
          agent           TEXT
        )`);
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS members (
          member      TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          class       TEXT NOT NULL,
          joined_at   INTEGER NOT NULL,
          invited_by  TEXT,
          valid_until INTEGER
        )`);
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS invites (
          token           TEXT PRIMARY KEY,
          email           TEXT NOT NULL,
          name            TEXT,
          class           TEXT NOT NULL,
          invited_by      TEXT NOT NULL,
          invited_by_name TEXT NOT NULL,
          created_at      INTEGER NOT NULL,
          expires_at      INTEGER NOT NULL,
          valid_until     INTEGER,
          claimed_by      TEXT,
          claimed_at      INTEGER
        )`);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/init') {
      return await this.init((await request.json()) as InitClubRequest);
    }

    const club = this.club();
    if (!club) return json({ error: 'no such club' }, 404);

    if (request.method === 'GET' && path === '/summary') return json(this.summary(club));

    // The caller's standing, derived here because this is where the roster is. The Worker asks
    // BEFORE it decides anything, and passes the answer down rather than re-deriving it.
    if (request.method === 'GET' && path === '/standing') {
      return json(this.standingOf(url.searchParams.get('player'), club));
    }

    if (request.method === 'GET' && path === '/view') {
      const answer = this.standingOf(url.searchParams.get('player'), club);
      // A club is not discoverable by somebody with no standing in it, and its existence is not
      // confirmed to them: 404, never 403. A 403 says "this club exists and you are not in it",
      // which is a fact about other people's private arrangements.
      if (answer.standing === 'none') return json({ error: 'no such club' }, 404);
      return json(this.view(club, answer));
    }

    // The charter: the club's `.workspace` Smart Agent, recorded once. The Worker has already
    // checked that the person who ran the ceremony is a host of THIS club.
    if (request.method === 'POST' && path === '/charter') {
      return this.charter((await request.json()) as CharterRequest, club);
    }

    if (request.method === 'POST' && path === '/members') {
      return await this.addMember((await request.json()) as AddMemberRequest, club);
    }

    if (request.method === 'DELETE' && path.startsWith('/members/')) {
      return await this.removeMember(decodeURIComponent(path.slice('/members/'.length)), club);
    }

    // The end of a club. The Worker has already checked that the caller is its host and that no
    // table of its is still holding anybody.
    if (request.method === 'POST' && path === '/retire') {
      return await this.retire(club);
    }

    /* ------------------------------------------------------------- invitations */

    if (request.method === 'POST' && path === '/invites') {
      return this.createInvite((await request.json()) as CreateInviteRequest, club);
    }

    if (request.method === 'GET' && path === '/invites') {
      return json({ invites: this.invites(club) });
    }

    // What the person who OPENED the link is told, before they have signed in. Deliberately less
    // than the record: who invited them, to what, and whether it is still good.
    if (request.method === 'GET' && path === '/invite') {
      return this.greeting(url.searchParams.get('token') ?? '', club);
    }

    if (request.method === 'POST' && path === '/invite/claim') {
      return await this.claimInvite((await request.json()) as ClaimInviteRequest, club);
    }

    if (request.method === 'DELETE' && path.startsWith('/invites/')) {
      return this.revokeInvite(decodeURIComponent(path.slice('/invites/'.length)), club);
    }

    return json({ error: 'not found' }, 404);
  }

  private async init(body: InitClubRequest): Promise<Response> {
    const existing = this.club();
    if (existing) return json(this.summary(existing));
    const name = (body.name ?? '').trim();
    const createdBy = (body.createdBy ?? '').trim();
    if (!name) return json({ error: 'a club needs a name' }, 400);
    if (!createdBy) return json({ error: 'a club needs somebody to have started it' }, 400);
    const createdAt = body.createdAt ?? Date.now();
    this.ctx.storage.sql.exec(
      'INSERT INTO club (club_id, name, created_at, created_by, created_by_name, agent) VALUES (?, ?, ?, ?, ?, NULL)',
      body.clubId,
      name,
      createdAt,
      createdBy,
      (body.createdByName ?? '').trim() || createdBy,
    );
    // The host is on the roster from the first instant. A club whose creator is not a member is a
    // club that reads as empty to its own creator the moment anything asks the roster instead of
    // asking who created it — two answers to one question, which is how they drift apart.
    this.ctx.storage.sql.exec(
      'INSERT INTO members (member, name, class, joined_at, invited_by, valid_until) VALUES (?, ?, ?, ?, NULL, NULL)',
      createdBy,
      (body.createdByName ?? '').trim() || createdBy,
      'standard' satisfies MembershipClass,
      createdAt,
    );
    // Awaited: the client's very next request is "which clubs am I in?", and the club it just made
    // has to be in the answer.
    await this.indexAdd(createdBy, body.clubId, name, createdAt);
    return json(this.summary(this.club() as ClubRow), 201);
  }

  /**
   * Keep the player's index in step.
   * 
   * STILL BEST EFFORT, BUT AWAITED. The roster is the record and this is a projection, so a membership
   * that succeeded must never report failure because the index was briefly unreachable — that is what
   * the `catch` is for, and it is what makes awaiting safe rather than what makes `void` necessary.
   *
   * It used to be fire-and-forget, and that was a real bug the moment navigation started depending on
   * the index: `POST /clubs` answered 201, the client immediately asked "which clubs am I in?", and the
   * club it had just made was not in the answer. A new host got no row in the rail — the one place they
   * could go next — until something else happened to refetch. One extra hop on a path that already
   * makes several is the right price for the caller's next question having a truthful answer.
   */
  private async indexAdd(member: string, clubId: string, name: string, joinedAt: number): Promise<void> {
    try {
      await this.env.CLUB_INDEX.get(this.env.CLUB_INDEX.idFromName(member)).fetch('https://index/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clubId, name, joinedAt }),
      });
    } catch {
      /* the club still holds the roster; the index catches up on the next change */
    }
  }

  private async indexRemove(member: string, clubId: string): Promise<void> {
    try {
      await this.env.CLUB_INDEX.get(this.env.CLUB_INDEX.idFromName(member)).fetch('https://index/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clubId }),
      });
    } catch {
      /* as above */
    }
  }

  /**
   * What this person is to this club.
   *
   * Order matters: the creator is a host whatever else the roster says, then an unexpired member is
   * a member, then nothing. An EXPIRED guest is `none` — the row stays so the club can still answer
   * "who played in March", but a window that has closed grants nothing.
   */
  private standingOf(player: string | null, club: ClubRow, now = Date.now()): StandingAnswer {
    const id = (player ?? '').trim();
    if (!id) return { standing: 'none', because: 'this club does not know who is asking' };
    if (id === club.created_by) return { standing: 'host', because: `you started ${club.name}` };
    const row = this.memberRow(id);
    if (!row) return { standing: 'none', because: `you are not a member of ${club.name}` };
    if (row.valid_until !== null && row.valid_until <= now) {
      return { standing: 'none', because: `you were a guest at ${club.name}, and that has passed` };
    }
    return { standing: 'member', because: `${club.name} has you on its roster` };
  }

  /**
   * Record the workspace agent this club was chartered as.
   *
   * IDEMPOTENT for the same agent, and REFUSED for a different one. A club is chartered once: its
   * agent is the thing its vault, its roster and (later) its own messages hang off, and repointing
   * it would silently orphan all three while every id above stayed the same. Somebody who genuinely
   * needs a different agent is starting a different club.
   */
  private charter(body: CharterRequest, club: ClubRow): Response {
    const agent = (body.agent ?? '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(agent)) return json({ error: 'that is not an agent address' }, 400);
    if (club.agent && club.agent.toLowerCase() !== agent) {
      return json({ error: `${club.name} is already chartered as ${club.agent} — a club is chartered once` }, 409);
    }
    if (!club.agent) {
      this.ctx.storage.sql.exec('UPDATE club SET agent = ? WHERE club_id = ?', agent, club.club_id);
      // The stewardship wire is the EVIDENCE the host custodies this club, and the thing a vault
      // read will present. Kept whole and never inspected here: this object does not verify
      // delegations, and a half-understood copy of one is worse than the wire itself.
      if (body.stewardship !== undefined) {
        void this.ctx.storage.put('stewardship', body.stewardship);
      }
    }
    return json(this.summary(this.club() as ClubRow));
  }

  private async addMember(body: AddMemberRequest, club: ClubRow): Promise<Response> {
    const member = (body.member ?? '').trim();
    if (!member) return json({ error: 'who?' }, 400);
    if (member === club.created_by) return json({ error: 'they started this club — they are already in it' }, 409);
    if (this.memberRow(member)) return json({ error: 'they are already a member' }, 409);
    const now = Date.now();
    const name = (body.name ?? '').trim() || member;
    const klass: MembershipClass = body.class ?? 'standard';
    this.ctx.storage.sql.exec(
      'INSERT INTO members (member, name, class, joined_at, invited_by, valid_until) VALUES (?, ?, ?, ?, ?, ?)',
      member,
      name,
      klass,
      now,
      body.invitedBy ?? null,
      body.validUntil ?? null,
    );
    await this.indexAdd(member, club.club_id, club.name, now);
    return json({ added: this.toMember({ member, name, class: klass, joined_at: now, invited_by: body.invitedBy ?? null, valid_until: body.validUntil ?? null }) }, 201);
  }

  /**
   * Take somebody off the roster.
   *
   * The host cannot be removed — a club with nobody who can act for it is unreachable, and the way
   * out of a club you started is to retire it, not to remove yourself from it. Everything else this
   * removal ought to cascade into (outstanding answers, held seats, pending invitations) does not
   * exist yet; when it does it belongs here, and `docs/WORKSPACES.md` §12.3 says what it is.
   *
   * Their PAST results are never touched. A season somebody played in is history.
   */
  private async removeMember(member: string, club: ClubRow): Promise<Response> {
    const id = member.trim();
    if (id === club.created_by) {
      return json({ error: 'the person who started a club cannot be removed from it — retire the club instead' }, 409);
    }
    if (!this.memberRow(id)) return json({ error: 'they are not a member' }, 404);
    this.ctx.storage.sql.exec('DELETE FROM members WHERE member = ?', id);
    await this.indexRemove(id, club.club_id);
    return json({ removed: id });
  }

  /**
   * RETIRE THE CLUB. The one way out for the person who started it, and the thing the refusal to
   * remove them has been pointing at.
   *
   * WHAT IT ENDS: the roster, every unclaimed invitation, and the club's row in every member's index —
   * so it leaves nobody's rail with a club that answers 404 when they press it. After this the object
   * holds nothing and every route on it answers "no such club", which is the same answer a stranger
   * has always got, and is now true for everybody.
   *
   * WHAT IT DOES NOT END, and must not pretend to: the club's `<label>.workspace` SMART AGENT. That
   * was deployed at the host's own Home and the card room has never held its key — this object could
   * not destroy it if it tried, and saying "club deleted" while an agent of that name goes on existing
   * in the estate would be a lie the host acts on. So the agent is RETURNED in the answer, for the
   * caller to say plainly.
   *
   * The index removals go FIRST and are awaited. If this fails halfway, the club still exists and
   * whoever has lost it from their rail gets it back on the next change; the other order leaves a club
   * that is gone from the card room and still in seven people's navigation.
   */
  private async retire(club: ClubRow): Promise<Response> {
    const members = this.ctx.storage.sql
      .exec<{ member: string }>('SELECT member FROM members')
      .toArray()
      .map((r) => r.member);
    for (const member of members) await this.indexRemove(member, club.club_id);

    this.ctx.storage.sql.exec('DELETE FROM invites');
    this.ctx.storage.sql.exec('DELETE FROM members');
    this.ctx.storage.sql.exec('DELETE FROM club WHERE club_id = ?', club.club_id);

    return json({
      retired: true,
      clubId: club.club_id,
      name: club.name,
      members: members.length,
      // Present only when there is one, because "agent: null" invites a client to say something about
      // an agent to a host who never chartered anything.
      ...(club.agent ? { agent: club.agent } : {}),
    });
  }

  /* --------------------------------------------------------------- invitations */

  /**
   * Open a pending invitation. The token was minted by the Worker, which is about to have it mailed.
   *
   * ONE LIVE INVITATION PER EMAIL. A host who presses the button twice means "send it again", not
   * "make a second membership" — so a re-invite replaces the outstanding one rather than leaving two
   * tokens that both work and a roster that could gain the same person twice.
   */
  private createInvite(body: CreateInviteRequest, club: ClubRow): Response {
    const email = (body.email ?? '').trim().toLowerCase();
    const token = (body.token ?? '').trim();
    if (!email || !token) return json({ error: 'an invitation needs an email and a token' }, 400);
    const now = Date.now();
    this.ctx.storage.sql.exec('DELETE FROM invites WHERE email = ? AND claimed_by IS NULL', email);
    this.ctx.storage.sql.exec(
      `INSERT INTO invites (token, email, name, class, invited_by, invited_by_name, created_at, expires_at, valid_until, claimed_by, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      token,
      email,
      (body.name ?? '').trim() || null,
      body.class ?? ('standard' satisfies MembershipClass),
      body.invitedBy,
      body.invitedByName,
      now,
      body.expiresAt,
      body.validUntil ?? null,
    );
    return json({ invite: this.toInvite(this.inviteRow(token) as InviteRow, club) }, 201);
  }

  /** The club's outstanding invitations, newest first. Claimed ones stay, as the record of who let who in. */
  private invites(club: ClubRow): ClubInvite[] {
    return this.ctx.storage.sql
      .exec<InviteRow>('SELECT * FROM invites ORDER BY created_at DESC')
      .toArray()
      .map((r) => this.toInvite(r, club));
  }

  private greeting(token: string, club: ClubRow, now = Date.now()): Response {
    const row = this.inviteRow(token.trim());
    // A token that is not one of ours is not distinguished from one that never existed. Guessing
    // tokens must learn nothing, including whether a guess was close.
    if (!row) return json({ error: 'that invitation is not one this club sent' }, 404);
    const state: InviteGreeting['state'] = row.claimed_by ? 'claimed' : row.expires_at <= now ? 'expired' : 'open';
    const greeting: InviteGreeting = {
      clubName: club.name,
      invitedByName: row.invited_by_name,
      expiresAt: row.expires_at,
      state,
    };
    return json(greeting);
  }

  /**
   * Spend an invitation: whoever signed in and opened the link becomes a member.
   *
   * The membership is keyed by the AGENT THAT SIGNED IN, never by the email it was sent to. The
   * email addressed the envelope; the person who opened it is whoever the club now has on its
   * roster, and that is the only identity a session can ever present.
   */
  private async claimInvite(body: ClaimInviteRequest, club: ClubRow, now = Date.now()): Promise<Response> {
    const row = this.inviteRow((body.token ?? '').trim());
    const member = (body.member ?? '').trim();
    if (!row) return json({ error: 'that invitation is not one this club sent' }, 404);
    if (!member) return json({ error: 'who is claiming it?' }, 400);
    if (row.claimed_by) {
      // Idempotent for the person who already claimed it — they followed the link twice, which is
      // not an error and must not read as one. Anybody ELSE gets a refusal: it is spent.
      if (row.claimed_by === member) return json({ claimed: this.toInvite(row, club), already: true });
      return json({ error: 'that invitation has already been used' }, 409);
    }
    if (row.expires_at <= now) return json({ error: 'that invitation has expired — ask them to send another' }, 410);

    this.ctx.storage.sql.exec('UPDATE invites SET claimed_by = ?, claimed_at = ? WHERE token = ?', member, now, row.token);
    // Already in the club: the invitation is spent and the answer is success, because the state the
    // person wanted is the state that holds. Adding them twice is what would be wrong.
    if (member !== club.created_by && !this.memberRow(member)) {
      const name = (row.name ?? '').trim() || (body.name ?? '').trim() || member;
      this.ctx.storage.sql.exec(
        'INSERT INTO members (member, name, class, joined_at, invited_by, valid_until) VALUES (?, ?, ?, ?, ?, ?)',
        member,
        name,
        row.class,
        now,
        row.invited_by,
        row.valid_until,
      );
      await this.indexAdd(member, club.club_id, club.name, now);
    }
    return json({ claimed: this.toInvite(this.inviteRow(row.token) as InviteRow, club) }, 201);
  }

  /** Take back an invitation that has not been used. A spent one is history and is not withdrawn. */
  private revokeInvite(token: string, club: ClubRow): Response {
    const row = this.inviteRow(token.trim());
    if (!row) return json({ error: 'no such invitation' }, 404);
    if (row.claimed_by) return json({ error: 'that invitation was already used — remove them from the roster instead' }, 409);
    this.ctx.storage.sql.exec('DELETE FROM invites WHERE token = ?', row.token);
    return json({ revoked: row.token, clubId: club.club_id });
  }

  private inviteRow(token: string): InviteRow | null {
    if (!token) return null;
    return this.ctx.storage.sql.exec<InviteRow>('SELECT * FROM invites WHERE token = ?', token).toArray()[0] ?? null;
  }

  private toInvite(r: InviteRow, club: ClubRow): ClubInvite {
    return {
      token: r.token,
      clubId: club.club_id,
      clubName: club.name,
      email: r.email,
      ...(r.name ? { name: r.name } : {}),
      class: r.class,
      invitedBy: r.invited_by,
      invitedByName: r.invited_by_name,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      ...(r.valid_until !== null ? { validUntil: r.valid_until } : {}),
      ...(r.claimed_by ? { claimedBy: r.claimed_by } : {}),
      ...(r.claimed_at !== null ? { claimedAt: r.claimed_at } : {}),
    };
  }

  private club(): ClubRow | null {
    return this.ctx.storage.sql.exec<ClubRow>('SELECT * FROM club LIMIT 1').toArray()[0] ?? null;
  }

  private memberRow(member: string): MemberRow | null {
    return this.ctx.storage.sql.exec<MemberRow>('SELECT * FROM members WHERE member = ?', member).toArray()[0] ?? null;
  }

  private roster(): ClubMember[] {
    return this.ctx.storage.sql
      .exec<MemberRow>('SELECT * FROM members ORDER BY joined_at')
      .toArray()
      .map((r) => this.toMember(r));
  }

  private toMember(r: MemberRow): ClubMember {
    return {
      member: r.member,
      name: r.name,
      class: r.class,
      joinedAt: r.joined_at,
      ...(r.invited_by ? { invitedBy: r.invited_by } : {}),
      ...(r.valid_until !== null ? { validUntil: r.valid_until } : {}),
    };
  }

  private summary(club: ClubRow): ClubSummary {
    const members = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM members').toArray()[0]?.n ?? 0;
    return {
      clubId: club.club_id,
      name: club.name,
      createdAt: club.created_at,
      createdBy: club.created_by,
      ...(club.agent ? { agent: club.agent } : {}),
      members,
    };
  }

  private view(club: ClubRow, you: StandingAnswer): ClubView {
    return { ...this.summary(club), roster: this.roster(), you };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * ClubIndexDO — one instance per PLAYER. "Which clubs am I in?"
 *
 * A PROJECTION, not a record. The club's own roster is the authority; this is the index that makes
 * the question answerable at all, because there is no global list of clubs and there must not be
 * one — a club is not discoverable, and enumerating every club to find a person's would be exactly
 * the discovery surface `docs/WORKSPACES.md` §5 refuses.
 *
 * `ClubDO` writes here whenever the roster changes. If a row is ever lost, the loss is a rebuild: the
 * clubs still exist, still hold their rosters, and still answer standing correctly — the person just
 * has to be handed a link once. That is the right failure mode for an index and the wrong one for a
 * record, which is why membership itself is not kept here.
 */
export class ClubIndexDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS clubs (
          club_id   TEXT PRIMARY KEY,
          name      TEXT NOT NULL,
          joined_at INTEGER NOT NULL
        )`);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/list') {
      const rows = this.ctx.storage.sql
        .exec<{ club_id: string; name: string; joined_at: number }>('SELECT * FROM clubs ORDER BY joined_at DESC')
        .toArray();
      return json({ clubs: rows.map((r) => ({ clubId: r.club_id, name: r.name, joinedAt: r.joined_at })) });
    }
    if (request.method === 'POST' && url.pathname === '/add') {
      const b = (await request.json()) as { clubId: string; name: string; joinedAt?: number };
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO clubs (club_id, name, joined_at) VALUES (?, ?, ?)',
        b.clubId,
        b.name,
        b.joinedAt ?? Date.now(),
      );
      return json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/remove') {
      const b = (await request.json()) as { clubId: string };
      this.ctx.storage.sql.exec('DELETE FROM clubs WHERE club_id = ?', b.clubId);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}
