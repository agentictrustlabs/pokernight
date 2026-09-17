/**
 * GREAT COMMISSION — the engine (docs/GREAT-COMMISSION.md).
 *
 * Pure. The host owns the alarm and the sockets; this owns what a night IS: how the world moves between
 * rounds, what each part may do and what the engine records when it does, what each part can see, and the
 * score at the end. Every draw comes from the seed committed before the night began, so a night replays
 * byte-identically from (seed, action log) and the same scenario can be run before and after a substrate
 * change and compared.
 *
 * THE ONE INVARIANT, RESTATED WHERE IT IS KEPT: `state.truth` is written in `tick` and nowhere else. No branch
 * of `apply` reads it, let alone writes it. Growth is exogenous.
 */
import { hexToBytes, seededShuffle } from '@pokernight/deal';
import type {
  Assessment, Casting, Commitment, CommissionAction, CommissionEvent, CommissionState, CommissionView,
  Disclosure, Grain, Phase, PhaseNumber, PeopleDef, PeopleId, Region, Role, RoleId, RoomDef, RoomId,
  Scenario, Score, Strength, VaultItem, ViewPerson, ViewReceived, ViewVaultItem,
} from './types.js';
import { GRAINS, coarserOrEqual, grainRank, phaseNumber } from './types.js';

export const INTERLUDE_MS = 25_000;
export const roundMs = (minutes: number, pace: number): number => Math.max(20_000, Math.round(minutes * 60_000 * pace));

export function roleOf(scenario: Scenario, id: RoleId): Role | undefined { return scenario.roles.find((r) => r.id === id); }
export function roomOf(region: Region, id: RoomId): RoomDef | undefined { return region.rooms.find((r) => r.id === id); }
export function peopleOf(region: Region, id: PeopleId): PeopleDef | undefined { return region.peoples.find((p) => p.id === id); }
export function roundOf(scenario: Scenario, n: number) { return scenario.rounds.find((r) => r.n === n) ?? scenario.rounds[scenario.rounds.length - 1]!; }
export function peopleIn(state: CommissionState, room: RoomId): RoleId[] {
  return state.cast.map((c) => c.role).filter((r) => state.where[r] === room);
}
export function isSilent(state: CommissionState, scenario: Scenario, role: RoleId): boolean {
  return !!scenario.silent && scenario.silent.role === role && state.round >= scenario.silent.fromRound;
}
/** May this part stand in this room: the scenario's membership, or the convener's admission. */
export function mayEnter(region: Region, state: CommissionState, role: RoleId, room: RoomId): boolean {
  const r = roomOf(region, room);
  if (!r) return false;
  return r.members.includes(role) || (state.admitted[room] ?? []).includes(role);
}

/** The typed need a reading emits into the intent spine — what kind of worker this people needs next. */
export function needFor(phase: Phase): string {
  const n = phaseNumber(phase);
  if (phase === '0-R' || n === 0) return 'a near-culture carrier to re-enter';
  if (n === 1) return 'a witness who can share in a way the people find fitting';
  if (n === 2) return 'somebody to disciple those who have responded';
  if (n === 3) return 'help gathering believers as a local church';
  if (n === 4) return 'training for leaders who will send';
  return 'no outside worker — the churches are sending their own';
}

/**
 * PROVE A SCENARIO BEFORE ANYBODY PLAYS IT. Every vault item names a people that exists; every room's members
 * are parts; exactly one researcher, one convener, one adversary; every people has a schedule. A scenario that
 * fails here is refused at authoring time, not discovered mid-night.
 */
export function checkScenario(scenario: Scenario, region: Region): string[] {
  const out: string[] = [];
  const roles = new Set(scenario.roles.map((r) => r.id));
  const peoples = new Set(region.peoples.map((p) => p.id));
  for (const kind of ['researcher', 'convener', 'adversary'] as const) {
    const n = scenario.roles.filter((r) => r.kind === kind).length;
    if (n !== 1) out.push(`exactly one ${kind} is needed; ${n} written`);
  }
  for (const r of scenario.roles) for (const v of r.vault) {
    if (!peoples.has(v.people)) out.push(`${r.id} testifies about "${v.people}", which is not a people here`);
    if (v.count !== undefined && v.grain !== 'household' && v.grain !== 'village') out.push(`${r.id}'s ${v.id} carries a count at ${v.grain} grain; counts live at household or village grain`);
  }
  for (const room of region.rooms) for (const m of room.members) if (!roles.has(m)) out.push(`room ${room.id} names ${m}, which is not a part`);
  for (const p of region.peoples) {
    if (!p.schedule.length) out.push(`${p.id} has no schedule`);
    if (!p.villages.includes(p.truth.village)) out.push(`${p.id}'s carrier village "${p.truth.village}" is not one of its villages`);
    if (p.carrier && !roles.has(p.carrier)) out.push(`${p.id} names carrier ${p.carrier}, which is not a part`);
  }
  if (region.peoples.length < 3) out.push('a region needs at least three peoples for a picture to be a picture');
  if (scenario.silent && !roles.has(scenario.silent.role)) out.push(`the silent part ${scenario.silent.role} is not a part`);
  return out;
}

