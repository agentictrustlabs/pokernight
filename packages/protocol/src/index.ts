/**
 * @pokernight/protocol — wire schemas.
 *
 * Three surfaces share these types:
 *   1. WebSocket between a client (browser or bot) and a PokerTableDO.
 *   2. HTTP lobby/table API of the tables Worker.
 *   3. The `poker.act` A2A skill (agent turn request/response).
 *
 * Engine types are the source of truth; the zod schemas here validate untrusted
 * input at the edges and are typed against the engine to stay in sync.
 */

import { z } from 'zod';
import type { Action, LegalActions, TableConfig, TableView, EngineEvent } from '@pokernight/engine';
import type { CanastaAction, CanastaConfig, CanastaLegal } from '@pokernight/canasta';
import type { CanastaEvent, CanastaView } from '@pokernight/canasta';

export type { Action, LegalActions, TableConfig, TableView, EngineEvent };

/* ------------------------------------------------------------------ cards */

export const CardSchema = z.string().regex(/^[2-9TJQKA][shdc]$/);

/* ---------------------------------------------------------------- actions */

export const ActionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call') }),
  z.object({ type: z.literal('bet'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('raise'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('all-in') }),
]);

export const LegalActionsSchema: z.ZodType<LegalActions> = z.object({
  fold: z.boolean(),
  check: z.boolean(),
  call: z.number().int().nonnegative().nullable(),
  bet: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  raise: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  allIn: z.number().int().nonnegative(),
});

/* ----------------------------------------------------------------- config */

export const TableConfigSchema: z.ZodType<TableConfig> = z.object({
  seats: z.number().int().min(2).max(9),
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  ante: z.number().int().nonnegative(),
  minBuyIn: z.number().int().positive(),
  maxBuyIn: z.number().int().positive(),
  actionTimeoutMs: z.number().int().min(1000),
});

export const TableConfigPatchSchema = (TableConfigSchema as unknown as z.AnyZodObject).partial();

/**
 * What EVERY table has, whatever it deals: how many seats, what a seat costs, how long a turn is.
 *
 * The game's own configuration — poker's blinds and antes — rides beside this as `gameConfig`, and
 * is opaque here for the same reason every other payload is. A lobby can list any table from these
 * four numbers; only a client that knows the game can say what the blinds are.
 */
export const TableSetupSchema = z.object({
  seats: z.number().int().min(2).max(9),
  /** The smallest a seat may sit down for, in the game's own units. Zero for a game with no stakes. */
  minStake: z.number().int().nonnegative(),
  maxStake: z.number().int().nonnegative(),
  /** How long a seat gets on the clock, in ms. */
  turnMs: z.number().int().positive(),
});
export type TableSetup = z.infer<typeof TableSetupSchema>;

/* ------------------------------------------------------------ game payloads */

/**
 * THE ENVELOPE IS THE HOST'S; THE PAYLOAD IS THE GAME'S.
 *
 * The table service owns seats, chat, turns, errors, the round counter and the settlement — the
 * things every seated card game has and none of them owns. A game owns its view, its legal actions,
 * its actions and its own events, and the host carries those without reading inside them.
 *
 * So they cross the wire as `unknown`. Not laziness: a type here would have to be a union of every
 * game the deployment ever ships, which means adding a game would mean editing this file and every
 * other game's client would recompile against it. Opaque payloads are what let a second game arrive
 * as a package.
 *
 * WHO DOES READ THEM. The game that produced one, and a client that knows that game. The poker
 * client narrows these to poker's types at its own socket boundary, in one named place, exactly as
 * `PokerTableDO` widens them at its. See `docs/GAMES.md`.
 */
export type GamePayload = unknown;
export const GamePayloadSchema = z.unknown();

/* --------------------------------------------------------- table settlement */

export const SettlementModeSchema = z.enum(['play-money', 'mandate-transfer', 'table-escrow']);
export type SettlementMode = z.infer<typeof SettlementModeSchema>;

/* --------------------------------------------------------------- HTTP API */

/* -------------------------------------------------------------------- clubs */

/**
 * A CLUB is the group a poker night belongs to: a set of people who play together, the tables they
 * play at, and (later) the schedule and season that hang off it. See `docs/WORKSPACES.md`.
 *
 * WHY AN OPAQUE ID AND NOT AN ADDRESS. A club is destined to be a `<label>.workspace` Smart Agent,
 * and the design pins the AGENT on every table. It is not one yet — chartering it is a ceremony at
 * the member's Home — and minting the id from something that does not exist yet is how a stable
 * identifier ends up needing a migration. So `clubId` is minted here, is opaque, and never changes;
 * `agent` is the workspace address and is simply absent until the charter lands. Nothing that
 * references a club has to move when it does.
 */
export const ClubIdSchema = z.string().regex(/^[0-9a-f-]{36}$/);

export * from './when.js';
export * from './recurrence.js';
export * from './ics.js';

/** What someone IS to a club, derived from the club's own records and never asserted by a caller. */
export const ClubStandingSchema = z.enum(['host', 'member', 'none']);
export type ClubStanding = z.infer<typeof ClubStandingSchema>;

/**
 * Membership shapes, narrowed from the substrate's `MembershipClass`.
 *
 * `guest` is the friend somebody brings once: a real membership with a validity window, not a
 * special case. When the window passes the row is not deleted — it expires, which is a different
 * fact and a better one, because "Elena played once in March" stays answerable.
 */
export const MembershipClassSchema = z.enum(['standard', 'guest', 'observer']);
export type MembershipClass = z.infer<typeof MembershipClassSchema>;

export const ClubMemberSchema = z.object({
  /** The member's `playerId` — `home:0x…` for a person, `dev:…` in local dev. */
  member: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  class: MembershipClassSchema,
  joinedAt: z.number().int(),
  /** Who put them on the roster. Absent for the person who created the club. */
  invitedBy: z.string().max(128).optional(),
  /** A guest's window. Absent means it does not close. */
  validUntil: z.number().int().optional(),
});
export type ClubMember = z.infer<typeof ClubMemberSchema>;

