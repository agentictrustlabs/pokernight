import type {
  AddNightRequest,
  SetVisitRequest,
  ClubListing,
  ClubSchedule,
  ClubView,
  CreateTableRequest,
  Night,
  SetScheduleRequest as SetSchedule,
  KnownPerson,
  Session,
  SignOutResult,
  TableSummary,
} from '@pokernight/protocol';

/** What the coach says about one move: the move, one clause to speak, the rule behind it. */
export interface CoachAdvice {
  action?: unknown;
  say: string;
  because?: string;
  /**
   * WHOSE ADVICE THIS IS — the house's own coach, or the agent this person named.
   *
   * Always present, and shown. The card room's coach is one strategy for everybody; a person's own
   * agent carries their style. Which of the two just spoke is not a detail, and an app that showed
   * them identically would be passing one off as the other.
   */
  source?: 'house' | AdviserVoice;
  /** Said when the named adviser could not be reached and the house answered instead. */
  note?: string;
}

/**
 * WHO SPOKE, when it was not the house. `agent` is the one you named and the table addressed — your own
 * agent. `coach` is set when that agent CONSULTED your coach service (a `.svc` name) and returned its
 * words: the voice is the coach's, the addressee is still yours, and the screen says both.
 */
export interface AdviserVoice { agent: string; displayName: string; coach?: string }

/**
 * WHAT THE COACH IS DOING RIGHT NOW, for the board as well as the panel. "Looking at your hand" was a
 * quiet line in a side panel while the turn clock ran on the board; the board is where the person is
 * looking, so it shows the same state. `thinking` — the question is out (the house in a blink, a named
 * adviser in ten to twenty seconds); `ready` — the answer is in the panel; `idle` — nothing in flight.
 */
export interface CoachStatus {
  phase: 'thinking' | 'ready' | 'idle';
  /** Whose voice: "the house coach", "alice.me", "bob-coach.svc, via alice.me". */
  who: string;
  /** When the question went out (ms), for a stopwatch. */
  since: number;
  /** For `ready`: the one sentence, so the board can show it without the panel. */
  say?: string;
  /** For `ready`: the reason, folded behind "Why?" on the board — a phone shows the board, not the panel. */
  because?: string;
  /** For `ready`: the move it named, so the board can mark the button that makes it. */
  action?: unknown;
}

/** A coaching SERVICE for hire, as its card describes it. */
export interface CoachListing { agentName: string; displayName: string; description: string; skills: string[]; reviews: boolean }

/** A review of your past hands — a few short paragraphs, and one thing to change. */
export interface CoachReview {
  say: string;
  because?: string;
  source?: AdviserVoice;
}

/** One agent this card room can seat, as `GET /agents` reports it. */
export interface AgentListing {
  id: string;
  agentName: string;
  displayName: string;
  description: string;
  game?: string;
  strategy: string;
  /**
   * What this agent will actually answer — `poker.act`, `canasta.advise`, and so on.
   *
   * Taking a turn and giving advice are DIFFERENT skills on purpose, so "who can sit down here" and
   * "who can advise me here" are different questions and the list has to carry the answer to both.
   * Absent from an older agent host, which is read as "it says nothing about advising".
   */
  skills?: string[];
}

/**
 * WHETHER SEATING OR ASKING THIS AGENT SPENDS LANGUAGE-MODEL TOKENS.
 *
 * The house personas are two kinds of thing under one name. A rules-based one costs nothing: the
 * A2A hop is a subrequest to the card room's own Worker and the decision is a lookup. A Claude-backed
 * one calls a model EVERY TURN — and a practice table filling its chairs from the top of the list was
 * seating one without saying so, so every hand somebody played to learn was spending tokens on an
 * opponent they had not chosen. The strategy label is the card room's own, so this is a fact rather
 * than a guess; anything unrecognised is treated as costing, never as free.
 */
export function costsTokens(agent: AgentListing): boolean {
  return agent.strategy !== 'rules';
}

