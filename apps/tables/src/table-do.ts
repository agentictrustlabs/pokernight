/**
 * PokerTableDO — one Durable Object per table.
 *
 * Storage layout
 *   KV  `meta`          TableMeta (tableId, name, settlement, createdAt, chipValue — the table's PINNED rate)
 *   KV  `state`         engine TableState (authoritative; includes deck + hole cards, never sent raw)
 *   KV  `names`         Record<playerId, display name> (kept for compatibility)
 *   KV  `players`       Record<playerId, SeatRecord> — who occupies a seat and how it is reached
 *   KV  `seed`          hex seed of the running hand; deleted on hand-ended (never sent while a hand runs)
 *   KV  `next-hand-at`  absolute ms when the next hand should start (auto-start / inter-hand delay)
 *   SQL `hands`         one row per hand: commit at start, reveal + result at end
 *   SQL `actions`       append-only action log per hand (replay = seed + this log)
 *   SQL `events`        every engine event per hand (unredacted; served only after the hand ends)
 *   SQL `ledger`        buy-in / add-chips / cash-out / hand-result rows (chips, signed for the player)
 *   SQL `outbox`        settlement ops drained by the alarm with backoff
 *   SQL `agent_calls`   one row per A2A turn call to an agent seat (request, reply, why it was dropped)
 *
 * Connections use the WebSocket Hibernation API; each socket's attachment is {playerId, name, seat}.
 * The engine is pure: every mutation is `state = f(state)`, persisted, then broadcast.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  EngineError,
  addChips,
  applyAction,
  bytesToHex,
  canStartHand,
  createTable,
  legalActions,
  randomSeed,
  redactEvent,
  setActionDeadline,
  sitDown,
  sitIn,
  sitOut,
  standUp,
  startHand,
  timeoutAction,
  viewFor,
  type Action,
  type EngineEvent,
  type HandResult,
  type LegalActions,
  type TableConfig,
  type TableView,
} from '@pokernight/engine';
import { failedReceipt, pendingReceipt, type LedgerEntryKind, type SettlementAdapter, type SettlementReceipt } from '@pokernight/ledger';
import type { HostedGame, TableSnapshot } from '@pokernight/table-game';
import { DEFAULT_GAME, gameFor, practiceConfigFor } from './games.js';
import type { PlayerFunding } from '@pokernight/treasury';
import {
  parseClientCommand,
  CANASTA_ADVISE_SKILL,
  CANASTA_REVIEW_SKILL,
  POKER_ADVISE_SKILL,
  POKER_REVIEW_SKILL,
  type ChatEvent,
  type ClientCommand,
  type PlayerInfo,
  type ActInput,
  type ActOutput,
  type SeatCleared,
  type SeatClearRefusal,
  type SeatEvent,
  type SeatStoodUp,
  type ServerMessage,
  type SettlementMode,
  type SitOutReason,
  type TableEvent,
  type TableSummary,
} from '@pokernight/protocol';
import { a2aTimeoutMs, callAct, callAdvise, callReview, resolveAgentBase } from './a2a.js';
import { a2aAdviceTimeoutMs } from './env.js';
import { readSessionRecord } from './auth.js';
import { agentPaceMs, seatIdleMs } from './env.js';
import type { Env } from './env.js';
import { createSettlementAdapter } from './settlement.js';
import {
  assetSymbolFor,
  defaultAsset,
  defaultAssetSymbol,
  defaultChipValue,
  pinnedAsset,
  pinnedAssetSymbol,
  pinnedChipValue,
  unstampedChipValue,
} from './treasury.js';

/* ------------------------------------------------------------------ types */

export interface TableMeta {
  tableId: string;
  name: string;
  /**
   * The `playerId` of whoever opened it, so they can close it again.
   *
   * PINNED like the club and the chip rate. Until this existed a table had no owner at all: the only
   * way to remove one was an operator token, so a mistake, a test, or a game that finished stayed in
   * the public list for good and nobody but an operator could do anything about it.
   *
   * Absent on every table opened before the field existed — those stay operator-only, which is the
   * honest answer rather than handing them to whoever asks first.
   */
  createdBy?: string;
  settlement: SettlementMode;
  createdAt: number;
  /**
   * Asset base units one chip is worth AT THIS TABLE, as a decimal string.
   *
   * Stamped from the deployment default when the table is created and NEVER re-derived. This is the
   * rate every settlement at this table uses — buy-in, cash-out, ledger row and receipt — so that
   * changing `CHIP_VALUE` opens new tables at a new rate instead of re-valuing the stacks already
   * sitting on the old ones.
   *
   * Optional only for a table created before this field existed: `migrateChipValue` stamps
   * `LEGACY_CHIP_VALUE` onto it the first time it loads, which is the rate it has been settling at
   * all along — deliberately not today's default, which has moved.
   */
  chipValue?: string;
  /**
   * The ERC-20 this table settles in, as an address.
   *
   * KEPT ON PURPOSE even though the card room has exactly one currency (Sheqel) and this can
   * therefore never disagree with `ASSET`. One field recording which coin a table settles in costs
   * a few bytes and makes "which currency is this table?" answerable from the table's own data
   * rather than from a deployment variable somebody could repoint. What was deleted with the second
   * currency is the LEGACY fallback and the first-load migration that stamped an old coin onto
   * older tables — not this record. Do not reinstate either.
   *
   * Optional only for a play-money table, which settles in nothing.
   */
  asset?: string;
  /** What {@link TableMeta.asset} calls itself (`SHQ`). A label for the address, stamped at the same
   *  instant and by the same rule, so a table can never name a coin it does not pay in. */
  assetSymbol?: string;
  /**
   * The club this table belongs to, stamped when it was created and never re-read.
   *
   * Absent means a PICKUP table — public, joinable by anyone with a session, which is what every
   * table was before clubs existed. Present means the card room asks the club who this person is
   * before it lets them see the table at all, let alone sit at it.
   *
   * Pinned for the same reason the rate and the asset are: "whose table is this?" is answerable from
   * the table's own record rather than from something a caller could point somewhere else.
   */
  club?: string;
  /** That club's name at the instant the table was created. A label, not a lookup. */
  clubName?: string;
  /**
   * WHICH GAME this table plays, stamped at creation and never re-read.
   *
   * Same rule as the chip rate, the asset and the club, and for a sharper reason than any of them: a
   * table whose game was looked up rather than recorded could be dealt a different game than the one
   * its players sat down to, with their money already on it. Absent means poker — every table opened
   * before games were named is a poker table, and `DEFAULT_GAME` is how they read.
   */
  game?: string;
  /**
   * WHOSE PRACTICE TABLE this is, if it is one.
   *
   * A practice table belongs to one person, is in no lobby, and may be reset by its owner back to a
   * fresh game. Absent on every ordinary table, which is every table but these.
   */
  practiceFor?: string;
  /**
   * How long an agent's answer waits before it lands, in ms. Absent uses the deployment's default.
   *
   * A TABLE'S OWN SETTING, because how fast is comfortable is not a property of the deployment. A
   * person learning wants to watch each move and hear the line that goes with it; somebody who
   * knows the game wants it out of the way. Only a practice table can set it, since only there does
   * one person's preference not slow everybody else down.
   */
  paceMs?: number;
  /**
   * PAUSED, on a practice table.
   *
   * Somebody learning needs to stop and read what just happened, and a table that keeps dealing
   * while they do turns a lesson into a race. Pausing holds three things at once: the turn clock
   * stops running down, the agents stop answering, and the next round does not deal. Resuming pushes
   * every deadline forward by however long the pause lasted, so no time is taken off anybody.
   *
   * Practice tables only — a pause anywhere else is one person stopping everybody's game.
   */
  pausedAt?: number;
}

export interface InitRequest {
  tableId: string;
  name: string;
  /** The game's own config, unopened. The game validates it and refuses by name. */
  config?: unknown;
  settlement: SettlementMode;
  createdAt?: number;
  /** The club that owns it. The Worker has already checked the creator is one of its hosts. */
  club?: string;
  clubName?: string;
  /** The `playerId` of whoever opened it, so they can close it again. */
  createdBy?: string;
  /** Which game to deal. Absent is poker. Refused at creation if this deployment does not have it. */
  game?: string;
  /**
   * WHOSE PRACTICE TABLE this is, if it is one.
   *
   * A practice table belongs to one person, is in no lobby, and may be reset by its owner back to a
   * fresh game. Absent on every ordinary table, which is every table but these.
   */
  practiceFor?: string;
}

/** What each hibernated socket remembers about itself. */
interface Attachment {
  playerId: string | null;
  name: string | null;
  seat: number | null;
}

/**
 * How a seat receives its turn. 'ws' = a connected WebSocket client. 'a2a' (phase 2) = the DO calls the
 * agent's `poker.act` skill over A2A with the redacted view and a deadline.
 */
export type SeatTransport = 'ws' | 'a2a';

/**
 * Who occupies a seat, and how the DO reaches them. Persisted in the `players` KV key (a table
 * written before phase 2 has no such key: it is rebuilt from `names` as all-human/all-ws on load).
 * `PlayerInfo` (the wire shape) is the public projection of this — `endpoint` never leaves the DO.
 */
export interface SeatRecord {
  playerId: string;
  name: string;
  kind: 'human' | 'agent';
  transport: SeatTransport;
  /** Agents: the A2A agent name, e.g. "sharkbot.svc". */
  agentName?: string;
  /** Agents: resolved base URL (`<base>/api/a2a`, `<base>/.well-known/agent-card.json`). */
  endpoint?: string;
  /** Agents: short strategy label from the agent card, e.g. "rules" or "claude". */
  agentKind?: string;
  /**
   * On a settled table: the treasury Smart Agent this seat's money comes from and goes back to,
   * resolved from the player's session when they sat down and pinned here.
   *
   * Pinned, rather than re-read at cash-out, because a session can end long before a player stands
   * up — and a stack with nowhere to be paid is the one way this table could lose someone's money.
   */
  treasury?: string;
  /**
   * Why this seat is sitting out, when it is. Cleared the moment the seat sits back in or stands up.
   *
   * It lives on the seat RECORD rather than on the engine state because the engine's `SeatStatus` is
   * two words wide by design, and the reason is a story about the outside world — a socket that
   * closed, a clock that ran out — not about the game.
   */
  sitOutReason?: SitOutReason;
  /**
   * When this seat last did anything: sat down, sent a command, acted, opened or closed a socket.
   *
   * The ONLY input to the fourth condition on the operator clear route, and therefore a large part of
   * what stops that route being a way to knock a thinking player out of their seat. Written through
   * {@link PokerTableDO.touchSeat}, which keeps the in-memory value exact and throttles the persisted
   * one — a value stale by half a minute cannot matter against a threshold measured in minutes, and a
   * storage write per poker action would.
   *
   * Absent on a seat taken before this field existed; {@link PokerTableDO.seatActiveAt} then falls
   * back to that player's last money row, which is a real lower bound on when they were last here.
   */
  lastActiveAt?: number;
}

/** Body of `POST /seat-agent`: the Worker has already resolved and validated the agent card. */
export interface SeatAgentBody {
  seat: number;
  buyIn: number;
  agentName: string;
  /** Resolved base URL (the Worker always fills this in). */
  endpoint?: string;
  displayName?: string;
  agentKind?: string;
}

type AgentCallRow = {
  hand_no: number;
  seat: number;
  requested_at: number;
  responded_at: number | null;
  ok: number | null;
  action_json: string | null;
  note: string | null;
  error: string | null;
}

type HandRow = {
  hand_no: number;
  seed_commit: string;
  seed_reveal: string | null;
  started_at: number;
  ended_at: number | null;
  result_json: string | null;
}

type OutboxRow = {
  id: string;
  kind: string;
  payload_json: string;
  attempts: number;
  next_at: number;
  done_at: number | null;
}

interface CashOutPayload {
  ledgerId: string;
  tableId: string;
  seat: number;
  playerId: string;
  /** The treasury the payout goes to, pinned at sit-down. */
  playerAddress?: string;
  chips: number;
  historyDigest: string;
  orderId: string;
}

