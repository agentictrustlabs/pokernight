/**
 * GREAT COMMISSION — the vocabulary (docs/GREAT-COMMISSION.md §4–§8).
 *
 * A REGION is a place: fictional peoples, and rooms that are workspaces. A SCENARIO is a script: parts, rounds,
 * what each part holds in its vault, the choices written for it. A STAGING is one night of a scenario in a
 * region with one cast. Three things, on purpose, exactly as a mystery's venue · title · staging are.
 *
 * Nothing in here is I/O and nothing is random. Every draw comes from the seed the host committed to before the
 * night began — including HOW THE WORLD MOVES, which is what lets a night be replayed and lets the same scenario
 * be run before and after a substrate change and compared.
 *
 * THE ONE RULE THE TYPES ENFORCE. A people's hidden state (`PeopleTruth`) is written by the engine's clock and by
 * nothing else. No action carries a field that names it; no handler is handed it. Growth is exogenous.
 */

export type RoleId = string;
export type RoomId = string;
export type PeopleId = string;
export type EvidenceId = string;

// ── THE PHASES OF ENGAGEMENT, as content ─────────────────────────────────────────────────────────────────────
//
// © 2026 Phases of Engagement Collaborative (Frontiers, IMB, Joshua Project, Engage Network, Vision 5:9,
// Accelerate), CC BY-NC-SA 4.0 — encoded from the published form under its own names, without alteration, and
// attributed. Phase is the FORM (where a people is on the recurring sequence); strength is the MOTION; the
// Toolkit keeps them apart and so does this. Phase 0-R is the one place the sequence runs backward: engagement
// that has lapsed. That licence carries into anything derived from it.

/** 0 Waiting · 1 Entry · 2 Evangelism · 3 Discipleship · 4 Local Church · 5 Reproducing Church · 6 Multiplying Church · 7 Sustained Gospel Presence. */
export type PhaseNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** A phase, or the restart indicator: the sequence has run backward and the people needs re-entry. */
export type Phase = PhaseNumber | '0-R';
export type Strength = 'unknown' | 'initial' | 'growing' | 'active' | 'flourishing';

export const PHASE_NAMES: Record<PhaseNumber, string> = {
  0: 'Waiting', 1: 'Entry', 2: 'Evangelism', 3: 'Discipleship', 4: 'Local Church',
  5: 'Reproducing Church', 6: 'Multiplying Church', 7: 'Sustained Gospel Presence',
};
export const PHASE_0R_NAME = 'Restart (0-R)';
export const phaseName = (p: Phase): string => (p === '0-R' ? PHASE_0R_NAME : PHASE_NAMES[p]);
export const phaseNumber = (p: Phase): number => (p === '0-R' ? 0 : p);

/**
 * THE WALK — the conversational form of the assessment: ordered questions, stopping at the first no. Each
 * question is what crossing INTO that phase answers yes to. Written once here because it is what the researcher
 * asks and what the house's own policy walks; the wording follows Bud Houston's 2026-09-17 commentary, one
 * Collaborative member's phrasing rather than the Toolkit text.
 */
export const WALK: ReadonlyArray<{ phase: PhaseNumber; question: string }> = [
  { phase: 1, question: 'Is anyone working here in the name of Jesus?' },
  { phase: 2, question: 'Are they sharing the gospel in a way the people themselves find fitting?' },
  { phase: 3, question: 'Have people responded in repentance and faith?' },
  { phase: 4, question: 'Are there local churches?' },
  { phase: 5, question: 'Have those churches sent out their own?' },
  { phase: 6, question: 'To how many generations?' },
  { phase: 7, question: 'Are ten percent worshipping, or are there multiple streams of multiplying churches?' },
];

// ── GRAIN ──────────────────────────────────────────────────────────────────────────────────────────────────
//
// The whole safeguarding argument is one axis: HOW FINE a fact is. A person-grain fact can get somebody
// killed; a people-grain fact is what a map is made of. Ordered finest → coarsest, so "you may coarsen, never
// refine" is one comparison.

export type Grain = 'person' | 'household' | 'village' | 'province' | 'people';
export const GRAINS: readonly Grain[] = ['person', 'household', 'village', 'province', 'people'];
export const grainRank = (g: Grain): number => GRAINS.indexOf(g);
/** Is `a` at least as coarse as `b`? */
export const coarserOrEqual = (a: Grain, b: Grain): boolean => grainRank(a) >= grainRank(b);