/** Whether a listed agent advertises one particular skill. Absent skills mean no, never "probably". */
export function advertises(agent: AgentListing, skill: string): boolean {
  return (agent.skills ?? []).includes(skill);
}

export type { ClubListing };

/** A club somebody has been invited to and has not joined yet. */
export interface ClubInvitation {
  clubId: string;
  name: string;
  from?: string;
  fromName?: string;
  invitedAt?: string;
}
import { SESSION_KEY } from './ssoLogout';
import type { AppSession } from './types';
import type { AuthConfig } from './home';
import type { TableDetail } from './lobby';
import type { StakeResult } from './stake';
import type {
  CreateTreasuryResult,
  FundTreasuryResult,
  MandateResult,
  SelectTreasuryResult,
  TableSettlement,
  TreasuryView,
} from './treasury';

/** Base URL of the tables API. `/api` is proxied by Vite in dev; baked at build otherwise. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

export function loadSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<AppSession>;
    if (typeof s.token === 'string' && typeof s.playerId === 'string' && typeof s.name === 'string') {
      return {
        token: s.token,
        playerId: s.playerId,
        name: s.name,
        via: s.via === 'home' || s.via === 'demo' ? s.via : 'home',
        address: typeof s.address === 'string' ? s.address : undefined,
        agentName: typeof s.agentName === 'string' ? s.agentName : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: AppSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode / storage blocked: session lives in memory only */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Told when the API refuses a session token we sent. Registered by the app, which turns it into the
 * one correct outcome: clear the session and land on the sign-in page saying so. It lives here
 * because every route is a place a session can be found dead, and a table view that silently stops
 * updating is the worst of the alternatives.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, notifyUnauthorized = true): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  /**
   * A request that never ARRIVED is a different thing from one the card room refused, and it used to
   * be indistinguishable: `fetch` rejects with a bare `TypeError` for a blocked preflight, a dropped
   * connection or a DNS failure, that is not an `ApiError`, and every caller's `instanceof ApiError`
   * check fell through to its own generic sentence. A CORS method missing from the allow-list read on
   * screen as "that could not be saved", which is true and says nothing anybody can act on.
   *
   * Status 0 says exactly that: it never got there. Nothing treats it as a refusal, and the message
   * names the possibilities rather than inventing one.
   */
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError(0, `Could not reach the card room — it may be offline, or this request was blocked before it left the browser (${init.method ?? 'GET'} ${path})`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    // A 401 on a request we DID authenticate means this session is over, wherever we were.
    if (res.status === 401 && token && notifyUnauthorized) unauthorizedHandler?.();
    const msg =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : typeof body === 'string' && body
          ? body
          : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

/** What `POST /auth/home` answers with. A superset of `Session`; the extras are display-only. */
export interface HomeSessionResponse extends Session {
  agentName?: string;
  address?: string;
}

/** What the browser hands the Worker on the return leg. The Worker trusts none of it as identity —
 *  it exchanges the code and verifies the id_token itself. */
/** One registered mission as the map and the pickers see it. */
import type { MissionListing } from '@pokernight/missions';
export type { MissionListing };
export interface MissionReceipt {
  receiptId: string;
  registryId: string;
  entryId: string;
  subjectAgent: string;
  name?: string;
  verified: Array<{ check: string; ref: string; at: string }>;
  failed: Array<{ check: string; reason: string; at: string }>;
  notVerified: Array<{ check: string; reason: string }>;
  admittedAt: string;
  expiresAt?: string;
  proof: { signer: string; scheme: string; signature: string };
}

export interface HomeAuthBody {
  code: string;
  codeVerifier: string;
  authOrigin: string;
  nonce: string;
  state: string;
  /** What the person asked to be called, from the field on the way in. A DISPLAY name the card room
   *  keeps — no Faithnet handle is claimed for it. Absent when they did not give one. */
  profileName?: string;
}

/** What the browser hands the Worker after `connectAsQuickConnect`. The Worker verifies the id_token
 *  against the Home's JWKS itself; this is a shortcut past the code exchange, not past the proof. */
export interface DemoAuthBody {
  idToken: string;
  delegation?: unknown;
  authOrigin: string;
}

export const api = {
  authConfig: () => request<AuthConfig>('/auth/config'),
  homeLogin: (body: HomeAuthBody) => request<HomeSessionResponse>('/auth/home', { method: 'POST', body: JSON.stringify(body) }),
  demoLogin: (body: DemoAuthBody) => request<HomeSessionResponse>('/auth/home/demo', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * Sign out: give up every seat this person holds, then drop the server-side session record so the
   * token stops resolving straight away.
   *
   * The answer says which seats were stood up and whether the money has actually moved — on a settled
   * table it has not yet, and the caller must say so rather than implying the money is home. A request
   * that never arrives returns a failure we can describe, not a silent success: we would rather tell
   * someone their seat may still be sitting there than let them believe it is not.
   */
  signOut: (token: string) =>
    request<SignOutResult>('/auth/signout', { method: 'POST', body: '{}' }, token, false).catch(
      (): SignOutResult => ({
        ok: false,
        stoodUp: [],
        failed: [{ tableId: 'your table', reason: 'the card room could not be reached' }],
      }),
    ),
  /** Finish a `poker-buyin` ceremony the player ran at their Home. The Worker exchanges the code,
   *  checks the mandate against this session's treasury, and stores it — or says what came back. */
  homeMandate: (body: HomeAuthBody, token: string) =>
    request<MandateResult>('/auth/home/mandate', { method: 'POST', body: JSON.stringify(body) }, token),
  /** The open tables. With no club that is the PUBLIC pickup lobby, which needs no session at all;
   *  with one it is that club's own tables, and the card room checks standing before it answers. */
  listTables: (token?: string, club?: string) =>
    request<TableSummary[]>(club ? `/tables?club=${encodeURIComponent(club)}` : '/tables', {}, token),
  createTable: (req: CreateTableRequest, token?: string) =>
    request<TableSummary>('/tables', { method: 'POST', body: JSON.stringify(req) }, token),

  /* ---------------------------------------------------------------------- clubs */

  /** The clubs this person is in — their own links at their Home. Never a list of clubs to browse. */
  listClubs: (token: string) => request<{ clubs: ClubListing[] }>('/clubs', {}, token),
  /** The clubs they were invited to and have not joined: the host's agent messaged them, and this is the same
   *  invitation read off their own inbox, so the rail can offer the door. */
  listInvitations: (token: string) => request<{ invitations: ClubInvitation[] }>('/clubs/invitations', {}, token),
  /**
   * One club, from its own agent: profile, roster, schedule, nights, and what you are to it.
   *
   * A club you are not in answers 404, exactly as a club that does not exist does. The client must
   * not turn that into "you do not have access" — the card room is declining to say either way.
   */
  getClub: (clubId: string, token: string) => request<ClubView>(`/clubs/${encodeURIComponent(clubId)}`, {}, token),
  /**
   * STARTING A CLUB, in three steps the card room and the Home take turns at: the `workspace-create`
   * ceremony's return leg (this — the club's agent exists; `idToken` is the bearer the wire ceremony
   * needs), then the `service-agent-wire` ceremony (the Home talks to the card room directly), then
   * `foundClub` — the card room's first act as the club, writing its profile.
   */
  charterClub: (body: HomeAuthBody, token: string) =>
    request<{ clubId: string; agentName?: string; idToken: string }>('/clubs/charter', { method: 'POST', body: JSON.stringify(body) }, token),
  /**
   * THE MISSION REGISTRY (docs/MISSION-REGISTRY.md): the public projection (no session), one mission with its
   * receipt and events, the return leg of the registration ceremony, and the geocoder the register form uses.
   */
  missions: () => request<{ missions: MissionListing[] }>('/missions'),
  mission: (entryId: string) =>
    request<{ listing: MissionListing; receipt: MissionReceipt | null; events: Array<{ kind: string; occurredAt: string; sequence: string }> }>(`/missions/${encodeURIComponent(entryId)}`),
  missionRegistry: () => request<{ registryId: string; name: string; description: string; chainId: number; registryAddress: string | null; operatorAgent: string; configured: boolean }>('/missions/registry'),
  /** The return leg. Without a session the card room SIGNS THE STEWARD IN as it admits the mission (`session`). */
  enrolMission: (body: HomeAuthBody, token?: string) =>
    request<{ ok: true; listing: MissionListing; receipt: MissionReceipt; act: 'registered' | 'renewed'; session?: HomeSessionResponse }>('/missions/enrol', { method: 'POST', body: JSON.stringify(body) }, token),
  geocode: (q: string, token?: string) =>
    request<{ places: Array<{ label: string; country: string; lat: number; lng: number; kind: string }> }>(`/geo/search?q=${encodeURIComponent(q)}`, {}, token),
  foundClub: (clubId: string, body: { name: string; games?: string[] }, token: string) =>
    request<ClubView>(`/clubs/${encodeURIComponent(clubId)}/found`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** Whom a host means — `carol.me` or an address — resolved on chain so the invitation can name the agent. */
  resolveMember: (clubId: string, who: string, token: string) =>
    request<{ agent: string; name?: string }>(`/clubs/${encodeURIComponent(clubId)}/resolve?who=${encodeURIComponent(who)}`, {}, token),
  /**
   * Your practice table for a game — the same one every time.
   *
   * Idempotent: the card room derives its id from you and the game rather than storing one, so
   * asking twice is asking about the same table. It is in no lobby and settles nothing.
   */
  practiceTable: (game: string, token: string) =>
    request<{ tableId: string; game: string }>('/practice', { method: 'POST', body: JSON.stringify({ game }) }, token),
  /** Stop the table, or start it again — the clock, the agents and the next round all together. */
  setPaused: (tableId: string, paused: boolean, token: string) =>
    request<{ paused: boolean }>(`/tables/${encodeURIComponent(tableId)}/pause`, { method: 'POST', body: JSON.stringify({ paused }) }, token),
  /** How fast this table plays: how long an agent's answer waits before it lands. Your own only. */
  setPace: (tableId: string, ms: number, token: string) =>
    request<{ paceMs: number }>(`/tables/${encodeURIComponent(tableId)}/pace`, { method: 'POST', body: JSON.stringify({ ms }) }, token),
  /** Deal again from the start, keeping the seats. Your own practice table only. */
  resetPractice: (tableId: string, token: string) =>
    request<{ reset: true }>(`/tables/${encodeURIComponent(tableId)}/reset`, { method: 'POST' }, token),
  /**
   * What a good player would do in YOUR seat, and why.
   *
   * Your own seat only, and the coach sees only what that seat sees — enforced in the card room, not
   * here. A coach reasoning from the full table would explain moves with cards you cannot see, which
   * teaches a way of playing you could never reproduce alone.
   *
   * 404 when it is not your turn, when you are not seated, or when the game has no coach.
   */
  advice: (tableId: string, token: string) =>
    request<CoachAdvice>(`/tables/${encodeURIComponent(tableId)}/advice`, {}, token),
  /**
   * A QUESTION IN YOUR OWN WORDS, to the agent advising you. Carried by the card room untouched, and
   * always answered by that agent rather than the house — it is the one thing only it can answer in
   * your style. A language-model agent spends its tokens on it, which is why the panel says so first.
   */
  askAdviser: (tableId: string, question: string, token: string) =>
    request<CoachAdvice>(`/tables/${encodeURIComponent(tableId)}/advice?q=${encodeURIComponent(question)}`, {}, token),
  /**
   * HOW HAVE I BEEN PLAYING — your own question about your past hands, in your own words. Your agent
   * forwards it to the coach you named, which reads the hands this card room recorded to your vault
   * and answers in its own name. Takes longer than a sentence mid-hand; asked only when you ask.
   */
  reviewHands: (tableId: string, question: string, token: string) =>
    request<CoachReview>(`/tables/${encodeURIComponent(tableId)}/review?q=${encodeURIComponent(question)}`, {}, token),
  /**
   * HOW HAVE I BEEN PLAYING OVER THE LAST N DAYS — not about any one table. Your own agent forwards it to the
   * coach you hired; the coach reads the hands recorded to your vault over that span (seven days unless you
   * say) and answers in its own name.
   */
  reviewDays: (days: number, question: string, token: string, game: 'poker' | 'canasta' = 'poker') =>
    request<CoachReview & { days: number }>(`/me/review?days=${days}&game=${game}${question ? `&q=${encodeURIComponent(question)}` : ''}`, {}, token),
  /** SEND MY PAST HANDS to my own agent, so a coach hired later can read them: every hand I was dealt in the
   *  last N days, at every table this card room can find me at, one record per hand, retried, never awaited. */
  backfillHands: (days: number, token: string, game: 'poker' | 'canasta' = 'poker') =>
    request<{ ok: true; days: number; agent: string; tables: number; found: number; queued: number; note: string }>(`/me/hands/backfill?days=${days}&game=${game}`, { method: 'POST' }, token),
  /** DO I HAVE A COACH, AND HAVE I BEEN ASKED — from my own agent (playbook + my preferences record). */
  coachStatus: (token: string, game: 'poker' | 'canasta' = 'poker') =>
    request<{ agent: string | null; coach: string | null; hasGrant?: boolean; asked: { at: string; answer: 'hired' | 'later' | 'no' } | null; advertises?: boolean; note?: string }>(`/me/coach?game=${game}`, {}, token),
  /** I answered the coach question. Written to my vault by my own agent, so it is asked once. */
  coachAnswered: (answer: 'hired' | 'later' | 'no', token: string, game: 'poker' | 'canasta' = 'poker') =>
    request<{ agent: string | null; coach: string | null; asked: { at: string; answer: string } | null }>('/me/coach/asked', { method: 'POST', body: JSON.stringify({ answer, game }) }, token),
  /** The coaching services this card room offers for hire, for one game, each read from its card. */
  coaches: (game: 'poker' | 'canasta' = 'poker') => request<{ coaches: CoachListing[]; hireable: boolean }>(`/coaches?game=${game}`),
  /** The return leg of hiring a coach at your Home. */
  homeCoach: (body: HomeAuthBody, token: string) =>
    request<{ ok: true; coach: { name: string; agent?: string; grantHash?: string } }>('/me/coach', { method: 'POST', body: JSON.stringify(body) }, token),
  /** Name the agent that advises YOU at this table. The card room checks it advertises the skill. */
  /** Your own agent by NAME, reverse-resolved from the address your Home asserted. `agentName` is null
   *  when the chain has no primary name for it — which is a fact to show, not a field to guess at. */
  myAgent: (token: string) =>
    request<{ address: string | null; agentName: string | null; asserted: string | null }>('/me/agent', {}, token),
  /** Who is advising you at this table right now — the table's answer, never the client's memory. */
  getAdviser: (tableId: string, token: string) =>
    request<{ adviser: { agentName: string; displayName: string } | null }>(
      `/tables/${encodeURIComponent(tableId)}/adviser`,
      {},
      token,
    ),
  setAdviser: (tableId: string, agentName: string, token: string) =>
    request<{ adviser: { agentName: string; displayName: string } | null }>(
      `/tables/${encodeURIComponent(tableId)}/adviser`,
      { method: 'POST', body: JSON.stringify({ agentName }) },
      token,
    ),
  /** Back to the house coach. */
  clearAdviser: (tableId: string, token: string) =>
    request<{ adviser: null }>(`/tables/${encodeURIComponent(tableId)}/adviser`, { method: 'DELETE' }, token),
  /**
   * The agents this card room can seat for a game.
   *
   * Narrowed by game on purpose: an agent that plays poker cannot play canasta, and offering one at
   * the other's table is offering a seat the card room will refuse a moment later.
   */
  listAgents: (game: string) => request<{ agents: AgentListing[] }>(`/agents?game=${encodeURIComponent(game)}`, {}),
  /** Sit an agent down. The card room resolves it, fetches its card, and refuses one that cannot play. */
  /** Stand an agent up and cash it out. Anybody signed in may; it is the house's seat, not a person's. */
  unseatAgent: (tableId: string, seat: number, token: string) =>
    request<unknown>(`/tables/${encodeURIComponent(tableId)}/seat-agent/${seat}`, { method: 'DELETE' }, token),
  seatAgent: (tableId: string, body: { seat: number; buyIn: number; agentName: string; displayName?: string }, token: string) =>
    request<{ seated: true }>(`/tables/${encodeURIComponent(tableId)}/seat-agent`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** The people you already play with — everyone on the roster of a club of yours, but you. */
  knownPeople: (token: string) => request<{ people: KnownPerson[] }>('/people', {}, token),
  /** The host's own words about their club. It is what an invitation actually says. */
  setWelcome: (clubId: string, welcome: string, token: string) =>
    request<{ welcome?: string }>(`/clubs/${encodeURIComponent(clubId)}/welcome`, { method: 'PUT', body: JSON.stringify({ welcome }) }, token),
  /** This person's own subscription URL for the club's nights. `webcal:` is the one a phone wants. */
  calendarUrl: (clubId: string, token: string) =>
    request<{ url: string; webcal: string }>(`/clubs/${encodeURIComponent(clubId)}/calendar`, {}, token),

  /* ------------------------------------------------- when the club meets */

  /** The rule, or null. A member may read it; only a host may set it. */
  getSchedule: (clubId: string, token: string) =>
    request<{ schedule: ClubSchedule | null }>(`/clubs/${encodeURIComponent(clubId)}/schedule`, {}, token),
  /** Set or replace it. Comes back with the nights it materialised, so the screen needs no second read. */
  setSchedule: (clubId: string, body: SetSchedule, token: string) =>
    request<{ schedule: ClubSchedule; nights: Night[] }>(
      `/clubs/${encodeURIComponent(clubId)}/schedule`,
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    ),
  /** Stop meeting on a rule. The nights it already made are left alone — people were told about those. */
  clearSchedule: (clubId: string, token: string) =>
    request<{ retired: true }>(`/clubs/${encodeURIComponent(clubId)}/schedule`, { method: 'DELETE' }, token),
  /** The next few, materialised ahead so an invitation always has a night to be about. */
  getNights: (clubId: string, token: string, limit = 8) =>
    request<{ nights: Night[] }>(`/clubs/${encodeURIComponent(clubId)}/nights?limit=${limit}`, {}, token),
  /** `skip` takes just this one out of the series; without it the night is called off. */
  /** THE GUEST: the series' standing guest, or one night's (a mission, none, or back to the series'). */
  setScheduleGuest: (clubId: string, entryId: string | null, token: string) =>
    request<{ schedule: ClubSchedule; nights: Night[] }>(`/clubs/${encodeURIComponent(clubId)}/schedule/guest`, { method: 'PUT', body: JSON.stringify({ entryId }) }, token),
  /** ONE NIGHT'S VISIT (cr:MissionVisit): the mission, who comes on its behalf, where it stands — or none, or the series'. */
  setNightVisit: (clubId: string, nightId: string, body: SetVisitRequest, token: string) =>
    request<{ night: Night }>(`/clubs/${encodeURIComponent(clubId)}/nights/${encodeURIComponent(nightId)}/guest`, { method: 'PUT', body: JSON.stringify(body) }, token),
  /** A ONE-TIME NIGHT beside the series. */
  addNight: (clubId: string, body: AddNightRequest, token: string) =>
    request<{ night: Night; nights: Night[] }>(`/clubs/${encodeURIComponent(clubId)}/nights`, { method: 'POST', body: JSON.stringify(body) }, token),
  cancelNight: (clubId: string, nightId: string, body: { reason?: string; skip?: boolean }, token: string) =>
    request<{ night: Night }>(
      `/clubs/${encodeURIComponent(clubId)}/nights/${encodeURIComponent(nightId)}/cancel`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  /**
   * Close a club for good. Its host only, and only when nobody is sitting at one of its tables.
   *
   * `agent` comes back when the club was chartered — the card room cannot touch that Smart Agent and
   * must not let a host believe it did.
   */
  retireClub: (clubId: string, token: string) =>
    request<{ retired: true; name: string; members: number; tablesClosed: string[]; agent?: string }>(
      `/clubs/${encodeURIComponent(clubId)}`,
      { method: 'DELETE' },
      token,
    ),
  /**
   * Close a table. Whoever opened it, or a host of its club — the card room checks, not this.
   *
   * The table's own condition is that nobody is seated: a seat holds chips, and at a settled table
   * those chips are money.
   */
  closeTable: (tableId: string, token: string, club?: string) =>
    request<{ retired: true; tableId: string; name: string }>(
      `/tables/${encodeURIComponent(tableId)}${club ? `?club=${encodeURIComponent(club)}` : ''}`,
      { method: 'DELETE' },
      token,
    ),
  getTable: (id: string, token?: string) => request<TableDetail>(`/tables/${encodeURIComponent(id)}`, {}, token),

  /** The treasury that funds this session's play, its live balance, and what else it could be. */
  getTreasury: (token: string) => request<TreasuryView>('/treasury', {}, token),
  /** Everything between signing in and sitting down, in one call: a treasury, a stake, the authority.
   *  Answers with what it did and what (if anything) the player's own Home still has to do. */
  quickStart: (token: string) => request<StakeResult>('/treasury/quick-start', { method: 'POST', body: '{}' }, token),
  /** Ask the card room to fund play from `address`. It checks custody on chain before agreeing. */
  selectTreasury: (address: string, token: string) =>
    request<SelectTreasuryResult>('/treasury/select', { method: 'POST', body: JSON.stringify({ address }) }, token),
  /** Charter a treasury under this player's person agent. A real player is handed to their own Home. */
  createTreasury: (label: string | undefined, token: string) =>
    request<CreateTreasuryResult>('/treasury/create', { method: 'POST', body: JSON.stringify(label ? { label } : {}) }, token),
  /** Authorise buy-ins from the chosen treasury. Pass a delegation the player's Home issued, or none
   *  to have a Home-custodied identity sign the terms this table would ask for. */
  signMandate: (delegation: unknown | undefined, token: string) =>
    request<MandateResult>('/treasury/mandate', { method: 'POST', body: JSON.stringify(delegation ? { delegation } : {}) }, token),
  /** Mint test Sheqels into the chosen treasury. Test assets only; the Worker refuses anything else. */
  fundTreasury: (amount: string, token: string) =>
    request<FundTreasuryResult>('/treasury/fund', { method: 'POST', body: JSON.stringify({ amount }) }, token),
  /** Where this player's money at a table has got to. Scoped to the caller by the Worker. */
  getTableSettlement: (id: string, token: string) =>
    request<TableSettlement>(`/tables/${encodeURIComponent(id)}/settlement`, {}, token),
};

/** WebSocket URL for a table, derived from API_BASE (relative or absolute). */
export function tableSocketUrl(tableId: string, token: string | null): string {
  const path = `/tables/${encodeURIComponent(tableId)}/ws`;
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  if (/^https?:\/\//i.test(API_BASE)) {
    return API_BASE.replace(/^http/i, 'ws') + path + q;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${API_BASE}${path}${q}`;
}

/** THE ROOM's manifest and who is in it; reading it also lays the room's tables out again. */
export const roomApi = { room: (roomId: string, token: string) => request<{ manifest: unknown; people: unknown[] }>(`/rooms/${encodeURIComponent(roomId)}`, {}, token) };

/** THE ROOM's socket (docs/SPATIAL-ROOM.md) — a body's presence, never a card. */
export function roomSocketUrl(roomId: string, token: string): string {
  const path = `/rooms/${encodeURIComponent(roomId)}/ws?token=${encodeURIComponent(token)}`;
  if (/^https?:\/\//i.test(API_BASE)) return API_BASE.replace(/^http/i, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${API_BASE}${path}`;
}