export const ClubSummarySchema = z.object({
  clubId: ClubIdSchema,
  name: z.string(),
  createdAt: z.number().int(),
  /** The `playerId` of whoever started it. They are the club's first host. */
  createdBy: z.string(),
  /** The `<label>.workspace` Smart Agent, once the charter ceremony has run. */
  agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /**
   * WHAT THE HOST WANTS SAID about their club: what it is, which games, how the evening goes.
   *
   * It is the invitation's content. The Home's mailer composes the email itself and takes only an
   * address, a link and a name — so a host's own words cannot ride in the mail, and this is what the
   * link opens onto instead. That is the better place for it anyway: mail clients strip formatting
   * and block images, and a page can show the schedule and the next few dates live.
   */
  welcome: z.string().max(2000).optional(),
  members: z.number().int(),
});
export type ClubSummary = z.infer<typeof ClubSummarySchema>;

/** A club as somebody with standing in it sees it. `you` is why they were shown it at all. */
export const ClubViewSchema = ClubSummarySchema.extend({
  roster: z.array(ClubMemberSchema),
  you: z.object({ standing: ClubStandingSchema, because: z.string() }),
});
export type ClubView = z.infer<typeof ClubViewSchema>;

export const CreateClubRequestSchema = z.object({
  name: z.string().min(1).max(64),
});
export type CreateClubRequest = z.infer<typeof CreateClubRequestSchema>;

/* --------------------------------------------------------- the schedule and its nights */

/**
 * WHEN A CLUB MEETS, and each occasion it comes to.
 *
 * A schedule is a RULE and stores a wall clock; a night is one OCCURRENCE and stores an instant that
 * was resolved once, at materialisation, and is never resolved again. The reasoning for that split is
 * in `when.ts` and `recurrence.ts` — the short version is that a game at eight is at eight in November
 * too, and storing the instant is what makes it seven.
 *
 * Nights are materialised AHEAD of being needed, because an invitation cannot be sent to an occurrence
 * that does not exist and "who is coming on the 12th" cannot be asked of a formula.
 */
export const WeekdaySchema = z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

export const RecurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once') }),
  // A SET of weekdays: `docs/MISSION.md` §4 supersedes the single `weekday`, because Tuesday and
  // Thursday at seven is the common case and one weekday cannot say it.
  z.object({ kind: z.literal('weekly'), weekdays: z.array(WeekdaySchema).min(1).max(7), interval: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional() }),
  z.object({ kind: z.literal('monthly-nth'), weekday: WeekdaySchema, nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]) }),
]);

/** What every night of this schedule inherits, and any one of them may override. */
export const NightDefaultsSchema = z.object({
  /** What the night is called, when it is not just the club's name and a date. */
  title: z.string().max(64).optional(),
  /** How many people the night has room for. */
  seatCap: z.number().int().min(2).max(90).optional(),
  /** Which game it deals. A club is not a poker club — it can run either. */
  game: z.string().max(32).optional(),
});
export type NightDefaults = z.infer<typeof NightDefaultsSchema>;

export const ClubScheduleSchema = z.object({
  scheduleId: z.string(),
  club: ClubIdSchema,
  /** LOCAL wall clock, `HH:MM`. Not an instant, and deliberately not one. */
  startLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** The IANA zone that wall clock is read in. */
  timezone: z.string().min(1).max(64),
  recurrence: RecurrenceSchema,
  defaults: NightDefaultsSchema,
  /** No night before this instant. Its local date is also the anchor an interval counts from. */
  activeFrom: z.number().int(),
  /** …and none after this one. Absent is open-ended. */
  activeUntil: z.number().int().optional(),
  createdBy: z.string(),
  createdAt: z.number().int(),
  status: z.enum(['active', 'paused', 'retired']),
});
export type ClubSchedule = z.infer<typeof ClubScheduleSchema>;

export const SetScheduleRequestSchema = z.object({
  startLocal: z.string(),
  timezone: z.string(),
  recurrence: RecurrenceSchema,
  defaults: NightDefaultsSchema.optional(),
  activeFrom: z.number().int().optional(),
  activeUntil: z.number().int().optional(),
});
export type SetScheduleRequest = z.infer<typeof SetScheduleRequestSchema>;

/**
 * Where a night is in its life.
 *
 * `skipped` and `cancelled` are different on purpose: the schedule generated this one and the host
 * removed just it, versus the host called it off. Both stop it happening; only one of them is a thing
 * that happened TO the people who were coming.
 */
export const NightStatusSchema = z.enum(['scheduled', 'open', 'playing', 'finished', 'cancelled', 'skipped']);
export type NightStatus = z.infer<typeof NightStatusSchema>;

export const NightSchema = z.object({
  nightId: z.string(),
  club: ClubIdSchema,
  /** The schedule that generated it. Absent for a one-off somebody added by hand. */
  scheduleId: z.string().optional(),
  /** Resolved ONCE at materialisation, from (startLocal, timezone, date), and never re-derived. */
  startsAt: z.number().int(),
  /** Carried so a later timezone-database change cannot silently move a night people attended. */
  startLocal: z.string(),
  timezone: z.string(),
  /** The local date in the club's own zone. With the schedule id, this is the idempotency key. */
  localDate: z.string(),
  status: NightStatusSchema,
  title: z.string().optional(),
  seatCap: z.number().int().optional(),
  game: z.string().optional(),
  createdAt: z.number().int(),
  cancelledAt: z.number().int().optional(),
  reason: z.string().optional(),
});
export type Night = z.infer<typeof NightSchema>;

