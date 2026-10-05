/**
 * THE FIELD AS A TOWN — the scene a season of Field Operations builds, as data (docs/FIELD-OPERATIONS.md §7).
 *
 * The flat map says WHERE. This says WHAT IS THERE NOW: every town north of Denver as a few blocks on an isometric
 * ground, and in them the things the season made — a team's office, the homes of the people on it, a partner church
 * at its address, a quarter for each people community that lives there with its households, the circles that have
 * formed among them and the churches recognised from those circles. It is drawn by `components/fieldops/FieldTown`;
 * this file decides what exists, where it stands, and what it looked like on any day of the season. Pure: no DOM,
 * no clock, no randomness — a seeded season replays to the same town.
 *
 * TWO KINDS OF THING, AND THE SCENE KEEPS THEM APART because the game does:
 *   · LOCATION-BASED — a team's home town, a circle, a church, a partner congregation, where a worker is standing.
 *     These are BUILDINGS on a lot, or a figure in a street.
 *   · AREA-BASED — a corridor, and a PEOPLE COMMUNITY (a people in a corridor's towns). Nobody can point at a
 *     community's address, so it is GROUND: a tinted quarter in each town it lives in, whose colour is the phase the
 *     records derive, with a beacon that climbs a storey a phase. Its households are small homes whose windows come
 *     on as people start seeking and whose roofs take the people's colour as they believe.
 *
 * GEOGRAPHY IS KEPT, DISTANCE IS NOT. Towns sit where they are relative to each other (Fort Collins north of
 * Loveland, the plains far to the east), projected from their real coordinates at a kilometre a tile. But a drawn
 * town is larger than a real one — Greeley and Evans are five kilometres apart and each needs a dozen lots — so
 * towns that would overlap are pushed apart, least for the one that has least to move, and the highways are bent by
 * the same push so a road still arrives at the town it serves. A schematic, said so on the screen.
 *
 * A SEASON IS A SEQUENCE, AND THE LOG IS WHOLE. `seasonAt(view, day)` rebuilds any day from the transcript: which
 * teams existed, who had joined, which peoples were taken up, the phase each community had reached, every circle
 * and church with the counts it had THEN (the final counts minus what the later acts added), where everybody stood.
 * So the town can be scrubbed back to the registry's floor and played forward, each thing appearing on its day.
 *
 * STABLE LOTS. Where a thing stands is decided from the whole season as it is now, in an order that only ever
 * appends (bodies by the day they were founded), so replaying never makes a building jump to a different lot.
 */
import type { BodyId, CommunityId, FieldOpsEvent, FieldOpsView, PhaseN, RoleId, TeamId, TownId, ViewBody, ViewCommunity } from '@pokernight/fieldops';

// ── geography ────────────────────────────────────────────────────────────────────────────────────────────────────
const LAT_MAX = 40.8; const LNG_MIN = -105.45; const LAT0 = 40.3;
const KM_LAT = 110.57; const KM_LNG = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
/** East of the Front Range the plains are mostly distance: two hours of road between Greeley and Sterling, and
 *  nothing this picture has to show in between. So the ground east of the break is drawn at under half scale —
 *  order and direction kept, the empty middle shortened — or the whole region would be a sliver around a void. */
const X_BREAK = (-104.45 - LNG_MIN) * KM_LNG; const PLAINS_SCALE = 0.42;
/** A real coordinate on the ground plane: x east, y south, in tiles (a kilometre each, west of the plains). */
export const geo = (lat: number, lng: number): { x: number; y: number } => {
  const raw = (lng - LNG_MIN) * KM_LNG;
  return { x: raw <= X_BREAK ? raw : X_BREAK + (raw - X_BREAK) * PLAINS_SCALE, y: (LAT_MAX - lat) * KM_LAT };
};

/** The roads everybody drives, as real coordinates; bent with the towns by `layoutField`. */
const HIGHWAYS: Array<{ id: string; name: string; pts: Array<[number, number]> }> = [
  { id: 'i25', name: 'I-25', pts: [[39.86, -104.99], [39.92, -104.99], [40.08, -104.98], [40.33, -104.98], [40.4, -105.0], [40.59, -105.03], [40.7, -105.0], [40.78, -105.0]] },
  { id: 'us34', name: 'US-34', pts: [[40.4, -105.25], [40.4, -105.07], [40.42, -104.71], [40.26, -104.0], [40.25, -103.8], [40.26, -103.62]] },
  { id: 'us85', name: 'US-85', pts: [[39.86, -104.86], [40.08, -104.81], [40.38, -104.69], [40.42, -104.71], [40.53, -104.71], [40.78, -104.72]] },
  { id: 'i76', name: 'I-76', pts: [[39.86, -104.75], [40.08, -104.6], [40.25, -103.8], [40.26, -103.62], [40.63, -103.21], [40.78, -103.0]] },
  { id: 'us36', name: 'US-36', pts: [[39.9, -105.09], [39.99, -105.09], [40.02, -105.27]] },
  { id: 'co119', name: 'CO-119', pts: [[40.02, -105.27], [40.17, -105.1], [40.19, -104.99]] },
  { id: 'us34e', name: 'US-34', pts: [[40.26, -103.62], [40.12, -102.73]] },
];

// ── palette ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The phase a community's records derive, as a colour: cold and grey where nothing has begun, gold at P7. */
export const PHASE_COLOR: Record<number, string> = { 0: '#55637a', 1: '#3b6fb6', 2: '#2f8fa6', 3: '#2a9d8f', 4: '#57b26b', 5: '#c9b23e', 6: '#e0913a', 7: '#ffd27a' };
export const phaseColor = (p: number): string => PHASE_COLOR[Math.max(0, Math.min(7, Math.round(p)))]!;
const TEAM_TONES = ['#7c5cbf', '#d1546f', '#3b82c4', '#2aa58f', '#d9a441', '#c06fd0'];
const PEOPLE_TONES = ['#e07b6a', '#5fb0d8', '#b78be0', '#6fc48a', '#e0b85a', '#d86fa8', '#58c3c0', '#9aa7e8', '#e59a55', '#8fc75a', '#c98d6b', '#7fb3e6'];
const CORRIDOR_TONES: Record<string, string> = { weld: '#c9a14a', larimer: '#63b98a', boulder: '#6f9bd8', plains: '#d98a5f' };
export const TOWN_TONES = { civic: '#64748b', hall: '#7a8aa6', partner: '#c9cfdb', dark: '#33415a', lit: '#8fa0bd', nobody: '#8b98ad', pastor: '#e8eef7', office: '#b8c2d6' } as const;

