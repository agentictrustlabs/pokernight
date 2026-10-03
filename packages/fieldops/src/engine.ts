/**
 * FIELD OPERATIONS — the engine (docs/FIELD-OPERATIONS.md).
 *
 * Pure. The host owns the alarm and the sockets; this owns what a season IS: a day a part spends on one act,
 * what the act may produce, how a week ends and a season closes, what each part can see, and the score. Every
 * outcome is a draw from the seed committed before the season began — `roll` reads the seed and the number of
 * draws so far and nothing else — so a season replays byte-identically from (seed, action log), and the same
 * scenario can be run with two casts and compared, which is what makes it a test of the agents.
 *
 * THE ONE INVARIANT: `state.truth` (each community's readiness) is written at open — and for a community DEFINED in
 * play, once, at its definition, from the seed's own draw. An act reads it through `roll`; no act chooses it, and
 * no view carries it before the reveal.
 */
import { hexToBytes, seededShuffle } from '@pokernight/deal';
import type {
  Body, BodyKind, Casting, CommunityDef, CommunityId, CommunityState, FieldOpsAction, FieldOpsEvent, FieldOpsState, FieldOpsView,
  Operator, PartnerDef, PhaseN, Region, Role, RoleId, Scenario, Score, TeamId, TeamState, TownId, TrailEventDef, ViewBody, ViewCommunity, ViewPerson,
} from './types.js';
import { PHASE_FRAMEWORK } from './types.js';
import { floorCounts, generationsOf, phaseOf } from './phases.js';

export const DAYS_PER_WEEK = 7;
export const INTERLUDE_MS = 20_000;
/** A circle not gathered for this many days stalls at the week's end. */
export const STALL_AFTER_DAYS = 12;
const ACT_COST = 18;
const NIGHT_REST = 24;
const LOG_CAP = 1200;

export const dayMs = (minutes: number, pace: number): number => Math.max(8_000, Math.round(minutes * 60_000 * pace));

// ── lookups ────────────────────────────────────────────────────────────────────────────────────────────
export const roleOf = (scenario: Scenario, id: RoleId): Role | undefined => scenario.roles.find((r) => r.id === id);
/** A team the SEASON has founded. */
export const teamOf = (state: FieldOpsState, id: TeamId | null | undefined): TeamState | undefined => (state.teams ?? []).find((t) => t.id === id);
/** A team the cast INTENDED — the plan, content. */
export const planOf = (scenario: Scenario, id: TeamId | undefined) => scenario.teams.find((t) => t.id === id);
/** The team a part is on, if any. */
export const myTeam = (state: FieldOpsState, role: RoleId): TeamState | undefined => teamOf(state, (state.membership ?? {})[role]);
export const townOf = (region: Region, id: TownId) => region.towns.find((t) => t.id === id);
/** A community of the region, or one the season defined. */
export const communityOf = (region: Region, id: CommunityId, state?: Pick<FieldOpsState, 'defined'>): CommunityDef | undefined => region.communities.find((c) => c.id === id) ?? (state?.defined ?? []).find((c) => c.id === id);
/** Every community there is: the registry's and the ones defined in play. */
export const communitiesOf = (state: Pick<FieldOpsState, 'defined'>, region: Region): CommunityDef[] => [...region.communities, ...(state.defined ?? [])];
export const partnerOf = (region: Region, id: string): PartnerDef | undefined => region.partners.find((p) => p.id === id);
export const weekOf = (scenario: Scenario, n: number) => scenario.weeks.find((w) => w.n === n) ?? scenario.weeks[scenario.weeks.length - 1]!;
export const bodyOf = (state: FieldOpsState, id: string): Body | undefined => state.bodies.find((b) => b.id === id);
export const corridorOfTown = (region: Region, town: TownId) => region.corridors.find((c) => c.towns.includes(town));

/**
 * PROVE A SCENARIO BEFORE ANYBODY PLAYS IT: every intended team's member is a part, every part's home is a town,
 * every community's towns are in its corridor, every partner's town exists, exactly one steward, at least one
 * worker per intended team, and the registry floor is a real phase. A world that fails here is refused at authoring time.
 */
export function checkScenario(scenario: Scenario, region: Region): string[] {
  const out: string[] = [];
  const roles = new Set(scenario.roles.map((r) => r.id));
  const towns = new Set(region.towns.map((t) => t.id));
  const teams = new Set(scenario.teams.map((t) => t.id));
  if (scenario.roles.filter((r) => r.kind === 'steward').length !== 1) out.push('exactly one steward publishes readings');
  for (const t of scenario.teams) {
    if (!towns.has(t.home)) out.push(`team ${t.id} is based in "${t.home}", which is not a town here`);
    for (const m of t.members) if (!roles.has(m)) out.push(`team ${t.id} lists ${m}, which is not a part`);
    if (!t.members.some((m) => roleOf(scenario, m)?.kind === 'worker')) out.push(`team ${t.id} has no worker`);
    if (!region.corridors.some((c) => c.id === t.corridor)) out.push(`team ${t.id} works a corridor "${t.corridor}" that does not exist`);
  }
  for (const r of scenario.roles) {
    if (!towns.has(r.home)) out.push(`${r.id} starts in "${r.home}", which is not a town here`);
    if ((r.kind === 'worker' || r.kind === 'coach') && (!r.team || !teams.has(r.team))) out.push(`${r.id} is a ${r.kind} who intends no team`);
    if (r.kind === 'partner' && (!r.partner || !partnerOf(region, r.partner))) out.push(`${r.id} speaks for no partner church`);
  }
  for (const c of region.communities) {
    const corr = region.corridors.find((x) => x.id === c.corridor);
    if (!corr) out.push(`${c.id} is in corridor "${c.corridor}", which does not exist`);
    for (const t of c.towns) if (corr && !corr.towns.includes(t)) out.push(`${c.id} names ${t}, which is not in its corridor`);
    if (!c.towns.length) out.push(`${c.id} has no towns`);
    if (c.registry.phase < 0 || c.registry.phase > 7) out.push(`${c.id} opens at phase ${c.registry.phase}`);
  }
  for (const p of region.partners) if (!towns.has(p.town)) out.push(`partner ${p.id} is in "${p.town}", which is not a town here`);
  if (region.communities.length < 3) out.push('a field needs at least three communities');
  if (scenario.weeks.length < 1) out.push('a season needs at least one week');
  return out;
}