/** The world at the end of round `n`: the schedule's entry, held at its last; the seed's stall delays one people by a round. */
function truthAt(p: PeopleDef, n: number, stalled: PeopleId | null): { phase: Phase; strength: Strength } {
  const idx = Math.max(0, Math.min(p.schedule.length - 1, stalled === p.id ? n - 1 : n));
  return p.schedule[idx]!;
}

export function openStaging(args: {
  scenario: Scenario; region: Region; cast: Casting[]; seedHex: string; seedCommit: string; now: number; pace?: number;
}): CommissionState {
  const { scenario, region, cast, seedHex, seedCommit, now } = args;
  const pace = Math.max(0.05, Math.min(2, args.pace ?? 1));
  const seed = hexToBytes(seedHex);
  // THE DRAW: which people the world holds back a round. Stated by the seed, committed before the night, and
  // the only thing about how the world moves that is not written in the scenario — so two nights on one
  // scenario differ in where the motion is, not in whether there is any.
  const stalled = seededShuffle(region.peoples.map((p) => p.id), seed)[0] ?? null;
  const r0 = roundOf(scenario, 1);
  const where: Record<RoleId, RoomId> = {};
  const vaults: Record<RoleId, string[]> = {};
  const received: Record<RoleId, string[]> = {};
  for (const c of cast) {
    where[c.role] = region.spawn;
    vaults[c.role] = (roleOf(scenario, c.role)?.vault ?? []).filter((v) => v.round <= 0).map((v) => v.id);
    received[c.role] = [];
  }
  const truth: CommissionState['truth'] = {};
  for (const p of region.peoples) truth[p.id] = truthAt(p, 0, stalled);
  return {
    scenario: scenario.id, region: region.id, seedCommit, seedHex, cast, pace, night: scenario.night,
    round: 1, roundStartedAt: now, phase: 'round', deadline: now + roundMs(r0.minutes, pace),
    where, admitted: {}, truth, vaults, received,
    disclosures: [], assessments: [], commitments: [], inferences: [], fabrications: [], replays: [], witnessed: {}, outcomes: [],
    log: [
      { type: 'cue', at: now, text: r0.opening, by: 'house' },
      { type: 'round', at: now, round: 1, phase: 'round', deadline: now + roundMs(r0.minutes, pace) },
    ],
    startedAt: now, endedAt: null,
  };
}

/** A state written by an older engine is still a night: every list reads as empty rather than as undefined. */
const clone = (s: CommissionState): CommissionState => ({
  ...s,
  cast: (s.cast ?? []).slice(),
  where: { ...s.where }, admitted: Object.fromEntries(Object.entries(s.admitted ?? {}).map(([k, v]) => [k, v.slice()])),
  truth: { ...s.truth }, vaults: Object.fromEntries(Object.entries(s.vaults ?? {}).map(([k, v]) => [k, v.slice()])),
  received: Object.fromEntries(Object.entries(s.received ?? {}).map(([k, v]) => [k, v.slice()])),
  disclosures: (s.disclosures ?? []).map((d) => ({ ...d, received: d.received.slice() })),
  assessments: (s.assessments ?? []).slice(), commitments: (s.commitments ?? []).slice(), inferences: (s.inferences ?? []).slice(),
  fabrications: (s.fabrications ?? []).slice(), replays: (s.replays ?? []).slice(),
  witnessed: Object.fromEntries(Object.entries(s.witnessed ?? {}).map(([k, v]) => [k, v.slice()])),
  outcomes: (s.outcomes ?? []).slice(), log: (s.log ?? []).slice(),
});

const LOG_CAP = 800;
function push(s: CommissionState, ...events: CommissionEvent[]): CommissionEvent[] {
  s.log = [...s.log, ...events].slice(-LOG_CAP);
  return events;
}
const stalledOf = (s: CommissionState, region: Region): PeopleId | null =>
  seededShuffle(region.peoples.map((p) => p.id), hexToBytes(s.seedHex ?? '00'))[0] ?? null;

/**
 * THE CLOCK — rounds, interludes, the closing, the reveal. Between rounds THE WORLD MOVES: this is the only
 * place `truth` is written, and it reads nothing anybody did.
 */
