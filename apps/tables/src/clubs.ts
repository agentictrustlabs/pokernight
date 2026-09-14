/**
 * A CLUB IS ITS WORKSPACE AGENT, AND THE CARD ROOM ACTS AS IT.
 *
 * There is no club table here (`docs/WORKSPACES.md` §5.0, 2026-09-13). A club exists at its host's Home
 * as a `<label>.workspace` Smart Agent: who belongs is the workspace's own membership, written by the
 * two Home ceremonies (`workspace-member-invite`, `workspace-join`); what the club calls itself, when it
 * meets and how each night diverges from the rule are three records in the workspace's own vault
 * (`cardroom.club.profile|schedule|nights` — apctx:CardRoomClub…, cr:Club… in the ontology). This
 * module is the card room's half: it reaches the club's agent at the Home and asks it to read or write
 * those records AS THE CLUB, under the service-agent wire the host signed at charter — `workspace →
 * this card room's session key`, pinned to the standard surface's one selector, revocable on chain.
 *
 * WHAT IS KEPT HERE: the wire, in KV, keyed by the club. A credential the club handed us, not a copy of
 * the club. Everything else is read fresh on every request; a club page costs one call to the Home
 * (`club.read`), and standing at a club — host, member, none — is the HOME's derivation over its own
 * records and the chain, never a row this card room holds.
 *
 * The one read still on the paired secret is "which clubs am I in": a person's clubs are nobody's to
 * act as, so no wire names them; the Home answers only the workspaces that keep a club profile.
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { hashDelegation } from '@agenticprimitives/delegation';
import { checkSessionWireShape, wireToDelegation, wrapSessionSignature, type DelegationWireV1 } from '@agenticprimitives/a2a';
import { callerAssertionDigest, requestBodyHash, sessionAuthorizationHeader, type CallerAssertionV1 } from '@agenticprimitives/a2a/standard';
import { occurrencesFrom, schedulingProblem, type ClubListing, type ClubMember, type ClubProfile, type ClubSchedule, type ClubStanding, type ClubSummary, type ClubView, type KnownPerson, type Night, type SetScheduleRequest } from '@pokernight/protocol';
import type { Env } from './env.js';

export const CLUB_ID_RE = /^0x[0-9a-fA-F]{40}$/;

/** How many nights ahead a club's calendar shows. Derived at read time from the rule, never stored. */
export const HORIZON_NIGHTS = 8;

/** The skills the wire ceremony asks the custodian to approve: the standard surface's own selector, which
 *  is what a session wire is gated on. The club's verbs (`club.read`, `club.write`) are named in the message. */
export const CLUB_WIRE_SKILLS = ['harness.ask'] as const;

const lc = (s: string) => s.toLowerCase();

/* ---------------------------------------------------------------- the wire */

export function clubActingConfigured(env: Env): boolean {
  return Boolean((env.HOME_A2A_ORIGIN ?? '').trim() && (env.HOUSE_A2A_SESSION_KEY ?? '').trim() && env.CLUB_WIRES);
}

/** The session key's address — the DELEGATE every club wire must name. Reported to the Home's wire ceremony. */
export function clubDelegateAddress(env: Env): Address | null {
  const pk = (env.HOUSE_A2A_SESSION_KEY ?? '').trim();
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk as Hex).address;
  } catch {
    return null;
  }
}