/** A buy-in whose asset movement is still owed. Play money never produces one: it settles inline. */
interface BuyInPayload {
  ledgerId: string;
  tableId: string;
  seat: number;
  playerId: string;
  playerAddress?: string;
  chips: number;
  orderId: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hands (
  hand_no     INTEGER PRIMARY KEY,
  seed_commit TEXT NOT NULL,
  seed_reveal TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  hand_no INTEGER NOT NULL,
  idx     INTEGER NOT NULL,
  seat    INTEGER NOT NULL,
  json    TEXT NOT NULL,
  PRIMARY KEY (hand_no, idx)
);
CREATE TABLE IF NOT EXISTS events (
  hand_no INTEGER NOT NULL,
  idx     INTEGER NOT NULL,
  json    TEXT NOT NULL,
  PRIMARY KEY (hand_no, idx)
);
CREATE TABLE IF NOT EXISTS ledger (
  id           TEXT PRIMARY KEY,
  seat         INTEGER NOT NULL,
  player_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  chips        INTEGER NOT NULL,
  hand_no      INTEGER,
  at           INTEGER NOT NULL,
  receipt_json TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_at      INTEGER NOT NULL,
  done_at      INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (done_at, next_at);
CREATE TABLE IF NOT EXISTS agent_calls (
  hand_no      INTEGER NOT NULL,
  seat         INTEGER NOT NULL,
  requested_at INTEGER NOT NULL,
  responded_at INTEGER,
  ok           INTEGER,
  action_json  TEXT,
  note         TEXT,
  error        TEXT,
  PRIMARY KEY (hand_no, seat, requested_at)
);
`;

const HAND_START_DELAY_MS = 1500;
const NEXT_HAND_DELAY_MS = 3000;
const OUTBOX_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000] as const;
/**
 * After this many failures a settlement op stops retrying and the ledger row is marked failed with
 * the reason. Retrying forever hides a movement that can never succeed (an unfunded treasury, a
 * mandate that was never signed) behind a queue nobody reads; a failed row with a sentence in it is
 * something a player and an operator can both act on.
 */
const MAX_OUTBOX_ATTEMPTS = 6;
/**
 * How many turns a silent player may miss before the table frees their seat, when the GAME does not
 * say otherwise (`TableGame.maxTimeouts`).
 *
 * Two is right for poker, where a missed turn is checked or folded in a second and a seat held by
 * somebody who has gone stops the table. It is wrong for a game where a turn is a puzzle, which is
 * why the number is now the game's to raise — this is only the floor for a game with no opinion.
 */
const MAX_TIMEOUTS_BEFORE_SIT_OUT = 2;
/**
 * How stale a seat's persisted `lastActiveAt` is allowed to get. The in-memory value is always
 * exact; this only bounds how often it is written to storage, because a write per poker action would
 * double this DO's write rate to sharpen a number that is read against a five-minute threshold.
 */
const ACTIVITY_WRITE_INTERVAL_MS = 30_000;
/** Subtracted from an agent's turn budget so a reply that lands on the deadline is still applied. */
const AGENT_DEADLINE_HEADROOM_MS = 1000;

/* --------------------------------------------------------------------- DO */

export class PokerTableDO extends DurableObject<Env> {
  private meta: TableMeta | null = null;
  /**
   * The game's own state, OPAQUE to this object.
   *
   * It was `TableState` — poker's — and typing it that way is what made this a poker table rather
   * than a table. Everything this object needs to know about the state without understanding it
   * comes through `this.snap()`; everything it needs to DO comes through `this.game`.
   */
  private state: unknown = null;
  /** The game this table deals, resolved from `meta.game` on load and never from anywhere else. */
  private game: HostedGame = gameFor(undefined);
  private names: Record<string, string> = {};
  private players: Record<string, SeatRecord> = {};
  /**
   * The agent each player has named to advise THEM here, keyed by playerId.
   *
   * Per player rather than per table: an adviser is somebody's own, and two people at one table may
   * each bring their own without either seeing the other's. It holds no strategy — only where to ask.
   */
  private advisers: Record<string, { agentName: string; endpoint: string; displayName: string }> = {};
  private adapter: SettlementAdapter | null = null;
  /**
   * Turn calls to agent seats that are still on the wire, keyed `handNo:seat:deadline` (one turn
   * instant). A commit that re-announces the same turn must not call the agent twice. Purely
   * in-memory: if the DO is evicted mid-call the set is lost with it, and the turn-clock alarm —
   * which is persisted — still applies the default.
   */
  private inFlightTurns = new Set<string>();
  /** Serializes command/alarm processing so engine transitions never interleave across awaits. */
  private chain: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SCHEMA);
      const kv = await ctx.storage.get<unknown>(['meta', 'state', 'names', 'players', 'advisers']);
      this.meta = (kv.get('meta') as TableMeta | undefined) ?? null;
      this.state = (kv.get('state') as unknown) ?? null;
      // Resolved once, from the table's own stamp. A table stamped with a game this deployment does
      // not ship throws HERE, on load, rather than dealing the wrong game to people already seated.
      if (this.meta) this.game = gameFor(this.meta.game);
      this.names = (kv.get('names') as Record<string, string> | undefined) ?? {};
      this.advisers = (kv.get('advisers') as Record<string, { agentName: string; endpoint: string; displayName: string }> | undefined) ?? {};
      // Migration: a table created before phase 2 has `names` but no `players`. Everyone in it was a
      // human on a WebSocket, so the record is derivable; it is persisted on the next seat change.
      this.players = (kv.get('players') as Record<string, SeatRecord> | undefined) ?? migratePlayers(this.names);
      // Migration: a table created before the chip rate was pinned has been settling at
      // `LEGACY_CHIP_VALUE`. Write it on once, here, and the table is immune to the deployment
      // default moving from this moment on — including the move that ships with this very change.
      const migrated = migrateChipValue(this.meta, env);
      if (migrated) {
        this.meta = migrated;
        await ctx.storage.put('meta', migrated);
      }
      // Repair: a table that stalled between hands has no alarm pending, and nothing to wake it.
      //
      // The alarm is how a table gets from "no hand running" to "deal one", and it is scheduled by
      // whatever last committed. A table whose last commit left it unable to deal — everyone sat
      // out, everyone broke, its bots on zero — scheduled nothing, so it went to sleep and no
      // amount of looking at it woke it up. `Friday Night` sat like that with three agents on zero
      // and one player left, which is the "the game is stuck" report.
      //
      // So a table with seats and no hand running gets exactly ONE between-hands tick on load. The
      // tick is where {@link settleBustedAgents} runs and where a hand is started if one can be; if
      // neither applies it schedules nothing further and the table goes straight back to sleep.
      if (this.state && this.snap().seats.length > 0 && !this.snap().roundInProgress) {
        if ((await ctx.storage.get<number>('next-hand-at')) === undefined) {
          await ctx.storage.put('next-hand-at', Date.now() + HAND_START_DELAY_MS);
        }
        if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + HAND_START_DELAY_MS);
      }
    });
  }

  /* --------------------------------------------------- internal fetch API */

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/init') {
      const body = (await request.json()) as InitRequest;
      return this.serial(() => this.init(body));
    }
    if (!this.meta || !this.state) return json({ error: 'table not initialized' }, 404);

    if (request.method === 'GET' && path === '/view') {
      return json({
        tableId: this.meta.tableId,
        name: this.meta.name,
        // WHICH GAME, on the one-table read as well as on the lobby summary.
        //
        // A client picks its board from this, and a CLUB table is not in the public lobby — so a
        // client that could only learn the game by listing tables could not learn it for exactly the
        // tables that are private, which is the half that matters most to a club.
        game: this.game.id,
        settlement: this.meta.settlement,
        ...(this.meta.chipValue ? { chipValue: this.meta.chipValue } : {}),
        ...(this.meta.asset ? { asset: this.meta.asset } : {}),
        ...(this.meta.assetSymbol ? { assetSymbol: this.meta.assetSymbol } : {}),
        // The club is on the SPECTATOR view too, and not only on the summary: this is the response
        // the Worker gates `GET /tables/:id` on, and a view that did not carry it was a club table
        // that answered a stranger in full.
        ...(this.meta.club ? { club: this.meta.club } : {}),
        ...(this.meta.clubName ? { clubName: this.meta.clubName } : {}),
        // Whose practice table this is and how fast it plays, so the client can offer "deal again"
        // and the pace control only where they mean something — and read the current pace back.
        ...(this.meta.practiceFor ? { practiceFor: this.meta.practiceFor } : {}),
        ...(this.meta.paceMs === undefined ? {} : { paceMs: this.meta.paceMs }),
        ...(this.meta.pausedAt === undefined ? {} : { paused: true }),
        view: this.game.viewFor(this.state, null),
        names: this.names,
        players: this.publicPlayers(),
      });
    }
    /**
     * WHAT WOULD A GOOD PLAYER DO HERE, and why — for one seat, from that seat's own view.
     *
     * The coach reads exactly what the player reads: `viewFor(state, seat)` and `legalFor`, the same
     * redacted pair a human or an agent gets. A coach that reasoned from the full state would teach
     * with cards the learner cannot see, which is worse than not teaching — it produces reasoning
     * they can never reproduce for themselves.
     *
     * Only for a game that HAS a coach, and only for the seat asking. The Worker has already checked
     * that the caller holds that seat.
     */
    /**
     * WHAT SHOULD I DO — asked of the person's OWN agent when they have named one, and of the house
     * coach when they have not.
     *
     * The house coach is one strategy, the same for everybody. A person's own agent carries THEIR
     * style, written as their own artifacts somewhere this card room never reaches — so the app's
     * whole part is to ask and to say whose answer it is showing.
     *
     * The agent is sent the SEAT'S OWN redacted view, which is what that seat already sees. Advising
     * discloses nothing its holder does not hold, which is why this needs no mandate while taking a
     * turn does.
     */
    if (request.method === 'GET' && path === '/advice') {
      const seat = Number(url.searchParams.get('seat'));
      if (!Number.isInteger(seat) || seat < 0) return json({ error: 'which seat?' }, 400);
      const playerId = url.searchParams.get('player') ?? '';
      const adviser = playerId ? this.advisers[playerId] : undefined;

      if (adviser) {
        // THE HOUSE ANSWERS WHEN THE GAME IS CERTAIN AND NOBODY ASKED A QUESTION. A named adviser is a
        // person's own agent at their Home — eight seconds and their tokens per question — and a spot
        // the solver has seen fifty times without disagreeing has nothing for it to add. The reply says
        // so, so the panel shows whose line it is and why. A question in the person's own words always
        // goes to their agent: they asked it something, and only it can answer in their style.
        const sure = this.game.advise?.(this.state, seat);
        const asked = !url.searchParams.get('q') && sure?.certain
          ? ({ ok: false as const, error: '' })
          : await this.askAdviser(adviser, seat, url.searchParams.get('q') ?? undefined);
        if (!asked.ok && asked.error === '' && sure?.certain) {
          return json({ ...sure, source: 'house', note: `${adviser.displayName} was not asked — ${sure.certain.because}.` });
        }
        // A partner that cannot be reached falls back to the house coach rather than leaving somebody
        // mid-hand with nothing — and SAYS it fell back, because silently swapping whose advice this
        // is would be the one dishonest thing available here.
        if (asked.ok) return json({ ...asked.advice, source: { agent: adviser.agentName, displayName: adviser.displayName } });
        const house = this.game.advise?.(this.state, seat);
        if (!house) return json({ error: asked.error }, 502);
        return json({ ...house, source: 'house', note: `${adviser.displayName} could not be reached — ${asked.error}` });
      }

      const advice = this.game.advise?.(this.state, seat);
      if (!advice) return json({ error: 'this game has no coach' }, 404);
      return json({ ...advice, source: 'house' });
    }

    /**
     * WHO ADVISES THIS PLAYER HERE — asked of the table, which is the only thing that knows.
     *
     * The client used to hold this in a `useState` set only by its own POST, so a reload, a second
     * tab, or simply coming back later showed "advised by the house coach" while somebody's own agent
     * was in fact answering every question. A screen that names the wrong voice is the one dishonest
     * thing this feature must not do.
     */
    if (request.method === 'GET' && path === '/adviser') {
      const who = url.searchParams.get('player') ?? '';
      return json({ adviser: (who && this.advisers[who]) || null });
    }

    /** Name the agent that advises this player here, or drop it and go back to the house coach. */
    if (request.method === 'POST' && path === '/adviser') {
      const body = (await request.json()) as { playerId?: string; agentName?: string; endpoint?: string; displayName?: string };
      const who = (body.playerId ?? '').trim();
      if (!who) return json({ error: 'which player?' }, 400);
      if (!body.agentName || !body.endpoint) {
        delete this.advisers[who];
      } else {
        this.advisers[who] = { agentName: body.agentName, endpoint: body.endpoint, displayName: body.displayName ?? body.agentName };
      }
      await this.ctx.storage.put('advisers', this.advisers);
      return json({ adviser: this.advisers[who] ?? null });
    }

    /**
     * START THE GAME AGAIN, on a PRACTICE table only.
     *
     * A practice table is for learning, and learning means "that went badly, deal again" — not
     * living with a scoreboard for the rest of the week. This throws the state away and builds a
     * fresh one from the same game and config, then puts everybody back in the seat they were in.
     *
     * SEATS ARE KEPT, SCORES ARE NOT. That is the whole difference between this and opening a new
     * table, and it is what makes a practice table a place rather than a thing you keep making.
     *
     * The Worker has already checked the caller owns it. This refuses on any other table, because a
     * reset at a real one would wipe a game people are in the middle of.
     */
    /** Stop, or start again. Practice tables only; the Worker has checked the caller owns it. */
    if (request.method === 'POST' && path === '/pause') {
      const meta = this.meta as TableMeta;
      if (!meta.practiceFor) return json({ error: 'only a practice table can be paused' }, 409);
      const body = (await request.json()) as { paused?: unknown };
      return this.serial(() => this.setPaused(body?.paused === true));
    }

    /** How fast this table plays. Practice tables only; the Worker has checked the caller owns it. */
    if (request.method === 'POST' && path === '/pace') {
      const meta = this.meta as TableMeta;
      if (!meta.practiceFor) return json({ error: 'only a practice table sets its own pace' }, 409);
      const body = (await request.json()) as { ms?: unknown };
      const ms = Number(body?.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 8000) return json({ error: 'a pace is 0 to 8000 ms' }, 400);
      const next: TableMeta = { ...meta, paceMs: Math.floor(ms) };
      this.meta = next;
      await this.ctx.storage.put('meta', next);
      return json({ paceMs: next.paceMs });
    }

    if (request.method === 'POST' && path === '/reset') {
      return this.serial(() => this.reset());
    }

    if (request.method === 'POST' && path === '/seat-agent') {
      const body = (await request.json()) as SeatAgentBody;
      return this.serial(() => this.seatAgent(body));
    }
    if (request.method === 'DELETE' && path.startsWith('/seat-agent/')) {
      const seat = Number(path.slice('/seat-agent/'.length));
      if (!Number.isInteger(seat) || seat < 0) return json({ error: 'bad seat' }, 400);
      return this.serial(() => this.unseatAgent(seat));
    }
    // The operator clear. The Worker has already checked the operator token; the three conditions
    // that are about the SEAT rather than the caller are checked here, where the truth about the
    // seat lives, and a refusal names the one that failed.
    if (request.method === 'DELETE' && path.startsWith('/seat/')) {
      const seat = Number(path.slice('/seat/'.length));
      if (!Number.isInteger(seat) || seat < 0) return json({ error: 'bad seat' }, 400);
      return this.serial(() => this.clearSeat(seat));
    }
    // OPERATOR: retire the table. The Worker has already checked the operator token; the condition
    // that is about the TABLE rather than the caller — is anybody sitting here — is checked below,
    // where the truth about the seats lives.
    if (request.method === 'POST' && path === '/retire') {
      return this.serial(() => this.retire());
    }
    if (request.method === 'POST' && path === '/stand-up') {
      const body = (await request.json()) as { playerId?: string };
      const playerId = (body.playerId ?? '').trim();
      if (!playerId) return json({ error: 'playerId is required' }, 400);
      return this.serial(() => this.standUpPlayer(playerId));
    }
    if (request.method === 'GET' && path === '/summary') {
      return json(this.summary());
    }
    if (request.method === 'GET' && path === '/ledger') {
      return json(this.ledgerFor(url.searchParams.get('playerId')));
    }
    if (request.method === 'GET' && path.startsWith('/hand/')) {
      const n = Number(path.slice('/hand/'.length));
      if (!Number.isInteger(n) || n < 1) return json({ error: 'bad hand number' }, 400);
      return this.handRecord(n);
    }
    if (request.method === 'GET' && path === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket' }, 426);
      return this.openSocket(request);
    }
    return json({ error: 'not found' }, 404);
  }

  /**
   * Stop the table, or start it again.
   *
   * PAUSING TAKES NO TIME OFF ANYBODY. The turn clock and the next-round timer are both absolute
   * instants, so resuming moves them forward by exactly the length of the pause — a seat that had
   * twenty seconds left still has twenty seconds. The alternative, letting them run, would mean
   * every pause cost somebody their turn.
   */
  /**
   * WHICH GAME THIS TABLE IS ON, counted in memory and bumped by every reset.
   *
   * A reset deals from round one again, so the round number alone cannot tell an agent's answer to
   * the OLD round one from an answer to the new one — and `draw` is legal in both, so a stale reply
   * would simply be applied. Anybody watching sees the other players carry on playing a game that
   * no longer exists. The generation is what makes the two rounds different.
   *
   * In memory on purpose: an evicted object has no calls in flight to be confused about.
   */
  private generation = 0;

  private async setPaused(paused: boolean): Promise<Response> {
    const meta = this.meta as TableMeta;
    const already = meta.pausedAt !== undefined;
    if (paused === already) return json({ paused: already });
    const now = Date.now();

    if (paused) {
      this.meta = { ...meta, pausedAt: now };
      await this.ctx.storage.put('meta', this.meta);
    } else {
      const held = Math.max(0, now - (meta.pausedAt ?? now));
      const { pausedAt: _gone, ...rest } = meta;
      this.meta = rest;
      await this.ctx.storage.put('meta', this.meta);
      // Everything that was counting down gets the held time back.
      const state = this.state;
      if (state) {
        const at = this.snap(state);
        if (at.deadline !== null) {
          this.state = this.game.setDeadline(state, at.deadline + held);
          await this.ctx.storage.put('state', this.state);
        }
      }
      const nextAt = await this.ctx.storage.get<number>('next-hand-at');
      if (nextAt !== undefined) {
        // The NEXT DEAL is not a clock somebody is racing, so it is capped rather than shifted.
        // Shifting it by the whole pause meant a table paused overnight sat there the next morning
        // waiting out a delay that had already elapsed — no cards, no turn, nothing to press.
        await this.ctx.storage.put('next-hand-at', Math.min(nextAt + held, now + HAND_START_DELAY_MS));
      }
    }

    // Say so, and put the clock back on screen with the right number on it.
    for (const ws of this.ctx.getWebSockets()) {
      send(ws, {
        type: 'snapshot',
        view: this.wireView(this.game.viewFor(this.state, this.viewerSeat(ws))),
        names: this.names,
        players: this.publicPlayers(),
      });
    }
    await this.scheduleAlarm();
    // Whoever was on the clock when we stopped is asked again, so an agent that was waiting resumes.
    if (!paused && this.state) {
      const at = this.snap(this.state);
      if (at.toAct !== null && at.deadline !== null) this.notifyTurn(this.state, at.toAct, at.deadline);
    }
    return json({ paused });
  }

  /** Whether this table is holding. Nothing moves while it is. */
  private get paused(): boolean {
    return (this.meta as TableMeta | null)?.pausedAt !== undefined;
  }

  /** Throw the game away and deal from the start, keeping whoever is sitting there. */
  private async reset(): Promise<Response> {
    const meta = this.meta as TableMeta | null;
    if (!meta || !this.state) return json({ error: 'table not initialized' }, 404);
    if (!meta.practiceFor) return json({ error: 'only a practice table can be reset' }, 409);

    const before = this.snap(this.state);
    let fresh: unknown;
    try {
      /**
       * THE GAME'S CURRENT DEFAULTS, not the ones this table was born with.
       *
       * Reset used to hand the table's own config straight back, which is right for a table somebody
       * configured — and a practice table is not one. `POST /practice` always creates it with `{}`,
       * so its stored config is not a choice anybody made; it is a snapshot of whatever the defaults
       * were on the day it first existed. Handing that back meant a derived table, which lives
       * forever and is the one most people actually play on, could never pick up a better default.
       *
       * Concretely: a canasta turn went from 45 seconds to 90 because 45 was inherited from poker and
       * timed people out for reading their hand — and every practice table made before that would
       * have stayed at 45 for good.
       *
       * This route is practice-only (refused above), so nothing a person chose is discarded here.
       */
      // The practice defaults, not the game's: "start over" must keep the learner's clock, or the one
      // table that exists to be learnt at goes back to the money clock the second time it is dealt.
      fresh = this.game.create(practiceConfigFor(this.game.id) as Partial<unknown>);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    // Back into the chairs they were in. A reset that also emptied the table would make the person
    // set the whole thing up again, which is the errand this exists to remove.
    for (const seat of before.seats) {
      try {
        fresh = this.game.sitDown(fresh, seat.seat, seat.playerId, seat.stack);
      } catch {
        // A seat the fresh game will not take (a rule that changed under it) is simply not re-taken.
        // Better a table with a gap somebody can fill than one that refuses to reset at all.
      }
    }
    // NOTHING FROM THE OLD GAME MAY LAND ON THIS ONE. Agents answer out of band, so a call made a
    // moment ago is still on the wire — and after a reset its round number matches the new round's.
    this.generation++;
    this.inFlightTurns.clear();

    this.state = fresh;
    await this.ctx.storage.put('state', fresh);
    // The old round's history belongs to the old game. Leaving it would make the next round #1 land
    // on top of rows from a game that no longer exists.
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM events');
    sql.exec('DELETE FROM actions');
    sql.exec('DELETE FROM hands');
    await this.ctx.storage.delete('seed');
    await this.ctx.storage.delete('next-hand-at');

    // Everyone watching gets the whole new table, not a diff: nothing of the old game survives.
    for (const ws of this.ctx.getWebSockets()) {
      send(ws, {
        type: 'snapshot',
        view: this.wireView(this.game.viewFor(fresh, this.viewerSeat(ws))),
        names: this.names,
        players: this.publicPlayers(),
      });
    }
    // …and deal, once there are enough of them again.
    if (this.game.canStart(fresh)) await this.ctx.storage.put('next-hand-at', Date.now() + HAND_START_DELAY_MS);
    await this.scheduleAlarm();
    return json({ reset: true, tableId: meta.tableId });
  }

  private async init(body: InitRequest): Promise<Response> {
    if (this.meta && this.state) return json(this.summary());
    const config = body.config ?? {};
    // WHICH GAME, resolved BEFORE anything is created and refused by name if this deployment does
    // not deal it. Everything below — the state, the config validation, the settlement adapter — is
    // the game's answer, so getting this wrong would build a table out of the wrong rules.
    try {
      this.game = gameFor(body.game);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    let state: unknown;
    try {
      state = this.game.create(config);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    // The rate is a property of the TABLE, read from the deployment default at this instant and
    // fixed for the life of the table. Everything downstream reads `meta.chipValue`, never the env.
    const rate = defaultChipValue(this.env);
    // …and so is the CURRENCY. Same instant, same rule, same reason: a table settles in the money it
    // opened in, whatever the deployment is pointed at by the time somebody cashes out.
    const asset = defaultAsset(this.env);
    const assetSymbol = defaultAssetSymbol(this.env);
    const meta: TableMeta = {
      tableId: body.tableId,
      name: body.name,
      settlement: body.settlement,
      createdAt: body.createdAt ?? Date.now(),
      ...(rate === null ? {} : { chipValue: rate.toString() }),
      ...(asset === null ? {} : { asset }),
      ...(asset === null || assetSymbol === null ? {} : { assetSymbol }),
      ...(body.club ? { club: body.club } : {}),
      ...(body.club && body.clubName ? { clubName: body.clubName } : {}),
      // WHO OPENED IT, pinned, so they can close it again.
      ...(body.createdBy ? { createdBy: body.createdBy } : {}),
      // Always stamped, including when it is the default. A field that is present only for the
      // non-default case is a field you cannot tell apart from an old row that predates it.
      game: this.game.id,
      ...(body.practiceFor ? { practiceFor: body.practiceFor } : {}),
    };
    // Adapter must exist for this mode before we accept the table — a table that cannot settle must
    // fail here, not at someone's cash-out. Built with the same funding resolver `settlement()` uses,
    // so the instance cached by this call behaves identically to one built later.
    try {
      this.adapter = createSettlementAdapter(meta.settlement, this.env, {
        ...(rate === null ? {} : { chipValue: rate }),
        ...(asset === null ? {} : { asset }),
        ...(asset === null || assetSymbol === null ? {} : { assetSymbol }),
        resolveFunding: (req) => this.playerFunding(req.playerId),
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    await this.ctx.storage.put({ meta, state, names: {}, players: {} });
    this.meta = meta;
    this.state = state;
    this.names = {};
    this.players = {};
    return json(this.summary());
  }

  /**
   * What the table is doing, without this object knowing what game it is.
   *
   * Every question this object used to answer by reaching into poker's `TableState` — who is seated,
   * what they hold, which round it is, whose turn it is, when their clock runs out — is asked here
   * instead. The game answers in words that are true of any seated turn-based game, which is what
   * lets a second one be added without editing this file.
   */
  private snap(state: unknown = this.state): TableSnapshot {
    return this.game.snapshot(state);
  }

  /**
   * THE WIRE IS STILL POKER-SHAPED, and these three functions are the whole of what that now costs.
   *
   * `@pokernight/protocol` types the table view, the legal actions and the events as poker's, so a
   * game's own values are cast on their way out — here, in one named place, rather than at forty
   * call sites. Everything else in this object is game-agnostic; generalising the protocol is the
   * next step and this is exactly where it starts.
   */
  private wireView(view: unknown): TableView {
    return view as TableView;
  }

  private wireLegal(legal: unknown): LegalActions {
    return legal as LegalActions;
  }

  private wireEvents(events: readonly unknown[]): EngineEvent[] {
    return events as EngineEvent[];
  }

  private summary(): TableSummary {
    const meta = this.meta as TableMeta;
    const at = this.snap();
    return {
      tableId: meta.tableId,
      name: meta.name,
      config: at.config,
      // The game's own — poker's blinds — carried for a client that knows this game.
      gameConfig: this.game.config(this.state),
      settlement: meta.settlement,
      seated: at.seats.length,
      handNo: at.round,
      createdAt: meta.createdAt,
      // Said out loud so a client can convert chips to money instead of guessing at a rate — and
      // NAME that money, instead of assuming every table on the estate settles in the same coin.
      ...(meta.chipValue ? { chipValue: meta.chipValue } : {}),
      ...(meta.asset ? { asset: meta.asset } : {}),
      ...(meta.assetSymbol ? { assetSymbol: meta.assetSymbol } : {}),
      // Said out loud so the Worker can gate on it without a second round trip, and so a client can
      // tell a club table from a pickup one at a glance.
      ...(meta.club ? { club: meta.club } : {}),
      ...(meta.clubName ? { clubName: meta.clubName } : {}),
      // WHO OPENED IT, so the Worker can let them close it and a client can offer the control only to
      // somebody it will not be refused for.
      ...(meta.createdBy ? { createdBy: meta.createdBy } : {}),
      // Said out loud so a lobby can show what is being dealt without opening the table, and so a
      // client can pick the right board to draw before the first snapshot arrives.
      game: meta.game ?? DEFAULT_GAME,
      // Whose practice table this is, if it is one — so the Worker can gate a reset on the table's
      // own record, and a client can offer "deal again" only where it means something.
      ...(meta.practiceFor ? { practiceFor: meta.practiceFor } : {}),
      ...(meta.paceMs === undefined ? {} : { paceMs: meta.paceMs }),
      ...(meta.pausedAt === undefined ? {} : { paused: true }),
    };
  }

  private handRecord(handNo: number): Response {
    const row = this.ctx.storage.sql.exec<HandRow>('SELECT * FROM hands WHERE hand_no = ?', handNo).toArray()[0];
    if (!row) return json({ error: 'no such hand' }, 404);
    const ended = row.ended_at !== null;
    const actions = this.ctx.storage.sql
      .exec<{ json: string }>('SELECT json FROM actions WHERE hand_no = ? ORDER BY idx', handNo)
      .toArray()
      .map((r) => JSON.parse(r.json) as unknown);
    const record: Record<string, unknown> = {
      tableId: (this.meta as TableMeta).tableId,
      handNo: row.hand_no,
      seedCommit: row.seed_commit,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      actions,
      agentCalls: this.agentCalls(handNo, ended),
    };
    if (ended) {
      // Public once the hand is over: reveal, full event log (hole cards included) and the result.
      record.seedReveal = row.seed_reveal;
      record.result = row.result_json ? (JSON.parse(row.result_json) as HandResult) : null;
      record.events = this.ctx.storage.sql
        .exec<{ json: string }>('SELECT json FROM events WHERE hand_no = ? ORDER BY idx', handNo)
        .toArray()
        .map((r) => JSON.parse(r.json) as unknown);
    }
    return json(record);
  }

  /* -------------------------------------------------------------- sockets */

  private openSocket(request: Request): Response {
    const playerId = request.headers.get('x-player-id');
    const rawName = request.headers.get('x-player-name');
    const name = rawName ? decodeURIComponent(rawName) : null;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: Attachment = { playerId, name, seat: playerId ? this.seatOf(playerId) : null };
    // Reconnecting is activity: a seat whose owner is at the keyboard is not an abandoned seat and
    // must stop looking like one to the operator route.
    if (playerId) void this.touchSeat(playerId);
    // …and it undoes the sit-out the DROP itself caused.
    //
    // This used to be strictly manual, on the principle that being dealt in is the player's own
    // decision. That is right for a sit-out the player CHOSE, and right for one they earned by
    // missing turns — but a disconnect sit-out was never a decision. It is a guard that keeps a
    // vanished seat from bleeding blinds, and the moment its owner is back the guard has done its
    // job. Leaving it on is how two players with plenty of chips ended up sat out at a table that
    // then had nobody to deal to and looked broken. So: only `disconnected`, and only with chips in
    // front of them; a `requested` or `timeouts` sit-out still waits for the player to press it,
    // and the turn clock remains the answer to somebody who reconnects and then wanders off again.
    if (playerId) void this.serial(() => this.sitInOnReconnect(playerId));
    this.ctx.acceptWebSocket(server, playerId ? [playerId] : []);
    // The table may have stopped dealing for want of anybody watching; this socket is somebody.
    void this.serial(() => this.wakeForWatcher());
    server.serializeAttachment(attachment);
    const state = this.state;
    const welcome: ServerMessage = {
      type: 'welcome',
      tableId: (this.meta as TableMeta).tableId,
      // Which game this socket deals, in the same frame as the first view — so a client narrows the
      // payloads it is about to be sent instead of guessing from a table list it may not have read.
      game: this.game.id,
      playerId,
      view: this.wireView(this.game.viewFor(state, attachment.seat)),
      names: this.names,
      players: this.publicPlayers(),
    };
    send(server, welcome);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return sendError(ws, 'bad-command', 'expected a JSON text frame');
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      return sendError(ws, 'bad-command', 'invalid JSON');
    }
    const cmd = parseClientCommand(raw);
    if ('error' in cmd) return sendError(ws, 'bad-command', cmd.error);
    if (cmd.type === 'ping') return send(ws, { type: 'pong', at: Date.now() });

    const att = attachmentOf(ws);
    if (!att.playerId) return sendError(ws, 'unauthenticated', 'spectators cannot send commands');
    const playerId = att.playerId;
    const name = att.name ?? playerId;

    await this.serial(async () => {
      try {
        await this.handleCommand(ws, cmd, playerId, name);
      } catch (e) {
        const refusal = ruleRefusal(e);
        if (refusal) return sendError(ws, refusal.code, refusal.message);
        console.error('command failed', cmd.type, e);
        sendError(ws, 'bad-command', e instanceof Error ? e.message : 'internal error');
      }
    });
  }

  /**
   * A socket has gone. If it was the LAST one a seated player had, sit them out.
   *
   * Real card rooms sit you out the moment you drop, and for the same reason: a seat that is dealt in
   * and posts blinds with nobody behind it bleeds that player's money and stalls everyone else for
   * two turn clocks a hand. So the seat comes out of the deal — and nothing else happens to it. The
   * seat is kept, the chips are kept, and NO settlement is queued: dropping a connection is not
   * standing up, and a disconnect that moved somebody's money would be a far worse bug than the one
   * this fixes.
   *
   * A hand already running continues under the existing turn clock. Their chips are in the pot; the
   * clock will check or fold for them at the deadline, which is the ordinary treatment of a silent
   * seat and strictly better than folding a live hand out from under them the instant a tab closes.
   *
   * Two hibernation-API details this has to get right:
   *   - a player may hold several sockets (a second tab, a reconnect that overlapped), so only the
   *     last one closing counts — `stillConnected` asks the runtime, excluding this socket;
   *   - `webSocketClose` can fire for a socket that was already replaced, so the decision is made
   *     from the authoritative state and the live socket set, never from the closing socket's own
   *     (possibly stale) attachment `seat`.
   */
  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void reason;
    void wasClean;
    // Read the attachment BEFORE closing: it is the only thing that says whose socket this was.
    const playerId = attachmentOf(ws).playerId;
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
    if (!playerId) return; // a spectator has no seat to sit out
    await this.serial(() => this.sitOutOnDisconnect(playerId, ws));
  }

  /**
   * The other half of {@link sitOutOnDisconnect}: a player whose CONNECTION sat them out is sat back
   * in when they return. Silent when there is nothing to undo, so it is safe to call on every socket.
   */
  private async sitInOnReconnect(playerId: string): Promise<void> {
    const state = this.state;
    if (!state) return;
    if (this.players[playerId]?.sitOutReason !== 'disconnected') return;
    const seat = this.seatOf(playerId);
    if (seat === null) return;
    const occupant = this.snap(state).seats.find((x) => x.seat === seat);
    if (!occupant || occupant.status !== 'sitting-out') return;
    // At a STAKED table, no chips means the sit-out that matters now is being broke rather than
    // being away: sitting them in would change nothing and hide the rebuy they actually need.
    //
    // At an UNSTAKED one there is no such thing as broke — canasta reports every seat's stack as
    // zero because a seat's holding in that game is its cards. Reading a zero there as "they cannot
    // afford to play" left a canasta player who blinked their connection sat out permanently, at a
    // table with no rebuy to offer them and, until this was found, no way back at all.
    if (this.game.staked && occupant.stack <= 0) return;
    const seatsBefore = seatMap(this.snap(state));
    const next = this.game.sitIn(state, seat);
    await this.noteSitOut(playerId, null);
    const name = this.players[playerId]?.name ?? this.names[playerId] ?? playerId;
    await this.commit(next, [], [this.seatStatus(next, seat, playerId, name)], seatsBefore);
  }

  /** The sit-out half of {@link webSocketClose}, on the serial queue so it cannot interleave a hand. */
  private async sitOutOnDisconnect(playerId: string, gone: WebSocket): Promise<void> {
    const state = this.state;
    if (!state) return;
    if (this.stillConnected(playerId, gone)) return; // another tab, or a reconnect that already landed
    const seat = this.seatOf(playerId);
    if (seat === null) return; // they had stood up, or never sat down
    const record = this.players[playerId];
    // An AGENT seat has no socket at all and is reached over A2A every turn, so a socket closing
    // says nothing about it. Guarded explicitly rather than relying on agents never being tagged
    // with a socket: the cost of being wrong here is silently benching every bot at the table.
    if (record && record.transport !== 'ws') return;
    const occupant = this.snap(state).seats.find((x) => x.seat === seat);
    if (!occupant || occupant.status !== 'active') return; // already sitting out; nothing to say
    const seatsBefore = seatMap(this.snap(state));
    const next = this.game.sitOut(state, seat);
    await this.noteSitOut(playerId, 'disconnected');
    const name = record?.name ?? this.names[playerId] ?? playerId;
    await this.commit(next, [], [this.seatStatus(next, seat, playerId, name)], seatsBefore);
  }

  /**
   * Does this player still have a live socket on this table?
   *
   * `except` is the socket whose close is being handled: the runtime may still list it. Anything not
   * OPEN is on its way out and does not count as a connection either — an operator clearing a seat
   * must not be blocked by a socket that is already closing.
   */
  private stillConnected(playerId: string, except?: WebSocket): boolean {
    for (const ws of this.ctx.getWebSockets(playerId)) {
      if (ws === except) continue;
      if (ws.readyState === WS_OPEN) return true;
    }
    return false;
  }

  /**
   * A TABLE DEALS WHILE SOMEBODY IS WATCHING. Agent seats have no socket, so a table left with three
   * house bots and nobody else dealt hands forever: an alarm every few seconds, a hand every minute,
   * and — for anybody seated there who had named their own agent — a review of every one of those
   * hands sent to that agent at their Home, all night, with nobody at the table. Spectators count:
   * somebody watching bots play is somebody the hands are for.
   */
  private anybodyWatching(): boolean {
    return this.ctx.getWebSockets().some((ws) => ws.readyState === WS_OPEN);
  }

  /**
   * Somebody arrived. A next deal that fell due while nobody was here starts from NOW plus the
   * ordinary delay, never from the moment it was scheduled — the same cap a resumed pause applies —
   * and the alarm that stopped when the last socket closed is set again.
   */
  private async wakeForWatcher(): Promise<void> {
    const nextAt = await this.ctx.storage.get<number>('next-hand-at');
    const now = Date.now();
    if (nextAt !== undefined && nextAt < now) await this.ctx.storage.put('next-hand-at', now + HAND_START_DELAY_MS);
    await this.scheduleAlarm();
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.warn('websocket error', error);
    try {
      ws.close(1011, 'error');
    } catch {
      /* already closed */
    }
  }

  /* ------------------------------------------------------------- commands */

  private async handleCommand(ws: WebSocket, cmd: ClientCommand, playerId: string, name: string): Promise<void> {
    const state = this.state;
    const meta = this.meta as TableMeta;
    const seatsBefore = seatMap(this.snap(state));
    const now = Date.now();
    // Anything a seated player says is proof they are still here, and the operator clear route reads
    // that. Done for EVERY command (chat and ping included) because being at the keyboard is the
    // thing being measured, not being good at poker.
    await this.touchSeat(playerId, now);

    switch (cmd.type) {
      case 'join': {
        const orderId = `${meta.tableId}:${playerId}:${cmd.seat}:${now}`;
        const funding = this.settles ? await this.playerFunding(playerId) : null;
        const auth = await this.settlement().authorizeBuyIn({
          tableId: meta.tableId,
          seat: cmd.seat,
          playerId,
          chips: cmd.buyIn,
          orderId,
          ...(funding?.treasury ? { playerAddress: funding.treasury } : {}),
        });
        if (!auth.ok) return sendError(ws, 'settlement-failed', auth.reason);
        const next = this.game.sitDown(state, cmd.seat, playerId, cmd.buyIn);
        // Play money settles inline (nothing leaves the DO). A settled table queues the movement and
        // never blocks the seat on it — the money path must not be able to stall a hand.
        await this.settleBuyInOrQueue({
          tableId: meta.tableId,
          seat: cmd.seat,
          playerId,
          chips: cmd.buyIn,
          orderId,
          kind: 'buy-in',
          handNo: null,
          at: now,
          ...(funding?.treasury ? { playerAddress: funding.treasury } : {}),
        });
        await this.putPlayer({ playerId, name, kind: 'human', transport: 'ws', ...(funding?.treasury ? { treasury: funding.treasury } : {}) });
        this.setAttachmentSeat(playerId, cmd.seat);
        const stack = this.snap(next).seats.find((s) => s.seat === cmd.seat)?.stack ?? cmd.buyIn;
        const ev: SeatEvent = { type: 'seat-joined', seat: cmd.seat, playerId, name, stack, status: 'active', kind: 'human' };
        await this.commit(next, [], [ev], seatsBefore);
        return;
      }
      case 'leave': {
        const seat = this.seatOf(playerId);
        if (seat === null) throw new EngineError('not-seated', 'you are not seated');
        await this.standUpSeat(seat, playerId, name, seatsBefore, now);
        this.setAttachmentSeat(playerId, null);
        return;
      }
      case 'sit-out':
      case 'sit-in': {
        const seat = this.seatOf(playerId);
        if (seat === null) throw new EngineError('not-seated', 'you are not seated');
        const next = cmd.type === 'sit-out' ? this.game.sitOut(state, seat) : this.game.sitIn(state, seat);
        // Sitting in is always the player's own decision, however they came to be out — a reconnect
        // never makes it for them. Recording 'requested' on the way out keeps the client's
        // explanation honest: "you asked to sit out" is a different sentence from "you dropped".
        await this.noteSitOut(playerId, cmd.type === 'sit-out' ? 'requested' : null);
        await this.commit(next, [], [this.seatStatus(next, seat, playerId, name)], seatsBefore);
        return;
      }
      case 'add-chips': {
        const seat = this.seatOf(playerId);
        if (seat === null) throw new EngineError('not-seated', 'you are not seated');
        const orderId = `${meta.tableId}:${playerId}:${seat}:add:${now}`;
        const treasury = this.players[playerId]?.treasury;
        const auth = await this.settlement().authorizeBuyIn({
          tableId: meta.tableId,
          seat,
          playerId,
          chips: cmd.amount,
          orderId,
          ...(treasury ? { playerAddress: treasury } : {}),
        });
        if (!auth.ok) return sendError(ws, 'settlement-failed', auth.reason);
        // A player sat out BECAUSE they had nothing left is asking, by rebuying, to keep playing.
        // Leaving them sat out would make the rebuy useless — money moved, still not dealt in — and
        // "Sit in" was the only control on offer to somebody it could not help. So the two halves
        // happen together, and only in that exact case: a player who CHOSE to sit out and then tops
        // up keeps the choice they made.
        const brokeBefore = (this.snap(state).seats.find((x) => x.seat === seat)?.stack ?? 0) === 0;
        const wasSittingOut = this.snap(state).seats.find((x) => x.seat === seat)?.status === 'sitting-out';
        let next = this.game.addStake(state, seat, cmd.amount);
        if (brokeBefore && wasSittingOut && (this.snap(next).seats.find((x) => x.seat === seat)?.stack ?? 0) > 0) {
          next = this.game.sitIn(next, seat);
          await this.noteSitOut(playerId, null);
        }
        await this.settleBuyInOrQueue({
          tableId: meta.tableId,
          seat,
          playerId,
          chips: cmd.amount,
          orderId,
          kind: 'add-chips',
          handNo: this.snap(state).round,
          at: now,
          ...(treasury ? { playerAddress: treasury } : {}),
        });
        await this.commit(next, [], [this.seatStatus(next, seat, playerId, name)], seatsBefore);
        return;
      }
      case 'act': {
        const seat = this.seatOf(playerId);
        if (seat === null) throw new EngineError('not-seated', 'you are not seated');
        // A PAUSED TABLE IS PAUSED FOR EVERYBODY, including the person who paused it. Holding only
        // the clock and the agents left a human's moves going through, so anything still playing
        // this seat kept the whole table moving and a pause took a minute to look like one.
        if (this.paused) return sendError(ws, 'paused', 'this table is paused');
        // Two different situations that used to share one message. "Not the current hand" sent a
        // player looking for a hand that had moved on; when there is no hand at all — the table is
        // short of players, or between deals — the true answer is that there is nothing to act in.
        const at = this.snap(state);
        if (!at.roundInProgress) return sendError(ws, 'no-hand', 'no hand is running at this table right now');
        if (cmd.handNo !== at.round) return sendError(ws, 'stale-hand', `hand ${cmd.handNo} is not the current hand`);
        // THE GAME PARSES ITS OWN ACTION and then judges it. A malformed move and an illegal one are
        // different answers and only the game can tell them apart.
        const parsed = this.game.parseAction(cmd.action);
        if (!parsed.ok) return sendError(ws, 'bad-command', parsed.reason);
        const applied = this.game.apply(state, seat, parsed.action);
        if (!applied.ok) return sendError(ws, 'illegal-action', applied.reason);
        await this.commit(applied.state, this.wireEvents(applied.events), [], seatsBefore);
        return;
      }
      case 'chat': {
        const ev: ChatEvent = { type: 'chat', playerId, name, text: cmd.text, at: now };
        this.broadcastTableEvents(state, [ev]);
        return;
      }
      case 'ping':
        return; // handled before serialization
    }
  }

  /* --------------------------------------------------------- agent seats */

  /**
   * Seat an A2A agent. The Worker has already resolved the base URL and checked that the agent card
   * advertises `poker.act`; this is the same path as a human `join` (authorize, sit down, settle the
   * buy-in, announce) with a synthetic playerId and an 'a2a' seat record.
   */
  private async seatAgent(body: SeatAgentBody): Promise<Response> {
    const state = this.state;
    const meta = this.meta as TableMeta;
    const agentName = body.agentName.trim();
    if (!agentName) return json({ error: 'agentName is required' }, 400);
    const playerId = agentPlayerId(agentName);
    const name = (body.displayName ?? agentName).slice(0, 32);
    const seatsBefore = seatMap(this.snap(state));
    const now = Date.now();
    const orderId = `${meta.tableId}:${playerId}:${body.seat}:${now}`;

    let next: unknown;
    try {
      next = this.game.sitDown(state, body.seat, playerId, body.buyIn);
    } catch (e) {
      const refusal = ruleRefusal(e);
      if (refusal) return json({ error: refusal.message, code: refusal.code }, 409);
      throw e;
    }
    const auth = await this.settlement().authorizeBuyIn({ tableId: meta.tableId, seat: body.seat, playerId, chips: body.buyIn, orderId });
    if (!auth.ok) return json({ error: auth.reason, code: 'settlement-failed' }, 402);
    await this.settleBuyInOrQueue({
      tableId: meta.tableId,
      seat: body.seat,
      playerId,
      chips: body.buyIn,
      orderId,
      kind: 'buy-in',
      handNo: null,
      at: now,
    });
    await this.putPlayer({
      playerId,
      name,
      kind: 'agent',
      transport: 'a2a',
      agentName,
      endpoint: body.endpoint,
      agentKind: body.agentKind,
    });
    const stack = this.snap(next).seats.find((s) => s.seat === body.seat)?.stack ?? body.buyIn;
    const ev: SeatEvent = {
      type: 'seat-joined',
      seat: body.seat,
      playerId,
      name,
      stack,
      status: 'active',
      // Carried inline so a client already connected badges the seat now, without waiting for a snapshot.
      kind: 'agent',
      agentName,
      ...(body.agentKind ? { agentKind: body.agentKind } : {}),
    };
    await this.commit(next, [], [ev], seatsBefore);
    return json({ seat: body.seat, stack, player: this.publicPlayers()[playerId] }, 201);
  }

  /** Stand an agent up (cash-out through the outbox, like a human `leave`). Refuses human seats. */
  private async unseatAgent(seat: number): Promise<Response> {
    const state = this.state;
    const occupant = this.snap(state).seats.find((s) => s.seat === seat);
    if (!occupant) return json({ error: `seat ${seat} is empty`, code: 'not-seated' }, 404);
    const record = this.players[occupant.playerId];
    if (record?.transport !== 'a2a') return json({ error: `seat ${seat} is not an agent seat`, code: 'not-an-agent' }, 400);
    await this.standUpSeat(seat, occupant.playerId, record.name, seatMap(this.snap(state)), Date.now());
    return json({ seat, playerId: occupant.playerId });
  }

  /**
   * Shared stand-up: engine standUp, cash-out ledger row, settlement outbox op, `seat-left`.
   *
   * The ONE path a seat's chips leave by. A voluntary `leave`, an agent being unseated, an explicit
   * sign-out and an operator clearing an abandoned seat all come through here, so the money goes back
   * to the same place by the same mechanism in all four cases and there is exactly one piece of code
   * that has to be right about it. A disconnect is deliberately NOT one of them.
   */
  private async standUpSeat(seat: number, playerId: string, name: string, seatsBefore: Map<number, string>, now: number): Promise<StoodUp> {
    const state = this.state;
    const meta = this.meta as TableMeta;
    const { state: next, refund: cashOut, events } = this.game.standUp(state, seat);
    const ledgerId = crypto.randomUUID();
    const orderId = `${meta.tableId}:${playerId}:${seat}:out:${now}`;
    this.writeLedger({
      id: ledgerId,
      seat,
      playerId,
      kind: 'cash-out',
      chips: -cashOut,
      handNo: this.snap(state).round,
      at: now,
      // A settled table owes this player real money from this instant; say so until it has moved.
      ...(this.settles ? { receipt: this.pending(orderId, cashOut, now) } : {}),
    });
    const treasury = this.players[playerId]?.treasury;
    const payload: CashOutPayload = {
      ledgerId,
      tableId: meta.tableId,
      seat,
      playerId,
      chips: cashOut,
      historyDigest: this.historyDigest(),
      orderId,
      ...(treasury ? { playerAddress: treasury } : {}),
    };
    this.ctx.storage.sql.exec(
      'INSERT INTO outbox (id, kind, payload_json, attempts, next_at, done_at) VALUES (?, ?, ?, 0, ?, NULL)',
      crypto.randomUUID(),
      'settleCashOut',
      JSON.stringify(payload),
      now,
    );
    // The seat is gone, so any reason it was sitting out is history too.
    await this.noteSitOut(playerId, null);
    const ev: SeatEvent = { type: 'seat-left', seat, playerId, name, stack: cashOut };
    await this.commit(next, this.wireEvents(events), [ev], seatsBefore);
    // `pending` is the honest half of the answer: on a settled table the money has NOT moved yet — the
    // outbox op above is a promise to move it, with retries and a failure that gets written onto the
    // ledger row. Callers report this verbatim rather than saying the money is back.
    return { seat, playerId, name, chips: cashOut, settlement: meta.settlement, pending: this.settles };
  }

  /* ------------------------------------------------- stand-up on sign-out */

  /**
   * Stand this player up from the seat they hold here, if they hold one.
   *
   * Reached from `POST /auth/signout`. An explicit sign-out is a DIFFERENT ACT from a dropped
   * connection and is treated as one: a person who signs out has said they are done, so the seat is
   * given up and the money is sent home through the ordinary cash-out path. A session that merely
   * expired never reaches here — the client's `signOutTo('expired')` does not revoke, the socket
   * simply closes, and `webSocketClose` sits them out with their chips untouched.
   *
   * Answering `{ seated: false }` for a player who is not here is not an error: sign-out asks every
   * table, and most of them have never heard of this person.
   */
  private async standUpPlayer(playerId: string): Promise<Response> {
    const state = this.state;
    const meta = this.meta as TableMeta;
    const seat = this.seatOf(playerId);
    if (seat === null) return json({ seated: false, tableId: meta.tableId });
    const name = this.players[playerId]?.name ?? this.names[playerId] ?? playerId;
    const out = await this.standUpSeat(seat, playerId, name, seatMap(this.snap(state)), Date.now());
    const result: SeatStoodUp = {
      tableId: meta.tableId,
      tableName: meta.name,
      seat: out.seat,
      chips: out.chips,
      settlement: out.settlement,
      pending: out.pending,
    };
    return json({ seated: true, ...result });
  }

  /* ------------------------------------------------- operator seat clearing */

  /**
   * Clear an abandoned seat. THE route that can take a seat away from somebody who did not ask.
   *
   * The operator token was checked by the Worker before this was reached (`operator.ts`); it is the
   * first of four conditions and, on its own, clears nothing. The three below are about the seat
   * itself, and together they are what stops this being a kick button: an operator holding the token
   * still cannot touch a seat whose player is connected, is in a hand, or has done anything at all
   * recently. Every refusal names which one closed, because "403" tells an operator nothing about
   * whether to wait, to look again, or to stop.
   *
   * Clearing cashes out through {@link standUpSeat} — the same path a voluntary stand-up takes — so
   * the chips go back to that player's treasury. The house does not keep them and they are not
   * stranded on a seat nobody can reach.
   */
  /**
   * Retire this table: no seats, no history, no row in the lobby.
   *
   * There was no way to close a table at all, so a table nobody could play at — one settling in a
   * currency the card room has stopped using, say — sat in the lobby forever. This is that way, and
   * it is fenced the same way the operator seat clear is: the token gets you here, and the state of
   * the table decides the rest.
   *
   * The one condition is that NOBODY IS SEATED. A seated table holds somebody's chips, and chips at
   * a settled table are somebody's money; deleting the table would strand them with no cash-out and
   * no record. Stand the players up first (which pays them out through the ordinary path) and then
   * retire it. The refusal says exactly that, and how many seats are in the way.
   */
  private async retire(): Promise<Response> {
    const state = this.state;
    const meta = this.meta as TableMeta;
    if (this.snap(state).seats.length > 0) {
      return json(
        {
          error:
            `${meta.name} still has ${this.snap(state).seats.length} ${this.snap(state).seats.length === 1 ? 'player' : 'players'} seated, so it cannot be ` +
            `retired — their chips are at this table and retiring it would strand them. Stand them up first (a cash-out pays them ` +
            `out through the ordinary path), then retire it.`,
          refused: 'seated',
          seated: this.snap().seats.length,
        },
        409,
      );
    }
    // Everything this table knew: meta, state, ledger, hands, outbox, alarm. A retired table is
    // gone, not hidden — `GET /tables/:id` answers 404 afterwards, which is the honest answer.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.meta = null;
    this.state = null;
    this.names = {};
    this.players = {};
    this.adapter = null;
    return json({ retired: true, tableId: meta.tableId, name: meta.name });
  }

  private async clearSeat(seat: number): Promise<Response> {
    const state = this.state;
    const meta = this.meta as TableMeta;
    const now = Date.now();

    const occupant = this.snap(state).seats.find((s) => s.seat === seat);
    if (!occupant) return refuse('empty', `seat ${seat + 1} is empty — there is nothing to clear`, 404);
    const playerId = occupant.playerId;
    const name = this.players[playerId]?.name ?? this.names[playerId] ?? playerId;

    // 2. No live socket. Somebody sitting there with the page open is not an abandoned seat, whatever
    //    else is true of them, and this is the condition that makes the route impossible to aim at a
    //    player who is present.
    if (this.stillConnected(playerId)) {
      return refuse('connected', `seat ${seat + 1} (${name}) still has a live connection — a connected player is not an abandoned seat`, 409);
    }

    // 3. Not in a running hand. Their chips are in the pot and other people's money is riding on how
    //    that pot resolves; the turn clock is already the right answer to a silent seat mid-hand.
    // A ROUND IN PROGRESS OWNS EVERY SEAT AT THE TABLE. This used to ask whether the seat was in the
    // hand, which is a poker question — a canasta round deals everybody in, and there is no shorter
    // way to ask it that is true of both. The turn clock is the right answer to a silent seat either
    // way, so refusing the whole time a round is running costs nothing and is correct at any game.
    const at = this.snap(state);
    if (at.roundInProgress) {
      return refuse('in-hand', `seat ${seat + 1} (${name}) is in hand #${at.round}, which is still running — the turn clock owns that seat until the hand ends`, 409);
    }