export function tick(state: CommissionState, scenario: Scenario, region: Region, now: number): { state: CommissionState; events: CommissionEvent[] } {
  if (state.phase === 'revealed' || state.deadline === null || now < state.deadline) return { state, events: [] };
  const s = clone(state);
  const events: CommissionEvent[] = [];
  const round = roundOf(scenario, s.round);
  if (s.phase === 'round') {
    s.phase = 'interlude';
    s.deadline = now + INTERLUDE_MS;
    const stalled = stalledOf(s, region);
    for (const p of region.peoples) s.truth[p.id] = truthAt(p, s.round, stalled);
    // What the carriers now SEE: the vault items whose round has arrived.
    for (const c of s.cast) {
      const have = new Set(s.vaults[c.role] ?? []);
      for (const v of roleOf(scenario, c.role)?.vault ?? []) if (v.round <= s.round && !have.has(v.id)) (s.vaults[c.role] ??= []).push(v.id);
    }
    events.push(...push(s, { type: 'cue', at: now, text: round.interlude, by: 'house' }));
    events.push(...push(s, { type: 'round', at: now, round: s.round, phase: s.phase, deadline: s.deadline }));
    return { state: s, events };
  }
  if (s.phase === 'interlude') {
    if (s.round >= scenario.rounds.length) {
      s.phase = 'closing';
      s.deadline = now + roundMs(scenario.closingMinutes, s.pace);
    } else {
      s.round += 1;
      s.phase = 'round';
      s.roundStartedAt = now;
      const next = roundOf(scenario, s.round);
      s.deadline = now + roundMs(next.minutes, s.pace);
      events.push(...push(s, { type: 'cue', at: now, text: next.opening, by: 'house' }));
      // A CARRIER GOES SILENT: the scenario says who and from when. The picture's job is to notice.
      if (scenario.silent && scenario.silent.fromRound === s.round) events.push(...push(s, { type: 'silent', at: now, role: scenario.silent.role, round: s.round }));
    }
    events.push(...push(s, { type: 'round', at: now, round: s.round, phase: s.phase, deadline: s.deadline }));
    return { state: s, events };
  }
  // closing → the reveal
  s.phase = 'revealed';
  s.endedAt = now;
  s.deadline = null;
  events.push(...push(s, { type: 'revealed', at: now, seed: s.seedHex ?? '' }));
  return { state: s, events };
}

type Refusal = { ok: false; code: string; message: string };
type Applied = { ok: true; state: CommissionState; events: CommissionEvent[] } | Refusal;
const no = (code: string, message: string): Refusal => ({ ok: false, code, message });

const itemOf = (scenario: Scenario, role: RoleId, id: string): VaultItem | undefined => roleOf(scenario, role)?.vault.find((v) => v.id === id);

/** The sentence at a chosen grain: the item's own at its grain, else the nearest coarser one written, else its people-grain fallback. */
export function projectText(item: VaultItem, grain: Grain): string {
  if (grain === item.grain) return item.text;
  const from = grainRank(grain);
  for (let i = from; i < GRAINS.length; i++) { const g = GRAINS[i]!; const t = item.coarse?.[g]; if (t) return t; }
  for (let i = from; i >= 0; i--) { const g = GRAINS[i]!; if (g === item.grain) return item.text; const t = item.coarse?.[g]; if (t) return t; }
  return item.text;
}

