/**
 * FIELD OPERATIONS — the vocabulary (docs/FIELD-OPERATIONS.md).
 *
 * A REGION is a real place: the corridors north of Denver, their towns, and the PEOPLE COMMUNITIES the public
 * registry (`gc-public`) holds for each corridor, each one starting at the phase the registry's latest result
 * says it is at. A SCENARIO is a season: teams of workers, the partner churches that support them, the weeks
 * and what each is for. A SEASON (staging) is one run of a scenario with one cast, on one seed.
 *
 * WHAT MOVES THE WORLD HERE IS THE WORK. Great Commission's rule is that growth is exogenous, because that game
 * tests the picture and not the carriers. This game is about the OPERATION — a team that visits, shares, studies,
 * gathers, baptises, recognises and sends — so the work is what creates the chances. What comes OF a chance is
 * still not the worker's to decide: every outcome is a draw from the seed against a hidden READINESS the world
 * holds for each community, committed before the season and revealed at its end. Nobody is converted by a verb;
 * a verb opens a door the world may or may not walk through.
 *
 * A PHASE IS DERIVED FROM THE RECORDS, never set. `phaseOf` reads the counters the season has produced — workers
 * present, conversations, baptisms, churches, generations — against the registry's own `fw-npl-phases` criteria
 * and says where the community stands. A published READING is a steward's claim about the same thing; the score
 * compares the two. The registry's phase at open is the FLOOR the season starts from, with counters seeded to
 * match it, so a community the registry says is at P3 opens with believers and baptisms behind it.
 *
 * EVERY AGENT IN THE SEASON IS REAL. A team is an org agent, a worker is a persona agent somebody custodies, a
 * partner church is an org agent named for a real church and marked as a game agent, a circle or church the
 * season founds adopts a body agent from a pool the operator chartered. The engine knows none of that: it knows
 * roles, bodies and addresses the host hands it, which is what lets it be tested without an estate.
 */

export type RoleId = string;
export type TeamId = string;
export type TownId = string;
export type CorridorId = string;
export type CommunityId = string;
export type BodyId = string;
export type PartnerId = string;

// ── THE PHASES, as the registry encodes them ──────────────────────────────────────────────────────────────
//
// `gc:fw-npl-phases` (`gc:lvl-npl-p0 … p7`) is the framework the public registry's results are read in, and
// it is what this game plays toward. P2 and P6 are interpolated levels in that scheme and say so. The Phases
// of Engagement sequence the registry aligns them to is © 2026 Phases of Engagement Collaborative, CC BY-NC-SA 4.0.

export type PhaseN = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const PHASE_NAMES: Record<PhaseN, string> = {
  0: 'Restart needed / never engaged',
  1: 'Entry / access',
  2: 'Gospel sowing',
  3: 'Baptisms',
  4: 'Churches started',
  5: '2nd generation churches',
  6: '3rd generation churches',
  7: 'Multiplying 4th generation streams, or 10% of the community',
};
export const PHASE_SHORT: Record<PhaseN, string> = { 0: 'Restart', 1: 'Entry', 2: 'Sowing', 3: 'Baptisms', 4: 'Churches', 5: '2nd gen', 6: '3rd gen', 7: 'Multiplying' };
/** The registry's level IRI for a phase — what a published reading says it assigned. */
export const phaseIri = (p: PhaseN): string => `https://ontology.global.church/core#lvl-npl-p${p}`;
export const PHASE_FRAMEWORK = 'https://ontology.global.church/core#fw-npl-phases';

// ── THE REGION ──────────────────────────────────────────────────────────────────────────────────────────

/** A town on the public road atlas: where a worker can be, and where a body meets. */
export interface TownDef {
  id: TownId;
  name: string;
  corridor: CorridorId;
  lat: number;
  lng: number;
  population: number;
  churches: number;
}

export interface CorridorDef {
  id: CorridorId;
  name: string;
  counties: string[];
  towns: TownId[];
  /** The local body the field app already knows for this corridor — a real org agent, if one is on the estate. */
  hotspotOrg?: string;
}

/** WHO a people is: the registry's identity, cited. Never carries a phase. */
export interface PeopleRef {
  name: string;
  iri: string;
  scheme: string;
  ropId?: string;
  peid?: string;
  pgId?: string;
  language?: string;
  religion?: string;
  homeCountry?: string;
}