// ── what the scene is made of ────────────────────────────────────────────────────────────────────────────────────
export type TownKind = 'civic' | 'hall' | 'partner' | 'team' | 'home' | 'household' | 'circle' | 'church' | 'beacon';
export type Roof = 'flat' | 'gable' | 'dome' | 'spire' | 'slab' | 'beacon';

export interface TownBuilding {
  id: string;
  kind: TownKind;
  /** The lot's near corner on the ground, the footprint in tiles, the wall height in tiles. */
  x: number; y: number; w: number; d: number; h: number;
  tone: string;
  roof: Roof;
  /** What a label says, and the smaller line under it in the inspector. */
  label: string;
  sub?: string;
  town: TownId;
  corridor: string;
  team?: TeamId;
  community?: CommunityId;
  /** The people group's name, for the filter. */
  people?: string;
  role?: RoleId;
  body?: BodyId;
  /** The day it appeared: 0 for what was there before the season. */
  born: number;
  /** A household: 0 dark, 1 seeking (windows lit), 2 believing (roof in the people's colour). */
  lit?: 0 | 1 | 2;
  /** A circle or a church, as it stood on the day drawn. */
  stats?: { participants: number; believers: number; baptized: number; leaders: number; generation: number; lifecycle: string };
  /** A beacon's storeys lit; a quarter's phase. */
  phase?: PhaseN;
  /** A second colour: the flag on a team's office, the trim on a body (the team that formed it). */
  accent?: string;
  /** How prominent it is when the picture is far away: 3 always drawn, 1 only close. */
  rank: 1 | 2 | 3;
}

export interface TownPlate {
  id: string;
  kind: 'corridor' | 'town' | 'quarter' | 'road';
  x: number; y: number; w: number; d: number;
  /** A corridor's outline: the hull around its towns. Everything else is its rectangle. */
  poly?: Array<{ x: number; y: number }>;
  tone: string;
  label?: string;
  town?: TownId;
  corridor?: string;
  community?: CommunityId;
  people?: string;
  team?: TeamId | null;
  phase?: PhaseN;
  /** The day a quarter's community was taken up by a team (it is dashed and dim before). */
  workedFrom?: number | null;
}

export interface TownPerson {
  role: RoleId; name: string; kind: string;
  x: number; y: number;
  tone: string;
  town: TownId; team?: TeamId;
  /** What this part did on the day drawn, if anything — the figure is lit while it acts. */
  acted?: string;
}

export interface TownLink { id: string; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; tone: string; kind: 'daughter' | 'support'; born: number; team?: TeamId; community?: CommunityId; people?: string }
export interface TownPulse { id: string; x: number; y: number; kind: string; tone: string; label: string }
export interface TownRoad { id: string; name: string; pts: Array<{ x: number; y: number }> }
export interface TownSite { id: TownId; name: string; corridor: string; x: number; y: number; r: number; population: number }

export interface FieldTownScene {
  day: number;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** The whole field as the camera frames it: the bounds, and the points around every town. */
  focus: { x0: number; y0: number; x1: number; y1: number; pts: Array<{ x: number; y: number }> };
  sites: TownSite[];
  roads: TownRoad[];
  plates: TownPlate[];
  buildings: TownBuilding[];
  people: TownPerson[];
  links: TownLink[];
  pulses: TownPulse[];
  /** What happened on the day drawn, in a sentence each — the caption under the timeline. */
  happened: string[];
  /** WHERE the day's most important thing happened — the town a camera following the work should be over. A
   *  church recognised beats a circle formed beats a team founded beats a baptism, a sending, a leader trained;
   *  a day that only shared and studied names no town and the camera stays where it is. */
  spotlight?: TownId;
  tally: { teams: number; circles: number; churches: number; baptized: number; leaders: number; believers: number; seekers: number; taken: number; communities: number; phasesMoved: number };
  /** The filters the scene offers: every people group and every team in it, with the colour each is drawn in. */
  peoples: Array<{ name: string; tone: string }>;
  teams: Array<{ id: TeamId; name: string; tone: string; born: number }>;
  corridors: Array<{ id: string; name: string; tone: string }>;
}

export interface TownFilter { people?: string | null; team?: TeamId | null }

// ── the season on a given day ────────────────────────────────────────────────────────────────────────────────────
export interface DayBody extends ViewBody { exists: boolean; kindThen: 'circle' | 'church'; stalled: boolean }
export interface SeasonDay {
  day: number;
  teams: Array<{ id: TeamId; name: string; home: TownId; corridor: string; steward: RoleId; members: RoleId[]; born: number }>;
  communities: Array<{ id: CommunityId; phase: PhaseN; workedBy: TeamId | null; workedFrom: number | null; seekers: number; believers: number; baptized: number; leaders: number; born: number }>;
  bodies: DayBody[];
  where: Record<RoleId, TownId>;
  teamOf: Record<RoleId, TeamId | undefined>;
  joined: Record<RoleId, number>;
  acted: Array<{ by: RoleId; town: TownId; action: string; community: CommunityId | null; body: BodyId | null; text: string }>;
  supports: Array<{ partner: string; team: TeamId }>;
  phaseMoves: Array<{ community: CommunityId; from: PhaseN; to: PhaseN }>;
}

const dayOf = (e: FieldOpsEvent): number | null => ('day' in e && typeof e.day === 'number' ? e.day : null);

/** The last day the log knows — the furthest the timeline runs. */
export function lastDay(view: FieldOpsView): number {
  let d = view.day;
  for (const e of view.transcript) { const x = dayOf(e); if (x !== null && x > d) d = x; }
  return d;
}

/**
 * The season as it stood at the END of `day` (0 = before anybody acted: the registry's floor). Counts are worked
 * BACKWARDS from what the view holds now — the final number minus what later acts added — so the last day always
 * equals the view, and an act the log does not carry a number for changes nothing.
 */
