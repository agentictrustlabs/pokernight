/**
 * PokerTableDO — one Durable Object per table.
 *
 * Storage layout
 *   KV  `meta`          TableMeta (tableId, name, settlement, createdAt)
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
import { failedReceipt, pendingReceipt, type SettlementAdapter, type SettlementReceipt } from '@pokernight/ledger';
import type { PlayerFunding } from '@pokernight/treasury';
import {
  parseClientCommand,
  type ChatEvent,
  type ClientCommand,
  type PlayerInfo,
  type PokerActInput,
  type PokerActOutput,
  type SeatEvent,
  type ServerMessage,
  type SettlementMode,
  type TableEvent,
  type TableSummary,
} from '@pokernight/protocol';
import { a2aTimeoutMs, callPokerAct, resolveAgentBase } from './a2a.js';
import { readSessionRecord } from './auth.js';
import type { Env } from './env.js';
import { createSettlementAdapter } from './settlement.js';

/* ------------------------------------------------------------------ types */

export interface TableMeta {
  tableId: string;
  name: string;
  settlement: SettlementMode;
  createdAt: number;
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
    const meta: TableMeta = { tableId: body.tableId, name: body.name, settlement: body.settlement, createdAt: body.createdAt ?? Date.now() };
    // Adapter must exist for this mode before we accept the table — a table that cannot settle must
    // fail here, not at someone's cash-out. Built with the same funding resolver `settlement()` uses,
    // so the instance cached by this call behaves identically to one built later.
    try {
      this.adapter = createSettlementAdapter(meta.settlement, this.env, (req) => this.playerFunding(req.playerId));
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

  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void reason;
    void wasClean;
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
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
        const current = state.hand?.handNo ?? null;
        if (current === null || cmd.handNo !== current) return sendError(ws, 'stale-hand', `hand ${cmd.handNo} is not the current hand`);
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

  /** Shared stand-up: engine standUp, cash-out ledger row, settlement outbox op, `seat-left`. */
  private async standUpSeat(seat: number, playerId: string, name: string, seatsBefore: Map<number, string>, now: number): Promise<void> {
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
    const ev: SeatEvent = { type: 'seat-left', seat, playerId, name, stack: cashOut };
    await this.commit(next, events, [ev], seatsBefore);
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
      out[id] = info;
    }
    return out;
  }

  private async putPlayer(record: SeatRecord): Promise<void> {
    this.players[record.playerId] = record;
    this.names[record.playerId] = record.name;
    await this.ctx.storage.put({ names: this.names, players: this.players });
  }

  private settlement(): SettlementAdapter {
    if (!this.adapter) {
      this.adapter = createSettlementAdapter((this.meta as TableMeta).settlement, this.env, (req) => this.playerFunding(req.playerId));
    }
    return this.adapter;
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
    if (rec?.buyInMandate) funding.mandate = rec.buyInMandate as PlayerFunding['mandate'];
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
    return { type: 'seat-status', seat, playerId, name, stack: s?.stack, status: s?.status };
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
   */
  private ledgerFor(playerId: string | null): {
    tableId: string;
    settlement: SettlementMode;
    treasury: string | null;
    entries: Array<{ id: string; seat: number; kind: string; chips: number; handNo: number | null; at: number; receipt: SettlementReceipt | null }>;
  } {
    const meta = this.meta as TableMeta;
    const base = { tableId: meta.tableId, settlement: meta.settlement, treasury: null as string | null, entries: [] as never[] };
    if (!playerId) return base;
    const rows = this.ctx.storage.sql
      .exec<{ id: string; seat: number; kind: string; chips: number; hand_no: number | null; at: number; receipt_json: string | null }>(
        'SELECT id, seat, kind, chips, hand_no, at, receipt_json FROM ledger WHERE player_id = ? ORDER BY at DESC, rowid DESC LIMIT 50',
        playerId,
      )
      .toArray();
    return {
      tableId: meta.tableId,
      settlement: meta.settlement,
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