/**
 * A PEOPLE COMMUNITY (`gc:PeopleCommunity`): the body of one people in one corridor, which is the only kind of
 * thing a phase is claimed of. `registry` is where the public picture put it when the world was compiled — the
 * season starts there. `base` is the hidden readiness the world author gave it, which the seed perturbs at open.
 */
export interface CommunityDef {
  id: CommunityId;
  iri: string;
  name: string;
  people: PeopleRef;
  corridor: CorridorId;
  towns: TownId[];
  /** An estimate of how many of this people live in the corridor, for the 10% test. Null when nobody has one. */
  population: number | null;
  registry: { phase: PhaseN; qualifier: 'restart-needed' | null; resultDate: string | null; framework: string };
  /** The registry's own one-word claims, cited, for the board. */
  claims: Array<{ label: string; value: string; source: string }>;
  base: { readiness: number };
  /** A community DEFINED IN PLAY — invented, by the part who defined it; never a registry node. */
  fictional?: true;
  definedBy?: RoleId;
  definition?: string;
}

/** A SUPPORTING CHURCH — a real congregation from the directory, represented in the season by a GAME agent. */
export interface PartnerDef {
  id: PartnerId;
  name: string;
  town: TownId;
  corridor: CorridorId;
  denomination?: string;
  website?: string;
  /** The directory's own id for the church, so the agent says which real congregation it stands for. */
  directoryId?: string;
  address?: string;
  lat: number;
  lng: number;
  /** How much support it can give in a season: each `support` act spends one. */
  capacity: number;
}

/**
 * A TEAM THE CAST INTENDS TO FORM — content, not a thing that exists. Nothing is a team until a part FOUNDS it in play
 * (`found-team`), invites the others and they join; this is the plan each part carries into the season, the name it
 * would give the team and who it would ask. An agent may name its own and ask whom it likes; the house follows the plan.
 */
export interface TeamDef {
  id: TeamId;
  name: string;
  corridor: CorridorId;
  home: TownId;
  members: RoleId[];
}

/**
 * A TEAM THE SEASON HAS — founded by a part, who is its steward; invited parts join or decline. `agent` is the team's
 * own org agent once the host has chartered it (a real agent at the steward's custodian's Home, as the field app
 * makes one), and `null` while that is in flight; `plan` is the intended team this one was founded from, if any.
 */
export interface TeamState {
  id: TeamId;
  name: string;
  purpose: string | null;
  corridor: CorridorId;
  home: TownId;
  steward: RoleId;
  members: RoleId[];
  invited: RoleId[];
  declined: RoleId[];
  foundedDay: number;
  plan: TeamId | null;
  agent: string | null;
  /** Whose Home custodies the team agent, stamped by the host when it lands — a handle, never a key. */
  custodian?: string;
}

export interface Region {
  id: string;
  name: string;
  blurb: string;
  corridors: CorridorDef[];
  towns: TownDef[];
  communities: CommunityDef[];
  partners: PartnerDef[];
  /** When the registry was read, so the board can say how old its floor is. */
  registryReadAt: string;
}

// ── THE SCENARIO ────────────────────────────────────────────────────────────────────────────────────────

export interface Look {
  skin: string; hair: string; wear: string; accent: string;
  figure?: 'm' | 'f';
  age?: number;
  hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'bald' | 'curls';
  facial?: 'moustache' | 'beard' | 'stubble';
  accessory?: 'glasses' | 'veil' | 'scarf' | 'goggles' | 'pearls';
}

/**
 * THE KINDS OF PART. A WORKER does the field work and belongs to a team. A COACH coaches workers and belongs to
 * a team. A STEWARD publishes readings for the field (the progress steward of the workspace). A PARTNER speaks
 * for a supporting church and commits its support. A COORDINATOR runs the field and may move anybody.
 */
export type PartKind = 'worker' | 'coach' | 'steward' | 'partner' | 'coordinator';

/** How good a part is at each kind of act, 0–1. The world's readiness is the other half of every roll. */
export interface Gifts { share: number; disciple: number; gather: number; lead: number; coach: number }