export const InviteMemberRequestSchema = z.object({
  /**
   * WHO, in whichever way the host knows them.
   *
   * Three shapes reach the roster the same day: a `playerId`, a bare Smart Agent address, or an
   * AGENT NAME (`carol.me`), which the card room resolves on chain to the address behind it. A
   * fourth — an email — cannot, because nobody's address is known from their email; that one opens
   * a pending invitation instead and lands here when they claim it.
   *
   * An address is the shape a host is LEAST likely to have to hand, and it was the only one this
   * accepted for its first month. Every other shape here exists because a host knows their friends
   * by name and should not have to go and find a hex string to add one.
   */
  member: z.string().min(1).max(128),
  name: z.string().min(1).max(64).optional(),
  class: MembershipClassSchema.default('standard'),
  validUntil: z.number().int().positive().optional(),
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

/* ------------------------------------------------------- invitations by email */

/**
 * An invitation to somebody whose Smart Agent the card room does not know.
 *
 * A roster row needs a `playerId`, and an email address is not one and cannot be turned into one:
 * nothing on chain maps an inbox to an agent, and inventing a row keyed by the email would create a
 * membership nobody's session can ever satisfy — an invitation that looks accepted and is not.
 *
 * So an email invitation is a SEPARATE record with its own life: it is created here, it is mailed by
 * the host's Home (the card room never holds a mail key), it is claimed by whoever opens the link
 * and signs in, and only THEN does a roster row exist — keyed by the agent that actually signed in.
 * Until then the club has a pending invitation, which is the true state and is shown as one.
 */
export const ClubInviteRequestSchema = z.object({
  email: z.string().email().max(200),
  /** What to call them on the roster once they claim it. */
  name: z.string().min(1).max(64).optional(),
  class: MembershipClassSchema.default('standard'),
  validUntil: z.number().int().positive().optional(),
});
export type ClubInviteRequest = z.infer<typeof ClubInviteRequestSchema>;

export const ClubInviteSchema = z.object({
  /** The claim token. It IS the invitation — whoever holds it can claim it, once, before it expires. */
  token: z.string().min(16).max(128),
  clubId: ClubIdSchema,
  clubName: z.string(),
  email: z.string(),
  name: z.string().optional(),
  class: MembershipClassSchema,
  invitedBy: z.string().max(128),
  invitedByName: z.string().max(64),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  /** The `playerId` that claimed it, once somebody has. A claimed invitation is spent. */
  claimedBy: z.string().max(128).optional(),
  claimedAt: z.number().int().optional(),
  validUntil: z.number().int().optional(),
});
export type ClubInvite = z.infer<typeof ClubInviteSchema>;

/**
 * What an invitation looks like to whoever OPENS the link, before they have signed in.
 *
 * Deliberately less than the record: who invited them, to what, and whether it is still good. The
 * email is not echoed back — the person reading the page already knows their own address, and a
 * page that prints it would print it for anyone who guessed the token.
 */
/**
 * WHAT AN INVITATION SAYS, before anybody has proved who they are.
 *
 * The email is a short link — the Home composes the mail itself and takes only an address, a link and
 * a name — so everything an invitation actually communicates has to be on the page that link opens.
 * This is that: who invited you, to what, what the host wants said about it, when they meet, and the
 * next few dates.
 *
 * DELIBERATELY LESS THAN THE CLUB'S RECORD. No roster, no member count, no addresses. Somebody
 * holding an unclaimed link has not joined anything yet, and a link that leaks a group's membership
 * to whoever it was forwarded to is a link nobody should send.
 */
export const InviteGreetingSchema = z.object({
  clubName: z.string(),
  invitedByName: z.string(),
  expiresAt: z.number().int(),
  /** `open` is claimable. The other two say exactly why it is not, so the page can say so. */
  state: z.enum(['open', 'claimed', 'expired']),
  /** The host's own words about the club. Absent when they have not written any. */
  welcome: z.string().optional(),
  /** When they meet, as a rule — enough to say "every other Thursday at eight" and no more. */
  meets: z
    .object({ startLocal: z.string(), timezone: z.string(), recurrence: RecurrenceSchema })
    .optional(),
  /** The next few dates, so an invitation is about something specific rather than about a group. */
  nights: z.array(z.object({ startsAt: z.number().int(), timezone: z.string(), title: z.string().optional() })).optional(),
  /** Which games this club deals, so somebody can tell whether it is for them. */
  games: z.array(z.string()).optional(),
});
export type InviteGreeting = z.infer<typeof InviteGreetingSchema>;

/**
 * Somebody the caller already plays with: a member of one of their OWN clubs.
 *
 * The card room knows these people by name because a host typed the name when they added them. It
 * is the answer to "add the people I already play with", which is the most common invitation there
 * is and the one that should never require an identifier at all.
 */
export const KnownPersonSchema = z.object({
  member: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  /** The clubs of the caller's that this person is in, by name. Their reason for being on the list. */
  clubs: z.array(z.string()),
});
export type KnownPerson = z.infer<typeof KnownPersonSchema>;

/** Which game a table deals. An id the deployment knows (`poker`); absent means poker. */
export const GameIdSchema = z.string().min(1).max(32).regex(/^[a-z0-9-]+$/);
export type GameId = z.infer<typeof GameIdSchema>;

export const CreateTableRequestSchema = z.object({
  name: z.string().min(1).max(64),
  /**
   * The game. Absent is poker, which is what every table opened before games were named is.
   *
   * A deployment that does not deal the named game refuses the table rather than opening a poker one
   * — a table is dealt the rules its players sat down to, and a silent substitution is the one
   * failure here that would take somebody's money with it.
   */
  game: GameIdSchema.optional(),
  /**
   * The game's own configuration, unvalidated here on purpose.
   *
   * Blinds mean nothing to canasta and a meld limit means nothing to poker, so the only thing that
   * can judge this object is the game being opened — which refuses the table by name if it cannot
   * deal what it was handed. A schema here would be poker's schema wearing a general name.
   */
  config: GamePayloadSchema.optional(),
  settlement: SettlementModeSchema.default('play-money'),
  /**
   * The club this table belongs to. Absent opens a PICKUP table — public, joinable by anyone with a
   * session, which is what every table was before clubs existed and is how a stranger tries the card
   * room without being invited to anything.
   *
   * Present requires HOST standing at that club, and stamps the table (see `TableMeta.club`).
   */
  club: ClubIdSchema.optional(),
  /** @deprecated The pre-club name for {@link CreateTableRequestSchema.club}, kept for one release
   *  so nothing in flight breaks. It selected a lobby and was never validated or persisted. */
  circle: z.string().optional(),
});
export type CreateTableRequest = z.infer<typeof CreateTableRequestSchema>;

/**
 * Asset base units one chip is worth AT THIS TABLE, as a decimal string (bigints do not survive
 * JSON). It is captured when the table is created and never changes afterwards, so a stack bought
 * at one rate can never be cashed out at another — see `PokerTableDO`.
 *
 * Optional because a table created before rates were pinned has none until its first load, and
 * because a deployment with no `CHIP_VALUE` configured has no rate to pin. A client that does not
 * know the rate must say so rather than guess one.
 */
export const ChipValueSchema = z.string().regex(/^\d+$/);

/**
 * The settlement ASSET a table pays in, as a 20-byte address, pinned exactly like the chip rate.
 *
 * The card room settles in ONE currency (Sheqel), so this can never disagree with the deployment
 * today — which is the point of keeping it. One field on the table records which coin it settles
 * in, so "which currency is this?" is answered from the table's own data rather than from whatever
 * `ASSET` happens to be pointed at when somebody asks. Cheap insurance, and the thing that would
 * have to be true before a second currency could ever be considered again.
 *
 * Optional because a play-money table settles in nothing at all.
 */
export const AssetAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/** What the pinned asset calls itself (`SHQ`). A label for the address above, so a client can
 *  name the money without holding a table of addresses. */
export const AssetSymbolSchema = z.string().min(1).max(12);

export const TableSummarySchema = z.object({
  tableId: z.string(),
  name: z.string(),
  /** The generic setup — enough to list any table, whatever it deals. */
  config: TableSetupSchema,
  /** The game's own configuration. A poker client reads its blinds out of here. */
  gameConfig: GamePayloadSchema.optional(),
  settlement: SettlementModeSchema,
  seated: z.number().int(),
  handNo: z.number().int(),
  createdAt: z.number(),
  /** This table's chip rate. See {@link ChipValueSchema}. Meaningless on a play-money table. */
  chipValue: ChipValueSchema.optional(),
  /** This table's settlement asset. See {@link AssetAddressSchema}. */
  asset: AssetAddressSchema.optional(),
  /** What that asset calls itself. See {@link AssetSymbolSchema}. */
  assetSymbol: AssetSymbolSchema.optional(),
  /**
   * Whoever opened it, pinned when it was created — so they can close it again.
   *
   * Absent on a table opened before tables recorded this, which is why it is optional: those stay
   * closeable by an operator alone rather than by whoever asks first.
   */
  createdBy: z.string().optional(),
  /** The club that owns this table, pinned when it was created. Absent on a pickup table. */
  club: ClubIdSchema.optional(),
  /** That club's name at the instant the table was created. A label, not a lookup — a table whose
   *  club has been renamed still says what it was called on the night it was played. */
  clubName: z.string().max(64).optional(),
  /** The game this table deals, stamped at creation. Always present on a table opened since games
   *  were named; absent only on one older than the stamp, which is poker. */
  game: GameIdSchema.optional(),
  /**
   * Whose PRACTICE table this is, if it is one.
   *
   * A practice table belongs to one person, is in no lobby, and can be reset to a fresh game by its
   * owner. Absent on every ordinary table, which is every table but these.
   */
  practiceFor: z.string().max(128).optional(),
  /** How long an agent's answer waits before it lands, in ms. A practice table's own setting. */
  paceMs: z.number().int().min(0).max(8000).optional(),
  /** True while the table is holding: no clock, no agents, no next round. Practice tables only. */
  paused: z.boolean().optional(),
});
export type TableSummary = z.infer<typeof TableSummarySchema>;

/**
 * What a chip is worth, for a client that has to show both units.
 *
 * `null` is the honest answer on a play-money table (chips are the whole story there) and on a
 * settled one whose rate has not been read yet. The two are different situations and callers that
 * care distinguish them by `settlement`; what they must never do is invent a rate.
 */
export function tableChipValue(summary: Pick<TableSummary, 'settlement' | 'chipValue'>): bigint | null {
  if (summary.settlement === 'play-money') return null;
  if (!summary.chipValue || !/^\d+$/.test(summary.chipValue)) return null;
  const v = BigInt(summary.chipValue);
  return v > 0n ? v : null;
}

/** Seat an A2A agent at a table. The table resolves the agent card, then calls `poker.act` on its turn. */
export const SeatAgentRequestSchema = z.object({
  seat: z.number().int().min(0).max(8),
  buyIn: z.number().int().positive(),
  /** Agent name, e.g. "sharkbot.svc". Resolved to a host via the table's AGENT_CARD_ZONE. */
  agentName: z.string().min(1).max(128),
  /** Explicit base URL, overriding name resolution. Used in local dev. */
  endpoint: z.string().url().optional(),
  /** Display name at the table; defaults to the agent card's name. */
  displayName: z.string().min(1).max(32).optional(),
});
export type SeatAgentRequest = z.infer<typeof SeatAgentRequestSchema>;

/* ------------------------------------------------------ sign-out / seat clearing */

/**
 * What happened to ONE seat a player was holding when something stood them up.
 *
 * `pending` is the honest half: on a settled table the cash-out is queued on the table's outbox and
 * the asset has NOT moved yet. A client that reports "your money is back" off the back of a 200 here
 * would be lying, so the shape makes the difference impossible to gloss over.
 */
export interface SeatStoodUp {
  tableId: string;
  tableName?: string;
  seat: number;
  /** Chips that left the seat. */
  chips: number;
  settlement: SettlementMode;
  /** True when a real asset movement is queued and has not settled yet. Always false on play money. */
  pending: boolean;
}

/** A seat we could not stand the player up from, and why. Their chips are still on it. */
export interface SeatStandUpFailure {
  tableId: string;
  tableName?: string;
  reason: string;
}

/** `POST /auth/signout`. An explicit sign-out gives up every seat; see the route's own comment. */
export interface SignOutResult {
  ok: boolean;
  stoodUp: SeatStoodUp[];
  failed: SeatStandUpFailure[];
}

/**
 * The four conditions `DELETE /tables/:id/seat/:seat` requires, in the order it checks them. A
 * refusal always names exactly one of them, so an operator is never left guessing which gate closed.
 *
 *   'operator'  — the caller did not present the operator token.
 *   'empty'     — nobody is on that seat.
 *   'connected' — the seat still has a live socket; a connected player is not abandoned.
 *   'in-hand'   — the seat is in a hand that is still running.
 *   'idle'      — the seat has been active more recently than the idle threshold.
 */
export const SEAT_CLEAR_REFUSALS = ['operator', 'empty', 'connected', 'in-hand', 'idle'] as const;
export type SeatClearRefusal = (typeof SEAT_CLEAR_REFUSALS)[number];

/** Body of a refusal from the operator seat-clearing route. */
export interface SeatClearRefused {
  error: string;
  refused: SeatClearRefusal;
}

/** Body of a successful clear. Same shape of truth as {@link SeatStoodUp}: `pending` is not a lie. */
export interface SeatCleared {
  ok: true;
  tableId: string;
  seat: number;
  playerId: string;
  name: string;
  chips: number;
  settlement: SettlementMode;
  pending: boolean;
  /** How long the seat had been idle when it was cleared, in ms. */
  idleMs: number;
}

/** Dev-only login (DEV_AUTH=true). Production uses the Home OIDC flow. */
export const DevSessionRequestSchema = z.object({ name: z.string().min(1).max(32) });
export const SessionSchema = z.object({ token: z.string(), playerId: z.string(), name: z.string() });
export type Session = z.infer<typeof SessionSchema>;

/* ------------------------------------------------------- WebSocket: client */

export const ClientCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), seat: z.number().int().min(0).max(8), buyIn: z.number().int().positive() }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('sit-out') }),
  z.object({ type: z.literal('sit-in') }),
  z.object({ type: z.literal('add-chips'), amount: z.number().int().positive() }),
  // The ACTION is the game's, and only the game can tell a legal one from a malformed one.
  z.object({ type: z.literal('act'), handNo: z.number().int(), action: GamePayloadSchema }),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(280) }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientCommand = z.infer<typeof ClientCommandSchema>;