// ── THE REGION ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A FICTIONAL PEOPLE, and everything about it that is a fact of the world rather than an assessment.
 *
 * `truth` is the simulation's ground truth — the hidden event state of the fictional world — and is never called
 * the "true phase". A phase is something the researcher ASSESSES from testimony; the game scores the assessment
 * against these hidden events and keeps the two words apart, so nobody reads a night as saying the real picture
 * could know such a thing if only it collected enough.
 */
export interface PeopleDef {
  id: PeopleId;
  name: string;
  /** Where in the region, for the map. Fictional. */
  province: string;
  villages: string[];
  /** What everybody knows going in — the public reading at the start of the night, if any. */
  publicReading?: { phase: Phase; strength: Strength; vintage: number };
  /**
   * HOW THE WORLD MOVES HERE — a schedule the seed may perturb: the phase and strength at the end of each round.
   * Written by the scenario, advanced by the clock, touched by no action. A shorter list than the rounds holds
   * its last entry.
   */
  schedule: Array<{ phase: Phase; strength: Strength }>;
  /** The fine-grain facts the adversary wants and the picture must never carry. */
  truth: { village: string; households: number };
  /** Which part is the carrier here — adjacent, or returned — whose vault sees this people move first. */
  carrier?: RoleId;
}

/** A ROOM IS A WORKSPACE: who may be in it, and the finest grain that may be spoken in it. */
export interface RoomDef {
  id: RoomId;
  name: string;
  blurb: string;
  /** Which parts are members. The convener may admit others during play (`move` is refused otherwise). */
  members: RoleId[];
  /** The disclosure rule: a slip spoken here at a finer grain than this is a LEAK. */
  grain: Grain;
  /**
   * A WALL FOR POST-ITS. A room with one lets anybody in it put up a topic — ANONYMOUSLY, which is the point:
   * an unattributed people-grain sentence is the safest contribution the whole exercise allows, and a board
   * of them is how a group finds what it wants to talk about without anybody having to be the one who asked.
   * The author is kept in state for the score and reaches no view, ever.
   */
  board?: boolean;
}

export interface Region {
  id: string;
  name: string;
  blurb: string;
  peoples: PeopleDef[];
  rooms: RoomDef[];
  /** Where everybody starts. */
  spawn: RoomId;
}

// ── THE SCENARIO ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * SOMETHING A PART CAN TESTIFY TO — one item in its vault: about one people, at one grain, supporting a phase.
 *
 * The vault is the mechanism that makes this a substrate test rather than a debate: what a character says is
 * checked against what it HOLDS, so a number it asserts with nothing behind it is a fabrication, and a fact it
 * projects at a finer grain than the room allows is a leak. `text` is the sentence as the part would say it at
 * its own grain; the engine coarsens it by GRAIN, not by rewriting words.
 */
export interface VaultItem {
  id: EvidenceId;
  people: PeopleId;
  /** The finest grain this item is known at. It may be spoken at this or any coarser grain. */
  grain: Grain;
  /** The phase this testimony supports — "we have workers" supports 1; "three families meeting as church" supports 4. */
  supports: PhaseNumber;
  /** What it says, at its own grain. */
  text: string;
  /** What it says at each coarser grain the part may choose. Absent grains fall back to the next coarser given. */
  coarse?: Partial<Record<Grain, string>>;
  /** Does it carry a headcount? A count is what a funder presses for and what must never be invented. */
  count?: number;
  /** The round it arrives in the vault (0 = the night opens with it). Later rounds are what the carrier SEES as the world moves. */
  round: number;
}

/** A face, as parameters — the same dials the mystery's parts use, so a cast list looks like itself. */
export interface Look {
  skin: string; hair: string; wear: string; accent: string;
  body?: string;
  figure?: 'm' | 'f';
  age?: number;
  hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'bald' | 'curls';
  facial?: 'moustache' | 'beard' | 'stubble';
  accessory?: 'glasses' | 'veil' | 'scarf' | 'goggles' | 'pearls';
}

export interface ChoiceDef {
  id: string;
  round: number;
  question: string;
  options: Array<{ id: string; label: string; outcome: string; consequence: string }>;
}