    // 4. Idle past the threshold. The one that turns "not connected right now" into "gone".
    const threshold = seatIdleMs(this.env);
    const activeAt = this.seatActiveAt(playerId);
    const idleMs = Math.max(0, now - activeAt);
    if (idleMs < threshold) {
      return refuse(
        'idle',
        `seat ${seat + 1} (${name}) was active ${Math.round(idleMs / 1000)}s ago; a seat must be silent for ${Math.round(threshold / 1000)}s before it can be cleared`,
        409,
      );
    }

    const out = await this.standUpSeat(seat, playerId, name, seatMap(this.snap(state)), now);
    const body: SeatCleared = {
      ok: true,
      tableId: meta.tableId,
      seat: out.seat,
      playerId: out.playerId,
      name: out.name,
      chips: out.chips,
      settlement: out.settlement,
      pending: out.pending,
      idleMs,
    };
    return json(body);
  }

  /**
   * When this seat was last known to be here.
   *
   * `lastActiveAt` is the live answer. A seat taken before that field existed has none, and the
   * fallback is that player's most recent money row at this table — their buy-in, at the latest —
   * which is a real lower bound on when they were last doing something, not a guess. Failing that,
   * the table's own creation time, which cannot be later than the seat.
   */
  private seatActiveAt(playerId: string): number {
    const known = this.players[playerId]?.lastActiveAt;
    if (typeof known === 'number') return known;
    const row = this.ctx.storage.sql
      .exec<{ at: number | null }>('SELECT MAX(at) AS at FROM ledger WHERE player_id = ?', playerId)
      .toArray()[0];
    if (row && row.at !== null) return row.at;
    return (this.meta as TableMeta).createdAt;
  }

  /** Record that this player is here. See {@link SeatRecord.lastActiveAt} for why the write is throttled. */
  private async touchSeat(playerId: string, now = Date.now()): Promise<void> {
    const rec = this.players[playerId];
    if (!rec) return;
    const last = rec.lastActiveAt ?? 0;
    rec.lastActiveAt = now;
    if (now - last < ACTIVITY_WRITE_INTERVAL_MS) return;
    await this.ctx.storage.put('players', this.players);
  }

  /** Set (or clear) why a seat is sitting out, and persist it. Null means "no longer sitting out". */
  private async noteSitOut(playerId: string, reason: SitOutReason | null): Promise<void> {
    const rec = this.players[playerId];
    if (!rec) return;
    if (reason === null) {
      if (rec.sitOutReason === undefined) return;
      delete rec.sitOutReason;
    } else {
      if (rec.sitOutReason === reason) return;
      rec.sitOutReason = reason;
    }
    await this.ctx.storage.put('players', this.players);
  }

  /* ----------------------------------------------------------- agent turn */

  /**
   * Fire this game's act call for an agent seat. Detached on purpose: the serial queue stays free so
   * WebSocket commands and — crucially — the turn-clock alarm can run while the agent thinks.
   * `ctx.waitUntil` asks the runtime to keep the DO alive for it; if the DO is evicted anyway, the
   * persisted alarm still fires at the deadline and applies the default action.
   */
  /**
   * Ask somebody's own agent what they should do in their seat.
   *
   * It is handed exactly what the seat sees — `viewFor(seat)` — and its answer is applied to nothing.
   * The card room does not check whether the advice is good, because it has no standing to: the whole
   * point is that this is the person's own adviser rather than the house's.
   */
  private async askAdviser(
    adviser: { agentName: string; endpoint: string; displayName: string },
    seat: number,
    question?: string,
  ): Promise<{ ok: true; advice: { say: string; because?: string; action?: unknown } } | { ok: false; error: string }> {
    const state = this.state;
    if (!state) return { ok: false, error: 'this table has not dealt yet' };
    const at = this.snap(state);
    const skill = this.game.id === 'canasta' ? CANASTA_ADVISE_SKILL : POKER_ADVISE_SKILL;
    const read = this.game.readFor?.(state, seat) ?? null;
    const baseline = this.game.advise?.(state, seat) ?? null;
    const res = await callAdvise(
      adviser.endpoint,
      {
        skill,
        tableId: this.meta?.tableId ?? '',
        handNo: at.round,
        seat,
        view: this.game.viewFor(state, seat),
        legal: this.game.legalFor(state, seat),
        deadlineMs: a2aAdviceTimeoutMs(this.env),
        // The person's own words, passed through untouched. The card room does not parse it, answer
        // it, or keep it — it is for the agent that is doing the remembering.
        ...(question ? { question } : {}),
        // THE FACTS, AND THE HOUSE'S LINE, FOR AN ADVISER THAT REASONS. Both from the game's own
        // functions over the seat's own view — nothing here the seat cannot see. The read is the
        // arithmetic a language model would otherwise get wrong; the baseline is the rules coach's
        // answer, sent as an observation the person's agent may start from and depart from.
        ...(read != null ? { read } : {}),
        ...(baseline ? { baseline: { say: baseline.say, because: baseline.because, action: baseline.action, ...(baseline.mix ? { mix: { action: baseline.mix.action, share: baseline.mix.share } } : {}) } } : {}),
      },
      a2aAdviceTimeoutMs(this.env),
      this.env,
    );
    return res.ok ? { ok: true, advice: res.output } : { ok: false, error: res.error };
  }

  /**
   * Offer the finished round to each seat's own adviser, as that seat saw it.
   *
   * An adviser asked only DURING a hand sees the moments somebody thought to ask about and never
   * learns how any of them turned out — enough to advise, not enough to say "you have done this
   * before". A pattern needs the ending as well as the decision, so this hands over the final view
   * including its result.
   *
   * ONLY TO THE AGENT THAT PERSON NAMED, and only their own seat's view. One person's round is not
   * reported to anybody else's adviser, and no adviser is told anything that seat could not see.
   *
   * The card room keeps no profile of how anybody plays and has nowhere to put one. What is worth
   * remembering is the agent's business.
   */
  private reviewWithAdvisers(state: unknown): void {
    const advisers = Object.entries(this.advisers);
    if (advisers.length === 0) return;
    const at = this.snap(state);
    const skill = this.game.id === 'canasta' ? CANASTA_REVIEW_SKILL : POKER_REVIEW_SKILL;
    for (const [playerId, adviser] of advisers) {
      const mine = at.seats.find((x) => x.playerId === playerId);
      const seat = mine?.seat;
      // Named an adviser and then stood up: there is no seat to report and nothing to say about one.
      // SITTING OUT is the same for this purpose: the round was not dealt to them, and a review of a
      // hand they were not in is a hand their agent never needed — one per hand, all night, when the
      // person had closed the tab and the bots played on.
      if (seat === undefined || mine?.status === 'sitting-out') continue;
      // THE ROUND IN COUNTS, when the game can count it — what each player did, keyed by the player id
      // the seat's view shows — with the names the card room knows them by, so the agent remembers
      // "Sharkbot" and not "agent:sharkbot.svc". Labels are the host's to add; counts are the game's.
      const observation = labelled(this.game.observeFor?.(state, seat) ?? null, (id) => this.players[id]?.name ?? this.names[id] ?? null);
      const input = {
        skill,
        tableId: this.meta?.tableId ?? '',
        handNo: at.round,
        seat,
        view: this.game.viewFor(state, seat),
        legal: this.game.legalFor(state, seat),
        deadlineMs: a2aTimeoutMs(this.env),
        ...(observation ? { observation } : {}),
      };
      const sent = callReview(adviser.endpoint, input, a2aTimeoutMs(this.env), this.env);
      // Kept alive past the response the table is about to send, without the table waiting for it.
      if (typeof this.ctx.waitUntil === 'function') this.ctx.waitUntil(sent);
      else void sent;
    }
  }

  private startAgentTurn(state: unknown, handNo: number, seat: number, deadline: number, record: SeatRecord): void {
    const key = `${handNo}:${seat}:${deadline}`;
    if (this.paused) return; // a paused table is one nobody is playing at, agents included
    if (this.inFlightTurns.has(key)) return; // a re-announced turn must not call the agent twice
    this.inFlightTurns.add(key);
    // The game this call belongs to. A reset makes it a different one, whatever the round says.
    const gen = this.generation;
    const input: ActInput = {
      // WHICH GAME is asking. The agent on the other end reads its own game's view out of this
      // message, and an agent that plays poker must never be handed a canasta turn.
      skill: this.game.actSkill,
      tableId: (this.meta as TableMeta).tableId,
      handNo,
      seat,
      view: this.wireView(this.game.viewFor(state, seat)),
      legal: this.wireLegal(this.game.legalFor(state, seat)),
      deadlineMs: Math.max(500, deadline - Date.now() - AGENT_DEADLINE_HEADROOM_MS),
    };
    const done = this.runAgentTurn(key, record, input, deadline, gen).catch((e) => {
      this.inFlightTurns.delete(key);
      console.error('agent turn crashed', key, e);
    });
    try {
      this.ctx.waitUntil(done);
    } catch {
      /* waitUntil is unavailable in some test runtimes; the promise still runs */
    }
  }

  private async runAgentTurn(key: string, record: SeatRecord, input: ActInput, deadline: number, gen: number): Promise<void> {
    const requestedAt = Date.now();
    // Bounded by whichever is nearer: the configured A2A budget or the turn clock itself.
    const budget = Math.max(250, Math.min(a2aTimeoutMs(this.env), deadline - requestedAt));
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO agent_calls (hand_no, seat, requested_at) VALUES (?, ?, ?)',
      input.handNo,
      input.seat,
      requestedAt,
    );
    let base: string;
    try {
      base = record.endpoint ?? resolveAgentBase(this.env, record.agentName ?? record.playerId);
    } catch (e) {
      this.finishAgentCall(input, requestedAt, false, null, e instanceof Error ? e.message : String(e));
      this.inFlightTurns.delete(key);
      return;
    }
    let result;
    try {
      result = await callAct(base, input, budget);
    } finally {
      this.inFlightTurns.delete(key);
    }

    /**
     * A PAUSE BEFORE THE MOVE LANDS, so a person can watch it happen.
     *
     * An agent answers in a couple of hundred milliseconds, so three of them take their whole turn
     * between two frames — cards move, melds appear, and a human at the table sees the result
     * without ever seeing the move. At a real table you watch somebody draw, think, and lay
     * something down, and that watching is most of how you learn a game.
     *
     * So the answer waits. Deliberately AFTER the call, not before: the agent has already thought,
     * so this costs the table nothing on the clock — it spends the time the turn was allowed anyway.
     * Never past the deadline, because a paced move that arrives late is a move that is not played.
     */
    // The TABLE's own pace if it has one, else the deployment's.
    const pace = (this.meta as TableMeta | null)?.paceMs ?? agentPaceMs(this.env);
    if (pace > 0) {
      const room = deadline - Date.now() - AGENT_DEADLINE_HEADROOM_MS;
      const wait = Math.max(0, Math.min(pace, room));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    if (!result.ok) {
      // Nothing to apply: the turn clock alarm owns the default, and two of these in a row sit the
      // seat out through the same MAX_TIMEOUTS_BEFORE_SIT_OUT path a silent human hits.
      console.warn(`agent seat ${input.seat} hand ${input.handNo}: ${result.error}`);
      this.finishAgentCall(input, requestedAt, false, null, result.error);
      return;
    }
    const output = result.output;
    await this.serial(() => this.applyAgentAction(record, input, output, requestedAt, gen));
  }

  /** Re-validate against the CURRENT state before applying: the world moved while the agent thought. */
  private async applyAgentAction(record: SeatRecord, input: ActInput, output: ActOutput, requestedAt: number, gen: number): Promise<void> {
    const drop = (why: string): void => {
      console.warn(`dropping agent action for seat ${input.seat} hand ${input.handNo}: ${why}`);
      this.finishAgentCall(input, requestedAt, false, output, why);
    };
    // The table was reset while this answer was on the wire. Round numbers restart at one, so this
    // is the ONLY thing that can tell the old game's round one from the new game's.
    if (gen !== this.generation) return drop('the table was reset while this move was in flight');
    if (this.paused) return drop('the table is paused');
    const state = this.state;
    if (!state) return drop('table not initialized');
    const now = this.snap(state);
    if (!now.roundInProgress || now.round !== input.handNo) return drop(`hand ${input.handNo} is no longer running`);
    if (now.toAct !== input.seat) return drop(`seat ${input.seat} is no longer to act`);
    const occupant = this.snap(state).seats.find((s) => s.seat === input.seat);
    if (!occupant || occupant.playerId !== record.playerId) return drop(`seat ${input.seat} changed hands`);
    // WHAT CAME BACK IS THE GAME'S, and only the game can read it. Parse it into that game's action
    // shape first — a malformed reply is refused by name here — and then let `apply` judge whether
    // it is legal, which it does by the same rules it judges a human's move by. This used to be a
    // poker legality check, which is why a canasta seat could not be filled by an agent at all.
    const parsed = this.game.parseAction(output.action);
    if (!parsed.ok) return drop(parsed.reason);

    const seatsBefore = seatMap(this.snap(state));
    const result = this.game.apply(state, input.seat, parsed.action);
    if (!result.ok) return drop(result.reason);
    // The game REFUSES rather than throwing, so an illegal reply from an agent is an answer this
    // object can log and drop — it never has to catch a rules exception off the wire.
    const applied = { state: result.state, events: this.wireEvents(result.events) };
    this.finishAgentCall(input, requestedAt, true, output, null);
    await this.commit(applied.state, applied.events, [], seatsBefore);
  }

  private finishAgentCall(input: ActInput, requestedAt: number, ok: boolean, output: ActOutput | null, error: string | null): void {
    this.ctx.storage.sql.exec(
      'UPDATE agent_calls SET responded_at = ?, ok = ?, action_json = ?, note = ?, error = ? WHERE hand_no = ? AND seat = ? AND requested_at = ?',
      Date.now(),
      ok ? 1 : 0,
      output ? JSON.stringify(output.action) : null,
      output?.note ?? null,
      error,
      input.handNo,
      input.seat,
      requestedAt,
    );
  }

  /**
   * The A2A exchanges for one hand, in request order (served with the hand record). An agent's `note`
   * is its private rationale (DESIGN.md §6): it is withheld until the hand is over, like the seed.
   */
  private agentCalls(handNo: number, includeNotes: boolean): unknown[] {
    return this.ctx.storage.sql
      .exec<AgentCallRow>('SELECT * FROM agent_calls WHERE hand_no = ? ORDER BY requested_at', handNo)
      .toArray()
      .map((r) => ({
        seat: r.seat,
        requestedAt: r.requested_at,
        respondedAt: r.responded_at,
        ok: r.ok === null ? null : r.ok === 1,
        action: r.action_json ? (JSON.parse(r.action_json) as unknown) : null,
        note: includeNotes ? r.note : null,
        error: r.error,
      }));
  }

  /* ---------------------------------------------------------------- alarm */

  override async alarm(): Promise<void> {
    await this.serial(async () => {
      const now = Date.now();
      // A PAUSED TABLE DOES NOT TICK. Nothing times out and nothing deals, and the alarm simply
      // comes round again — resuming is what puts the deadlines back and restarts the clock.
      if (this.paused) return this.scheduleAlarm();
      const state = this.state;
      if (state) {
        const seatsBefore = seatMap(this.snap(state));
        const at = this.snap(state);
        if (at.roundInProgress && at.toAct !== null && at.deadline !== null && now >= at.deadline) {
          const seat = at.toAct;
          const r = this.game.timeout(state, seat);
          let next = r.state;
          const extra: TableEvent[] = [];
          const s = this.snap(next).seats.find((x) => x.seat === seat);
          const allowed = this.game.maxTimeouts ?? MAX_TIMEOUTS_BEFORE_SIT_OUT;
          if (s && s.status === 'active' && s.timeouts >= allowed) {
            try {
              next = this.game.sitOut(next, seat);
              await this.noteSitOut(s.playerId, 'timeouts');
              extra.push(this.seatStatus(next, seat, s.playerId, this.names[s.playerId] ?? s.playerId));
            } catch (e) {
              console.warn('sit-out after timeouts failed', e);
            }
          }
          await this.commit(next, this.wireEvents(r.events), extra, seatsBefore);
        } else if (!at.roundInProgress) {
          const nextAt = await this.ctx.storage.get<number>('next-hand-at');
          if (nextAt !== undefined && now >= nextAt) {
            // Between hands is where a busted AGENT seat is dealt with, because it is the only
            // moment its stack is final and no hand is riding on it. Returns the state to start
            // from, which may differ from `state` if any agent was rebought or stood up.
            const settled = await this.settleBustedAgents(state, seatsBefore);
            // THE DEAL ITSELF WAITS FOR SOMEBODY WATCHING. `next-hand-at` is left pending rather than
            // deleted, and no alarm is set for it (`scheduleAlarm`): the next socket to open wakes it.
            if (this.anybodyWatching()) {
              await this.ctx.storage.delete('next-hand-at');
              if (this.game.canStart(settled)) await this.startNewHand(settled, seatMap(this.snap(settled)));
            }
          }
        }
      }
      await this.drainOutbox(now);
      await this.scheduleAlarm();
    });
  }

  /**
   * What happens to an AGENT seat that has run out of chips.
   *
   * A human at zero is offered a rebuy and decides. An agent cannot be offered anything: it holds no
   * session, no treasury and no opinion, so a bot at zero is a seat that will never play again and
   * the table quietly stops being able to deal. `Friday Night` reached exactly that state — three
   * agents on zero, one player left, deadlock — which is the same bug as the human one wearing a
   * different hat.
   *
   * Two modes, and each gets the only honest answer available to it:
   *
   *   play-money  TOP IT UP to the table's minimum buy-in. Play-money chips cost nobody anything
   *               and the house is already the source of every chip on the table, so keeping the
   *               bot in the game invents nothing that was not invented when it sat down. It goes
   *               through the ordinary `add-chips` path, so the ledger records it like any rebuy.
   *   settled     STAND IT UP. A rebuy here would move real money out of a treasury, and an agent
   *               has none — there is no account to charge and nobody to ask. Standing it up pays
   *               out whatever it has (nothing) through the ordinary path and frees the seat for
   *               someone who can pay for it. Inventing house money for a bot at a money table is
   *               the one thing this must not do.
   */
  private async settleBustedAgents(state: unknown, seatsBefore: Map<number, string>): Promise<unknown> {
    const meta = this.meta as TableMeta;
    const busted = this.snap(state).seats.filter((s) => s.stack === 0 && this.players[s.playerId]?.transport === 'a2a');
    if (busted.length === 0) return state;

    if (this.settles) {
      for (const seat of busted) {
        const name = this.players[seat.playerId]?.name ?? this.names[seat.playerId] ?? seat.playerId;
        try {
          await this.standUpSeat(seat.seat, seat.playerId, name, seatMap(this.snap()), Date.now());
        } catch (e) {
          console.warn(`standing up busted agent seat ${seat.seat}`, e);
        }
      }
      return this.state;
    }

    let next = state;
    const events: TableEvent[] = [];
    const now = Date.now();
    for (const seat of busted) {
      const amount = this.snap(next).config.minStake;
      const name = this.players[seat.playerId]?.name ?? this.names[seat.playerId] ?? seat.playerId;
      const orderId = `${meta.tableId}:${seat.playerId}:${seat.seat}:add:${now}`;
      try {
        next = this.game.addStake(next, seat.seat, amount);
        if (this.snap(next).seats.find((x) => x.seat === seat.seat)?.status === 'sitting-out') {
          next = this.game.sitIn(next, seat.seat);
          await this.noteSitOut(seat.playerId, null);
        }
        await this.settleBuyInOrQueue({
          tableId: meta.tableId,
          seat: seat.seat,
          playerId: seat.playerId,
          chips: amount,
          orderId,
          kind: 'add-chips',
          handNo: null,
          at: now,
        });
        events.push(this.seatStatus(next, seat.seat, seat.playerId, name));
      } catch (e) {
        console.warn(`rebuying busted agent seat ${seat.seat}`, e);
      }
    }
    if (events.length > 0) await this.commit(next, [], events, seatsBefore);
    return this.state;
  }

  private async startNewHand(state: unknown, seatsBefore: Map<number, string>): Promise<void> {
    const seed = randomSeed();
    const { state: next, events: started } = this.game.start(state, seed);
    // The seed stays in KV (never sent) until hand-ended writes it to `hands.seed_reveal`.
    await this.ctx.storage.put('seed', bytesToHex(seed));
    await this.commit(next, this.wireEvents(started), [], seatsBefore);
  }

  /** Sets the single DO alarm to the earliest pending deadline (turn clock, hand start, outbox retry). */
  private async scheduleAlarm(): Promise<void> {
    const candidates: number[] = [];
    const at = this.state ? this.snap() : null;
    if (at && at.deadline !== null && at.toAct !== null) candidates.push(at.deadline);
    const nextHandAt = await this.ctx.storage.get<number>('next-hand-at');
    // With nobody watching, the next deal waits for a socket rather than for a clock — an alarm set
    // for it would fire, find nobody, and set itself again, forever.
    if (nextHandAt !== undefined && this.anybodyWatching()) candidates.push(nextHandAt);
    const outbox = this.ctx.storage.sql
      .exec<{ next_at: number | null }>('SELECT MIN(next_at) AS next_at FROM outbox WHERE done_at IS NULL')
      .toArray()[0];
    if (outbox && outbox.next_at !== null) candidates.push(outbox.next_at);
    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...candidates));
  }

  /* --------------------------------------------------------------- outbox */

  private async drainOutbox(now: number): Promise<void> {
    const due = this.ctx.storage.sql
      .exec<OutboxRow>('SELECT * FROM outbox WHERE done_at IS NULL AND next_at <= ? ORDER BY next_at LIMIT 20', now)
      .toArray();
    for (const row of due) {
      try {
        await this.runOutboxOp(row);
        this.ctx.storage.sql.exec('UPDATE outbox SET done_at = ?, attempts = attempts + 1 WHERE id = ?', Date.now(), row.id);
      } catch (e) {
        const attempts = row.attempts + 1;
        const reason = e instanceof Error ? e.message : String(e);
        console.warn(`outbox ${row.kind} ${row.id} failed (attempt ${attempts})`, e);
        if (attempts >= MAX_OUTBOX_ATTEMPTS) {
          // Give up, but never silently: the ledger row keeps the reason so the player is told what
          // failed rather than watching a receipt that never arrives.
          this.ctx.storage.sql.exec('UPDATE outbox SET attempts = ?, done_at = ? WHERE id = ?', attempts, Date.now(), row.id);
          this.recordSettlementFailure(row, reason, attempts);
          continue;
        }
        const backoff = OUTBOX_BACKOFF_MS[Math.min(attempts, OUTBOX_BACKOFF_MS.length) - 1] ?? 120_000;
        this.ctx.storage.sql.exec('UPDATE outbox SET attempts = ?, next_at = ? WHERE id = ?', attempts, Date.now() + backoff, row.id);
      }
    }
  }

  private async runOutboxOp(row: OutboxRow): Promise<void> {
    switch (row.kind) {
      case 'settleCashOut': {
        const p = JSON.parse(row.payload_json) as CashOutPayload;
        const receipt = await this.settlement().settleCashOut({
          tableId: p.tableId,
          seat: p.seat,
          playerId: p.playerId,
          chips: p.chips,
          historyDigest: p.historyDigest,
          orderId: p.orderId,
          ...(p.playerAddress ? { playerAddress: p.playerAddress } : {}),
        });
        this.ctx.storage.sql.exec('UPDATE ledger SET receipt_json = ? WHERE id = ?', JSON.stringify(receipt), p.ledgerId);
        return;
      }
      case 'settleBuyIn': {
        const p = JSON.parse(row.payload_json) as BuyInPayload;
        const receipt = await this.settlement().settleBuyIn({
          tableId: p.tableId,
          seat: p.seat,
          playerId: p.playerId,
          chips: p.chips,
          orderId: p.orderId,
          ...(p.playerAddress ? { playerAddress: p.playerAddress } : {}),
        });
        this.ctx.storage.sql.exec('UPDATE ledger SET receipt_json = ? WHERE id = ?', JSON.stringify(receipt), p.ledgerId);
        return;
      }
      default:
        throw new Error(`unknown outbox kind ${row.kind}`);
    }
  }

  /** Write the reason a settlement gave up onto the ledger row it was going to receipt. */
  private recordSettlementFailure(row: OutboxRow, reason: string, attempts: number): void {
    let payload: { ledgerId?: string; orderId?: string; chips?: number };
    try {
      payload = JSON.parse(row.payload_json) as { ledgerId?: string; orderId?: string; chips?: number };
    } catch {
      return;
    }
    if (!payload.ledgerId) return;
    const adapter = this.settlement();
    const receipt = failedReceipt({
      mode: adapter.mode,
      orderId: payload.orderId ?? row.id,
      amount: (BigInt(payload.chips ?? 0) * adapter.chipValue).toString(),
      asset: adapter.asset,
      error: reason,
      attempts,
    });
    this.ctx.storage.sql.exec('UPDATE ledger SET receipt_json = ? WHERE id = ?', JSON.stringify(receipt), payload.ledgerId);
  }

  /* --------------------------------------------------------------- commit */

  /**
   * Apply a new engine state: persist it (plus the hand/action/event/ledger rows the events imply),
   * then fan out redacted events and per-viewer views, then the `turn` message and alarm.
   */
  private async commit(next: unknown, engineEvents: EngineEvent[], tableEvents: TableEvent[], seatsBefore: Map<number, string>): Promise<void> {
    const now = Date.now();
    let state = next;
    if (this.snap(state).toAct !== null && engineEvents.some((e) => e.type === 'turn')) {
      state = this.game.setDeadline(state, now + this.snap(state).config.turnMs);
    }
    const handNo = this.snap(state).round;
    const sql = this.ctx.storage.sql;
    let eventIdx = nextIdx(sql, 'events', handNo);
    let actionIdx = nextIdx(sql, 'actions', handNo);
    let handEnded = false;

    for (const ev of engineEvents) {
      sql.exec('INSERT INTO events (hand_no, idx, json) VALUES (?, ?, ?)', handNo, eventIdx++, JSON.stringify(ev));
      switch (ev.type) {
        case 'hand-started':
          sql.exec('INSERT OR REPLACE INTO hands (hand_no, seed_commit, started_at) VALUES (?, ?, ?)', ev.handNo, ev.seedCommit, now);
          break;
        case 'action':
          sql.exec('INSERT INTO actions (hand_no, idx, seat, json) VALUES (?, ?, ?, ?)', handNo, actionIdx++, ev.record.seat, JSON.stringify(ev.record));
          break;
        case 'hand-ended': {
          handEnded = true;
          const storedSeed = await this.ctx.storage.get<string>('seed');
          sql.exec(
            'UPDATE hands SET seed_reveal = ?, ended_at = ?, result_json = ? WHERE hand_no = ?',
            ev.seedReveal || storedSeed || null,
            now,
            JSON.stringify(ev.result),
            ev.handNo,
          );
          // THE LEDGER IS FOR MONEY, and only a staked game has any. Canasta's rounds produce a
          // SCORE, and writing it into a chip ledger would put numbers in a money column that no
          // money corresponds to — and then a settlement view would read them back as amounts owed.
          // The game's own flag decides, which is what `staked` is for.
          if (this.game.staked) {
            for (const [seatStr, chips] of Object.entries(ev.result.net)) {
              const seat = Number(seatStr);
              const playerId = seatsBefore.get(seat) ?? this.snap(state).seats.find((s) => s.seat === seat)?.playerId ?? 'unknown';
              this.writeLedger({ seat, playerId, kind: 'hand-result', chips, handNo: ev.handNo, at: now });
            }
            if (ev.result.rake > 0) this.writeLedger({ seat: -1, playerId: 'house', kind: 'rake', chips: ev.result.rake, handNo: ev.handNo, at: now });
          }
          await this.ctx.storage.delete('seed');
          break;
        }
        default:
          break;
      }
    }

    // Persist the state before anything is sent.
    this.state = state;
    await this.ctx.storage.put('state', state);

    if (handEnded) {
      // THE ROUND, TO EACH PERSON'S OWN ADVISER. Not awaited and not checked: a personal coach that
      // learns from a round is a thing happening on somebody else's server, and nothing at this table
      // is waiting on it. The round is over either way.
      this.reviewWithAdvisers(state);
      await this.ctx.storage.put('next-hand-at', now + NEXT_HAND_DELAY_MS);
    } else if (
      !this.snap(state).roundInProgress &&
      (await this.ctx.storage.get<number>('next-hand-at')) === undefined &&
      this.game.canStart(state)
    ) {
      await this.ctx.storage.put('next-hand-at', now + HAND_START_DELAY_MS);
    }

    // Fan out.
    this.broadcastTableEvents(state, tableEvents);
    this.broadcastEngineEvents(state, engineEvents);
    const clock = this.snap(state);
    if (clock.toAct !== null && clock.deadline !== null) {
      this.notifyTurn(state, clock.toAct, clock.deadline);
    }
    await this.scheduleAlarm();
  }

  private broadcastTableEvents(state: unknown, events: TableEvent[]): void {
    if (events.length === 0) return;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.viewerSeat(ws);
      const view = this.wireView(this.game.viewFor(state, seat));
      for (const event of events) send(ws, { type: 'event', event, view });
    }
  }

  private broadcastEngineEvents(state: unknown, events: EngineEvent[]): void {
    if (events.length === 0) return;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.viewerSeat(ws);
      const view = this.wireView(this.game.viewFor(state, seat));
      for (const ev of events) {
        const red = this.game.redact(ev, seat) as TableEvent | null;
        if (red) send(ws, { type: 'event', event: red, view });
      }
    }
  }

  private notifyTurn(state: unknown, seat: number, deadline: number): void {
    const at = this.snap(state);
    if (!at.roundInProgress) return;
    const record = this.recordForSeat(state, seat);
    if (record?.transport === 'a2a') {
      // Out of band: the A2A call must never hold the serial queue, or the table would stall for the
      // whole agent budget and the turn-clock alarm could not preempt it.
      this.startAgentTurn(state, at.round, seat, deadline, record);
      return;
    }
    const legal = this.wireLegal(this.game.legalFor(state, seat));
    const msg: ServerMessage = { type: 'turn', handNo: at.round, seat, legal, deadline };
    for (const ws of this.ctx.getWebSockets()) {
      if (this.viewerSeat(ws) === seat) send(ws, msg);
    }
  }

  /* -------------------------------------------------------------- helpers */

  private recordForSeat(state: unknown, seat: number): SeatRecord | undefined {
    const playerId = state ? this.snap(state).seats.find((s) => s.seat === seat)?.playerId : undefined;
    return playerId ? this.players[playerId] : undefined;
  }

  /** The public projection of `players`: no endpoints, no transport internals. */
  private publicPlayers(): Record<string, PlayerInfo> {
    const out: Record<string, PlayerInfo> = {};
    for (const [id, p] of Object.entries(this.players)) {
      const info: PlayerInfo = { playerId: p.playerId, name: p.name, kind: p.kind };
      if (p.agentName) info.agentName = p.agentName;
      if (p.agentKind) info.agentKind = p.agentKind;
      // Carried on `welcome` as well as on the event, so the person who reconnects to a seat that was
      // sat out while they were away is told why by the first message they receive.
      if (p.sitOutReason) info.sitOutReason = p.sitOutReason;
      out[id] = info;
    }
    return out;
  }

  private async putPlayer(record: SeatRecord): Promise<void> {
    // Taking a seat is the first thing this player did at this table. Stamped here so a seat is never
    // idle the instant it is taken — the operator clear route reads this, and a brand-new seat with
    // no activity stamp would otherwise be judged on a fallback rather than on the truth.
    this.players[record.playerId] = { ...record, lastActiveAt: record.lastActiveAt ?? Date.now() };
    this.names[record.playerId] = record.name;
    await this.ctx.storage.put({ names: this.names, players: this.players });
  }

  private settlement(): SettlementAdapter {
    if (!this.adapter) {
      const rate = this.chipValue();
      const asset = this.asset();
      const symbol = this.assetSymbol();
      this.adapter = createSettlementAdapter((this.meta as TableMeta).settlement, this.env, {
        ...(rate === null ? {} : { chipValue: rate }),
        ...(asset === null ? {} : { asset }),
        ...(asset === null || symbol === null ? {} : { assetSymbol: symbol }),
        resolveFunding: (req) => this.playerFunding(req.playerId),
      });
    }
    return this.adapter;
  }

  /**
   * This table's chip rate, in asset base units. THE one source for every amount of money this
   * table moves; `CHIP_VALUE` is only ever consulted through the pin written at creation (or, for a
   * table older than the pin, written on first load).
   */
  private chipValue(): bigint | null {
    return pinnedChipValue(this.meta, this.env);
  }

  /**
   * This table's settlement asset. THE one currency every amount of money this table moves is
   * denominated in; `ASSET` is only ever consulted through the pin written at creation.
   */
  private asset(): string | null {
    return pinnedAsset(this.meta, this.env);
  }

  /** What this table's money is called. Null where the table states no symbol for its asset. */
  private assetSymbol(): string | null {
    return pinnedAssetSymbol(this.meta, this.env);
  }

  /**
   * Whose money is this, and what authorises moving it?
   *
   * Answered from the SERVER-side session record, never from anything the socket said. A seat that
   * has already sat down has its treasury pinned on its `SeatRecord`, so a cash-out still knows
   * where to pay after the session that opened it has expired.
   */
  private async playerFunding(playerId: string): Promise<PlayerFunding | null> {
    const pinned = this.players[playerId]?.treasury;
    const rec = await readSessionRecord(this.env, playerId);
    const treasury = (rec?.treasury ?? pinned ?? '').trim();
    if (!treasury) return null;
    const funding: PlayerFunding = { treasury: treasury as `0x${string}` };
    // A mandate authorises ONE account to be spent from. If the player has since moved to another
    // treasury, the authority does not travel with them: leaving it attached would let a seat spend
    // from money they never authorised. Absent here means the adapter refuses by name, which is right.
    const boundTo = (rec?.mandateTreasury ?? '').trim().toLowerCase();
    // …and a mandate authorises ONE CURRENCY to be spent. KEPT ON PURPOSE with one currency on the
    // estate: a mandate must be denominated in the asset the table settles in, and that is a safety
    // property rather than a mixed-currency feature. It should now never fire — which is exactly
    // when a check earns its keep, because the day it does fire something upstream has gone wrong
    // and a signature is about to be read as consent to something it never named. The adapter's
    // on-chain check would refuse it anyway (`checkBuyInMandate` compares the asset); refusing here
    // means the refusal names the currency instead of arriving deep inside a redemption.
    const mandateAsset = (rec?.mandateAsset ?? '').trim().toLowerCase();
    const tableAsset = (this.asset() ?? '').trim().toLowerCase();
    const sameAsset = !mandateAsset || !tableAsset || mandateAsset === tableAsset;
    if (rec?.buyInMandate && (!boundTo || boundTo === treasury.toLowerCase()) && sameAsset) {
      funding.mandate = rec.buyInMandate as PlayerFunding['mandate'];
    } else if (rec?.buyInMandate && !sameAsset) {
      // Say which of the two it is. A player who has just authorised buy-ins and is then told they
      // have authorised nothing would reasonably conclude the ceremony failed; what actually
      // happened is that their authority is denominated in another currency and this table is not
      // paid in it.
      const name = (address: string): string => {
        const symbol = assetSymbolFor(this.env, address);
        return symbol ? `${symbol} (${address})` : address;
      };
      funding.mandateProblem =
        `your buy-in authority is denominated in ${name(mandateAsset)}, and this table settles in ` +
        `${name(tableAsset)} — authorise buy-ins for this table's currency, or sit at a table that ` +
        `settles in the one you authorised`;
    }
    return funding;
  }

  /** True when this table moves a real asset, so buy-ins go through the outbox instead of inline. */
  private get settles(): boolean {
    return (this.meta as TableMeta).settlement !== 'play-money';
  }

  private seatOf(playerId: string): number | null {
    if (!this.state) return null;
    const s = this.snap().seats.find((x) => x.playerId === playerId);
    return s ? s.seat : null;
  }

  /** The viewer's seat from the authoritative state (attachment may lag after a leave). */
  private viewerSeat(ws: WebSocket): number | null {
    const att = attachmentOf(ws);
    return att.playerId ? this.seatOf(att.playerId) : null;
  }

  private setAttachmentSeat(playerId: string, seat: number | null): void {
    for (const ws of this.ctx.getWebSockets(playerId)) {
      const att = attachmentOf(ws);
      ws.serializeAttachment({ ...att, seat });
    }
  }

  private seatStatus(state: unknown, seat: number, playerId: string, name: string): SeatEvent {
    const s = this.snap(state).seats.find((x) => x.seat === seat);
    const reason = s?.status === 'sitting-out' ? this.players[playerId]?.sitOutReason : undefined;
    // The wire says a seat is playing or sitting out and knows no third answer. A game may have one
    // — poker's `waiting` is a seat dealt in from the next hand — and to a client that is a seat
    // that is not sitting out, which is what `active` means to them.
    const status = s ? (s.status === 'sitting-out' ? ('sitting-out' as const) : ('active' as const)) : undefined;
    return { type: 'seat-status', seat, playerId, name, stack: s?.stack, status, ...(reason ? { sitOutReason: reason } : {}) };
  }

  /**
   * Settle a buy-in, or promise to.
   *
   * Play money settles inline because there is nothing to settle: the receipt is local and instant,
   * and this path must stay byte-for-byte what it was. A settled table writes a PENDING ledger row
   * and hands the movement to the outbox, so a slow chain — or a chain that is down — delays a
   * receipt and never a hand. `authorizeBuyIn` has already refused anything that cannot pay, so a
   * seat credited here is a seat whose money exists.
   */
  private async settleBuyInOrQueue(args: {
    tableId: string;
    seat: number;
    playerId: string;
    playerAddress?: string;
    chips: number;
    orderId: string;
    kind: 'buy-in' | 'add-chips';
    handNo: number | null;
    at: number;
  }): Promise<SettlementReceipt> {
    const req = {
      tableId: args.tableId,
      seat: args.seat,
      playerId: args.playerId,
      chips: args.chips,
      orderId: args.orderId,
      ...(args.playerAddress ? { playerAddress: args.playerAddress } : {}),
    };
    if (!this.settles) {
      const receipt = await this.settlement().settleBuyIn(req);
      this.writeLedger({ seat: args.seat, playerId: args.playerId, kind: args.kind, chips: args.chips, handNo: args.handNo, at: args.at, receipt });
      return receipt;
    }

    const ledgerId = crypto.randomUUID();
    const receipt = this.pending(args.orderId, args.chips, args.at);
    this.writeLedger({ id: ledgerId, seat: args.seat, playerId: args.playerId, kind: args.kind, chips: args.chips, handNo: args.handNo, at: args.at, receipt });
    const payload: BuyInPayload = {
      ledgerId,
      tableId: args.tableId,
      seat: args.seat,
      playerId: args.playerId,
      chips: args.chips,
      orderId: args.orderId,
      ...(args.playerAddress ? { playerAddress: args.playerAddress } : {}),
    };
    this.ctx.storage.sql.exec(
      'INSERT INTO outbox (id, kind, payload_json, attempts, next_at, done_at) VALUES (?, ?, ?, 0, ?, NULL)',
      crypto.randomUUID(),
      'settleBuyIn',
      JSON.stringify(payload),
      args.at,
    );
    return receipt;
  }

  /** The "we owe this, it has not moved yet" receipt, in the units the adapter settles in. */
  private pending(orderId: string, chips: number, at: number): SettlementReceipt {
    const adapter = this.settlement();
    return pendingReceipt({
      mode: adapter.mode,
      orderId,
      amount: (BigInt(chips) * adapter.chipValue).toString(),
      asset: adapter.asset,
      at,
    });
  }

  private writeLedger(e: { id?: string; seat: number; playerId: string; kind: string; chips: number; handNo: number | null; at: number; receipt?: SettlementReceipt }): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO ledger (id, seat, player_id, kind, chips, hand_no, at, receipt_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      e.id ?? crypto.randomUUID(),
      e.seat,
      e.playerId,
      e.kind,
      e.chips,
      e.handNo,
      e.at,
      e.receipt ? JSON.stringify(e.receipt) : null,
    );
  }

  /**
   * The money rows for one player at this table: what was bought in, what was cashed out, and where
   * each movement has got to. The Worker gates this on the caller BEING that player — a settlement
   * state is nobody else's business, and a `playerId` is not a credential.
   *
   * ONLY the kinds that move an asset ({@link SETTLING_KINDS}). A `hand-result` row is a chip
   * movement inside this table's own ledger and never settles on chain — it has no receipt and never
   * will. Returning them made a working table grow a list of "Hand of 1 chips — not settled" rows,
   * which reads as money stuck in limbo when nothing is stuck at all. Hand results are table
   * history; they belong in the hand log, not in a settlement view.
   */
  private ledgerFor(playerId: string | null): {
    tableId: string;
    settlement: SettlementMode;
    chipValue: string | null;
    asset: string | null;
    assetSymbol: string | null;
    treasury: string | null;
    entries: Array<{ id: string; seat: number; kind: string; chips: number; handNo: number | null; at: number; receipt: SettlementReceipt | null }>;
  } {
    const meta = this.meta as TableMeta;
    const rate = meta.chipValue ?? null;
    const asset = meta.asset ?? null;
    const assetSymbol = meta.assetSymbol ?? null;
    const base = {
      tableId: meta.tableId,
      settlement: meta.settlement,
      chipValue: rate,
      asset,
      assetSymbol,
      treasury: null as string | null,
      entries: [] as never[],
    };
    if (!playerId) return base;
    const rows = this.ctx.storage.sql
      .exec<{ id: string; seat: number; kind: string; chips: number; hand_no: number | null; at: number; receipt_json: string | null }>(
        `SELECT id, seat, kind, chips, hand_no, at, receipt_json FROM ledger WHERE player_id = ? AND kind IN (${SETTLING_KINDS.map(() => '?').join(', ')}) ORDER BY at DESC, rowid DESC LIMIT 50`,
        playerId,
        ...SETTLING_KINDS,
      )
      .toArray();
    return {
      tableId: meta.tableId,
      settlement: meta.settlement,
      chipValue: rate,
      asset,
      assetSymbol,
      treasury: this.players[playerId]?.treasury ?? null,
      entries: rows.map((r) => ({
        id: r.id,
        seat: r.seat,
        kind: r.kind,
        chips: r.chips,
        handNo: r.hand_no,
        at: r.at,
        receipt: r.receipt_json ? (JSON.parse(r.receipt_json) as SettlementReceipt) : null,
      })),
    };
  }

  /** Cheap digest of the hand history a cash-out settles against (phase 3 binds this on-chain). */
  private historyDigest(): string {
    const row = this.ctx.storage.sql
      .exec<{ n: number; last: number | null }>('SELECT COUNT(*) AS n, MAX(hand_no) AS last FROM hands WHERE ended_at IS NOT NULL')
      .toArray()[0];
    return `hands:${row?.n ?? 0}:last:${row?.last ?? 0}`;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/* ------------------------------------------------------------ module utils */

/** `WebSocket.READY_STATE_OPEN`. Spelled out so the check reads the same in every runtime. */
const WS_OPEN = 1;

/** What {@link PokerTableDO.standUpSeat} tells its four callers about the seat it just emptied. */
interface StoodUp {
  seat: number;
  playerId: string;
  name: string;
  chips: number;
  settlement: SettlementMode;
  /** True when a real asset movement is queued and has not landed. Never true on play money. */
  pending: boolean;
}

/** A refusal from the operator clear route, naming which of its conditions failed. */
function refuse(which: SeatClearRefusal, error: string, status: number): Response {
  return json({ error, refused: which }, status);
}

/**
 * The ledger kinds that MOVE AN ASSET, and so are the only ones a settlement view can honestly
 * report on.
 *
 * `hand-result` and `rake` are chip movements inside this table's ledger: they are settled the
 * instant they are written, on chain they are nothing, and they carry no receipt because there is
 * no receipt to carry. A view that listed them showed every hand as "not settled", which named a
 * problem that does not exist.
 */
export const SETTLING_KINDS = ['buy-in', 'add-chips', 'cash-out'] as const satisfies readonly LedgerEntryKind[];

function nextIdx(sql: SqlStorage, table: 'events' | 'actions', handNo: number): number {
  const row = sql.exec<{ n: number | null }>(`SELECT MAX(idx) AS n FROM ${table} WHERE hand_no = ?`, handNo).toArray()[0];
  return row && row.n !== null ? row.n + 1 : 0;
}

/**
 * A round's observation with the host's names on its subjects. The game counts by player id — the only
 * identity it has — and the host is the one that knows what to call them; a label is added and nothing
 * else is touched, so an observation with no subjects goes through as it came.
 */
export function labelled(observation: unknown, nameOf: (playerId: string) => string | null): unknown {
  if (!observation || typeof observation !== 'object') return observation;
  const subjects = (observation as { subjects?: Record<string, unknown> }).subjects;
  if (!subjects || typeof subjects !== 'object') return observation;
  const out: Record<string, unknown> = {};
  for (const [id, s] of Object.entries(subjects)) {
    const name = nameOf(id);
    out[id] = s && typeof s === 'object' && name ? { ...(s as Record<string, unknown>), label: name } : s;
  }
  return { ...(observation as Record<string, unknown>), subjects: out };
}

/** Synthetic playerId for an agent seat: agents never hold a session token. */
export function agentPlayerId(agentName: string): string {
  return `agent:${agentName.trim().toLowerCase()}`;
}

/** Pre-phase-2 tables stored only `names`; everyone in them was a human on a WebSocket. */
function migratePlayers(names: Record<string, string>): Record<string, SeatRecord> {
  const out: Record<string, SeatRecord> = {};
  for (const [playerId, name] of Object.entries(names)) {
    out[playerId] = { playerId, name, kind: 'human', transport: 'ws' };
  }
  return out;
}

/**
 * Stamp the rate a table that predates the pin has been settling at onto it, or `null` when there
 * is nothing to do.
 *
 * The value written is `LEGACY_CHIP_VALUE` — deliberately NOT today's `CHIP_VALUE`, because the
 * deploy that brings pinning is the same deploy that raises the default, and stamping the new rate
 * onto an old table would re-value the stacks already sitting on it: the exact overpay pinning
 * exists to prevent, arriving through the fix. Pure, and exported for the tests that prove both
 * halves.
 */
export function migrateChipValue(meta: TableMeta | null, env: Env): TableMeta | null {
  if (!meta || meta.chipValue) return null;
  const rate = unstampedChipValue(env);
  return rate === null ? null : { ...meta, chipValue: rate.toString() };
}

/**
 * Re-check an agent's reply against the legal set the CURRENT state offers. `applyAction` would also
 * refuse, but this keeps "why it was dropped" precise in `agent_calls` instead of an engine code.
 */
function isLegalAction(legal: LegalActions, action: Action): boolean {
  switch (action.type) {
    case 'fold':
      return legal.fold;
    case 'check':
      return legal.check;
    case 'call':
      return legal.call !== null;
    case 'bet':
      return legal.bet !== null && action.amount >= legal.bet.min && action.amount <= legal.bet.max;
    case 'raise':
      return legal.raise !== null && action.amount >= legal.raise.min && action.amount <= legal.raise.max;
    case 'all-in':
      return legal.allIn > 0;
    default:
      return false;
  }
}

function seatMap(snap: TableSnapshot): Map<number, string> {
  return new Map(snap.seats.map((s) => [s.seat, s.playerId]));
}

function attachmentOf(ws: WebSocket): Attachment {
  const a = ws.deserializeAttachment() as Attachment | null;
  return a ?? { playerId: null, name: null, seat: null };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket already gone; hibernation API drops it */
  }
}

/**
 * A RULES REFUSAL from whichever game this table hosts, told apart from a genuine fault.
 *
 * This used to be `e instanceof EngineError`, which is POKER's error class — so every refusal
 * canasta made came back as `bad-command`. The message was right and the code said the client had
 * sent nonsense, which is the opposite of what happened: the client sent exactly the right thing
 * and the RULES said no. A player trying to take the fourth seat at a table between rounds was
 * told their software was broken.
 *
 * Recognised structurally rather than by class, because the host must not import either engine's
 * error type — and a game that arrives tomorrow will have its own. The contract both engines
 * already keep is the one checked here: an Error carrying a short, stable, lower-case `code`.
 */
function ruleRefusal(e: unknown): { code: string; message: string } | null {
  if (!(e instanceof Error)) return null;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(code)) return null;
  return { code, message: e.message };
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: 'error', code, message });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export type { TableView };
