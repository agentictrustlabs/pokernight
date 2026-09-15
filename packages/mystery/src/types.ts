/**
 * MYSTERY NIGHT — the vocabulary (docs/MYSTERY-NIGHT.md §3, §6).
 *
 * A VENUE is a place: rooms, doors, props. A TITLE is a script: roles, acts, clues, written lines. A
 * STAGING is one run of a title at a venue with one cast. They are three things on purpose — many titles
 * run at one venue, and a title is CONTENT, so a second mystery is authored rather than coded.
 *
 * Nothing in here is I/O, and nothing is random. Every draw comes from the seed the host committed to
 * before the night began, which is what lets the whole night be replayed and the killer be checked.
 */

export type RoleId = string;
export type RoomId = string;
export type ClueId = string;
export type PropId = string;

export interface VenueProp { id: PropId; name: string }
export interface VenueRoom { id: RoomId; name: string; blurb: string; props: VenueProp[] }

/** A place several mysteries can be staged in. */
export interface Venue {
  id: string;
  name: string;
  blurb: string;
  rooms: VenueRoom[];
  /** Undirected: a door joins two rooms and is walkable both ways when the act has opened both. */
  doors: Array<[RoomId, RoomId]>;
  /** Where everybody starts. */
  spawn: RoomId;
}

/**
 * A part somebody plays.
 *
 * `traits` are what evidence can point AT — a boot size, a scent, a hand. They are the mechanism that makes a
 * mystery solvable rather than narrated: a death reveals traits of the killer, and the cast is narrowed by
 * them until exactly one person is left. `archetype` is the skills-estate archetype this role is played from
 * (`docs/MYSTERY-NIGHT.md` §5); the written `lines` are what a character says when no model is asked.
 */
export interface Role {
  id: RoleId;
  name: string;
  blurb: string;
  /** What this character would rather nobody knew. Theirs alone, and never a clue about the murder. */
  secret: string;
  archetype: string;
  traits: string[];
  canBeKiller: boolean;
  lines: { greet: string; probe: string; deny: string; accuse: string; mourn: string; found: string };
}

/** A clue that is simply true about the world and is found by examining a thing. */
export interface FactClue { id: ClueId; kind: 'fact'; text: string; prop: PropId; act: number }
/** A clue a DEATH leaves, which points at one trait of whoever did it. Bound to a killer only at the death. */
export interface EvidenceClue { id: ClueId; kind: 'evidence'; text: string; trait: string }
export type ClueDef = FactClue | EvidenceClue;

export interface ActDef {
  n: number;
  name: string;
  minutes: number;
  /** Which rooms are walkable this act. A closed door is drawn closed and `move` through it is refused. */
  opens: RoomId[];
  objective: string;
  /** What the house says when the act opens — the fallback the director's prose is an improvement on. */
  opening: string;
  /** What the house says at the interlude after it. */
  interlude: string;
  /** Where a murder is possible this act. No entry, no murder — the engine refuses it by name. */
  opportunities?: Array<{ room: RoomId; prop: PropId }>;
}

export interface Title {
  id: string;
  name: string;
  venue: string;
  blurb: string;
  /** The stated line on subject matter, carried into the invitation. */
  tone: string;
  roles: Role[];
  acts: ActDef[];
  clues: ClueDef[];
  /** The death the night opens on, staged by the engine at the first interlude. */
  openingDeath: { room: RoomId; prop: PropId };
  /** How many traits of the killer each death gives up. */
  evidencePerDeath: number;
  /** How long the accusations last. */
  accusationMinutes: number;
}

export type Phase = 'act' | 'interlude' | 'accusations' | 'revealed';
/**
 * WHO THE SEED MAY LAND ON.
 *
 * `any` — the whole eligible cast, so most nights you are solving one and now and then you are the reason
 * there is one. `human` — a person, because a party is better when somebody at the table has to lie; with
 * one player that would make every night the same, which is why it is not the default. A role id — you
 * asked to be the one. The RULE is stated before the seed is spent, so the commitment still proves nobody
 * chose afterwards.
 */
export type KillerRule = 'any' | 'human' | RoleId;
export type Operator = 'human' | 'agent';

export interface Casting {
  role: RoleId;
  /** The agent playing the part: a person's own (`ryan.me`), a character they custody (`hilda.cast`). */
  agent: string;
  name: string;
  custodian: string;
  operator: Operator;
  /** The card-room player id, when a person is behind it — that is who the socket belongs to. */
  playerId?: string;
}

export interface Death { victim: RoleId; room: RoomId; prop: PropId; act: number; evidence: ClueId[]; found: ClueId[]; at: number }