export function seasonAt(view: FieldOpsView, day: number): SeasonDay {
  const log = view.transcript;
  const teams: SeasonDay['teams'] = [];
  const joined: Record<RoleId, number> = {};
  const teamOf: Record<RoleId, TeamId | undefined> = {};
  const founded = new Map<TeamId, number>();
  for (const e of log) {
    if (e.type === 'team-founded') founded.set(e.team, e.day);
  }
  for (const t of view.teams) {
    const born = founded.get(t.id) ?? t.foundedDay ?? 0;
    if (born > day) continue;
    const members: RoleId[] = [t.steward];
    joined[t.steward] = Math.min(joined[t.steward] ?? born, born);
    teamOf[t.steward] = t.id;
    const joins = log.filter((e): e is Extract<FieldOpsEvent, { type: 'joined' }> => e.type === 'joined' && e.team === t.id);
    for (const m of t.members) {
      if (m === t.steward) continue;
      // A member with no join in the log (an older season) is taken as there from the founding.
      const j = joins.find((x) => x.who === m)?.day ?? born;
      if (j <= day) { members.push(m); joined[m] = j; teamOf[m] = t.id; }
    }
    teams.push({ id: t.id, name: t.name, home: t.home, corridor: t.corridor, steward: t.steward, members, born });
  }

  // Where everybody stood: the last move on or before the day; before any move, where their first move started.
  const where: Record<RoleId, TownId> = {};
  for (const p of view.cast) {
    const moves = log.filter((e): e is Extract<FieldOpsEvent, { type: 'moved' }> => e.type === 'moved' && e.who === p.role);
    const done = moves.filter((m) => m.day <= day);
    where[p.role] = done.length ? done[done.length - 1]!.to : moves.length ? moves[0]!.from : p.town;
  }

  const acts = log.filter((e): e is Extract<FieldOpsEvent, { type: 'acted' }> => e.type === 'acted');
  const later = acts.filter((e) => e.day > day);
  const sum = (xs: typeof acts, pick: (e: (typeof acts)[number]) => boolean, key: 'seekers' | 'believers' | 'baptized' | 'leaders' | 'participants'): number =>
    xs.reduce((n, e) => n + (pick(e) ? Number(e.outcome?.[key] ?? 0) : 0), 0);
  const floor0 = (n: number): number => Math.max(0, Math.round(n));

  const phaseEvents = log.filter((e): e is Extract<FieldOpsEvent, { type: 'phase' }> => e.type === 'phase');
  const adoptions = log.filter((e): e is Extract<FieldOpsEvent, { type: 'adopted' }> => e.type === 'adopted');
  const definitions = log.filter((e): e is Extract<FieldOpsEvent, { type: 'defined' }> => e.type === 'defined');
  const communities: SeasonDay['communities'] = [];
  for (const c of view.communities) {
    const born = definitions.find((d) => d.community === c.id)?.day ?? 0;
    if (born > day) continue;
    // The phase: where the registry put it, then every change the log records up to the day. A community whose log
    // holds no change at all is drawn at what the view derives (a season opened before phases were logged).
    const moves = phaseEvents.filter((p) => p.community === c.id);
    const start = moves.length ? moves[0]!.from : (day >= lastDay(view) ? c.derived : c.registry.phase);
    const reached = moves.filter((p) => p.day <= day);
    const phase = (reached.length ? reached[reached.length - 1]!.to : day >= lastDay(view) && !moves.length ? c.derived : start) as PhaseN;
    const taken = adoptions.find((a) => a.communities.includes(c.id));
    const workedFrom = taken ? taken.day : c.workedBy ? 0 : null;
    const of = (e: (typeof acts)[number]) => e.community === c.id;
    communities.push({
      id: c.id, phase, born,
      workedBy: workedFrom !== null && workedFrom <= day ? (taken?.team ?? c.workedBy) : null,
      workedFrom,
      seekers: floor0(c.counts.seekers - sum(later, of, 'seekers')),
      believers: floor0(c.counts.believers - sum(later, of, 'believers')),
      baptized: floor0(c.counts.baptized - sum(later, of, 'baptized')),
      leaders: floor0(c.counts.leaders - sum(later, of, 'leaders')),
    });
  }

  const recognitions = log.filter((e): e is Extract<FieldOpsEvent, { type: 'recognized' }> => e.type === 'recognized');
  const stalls = log.filter((e): e is Extract<FieldOpsEvent, { type: 'stalled' }> => e.type === 'stalled');
  const bodies: DayBody[] = view.bodies.map((b) => {
    const becameChurch = recognitions.find((r) => r.circle === b.id);
    const cameFrom = recognitions.find((r) => r.church === b.id);
    const born = cameFrom ? cameFrom.day : b.foundedDay;
    const exists = born <= day && !(becameChurch && becameChurch.day <= day);
    const of = (e: (typeof acts)[number]) => e.body === b.id || e.outcome?.body === b.id;
    const lastStall = stalls.filter((s) => s.body === b.id && s.day <= day).pop();
    const gatheredSince = lastStall ? acts.some((e) => e.body === b.id && e.action === 'gather' && e.day > lastStall.day && e.day <= day) : false;
    return {
      ...b, exists,
      kindThen: b.kind,
      stalled: !!lastStall && !gatheredSince,
      foundedDay: born,
      participants: floor0(b.participants - sum(later, of, 'participants')),
      believers: floor0(b.believers - sum(later, of, 'believers')),
      baptized: floor0(b.baptized - sum(later, of, 'baptized')),
      leaders: floor0(b.leaders - sum(later, of, 'leaders')),
    };
  });

  return {
    day, teams, communities, bodies, where, teamOf, joined,
    acted: acts.filter((e) => e.day === day).map((e) => ({ by: e.by, town: e.town, action: e.action, community: e.community, body: e.body ?? e.outcome?.body ?? null, text: e.text })),
    supports: log.filter((e): e is Extract<FieldOpsEvent, { type: 'supported' }> => e.type === 'supported' && e.day === day).map((e) => ({ partner: e.partner, team: e.team })),
    phaseMoves: phaseEvents.filter((p) => p.day === day).map((p) => ({ community: p.community, from: p.from, to: p.to })),
  };
}

