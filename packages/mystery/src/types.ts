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

export interface VenueProp {
  id: PropId; name: string;
  /**
   * WHAT YOU ARE LOOKING AT, AND WHAT TO LOOK FOR (2026-09-15).
   *
   * Walking up to a thing and being handed a clue skips the part where you LOOK at it. This is what anybody
   * would see — the state of the thing, not what it proves — said whether or not it has been examined, so a
   * detailed view has something to say about what is in it. It is never a clue and never a secret: the
   * clue is what examining it FINDS, and that is the engine's to give out.
   */
  detail?: string;
}
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
/**
 * A FACE, as parameters rather than a picture.
 *
 * Eight people in a room have to be told apart at a glance, and a drawn portrait per part would be eight
 * assets to ship, license and redraw for the next title. These are the few dials that make a face
 * recognisable — and they are CONTENT, authored with the part, so a new title's cast looks like itself.
 */
export interface Look {
  /** Hex, all four: skin, hair, the collar under the chin, and the disc behind the head. */
  skin: string; hair: string; wear: string; accent: string;
  /**
   * WHAT THEY WEAR IN THE ROOM — one of the body library's outfits (`SKIN_WORDS`: oak, slate, brass, rose,
   * moss, ink), chosen by the TITLE rather than by a hash of the part's name, so the concierge is in
   * something dark and the chef is not in the heiress's plum. Six outfits and eight parts means two share;
   * a per-character outfit is a new 140-byte swatch (docs/AVATARS.md) and not a code change.
   */
  body?: string;
  /** Which figure plays them. The title says; nothing is inferred from a name. */
  figure?: 'm' | 'f';
  /**
   * HOW OLD THE PART IS. Content, like everything else here: the widow at the Belvedere is seventy-two and
   * the ski instructor is twenty-nine, and a night where that is legible is a night where the guesses are
   * better. It is shown in the profile and it is why the doctor's hair is grey — a number the title states
   * rather than a thing anybody's body is measured for.
   */
  age?: number;
  /**
   * WHAT ELSE THIS PART OWNS. A character arrives dressed as the title dresses them, and whoever plays them
   * may change into anything in their own wardrobe — the chef's whites or his service blacks, the widow's
   * mourning or her travelling grey. It is a costume box for ONE part, so nobody turns up as somebody else:
   * the concierge cannot put on the heiress's furs, which is what a free colour picker would have allowed.
   */
  wardrobe?: Array<{ id: string; name: string; wear: string; accent: string }>;
  hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'bald' | 'curls';
  facial?: 'moustache' | 'beard' | 'stubble';
  accessory?: 'glasses' | 'veil' | 'scarf' | 'goggles' | 'pearls';
}

export interface Role {
  id: RoleId;
  name: string;
  blurb: string;
  /** What this character would rather nobody knew. Theirs alone, and never a clue about the murder. */
  secret: string;
  archetype: string;
  /**
   * HOW THEY LOOK TO EVERYBODY ELSE. `blurb` is written to the person playing the part, in the second person,
   * and is theirs; this is the one line anybody in the room can see for themselves, so selecting somebody can
   * say something true about them without handing over what only they know.
   */
  appearance?: string;
  look: Look;
  traits: string[];
  canBeKiller: boolean;
  lines: { greet: string; probe: string; deny: string; accuse: string; mourn: string; found: string };
  /**
   * A CHOICE WRITTEN FOR THIS PART (2026-09-16): a question they will face, two or more options, and what each
   * changes. Consequences set OUTCOMES — mutable facts about the night that storylets, the director and the
   * epilogue read — and may never touch canon: the culprit, the backstory and the evidence are the same
   * whichever way anybody chooses. This is what makes two evenings differ because people chose differently
   * rather than because a model wrote a different sentence.
   */
  choices?: ChoiceDef[];
}