export interface Role {
  id: RoleId;
  name: string;
  kind: PartKind;
  /** The team this part INTENDS to form or join (content); the season's membership lives in `state.membership`. */
  team?: TeamId;
  partner?: PartnerId;
  /** Where the part starts. A partner starts at its church's town. */
  home: TownId;
  blurb: string;
  appearance?: string;
  secret: string;
  archetype: string;
  look: Look;
  gifts: Gifts;
  languages: string[];
  lines: { greet: string; probe: string; report: string; press: string; rest: string };
  choices?: ChoiceDef[];
}

/**
 * WHAT THE ROAD BRINGS. A season is a journey, and a journey has days when the road itself does something: a
 * cultural barrier that only a worker who speaks the language can get past this week, pressure on a body that
 * sends it quiet, a worker's own calling wavering, a partner's provision falling through, and the grace of a family
 * that asks on its own. Drawn by the seed from this list, one day in three or so; visible on the board as the week's
 * weather. The realities the work is done in, as content rather than as a lecture.
 */
export interface TrailEventDef {
  id: string;
  kind: 'barrier' | 'pressure' | 'calling' | 'provision' | 'grace';
  /** Said in the field's voice when it happens; `{target}` is replaced with the community, body, worker or team it fell on. */
  text: string;
  /** How many days it lasts, for a barrier. */
  days?: number;
}

/** A DECISION A PART FACES on a day of the season, with consequences that change the season and never the world. */
export interface ChoiceDef {
  id: string;
  day: number;
  question: string;
  options: Array<{ id: string; label: string; outcome: string; consequence: string; effect?: ChoiceEffect }>;
}
export interface ChoiceEffect { energy?: number; capacity?: number; moveTo?: TownId; rest?: number }

export interface WeekDef {
  n: number;
  name: string;
  objective: string;
  opening: string;
  interlude: string;
}

export interface Scenario {
  id: string;
  name: string;
  region: string;
  blurb: string;
  tone: string;
  voice?: { character?: string[]; director?: string[] };
  /** The teams the cast intends to form; see `TeamDef`. */
  teams: TeamDef[];
  roles: Role[];
  weeks: WeekDef[];
  /** How long one DAY lasts at full pace, in minutes. Days play out in minutes; a season in an evening. */
  dayMinutes: number;
  closingMinutes: number;
  /** What the road may bring, drawn by the seed. */
  trail: TrailEventDef[];
}

// ── THE SEASON ──────────────────────────────────────────────────────────────────────────────────────────

export type StagePhase = 'day' | 'interlude' | 'closing' | 'revealed';
export type Operator = 'human' | 'agent';

export interface Casting {
  role: RoleId;
  mind?: 'human' | 'agent' | 'rules';
  /** The part's own agent — a persona's name, a church agent's address — kept through a takeover. */
  agent: string;
  name: string;
  custodian: string;
  operator: Operator;
  playerId?: string;
  personaCustodian?: string;
  playedBy?: string;
}

export type BodyKind = 'circle' | 'church';
export type CircleLifecycle = 'Forming' | 'Active' | 'Stalled' | 'RecognizedAsChurch';
export type ChurchLifecycle = 'Forming' | 'Established' | 'Multiplying' | 'Stalled';

/**
 * A BODY — a circle the work has formed, or a church recognised from one. The season's own; the field app's
 * `formation-community` / `ekklesia-community` records are written from these at every interlude, and `agent` is
 * the body's OWN agent once the host has chartered it as the founder's act (null while in flight, and always null
 * for a church the registry already counted). `team` is the team of the part that founded it; the registry's own
 * floor churches belong to none.
 */
export interface Body {
  id: BodyId;
  kind: BodyKind;
  community: CommunityId;
  town: TownId;
  team: TeamId | null;
  foundedDay: number;
  /** The body this one came out of: a church's mother church, a circle's sending church. */
  parent: BodyId | null;
  /** 1 for a body the team formed; a daughter is its mother's generation + 1. */
  generation: number;
  /** The circle this church was recognised from, when it was. */
  recognizedFrom: BodyId | null;
  participants: number;
  believers: number;
  baptized: number;
  leaders: number;
  lifecycle: CircleLifecycle | ChurchLifecycle;
  facilitator: RoleId | null;
  lastGatheredDay: number;
  /** The body agent's address, once the host chartered one for it. */
  agent: string | null;
  /** Whose Home custodies the body agent, stamped by the host when it lands. */
  custodian?: string;
  /** A name the season gave it — never a person's. */
  name: string;
}