// ── the seed stream ────────────────────────────────────────────────────────────────────────────────────
/** One draw in [0, 1), the n-th of the season: the seed and the count decide it, and nothing else. */
export function drawAt(seedHex: string, n: number): number {
  const bytes = hexToBytes(seedHex);
  let h = 0x811c9dc5 ^ (n * 0x9e3779b1);
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= n; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0; h ^= h >>> 16;
  // mulberry32 one step from the mixed seed
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function roll(s: FieldOpsState): number {
  const v = drawAt(s.seedHex ?? '00000000000000000000000000000000', s.rolls);
  s.rolls += 1;
  return v;
}

// ── open ───────────────────────────────────────────────────────────────────────────────────────────────
const bodyName = (region: Region, c: CommunityDef, kind: BodyKind, town: TownId, n: number): string =>
  `${c.people.name} ${kind} · ${townOf(region, town)?.name ?? town} #${n}`;

/** A body begins with no agent: the host charters one as the founder's own act and attaches it when it lands. */
function newBody(s: FieldOpsState, region: Region, c: CommunityDef, kind: BodyKind, town: TownId, team: TeamId | null, day: number, by: RoleId | null, parent: Body | null): Body {
  const n = s.bodies.filter((b) => b.community === c.id && b.kind === kind).length + 1;
  return {
    id: `${kind}-${c.id}-${n}`, kind, community: c.id, town, team, foundedDay: day, parent: parent?.id ?? null,
    generation: parent ? parent.generation + 1 : 1, recognizedFrom: null,
    participants: 0, believers: 0, baptized: 0, leaders: 0, lifecycle: 'Forming', facilitator: by, lastGatheredDay: day,
    agent: null, name: bodyName(region, c, kind, town, n),
  };
}

/**
 * THE HOST ATTACHES AN AGENT it chartered to a team or a body — the one thing outside the engine that writes into a
 * season, and it writes an address and a custodian handle, never an outcome. Pure: a new state.
 */
export function attachAgent(state: FieldOpsState, ref: { team: TeamId } | { body: string }, agent: string, custodian: string): FieldOpsState {
  const s = clone(state);
  if ('team' in ref) { const t = teamOf(s, ref.team); if (t) { t.agent = agent; t.custodian = custodian; } }
  else { const b = bodyOf(s, ref.body); if (b) { b.agent = agent; b.custodian = custodian; } }
  return s;
}

export function openStaging(args: {
  scenario: Scenario; region: Region; cast: Casting[]; seedHex: string; seedCommit: string; now: number; pace?: number;
}): FieldOpsState {
  const { scenario, region, cast, seedHex, seedCommit, now } = args;
  const pace = Math.max(0.05, Math.min(2, args.pace ?? 1));
  const seed = hexToBytes(seedHex);
  const where: Record<RoleId, TownId> = {};
  const energy: Record<RoleId, number> = {};
  for (const c of cast) { where[c.role] = roleOf(scenario, c.role)?.home ?? region.towns[0]!.id; energy[c.role] = 100; }
  // THE DRAW: each community's readiness is the author's base, perturbed by the seed — committed, hidden, revealed.
  const order = seededShuffle(region.communities.map((c) => c.id), seed);
  const truth: FieldOpsState['truth'] = {};
  let n = 0;
  for (const id of order) {
    const def = communityOf(region, id)!;
    const jitter = (drawAt(seedHex, 100_000 + n++) - 0.5) * 0.3;
    truth[id] = { readiness: Math.max(0.05, Math.min(0.95, def.base.readiness + jitter)) };
  }
  const s: FieldOpsState = {
    scenario: scenario.id, region: region.id, seedCommit, seedHex, cast, pace,
    day: 1, week: 1, phase: 'day', deadline: now + dayMs(scenario.dayMinutes, pace), dayStartedAt: now,
    where, acted: {}, energy, coached: {},
    communities: {}, teams: [], membership: {}, worked: {}, defined: [], bodies: [], supports: [], capacity: {},
    trail: [], outcomes: [],
    truth, rolls: 0, log: [], startedAt: now, endedAt: null,
  };
  // THE FLOOR: the registry's phase, as counters and bodies already there. Existing churches belong to no team and get
  // no agent — they are the registry's claim made concrete, not something the season founded.
  for (const c of region.communities) {
    const f = floorCounts(c.registry.phase);
    const team = null;
    s.communities[c.id] = { ...f, phase: 0, readings: [], observations: [] };
    const gens = Math.max(0, c.registry.phase - 3);
    let parent: Body | null = null;
    for (let g = 1; g <= gens; g++) {
      const town = c.towns[Math.min(g - 1, c.towns.length - 1)]!;
      const b: Body = {
        id: `church-${c.id}-${g}`, kind: 'church', community: c.id, town, team, foundedDay: 0, parent: parent?.id ?? null,
        generation: g, recognizedFrom: null, participants: 12, believers: 9, baptized: 6, leaders: 2, lifecycle: 'Established',
        facilitator: null, lastGatheredDay: 0, agent: null, name: `${c.people.name} church · ${townOf(region, town)?.name ?? town} (on the registry's word)`,
      };
      s.bodies.push(b);
      parent = b;
    }
    s.communities[c.id]!.phase = phaseOf(c, s.communities[c.id]!, s.bodies).phase;
  }
  const w1 = weekOf(scenario, 1);
  s.log.push({ type: 'cue', at: now, text: w1.opening, by: 'house' });
  s.log.push({ type: 'day', at: now, day: 1, week: 1, phase: 'day', deadline: s.deadline });
  return s;
}

/** A state written by an older engine is still a season: every list reads as empty rather than undefined. */
const clone = (s: FieldOpsState): FieldOpsState => ({
  ...s,
  cast: (s.cast ?? []).slice(), where: { ...s.where }, acted: { ...s.acted }, energy: { ...s.energy }, coached: { ...s.coached },
  communities: Object.fromEntries(Object.entries(s.communities ?? {}).map(([k, v]) => [k, { ...v, readings: v.readings.slice(), observations: v.observations.slice() }])),
  teams: (s.teams ?? []).map((t) => ({ ...t, members: t.members.slice(), invited: t.invited.slice(), declined: t.declined.slice() })), membership: { ...(s.membership ?? {}) },
  worked: { ...(s.worked ?? {}) }, defined: (s.defined ?? []).map((c) => ({ ...c })),
  bodies: (s.bodies ?? []).map((b) => ({ ...b })), supports: (s.supports ?? []).slice(), capacity: { ...s.capacity },
  trail: (s.trail ?? []).slice(), outcomes: (s.outcomes ?? []).slice(),
  truth: { ...s.truth }, log: (s.log ?? []).slice(),
});
function push(s: FieldOpsState, ...events: FieldOpsEvent[]): FieldOpsEvent[] {
  s.log = [...s.log, ...events].slice(-LOG_CAP);
  return events;
}

/** After an act touched a community: recompute its phase, and say so once if it moved. */
function settlePhase(s: FieldOpsState, region: Region, id: CommunityId, now: number, events: FieldOpsEvent[]): void {
  const def = communityOf(region, id, s);
  const c = s.communities[id];
  if (!def || !c) return;
  const { phase } = phaseOf(def, c, s.bodies);
  if (phase !== c.phase) { const from = c.phase; c.phase = phase; events.push(...push(s, { type: 'phase', at: now, day: s.day, community: id, from, to: phase })); }
}

/** Does this part speak a community's language? A barrier is a thing a near-culture worker gets past. */
export function speaks(role: Role, def: CommunityDef): boolean {
  const lang = (def.people.language ?? '').toLowerCase();
  if (!lang) return false;
  return role.languages.some((l) => { const x = l.toLowerCase(); return x === lang || lang.includes(x) || x.includes(lang); });
}
/** A barrier on this community today, that this part cannot get past. */
export function barrierAgainst(s: FieldOpsState, region: Region, role: Role, community: CommunityId): boolean {
  const def = communityOf(region, community, s);
  if (!def) return false;
  return s.trail.some((t) => t.kind === 'barrier' && t.target === community && t.until >= s.day) && !speaks(role, def);
}

/**
 * WHAT THE ROAD BRINGS, at the start of a day: one draw decides whether anything happens and another what, from the
 * season's own list; the target is drawn too. A barrier falls on a community somebody has been among and lasts a
 * week; pressure stalls a circle; a calling wavers and a worker is spent; provision fails and a team's capacity
 * drops; grace brings a family asking on its own. Nothing here touches readiness — the road is weather, not soil.
 */
function road(s: FieldOpsState, scenario: Scenario, region: Region, now: number, events: FieldOpsEvent[]): void {
  s.trail = (s.trail ?? []).filter((t) => t.until >= s.day);
  if (!scenario.trail?.length || s.day < 3) return;
  if (roll(s) > 0.34) return;
  const def = scenario.trail[Math.floor(roll(s) * scenario.trail.length)]!;
  const pickFrom = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(roll(s) * xs.length)] : undefined);
  let target: string | null = null; let targetName = ''; let until = s.day;
  switch (def.kind) {
    case 'barrier': {
      const c = pickFrom(communitiesOf(s, region).filter((x) => (s.communities[x.id]?.presenceDays ?? 0) > 0 && !s.trail.some((t) => t.kind === 'barrier' && t.target === x.id)));
      if (!c) return;
      target = c.id; targetName = c.name; until = s.day + (def.days ?? 7);
      break;
    }
    case 'pressure': {
      const b = pickFrom(s.bodies.filter((x) => x.kind === 'circle' && (x.lifecycle === 'Active' || x.lifecycle === 'Forming')));
      if (!b) return;
      b.lifecycle = 'Stalled';
      target = b.id; targetName = b.name; until = s.day + 7;
      events.push(...push(s, { type: 'stalled', at: now, day: s.day, body: b.id, community: b.community }));
      break;
    }
    case 'calling': {
      const w = pickFrom(s.cast.filter((c) => roleOf(scenario, c.role)?.kind === 'worker'));
      if (!w) return;
      s.energy[w.role] = Math.max(0, (s.energy[w.role] ?? 100) - 35);
      target = w.role; targetName = w.name; until = s.day + 1;
      break;
    }
    case 'provision': {
      const t = pickFrom((s.teams ?? []).filter((x) => (s.capacity[x.id] ?? 0) > 0));
      if (!t) return;
      s.capacity[t.id] = Math.max(0, (s.capacity[t.id] ?? 0) - 1);
      target = t.id; targetName = t.name; until = s.day + 1;
      break;
    }
    case 'grace': {
      const c = pickFrom(communitiesOf(s, region).filter((x) => (s.communities[x.id]?.presenceDays ?? 0) > 0));
      if (!c) return;
      s.communities[c.id]!.seekers += 2;
      target = c.id; targetName = c.name; until = s.day;
      break;
    }
  }
  if (!target) return;
  const text = def.text.replace(/\{target\}/g, targetName);
  const entry = { id: def.id, kind: def.kind, day: s.day, target, targetName, until, text };
  if (def.kind === 'barrier' || def.kind === 'pressure') s.trail.push(entry);
  events.push(...push(s, { type: 'trail', at: now, day: s.day, id: def.id, kind: def.kind, target, targetName, text, until }));
}