export interface ChoiceDef {
  id: string;
  /** The act in which it can first be faced. */
  act: number;
  question: string;
  options: Array<{ id: string; label: string; outcome: string; consequence: string }>;
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
  /**
   * THE TITLE'S OWN VOICE — what this story sounds like, over and above the craft of playing any mystery.
   * It travels with every ask until the story is a published skill artifact of its own, and then it is that
   * artifact's opening lines.
   */
  voice?: { character?: string[]; director?: string[] };
  roles: Role[];
  acts: ActDef[];
  clues: ClueDef[];
  /** The death the night opens on, staged by the engine at the first interlude. */
  openingDeath: { room: RoomId; prop: PropId };
  /**
   * WHEN THE KILLER SPARES SOMEBODY — what the house says, and where the night gives up its evidence instead.
   *
   * A killer who does not take their chance changes the story, and the story has to let them: nobody dies, the
   * act turns on something else, and the two traits that second death would have given up turn up another way
   * — a room turned over, a witness, a thing left behind. THE NIGHT GIVES UP ITS EVIDENCE EITHER WAY; only the
   * body is optional. Without this a declining killer would either be overruled by the engine (which is not a
   * choice) or leave a mystery nobody could solve (which is not a mystery).
   */
  spared: { interlude: string; room: RoomId; prop: PropId };
  /** What the killer may leave behind to point somewhere else: props, and the traits a plant may imply. */
  plantable?: { props: PropId[]; traits: string[] };
  /** How many traits of the killer each death gives up. */
  evidencePerDeath: number;
  /** How long the accusations last. */
  accusationMinutes: number;
  /**
   * HOW FAR INTO AN ACT A MURDER BECOMES POSSIBLE, as a fraction of it.
   *
   * A killing ten seconds after the doors open is not a mystery, it is an accident of scheduling: nobody has
   * been anywhere, nobody has anything to lie about, and the act it should have shaped is over before it
   * started. The chance opens once the act has been played for a while — for the player who is the killer
   * and for an agent who is, by the same rule.
   */
  murderAfter: number;
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
  /**
   * WHAT THINKS FOR THIS CHARACTER.
   *
   * `human` — the person acts, and nothing is asked of anybody. `agent` — the agent named below is asked
   * `mystery.act` at its own endpoint, which is where a role's skill artifacts do their work. `rules` — the
   * house plays it from the engine's own policy, which costs nobody anything and never keeps the night
   * waiting. A staging mixes all three, and a miss on an `agent` call falls back to `rules` for that moment
   * rather than leaving a character standing still.
   */
  mind?: 'human' | 'agent' | 'rules';
  /** The agent playing the part: a person's own (`ryan.me`), a character they custody (`hilda.cast`). */
  agent: string;
  name: string;
  custodian: string;
  operator: Operator;
  /** The card-room player id, when a person is behind it — that is who the socket belongs to. */
  playerId?: string;
  /**
   * WHICH OF THE PART'S OWN OUTFITS THEY ARE WEARING, if they have changed out of the one the title opens
   * them in. It lives on the CASTING rather than in anybody's browser because everybody in the room can see
   * what you are wearing — a preference kept on the client would dress you for yourself alone.
   */
  outfit?: string;
}

export interface Death { victim: RoleId; room: RoomId; prop: PropId; act: number; evidence: ClueId[]; found: ClueId[]; at: number }
/**
 * SOMETHING THE NIGHT LEFT BEHIND WITHOUT A BODY: the evidence of a death that did not happen, or a thing the
 * killer planted to point elsewhere. Searched exactly as a death's room is searched.
 */
export interface Trace { room: RoomId; prop: PropId; act: number; evidence: ClueId[]; found: ClueId[]; at: number; kind: 'spared' | 'planted'; by?: RoleId }

/**
 * WHAT YOU HEARD, YOU HEARD.
 *
 * Every event that happens in a room carries the people who were IN it at the time. Redacting on where
 * somebody is NOW hides the first act from them the moment they walk through a door — a transcript that
 * un-remembers itself. `saw` is small (a cast is eight) and it is the only way the history is stable.
 */
export type MysteryEvent =
  | { type: 'said'; at: number; by: RoleId; room: RoomId; text: string; via: Operator; saw?: RoleId[] }
  | { type: 'whispered'; at: number; by: RoleId; to: RoleId; room: RoomId; text: string }
  | { type: 'moved'; at: number; who: RoleId; from: RoomId; to: RoomId; saw?: RoleId[] }
  | { type: 'found'; at: number; who: RoleId; clue: ClueId; room: RoomId }
  | { type: 'planted'; at: number; by: RoleId; clue: ClueId; room: RoomId }
  | { type: 'shared'; at: number; by: RoleId; to: RoleId | null; clue: ClueId; room: RoomId; saw?: RoleId[] }
  | { type: 'claimed'; at: number; by: RoleId; kind: 'alibi' | 'testimony'; about: RoleId; text: string; room: RoomId; saw?: RoleId[] }
  | { type: 'accused'; at: number; by: RoleId; against: RoleId; clues: ClueId[]; room: RoomId | null; saw?: RoleId[] }
  /** A part took an option of a choice written for them. Public when the consequence is; the wording is the consequence's own. */
  | { type: 'chose'; at: number; by: RoleId; choice: string; option: string; outcome: string; text: string; room: RoomId; saw?: RoleId[] }
  | { type: 'died'; at: number; victim: RoleId; room: RoomId; act: number }
  | { type: 'spared'; at: number; room: RoomId; act: number }
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
  /** Change into another of your own part's outfits. Never a clue and never in the transcript. */
  | { type: 'dress'; outfit: string }
  /** Take one option of a choice written for your own part. Sets an outcome; touches no canon. */
  | { type: 'choose'; choice: string; option: string }
  | { type: 'accuse'; against: RoleId; clues: ClueId[] }
  | { type: 'murder'; victim: RoleId; prop: PropId }
  /** THE KILLER'S OTHER HAND: leave something at a prop that points at somebody it is not. */
  | { type: 'plant'; prop: PropId; trait: string };

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
  /**
   * HOW LONG THE NIGHT IS, as a multiplier on the acts the title authored.
   *
   * The act lengths are content — an evening at the Belvedere is an evening — but somebody with twenty
   * minutes should still get a whole mystery rather than the first third of one. It is in the state
   * because a replay of this night has to run at the length this night ran at.
   */
  pace: number;
  act: number;
  /** When the act on the clock began, so "a while into it" is a thing the engine can answer. */
  actStartedAt: number;
  phase: Phase;
  deadline: number | null;
  where: Record<RoleId, RoomId>;
  knows: Record<RoleId, ClueId[]>;
  examined: Record<RoleId, PropId[]>;
  publicClues: ClueId[];
  deaths: Death[];
  /** What was left behind with nobody dead — a spared act's evidence, and anything the killer planted. */
  traces: Trace[];
  claims: Array<{ by: RoleId; kind: 'alibi' | 'testimony'; about: RoleId; text: string; at: number }>;
  /** MUTABLE FACTS ABOUT THE NIGHT set by choices — `books:told`, `hotel:selling` — and by whom. Never canon. */
  outcomes: Array<{ key: string; by: RoleId; choice: string; option: string; at: number }>;
  accusations: Array<{ by: RoleId; against: RoleId; clues: ClueId[]; at: number }>;
  log: MysteryEvent[];
  startedAt: number;
  endedAt: number | null;
}