/** The season's running counts for one community — what the records say, and what a phase is derived from. */
export interface CommunityState {
  /** Days on which a worker was present among this community, counted once per day. */
  presenceDays: number;
  visits: number;
  conversations: number;
  seekers: number;
  /** Discovery studies running that are not yet circles. */
  studies: number;
  believers: number;
  baptized: number;
  leaders: number;
  /** The phase the records last derived — cached so a change is one event, never a recomputation on every view. */
  phase: PhaseN;
  /** Published readings, latest last. */
  readings: Array<{ by: RoleId; phase: PhaseN; qualifier: 'restart-needed' | null; day: number; at: number }>;
  observations: Array<{ by: RoleId; text: string; day: number; at: number }>;
}

/** What the world holds about a community that no view carries until the reveal. */
export interface CommunityTruth { readiness: number }

export interface Support {
  id: string;
  partner: PartnerId;
  by: RoleId;
  team: TeamId;
  resource: 'funds' | 'volunteers' | 'venue' | 'prayer';
  day: number;
  at: number;
}

export interface FieldOpsState {
  scenario: string;
  region: string;
  seedCommit: string;
  seedHex?: string;
  cast: Casting[];
  pace: number;
  day: number;
  week: number;
  phase: StagePhase;
  deadline: number | null;
  dayStartedAt: number;
  where: Record<RoleId, TownId>;
  /** The day each part last spent its act — one act a day, and a day is the unit of the whole game. */
  acted: Record<RoleId, number>;
  /** Energy per part, 0–100: an act costs some, a rest or a night gives it back; a spent worker's rolls weaken. */
  energy: Record<RoleId, number>;
  /** A coach's lift on a worker, for the day it was given. */
  coached: Record<RoleId, number>;
  communities: Record<CommunityId, CommunityState>;
  /** The teams the season has founded, in the order they were founded. Empty at open: a season BOOTSTRAPS. */
  teams: TeamState[];
  /** Which team each part is on, once it has founded or joined one. */
  membership: Record<RoleId, TeamId>;
  /**
   * THE COMMUNITIES THE WORKSPACE WORKS WITH, and which team took each up — the pointer the field app keeps. The
   * registry's communities are there to be adopted; nobody works among a people nobody has taken up.
   */
  worked: Record<CommunityId, TeamId>;
  /** Communities DEFINED in play: invented, marked, with a readiness the seed drew when they were defined. */
  defined: CommunityDef[];
  bodies: Body[];
  supports: Support[];
  /** Team capacity from support: each unit raises the team's rolls a little for the season. */
  capacity: Record<TeamId, number>;
  /** What the road has brought and is still in force: a barrier on a community until a day, a pressure that stalled a body. */
  trail: Array<{ id: string; kind: TrailEventDef['kind']; day: number; target: string; targetName: string; until: number; text: string }>;
  /** The decisions parts have made. */
  outcomes: Array<{ key: string; by: RoleId; choice: string; option: string; day: number }>;
  /** The hidden state, per community. Written at open from the world and the seed; read by rolls and the score. */
  truth: Record<CommunityId, CommunityTruth>;
  /** How many draws the season has made — the seed stream's position, so a replay draws the same. */
  rolls: number;
  log: FieldOpsEvent[];
  startedAt: number;
  endedAt: number | null;
}

// ── ACTIONS ─────────────────────────────────────────────────────────────────────────────────────────────