/** One part does one thing. The game validates its own actions; the host never guesses at legality. */
export function apply(state: CommissionState, scenario: Scenario, region: Region, role: RoleId, action: CommissionAction, now: number, via: 'human' | 'agent' = 'human'): Applied {
  if (state.phase === 'revealed') return no('night-over', 'The night is over.');
  const me = roleOf(scenario, role);
  if (!me || !state.cast.some((c) => c.role === role)) return no('not-cast', 'You are not in this story.');
  if (isSilent(state, scenario, role)) return no('silent', 'You have gone quiet. Nothing you do reaches anybody.');
  const here = state.where[role];
  if (!here) return no('nowhere', 'You are not anywhere.');
  const room = roomOf(region, here);
  if (!room) return no('nowhere', 'You are not anywhere.');
  const s = clone(state);
  const events: CommissionEvent[] = [];
  const saw = () => peopleIn(s, here);

  switch (action.type) {
    case 'move': {
      if (action.room === here) return no('already-here', 'You are already here.');
      if (!roomOf(region, action.room)) return no('no-room', 'No such room.');
      if (!mayEnter(region, s, role, action.room)) return no('not-a-member', 'You are not a member of that workspace. The convener admits.');
      const before = saw();
      s.where[role] = action.room;
      events.push(...push(s, { type: 'moved', at: now, who: role, from: here, to: action.room, saw: [...new Set([...before, ...peopleIn(s, action.room)])] }));
      break;
    }
    case 'admit': {
      if (me.kind !== 'convener') return no('not-convener', 'Only the convener admits somebody to a workspace.');
      if (!roomOf(region, action.room)) return no('no-room', 'No such room.');
      if (!s.cast.some((c) => c.role === action.who)) return no('not-cast', 'They are not in this story.');
      if (mayEnter(region, s, action.who, action.room)) return no('already-member', 'They are already a member.');
      (s.admitted[action.room] ??= []).push(action.who);
      events.push(...push(s, { type: 'admitted', at: now, by: role, who: action.who, room: action.room, saw: saw() }));
      break;
    }
    case 'say': {
      const text = action.text.trim().slice(0, 280);
      if (!text) return no('empty', 'Say something.');
      events.push(...push(s, { type: 'said', at: now, by: role, room: here, text, via, saw: saw() }));
      break;
    }
    case 'whisper': {
      if (!saw().includes(action.to)) return no('not-here', 'They are not in this room.');
      const text = action.text.trim().slice(0, 280);
      if (!text) return no('empty', 'Say something.');
      events.push(...push(s, { type: 'whispered', at: now, by: role, to: action.to, room: here, text }));
      break;
    }
    case 'testify': {
      const item = itemOf(scenario, role, action.evidence);
      if (!item || !(s.vaults[role] ?? []).includes(item.id)) return no('not-held', 'You do not hold that. You may only testify to what is in your vault.');
      if (item.people !== action.people) return no('wrong-people', 'That is not about this people.');
      if (s.disclosures.some((d) => d.evidence === item.id && d.by === role && d.revokedAt)) return no('revoked', 'You withdrew that. A revoked slip cannot be re-issued.');
      if (!coarserOrEqual(action.grain, item.grain)) return no('finer-than-held', `You know that at ${item.grain} grain; you cannot say it finer than you hold it.`);
      if (action.to && !saw().includes(action.to)) return no('not-here', 'They are not in this room.');
      // A NUMBER YOU DO NOT HOLD is a fabrication: recorded against you, never adjudicated in the room, and
      // the slip still goes out — the substrate is being tested on whether the instrument holds, not on whether
      // a referee stops you.
      if (action.count !== undefined && action.count !== item.count) {
        s.fabrications.push({ by: role, people: item.people, count: action.count, round: s.round, at: now, room: here });
        events.push(...push(s, { type: 'fabricated', at: now, by: role, people: item.people, count: action.count, room: here }));
      }
      const audience = action.to ? [action.to] : saw().filter((r) => r !== role);
      const id = `d${s.disclosures.length + 1}`;
      const leak = !coarserOrEqual(action.grain, room.grain);
      const text = projectText(item, action.grain) + (action.count !== undefined ? ` (${action.count})` : '');
      s.disclosures.push({ id, by: role, evidence: item.id, people: item.people, grain: action.grain, allowed: room.grain, to: action.to ?? null, room: here, round: s.round, at: now, received: audience });
      for (const r of audience) (s.received[r] ??= []).push(id);
      events.push(...push(s, { type: 'testified', at: now, by: role, disclosure: id, people: item.people, grain: action.grain, text, to: action.to ?? null, room: here, leak, saw: action.to ? [role, action.to] : saw() }));
      break;
    }
    case 'assess': {
      if (me.kind !== 'researcher') return no('not-researcher', 'The researcher publishes the reading.');
      if (!peopleOf(region, action.people)) return no('no-people', 'No such people.');
      const witnesses = new Set<RoleId>();
      for (const id of s.received[role] ?? []) {
        const d = s.disclosures.find((x) => x.id === id);
        if (!d || d.revokedAt || d.people !== action.people) continue;
        const item = itemOf(scenario, d.by, d.evidence);
        if (item && item.supports >= phaseNumber(action.phase)) witnesses.add(d.by);
      }
      for (const w of s.witnessed[`${action.people}:${String(action.phase)}`] ?? []) witnesses.add(w);
      const need = needFor(action.phase);
      const id = `a${s.assessments.length + 1}`;
      s.assessments.push({ id, people: action.people, phase: action.phase, strength: action.strength, by: role, round: s.round, at: now, corroboration: witnesses.size, need });
      events.push(...push(s, { type: 'assessed', at: now, by: role, people: action.people, phase: action.phase, strength: action.strength, corroboration: witnesses.size, need, room: here, saw: saw() }));
      break;
    }
    case 'corroborate': {
      if (!peopleOf(region, action.people)) return no('no-people', 'No such people.');
      const n = phaseNumber(action.phase);
      const own = (s.vaults[role] ?? []).map((id) => itemOf(scenario, role, id)).some((v) => v && v.people === action.people && v.supports >= n);
      const viaReceived = (s.received[role] ?? []).map((id) => s.disclosures.find((d) => d.id === id)).filter((d): d is Disclosure => !!d && d.people === action.people);
      const live = viaReceived.filter((d) => !d.revokedAt && (itemOf(scenario, d.by, d.evidence)?.supports ?? -1) >= n);
      if (!own && !live.length) {
        // REPLAY: the only thing behind this corroboration is a slip that was withdrawn. Refused, and recorded.
        const stale = viaReceived.find((d) => d.revokedAt && (itemOf(scenario, d.by, d.evidence)?.supports ?? -1) >= n);
        if (stale) {
          s.replays.push({ by: role, disclosure: stale.id, round: s.round, at: now });
          events.push(...push(s, { type: 'replayed', at: now, by: role, disclosure: stale.id, room: here }));
          return { ok: true, state: s, events };
        }
        return no('unsupported', 'You cannot vouch for what you neither hold nor were shown.');
      }
      const key = `${action.people}:${String(action.phase)}`;
      const list = (s.witnessed[key] ??= []);
      if (list.includes(role)) return no('already', 'You have already confirmed that.');
      list.push(role);
      const latest = [...s.assessments].reverse().find((a) => a.people === action.people);
      if (latest && String(latest.phase) === String(action.phase)) latest.corroboration = new Set([...list, ...witnessesBehind(s, scenario, latest)]).size;
      events.push(...push(s, { type: 'corroborated', at: now, people: action.people, phase: action.phase, corroboration: latest?.corroboration ?? list.length, room: here, saw: saw() }));
      break;
    }
    case 'commit': {
      if (me.kind !== 'funder' && me.kind !== 'agency') return no('not-a-resourcer', 'A funder or an agency commits.');
      const latest = [...s.assessments].reverse().find((a) => a.people === action.people);
      if (!latest || latest.need !== action.need) return no('no-such-need', 'No published reading emits that need. An offering answers a need the picture has stated.');
      const resource = action.resource.trim().slice(0, 120);
      if (!resource) return no('empty', 'Offer something.');
      const id = `c${s.commitments.length + 1}`;
      s.commitments.push({ id, people: action.people, need: action.need, resource, by: role, round: s.round, at: now });
      events.push(...push(s, { type: 'committed', at: now, by: role, people: action.people, need: action.need, resource, room: here, saw: saw() }));
      break;
    }
    case 'fulfil': {
      const c = s.commitments.find((x) => x.id === action.commitment);
      if (!c || c.by !== role) return no('not-yours', 'That is not a commitment of yours.');
      if (c.fulfilledAt) return no('already', 'Already carried out.');
      if (c.round === s.round) return no('too-soon', 'A commitment is carried out in a later round, not the one it was made in.');
      c.fulfilledAt = now;
      events.push(...push(s, { type: 'fulfilled', at: now, by: role, commitment: c.id, room: here, saw: saw() }));
      break;
    }
    case 'revoke': {
      const item = itemOf(scenario, role, action.evidence);
      if (!item) return no('not-held', 'That is not yours to withdraw.');
      const mine = s.disclosures.filter((d) => d.by === role && d.evidence === item.id && !d.revokedAt);
      if (!mine.length) return no('nothing-out', 'You have not issued that.');
      for (const d of mine) d.revokedAt = now;
      events.push(...push(s, { type: 'revoked', at: now, by: role, evidence: item.id, people: item.people }));
      break;
    }
    case 'infer': {
      if (me.kind !== 'adversary') return no('not-adversary', 'Only the adversary infers.');
      if (!peopleOf(region, action.people)) return no('no-people', 'No such people.');
      s.inferences.push({ by: role, people: action.people, ...(action.village ? { village: action.village } : {}), ...(action.households !== undefined ? { households: action.households } : {}), round: s.round, at: now });
      events.push(...push(s, { type: 'inferred', at: now, by: role, people: action.people }));
      break;
    }
    case 'choose': {
      const def = (me.choices ?? []).find((c) => c.id === action.choice);
      if (!def) return no('no-choice', 'That choice is not written for you.');
      if (s.round < def.round) return no('not-yet', 'That choice is not before you yet.');
      if (s.outcomes.some((o) => o.by === role && o.choice === def.id)) return no('chosen', 'You have already chosen.');
      const opt = def.options.find((o) => o.id === action.option);
      if (!opt) return no('no-option', 'That is not one of the options.');
      s.outcomes.push({ key: opt.outcome, by: role, choice: def.id, option: opt.id });
      events.push(...push(s, { type: 'chose', at: now, by: role, choice: def.id, option: opt.id, outcome: opt.outcome, text: opt.consequence, room: here, saw: saw() }));
      break;
    }
    default:
      return no('bad-action', 'Not a thing anybody can do here.');
  }
  return { ok: true, state: s, events };
}