export type MysteryEvent =
  | { type: 'said'; at: number; by: RoleId; room: RoomId; text: string; via: Operator }
  | { type: 'whispered'; at: number; by: RoleId; to: RoleId; room: RoomId; text: string }
  | { type: 'moved'; at: number; who: RoleId; from: RoomId; to: RoomId }
  | { type: 'found'; at: number; who: RoleId; clue: ClueId; room: RoomId }
  | { type: 'shared'; at: number; by: RoleId; to: RoleId | null; clue: ClueId; room: RoomId }
  | { type: 'claimed'; at: number; by: RoleId; kind: 'alibi' | 'testimony'; about: RoleId; text: string; room: RoomId }
  | { type: 'accused'; at: number; by: RoleId; against: RoleId; clues: ClueId[]; room: RoomId | null }
  | { type: 'died'; at: number; victim: RoleId; room: RoomId; act: number }
  | { type: 'cue'; at: number; text: string; by: 'house' | 'director' }
  | { type: 'act'; at: number; act: number; phase: Phase; deadline: number | null }
  | { type: 'revealed'; at: number; killer: RoleId; seed: string };

export type MysteryAction =
  | { type: 'move'; room: RoomId }
  | { type: 'say'; text: string }
  | { type: 'whisper'; to: RoleId; text: string }
  | { type: 'examine'; prop: PropId }
  | { type: 'search'; room: RoomId }
  | { type: 'share'; clue: ClueId; to?: RoleId }
  | { type: 'testify'; about: RoleId; text: string }
  | { type: 'alibi'; for: RoleId }
  | { type: 'accuse'; against: RoleId; clues: ClueId[] }
  | { type: 'murder'; victim: RoleId; prop: PropId };

/** The whole of a staging, JSON-only, and replayable from (seed, the actions applied to it). */
export interface MysteryState {
  title: string;
  venue: string;
  seedCommit: string;
  seedHex: string | null; // published only at the reveal; the object holds it, no view carries it before then
  cast: Casting[];
  killer: RoleId;
  /** THE RULE THE DRAW RAN UNDER, declared before the seed was spent and published at the reveal. */
  killerRule: KillerRule;
  act: number;
  phase: Phase;
  deadline: number | null;
  where: Record<RoleId, RoomId>;
  knows: Record<RoleId, ClueId[]>;
  examined: Record<RoleId, PropId[]>;
  publicClues: ClueId[];
  deaths: Death[];
  claims: Array<{ by: RoleId; kind: 'alibi' | 'testimony'; about: RoleId; text: string; at: number }>;
  accusations: Array<{ by: RoleId; against: RoleId; clues: ClueId[]; at: number }>;
  log: MysteryEvent[];
  startedAt: number;
  endedAt: number | null;
}

/** A refusal in the game's own words. The host never guesses at legality. */
export interface Refusal { ok: false; code: string; reason: string }
export type Applied = { ok: true; state: MysteryState; events: MysteryEvent[] } | Refusal;

export interface ViewPerson { role: RoleId; name: string; operator: Operator; agent: string; alive: boolean }
export interface ViewClue { id: ClueId; kind: 'fact' | 'evidence'; text: string; public: boolean }

export interface MysteryView {
  title: string;
  titleName: string;
  venue: string;
  act: number;
  actName: string;
  objective: string;
  phase: Phase;
  deadline: number | null;
  seedCommit: string;
  you: {
    role: RoleId; name: string; blurb: string; secret: string; alive: boolean;
    /** Only ever true in the killer's own view. */
    killer: boolean;
    /** The killer's opportunity this act, in their view alone. */
    opportunity?: { room: RoomId; prop: PropId; propName: string };
  } | null;
  room: {
    id: RoomId; name: string; blurb: string;
    people: ViewPerson[];
    props: Array<{ id: PropId; name: string; examined: boolean }>;
    doors: Array<{ id: RoomId; name: string; open: boolean }>;
    death: { victim: RoleId; searched: boolean } | null;
  } | null;
  cast: ViewPerson[];
  /** The hotel's rooms by name — no secret (the doors show most of it) and it lets a line name a place. */
  rooms: Array<{ id: RoomId; name: string }>;
  clues: ViewClue[];
  deaths: Array<{ victim: RoleId; victimName: string; room: RoomId; roomName: string; act: number }>;
  /** What this character has heard and seen, in order — the redacted log. */
  transcript: MysteryEvent[];
  accusation: { against: RoleId; clues: ClueId[] } | null;
  reveal: {
    killer: RoleId; killerName: string; seed: string; rule: KillerRule;
    correct: RoleId[]; fooled: Array<{ by: RoleId; against: RoleId }>; missed: ClueId[];
  } | null;
}