/* ------------------------------------------------------- WebSocket: server */

/**
 * WHY a seat is sitting out. A sit-out is not self-explanatory to the person it happened to: a
 * player who closed a laptop lid and came back has no idea their seat was taken out of the deal, and
 * a table that simply stops dealing to them looks broken. Every sit-out therefore carries the reason
 * it happened, so the client can say it in a sentence next to the button that undoes it.
 *
 *   'requested'    — the player pressed "Sit out".
 *   'disconnected' — their last socket closed. Their seat and chips are untouched; nothing settles.
 *   'timeouts'     — they missed enough turns in a row that the table stopped dealing them in.
 */
export const SIT_OUT_REASONS = ['requested', 'disconnected', 'timeouts'] as const;
export type SitOutReason = (typeof SIT_OUT_REASONS)[number];

export interface SeatEvent {
  type: 'seat-joined' | 'seat-left' | 'seat-status';
  seat: number;
  playerId: string;
  name?: string;
  stack?: number;
  status?: 'active' | 'sitting-out';
  /** Set with `status: 'sitting-out'`; absent when the seat is active again. See {@link SitOutReason}. */
  sitOutReason?: SitOutReason;
  /** Carried on seat-joined so a client can badge an agent seated mid-session, before any snapshot. */
  kind?: 'human' | 'agent';
  agentName?: string;
  agentKind?: string;
}