/** A refusal in the game's own words. The host never guesses at legality. */
export interface Refusal { ok: false; code: string; reason: string }
export type Applied = { ok: true; state: MysteryState; events: MysteryEvent[] } | Refusal;

export interface ViewPerson {
  /** The one line about them anybody in the room can see for themselves. Never their own blurb, never a secret. */
  appearance?: string;
  role: RoleId; name: string; operator: Operator; agent: string; alive: boolean; look: Look;
  /** What is thinking for them right now — so a room can say "played by their own agent" and mean it. */
  mind?: 'human' | 'agent' | 'rules';
  /** The PERSON behind a character somebody is playing, by their own name. How a voice is matched to a body. */
  playedBy?: string;
}
export interface ViewClue { id: ClueId; kind: 'fact' | 'evidence'; text: string; public: boolean }

export interface MysteryView {
  title: string;
  titleName: string;
  venue: string;
  act: number;
  actName: string;
  objective: string;
  /** What the night is running at: 1 is the evening the title was written for. */
  pace: number;
  phase: Phase;
  deadline: number | null;
  seedCommit: string;
  you: {
    role: RoleId; name: string; blurb: string; secret: string; alive: boolean; look: Look;
    /** Only ever true in the killer's own view. */
    killer: boolean;
    /** The killer's opportunity this act, in their view alone — and whether the night is old enough yet. */
    opportunity?: { room: RoomId; prop: PropId; propName: string; ready: boolean; readyAt: number };
    /**
     * WHAT COULD BE LEFT HERE, and who it would point at. The killer's alone, and only while they are
     * standing somewhere a thing could plausibly be left. One trail per night.
     */
    plant?: { prop: PropId; propName: string; used: boolean; options: Array<{ trait: string; text: string; points: Array<{ role: RoleId; name: string }> }> };
  } | null;
  room: {
    id: RoomId; name: string; blurb: string;
    people: ViewPerson[];
    props: Array<{ id: PropId; name: string; examined: boolean; detail?: string }>;
    doors: Array<{ id: RoomId; name: string; open: boolean }>;
    death: { victim: RoleId; searched: boolean } | null;
    /** Something here to find, with nobody dead: a room turned over, or a thing left to be found. */
    trace: { searched: boolean } | null;
  } | null;
  cast: ViewPerson[];
  /** The hotel's rooms by name — no secret (the doors show most of it) and it lets a line name a place. */
  rooms: Array<{ id: RoomId; name: string }>;
  clues: ViewClue[];
  deaths: Array<{ victim: RoleId; victimName: string; room: RoomId; roomName: string; act: number }>;
  /** What this character has heard and seen, in order — the redacted log. */
  transcript: MysteryEvent[];
  accusation: { against: RoleId; clues: ClueId[] } | null;
  outcomes: Array<{ key: string; by: RoleId }>;
  choices: Array<{ id: string; question: string; options: Array<{ id: string; label: string }> }>;
  reveal: {
    killer: RoleId; killerName: string; seed: string; rule: KillerRule;
    /** Did the second death come? A killer who spared somebody gets that said out loud. */
    spared: boolean;
    /** What the killer left to point elsewhere, and at what. Named, because a planted trail is a lie. */
    planted: Array<{ clue: ClueId; trait: string }>;
    correct: RoleId[]; fooled: Array<{ by: RoleId; against: RoleId }>; missed: ClueId[];
  } | null;
}