/** The distinct witnesses whose received, live testimony supports an assessment — recomputed, never stored with names. */
function witnessesBehind(s: CommissionState, scenario: Scenario, a: Assessment): RoleId[] {
  const out = new Set<RoleId>();
  for (const id of s.received[a.by] ?? []) {
    const d = s.disclosures.find((x) => x.id === id);
    if (!d || d.revokedAt || d.people !== a.people) continue;
    if ((itemOf(scenario, d.by, d.evidence)?.supports ?? -1) >= phaseNumber(a.phase)) out.add(d.by);
  }
  return [...out];
}

const str = (v: unknown, max = 280): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isGrain = (v: unknown): v is Grain => typeof v === 'string' && (GRAINS as readonly string[]).includes(v);
const isPhase = (v: unknown): v is Phase => v === '0-R' || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7);
const isStrength = (v: unknown): v is Strength => typeof v === 'string' && ['unknown', 'initial', 'growing', 'active', 'flourishing'].includes(v);

/** What came over the wire, checked. The game says what its actions are; nobody else guesses. */
export function parseAction(raw: unknown): { ok: true; action: CommissionAction } | Refusal {
  if (!raw || typeof raw !== 'object') return no('bad-action', 'An action is an object.');
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'move': return str(r.room, 64) ? { ok: true, action: { type: 'move', room: r.room as string } } : no('bad-action', 'move needs a room');
    case 'say': return str(r.text) ? { ok: true, action: { type: 'say', text: r.text as string } } : no('bad-action', 'say needs words');
    case 'whisper': return str(r.to, 64) && str(r.text) ? { ok: true, action: { type: 'whisper', to: r.to as string, text: r.text as string } } : no('bad-action', 'whisper needs somebody and words');
    case 'admit': return str(r.who, 64) && str(r.room, 64) ? { ok: true, action: { type: 'admit', who: r.who as string, room: r.room as string } } : no('bad-action', 'admit needs somebody and a room');
    case 'testify': {
      if (!str(r.people, 64) || !str(r.evidence, 64) || !isGrain(r.grain)) return no('bad-action', 'testify needs a people, an item you hold, and a grain');
      const count = typeof r.count === 'number' && Number.isFinite(r.count) ? Math.round(r.count) : undefined;
      return { ok: true, action: { type: 'testify', people: r.people as string, evidence: r.evidence as string, grain: r.grain, ...(str(r.to, 64) ? { to: r.to as string } : {}), ...(count !== undefined ? { count } : {}) } };
    }
    case 'assess': return str(r.people, 64) && isPhase(r.phase) && isStrength(r.strength) ? { ok: true, action: { type: 'assess', people: r.people as string, phase: r.phase, strength: r.strength } } : no('bad-action', 'assess needs a people, a phase (0–7 or "0-R") and a strength');
    case 'corroborate': return str(r.people, 64) && isPhase(r.phase) ? { ok: true, action: { type: 'corroborate', people: r.people as string, phase: r.phase } } : no('bad-action', 'corroborate needs a people and a phase');
    case 'commit': return str(r.people, 64) && str(r.need, 200) && str(r.resource, 120) ? { ok: true, action: { type: 'commit', people: r.people as string, need: r.need as string, resource: r.resource as string } } : no('bad-action', 'commit needs a people, the need it answers, and what you offer');
    case 'fulfil': return str(r.commitment, 64) ? { ok: true, action: { type: 'fulfil', commitment: r.commitment as string } } : no('bad-action', 'fulfil needs a commitment');
    case 'revoke': return str(r.evidence, 64) ? { ok: true, action: { type: 'revoke', evidence: r.evidence as string } } : no('bad-action', 'revoke needs an item');
    case 'infer': {
      if (!str(r.people, 64)) return no('bad-action', 'infer needs a people');
      const households = typeof r.households === 'number' && Number.isFinite(r.households) ? Math.round(r.households) : undefined;
      return { ok: true, action: { type: 'infer', people: r.people as string, ...(str(r.village, 64) ? { village: r.village as string } : {}), ...(households !== undefined ? { households } : {}) } };
    }
    case 'choose': return str(r.choice, 64) && str(r.option, 64) ? { ok: true, action: { type: 'choose', choice: r.choice as string, option: r.option as string } } : no('bad-action', 'choose needs a choice and an option');
    default: return no('bad-action', `no such action: ${String(r.type)}`);
  }
}