// ── the layout: where everything stands, decided once for the whole season ───────────────────────────────────────
/** A block is 4×4 tiles with a 1-tile street between blocks; a lot is a quarter of a block. */
export const BLOCK = 4; const STREET = 1; const PITCH = BLOCK + STREET;
/** Blocks around a town's centre, nearest first: the square, then the four sides, then the corners, then further out. */
const SPIRAL: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]];
const LOTS: Array<[number, number]> = [[0, 0], [2, 0], [0, 2], [2, 2]];

interface BlockUse { kind: 'square' | 'team' | 'quarter'; team?: TeamId; community?: CommunityId; index: number }
export interface TownLayout {
  sites: TownSite[];
  /** Per town: which block is used for what, in spiral order. */
  blocks: Record<TownId, BlockUse[]>;
  roads: TownRoad[];
  bounds: FieldTownScene['bounds'];
  toneOfTeam: Record<TeamId, string>;
  toneOfPeople: Record<string, string>;
}

const bodiesOf = (view: FieldOpsView, community: CommunityId, town: TownId): ViewBody[] =>
  view.bodies.filter((b) => b.community === community && b.town === town).sort((a, b) => a.foundedDay - b.foundedDay || a.id.localeCompare(b.id));

/**
 * The lot each of a people's circles and churches takes in a town, in the order they were founded. A CHURCH
 * RECOGNISED FROM A CIRCLE STANDS WHERE THE CIRCLE STOOD — the same gathering under a new roof — so the day it is
 * recognised the pavilion becomes a hall with a tower on the same ground, and no lot is left empty behind it.
 */
export function bodySlots(view: FieldOpsView, community: CommunityId, town: TownId): { slot: Map<BodyId, number>; count: number } {
  const slot = new Map<BodyId, number>();
  let n = 0;
  for (const b of bodiesOf(view, community, town)) {
    const from = b.recognizedFrom ? slot.get(b.recognizedFrom) : undefined;
    if (from !== undefined) slot.set(b.id, from); else { slot.set(b.id, n); n += 1; }
  }
  return { slot, count: n };
}

/**
 * The towns a people's quarter is drawn in: where the registry says they live, and ANY TOWN THE SEASON CARRIED A
 * CIRCLE OF THEIRS TO. A circle sent out to a town the community was not listed in is the most interesting thing a
 * season does, and a scene that only knew the registry's towns left it standing nowhere.
 */
export const communityTowns = (view: FieldOpsView, c: ViewCommunity): TownId[] => {
  const extra = [...new Set(view.bodies.filter((b) => b.community === c.id && !c.towns.includes(b.town)).sort((a, b) => a.foundedDay - b.foundedDay || a.id.localeCompare(b.id)).map((b) => b.town))];
  return [...c.towns, ...extra];
};

/** How many blocks a community's quarter needs in a town: a beacon where they live, its circles and churches, and room for households. */
const quarterBlocks = (view: FieldOpsView, c: ViewCommunity, town: TownId): number => Math.max(1, Math.ceil(((c.towns.includes(town) ? 1 : 0) + bodySlots(view, c.id, town).count + 1) / LOTS.length));

export function layoutField(view: FieldOpsView): TownLayout {
  const teamsSorted = [...view.teams].sort((a, b) => (a.foundedDay - b.foundedDay) || a.id.localeCompare(b.id));
  const toneOfTeam: Record<TeamId, string> = {};
  teamsSorted.forEach((t, i) => { toneOfTeam[t.id] = TEAM_TONES[i % TEAM_TONES.length]!; });
  const toneOfPeople: Record<string, string> = {};
  [...new Set(view.communities.map((c) => c.people.name))].sort().forEach((n, i) => { toneOfPeople[n] = PEOPLE_TONES[i % PEOPLE_TONES.length]!; });

  const blocks: Record<TownId, BlockUse[]> = {};
  for (const t of view.towns) {
    const use: BlockUse[] = [{ kind: 'square', index: 0 }];
    for (const team of teamsSorted) if (team.home === t.id) use.push({ kind: 'team', team: team.id, index: 0 });
    // A quarter per community that lives here — registry communities in the view's own order, defined ones after.
    for (const c of view.communities) {
      if (!communityTowns(view, c).includes(t.id)) continue;
      const n = quarterBlocks(view, c, t.id);
      for (let i = 0; i < n; i++) use.push({ kind: 'quarter', community: c.id, index: i });
    }
    blocks[t.id] = use.slice(0, SPIRAL.length);
  }

  // The towns where they really are, then pushed apart until no two drawn towns overlap.
  const sites: Array<TownSite & { ox: number; oy: number }> = view.towns.map((t) => {
    const p = geo(t.lat, t.lng);
    const reach = Math.max(...blocks[t.id]!.map((_, i) => Math.max(Math.abs(SPIRAL[i]![0]), Math.abs(SPIRAL[i]![1]))));
    return { id: t.id, name: t.name, corridor: t.corridor, population: t.population, x: p.x, y: p.y, ox: p.x, oy: p.y, r: (reach + 0.5) * PITCH * 1.05 + 1.5 };
  });
  for (let it = 0; it < 220; it++) {
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const a = sites[i]!; const b = sites[j]!;
        let dx = b.x - a.x; let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const need = a.r + b.r + 2;
        if (dist >= need) continue;
        if (dist < 0.001) { dx = 1; dy = 0.3; dist = Math.hypot(dx, dy); }
        // The town with more to it holds its ground; the smaller one gives way.
        const wa = b.r / (a.r + b.r); const wb = a.r / (a.r + b.r);
        const push = (need - dist) * 0.5;
        a.x -= (dx / dist) * push * wa; a.y -= (dy / dist) * push * wa;
        b.x += (dx / dist) * push * wb; b.y += (dy / dist) * push * wb;
      }
    }
    for (const s of sites) { s.x += (s.ox - s.x) * 0.012; s.y += (s.oy - s.y) * 0.012; }
  }
  // Snap a town's centre to the block grid so streets are straight.
  for (const s of sites) { s.x = Math.round(s.x); s.y = Math.round(s.y); }

  // The highways bend with the towns: each road point moves by what the towns near it moved.
  const warp = (x: number, y: number): { x: number; y: number } => {
    let wx = 0; let wy = 0; let w = 0;
    for (const s of sites) {
      const k = 1 / (Math.pow(Math.hypot(x - s.ox, y - s.oy), 2) + 40);
      wx += (s.x - s.ox) * k; wy += (s.y - s.oy) * k; w += k;
    }
    return { x: x + wx / w, y: y + wy / w };
  };
  const roads: TownRoad[] = HIGHWAYS.map((h) => ({ id: h.id, name: h.name, pts: h.pts.map(([lat, lng]) => { const p = geo(lat, lng); return warp(p.x, p.y); }) }));

  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const s of sites) { x0 = Math.min(x0, s.x - s.r); y0 = Math.min(y0, s.y - s.r); x1 = Math.max(x1, s.x + s.r); y1 = Math.max(y1, s.y + s.r); }
  for (const r of roads) for (const p of r.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return {
    sites: sites.map(({ ox: _ox, oy: _oy, ...s }) => s), blocks, roads,
    bounds: { x0: x0 - 6, y0: y0 - 6, x1: x1 + 6, y1: y1 + 6 }, toneOfTeam, toneOfPeople,
  };
}