export interface ChatEvent {
  type: 'chat';
  playerId: string;
  name: string;
  text: string;
  at: number;
}

/**
 * An event the GAME emitted, already redacted for whoever is receiving it.
 *
 * Carried, never inspected. `type` is present because the host routes and logs by it; everything
 * else in the object belongs to the game, and the client that knows that game reads it.
 */
export interface GameEvent {
  type: string;
  [field: string]: unknown;
}

/**
 * Everything that can arrive on the socket as an event.
 *
 * Two of the three are the HOST's — a seat changed, somebody spoke — and are the same at any table.
 * The third is whatever the game emitted. A client narrows that third to its own game's events at
 * its socket boundary; the protocol does not, because it would have to know every game to try.
 */
export type TableEvent = SeatEvent | ChatEvent | GameEvent;

/** Who occupies a seat. `names` stays for compatibility; `players` carries the richer record. */
export interface PlayerInfo {
  playerId: string;
  name: string;
  kind: 'human' | 'agent';
  /** For agents: the A2A agent name, e.g. "sharkbot.svc". */
  agentName?: string;
  /** For agents: a short label for the strategy behind it, e.g. "rules" or "claude". */
  agentKind?: string;
  /**
   * Why this player's seat is sitting out, when it is. Carried on `players` (and so on `welcome`)
   * as well as on the `seat-status` event, because the person who most needs the explanation is
   * exactly the one who was not connected when it happened.
   */
  sitOutReason?: SitOutReason;
}

export type ServerMessage =
  /**
   * The first frame on a socket, and the one that says WHICH GAME this table deals.
   *
   * `game` is here rather than only on the table's summary because the view arrives in this same
   * frame. A client that had to fetch the game over HTTP would be racing its own socket, and the
   * race it loses is the one where it draws a poker board against another game's view. Absent means
   * poker, for a host older than named games.
   */
  | { type: 'welcome'; tableId: string; game?: GameId; playerId: string | null; view: GamePayload; names: Record<string, string>; players?: Record<string, PlayerInfo> }
  | { type: 'snapshot'; view: GamePayload; names: Record<string, string>; players?: Record<string, PlayerInfo> }
  /** One event plus the fresh view after it. `event` is already redacted for this viewer. */
  | { type: 'event'; event: TableEvent; view: GamePayload }
  /**
   * It is the viewer's turn. `deadline` is an absolute ms timestamp.
   *
   * `handNo` is the ROUND number. The word is poker's and it is kept because renaming it costs a
   * migration of a SQL column, three clients and a published A2A skill, and buys no capability: a
   * second game reads it as "which round is this" and is right.
   */
  | { type: 'turn'; handNo: number; seat: number; legal: GamePayload; deadline: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; at: number };

/* --------------------------------------- the wire, read as poker by a poker client */

/**
 * THE SAME MESSAGES, with the game's payloads narrowed to poker's types.
 *
 * A generic wire is only half the story: something has to read it, and whatever reads it knows one
 * game. This is that binding for poker — the web client, the reference bot and the table tests all
 * speak it, and each narrows once at its own socket boundary rather than casting at every field.
 *
 * A second game brings its own binding. When there are three, these should move out to each game's
 * own package and this file should stop importing an engine; until then one binding beside the
 * generic wire is cheaper than a package that exists to hold six type aliases.
 */