/** What one part may see of an event — or, for `null`, what a watcher outside the story sees. */
export function redactEvent(state: CommissionState, ev: CommissionEvent, role: RoleId | null): CommissionEvent | null {
  const here = role ? state.where[role] : null;
  const witnessed = (e: CommissionEvent & { saw?: RoleId[]; room?: RoomId | null }): boolean => {
    if (role === null) return true;
    if (e.saw) return e.saw.includes(role);
    return e.room === here;
  };
  switch (ev.type) {
    case 'cue': case 'round': case 'revealed': case 'silent': case 'revoked': return ev;
    case 'whispered': return role && (ev.by === role || ev.to === role) ? ev : null;
    // THE THINGS THE SCORE REVEALS AND THE ROOM DOES NOT: an inference, a fabrication, a replay. Their actor
    // sees their own; everybody else learns of them at the reveal, from the score.
    case 'inferred': case 'fabricated': case 'replayed': return role === null || ev.by === role ? ev : null;
    case 'testified': return ev.to ? (role === null || ev.by === role || ev.to === role ? ev : null) : (role === null || ev.by === role || witnessed(ev) ? ev : null);
    case 'moved': return role === null || ev.who === role || witnessed(ev) ? ev : null;
    case 'said': case 'admitted': case 'assessed': case 'corroborated': case 'committed': case 'fulfilled': case 'chose':
      return role === null || ('by' in ev && ev.by === role) || witnessed(ev) ? ev : null;
    default: return null;
  }
}

