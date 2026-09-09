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
  type TableState,
  type TableView,
} from '@pokernight/engine';
import { failedReceipt, pendingReceipt, type LedgerEntryKind, type SettlementAdapter, type SettlementReceipt } from '@pokernight/ledger';
import type { PlayerFunding } from '@pokernight/treasury';
import {
  parseClientCommand,
  type ChatEvent,
  type ClientCommand,
  type PlayerInfo,
  type PokerActInput,
  type PokerActOutput,
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
import { a2aTimeoutMs, callPokerAct, resolveAgentBase } from './a2a.js';
import { readSessionRecord } from './auth.js';
import { seatIdleMs } from './env.js';
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
  unstampedAsset,
  unstampedAssetSymbol,
  unstampedChipValue,
} from './treasury.js';

/* ------------------------------------------------------------------ types */

export interface TableMeta {
  tableId: string;
  name: string;
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
   * Stamped from the deployment default when the table is created and NEVER re-derived, for a
   * stronger version of the reason `chipValue` is. A rate that moved under an open table mispriced
   * the stacks on it. An ASSET that moved under an open table would take the buy-ins in one
   * currency and pay the cash-outs in another — a table that took MockUSDC and paid out Sheqel
   * would not have mispriced anything; it would have kept a different promise from the one it made.
   *
   * Optional only for a table created before this field existed: `migrateAsset` stamps `LEGACY_ASSET`
   * onto it the first time it loads, which is the currency it has been settling in all along —
   * deliberately not today's default, which is now the card room's own coin.
   */
  asset?: string;
  /** What {@link TableMeta.asset} calls itself (`USDC`, `SHQ`). A label for the address, stamped at
   *  the same instant and by the same rule, so a table can never name a coin it does not pay in. */
  assetSymbol?: string;
}