export type PokerTableEvent = EngineEvent | SeatEvent | ChatEvent;

export type PokerServerMessage =
  | { type: 'welcome'; tableId: string; game?: GameId; playerId: string | null; view: TableView; names: Record<string, string>; players?: Record<string, PlayerInfo> }
  | { type: 'snapshot'; view: TableView; names: Record<string, string>; players?: Record<string, PlayerInfo> }
  | { type: 'event'; event: PokerTableEvent; view: TableView }
  | { type: 'turn'; handNo: number; seat: number; legal: LegalActions; deadline: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; at: number };

/** Poker's own table configuration, as it rides on `TableSummary.gameConfig`. */
export type PokerGameConfig = TableConfig;

/** Read a table's poker configuration off a summary. `null` when the table is not dealing poker,
 *  which is the honest answer for a client that only knows how to draw a poker table. */
export function pokerConfigOf(summary: { game?: string; gameConfig?: unknown }): PokerGameConfig | null {
  if (summary.game && summary.game !== 'poker') return null;
  const c = summary.gameConfig;
  return c && typeof c === 'object' ? (c as PokerGameConfig) : null;
}

/* ------------------------------------- the wire, read as canasta by a canasta client */

/**
 * THE SAME MESSAGES AGAIN, narrowed to canasta.
 *
 * The second binding, and the one that proves the first was not poker in disguise. Nothing in the
 * generic wire above changed to admit it: a canasta client narrows the same three opaque payloads at
 * its own socket boundary, against its own game's types, exactly as the poker client does.
 *
 * When a third arrives, these bindings should move out to each game's own package and this file
 * should stop importing an engine. Two of them beside the generic wire is still cheaper than a
 * package that exists to hold a dozen type aliases.
 */
export type CanastaTableEvent = CanastaEvent | SeatEvent | ChatEvent;

export type CanastaServerMessage =
  | { type: 'welcome'; tableId: string; game?: GameId; playerId: string | null; view: CanastaView; names: Record<string, string>; players?: Record<string, PlayerInfo> }
  | { type: 'snapshot'; view: CanastaView; names: Record<string, string>; players?: Record<string, PlayerInfo> }
  | { type: 'event'; event: CanastaTableEvent; view: CanastaView }
  /** `handNo` is the ROUND number here. The word is poker's and the wire kept it; see `ServerMessage`. */
  | { type: 'turn'; handNo: number; seat: number; legal: CanastaLegal; deadline: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; at: number };

/** Canasta's own view and legal-move set, re-exported so a client narrows against ONE import. */
export type { CanastaView, CanastaLegal, CanastaEvent };

/** Canasta's own table configuration, as it rides on `TableSummary.gameConfig`. */
export type CanastaGameConfig = CanastaConfig;

/** A move in canasta, as it rides on `ClientCommand.act`. */
export type CanastaClientAction = CanastaAction;

/** Read a table's canasta configuration off a summary. `null` when the table is not dealing canasta. */
export function canastaConfigOf(summary: { game?: string; gameConfig?: unknown }): CanastaGameConfig | null {
  if (summary.game !== 'canasta') return null;
  const c = summary.gameConfig;
  return c && typeof c === 'object' ? (c as CanastaGameConfig) : null;
}

export const WS_ERROR_CODES = [
  'unauthenticated',
  'bad-command',
  'seat-taken',
  'seat-invalid',
  'player-seated',
  'not-seated',
  'buy-in-range',
  'not-your-turn',
  /** An action arrived while NO hand was running. Distinct from not-your-turn on purpose: telling a
   *  player it is not their turn when there is no turn to have sends them looking for a hand that
   *  does not exist. */
  'no-hand',
  'illegal-action',
  'stale-hand',
  /** The table is holding. Practice tables only, and it holds for everybody including whoever
   *  pressed it — a pause that let one seat carry on kept the whole table moving. */
  'paused',
  'settlement-failed',
] as const;
export type WsErrorCode = (typeof WS_ERROR_CODES)[number];

/* -------------------------------------------------- A2A: asking an agent to move */

export const POKER_ACT_SKILL = 'poker.act';
export const CANASTA_ACT_SKILL = 'canasta.act';

/**
 * ASKING SOMEBODY'S OWN AGENT WHAT THEY SHOULD DO.
 *
 * The same wire as `*.act`, and deliberately a DIFFERENT skill, because they are different acts: one
 * moves cards in a seat, the other says something to the person sitting in it. An agent may advertise
 * either, both or neither, and a card room that conflated them would be handing a turn to something
 * that only ever meant to talk.
 *
 * WHY THE CARD ROOM ASKS AN AGENT AT ALL, rather than advising from its own coach: the coach is the
 * house's — one strategy, the same for everybody. A person's own agent carries THEIR style, written
 * as their own artifacts, and the card room neither holds it nor wants to. So the app's part is to
 * ask, and to say whose answer it is showing; the reasoning is somewhere it does not reach.
 *
 * The payload is the seat's own redacted view — the same one that seat already sees. Advising
 * discloses nothing the person does not hold.
 */
export const POKER_ADVISE_SKILL = 'poker.advise';
export const CANASTA_ADVISE_SKILL = 'canasta.advise';

/**
 * THE ROUND, AFTERWARDS — offered to a person's own adviser so it can learn something.
 *
 * An adviser asked only during a hand sees the moments somebody thought to ask about, and never
 * finds out how any of them turned out. That is enough to give advice and not enough to notice "you
 * have done this before": a pattern needs the ending as well as the decision.
 *
 * So when a round finishes, each seat's own adviser is offered that round AS THAT SEAT SAW IT — the
 * final view, including its result. Best effort and fire-and-forget: an adviser that is down, slow or
 * uninterested costs nothing, because nothing at the table is waiting on it.
 *
 * WHAT IS REMEMBERED IS THE AGENT'S BUSINESS, not the card room's. The card room keeps no profile of
 * how anybody plays and has nowhere to put one — it reports a round to the one agent that person
 * named, and that agent decides what is worth keeping in its own memory.
 */
export const POKER_REVIEW_SKILL = 'poker.review';
export const CANASTA_REVIEW_SKILL = 'canasta.review';