// ── the clock ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * DAYS, WEEKS, THE CLOSING, THE REVEAL. A day ends when its clock runs out: everybody rests a little, and the next
 * day opens. Every seventh day ends in an INTERLUDE — the week's narration, a stall check (a circle nobody has
 * gathered for twelve days stalls), and a study that nobody progressed fades. After the last week comes the
 * closing, and then the reveal.
 */
export function tick(state: FieldOpsState, scenario: Scenario, region: Region, now: number): { state: FieldOpsState; events: FieldOpsEvent[] } {
  if (state.phase === 'revealed' || state.deadline === null || now < state.deadline) return { state, events: [] };
  const s = clone(state);
  const events: FieldOpsEvent[] = [];
  if (s.phase === 'day') {
    for (const c of s.cast) s.energy[c.role] = Math.min(100, (s.energy[c.role] ?? 100) + NIGHT_REST);
    const weekDone = s.day % DAYS_PER_WEEK === 0;
    if (weekDone) {
      const w = weekOf(scenario, s.week);
      s.phase = 'interlude';
      s.deadline = now + INTERLUDE_MS;
      for (const b of s.bodies) {
        if (b.kind === 'circle' && b.lifecycle === 'Active' && s.day - b.lastGatheredDay > STALL_AFTER_DAYS) { b.lifecycle = 'Stalled'; events.push(...push(s, { type: 'stalled', at: now, day: s.day, body: b.id, community: b.community })); }
      }
      for (const [id, c] of Object.entries(s.communities)) {
        const studied = s.log.some((e) => e.type === 'acted' && e.action === 'study' && e.community === id && e.day > s.day - DAYS_PER_WEEK);
        if (!studied && c.studies > 0) c.studies -= 1;
        settlePhase(s, region, id, now, events);
      }
      events.push(...push(s, { type: 'cue', at: now, text: w.interlude, by: 'house' }));
    } else {
      s.day += 1;
      s.dayStartedAt = now;
      s.deadline = now + dayMs(scenario.dayMinutes, s.pace);
      road(s, scenario, region, now, events);
    }
    events.push(...push(s, { type: 'day', at: now, day: s.day, week: s.week, phase: s.phase, deadline: s.deadline }));
    return { state: s, events };
  }
  if (s.phase === 'interlude') {
    if (s.week >= scenario.weeks.length) {
      s.phase = 'closing';
      s.deadline = now + dayMs(scenario.closingMinutes, s.pace);
    } else {
      s.week += 1;
      s.day += 1;
      s.phase = 'day';
      s.dayStartedAt = now;
      s.deadline = now + dayMs(scenario.dayMinutes, s.pace);
      events.push(...push(s, { type: 'cue', at: now, text: weekOf(scenario, s.week).opening, by: 'house' }));
      road(s, scenario, region, now, events);
    }
    events.push(...push(s, { type: 'day', at: now, day: s.day, week: s.week, phase: s.phase, deadline: s.deadline }));
    return { state: s, events };
  }
  s.phase = 'revealed';
  s.endedAt = now;
  s.deadline = null;
  events.push(...push(s, { type: 'revealed', at: now, seed: s.seedHex ?? '' }));
  return { state: s, events };
}

// ── what a part may do ─────────────────────────────────────────────────────────────────────────────────
type Refusal = { ok: false; code: string; message: string };
type Applied = { ok: true; state: FieldOpsState; events: FieldOpsEvent[] } | Refusal;
const no = (code: string, message: string): Refusal => ({ ok: false, code, message });

const DAY_ACTS: ReadonlyArray<FieldOpsAction['type']> = ['visit', 'share', 'study', 'found', 'gather', 'baptize', 'train', 'recognize', 'send', 'coach', 'report', 'assess', 'support', 'rest', 'found-team', 'define-community'];
/** The team a body this part founds belongs to: its own — or, for the COORDINATOR, who does field work where a team is short, the first team there is. */
const teamFor = (state: FieldOpsState, me: Role): TeamState | undefined => myTeam(state, me.id) ?? (me.kind === 'coordinator' ? state.teams?.[0] : undefined);
/** May this part take communities up for a team — its steward, or the coordinator for any team? */
const stewards = (state: FieldOpsState, me: Role): TeamState | undefined => (me.kind === 'coordinator' ? myTeam(state, me.id) ?? state.teams?.[0] : (myTeam(state, me.id)?.steward === me.id ? myTeam(state, me.id) : undefined));
const FIELD_KINDS = new Set(['worker', 'coach', 'coordinator']);