export async function clubWire(env: Env, club: string): Promise<DelegationWireV1 | null> {
  if (!env.CLUB_WIRES) return null;
  const raw = await env.CLUB_WIRES.get(`wire:${lc(club)}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DelegationWireV1;
  } catch {
    return null;
  }
}

/**
 * Keep the wire a club's custodian signed for this card room — after checking it is what it claims.
 *
 * SHAPE, then CHAIN. The shape check is the one every gate makes (timestamp window, allowed-methods pinned
 * to the standard selector, delegate = our key); the chain check is the club's own ERC-1271 accepting the
 * custodian's signature, which nobody but the custodian can produce. A wire that fails either is refused,
 * not stored: an unverifiable credential in the store is a club page that says "refused" for no reason
 * anybody can see, and a forged one is somebody overwriting a real club's wire with a dead one.
 */
export async function storeClubWire(env: Env, wire: DelegationWireV1): Promise<{ ok: true; club: string; expiresAt: string | null } | { ok: false; error: string }> {
  if (!env.CLUB_WIRES) return { ok: false, error: 'this deployment keeps no club wires' };
  const delegate = clubDelegateAddress(env);
  if (!delegate) return { ok: false, error: 'this card room has no session key to be authorised' };
  const enforcers = { timestamp: (env.TIMESTAMP_ENFORCER ?? '').trim(), allowedMethods: (env.ALLOWED_METHODS_ENFORCER ?? '').trim() };
  if (!enforcers.timestamp || !enforcers.allowedMethods) return { ok: false, error: 'the enforcer addresses are not configured' };
  const problem = checkSessionWireShape(wire, enforcers, Math.floor(Date.now() / 1000), { skill: CLUB_WIRE_SKILLS[0] });
  if (problem) return { ok: false, error: `the wire is not one this card room can use: ${problem}` };
  if (lc(wire.delegate) !== lc(delegate)) return { ok: false, error: `the wire authorises ${wire.delegate}, not this card room's key` };
  const d = wireToDelegation(wire);
  const dm = (env.DELEGATION_MANAGER ?? '').trim();
  const validator = (env.UNIVERSAL_SIGNATURE_VALIDATOR ?? '').trim();
  if (!CLUB_ID_RE.test(dm) || !CLUB_ID_RE.test(validator)) return { ok: false, error: 'the chain addresses a wire is checked against are not configured' };
  const digest = hashDelegation(d, Number(env.CHAIN_ID), dm as Address);
  const client = createPublicClient({ transport: http(env.RPC_URL) });
  const abi = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
  const ok = await client.readContract({ address: validator as Address, abi, functionName: 'isValidSig', args: [d.delegator as Address, digest as Hex, d.signature as Hex] }).catch(() => false);
  if (ok !== true) return { ok: false, error: 'the club\'s agent does not accept this wire\'s signature' };
  const club = lc(wire.delegator);
  await env.CLUB_WIRES.put(`wire:${club}`, JSON.stringify(wire));
  return { ok: true, club, expiresAt: null };
}

/* ------------------------------------------------------------ acting as it */

export type ClubAct =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * One request to the club's agent, signed as the club. The assertion binds the method, the exact body
 * bytes, the Home's origin and the moment, and the Home spends it once — the same shape the house
 * presents to a person's agent (`house-caller.ts`), with the club's wire in place of the house's.
 */
export async function actAsClub(env: Env, club: string, skill: 'club.read' | 'club.write', input: Record<string, unknown>): Promise<ClubAct> {
  const a2a = (env.HOME_A2A_ORIGIN ?? '').trim().replace(/\/$/, '');
  const pk = (env.HOUSE_A2A_SESSION_KEY ?? '').trim();
  if (!a2a || !pk) return { ok: false, status: 503, error: 'this card room cannot reach its Home' };
  const wire = await clubWire(env, club);
  if (!wire) return { ok: false, status: 404, error: 'no such club' };
  const url = `${a2a}/clubs/act`;
  // A NONCE IN THE BODY. The assertion's digest is over the body hash and the SECOND it was issued, and the
  // Home spends each digest once — so two identical reads in one second (a club page asks for its view, its
  // tables' gate and its huddle together) were the same assertion, and every one after the first was refused
  // as a replay. Each request is its own body now.
  const raw = JSON.stringify({ method: 'club.act', club: lc(club), skill, input, nonce: crypto.randomUUID() });
  const session = privateKeyToAccount(pk as Hex);
  const unsigned: Omit<CallerAssertionV1, 'signature'> = {
    agent: lc(wire.delegator),
    method: 'club.act',
    bodyHash: requestBodyHash(raw),
    issuedAt: Math.floor(Date.now() / 1000),
    audience: new URL(url).origin,
  };
  const sig = await session.sign({ hash: callerAssertionDigest(unsigned) });
  const authorization = sessionAuthorizationHeader({ ...unsigned, signature: wrapSessionSignature(wire, sig) });
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: raw, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    return { ok: false, status: 502, error: `the Home could not be reached: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & Record<string, unknown>) | null;
  if (!res.ok || !body || body.ok !== true) {
    return { ok: false, status: res.status === 401 || res.status === 403 ? 404 : res.status || 502, error: body?.error ?? `the Home answered ${res.status}` };
  }
  return { ok: true, data: body };
}

/* --------------------------------------------------------------- reading it */

interface ClubRead {
  club: string;
  profile: ClubProfile | null;
  schedule: (ClubSchedule & { club?: string }) | null;
  nights: NightsRecord | null;
  roster: Array<{ agent: string; name: string | null; role?: string }>;
  /** What the estate calls the founder, when the Home could say. */
  founderName?: string | null;
  you?: { agent: string; standing: ClubStanding; because: string };
}

/** `cardroom.club.nights` — how the occasions diverge from the rule, keyed by night id (`<schedule>:<localDate>`). */
export interface NightsRecord {
  exceptions?: Record<string, { status: 'cancelled' | 'skipped'; cancelledAt: number; reason?: string }>;
  updatedAt?: string;
}

/**
 * A TEN-SECOND MEMO, per (club, person), in the isolate. A club page reads its club several times on one
 * load (the view, the tables' gate, the huddle, the socket) and each read was a round-trip to the Home;
 * ten seconds is shorter than any decision a host makes and long enough that one screen is one read.
 * A write to the club (`writeClubRecord`) forgets the memo, so the host sees their own change at once.
 */
const READ_MEMO = new Map<string, { at: number; value: Promise<ClubRead | null> }>();
const READ_MEMO_MS = 10_000;

export async function readClub(env: Env, club: string, agent?: string | null): Promise<ClubRead | null> {
  const key = `${lc(club)}|${agent ? lc(agent) : ''}`;
  const hit = READ_MEMO.get(key);
  if (hit && Date.now() - hit.at < READ_MEMO_MS) return hit.value;
  const value = (async () => {
    const out = await actAsClub(env, club, 'club.read', agent ? { agent: lc(agent) } : {});
    if (!out.ok) return null;
    const d = out.data as unknown as ClubRead;
    if (!d || typeof d !== 'object') return null;
    return { ...d, roster: Array.isArray(d.roster) ? d.roster : [] };
  })();
  READ_MEMO.set(key, { at: Date.now(), value });
  value.then((v) => { if (v === null) READ_MEMO.delete(key); }, () => READ_MEMO.delete(key));
  if (READ_MEMO.size > 500) for (const [k, v] of READ_MEMO) if (Date.now() - v.at >= READ_MEMO_MS) READ_MEMO.delete(k);
  return value;
}

/** Forget every memo of one club — after a write, so the writer reads their own change. */
export function forgetClub(club: string): void {
  for (const k of READ_MEMO.keys()) if (k.startsWith(`${lc(club)}|`)) READ_MEMO.delete(k);
}

/** The host: the steward who founded the club, as its profile records (their STANDING is still derived by
 *  the Home on every read — this names who to show as host, it grants nothing). */
function hostOf(read: ClubRead): string | null {
  const founded = read.profile?.foundedBy;
  if (founded && CLUB_ID_RE.test(founded)) return lc(founded);
  if (read.you?.standing === 'host') return lc(read.you.agent);
  return null;
}

/** The night a rule produces for one date — derived, and the same every time it is derived. */
export function nightId(scheduleId: string, localDate: string): string {
  return `${scheduleId}:${localDate}`;
}

/** The club's next nights: the rule's occurrences from now, with the exceptions the host recorded laid over. */
export function nightsOf(club: string, schedule: ClubSchedule | null, record: NightsRecord | null, now = Date.now(), limit = HORIZON_NIGHTS): Night[] {
  if (!schedule || schedule.status !== 'active') return [];
  const ex = record?.exceptions ?? {};
  return occurrencesFrom(schedule, now, limit).map((o) => {
    const id = nightId(schedule.scheduleId, o.localDate);
    const e = ex[id];
    return {
      nightId: id,
      club,
      scheduleId: schedule.scheduleId,
      startsAt: o.startsAt,
      startLocal: schedule.startLocal,
      timezone: schedule.timezone,
      localDate: o.localDate,
      status: e?.status ?? 'scheduled',
      ...(schedule.defaults.title ? { title: schedule.defaults.title } : {}),
      ...(schedule.defaults.seatCap ? { seatCap: schedule.defaults.seatCap } : {}),
      ...(schedule.defaults.game ? { game: schedule.defaults.game } : {}),
      createdAt: schedule.createdAt,
      ...(e ? { cancelledAt: e.cancelledAt } : {}),
      ...(e?.reason ? { reason: e.reason } : {}),
    };
  });
}

export function summaryOf(read: ClubRead): ClubSummary | null {
  const p = read.profile;
  const host = hostOf(read);
  if (!p || !host) return null;
  return {
    clubId: read.club,
    name: p.name,
    host,
    ...(p.welcome ? { welcome: p.welcome } : {}),
    ...(p.games?.length ? { games: p.games } : {}),
    charteredAt: p.charteredAt,
    members: read.roster.length,
  };
}

/**
 * A club as the person asking sees it — or null when they have no standing there, which the caller answers
 * with the same 404 a club that does not exist gets. A club whose agent keeps no profile yet is not a club
 * yet either: its charter has not finished, and a page for it would be a page about nothing.
 */
export async function clubViewFor(env: Env, club: string, agent: string, now = Date.now()): Promise<ClubView | null> {
  const read = await readClub(env, club, agent);
  if (!read || !read.you || read.you.standing === 'none') return null;
  const summary = summaryOf(read);
  if (!summary) return null;
  const roster: ClubMember[] = read.roster
    .map((m) => ({ agent: lc(m.agent), name: (m.name ?? '').trim() || m.agent.slice(0, 10), host: lc(m.agent) === summary.host }))
    .sort((a, b) => Number(b.host) - Number(a.host) || a.name.localeCompare(b.name));
  if (!roster.some((m) => m.host)) roster.unshift({ agent: summary.host, name: (read.founderName ?? '').trim() || (read.you.agent === summary.host ? 'You' : summary.host.slice(0, 10)), host: true });
  const schedule = read.schedule && read.schedule.status === 'active' ? { ...read.schedule, club: read.club } : null;
  return {
    ...summary,
    members: roster.length,
    roster,
    you: { standing: read.you.standing, because: read.you.because },
    schedule,
    nights: nightsOf(read.club, schedule, read.nights, now),
  };
}

export interface StandingAnswer {
  standing: ClubStanding;
  because: string;
}

/** What `agent` is to `club`, asked of the club's own agent. `null` ⇒ no such club (or none this card room can act as). */
export async function standingAt(env: Env, club: string, agent: string | null): Promise<StandingAnswer | null> {
  if (!CLUB_ID_RE.test(club)) return null;
  if (!agent) return { standing: 'none', because: 'no agent' };
  const read = await readClub(env, club, agent);
  if (!read) return null;
  return read.you ? { standing: read.you.standing, because: read.you.because } : { standing: 'none', because: 'the club did not say' };
}

export function belongs(standing: ClubStanding): boolean {
  return standing === 'host' || standing === 'member';
}

/* -------------------------------------------------------------- writing it */

export async function writeClubRecord(env: Env, club: string, record: 'profile' | 'schedule' | 'nights', value: unknown): Promise<ClubAct> {
  const out = await actAsClub(env, club, 'club.write', { record, value });
  forgetClub(club);
  return out;
}

/** Compose the schedule record from what the host asked for, or say what is wrong with it. */
export function scheduleFrom(club: string, body: SetScheduleRequest, createdBy: string, now = Date.now()): { ok: true; schedule: ClubSchedule } | { ok: false; error: string } {
  const wanted = {
    startLocal: (body.startLocal ?? '').trim(),
    timezone: (body.timezone ?? '').trim(),
    recurrence: body.recurrence,
    activeFrom: body.activeFrom ?? now,
    ...(body.activeUntil === undefined ? {} : { activeUntil: body.activeUntil }),
  };
  const problem = schedulingProblem(wanted);
  if (problem) return { ok: false, error: problem };
  return {
    ok: true,
    schedule: {
      scheduleId: `s${now.toString(36)}`,
      club,
      startLocal: wanted.startLocal,
      timezone: wanted.timezone,
      recurrence: wanted.recurrence,
      defaults: body.defaults ?? {},
      activeFrom: wanted.activeFrom,
      ...(wanted.activeUntil === undefined ? {} : { activeUntil: wanted.activeUntil }),
      createdBy,
      createdAt: now,
      status: 'active',
    },
  };
}

/* ---------------------------------------------------------- the person's clubs */

/** The clubs this person is in, from their own links at their Home. */
export async function myClubs(env: Env, agent: string): Promise<ClubListing[] | null> {
  const a2a = (env.HOME_A2A_ORIGIN ?? '').trim().replace(/\/$/, '');
  const secret = (env.CLUB_ROSTER_SECRET ?? '').trim();
  if (!a2a || !secret || !CLUB_ID_RE.test(agent)) return null;
  try {
    const r = await fetch(`${a2a}/clubs/mine?agent=${lc(agent)}`, { headers: { accept: 'application/json', authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const b = (await r.json().catch(() => null)) as { ok?: boolean; clubs?: Array<{ club?: string; name?: string; standing?: string }> } | null;
    if (!b?.ok || !Array.isArray(b.clubs)) return null;
    return b.clubs
      .filter((c) => CLUB_ID_RE.test(String(c.club ?? '')))
      .map((c) => ({ clubId: lc(String(c.club)), name: String(c.name ?? c.club), standing: c.standing === 'host' ? 'host' : 'member' as const }));
  } catch {
    return null;
  }
}

/** The clubs this person has been invited to and not joined — from the invitation messages in their own inbox. */
export interface ClubInvitation {
  clubId: string;
  name: string;
  from?: string;
  fromName?: string;
  invitedAt?: string;
}

export async function myInvitations(env: Env, agent: string): Promise<ClubInvitation[] | null> {
  const a2a = (env.HOME_A2A_ORIGIN ?? '').trim().replace(/\/$/, '');
  const secret = (env.CLUB_ROSTER_SECRET ?? '').trim();
  if (!a2a || !secret || !CLUB_ID_RE.test(agent)) return null;
  try {
    const r = await fetch(`${a2a}/clubs/invitations?agent=${lc(agent)}`, { headers: { accept: 'application/json', authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const b = (await r.json().catch(() => null)) as { ok?: boolean; invitations?: Array<{ club?: string; name?: string; from?: string; fromName?: string; invitedAt?: string }> } | null;
    if (!b?.ok || !Array.isArray(b.invitations)) return null;
    return b.invitations
      .filter((i) => CLUB_ID_RE.test(String(i.club ?? '')))
      .map((i) => ({ clubId: lc(String(i.club)), name: String(i.name ?? i.club), ...(i.from ? { from: lc(String(i.from)) } : {}), ...(i.fromName ? { fromName: String(i.fromName) } : {}), ...(i.invitedAt ? { invitedAt: String(i.invitedAt) } : {}) }));
  } catch {
    return null;
  }
}

/** The people this person already plays with: everyone on the rosters of their clubs, but them. */
export async function knownPeople(env: Env, agent: string): Promise<KnownPerson[]> {
  const clubs = (await myClubs(env, agent)) ?? [];
  const byAgent = new Map<string, KnownPerson>();
  await Promise.all(clubs.map(async (c) => {
    const read = await readClub(env, c.clubId, agent);
    for (const m of read?.roster ?? []) {
      const who = lc(m.agent);
      if (who === lc(agent)) continue;
      const cur = byAgent.get(who);
      if (cur) { if (!cur.clubs.includes(c.name)) cur.clubs.push(c.name); continue; }
      byAgent.set(who, { agent: who, name: (m.name ?? '').trim() || who.slice(0, 10), clubs: [c.name] });
    }
  }));
  return [...byAgent.values()].sort((a, b) => a.name.localeCompare(b.name));
}