/**
 * THE ROUND, REPORTED: the final view as the seat saw it, and the game's own COUNTS of it.
 *
 * `observation` is `observeFor`'s answer — what each player did this round, counted, keyed by the
 * player id the view shows. Opaque to the host like the view; it is the half an adviser can add to
 * what it already remembers without reading the round twice, and it carries nothing the seat's view
 * does not already show.
 */
export interface ReviewInput extends ActInput {
  observation?: unknown;
}

/**
 * THE REVIEW, said in words as well as in data — the same two parts as an advice request, but the
 * words say the round is OVER. A review that read "advise seat 0 … answer with one JSON object" asked
 * a person's own agent for a move at a table where the hand had ended.
 */
export function encodeReviewParts(
  input: ReviewInput,
): Array<{ kind: 'data'; data: Record<string, unknown> } | { kind: 'text'; text: string }> {
  const game = input.skill.split('.')[0] ?? 'the game';
  const counted = input.observation && typeof input.observation === 'object' ? Object.keys((input.observation as { subjects?: Record<string, unknown> }).subjects ?? {}).length : 0;
  const text = [
    `${input.skill}: round ${input.handNo} at ${game} is over, as seat ${input.seat} saw it. Nothing is asked; remember what is worth remembering.`,
    counted ? `The round's counts, per player, are in the data part (${counted} players).` : 'The data part carries the final view.',
  ].join('\n');
  const [data] = encodeActParts(input);
  return [{ kind: 'data', data: (data as { data: Record<string, unknown> }).data }, { kind: 'text', text }];
}

/**
 * THE TURN REQUEST, with the game's own three fields carried opaquely.
 *
 * Same split as the WebSocket wire, for the same reason and with the same seam: the ENVELOPE is the
 * host's — which table, which round, which seat, how long you have — and the VIEW, the LEGAL MOVES
 * and the ACTION belong to the game. A host that validated a poker action here could only ever seat
 * a poker agent, which is exactly what it could do before this: `poker.act` was baked into the call,
 * so a canasta table could deal itself but had nobody to deal to.
 *
 * `skill` names which game is asking, so the agent on the other end knows what it is being handed
 * before it reads it — the same job `welcome.game` does on the socket.
 */
export interface ActInput {
  skill: string;
  tableId: string;
  /** The ROUND number. Poker's word, kept; a second game reads it as "which round is this". */
  handNo: number;
  seat: number;
  /** Redacted view for this seat — its own cards included, nobody else's. */
  view: GamePayload;
  legal: GamePayload;
  /** Milliseconds the agent has to answer before the table applies the default. */
  deadlineMs: number;
}

/**
 * What an adviser says back.
 *
 * `say` is the sentence a person reads mid-hand, so it is short on purpose. `because` is the reason,
 * which is the half that teaches and the half a person can disagree with. `action` is optional and is
 * only ever a SUGGESTION — nothing in the card room applies it, and an adviser that returns one has
 * still not taken anybody's turn.
 */
/**
 * A turn request, plus the thing that was actually asked.
 *
 * `question` is the PERSON'S OWN WORDS when they asked one — "should I take the pile?", "why did that
 * not work?" — and absent when nothing was asked and the coach simply offered. It is passed through
 * untouched: the card room does not parse it, answer it, or keep it.
 *
 * It matters because an adviser that remembers is remembering QUESTIONS as much as positions. "You
 * asked this about a frozen pile three times last week" is a different and better observation than
 * "you have held wilds too long", and it cannot be made from the board alone.
 */
export interface AdviseInput extends ActInput {
  question?: string;
  /**
   * THE SEAT'S READ AS DATA, from the game's own `readFor` — the price, the outs, position, the money
   * behind — so an adviser that reasons is handed the facts rather than left to compute them. Opaque
   * to the host, like the view; the game that wrote it is the one that knows its shape.
   */
  read?: unknown;
  /**
   * THE HOUSE'S OWN LINE, as an observation. The rules coach is right about the mechanics every time;
   * sent alongside, a person's own agent starts from a correct floor and adds their style — and the
   * style skill says it outranks the craft, so this is the intended shape. Never applied by anybody.
   */
  baseline?: { say: string; because?: string; action?: unknown };
}

/**
 * THE ADVICE REQUEST, said in words as well as in data.
 *
 * The house personas read the data part and nothing else. A person's OWN agent at their Home does the
 * opposite: its A2A surface treats a message with no task extension as a CONVERSATION, and what it
 * hands to the agent's playbook is the message's TEXT — a data part alone arrives as "the message
 * carried no text". So the same request carries both: the data part for an adviser that parses, and a
 * text part for one that reads. The text says what is being asked, in what shape to answer, and
 * carries the seat's view inline, because an agent reasoning from its skills has to be handed the
 * table rather than told where to look for it.
 *
 * Nothing here is visible to that agent that the seat cannot see: `view` is already redacted.
 */
export function encodeAdviseParts(
  input: AdviseInput,
): Array<{ kind: 'data'; data: Record<string, unknown> } | { kind: 'text'; text: string }> {
  const game = input.skill.split('.')[0] ?? 'the game';
  const asked = input.question?.trim();
  const shape = adviseAnswerShape(input.skill);
  const text = [
    `${input.skill}: advise seat ${input.seat} at ${game}, round ${input.handNo}.`,
    asked ? `The person asked: "${asked}".` : 'Nothing was asked; say what they should do and why.',
    `Answer with ONE JSON object and nothing else: {"say": ${shape.say}, "because": ${shape.because}, "action": ${shape.action}}.`,
    `Legal moves for this seat: ${JSON.stringify(input.legal)}`,
    `The table as this seat sees it: ${JSON.stringify(input.view)}`,
  ].join('\n');
  // The data part carries the answer's SHAPE beside the input, because the thing that eventually writes
  // the answer at a Home is not the thing that read this text: the planner reads the text, the answering
  // step reads the data. An action that came back as `{"raise":10}` instead of `{type:"raise",amount:10}`
  // was a move the card room could only refuse to draw a button for.
  const [data] = encodeActParts(input);
  return [{ kind: 'data', data: { ...(data as { data: Record<string, unknown> }).data, answer: shape } }, { kind: 'text', text }];
}