/** The near corner of a town's i-th block. */
export const blockOrigin = (site: { x: number; y: number }, i: number): { x: number; y: number } => {
  const [bx, by] = SPIRAL[i] ?? [0, 0];
  return { x: site.x + bx * PITCH - BLOCK / 2, y: site.y + by * PITCH - BLOCK / 2 };
};

const short = (s: string, n = 22): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The convex hull of some points on the ground (Andrew's monotone chain), counter-clockwise. */
export function hull(points: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Array<{ x: number; y: number }> = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  const upper: Array<{ x: number; y: number }> = [];
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const ACT_WORDS: Record<string, string> = { share: 'shared', study: 'opened a study', visit: 'visited', found: 'founded a circle', gather: 'gathered', baptize: 'baptised', train: 'trained leaders', recognize: 'recognised a church', send: 'sent a circle out', coach: 'coached', report: 'reported', assess: 'published a reading', support: 'gave support', 'found-team': 'founded a team', rest: 'rested' };

// ── the scene ───────────────────────────────────────────────────────────────────────────────────────────────────
export function buildFieldTown(view: FieldOpsView, day: number, layout: TownLayout = layoutField(view)): FieldTownScene {
  const at = seasonAt(view, day);
  const site = Object.fromEntries(layout.sites.map((s) => [s.id, s])) as Record<TownId, TownSite>;
  const community = Object.fromEntries(view.communities.map((c) => [c.id, c])) as Record<CommunityId, ViewCommunity>;
  const cDay = Object.fromEntries(at.communities.map((c) => [c.id, c]));
  const nameOf = Object.fromEntries(view.cast.map((p) => [p.role, p.name])) as Record<RoleId, string>;
  const teamName = Object.fromEntries(view.teams.map((t) => [t.id, t.name])) as Record<TeamId, string>;
  const buildings: TownBuilding[] = [];
  const plates: TownPlate[] = [];
  const links: TownLink[] = [];
  const bodyAt = new Map<BodyId, { x: number; y: number; z: number }>();
  const officeAt = new Map<TeamId, { x: number; y: number; z: number }>();
  const partnerAt = new Map<string, { x: number; y: number; z: number }>();

  // The corridors: the ground a team's work and a community's quarters sit on.
  for (const c of view.corridors) {
    const ss = c.towns.map((id) => site[id]).filter((s): s is TownSite => !!s);
    if (!ss.length) continue;
    const x0 = Math.min(...ss.map((s) => s.x - s.r)); const y0 = Math.min(...ss.map((s) => s.y - s.r));
    const x1 = Math.max(...ss.map((s) => s.x + s.r)); const y1 = Math.max(...ss.map((s) => s.y + s.r));
    // Its outline is the hull around its towns, so two corridors that interleave on the ground do not swallow
    // each other's towns the way their bounding boxes would.
    const ring: Array<{ x: number; y: number }> = [];
    for (const t of ss) for (let a = 0; a < 12; a++) ring.push({ x: t.x + Math.cos((a / 12) * Math.PI * 2) * (t.r + 1.5), y: t.y + Math.sin((a / 12) * Math.PI * 2) * (t.r + 1.5) });
    plates.push({ id: `corridor:${c.id}`, kind: 'corridor', x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, d: y1 - y0 + 2, poly: hull(ring), tone: CORRIDOR_TONES[c.id] ?? '#7f8ea8', label: c.name, corridor: c.id });
  }

  for (const t of view.towns) {
    const s = site[t.id]!;
    const use = layout.blocks[t.id] ?? [];
    // The streets: one along each side of every block that is used — a town is as big as what stands in it.
    const laid = new Set<string>();
    const street = (x: number, y: number, w: number, d: number) => {
      const key = `${x},${y},${w},${d}`;
      if (laid.has(key)) return;
      laid.add(key);
      plates.push({ id: `road:${t.id}:${key}`, kind: 'road', x, y, w, d, tone: '#2b3a52', town: t.id, corridor: t.corridor });
    };
    use.forEach((_, i) => {
      const o = blockOrigin(s, i);
      street(o.x - STREET, o.y - STREET, BLOCK + 2 * STREET, STREET);
      street(o.x - STREET, o.y + BLOCK, BLOCK + 2 * STREET, STREET);
      street(o.x - STREET, o.y, STREET, BLOCK);
      street(o.x + BLOCK, o.y, STREET, BLOCK);
    });

    use.forEach((u, i) => {
      const o = blockOrigin(s, i);
      const lot = (n: number) => ({ x: o.x + LOTS[n]![0], y: o.y + LOTS[n]![1] });
      if (u.kind === 'square') {
        plates.push({ id: `town:${t.id}`, kind: 'town', x: o.x, y: o.y, w: BLOCK, d: BLOCK, tone: '#33415a', label: t.name, town: t.id, corridor: t.corridor });
        // The town that was there before anybody came: a hall, and a block or two by how big the place is.
        const size = t.population > 90000 ? 3 : t.population > 25000 ? 2 : 1;
        const a = lot(0);
        buildings.push({ id: `hall:${t.id}`, kind: 'hall', x: a.x + 0.2, y: a.y + 0.2, w: 1.5, d: 1.5, h: 0.9 + size * 0.35, tone: TOWN_TONES.hall, roof: 'slab', label: t.name, sub: `${t.population.toLocaleString('en-US')} people · ${plural(t.churches, 'church', 'churches')} in the directory`, town: t.id, corridor: t.corridor, born: 0, rank: 3 });
        // A partner congregation stands on the square, at its own address in the directory.
        const partner = view.partners.find((p) => p.town === t.id);
        const b = lot(1);
        if (partner) {
          buildings.push({ id: `partner:${partner.id}`, kind: 'partner', x: b.x + 0.25, y: b.y + 0.2, w: 1.5, d: 1.2, h: 1.15, tone: TOWN_TONES.partner, roof: 'spire', label: partner.name, sub: `${partner.denomination ? `${partner.denomination} · ` : ''}a partner church${partner.address ? ` · ${partner.address}` : ''}`, town: t.id, corridor: t.corridor, born: 0, rank: 2 });
          partnerAt.set(partner.id, { x: b.x + 1, y: b.y + 0.8, z: 2.4 });
        } else if (size >= 2) {
          buildings.push({ id: `civic:${t.id}:1`, kind: 'civic', x: b.x + 0.3, y: b.y + 0.3, w: 1.3, d: 1.3, h: 0.8 + (size - 1) * 0.5, tone: TOWN_TONES.civic, roof: 'flat', label: t.name, town: t.id, corridor: t.corridor, born: 0, rank: 1 });
        }
        if (size >= 2) { const c2 = lot(2); buildings.push({ id: `civic:${t.id}:2`, kind: 'civic', x: c2.x + 0.3, y: c2.y + 0.35, w: 1.4, d: 1.1, h: 0.7 + size * 0.25, tone: TOWN_TONES.civic, roof: 'gable', label: t.name, town: t.id, corridor: t.corridor, born: 0, rank: 1 }); }
        if (size >= 3) { const c3 = lot(3); buildings.push({ id: `civic:${t.id}:3`, kind: 'civic', x: c3.x + 0.35, y: c3.y + 0.3, w: 1.2, d: 1.3, h: 1.7, tone: TOWN_TONES.civic, roof: 'flat', label: t.name, town: t.id, corridor: t.corridor, born: 0, rank: 1 }); }
        return;
      }
      if (u.kind === 'team' && u.team) {
        const team = at.teams.find((x) => x.id === u.team);
        const whole = view.teams.find((x) => x.id === u.team)!;
        const tone = layout.toneOfTeam[u.team] ?? TEAM_TONES[0]!;
        plates.push({ id: `teamblock:${u.team}`, kind: 'quarter', x: o.x, y: o.y, w: BLOCK, d: BLOCK, tone, label: team ? short(team.name, 26) : undefined, town: t.id, corridor: t.corridor, team: u.team, workedFrom: 0 });
        if (!team) return;
        const a = lot(0);
        buildings.push({ id: `team:${u.team}`, kind: 'team', x: a.x + 0.2, y: a.y + 0.2, w: 1.55, d: 1.45, h: 1.35, tone, accent: tone, roof: 'flat', label: team.name, sub: `a team of ${plural(team.members.length, 'person', 'people')} · founded day ${team.born} by ${nameOf[team.steward] ?? team.steward}`, town: t.id, corridor: t.corridor, team: u.team, born: team.born, rank: 3 });
        officeAt.set(u.team, { x: a.x + 1, y: a.y + 0.9, z: 1.9 });
        // A home for each person on the team, in the order they came — it appears the day they joined.
        whole.members.forEach((m, k) => {
          if (!team.members.includes(m)) return;
          const l = lot(1 + Math.floor(k / 2) % 3); const side = k % 2;
          buildings.push({ id: `home:${m}`, kind: 'home', x: l.x + 0.15 + side * 0.95, y: l.y + 0.3 + (Math.floor(k / 6) % 2) * 0.9, w: 0.8, d: 0.8, h: 0.55, tone, roof: 'gable', label: nameOf[m] ?? m, sub: `${m === team.steward ? 'leads' : 'on'} ${team.name}`, town: t.id, corridor: t.corridor, team: u.team, role: m, born: at.joined[m] ?? team.born, rank: 1 });
        });
        return;
      }
      if (u.kind === 'quarter' && u.community) {
        const c = community[u.community]; const cd = cDay[u.community];
        if (!c || !cd) return;
        const tone = layout.toneOfPeople[c.people.name] ?? PEOPLE_TONES[0]!;
        const worked = cd.workedBy;
        const lives = c.towns.includes(t.id);
        const here = bodiesOf(view, c.id, t.id);
        const slots = bodySlots(view, c.id, t.id);
        // A town the season carried this people's circle to has no quarter until that circle exists.
        const arrived = lives ? cd.born : Math.min(...here.map((b) => at.bodies.find((x) => x.id === b.id)?.foundedDay ?? Infinity));
        if (!lives && !(arrived <= day)) return;
        plates.push({ id: `quarter:${c.id}:${t.id}:${u.index}`, kind: 'quarter', x: o.x, y: o.y, w: BLOCK, d: BLOCK, tone, label: u.index === 0 ? c.people.name : undefined, town: t.id, corridor: t.corridor, community: c.id, people: c.people.name, team: worked, phase: cd.phase, workedFrom: cd.workedFrom });
        const primary = c.towns[0] === t.id;
        // Lots in this quarter, across its blocks: the beacon first (where the people live), then a lot a body.
        const head = lives ? 1 : 0;
        const lotIndex = (k: number) => k - u.index * LOTS.length;   // which lot of THIS block a quarter-wide index is
        const inBlock = (k: number) => k >= u.index * LOTS.length && k < (u.index + 1) * LOTS.length;
        const used = new Set<number>();
        if (lives && u.index === 0) {
          // The beacon: a storey a phase, lit as far as the records have derived.
          const a = lot(0);
          buildings.push({ id: `beacon:${c.id}:${t.id}`, kind: 'beacon', x: a.x + 0.55, y: a.y + 0.55, w: 0.7, d: 0.7, h: 0.5 + cd.phase * 0.42, tone: phaseColor(cd.phase), accent: tone, roof: 'beacon', label: `${c.people.name} · P${cd.phase}`, sub: `${c.name}${worked ? ` · worked by ${teamName[worked] ?? worked}` : ' · nobody has taken this people up'}`, town: t.id, corridor: t.corridor, community: c.id, people: c.people.name, team: worked ?? undefined, born: cd.born, phase: cd.phase, rank: primary ? 3 : 2 });
          used.add(0);
        }
        // Its circles and churches, each on its lot — a church on the lot of the circle it was recognised from.
        for (const b of here) {
          const k = head + (slots.slot.get(b.id) ?? 0);
          if (!inBlock(k)) continue;
          used.add(lotIndex(k));
          const bd = at.bodies.find((x) => x.id === b.id);
          if (!bd?.exists) continue;
          const l = lot(lotIndex(k));
          const church = bd.kind === 'church';
          const teamTone = bd.team ? layout.toneOfTeam[bd.team] : undefined;
          const size = Math.min(1, (bd.participants + bd.believers) / 24);
          buildings.push({
            id: `body:${b.id}`, kind: church ? 'church' : 'circle', body: b.id,
            x: l.x + (church ? 0.2 : 0.35), y: l.y + (church ? 0.3 : 0.35), w: church ? 1.55 : 1.25, d: church ? 1.2 : 1.25, h: (church ? 1.0 : 0.62) + size * 0.5,
            tone: bd.stalled ? '#5c6a82' : tone, accent: teamTone, roof: church ? 'spire' : 'dome',
            label: b.name, sub: `${church ? 'a church' : 'a circle'} among the ${c.people.name}${bd.team ? ` · ${teamName[bd.team] ?? bd.team}` : ' · here before the season'}`,
            town: t.id, corridor: t.corridor, team: bd.team ?? undefined, community: c.id, people: c.people.name, born: bd.foundedDay,
            stats: { participants: bd.participants, believers: bd.believers, baptized: bd.baptized, leaders: bd.leaders, generation: bd.generation, lifecycle: bd.stalled ? 'Stalled' : String(bd.lifecycle) },
            rank: church ? 3 : 2,
          });
          bodyAt.set(b.id, { x: l.x + 1, y: l.y + 1, z: church ? 2.6 : 1.5 });
        }
        // The households: small homes on the lots left over. Windows come on with seekers, roofs with believers —
        // shared out over the towns the community lives in, the first town first.
        const share = (total: number): number => { const k = c.towns.indexOf(t.id); if (k < 0) return 0; const each = Math.floor(total / c.towns.length); return each + (k < total % c.towns.length ? 1 : 0); };
        let believing = Math.min(12, share(cd.believers)); let seeking = Math.min(12, share(cd.seekers));
        for (let n = 0; n < LOTS.length; n++) {
          if (used.has(n)) continue;
          const l = lot(n);
          for (let k = 0; k < 4; k++) {
            const lit: 0 | 1 | 2 = believing > 0 ? 2 : seeking > 0 ? 1 : 0;
            if (lit === 2) believing -= 1; else if (lit === 1) seeking -= 1;
            buildings.push({ id: `house:${c.id}:${t.id}:${u.index}:${n}:${k}`, kind: 'household', x: l.x + 0.18 + (k % 2) * 0.92, y: l.y + 0.18 + Math.floor(k / 2) * 0.92, w: 0.66, d: 0.66, h: 0.42, tone: lit === 2 ? tone : lit === 1 ? TOWN_TONES.lit : TOWN_TONES.dark, roof: 'gable', label: `A ${c.people.name} household`, sub: lit === 2 ? 'believing' : lit === 1 ? 'seeking' : 'not yet reached', town: t.id, corridor: t.corridor, community: c.id, people: c.people.name, team: worked ?? undefined, born: cd.born, lit, rank: 1 });
          }
        }
      }
    });
  }

  // A daughter and the body it came out of; the day's support from a partner to a team.
  for (const b of at.bodies) {
    if (!b.exists || !b.parent) continue;
    const from = bodyAt.get(b.parent); const to = bodyAt.get(b.id);
    const c = community[b.community];
    if (from && to && c) links.push({ id: `daughter:${b.id}`, from, to, tone: layout.toneOfPeople[c.people.name] ?? '#fff', kind: 'daughter', born: b.foundedDay, team: b.team ?? undefined, community: b.community, people: c.people.name });
  }
  for (const s of at.supports) {
    const from = partnerAt.get(s.partner); const to = officeAt.get(s.team);
    if (from && to) links.push({ id: `support:${s.partner}:${s.team}:${day}`, from, to, tone: '#e8eef7', kind: 'support', born: day, team: s.team });
  }

  // Everybody, standing in the square of the town they are in — fanned out so nobody hides anybody.
  const standing = new Map<TownId, number>();
  const people: TownPerson[] = view.cast.map((p) => {
    const town = at.where[p.role] ?? p.town;
    const s = site[town] ?? layout.sites[0]!;
    const n = standing.get(town) ?? 0; standing.set(town, n + 1);
    const team = at.teamOf[p.role];
    const did = at.acted.find((a) => a.by === p.role && a.action !== 'rest');
    return {
      role: p.role, name: p.name, kind: p.kind, town, team,
      x: s.x - BLOCK / 2 - 0.5 + (n % 6) * 0.75, y: s.y + BLOCK / 2 + 0.5 + Math.floor(n / 6) * 0.6,
      tone: team ? (layout.toneOfTeam[team] ?? TOWN_TONES.nobody) : p.kind === 'partner' ? TOWN_TONES.pastor : p.kind === 'coordinator' || p.kind === 'steward' ? TOWN_TONES.office : TOWN_TONES.nobody,
      ...(did ? { acted: ACT_WORDS[did.action] ?? did.action } : {}),
    };
  });

  // What the day did, as light on the ground and as sentences.
  const pulses: TownPulse[] = [];
  const happened: string[] = [];
  for (const t of at.teams) if (t.born === day) happened.push(`${nameOf[t.steward] ?? t.steward} founded ${t.name} in ${site[t.home]?.name ?? t.home}.`);
  for (const b of at.bodies) if (b.exists && b.foundedDay === day && day > 0) happened.push(`${b.kind === 'church' ? 'A church was recognised' : 'A circle formed'} among the ${community[b.community]?.people.name ?? 'people'} in ${site[b.town]?.name ?? b.town}.`);
  for (const m of at.phaseMoves) happened.push(`The ${community[m.community]?.people.name ?? 'community'} of ${view.corridors.find((c) => c.id === community[m.community]?.corridor)?.name ?? 'the corridor'} moved from P${m.from} to P${m.to}.`);
  for (const a of at.acted) {
    if (a.action === 'rest' || a.action === 'coach') continue;
    const where = a.body ? bodyAt.get(a.body) : undefined;
    const s = site[a.town];
    const c = a.community ? community[a.community] : a.body ? community[view.bodies.find((b) => b.id === a.body)?.community ?? ''] : undefined;
    const p = where ?? (s ? { x: s.x, y: s.y } : null);
    if (!p) continue;
    pulses.push({ id: `${day}:${a.by}:${a.action}`, x: p.x, y: p.y, kind: a.action, tone: a.action === 'baptize' ? '#6ec6ff' : c ? (layout.toneOfPeople[c.people.name] ?? '#ffd27a') : '#ffd27a', label: `${nameOf[a.by] ?? a.by} ${ACT_WORDS[a.action] ?? a.action}` });
    if (a.action === 'baptize' || a.action === 'train' || a.action === 'send' || a.action === 'recognize') happened.push(`${nameOf[a.by] ?? a.by} ${ACT_WORDS[a.action]}${c ? ` among the ${c.people.name}` : ''} in ${s?.name ?? a.town}.`);
  }

  const spots: Array<{ town: TownId; weight: number }> = [];
  for (const t of at.teams) if (t.born === day && site[t.home]) spots.push({ town: t.home, weight: 3 });
  for (const b of at.bodies) if (b.exists && b.foundedDay === day && day > 0 && site[b.town]) spots.push({ town: b.town, weight: b.kind === 'church' ? 5 : 4 });
  for (const a of at.acted) if (site[a.town] && (a.action === 'recognize' || a.action === 'send' || a.action === 'baptize' || a.action === 'train')) spots.push({ town: a.town, weight: a.action === 'recognize' ? 5 : a.action === 'send' ? 4 : 2 });
  // A people moving a phase is a thing that happened to a whole quarter: the camera goes to the town it is drawn in.
  for (const m of at.phaseMoves) { const c = community[m.community]; const town = c ? communityTowns(view, c)[0] : undefined; if (town && site[town]) spots.push({ town, weight: 3 }); }
  const spotlight = spots.sort((p, q) => q.weight - p.weight)[0]?.town;

  const living = at.bodies.filter((b) => b.exists);
  const start = seasonAt(view, 0);
  const phasesMoved = at.communities.reduce((n, c) => n + Math.max(0, c.phase - (start.communities.find((x) => x.id === c.id)?.phase ?? c.phase)), 0);
  return {
    day, bounds: layout.bounds, focus: { ...layout.bounds, pts: ringOf(layout.sites) }, sites: layout.sites, roads: layout.roads, plates, buildings, people, links, pulses, happened, spotlight,
    tally: {
      teams: at.teams.length, circles: living.filter((b) => b.kind === 'circle').length, churches: living.filter((b) => b.kind === 'church').length,
      baptized: living.reduce((n, b) => n + b.baptized, 0), leaders: living.reduce((n, b) => n + b.leaders, 0),
      believers: at.communities.reduce((n, c) => n + c.believers, 0), seekers: at.communities.reduce((n, c) => n + c.seekers, 0),
      taken: at.communities.filter((c) => c.workedBy).length, communities: at.communities.length, phasesMoved,
    },
    peoples: Object.entries(layout.toneOfPeople).map(([name, tone]) => ({ name, tone })),
    teams: at.teams.map((t) => ({ id: t.id, name: t.name, tone: layout.toneOfTeam[t.id] ?? TEAM_TONES[0]!, born: t.born })),
    corridors: view.corridors.map((c) => ({ id: c.id, name: c.name, tone: CORRIDOR_TONES[c.id] ?? '#7f8ea8' })),
  };
}

/** Four points around each town — what a camera frames to hold those towns. */
const ringOf = (sites: readonly TownSite[]): Array<{ x: number; y: number }> => sites.flatMap((s) => [{ x: s.x - s.r, y: s.y }, { x: s.x + s.r, y: s.y }, { x: s.x, y: s.y - s.r }, { x: s.x, y: s.y + s.r }]);

/** Does a thing in the scene belong to what the filter names? With no filter, everything does. */
export function matchesFilter(x: { people?: string; team?: TeamId | null; kind?: string }, f: TownFilter): boolean {
  if (f.people && x.people !== f.people) return false;
  if (f.team && x.team !== f.team) return false;
  return true;
}

/** The ground a filter, a corridor or a town covers — what the camera flies to. Null when nothing matches. */
export function extentOf(scene: FieldTownScene, pick: { corridor?: string; town?: TownId; filter?: TownFilter }): { x0: number; y0: number; x1: number; y1: number; pts?: Array<{ x: number; y: number }> } | null {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const pts: Array<{ x: number; y: number }> = [];
  const take = (x: number, y: number, w = 0, d = 0) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + d); pts.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }); };
  if (pick.town) { const s = scene.sites.find((t) => t.id === pick.town); if (s) take(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2); }
  else if (pick.corridor) { for (const s of scene.sites) if (s.corridor === pick.corridor) take(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2); }
  else if (pick.filter && (pick.filter.people || pick.filter.team)) {
    for (const p of scene.plates) if (p.kind === 'quarter' && matchesFilter(p, pick.filter)) take(p.x - 2, p.y - 2, p.w + 4, p.d + 4);
    for (const b of scene.buildings) if ((b.people || b.team) && matchesFilter(b, pick.filter)) take(b.x - 2, b.y - 2, b.w + 4, b.d + 4);
  } else return scene.focus;
  return Number.isFinite(x0) ? { x0, y0, x1, y1, pts } : null;
}