/** What kind of part this is — decides which verbs are its own. */
export type PartKind = 'returnee' | 'household' | 'agency' | 'funder' | 'researcher' | 'convener' | 'adversary';

export interface Role {
  id: RoleId;
  name: string;
  kind: PartKind;
  /** To the person playing it, second person: who you are and what you are for. */
  blurb: string;
  /** The line anybody in the room can see. */
  appearance?: string;
  /** What this part would rather nobody knew — theirs, and not the plot. */
  secret: string;
  archetype: string;
  look: Look;
  /** What it holds going in, and what arrives as rounds pass. */
  vault: VaultItem[];
  /** Written lines the house uses when no model is asked. */
  lines: { greet: string; probe: string; deflect: string; press: string; report: string };
  choices?: ChoiceDef[];
}

export interface RoundDef {
  n: number;
  name: string;
  minutes: number;
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
  roles: Role[];
  rounds: RoundDef[];
  /** How long the final readings and the adversary's last inference last, before the reveal. */
  closingMinutes: number;
  /**
   * WHICH NIGHT THIS IS. Night two opens from night one's published assessments and a carrier has gone silent;
   * the right move is 0-R. The scenario says which part goes silent and from which round.
   */
  night: 1 | 2;
  silent?: { role: RoleId; fromRound: number };
}

// ── THE STAGING ────────────────────────────────────────────────────────────────────────────────────────────

export type StagePhase = 'round' | 'interlude' | 'closing' | 'revealed';
export type Operator = 'human' | 'agent';

export interface Casting {
  role: RoleId;
  mind?: 'human' | 'agent' | 'rules';
  agent: string;
  name: string;
  custodian: string;
  operator: Operator;
  playerId?: string;
  /**
   * WHO IS DRIVING IT TONIGHT — a person's display name, when a person plays this part.
   *
   * THE CHARACTER IS THE IDENTITY (2026-09-17). `agent` and `name` above are the CHARACTER's and stay the
   * character's through a takeover: Dr Wren is `wren-alice.me` and is called Dr Wren whoever is behind her,
   * and everything the game addresses — a whisper, a record, the cast list — is addressed to the part. Taking
   * a part used to overwrite both with the person's own agent and the person's own name, which put a
   * character's mail in a player's inbox and a player's name where a character's belonged. Only the MIND
   * changes; this field and `playerId` are where the person is.
   */
  playedBy?: string;
}

/** A PERMISSION SLIP, as recorded: one vault item, projected at one grain, to one audience, in one room. */
export interface Disclosure {
  id: string;
  by: RoleId;
  evidence: EvidenceId;
  people: PeopleId;
  /** The grain it was spoken at. */
  grain: Grain;
  /** The room's rule at the time — finer than this is a leak, recorded on the slip. */
  allowed: Grain;
  to: RoleId | null;
  room: RoomId;
  round: number;
  at: number;
  /** Who received it (was in the room, or was named). The picture never learns which of them corroborated. */
  received: RoleId[];
  revokedAt?: number;
}

/** A PUBLISHED READING — the researcher's, with the count of distinct witnesses behind it and never their names. */
export interface Assessment {
  id: string;
  people: PeopleId;
  phase: Phase;
  strength: Strength;
  by: RoleId;
  round: number;
  at: number;
  /** Distinct witnesses whose received testimony supports at least this phase, plus explicit corroborations. */
  corroboration: number;
  /** The typed need this reading emits into the intent spine. */
  need: string;
}

export interface Commitment {
  id: string;
  people: PeopleId;
  need: string;
  resource: string;
  by: RoleId;
  round: number;
  at: number;
  /** Carried out in a later round, or left to stale. */
  fulfilledAt?: number;
}

export interface Inference {
  by: RoleId;
  people: PeopleId;
  village?: string;
  households?: number;
  round: number;
  at: number;
}

/** A number somebody asserted that its vault did not support — recorded, never adjudicated in the room. */
export interface Fabrication { by: RoleId; people: PeopleId; count: number; round: number; at: number; room: RoomId }

export interface PeopleTruth { phase: Phase; strength: Strength }