/** The engine's own list of what this part may do today, here — so a client draws only buttons that are real. */
export function may(state: FieldOpsState, scenario: Scenario, region: Region, role: RoleId): Array<{ action: FieldOpsAction['type']; why?: string }> {
  const me = roleOf(scenario, role);
  if (!me || state.phase === 'revealed') return [];
  const out: Array<{ action: FieldOpsAction['type']; why?: string }> = [{ action: 'move' }, { action: 'say' }, { action: 'whisper' }];
  if (openChoices(state, me).length) out.push({ action: 'choose' });
  // THE BELL: an invitation is answered whenever, and a steward may ask whenever.
  const mine = myTeam(state, role);
  if (invitedTo(state, role).length) out.push({ action: 'join' }, { action: 'decline' });
  if (mine && mine.steward === role && state.cast.some((c) => !state.membership[c.role] && !mine.invited.includes(c.role) && !mine.declined.includes(c.role) && c.role !== role && FIELD_KINDS.has(roleOf(scenario, c.role)?.kind ?? ''))) out.push({ action: 'invite' });
  // THE WORKSPACE WORKS WITH THE COMMUNITIES SOMEBODY TOOK UP: a team's steward adopts them, free, any time.
  if (stewards(state, me) && communitiesOf(state, region).some((c) => !(state.worked ?? {})[c.id])) out.push({ action: 'adopt' });
  if (state.phase !== 'day') return out;
  if ((state.acted[role] ?? 0) >= state.day) return out;
  const here = state.where[role]!;
  // Nobody works among a people nobody has taken up.
  const hereCommunities = communitiesOf(state, region).filter((c) => c.towns.includes(here) && !!(state.worked ?? {})[c.id]);
  if (stewards(state, me) && FIELD_KINDS.has(me.kind)) out.push({ action: 'define-community' });
  const hereBodies = state.bodies.filter((b) => b.town === here && b.lifecycle !== 'RecognizedAsChurch');
  if (FIELD_KINDS.has(me.kind)) {
    // NOTHING IS A TEAM UNTIL SOMEBODY FOUNDS ONE. A part on no team may found one where it stands.
    if (!mine) out.push({ action: 'found-team', why: 'you are on no team' });
    if (hereCommunities.length) {
      out.push({ action: 'visit' }, { action: 'share' });
      if (hereCommunities.some((c) => (state.communities[c.id]?.seekers ?? 0) >= 2 || (state.communities[c.id]?.studies ?? 0) > 0)) out.push({ action: 'study' });
      if (teamFor(state, me) && hereCommunities.some((c) => (state.communities[c.id]?.studies ?? 0) >= 1 && unaffiliated(state, c.id) >= 2)) out.push({ action: 'found' });
    }
    if (hereBodies.length) {
      out.push({ action: 'gather' });
      if (hereBodies.some((b) => b.believers > b.baptized)) out.push({ action: 'baptize' });
      if (hereBodies.some((b) => b.believers >= 3)) out.push({ action: 'train' });
      if (hereBodies.some((b) => b.kind === 'circle' && canRecognize(b))) out.push({ action: 'recognize' });
      if (hereBodies.some((b) => b.kind === 'church' && canSend(b))) out.push({ action: 'send' });
    }
    out.push({ action: 'report' });
  }
  if (me.kind === 'coach' || me.kind === 'coordinator') out.push({ action: 'coach' });
  if (me.kind === 'steward' || me.kind === 'coordinator') out.push({ action: 'assess' });
  if (me.kind === 'partner') {
    const p = me.partner ? partnerOf(region, me.partner) : undefined;
    const used = state.supports.filter((x) => x.partner === me.partner).length;
    if (p && used < p.capacity) out.push({ action: 'support' });
  }
  out.push({ action: 'rest' });
  return out;
}
/** The decisions before a part today: written for it, opened by the day, not yet taken. */
function openChoices(state: FieldOpsState, me: Role) {
  return (me.choices ?? []).filter((c) => state.day >= c.day && !(state.outcomes ?? []).some((o) => o.by === me.id && o.choice === c.id));
}
/** Teams that have asked this part and not been answered. */
export function invitedTo(state: FieldOpsState, role: RoleId): TeamState[] {
  return (state.teams ?? []).filter((t) => t.invited.includes(role));
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
const canRecognize = (b: Body) => b.kind === 'circle' && b.lifecycle === 'Active' && b.believers >= 6 && b.baptized >= 3 && b.leaders >= 1;
const canSend = (b: Body) => b.kind === 'church' && b.lifecycle !== 'Stalled' && b.leaders >= 2 && b.believers >= 8;
/** Believers in a community not yet in any of its bodies — who a new circle can gather. */
function unaffiliated(s: FieldOpsState, community: CommunityId): number {
  const c = s.communities[community];
  if (!c) return 0;
  const inBodies = s.bodies.filter((b) => b.community === community && b.lifecycle !== 'RecognizedAsChurch').reduce((n, b) => n + b.believers, 0);
  return Math.max(0, c.believers - inBodies);
}

/** The strength of a part's attempt today: its gift, its energy, a coach's lift, and its team's support. */
function strength(s: FieldOpsState, scenario: Scenario, me: Role, gift: keyof Role['gifts'], region?: Region, community?: CommunityId): number {
  const e = s.energy[me.id] ?? 100;
  const tired = e < 20 ? 0.6 : e < 45 ? 0.85 : 1;
  const lift = s.coached[me.id] === s.day ? 1.25 : 1;
  const team = s.membership[me.id];
  const cap = team ? Math.min(1.4, 1 + 0.08 * (s.capacity[team] ?? 0)) : 1;
  // A BARRIER halves the work of anybody who does not speak the language; a near-culture worker is unaffected.
  const wall = region && community && barrierAgainst(s, region, me, community) ? 0.5 : 1;
  return Math.min(1.5, me.gifts[gift] * tired * lift * cap * wall);
}

/** One part does one thing. The game validates its own actions; the host never guesses at legality. */
export function apply(state: FieldOpsState, scenario: Scenario, region: Region, role: RoleId, action: FieldOpsAction, now: number, via: Operator = 'human'): Applied {
  if (state.phase === 'revealed') return no('season-over', 'The season is over.');
  const me = roleOf(scenario, role);
  if (!me || !state.cast.some((c) => c.role === role)) return no('not-cast', 'You are not in this season.');
  const here = state.where[role];
  if (!here) return no('nowhere', 'You are not anywhere.');
  const s = clone(state);
  const events: FieldOpsEvent[] = [];
  const isDayAct = (DAY_ACTS as readonly string[]).includes(action.type);
  if (isDayAct) {
    if (s.phase !== 'day') return no('not-a-day', 'The week is between days. Wait for the next one.');
    if ((s.acted[role] ?? 0) >= s.day) return no('spent', 'You have spent today. Tomorrow comes with the clock.');
  }
  const spend = (cost = ACT_COST) => { s.acted[role] = s.day; s.energy[role] = Math.max(0, (s.energy[role] ?? 100) - cost); };
  const hereCommunity = (id: CommunityId): CommunityDef | Refusal => {
    const def = communityOf(region, id, s);
    if (!def) return no('no-community', 'No such community.');
    if (!(s.worked ?? {})[def.id]) return no('not-worked', `Nobody has taken the ${def.people.name} up. A team's steward adopts a community before anybody works among them.`);
    if (!def.towns.includes(here)) return no('not-here', `${def.name} are not in ${townOf(region, here)?.name ?? here}. Move first.`);
    return def;
  };
  const hereBody = (id: string): Body | Refusal => {
    const b = bodyOf(s, id);
    if (!b) return no('no-body', 'No such circle or church.');
    if (b.town !== here) return no('not-here', `${b.name} meets in ${townOf(region, b.town)?.name ?? b.town}. Move first.`);
    if (b.lifecycle === 'RecognizedAsChurch') return no('recognized', 'That circle became a church; work with the church.');
    return b;
  };
  const acted = (type: Extract<FieldOpsEvent, { type: 'acted' }>['action'], community: CommunityId | null, body: string | null, text: string, outcome: Extract<FieldOpsEvent, { type: 'acted' }>['outcome']) =>
    events.push(...push(s, { type: 'acted', at: now, by: role, day: s.day, town: here, action: type, community, body, text, outcome, via }));
  const fieldOnly = () => (FIELD_KINDS.has(me.kind) ? null : no('not-field', 'That is field work; a partner or the steward does not do it.'));

  switch (action.type) {
    case 'move': {
      if (action.town === here) return no('already-here', 'You are already there.');
      const to = townOf(region, action.town);
      if (!to) return no('no-town', 'No such town.');
      s.where[role] = action.town;
      s.energy[role] = Math.max(0, (s.energy[role] ?? 100) - (corridorOfTown(region, here)?.id === to.corridor ? 4 : 10));
      events.push(...push(s, { type: 'moved', at: now, who: role, from: here, to: action.town, day: s.day }));
      break;
    }
    case 'say': {
      const text = action.text.trim().slice(0, 280);
      if (!text) return no('empty', 'Say something.');
      if (via === 'agent') {
        const mine = s.log.filter((e): e is Extract<FieldOpsEvent, { type: 'said' }> => e.type === 'said' && e.by === role).slice(-5);
        if (mine.some((e) => e.text.toLowerCase() === text.toLowerCase())) return no('said-that', 'You said that already.');
      }
      events.push(...push(s, { type: 'said', at: now, by: role, town: here, text, via }));
      break;
    }
    case 'whisper': {
      if (!s.cast.some((c) => c.role === action.to)) return no('not-cast', 'They are not in this season.');
      const text = action.text.trim().slice(0, 280);
      if (!text) return no('empty', 'Say something.');
      events.push(...push(s, { type: 'whispered', at: now, by: role, to: action.to, text }));
      break;
    }
    case 'rest': {
      spend(0);
      s.energy[role] = Math.min(100, (s.energy[role] ?? 100) + 40);
      acted('rest', null, null, me.lines.rest, {});
      break;
    }
    case 'visit': {
      const f = fieldOnly(); if (f) return f;
      const def = hereCommunity(action.community); if ('ok' in def) return def;
      const c = s.communities[def.id]!;
      spend(14);
      presence(s, def.id);
      c.visits += 1;
      const p = 0.3 + 0.45 * s.truth[def.id]!.readiness * strength(s, scenario, me, 'share', region, def.id);
      const out: Extract<FieldOpsEvent, { type: 'acted' }>['outcome'] = {};
      if (roll(s) < p) { c.seekers += 1; out.seekers = 1; }
      acted('visit', def.id, null, out.seekers ? `Visited ${def.people.name} households in ${townOf(region, here)?.name}; somebody asked to hear more.` : `Visited ${def.people.name} households in ${townOf(region, here)?.name}.`, out);
      settlePhase(s, region, def.id, now, events);
      break;
    }
    case 'share': {
      const f = fieldOnly(); if (f) return f;
      const def = hereCommunity(action.community); if ('ok' in def) return def;
      const c = s.communities[def.id]!;
      spend();
      presence(s, def.id);
      c.conversations += 1;
      const r = s.truth[def.id]!.readiness;
      const out: Extract<FieldOpsEvent, { type: 'acted' }>['outcome'] = {};
      if (roll(s) < 0.25 + 0.5 * r * strength(s, scenario, me, 'share', region, def.id)) { c.seekers += 1; out.seekers = 1; }
      if (c.seekers > 0 && roll(s) < 0.15 + 0.35 * r * strength(s, scenario, me, 'disciple', region, def.id)) { c.seekers -= 1; c.believers += 1; out.believers = 1; }
      acted('share', def.id, null, out.believers ? `A gospel conversation among the ${def.people.name}: one of them believed.` : out.seekers ? `A gospel conversation among the ${def.people.name}; one more wants to keep talking.` : `A gospel conversation among the ${def.people.name}.`, out);
      settlePhase(s, region, def.id, now, events);
      break;
    }
    case 'study': {
      const f = fieldOnly(); if (f) return f;
      const def = hereCommunity(action.community); if ('ok' in def) return def;
      const c = s.communities[def.id]!;
      if (c.studies < 1 && c.seekers < 2) return no('no-seekers', 'A study needs two who want to read. Share first.');
      spend();
      presence(s, def.id);
      const out: Extract<FieldOpsEvent, { type: 'acted' }>['outcome'] = {};
      if (c.studies < 1) { c.studies += 1; out.studies = 1; }
      else if (c.seekers > 0 && roll(s) < 0.3 + 0.45 * s.truth[def.id]!.readiness * strength(s, scenario, me, 'disciple', region, def.id)) { c.seekers -= 1; c.believers += 1; out.believers = 1; }
      acted('study', def.id, null, out.studies ? `A discovery study began among the ${def.people.name} in ${townOf(region, here)?.name}.` : out.believers ? `The ${def.people.name} study met; one who had been reading believed.` : `The ${def.people.name} study met.`, out);
      settlePhase(s, region, def.id, now, events);
      break;
    }
    case 'found': {
      const f = fieldOnly(); if (f) return f;
      const def = hereCommunity(action.community); if ('ok' in def) return def;
      const c = s.communities[def.id]!;
      if (c.studies < 1) return no('no-study', 'A circle comes out of a study. Start one first.');
      const free = unaffiliated(s, def.id);
      if (free < 2) return no('too-few', 'A circle needs at least two believers who are not already in one.');
      const team = teamFor(s, me);
      if (!team) return no('no-team', 'A circle belongs to a team. Found one, or join one that asked you, first.');
      spend();
      presence(s, def.id);
      c.studies -= 1;
      const b = newBody(s, region, def, 'circle', here, team.id, s.day, role, null);
      b.believers = Math.min(free, 4);
      b.participants = b.believers + Math.min(c.seekers, 3);
      s.bodies.push(b);
      events.push(...push(s, { type: 'founded', at: now, by: role, day: s.day, body: b.id, kind: 'circle', community: def.id, town: here, generation: 1, agent: b.agent, name: b.name }));
      acted('found', def.id, b.id, `${b.name} formed from the study — ${b.believers} believers and their friends.`, { body: b.id, participants: b.participants });
      settlePhase(s, region, def.id, now, events);
      break;
    }
    case 'gather': {
      const f = fieldOnly(); if (f) return f;
      const b = hereBody(action.body); if ('ok' in b) return b;
      const def = communityOf(region, b.community, s)!;
      const c = s.communities[b.community]!;
      spend();
      presence(s, b.community);
      b.lastGatheredDay = s.day;
      const out: Extract<FieldOpsEvent, { type: 'acted' }>['outcome'] = {};
      const grew = Math.floor(roll(s) * 3);
      if (grew) { b.participants += grew; out.participants = grew; }
      if (b.participants > b.believers && roll(s) < 0.25 + 0.4 * s.truth[def.id]!.readiness * strength(s, scenario, me, 'gather', region, def.id)) { b.believers += 1; c.believers += 1; out.believers = 1; }
      if (b.lifecycle === 'Forming' && s.day - b.foundedDay >= 2) b.lifecycle = 'Active';
      if (b.lifecycle === 'Stalled') b.lifecycle = 'Active';
      acted('gather', b.community, b.id, out.believers ? `${b.name} gathered; one more believed.` : grew ? `${b.name} gathered, ${grew} new at the door.` : `${b.name} gathered.`, out);
      settlePhase(s, region, b.community, now, events);
      break;
    }
    case 'baptize': {
      const f = fieldOnly(); if (f) return f;
      const b = hereBody(action.body); if ('ok' in b) return b;
      if (b.believers <= b.baptized) return no('nobody-to-baptize', 'Everybody who believes there has been baptised.');
      spend();
      presence(s, b.community);
      const k = Math.min(1 + Math.floor(roll(s) * 3), b.believers - b.baptized);
      b.baptized += k;
      s.communities[b.community]!.baptized += k;
      acted('baptize', b.community, b.id, `${k} baptised from ${b.name}.`, { baptized: k });
      settlePhase(s, region, b.community, now, events);
      break;
    }
    case 'train': {
      const f = fieldOnly(); if (f) return f;
      const b = hereBody(action.body); if ('ok' in b) return b;
      if (b.believers < 3) return no('too-few', 'Leaders are raised from among believers; there are not three yet.');
      spend();
      presence(s, b.community);
      const out: Extract<FieldOpsEvent, { type: 'acted' }>['outcome'] = {};
      if (roll(s) < 0.35 + 0.45 * strength(s, scenario, me, 'lead')) { b.leaders += 1; s.communities[b.community]!.leaders += 1; out.leaders = 1; }
      acted('train', b.community, b.id, out.leaders ? `Leadership training at ${b.name}: one is ready to lead.` : `Leadership training at ${b.name}.`, out);
      break;
    }
    case 'recognize': {
      const f = fieldOnly(); if (f) return f;
      const b = hereBody(action.body); if ('ok' in b) return b;
      if (b.kind !== 'circle') return no('not-a-circle', 'That is already a church.');
      if (!canRecognize(b)) return no('not-yet', 'A church is recognised when a circle is active with six believers, three baptised and a leader of its own.');
      spend();
      presence(s, b.community);
      const def = communityOf(region, b.community, s)!;
      const parent = b.parent ? bodyOf(s, b.parent) ?? null : null;
      const church = newBody(s, region, def, 'church', here, b.team, s.day, role, parent);
      church.generation = b.generation; church.recognizedFrom = b.id; church.parent = b.parent;
      church.participants = b.participants; church.believers = b.believers; church.baptized = b.baptized; church.leaders = b.leaders;
      church.lifecycle = 'Established';
      b.lifecycle = 'RecognizedAsChurch';
      s.bodies.push(church);
      events.push(...push(s, { type: 'recognized', at: now, by: role, day: s.day, circle: b.id, church: church.id, community: def.id, town: here, agent: church.agent, name: church.name }));
      acted('recognize', def.id, church.id, `${b.name} recognised as a church: ${church.name}.`, { body: church.id });
      settlePhase(s, region, def.id, now, events);
      break;
    }
    case 'send': {
      const f = fieldOnly(); if (f) return f;
      const b = hereBody(action.body); if ('ok' in b) return b;
      if (b.kind !== 'church') return no('not-a-church', 'A circle does not send; a church does.');
      if (!canSend(b)) return no('not-yet', 'A church sends when it has two leaders and eight believers to spare one of.');
      const to = townOf(region, action.town);
      if (!to) return no('no-town', 'No such town.');
      const def = communityOf(region, b.community, s)!;
      const corr = region.corridors.find((x) => x.id === def.corridor);
      if (!corr?.towns.includes(to.id)) return no('too-far', `${to.name} is outside the ${def.name} corridor.`);
      // A DAUGHTER BELONGS TO A TEAM: the mother's, or — when the mother is the registry's own floor church, which belongs
      // to none — the sender's. Nobody on no team sends one out, because a circle belongs to a team.
      const team = b.team ?? teamFor(s, me)?.id ?? null;
      if (!team) return no('no-team', 'A circle belongs to a team. Join one before you send a church\'s families out.');
      spend();
      presence(s, b.community);
      const daughter = newBody(s, region, def, 'circle', to.id, team, s.day, role, b);
      daughter.believers = 2; daughter.participants = 4; daughter.leaders = 1; daughter.lifecycle = 'Forming';
      b.believers -= 2; b.leaders -= 1; b.participants = Math.max(b.believers, b.participants - 2);
      b.lifecycle = 'Multiplying';
      s.bodies.push(daughter);
      events.push(...push(s, { type: 'founded', at: now, by: role, day: s.day, body: daughter.id, kind: 'circle', community: def.id, town: to.id, generation: daughter.generation, agent: daughter.agent, name: daughter.name }));
      acted('send', def.id, daughter.id, `${b.name} sent a leader and two families to ${to.name}: ${daughter.name} begins, generation ${daughter.generation}.`, { body: daughter.id });
      settlePhase(s, region, def.id, now, events);
      break;
    }
    case 'coach': {
      if (me.kind !== 'coach' && me.kind !== 'coordinator') return no('not-a-coach', 'Coaching is a coach’s act.');
      const who = roleOf(scenario, action.who);
      if (!who || !s.cast.some((c) => c.role === who.id)) return no('not-cast', 'They are not in this season.');
      if (who.id === role) return no('self', 'Coach somebody else.');
      if (me.kind === 'coach' && (!s.membership[role] || s.membership[who.id] !== s.membership[role])) return no('not-your-team', 'A coach coaches their own team.');
      spend(10);
      s.coached[who.id] = s.day;
      s.energy[who.id] = Math.min(100, (s.energy[who.id] ?? 100) + 15);
      acted('coach', null, null, `Coached ${who.name}.`, {});
      break;
    }
    case 'adopt': {
      const team = stewards(s, me);
      if (!team) return no('not-steward', 'A team\'s steward takes communities up for it.');
      const ids = [...new Set(action.communities)].filter((id) => communityOf(region, id, s) && !(s.worked ?? {})[id]);
      if (!ids.length) return no('nothing-to-adopt', 'Every community named is taken up already, or does not exist.');
      s.worked = { ...(s.worked ?? {}) };
      for (const id of ids) s.worked[id] = team.id;
      events.push(...push(s, { type: 'adopted', at: now, by: role, day: s.day, team: team.id, communities: ids }));
      break;
    }
    case 'define-community': {
      const team = stewards(s, me);
      if (!team) return no('not-steward', 'A team\'s steward defines a community for it.');
      if (!FIELD_KINDS.has(me.kind)) return no('not-field', 'That is field work.');
      const name = action.name.trim().slice(0, 80); const people = action.people.trim().slice(0, 60); const definition = action.definition.trim().slice(0, 400);
      if (!name || !people || !definition) return no('empty', 'A community has a name, a people and a definition in your own words.');
      const town = townOf(region, action.town);
      if (!town) return no('no-town', 'No such town.');
      const base = `defined-${slug(people)}-${town.id}`;
      let id = base; let n = 2;
      while (communityOf(region, id, s)) id = `${base}-${n++}`;
      spend(10);
      // THE READINESS OF A COMMUNITY DEFINED IN PLAY IS THE SEED'S, drawn at its definition — never the definer's.
      const readiness = 0.2 + 0.6 * roll(s);
      const def: CommunityDef = {
        id, iri: `urn:fieldops:community:${id}`, name: `${people} in ${town.name}`, corridor: town.corridor, towns: [town.id], population: null,
        people: { name: people, iri: `urn:fieldops:people:${slug(people)}`, scheme: 'local', ...(action.language ? { language: action.language.trim().slice(0, 40) } : {}) },
        registry: { phase: 0, qualifier: null, resultDate: null, framework: region.communities[0]?.registry.framework ?? 'fw-npl-phases' },
        claims: [{ label: 'defined in play', value: `by ${me.name}, day ${s.day} — invented`, source: 'game' }],
        base: { readiness }, fictional: true, definedBy: role, definition,
      };
      s.defined = [...(s.defined ?? []), def];
      s.truth = { ...s.truth, [id]: { readiness } };
      s.communities[id] = { ...floorCounts(0), phase: 0, readings: [], observations: [] };
      s.worked = { ...(s.worked ?? {}), [id]: team.id };
      events.push(...push(s, { type: 'defined', at: now, by: role, day: s.day, team: team.id, community: id, name: def.name, town: town.id }));
      acted('define-community', id, null, `Defined a people community: ${def.name} — ${definition.slice(0, 120)}${definition.length > 120 ? '…' : ''}. ${team.name} takes them up.`, {});
      break;
    }
    case 'report': {
      if (me.kind === 'partner') return no('not-field', 'A partner supports; it does not file field observations.');
      const def = communityOf(region, action.community, s);
      if (!def) return no('no-community', 'No such community.');
      const text = action.text.trim().slice(0, 240);
      if (!text) return no('empty', 'Write what you saw.');
      spend(6);
      s.communities[def.id]!.observations.push({ by: role, text, day: s.day, at: now });
      events.push(...push(s, { type: 'reported', at: now, by: role, day: s.day, community: def.id, text }));
      acted('report', def.id, null, `Filed an observation about the ${def.people.name}.`, {});
      break;
    }
    case 'assess': {
      if (me.kind !== 'steward' && me.kind !== 'coordinator') return no('not-steward', 'The progress steward publishes a reading.');
      const def = communityOf(region, action.community, s);
      if (!def) return no('no-community', 'No such community.');
      const c = s.communities[def.id]!;
      spend(8);
      const derived = phaseOf(def, c, s.bodies).phase;
      c.readings.push({ by: role, phase: action.phase, qualifier: action.qualifier ?? null, day: s.day, at: now });
      events.push(...push(s, { type: 'assessed', at: now, by: role, day: s.day, community: def.id, phase: action.phase, qualifier: action.qualifier ?? null, derived }));
      acted('assess', def.id, null, `Published ${def.name} at Phase ${action.phase}.`, {});
      break;
    }
    case 'support': {
      if (me.kind !== 'partner' || !me.partner) return no('not-a-partner', 'Support comes from a partner church.');
      const p = partnerOf(region, me.partner)!;
      const used = s.supports.filter((x) => x.partner === p.id).length;
      if (used >= p.capacity) return no('spent-capacity', `${p.name} has given what it can this season.`);
      const team = teamOf(s, action.team);
      if (!team) return no('no-team', 'No such team — nobody has founded it yet.');
      spend(5);
      const id = `s${s.supports.length + 1}`;
      s.supports.push({ id, partner: p.id, by: role, team: action.team, resource: action.resource, day: s.day, at: now });
      s.capacity[action.team] = (s.capacity[action.team] ?? 0) + 1;
      events.push(...push(s, { type: 'supported', at: now, by: role, day: s.day, partner: p.id, team: action.team, resource: action.resource }));
      acted('support', null, null, `${p.name} committed ${action.resource} to ${team.name}.`, {});
      break;
    }
    case 'found-team': {
      const f = fieldOnly(); if (f) return f;
      if (myTeam(s, role)) return no('on-a-team', 'You are on a team already.');
      const name = action.name.trim().slice(0, 80);
      if (!name) return no('empty', 'A team has a name.');
      if ((s.teams ?? []).some((t) => t.name.toLowerCase() === name.toLowerCase())) return no('taken', 'A team by that name exists; ask to join it.');
      const corr = corridorOfTown(region, here);
      if (!corr) return no('nowhere', 'Found a team in a town of a corridor.');
      const invite = [...new Set((action.invite ?? []).filter((r) => r !== role && s.cast.some((c) => c.role === r) && !s.membership[r] && FIELD_KINDS.has(roleOf(scenario, r)?.kind ?? '')))];
      const base = slug(name);
      let id = `team-${base}`; let n = 2;
      while (teamOf(s, id)) id = `team-${base}-${n++}`;
      spend(10);
      const t: TeamState = { id, name, purpose: action.purpose?.trim().slice(0, 240) || null, corridor: corr.id, home: here, steward: role, members: [role], invited: invite, declined: [], foundedDay: s.day, plan: action.plan && planOf(scenario, action.plan) ? action.plan : null, agent: null };
      s.teams = [...(s.teams ?? []), t];
      s.membership[role] = id;
      events.push(...push(s, { type: 'team-founded', at: now, by: role, day: s.day, team: id, name, corridor: corr.id, home: here, invited: invite }));
      for (const who of invite) events.push(...push(s, { type: 'invited', at: now, by: role, day: s.day, team: id, who }));
      acted('found-team', null, null, invite.length ? `Founded ${name} in ${townOf(region, here)?.name ?? here} and asked ${invite.map((r) => roleOf(scenario, r)?.name ?? r).join(', ')} onto it.` : `Founded ${name} in ${townOf(region, here)?.name ?? here}.`, {});
      break;
    }
    case 'invite': {
      const t = myTeam(s, role);
      if (!t || t.steward !== role) return no('not-steward', 'The team\'s steward asks people onto it.');
      const who = roleOf(scenario, action.who);
      if (!who || !s.cast.some((c) => c.role === who.id)) return no('not-cast', 'They are not in this season.');
      if (!FIELD_KINDS.has(who.kind)) return no('not-field', 'A partner or the steward is not on a field team.');
      if (s.membership[who.id]) return no('on-a-team', `${who.name} is on a team already.`);
      if (t.invited.includes(who.id)) return no('asked', `${who.name} has been asked and has not answered.`);
      t.invited = [...t.invited, who.id]; t.declined = t.declined.filter((r) => r !== who.id);
      events.push(...push(s, { type: 'invited', at: now, by: role, day: s.day, team: t.id, who: who.id }));
      break;
    }
    case 'join': {
      const t = teamOf(s, action.team);
      if (!t) return no('no-team', 'No such team.');
      if (myTeam(s, role)) return no('on-a-team', 'You are on a team already.');
      if (!t.invited.includes(role)) return no('not-asked', `${t.name} has not asked you.`);
      t.invited = t.invited.filter((r) => r !== role); t.members = [...t.members, role];
      s.membership[role] = t.id;
      events.push(...push(s, { type: 'joined', at: now, who: role, day: s.day, team: t.id }));
      break;
    }
    case 'decline': {
      const t = teamOf(s, action.team);
      if (!t) return no('no-team', 'No such team.');
      if (!t.invited.includes(role)) return no('not-asked', `${t.name} has not asked you.`);
      t.invited = t.invited.filter((r) => r !== role); t.declined = [...t.declined, role];
      events.push(...push(s, { type: 'declined', at: now, who: role, day: s.day, team: t.id }));
      break;
    }
    case 'choose': {
      const def = openChoices(s, me).find((c) => c.id === action.choice);
      if (!def) return no('no-choice', 'That decision is not before you.');
      const opt = def.options.find((o) => o.id === action.option);
      if (!opt) return no('no-option', 'That is not one of the options.');
      (s.outcomes ??= []).push({ key: opt.outcome, by: role, choice: def.id, option: opt.id, day: s.day });
      if (opt.effect?.energy) s.energy[role] = Math.max(0, Math.min(100, (s.energy[role] ?? 100) + opt.effect.energy));
      if (opt.effect?.capacity && s.membership[role]) s.capacity[s.membership[role]!] = Math.max(0, (s.capacity[s.membership[role]!] ?? 0) + opt.effect.capacity);
      if (opt.effect?.moveTo && townOf(region, opt.effect.moveTo)) { const from = s.where[role]!; s.where[role] = opt.effect.moveTo; if (from !== opt.effect.moveTo) events.push(...push(s, { type: 'moved', at: now, who: role, from, to: opt.effect.moveTo, day: s.day })); }
      events.push(...push(s, { type: 'chose', at: now, by: role, day: s.day, choice: def.id, option: opt.id, outcome: opt.outcome, text: opt.consequence }));
      break;
    }
    default:
      return no('bad-action', 'Not a thing anybody can do here.');
  }
  return { ok: true, state: s, events };
}
/** A worker among a community today — counted once per day per community. */
function presence(s: FieldOpsState, community: CommunityId): void {
  const c = s.communities[community];
  if (!c) return;
  const already = s.log.some((e) => e.type === 'acted' && e.community === community && e.day === s.day && ['visit', 'share', 'study', 'found', 'gather', 'baptize', 'train', 'recognize', 'send'].includes(e.action));
  if (!already) c.presenceDays += 1;
}

const str = (v: unknown, max = 280): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isPhase = (v: unknown): v is PhaseN => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7;
const RESOURCES = ['funds', 'volunteers', 'venue', 'prayer'];

/** What came over the wire, checked. The game says what its actions are; nobody else guesses. */
export function parseAction(raw: unknown): { ok: true; action: FieldOpsAction } | Refusal {
  if (!raw || typeof raw !== 'object') return no('bad-action', 'An action is an object.');
  const r = raw as Record<string, unknown>;
  const need = (k: string, max = 64) => str(r[k], max);
  switch (r.type) {
    case 'move': return need('town') ? { ok: true, action: { type: 'move', town: r.town as string } } : no('bad-action', 'move needs a town');
    case 'say': return need('text', 280) ? { ok: true, action: { type: 'say', text: r.text as string } } : no('bad-action', 'say needs words');
    case 'whisper': return need('to') && need('text', 280) ? { ok: true, action: { type: 'whisper', to: r.to as string, text: r.text as string } } : no('bad-action', 'whisper needs somebody and words');
    case 'visit': case 'share': case 'study': case 'found':
      return need('community') ? { ok: true, action: { type: r.type, community: r.community as string } } : no('bad-action', `${r.type} needs a community`);
    case 'gather': case 'baptize': case 'train': case 'recognize':
      return need('body') ? { ok: true, action: { type: r.type, body: r.body as string } } : no('bad-action', `${r.type} needs a circle or church`);
    case 'send': return need('body') && need('town') ? { ok: true, action: { type: 'send', body: r.body as string, town: r.town as string } } : no('bad-action', 'send needs a church and a town');
    case 'coach': return need('who') ? { ok: true, action: { type: 'coach', who: r.who as string } } : no('bad-action', 'coach needs somebody');
    case 'report': return need('community') && need('text', 240) ? { ok: true, action: { type: 'report', community: r.community as string, text: r.text as string } } : no('bad-action', 'report needs a community and words');
    case 'assess': return need('community') && isPhase(r.phase) ? { ok: true, action: { type: 'assess', community: r.community as string, phase: r.phase, ...(r.qualifier === 'restart-needed' ? { qualifier: 'restart-needed' as const } : {}) } } : no('bad-action', 'assess needs a community and a phase 0–7');
    case 'support': return need('team') && typeof r.resource === 'string' && RESOURCES.includes(r.resource) ? { ok: true, action: { type: 'support', team: r.team as string, resource: r.resource as 'funds' } } : no('bad-action', 'support needs a team and one of funds, volunteers, venue, prayer');
    case 'choose': return need('choice') && need('option') ? { ok: true, action: { type: 'choose', choice: r.choice as string, option: r.option as string } } : no('bad-action', 'choose needs a choice and an option');
    case 'found-team': {
      if (!need('name', 80)) return no('bad-action', 'found-team needs a name');
      const invite = Array.isArray(r.invite) ? r.invite.filter((x): x is string => typeof x === 'string' && x.length <= 64) : [];
      return { ok: true, action: { type: 'found-team', name: r.name as string, ...(str(r.purpose, 240) ? { purpose: r.purpose as string } : {}), ...(invite.length ? { invite } : {}), ...(need('plan') ? { plan: r.plan as string } : {}) } };
    }
    case 'invite': return need('who') ? { ok: true, action: { type: 'invite', who: r.who as string } } : no('bad-action', 'invite needs somebody');
    case 'adopt': { const communities = Array.isArray(r.communities) ? r.communities.filter((x): x is string => typeof x === 'string' && x.length <= 80) : need('community') ? [r.community as string] : []; return communities.length ? { ok: true, action: { type: 'adopt', communities } } : no('bad-action', 'adopt needs communities'); }
    case 'define-community': return need('name', 80) && need('people', 60) && need('town') && need('definition', 400) ? { ok: true, action: { type: 'define-community', name: r.name as string, people: r.people as string, town: r.town as string, definition: r.definition as string, ...(str(r.language, 40) ? { language: r.language as string } : {}) } } : no('bad-action', 'define-community needs a name, a people, a town and a definition');
    case 'join': case 'decline': return need('team') ? { ok: true, action: { type: r.type, team: r.team as string } } : no('bad-action', `${r.type} needs a team`);
    case 'rest': return { ok: true, action: { type: 'rest' } };
    default: return no('bad-action', `no such action: ${String(r.type)}`);
  }
}

/** The field is an operation, not a secret: only a whisper is private. */
export function redactEvent(_state: FieldOpsState, ev: FieldOpsEvent, role: RoleId | null): FieldOpsEvent | null {
  if (ev.type === 'whispered') return role === null || ev.by === role || ev.to === role ? ev : null;
  return ev;
}

function personView(state: FieldOpsState, scenario: Scenario, region: Region, role: RoleId): ViewPerson {
  const c = state.cast.find((x) => x.role === role);
  const r = roleOf(scenario, role);
  const town = state.where[role] ?? r?.home ?? region.towns[0]!.id;
  const todayAct = [...state.log].reverse().find((e): e is Extract<FieldOpsEvent, { type: 'acted' }> => e.type === 'acted' && e.by === role && e.day === state.day);
  return {
    role, name: r?.name ?? role, kind: r?.kind ?? 'worker', operator: c?.operator ?? 'agent', agent: c?.agent ?? '',
    ...(state.membership?.[role] ? { team: state.membership[role] } : {}), ...(r?.partner ? { partner: r.partner } : {}),
    ...(invitedTo(state, role).length ? { invitedTo: invitedTo(state, role).map((t) => t.id) } : {}),
    town, townName: townOf(region, town)?.name ?? town,
    ...(r?.appearance ? { appearance: r.appearance } : {}),
    look: r?.look ?? { skin: '#d8b08a', hair: '#3b2f2a', wear: '#2b333a', accent: '#5b6b74', hairStyle: 'short' },
    ...(c?.mind ? { mind: c.mind } : {}),
    ...(c?.operator === 'human' && c.playedBy ? { playedBy: c.playedBy } : {}),
    ...(c?.personaCustodian ? { custodian: c.personaCustodian } : c?.operator === 'agent' && c.custodian && c.custodian !== 'house' ? { custodian: c.custodian } : {}),
    energy: state.energy[role] ?? 100,
    actedToday: (state.acted[role] ?? 0) >= state.day,
    today: todayAct?.text ?? null,
  };
}

/** THE SCORE — from the log and the hidden state at the reveal, shown to everybody. */
export function score(state: FieldOpsState, scenario: Scenario, region: Region): Score {
  const communities: Score['communities'] = communitiesOf(state, region).map((def) => {
    const c = state.communities[def.id]!;
    const end = phaseOf(def, c, state.bodies).phase;
    const latest = c.readings[c.readings.length - 1] ?? null;
    return { community: def.id, name: def.name, start: def.registry.phase, end, moved: end - def.registry.phase, published: latest?.phase ?? null, accurate: latest ? latest.phase === end : null, readiness: state.truth[def.id]?.readiness ?? 0, reachedP7: end === 7 };
  });
  const teams: Score['teams'] = (state.teams ?? []).map((t) => {
    const members = new Set(t.members);
    const acts = state.log.filter((e) => e.type === 'acted' && members.has(e.by) && e.action !== 'rest').length;
    const own = state.bodies.filter((b) => b.team === t.id && b.foundedDay > 0);
    return { team: t.id, name: t.name, acts, circles: own.filter((b) => b.kind === 'circle').length, churches: own.filter((b) => b.kind === 'church').length, generations: own.reduce((m, b) => Math.max(m, b.generation), 0), baptized: state.log.filter((e): e is Extract<FieldOpsEvent, { type: 'acted' }> => e.type === 'acted' && members.has(e.by) && e.action === 'baptize').reduce((n, e) => n + (e.outcome.baptized ?? 0), 0) };
  });
  const parts: Score['parts'] = state.cast.map((c) => {
    const acts = state.log.filter((e): e is Extract<FieldOpsEvent, { type: 'acted' }> => e.type === 'acted' && e.by === c.role);
    return { role: c.role, name: c.name, operator: c.operator, mind: c.mind ?? (c.operator === 'human' ? 'human' : 'rules'), acts: acts.filter((e) => e.action !== 'rest').length, days: new Set(acts.map((e) => e.day)).size, agentDays: new Set(acts.filter((e) => e.via === 'agent').map((e) => e.day)).size };
  });
  const movedTotal = communities.reduce((n, c) => n + c.moved, 0);
  const reachedP7 = communities.filter((c) => c.reachedP7).length;
  const verdict: Score['verdict'] = movedTotal > 0 ? 'field-moved' : movedTotal === 0 ? 'field-held' : 'field-slipped';
  return { communities, teams, parts, movedTotal, reachedP7, verdict };
}

/** The season as one part sees it — or, for `null`, as somebody watching from outside. */
export function viewFor(state: FieldOpsState, scenario: Scenario, region: Region, role: RoleId | null): FieldOpsView {
  const me = role ? roleOf(scenario, role) : undefined;
  const w = weekOf(scenario, state.week);
  const revealed = state.phase === 'revealed';
  const communities: ViewCommunity[] = communitiesOf(state, region).map((def) => {
    const c = state.communities[def.id]!;
    const { readings, observations, ...counts } = c;
    const d = phaseOf(def, c, state.bodies);
    const latest = readings[readings.length - 1] ?? null;
    return {
      id: def.id, iri: def.iri, name: def.name, corridor: def.corridor, towns: def.towns, people: def.people, population: def.population,
      registry: def.registry, claims: def.claims, workedBy: (state.worked ?? {})[def.id] ?? null,
      ...(def.fictional ? { fictional: true as const, definedBy: def.definedBy, definition: def.definition } : {}),
      counts, derived: d.phase, blockedBy: d.blockedBy,
      reading: latest ? { by: latest.by, phase: latest.phase, qualifier: latest.qualifier, day: latest.day } : null,
      bodies: state.bodies.filter((b) => b.community === def.id).map((b) => b.id),
      observations: observations.map((o) => ({ by: o.by, text: o.text, day: o.day })),
    };
  });
  const bodies: ViewBody[] = state.bodies.map((b) => ({ ...b, teamName: teamOf(state, b.team)?.name ?? (b.team ?? "the registry's") }));
  return {
    scenario: scenario.id, scenarioName: scenario.name, region: region.id, regionName: region.name, registryReadAt: region.registryReadAt,
    day: state.day, week: state.week, weekName: w.name, objective: w.objective, weeks: scenario.weeks.length, daysPerWeek: DAYS_PER_WEEK, pace: state.pace,
    phase: state.phase, deadline: state.deadline, seedCommit: state.seedCommit,
    you: me && role ? {
      role, name: me.name, kind: me.kind, blurb: me.blurb, secret: me.secret, look: me.look,
      ...(state.membership?.[role] ? { team: state.membership[role] } : {}), ...(me.partner ? { partner: me.partner } : {}),
      ...(me.team && planOf(scenario, me.team) ? { intended: planOf(scenario, me.team)! } : {}),
      invitedTo: invitedTo(state, role).map((t) => t.id),
      town: state.where[role] ?? me.home, energy: state.energy[role] ?? 100, actedToday: (state.acted[role] ?? 0) >= state.day,
      may: may(state, scenario, region, role),
      choices: openChoices(state, me).map((c) => ({ id: c.id, question: c.question, options: c.options.map((o) => ({ id: o.id, label: o.label })) })),
    } : null,
    trail: (state.trail ?? []).filter((t) => t.until >= state.day),
    outcomes: (state.outcomes ?? []).map((o) => ({ key: o.key, by: o.by, day: o.day })),
    corridors: region.corridors, towns: region.towns, communities, bodies,
    partners: region.partners.map((p) => ({ ...p, used: state.supports.filter((x) => x.partner === p.id).length, agent: state.cast.find((c) => roleOf(scenario, c.role)?.partner === p.id)?.agent ?? null })),
    teams: (state.teams ?? []).map((t) => ({ ...t, capacity: state.capacity[t.id] ?? 0 })),
    cast: state.cast.map((c) => personView(state, scenario, region, c.role)),
    transcript: state.log.map((e) => redactEvent(state, e, role)).filter((e): e is FieldOpsEvent => !!e),
    reveal: revealed ? { seed: state.seedHex ?? '', truth: { ...state.truth }, score: score(state, scenario, region) } : null,
  };
}

export { PHASE_FRAMEWORK, generationsOf };