export type FieldOpsAction =
  | { type: 'move'; town: TownId }
  | { type: 'say'; text: string }
  | { type: 'whisper'; to: RoleId; text: string }
  | { type: 'visit'; community: CommunityId }
  | { type: 'share'; community: CommunityId }
  | { type: 'study'; community: CommunityId }
  | { type: 'found'; community: CommunityId }
  | { type: 'gather'; body: BodyId }
  | { type: 'baptize'; body: BodyId }
  | { type: 'train'; body: BodyId }
  | { type: 'recognize'; body: BodyId }
  | { type: 'send'; body: BodyId; town: TownId }
  | { type: 'coach'; who: RoleId }
  | { type: 'report'; community: CommunityId; text: string }
  | { type: 'assess'; community: CommunityId; phase: PhaseN; qualifier?: 'restart-needed' }
  | { type: 'support'; team: TeamId; resource: Support['resource'] }
  | { type: 'choose'; choice: string; option: string }
  /** FOUND A TEAM where you stand: you are its steward; `invite` names who is asked; `plan` the intended team it is, if any. */
  | { type: 'found-team'; name: string; purpose?: string; invite?: RoleId[]; plan?: TeamId }
  /** A steward asks one more part onto the team. Free. */
  | { type: 'invite'; who: RoleId }
  /** An invited part answers. Free, like answering a bell. */
  | { type: 'join'; team: TeamId }
  | { type: 'decline'; team: TeamId }
  /** A team's steward takes communities up into the team's work — the workspace's pointer. Free. */
  | { type: 'adopt'; communities: CommunityId[] }
  /** DEFINE a new People Community in a town: a name, who they are in the steward's words. A day's act; the team takes it up. */
  | { type: 'define-community'; name: string; people: string; town: TownId; definition: string; language?: string }
  | { type: 'rest' };

// ── EVENTS ──────────────────────────────────────────────────────────────────────────────────────────────
//
// Every act is public to the field: this is an operation, not a secret. A whisper is between two parts.

export interface Outcome {
  /** What the act produced, in the counters' own words. */
  seekers?: number; believers?: number; baptized?: number; leaders?: number; participants?: number; studies?: number;
  /** A body founded, recognised or sent by this act. */
  body?: BodyId;
}

export type FieldOpsEvent =
  | { type: 'said'; at: number; by: RoleId; town: TownId; text: string; via: Operator }
  | { type: 'whispered'; at: number; by: RoleId; to: RoleId; text: string }
  | { type: 'moved'; at: number; who: RoleId; from: TownId; to: TownId; day: number }
  | { type: 'acted'; at: number; by: RoleId; day: number; town: TownId; action: Exclude<FieldOpsAction['type'], 'move' | 'say' | 'whisper' | 'invite' | 'join' | 'decline' | 'choose' | 'adopt'>; community: CommunityId | null; body: BodyId | null; text: string; outcome: Outcome; via: Operator }
  | { type: 'adopted'; at: number; by: RoleId; day: number; team: TeamId; communities: CommunityId[] }
  | { type: 'defined'; at: number; by: RoleId; day: number; team: TeamId; community: CommunityId; name: string; town: TownId }
  | { type: 'team-founded'; at: number; by: RoleId; day: number; team: TeamId; name: string; corridor: CorridorId; home: TownId; invited: RoleId[] }
  | { type: 'invited'; at: number; by: RoleId; day: number; team: TeamId; who: RoleId }
  | { type: 'joined'; at: number; who: RoleId; day: number; team: TeamId }
  | { type: 'declined'; at: number; who: RoleId; day: number; team: TeamId }
  | { type: 'founded'; at: number; by: RoleId; day: number; body: BodyId; kind: BodyKind; community: CommunityId; town: TownId; generation: number; agent: string | null; name: string }
  | { type: 'recognized'; at: number; by: RoleId; day: number; circle: BodyId; church: BodyId; community: CommunityId; town: TownId; agent: string | null; name: string }
  | { type: 'reported'; at: number; by: RoleId; day: number; community: CommunityId; text: string }
  | { type: 'assessed'; at: number; by: RoleId; day: number; community: CommunityId; phase: PhaseN; qualifier: 'restart-needed' | null; derived: PhaseN }
  | { type: 'supported'; at: number; by: RoleId; day: number; partner: PartnerId; team: TeamId; resource: Support['resource'] }
  | { type: 'stalled'; at: number; day: number; body: BodyId; community: CommunityId }
  | { type: 'trail'; at: number; day: number; id: string; kind: TrailEventDef['kind']; target: string; targetName: string; text: string; until: number }
  | { type: 'chose'; at: number; by: RoleId; day: number; choice: string; option: string; outcome: string; text: string }
  | { type: 'phase'; at: number; day: number; community: CommunityId; from: PhaseN; to: PhaseN }
  | { type: 'cue'; at: number; text: string; by: 'house' | 'director' }
  | { type: 'day'; at: number; day: number; week: number; phase: StagePhase; deadline: number | null }
  | { type: 'revealed'; at: number; seed: string };