function personView(state: CommissionState, scenario: Scenario, region: Region, role: RoleId): ViewPerson {
  const c = state.cast.find((x) => x.role === role);
  const r = roleOf(scenario, role);
  const at = state.where[role];
  return {
    role, name: r?.name ?? role, kind: r?.kind ?? 'household',
    operator: c?.operator ?? 'agent', agent: c?.agent ?? '',
    ...(at ? { room: at } : {}), ...(at ? { roomName: roomOf(region, at)?.name ?? at } : {}),
    ...(r?.appearance ? { appearance: r.appearance } : {}),
    look: r?.look ?? { skin: '#d8b08a', hair: '#3b2f2a', wear: '#2b333a', accent: '#5b6b74', hairStyle: 'short' },
    ...(c?.mind ? { mind: c.mind } : {}),
    ...(c?.operator === 'human' && c.name ? { playedBy: c.name } : {}),
    ...(isSilent(state, scenario, role) ? { silent: true } : {}),
  };
}

/** THE SCORE — computed from the log and the hidden state at the reveal, and shown to everybody. */
export function score(state: CommissionState, scenario: Scenario, region: Region): Score {
  const latestFor = (p: PeopleId) => [...state.assessments].reverse().find((a) => a.people === p) ?? null;
  const stalled = stalledOf(state, region);
  const detection: Score['detection'] = region.peoples.map((p) => {
    const a = latestFor(p.id);
    const actual = state.truth[p.id]?.phase ?? p.schedule[0]!.phase;
    const hit = !!a && String(a.phase) === String(actual);
    // How many rounds the picture lagged: the first round a correct reading was published, minus the round the world got there.
    let reached = 0;
    for (let n = 0; n <= scenario.rounds.length; n++) if (String(truthAt(p, n, stalled).phase) === String(actual)) { reached = n; break; }
    const first = state.assessments.find((x) => x.people === p.id && String(x.phase) === String(actual));
    return { people: p.id, assessed: a?.phase ?? null, actual, lagRounds: first ? Math.max(0, first.round - reached) : null, hit };
  });
  const exposure: Score['exposure'] = region.peoples.map((p) => {
    const inf = [...state.inferences].reverse().find((i) => i.people === p.id);
    return { people: p.id, village: !!inf?.village && inf.village.toLowerCase() === p.truth.village.toLowerCase(), households: inf?.households !== undefined && inf.households === p.truth.households };
  });
  const leaks: Score['leaks'] = state.disclosures.filter((d) => !coarserOrEqual(d.grain, d.allowed)).map((d) => ({ by: d.by, people: d.people, grain: d.grain, allowed: d.allowed, round: d.round }));
  const replays = state.replays.map((r) => ({ by: r.by, round: r.round }));
  const fabrications = state.fabrications.map((f) => ({ by: f.by, people: f.people, count: f.count, round: f.round }));
  const stale: Score['stale'] = [];
  if (scenario.silent) {
    for (const p of region.peoples) {
      if (p.carrier !== scenario.silent.role) continue;
      const a = latestFor(p.id);
      if (a && a.phase !== '0-R' && a.round < scenario.silent.fromRound) stale.push({ people: p.id, assessedPhase: a.phase, sinceRound: scenario.silent.fromRound });
    }
  }
  const found = detection.filter((d) => d.hit).length;
  const exposed = exposure.some((e) => e.village);
  const verdict: Score['verdict'] = exposed ? 'rails-failed' : found * 2 >= region.peoples.length ? 'rails-held' : 'nothing-found';
  return { detection, exposure, leaks, replays, fabrications, stale, verdict };
}