export interface InitRequest {
  tableId: string;
  name: string;
  config?: Partial<TableConfig>;
  settlement: SettlementMode;
  createdAt?: number;
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
  private state: TableState | null = null;
  private names: Record<string, string> = {};
  private players: Record<string, SeatRecord> = {};
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
      const kv = await ctx.storage.get<unknown>(['meta', 'state', 'names', 'players']);
      this.meta = (kv.get('meta') as TableMeta | undefined) ?? null;
      this.state = (kv.get('state') as TableState | undefined) ?? null;
      this.names = (kv.get('names') as Record<string, string> | undefined) ?? {};
      // Migration: a table created before phase 2 has `names` but no `players`. Everyone in it was a
      // human on a WebSocket, so the record is derivable; it is persisted on the next seat change.
      this.players = (kv.get('players') as Record<string, SeatRecord> | undefined) ?? migratePlayers(this.names);
      // Migration: a table created before the chip rate was pinned has been settling at
      // `LEGACY_CHIP_VALUE`, and one created before the ASSET was pinned has been settling in
      // `LEGACY_ASSET`. Write both on once, here, and the table is immune to either deployment
      // default moving from this moment on — including the moves that ship with those very changes.
      const migrated = migrateMeta(this.meta, env);
      if (migrated) {
        this.meta = migrated;
        await ctx.storage.put('meta', migrated);
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
        settlement: this.meta.settlement,
        ...(this.meta.chipValue ? { chipValue: this.meta.chipValue } : {}),
        ...(this.meta.asset ? { asset: this.meta.asset } : {}),
        ...(this.meta.assetSymbol ? { assetSymbol: this.meta.assetSymbol } : {}),
        view: viewFor(this.state, null),
        names: this.names,
        players: this.publicPlayers(),
      });
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

  private async init(body: InitRequest): Promise<Response> {
    if (this.meta && this.state) return json(this.summary());
    const config = body.config ?? {};
    let state: TableState;
    try {
      state = createTable(config);
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
    };
    // Adapter must exist for this mode before we accept the table — a table that cannot settle must
    // fail here, not at someone's cash-out. Built with the same funding resolver `settlement()` uses,
    // so the instance cached by this call behaves identically to one built later.
    try {
      this.adapter = createSettlementAdapter(meta.settlement, this.env, {
        ...(rate === null ? {} : { chipValue: rate }),
        ...(asset === null ? {} : { asset }),
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

  private summary(): TableSummary {
    const meta = this.meta as TableMeta;
    const state = this.state as TableState;
    return {
      tableId: meta.tableId,
      name: meta.name,
      config: state.config,
      settlement: meta.settlement,
      seated: state.seats.length,
      handNo: state.handNo,
      createdAt: meta.createdAt,
      // Said out loud so a client can convert chips to money instead of guessing at a rate — and
      // NAME that money, instead of assuming every table on the estate settles in the same coin.
      ...(meta.chipValue ? { chipValue: meta.chipValue } : {}),
      ...(meta.asset ? { asset: meta.asset } : {}),
      ...(meta.assetSymbol ? { assetSymbol: meta.assetSymbol } : {}),
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
    // Reconnecting is activity, and it counts even though it deliberately does NOT sit the player
    // back in: choosing to be dealt in again is theirs to do, but a seat whose owner is at the
    // keyboard is not an abandoned seat and must stop looking like one to the operator route.
    if (playerId) void this.touchSeat(playerId);
    this.ctx.acceptWebSocket(server, playerId ? [playerId] : []);
    server.serializeAttachment(attachment);
    const state = this.state as TableState;
    const welcome: ServerMessage = {
      type: 'welcome',
      tableId: (this.meta as TableMeta).tableId,
      playerId,
      view: viewFor(state, attachment.seat),
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
        if (e instanceof EngineError) return sendError(ws, e.code, e.message);
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
   * standing up, and a disconnect that moved somebody's USDC would be a far worse bug than the one
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
    const occupant = state.seats.find((x) => x.seat === seat);
    if (!occupant || occupant.status !== 'active') return; // already sitting out; nothing to say
    const seatsBefore = seatMap(state);
    const next = sitOut(state, seat);
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
    const state = this.state as TableState;
    const meta = this.meta as TableMeta;
    const seatsBefore = seatMap(state);
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
        const next = sitDown(state, cmd.seat, playerId, cmd.buyIn);
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
        const stack = next.seats.find((s) => s.seat === cmd.seat)?.stack ?? cmd.buyIn;
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
        const next = cmd.type === 'sit-out' ? sitOut(state, seat) : sitIn(state, seat);
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
        const next = addChips(state, seat, cmd.amount);
        await this.settleBuyInOrQueue({
          tableId: meta.tableId,
          seat,
          playerId,
          chips: cmd.amount,
          orderId,
          kind: 'add-chips',
          handNo: state.hand?.handNo ?? null,
          at: now,
          ...(treasury ? { playerAddress: treasury } : {}),
        });
        await this.commit(next, [], [this.seatStatus(next, seat, playerId, name)], seatsBefore);
        return;
      }
      case 'act': {
        const seat = this.seatOf(playerId);
        if (seat === null) throw new EngineError('not-seated', 'you are not seated');
        // Two different situations that used to share one message. "Not the current hand" sent a
        // player looking for a hand that had moved on; when there is no hand at all — the table is
        // short of players, or between deals — the true answer is that there is nothing to act in.
        const hand = state.hand;
        const running = hand !== null && hand.result === undefined;
        if (!running) return sendError(ws, 'no-hand', 'no hand is running at this table right now');
        if (cmd.handNo !== hand.handNo) return sendError(ws, 'stale-hand', `hand ${cmd.handNo} is not the current hand`);
        const { state: next, events } = applyAction(state, seat, cmd.action as Action);
        await this.commit(next, events, [], seatsBefore);
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
    const state = this.state as TableState;
    const meta = this.meta as TableMeta;
    const agentName = body.agentName.trim();
    if (!agentName) return json({ error: 'agentName is required' }, 400);
    const playerId = agentPlayerId(agentName);
    const name = (body.displayName ?? agentName).slice(0, 32);
    const seatsBefore = seatMap(state);
    const now = Date.now();
    const orderId = `${meta.tableId}:${playerId}:${body.seat}:${now}`;

    let next: TableState;
    try {
      next = sitDown(state, body.seat, playerId, body.buyIn);
    } catch (e) {
      if (e instanceof EngineError) return json({ error: e.message, code: e.code }, 409);
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
    const stack = next.seats.find((s) => s.seat === body.seat)?.stack ?? body.buyIn;
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
    const state = this.state as TableState;
    const occupant = state.seats.find((s) => s.seat === seat);
    if (!occupant) return json({ error: `seat ${seat} is empty`, code: 'not-seated' }, 404);
    const record = this.players[occupant.playerId];
    if (record?.transport !== 'a2a') return json({ error: `seat ${seat} is not an agent seat`, code: 'not-an-agent' }, 400);
    await this.standUpSeat(seat, occupant.playerId, record.name, seatMap(state), Date.now());
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
    const state = this.state as TableState;
    const meta = this.meta as TableMeta;
    const { state: next, cashOut, events } = standUp(state, seat);
    const ledgerId = crypto.randomUUID();
    const orderId = `${meta.tableId}:${playerId}:${seat}:out:${now}`;
    this.writeLedger({
      id: ledgerId,
      seat,
      playerId,
      kind: 'cash-out',
      chips: -cashOut,
      handNo: state.hand?.handNo ?? null,
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
    await this.commit(next, events, [ev], seatsBefore);
    // `pending` is the honest half of the answer: on a settled table the USDC has NOT moved yet — the
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
    const state = this.state as TableState;
    const meta = this.meta as TableMeta;
    const seat = this.seatOf(playerId);
    if (seat === null) return json({ seated: false, tableId: meta.tableId });
    const name = this.players[playerId]?.name ?? this.names[playerId] ?? playerId;
    const out = await this.standUpSeat(seat, playerId, name, seatMap(state), Date.now());
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
  private async clearSeat(seat: number): Promise<Response> {
    const state = this.state as TableState;
    const meta = this.meta as TableMeta;
    const now = Date.now();

    const occupant = state.seats.find((s) => s.seat === seat);
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
    const hand = state.hand;
    if (hand && hand.result === undefined && hand.seats.some((h) => h.seat === seat)) {
      return refuse('in-hand', `seat ${seat + 1} (${name}) is in hand #${hand.handNo}, which is still running — the turn clock owns that seat until the hand ends`, 409);
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

    const out = await this.standUpSeat(seat, playerId, name, seatMap(state), now);
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
   * Fire the `poker.act` call for an agent seat. Detached on purpose: the serial queue stays free so
   * WebSocket commands and — crucially — the turn-clock alarm can run while the agent thinks.
   * `ctx.waitUntil` asks the runtime to keep the DO alive for it; if the DO is evicted anyway, the
   * persisted alarm still fires at the deadline and applies the default action.
   */
  private startAgentTurn(state: TableState, handNo: number, seat: number, deadline: number, record: SeatRecord): void {
    const key = `${handNo}:${seat}:${deadline}`;
    if (this.inFlightTurns.has(key)) return; // a re-announced turn must not call the agent twice
    this.inFlightTurns.add(key);
    const input: PokerActInput = {
      tableId: (this.meta as TableMeta).tableId,
      handNo,
      seat,
      view: viewFor(state, seat),
      legal: legalActions(state, seat),
      deadlineMs: Math.max(500, deadline - Date.now() - AGENT_DEADLINE_HEADROOM_MS),
    };
    const done = this.runAgentTurn(key, record, input, deadline).catch((e) => {
      this.inFlightTurns.delete(key);
      console.error('agent turn crashed', key, e);
    });
    try {
      this.ctx.waitUntil(done);
    } catch {
      /* waitUntil is unavailable in some test runtimes; the promise still runs */
    }
  }

  private async runAgentTurn(key: string, record: SeatRecord, input: PokerActInput, deadline: number): Promise<void> {
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
      result = await callPokerAct(base, input, budget);
    } finally {
      this.inFlightTurns.delete(key);
    }
    if (!result.ok) {
      // Nothing to apply: the turn clock alarm owns the default, and two of these in a row sit the
      // seat out through the same MAX_TIMEOUTS_BEFORE_SIT_OUT path a silent human hits.
      console.warn(`agent seat ${input.seat} hand ${input.handNo}: ${result.error}`);
      this.finishAgentCall(input, requestedAt, false, null, result.error);
      return;
    }
    const output = result.output;
    await this.serial(() => this.applyAgentAction(record, input, output, requestedAt));
  }

  /** Re-validate against the CURRENT state before applying: the world moved while the agent thought. */
  private async applyAgentAction(record: SeatRecord, input: PokerActInput, output: PokerActOutput, requestedAt: number): Promise<void> {
    const drop = (why: string): void => {
      console.warn(`dropping agent action for seat ${input.seat} hand ${input.handNo}: ${why}`);
      this.finishAgentCall(input, requestedAt, false, output, why);
    };
    const state = this.state;
    if (!state) return drop('table not initialized');
    const hand = state.hand;
    if (!hand || hand.result !== undefined || hand.handNo !== input.handNo) return drop(`hand ${input.handNo} is no longer running`);
    if (hand.toAct !== input.seat) return drop(`seat ${input.seat} is no longer to act`);
    const occupant = state.seats.find((s) => s.seat === input.seat);
    if (!occupant || occupant.playerId !== record.playerId) return drop(`seat ${input.seat} changed hands`);
    if (!isLegalAction(legalActions(state, input.seat), output.action)) return drop(`illegal action ${JSON.stringify(output.action)}`);

    const seatsBefore = seatMap(state);
    let applied: { state: TableState; events: EngineEvent[] };
    try {
      applied = applyAction(state, input.seat, output.action);
    } catch (e) {
      return drop(e instanceof EngineError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
    }
    this.finishAgentCall(input, requestedAt, true, output, null);
    await this.commit(applied.state, applied.events, [], seatsBefore);
  }

  private finishAgentCall(input: PokerActInput, requestedAt: number, ok: boolean, output: PokerActOutput | null, error: string | null): void {
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
      const state = this.state;
      if (state) {
        const seatsBefore = seatMap(state);
        const hand = state.hand;
        // A finished hand stays on the state (with `result`) until the next startHand replaces it.
        const running = hand !== null && hand.result === undefined;
        if (hand && running && hand.toAct !== null && hand.actionDeadline !== null && now >= hand.actionDeadline) {
          const seat = hand.toAct;
          const r = timeoutAction(state, seat);
          let next = r.state;
          const extra: TableEvent[] = [];
          const s = next.seats.find((x) => x.seat === seat);
          if (s && s.status === 'active' && s.timeouts >= MAX_TIMEOUTS_BEFORE_SIT_OUT) {
            try {
              next = sitOut(next, seat);
              await this.noteSitOut(s.playerId, 'timeouts');
              extra.push(this.seatStatus(next, seat, s.playerId, this.names[s.playerId] ?? s.playerId));
            } catch (e) {
              console.warn('sit-out after timeouts failed', e);
            }
          }
          await this.commit(next, r.events, extra, seatsBefore);
        } else if (!running) {
          const nextAt = await this.ctx.storage.get<number>('next-hand-at');
          if (nextAt !== undefined && now >= nextAt) {
            await this.ctx.storage.delete('next-hand-at');
            if (canStartHand(state)) await this.startNewHand(state, seatsBefore);
          }
        }
      }
      await this.drainOutbox(now);
      await this.scheduleAlarm();
    });
  }

  private async startNewHand(state: TableState, seatsBefore: Map<number, string>): Promise<void> {
    const seed = randomSeed();
    const { state: next, events } = startHand(state, seed);
    // The seed stays in KV (never sent) until hand-ended writes it to `hands.seed_reveal`.
    await this.ctx.storage.put('seed', bytesToHex(seed));
    await this.commit(next, events, [], seatsBefore);
  }

  /** Sets the single DO alarm to the earliest pending deadline (turn clock, hand start, outbox retry). */
  private async scheduleAlarm(): Promise<void> {
    const candidates: number[] = [];
    const deadline = this.state?.hand?.actionDeadline;
    if (typeof deadline === 'number' && this.state?.hand?.toAct !== null) candidates.push(deadline);
    const nextHandAt = await this.ctx.storage.get<number>('next-hand-at');
    if (nextHandAt !== undefined) candidates.push(nextHandAt);
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
  private async commit(next: TableState, engineEvents: EngineEvent[], tableEvents: TableEvent[], seatsBefore: Map<number, string>): Promise<void> {
    const now = Date.now();
    let state = next;
    if (state.hand && state.hand.toAct !== null && engineEvents.some((e) => e.type === 'turn')) {
      state = setActionDeadline(state, now + state.config.actionTimeoutMs);
    }
    const handNo = state.hand?.handNo ?? state.handNo;
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
          for (const [seatStr, chips] of Object.entries(ev.result.net)) {
            const seat = Number(seatStr);
            const playerId = seatsBefore.get(seat) ?? state.seats.find((s) => s.seat === seat)?.playerId ?? 'unknown';
            this.writeLedger({ seat, playerId, kind: 'hand-result', chips, handNo: ev.handNo, at: now });
          }
          if (ev.result.rake > 0) this.writeLedger({ seat: -1, playerId: 'house', kind: 'rake', chips: ev.result.rake, handNo: ev.handNo, at: now });
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
      await this.ctx.storage.put('next-hand-at', now + NEXT_HAND_DELAY_MS);
    } else if (
      (!state.hand || state.hand.result !== undefined) &&
      (await this.ctx.storage.get<number>('next-hand-at')) === undefined &&
      canStartHand(state)
    ) {
      await this.ctx.storage.put('next-hand-at', now + HAND_START_DELAY_MS);
    }

    // Fan out.
    this.broadcastTableEvents(state, tableEvents);
    this.broadcastEngineEvents(state, engineEvents);
    if (state.hand && state.hand.toAct !== null && state.hand.actionDeadline !== null) {
      this.notifyTurn(state, state.hand.toAct, state.hand.actionDeadline);
    }
    await this.scheduleAlarm();
  }

  private broadcastTableEvents(state: TableState, events: TableEvent[]): void {
    if (events.length === 0) return;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.viewerSeat(ws);
      const view = viewFor(state, seat);
      for (const event of events) send(ws, { type: 'event', event, view });
    }
  }

  private broadcastEngineEvents(state: TableState, events: EngineEvent[]): void {
    if (events.length === 0) return;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.viewerSeat(ws);
      const view = viewFor(state, seat);
      for (const ev of events) {
        const red = redactEvent(ev, seat);
        if (red) send(ws, { type: 'event', event: red, view });
      }
    }
  }

  private notifyTurn(state: TableState, seat: number, deadline: number): void {
    const hand = state.hand;
    if (!hand) return;
    const record = this.recordForSeat(state, seat);
    if (record?.transport === 'a2a') {
      // Out of band: the A2A call must never hold the serial queue, or the table would stall for the
      // whole agent budget and the turn-clock alarm could not preempt it.
      this.startAgentTurn(state, hand.handNo, seat, deadline, record);
      return;
    }
    const legal = legalActions(state, seat);
    const msg: ServerMessage = { type: 'turn', handNo: hand.handNo, seat, legal, deadline };
    for (const ws of this.ctx.getWebSockets()) {
      if (this.viewerSeat(ws) === seat) send(ws, msg);
    }
  }

  /* -------------------------------------------------------------- helpers */

  private recordForSeat(state: TableState | null, seat: number): SeatRecord | undefined {
    const playerId = state?.seats.find((s) => s.seat === seat)?.playerId;
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
      this.adapter = createSettlementAdapter((this.meta as TableMeta).settlement, this.env, {
        ...(rate === null ? {} : { chipValue: rate }),
        ...(asset === null ? {} : { asset }),
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
   * denominated in; `ASSET` is only ever consulted through the pin written at creation (or, for a
   * table older than the pin, written on first load).
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
    // …and a mandate authorises ONE CURRENCY to be spent. A mandate signed for MockUSDC says nothing
    // about the player's Sheqel, so carrying it to a Sheqel table would be reading a signature as
    // consent to something it never named. The adapter's on-chain check would refuse it anyway
    // (`checkBuyInMandate` compares the asset); refusing here means the refusal names the currency
    // instead of arriving as a mismatch deep inside a redemption.
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
    const s = this.state?.seats.find((x) => x.playerId === playerId);
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

  private seatStatus(state: TableState, seat: number, playerId: string, name: string): SeatEvent {
    const s = state.seats.find((x) => x.seat === seat);
    const reason = s?.status === 'sitting-out' ? this.players[playerId]?.sitOutReason : undefined;
    return { type: 'seat-status', seat, playerId, name, stack: s?.stack, status: s?.status, ...(reason ? { sitOutReason: reason } : {}) };
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
 * Stamp the CURRENCY a table that predates the pin has been settling in onto it, or `null` when
 * there is nothing to do.
 *
 * The value written is `LEGACY_ASSET` — deliberately NOT today's `ASSET`, for the same reason
 * {@link migrateChipValue} writes the legacy rate, only with more at stake. The deploy that brings
 * asset pinning is the deploy that points `ASSET` at the card room's own coin; stamping that onto a
 * table whose players bought in with MockUSDC would not re-price their stacks, it would change what
 * the table owes them into a different currency. Pure, and exported for the tests.
 */
export function migrateAsset(meta: TableMeta | null, env: Env): TableMeta | null {
  if (!meta || meta.asset) return null;
  const asset = unstampedAsset(env);
  if (asset === null) return null;
  const symbol = unstampedAssetSymbol(env);
  return { ...meta, asset, ...(symbol === null ? {} : { assetSymbol: symbol }) };
}

/**
 * Every first-load migration, composed: the rate, then the currency. One function so the DO writes
 * the record once and neither migration can be forgotten at the call site. `null` means the record
 * is already complete and nothing should be written.
 */
export function migrateMeta(meta: TableMeta | null, env: Env): TableMeta | null {
  const rated = migrateChipValue(meta, env);
  const assed = migrateAsset(rated ?? meta, env);
  return assed ?? rated;
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

function seatMap(state: TableState): Map<number, string> {
  return new Map(state.seats.map((s) => [s.seat, s.playerId]));
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

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: 'error', code, message });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export type { TableView };