// ── THE VIEW ────────────────────────────────────────────────────────────────────────────────────────────

export interface ViewPerson {
  role: RoleId; name: string; kind: PartKind; operator: Operator; agent: string;
  /** The team this part is ON (membership), not the one it intended. */
  team?: TeamId; partner?: PartnerId;
  /** Teams this part has been asked onto and has not answered. */
  invitedTo?: TeamId[];
  town: TownId; townName: string;
  appearance?: string; look: Look; mind?: 'human' | 'agent' | 'rules'; playedBy?: string; custodian?: string;
  energy: number;
  /** Has this part spent today's act? */
  actedToday: boolean;
  /** What it did today, for the board. */
  today: string | null;
}

export interface ViewCommunity {
  id: CommunityId; iri: string; name: string; corridor: CorridorId; towns: TownId[];
  people: PeopleRef; population: number | null;
  registry: CommunityDef['registry']; claims: CommunityDef['claims'];
  /** The team that took this community up, or null — nobody works among a people nobody has taken up. */
  workedBy: TeamId | null;
  fictional?: true; definedBy?: RoleId; definition?: string;
  counts: Omit<CommunityState, 'readings' | 'observations'>;
  /** The phase the records derive, and why not the next one. */
  derived: PhaseN; blockedBy: string | null;
  reading: { by: RoleId; phase: PhaseN; qualifier: 'restart-needed' | null; day: number } | null;
  bodies: BodyId[];
  observations: Array<{ by: RoleId; text: string; day: number }>;
}

export interface ViewBody extends Omit<Body, 'facilitator'> { facilitator: RoleId | null; teamName: string }
export interface ViewTeam extends TeamState { capacity: number }

export interface Score {
  communities: Array<{ community: CommunityId; name: string; start: PhaseN; end: PhaseN; moved: number; published: PhaseN | null; accurate: boolean | null; readiness: number; reachedP7: boolean }>;
  teams: Array<{ team: TeamId; name: string; acts: number; circles: number; churches: number; generations: number; baptized: number }>;
  parts: Array<{ role: RoleId; name: string; operator: Operator; mind: 'human' | 'agent' | 'rules'; acts: number; days: number; agentDays: number }>;
  /** The headline: how many phases the field moved, and how many communities reached P7. */
  movedTotal: number; reachedP7: number;
  verdict: 'field-moved' | 'field-held' | 'field-slipped';
}

export interface FieldOpsView {
  scenario: string; scenarioName: string; region: string; regionName: string; registryReadAt: string;
  day: number; week: number; weekName: string; objective: string; weeks: number; daysPerWeek: number; pace: number;
  phase: StagePhase; deadline: number | null; seedCommit: string;
  you: {
    role: RoleId; name: string; kind: PartKind; blurb: string; secret: string; look: Look;
    /** The team you are on, if you have founded or joined one. */
    team?: TeamId; partner?: PartnerId;
    /** The team you set out to form or join — the plan — and who it would have on it. Yours to follow or not. */
    intended?: TeamDef;
    /** Teams you have been asked onto and have not answered. */
    invitedTo: TeamId[];
    town: TownId; energy: number; actedToday: boolean;
    /** What this part may do today, here — the engine's own list, so a client draws only real buttons. */
    may: Array<{ action: FieldOpsAction['type']; why?: string }>;
    /** A decision before you today, if any. */
    choices: Array<{ id: string; question: string; options: Array<{ id: string; label: string }> }>;
  } | null;
  /** What the road has brought and is still in force — the week's weather, on the board. */
  trail: Array<{ id: string; kind: TrailEventDef['kind']; day: number; target: string; targetName: string; until: number; text: string }>;
  outcomes: Array<{ key: string; by: RoleId; day: number }>;
  corridors: CorridorDef[];
  towns: TownDef[];
  communities: ViewCommunity[];
  bodies: ViewBody[];
  partners: Array<PartnerDef & { used: number; agent: string | null }>;
  /** The teams the season has founded so far — none at open. */
  teams: ViewTeam[];
  cast: ViewPerson[];
  /** The field's activity, newest last — every act anybody made, with its outcome. */
  transcript: FieldOpsEvent[];
  reveal: { seed: string; truth: Record<CommunityId, CommunityTruth>; score: Score } | null;
}