/**
 * HOW AN ADVISER SHOULD SHAPE ITS ANSWER, per game — said once, sent with every request.
 *
 * `action` names the game's own action union exactly, because an adviser at somebody's Home is a
 * language model reading a sentence, and "the game's own action shape" is not a sentence it can obey.
 */
export function adviseAnswerShape(skill: string): { say: string; because: string; action: string } {
  const game = skill.split('.')[0];
  const action =
    game === 'canasta'
      ? 'the move, EXACTLY one of {"type":"draw"} | {"type":"take-pile","meld":{"rank":<rank>,"cards":[<cards from hand>]}} | {"type":"meld","melds":[{"rank":<rank>,"cards":[<cards>]}]} | {"type":"discard","card":<card>} — or omit "action" to commit to none'
      : 'the move, EXACTLY one of {"type":"fold"} | {"type":"check"} | {"type":"call"} | {"type":"bet","amount":<total chips>} | {"type":"raise","amount":<the total to raise TO, in chips>} | {"type":"all-in"} — or omit "action" to commit to none';
  return {
    say: 'one sentence, for somebody with a clock running',
    because: 'the reason — the half that teaches',
    action,
  };
}

export const AdviseOutputSchema = z.object({
  say: z.string().min(1).max(280),
  because: z.string().max(600).optional(),
  action: GamePayloadSchema.optional(),
});
export type AdviseOutput = z.infer<typeof AdviseOutputSchema>;

/** Pull an adviser's answer out of an A2A reply. Same shape of search as `decodeActReply`. */
export function decodeAdviseReply(parts: unknown): AdviseOutput | { error: string } {
  if (!Array.isArray(parts)) return { error: 'reply has no parts' };
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { kind?: string; data?: unknown; text?: string };
    let candidate: unknown = p.kind === 'data' ? p.data : undefined;
    if (candidate === undefined && typeof p.text === 'string') {
      try {
        candidate = JSON.parse(p.text);
      } catch {
        // A plain sentence with no JSON around it is a perfectly good piece of advice.
        const said = p.text.trim();
        if (said) return { say: said.slice(0, 280) };
        continue;
      }
    }
    if (!candidate || typeof candidate !== 'object') continue;
    const obj = candidate as Record<string, unknown>;
    const inner = obj.output ?? obj.advice ?? obj;
    const parsed = AdviseOutputSchema.safeParse(inner);
    if (parsed.success) return parsed.data;
  }
  return { error: 'no advice in the reply' };
}

export const ActOutputSchema = z.object({
  /** The game's own action. Only the game can tell a legal one from a malformed one. */
  action: GamePayloadSchema,
  /** Optional short rationale, logged with the hand history, never shown to other players mid-round. */
  note: z.string().max(280).optional(),
});
export type ActOutput = z.infer<typeof ActOutputSchema>;

/** Poker's binding of the turn request, for the poker agent that reads it. */
export interface PokerActInput extends ActInput {
  view: TableView;
  legal: LegalActions;
}

export const PokerActOutputSchema = z.object({
  action: ActionSchema,
  note: z.string().max(280).optional(),
});
export type PokerActOutput = z.infer<typeof PokerActOutputSchema>;

/** Canasta's binding of the same request. */
export interface CanastaActInput extends ActInput {
  view: CanastaView;
  legal: CanastaLegal;
}

/* ---------------------------------------------------------------- helpers */

export function parseClientCommand(raw: unknown): ClientCommand | { error: string } {
  const r = ClientCommandSchema.safeParse(raw);
  return r.success ? r.data : { error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

/* ------------------------------------------------- A2A standard transport */

/**
 * Pokernight speaks the STANDARD A2A profile from `@agenticprimitives/a2a/standard`,
 * not the delegation profile. `SendMessage` there is synchronous: the agent replies
 * with a message and no task, which is what a turn clock needs. Authorization is
 * added in phase 3, when a seat can move money.
 */
export const A2A_JSONRPC_PATH = '/api/a2a';
export const A2A_AGENT_CARD_PATH = '/.well-known/agent-card.json';
export const A2A_SEND_MESSAGE = 'SendMessage';

/** Map an agent name to its card host: `sharkbot.svc` in zone `faithnet.ai` → `sharkbot-svc.faithnet.ai`. */
export function agentNameToHost(agentName: string, zone: string): string {
  const label = agentName.trim().toLowerCase().replace(/\./g, '-');
  return `${label}.${zone}`;
}

/** The turn request as A2A message parts: one data part carrying the input, skill named on it. */
export function encodeActParts(input: ActInput): Array<{ kind: 'data'; data: Record<string, unknown> }> {
  return [{ kind: 'data', data: { skill: input.skill, input: input as unknown as Record<string, unknown> } }];
}


/**
 * Pull an action out of an A2A reply. Accepts a data part, or a text part holding JSON.
 *
 * The ACTION is not validated here, only found: it is the game's, and this file cannot tell a legal
 * canasta meld from a legal poker raise. The table validates it against the game that asked, which
 * is the only thing that can.
 */
export function decodeActReply(parts: unknown): ActOutput | { error: string } {
  if (!Array.isArray(parts)) return { error: 'reply has no parts' };
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { kind?: string; data?: unknown; text?: string };
    let candidate: unknown;
    if (p.kind === 'data' && p.data && typeof p.data === 'object') {
      const d = p.data as Record<string, unknown>;
      candidate = 'action' in d ? d : d['output'];
    } else if (p.kind === 'text' && typeof p.text === 'string') {
      try { candidate = JSON.parse(p.text); } catch { continue; }
    }
    if (!candidate) continue;
    const r = ActOutputSchema.safeParse(candidate);
    if (r.success) return r.data;
  }
  return { error: 'no action in the reply' };
}

/** The poker binding of the same two helpers, for the poker agent and the poker tests. */
export function encodePokerActParts(input: PokerActInput): Array<{ kind: 'data'; data: Record<string, unknown> }> {
  return encodeActParts(input);
}

export function decodePokerActReply(parts: unknown): PokerActOutput | { error: string } {
  const r = decodeActReply(parts);
  if ('error' in r) return r;
  const a = PokerActOutputSchema.safeParse(r);
  return a.success ? a.data : { error: 'no valid poker.act output in reply' };
}