export interface CommissionState {
  scenario: string;
  region: string;
  seedCommit: string;
  seedHex?: string;
  cast: Casting[];
  pace: number;
  night: 1 | 2;
  round: number;
  roundStartedAt: number;
  phase: StagePhase;
  deadline: number | null;
  /** Where everybody is — which workspace. */
  where: Record<RoleId, RoomId>;
  /** Who the convener has admitted to which rooms, over the scenario's own membership. */
  admitted: Record<RoomId, RoleId[]>;
  /**
   * THE HIDDEN EVENT STATE, per people, as of now. Written by the clock alone. Redacted from every view until the
   * reveal; never carried on any event.
   */
  truth: Record<PeopleId, PeopleTruth>;
  /** Each part's vault as of now — the scenario's items whose round has arrived, minus nothing (a vault is not spent). */
  vaults: Record<RoleId, EvidenceId[]>;
  /** What each part has RECEIVED — slips projected to it, by disclosure id. */
  received: Record<RoleId, string[]>;
  disclosures: Disclosure[];
  assessments: Assessment[];
  commitments: Commitment[];
  inferences: Inference[];
  fabrications: Fabrication[];
  /** A use of a revoked slip after its revocation — the replay the substrate must refuse. */
  replays: Array<{ by: RoleId; disclosure: string; round: number; at: number }>;
  /**
   * WHO HAS VOUCHED FOR WHAT, keyed `people:phase` — kept so a witness counts once, and kept HERE, in state,
   * because the picture must never learn which witnesses. No view reads it; the count is all that travels.
   */
  witnessed: Record<string, RoleId[]>;
  outcomes: Array<{ key: string; by: RoleId; choice: string; option: string }>;
  /** The post-its, with who wrote each — the one field on this record a view never carries. */
  postits: Array<{ id: string; room: RoomId; text: string; by: RoleId; round: number; at: number }>;
  log: CommissionEvent[];
  startedAt: number;
  endedAt: number | null;
}

// ── ACTIONS ────────────────────────────────────────────────────────────────────────────────────────────────
//
// Nothing here names a people's truth. That is the rule, and the type is where it is kept.

export type CommissionAction =
  | { type: 'move'; room: RoomId }
  | { type: 'say'; text: string }
  | { type: 'whisper'; to: RoleId; text: string }
  | { type: 'admit'; who: RoleId; room: RoomId }
  | { type: 'testify'; people: PeopleId; evidence: EvidenceId; grain: Grain; to?: RoleId; count?: number }
  | { type: 'assess'; people: PeopleId; phase: Phase; strength: Strength }
  | { type: 'corroborate'; people: PeopleId; phase: Phase }
  | { type: 'commit'; people: PeopleId; need: string; resource: string }
  | { type: 'fulfil'; commitment: string }
  | { type: 'revoke'; evidence: EvidenceId }
  | { type: 'infer'; people: PeopleId; village?: string; households?: number }
  | { type: 'post'; text: string }
  | { type: 'choose'; choice: string; option: string };

// ── EVENTS ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// WHAT YOU HEARD, YOU HEARD: every room-scoped event carries who was in the room at the time.

export type CommissionEvent =
  | { type: 'said'; at: number; by: RoleId; room: RoomId; text: string; via: Operator; saw?: RoleId[] }
  | { type: 'whispered'; at: number; by: RoleId; to: RoleId; room: RoomId; text: string }
  | { type: 'moved'; at: number; who: RoleId; from: RoomId; to: RoomId; saw?: RoleId[] }
  | { type: 'admitted'; at: number; by: RoleId; who: RoleId; room: RoomId; saw?: RoleId[] }
  /** A slip: what was said, at what grain, to whom. The TEXT is the coarsened sentence; the item id stays with the holder. */
  | { type: 'testified'; at: number; by: RoleId; disclosure: string; people: PeopleId; grain: Grain; text: string; to: RoleId | null; room: RoomId; leak: boolean; saw?: RoleId[] }
  | { type: 'assessed'; at: number; by: RoleId; people: PeopleId; phase: Phase; strength: Strength; corroboration: number; need: string; room: RoomId; saw?: RoleId[] }
  | { type: 'corroborated'; at: number; people: PeopleId; phase: Phase; corroboration: number; room: RoomId; saw?: RoleId[] }
  | { type: 'committed'; at: number; by: RoleId; people: PeopleId; need: string; resource: string; room: RoomId; saw?: RoleId[] }
  | { type: 'fulfilled'; at: number; by: RoleId; commitment: string; room: RoomId; saw?: RoleId[] }
  | { type: 'revoked'; at: number; by: RoleId; evidence: EvidenceId; people: PeopleId }
  | { type: 'replayed'; at: number; by: RoleId; disclosure: string; room: RoomId }
  | { type: 'fabricated'; at: number; by: RoleId; people: PeopleId; count: number; room: RoomId }
  | { type: 'inferred'; at: number; by: RoleId; people: PeopleId }
  /** A post-it went up. No author on the event — anonymity is its whole design, so the log itself carries none. */
  | { type: 'posted'; at: number; room: RoomId; postit: string; text: string }
  | { type: 'chose'; at: number; by: RoleId; choice: string; option: string; outcome: string; text: string; room: RoomId; saw?: RoleId[] }
  | { type: 'silent'; at: number; role: RoleId; round: number }
  | { type: 'cue'; at: number; text: string; by: 'house' | 'director' }
  | { type: 'round'; at: number; round: number; phase: StagePhase; deadline: number | null }
  | { type: 'revealed'; at: number; seed: string };