/** The staging as one part sees it — or, for `null`, as somebody watching from outside the story. */
export function viewFor(state: CommissionState, scenario: Scenario, region: Region, role: RoleId | null): CommissionView {
  const round = roundOf(scenario, state.round);
  const me = role ? roleOf(scenario, role) : undefined;
  const here = role ? state.where[role] ?? null : null;
  const room = here ? roomOf(region, here) : undefined;
  const revealed = state.phase === 'revealed';
  const latestFor = (p: PeopleId) => [...state.assessments].reverse().find((a) => a.people === p) ?? null;
  const vault: ViewVaultItem[] = me && role
    ? (state.vaults[role] ?? []).map((id) => me.vault.find((v) => v.id === id)).filter((v): v is VaultItem => !!v).map((v) => ({
        id: v.id, people: v.people, grain: v.grain, supports: v.supports, text: v.text, ...(v.count !== undefined ? { count: v.count } : {}),
        projections: GRAINS.filter((g) => coarserOrEqual(g, v.grain)).map((g) => ({ grain: g, text: projectText(v, g), allowedHere: room ? coarserOrEqual(g, room.grain) : false })),
        revoked: state.disclosures.some((d) => d.by === role && d.evidence === v.id && !!d.revokedAt),
      }))
    : [];
  const received: ViewReceived[] = role
    ? (state.received[role] ?? []).map((id) => state.disclosures.find((d) => d.id === id)).filter((d): d is Disclosure => !!d).map((d) => {
        const item = roleOf(scenario, d.by)?.vault.find((v) => v.id === d.evidence);
        return { disclosure: d.id, from: d.by, people: d.people, grain: d.grain, text: item ? projectText(item, d.grain) : '', supports: item?.supports ?? 0, revoked: !!d.revokedAt };
      })
    : [];
  return {
    scenario: scenario.id, scenarioName: scenario.name, region: region.id, regionName: region.name,
    night: state.night, round: state.round, roundName: round.name, objective: round.objective, pace: state.pace,
    phase: state.phase, deadline: state.deadline, seedCommit: state.seedCommit,
    you: me && role ? { role, name: me.name, kind: me.kind, blurb: me.blurb, secret: me.secret, look: me.look, vault, received, silent: isSilent(state, scenario, role) } : null,
    room: room && here ? {
      id: here, name: room.name, blurb: room.blurb, grain: room.grain,
      people: peopleIn(state, here).filter((r) => r !== role).map((r) => personView(state, scenario, region, r)),
      doors: region.rooms.filter((r) => r.id !== here).map((r) => ({ id: r.id, name: r.name, open: role ? mayEnter(region, state, role, r.id) : false })),
    } : null,
    cast: state.cast.map((c) => personView(state, scenario, region, c.role)),
    rooms: region.rooms.map((r) => ({ id: r.id, name: r.name, grain: r.grain })),
    peoples: region.peoples.map((p) => {
      const a = latestFor(p.id);
      return { id: p.id, name: p.name, province: p.province, villages: p.villages, reading: a ? { phase: a.phase, strength: a.strength, corroboration: a.corroboration, round: a.round } : (p.publicReading ? { phase: p.publicReading.phase, strength: p.publicReading.strength, corroboration: 0, round: 0 } : null), need: a?.need ?? null };
    }),
    commitments: state.commitments.map((c) => ({ id: c.id, people: c.people, need: c.need, resource: c.resource, by: c.by, round: c.round, fulfilled: !!c.fulfilledAt, stale: !c.fulfilledAt && state.round > c.round + 1 })),
    outcomes: state.outcomes.map((o) => ({ key: o.key, by: o.by })),
    choices: role ? (me?.choices ?? []).filter((c) => state.round >= c.round && !state.outcomes.some((o) => o.by === role && o.choice === c.id)).map((c) => ({ id: c.id, question: c.question, options: c.options.map((o) => ({ id: o.id, label: o.label })) })) : [],
    transcript: state.log.map((e) => redactEvent(state, e, role)).filter((e): e is CommissionEvent => !!e),
    reveal: revealed ? {
      seed: state.seedHex ?? '',
      truth: Object.fromEntries(region.peoples.map((p) => [p.id, { ...(state.truth[p.id] ?? p.schedule[0]!), village: p.truth.village, households: p.truth.households }])),
      score: score(state, scenario, region),
      inferences: state.inferences.slice(),
    } : null,
  };
}