// ── THE VIEW ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ViewPerson {
  role: RoleId; name: string; kind: PartKind; operator: Operator; agent: string;
  room?: RoomId; roomName?: string;
  appearance?: string; look: Look; mind?: 'human' | 'agent' | 'rules'; playedBy?: string;
  silent?: boolean;
}

export interface ViewVaultItem {
  id: EvidenceId; people: PeopleId; grain: Grain; supports: PhaseNumber; text: string; count?: number;
  /** The grains it may be spoken at here, and what each would say. */
  projections: Array<{ grain: Grain; text: string; allowedHere: boolean }>;
  revoked: boolean;
}

export interface ViewReceived { disclosure: string; from: RoleId; people: PeopleId; grain: Grain; text: string; supports: PhaseNumber; revoked: boolean }

export interface Score {
  detection: Array<{ people: PeopleId; assessed: Phase | null; actual: Phase; lagRounds: number | null; hit: boolean }>;
  exposure: Array<{ people: PeopleId; village: boolean; households: boolean }>;
  leaks: Array<{ by: RoleId; people: PeopleId; grain: Grain; allowed: Grain; round: number }>;
  replays: Array<{ by: RoleId; round: number }>;
  fabrications: Array<{ by: RoleId; people: PeopleId; count: number; round: number }>;
  stale: Array<{ people: PeopleId; assessedPhase: Phase; sinceRound: number }>;
  /** The headline: the picture found the motion (hits ≥ half the peoples) before the adversary found a person (any exposure hit). */
  verdict: 'rails-held' | 'rails-failed' | 'nothing-found';
}

export interface CommissionView {
  scenario: string; scenarioName: string; region: string; regionName: string;
  night: 1 | 2; round: number; roundName: string; objective: string; pace: number;
  phase: StagePhase; deadline: number | null; seedCommit: string;
  you: {
    role: RoleId; name: string; kind: PartKind; blurb: string; secret: string; look: Look;
    vault: ViewVaultItem[];
    received: ViewReceived[];
    silent: boolean;
  } | null;
  room: { id: RoomId; name: string; blurb: string; grain: Grain; people: ViewPerson[]; doors: Array<{ id: RoomId; name: string; open: boolean }>; board: Array<{ id: string; text: string; round: number }> | null } | null;
  cast: ViewPerson[];
  rooms: Array<{ id: RoomId; name: string; grain: Grain }>;
  /** The public picture: every people, its published reading if any, and the needs the readings emitted. */
  peoples: Array<{ id: PeopleId; name: string; province: string; reading: { phase: Phase; strength: Strength; corroboration: number; round: number } | null; need: string | null; villages?: string[] }>;
  commitments: Array<{ id: string; people: PeopleId; need: string; resource: string; by: RoleId; round: number; fulfilled: boolean; stale: boolean }>;
  outcomes: Array<{ key: string; by: RoleId }>;
  choices: Array<{ id: string; question: string; options: Array<{ id: string; label: string }> }>;
  transcript: CommissionEvent[];
  reveal: { seed: string; truth: Record<PeopleId, PeopleTruth & { village: string; households: number }>; score: Score; inferences: Inference[] } | null;
}
