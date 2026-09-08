/**
 * PokerTableDO — one Durable Object per table.
 *
 * Storage layout
 *   KV  `meta`          TableMeta (tableId, name, settlement, createdAt)
 *   KV  `state`         engine TableState (authoritative; includes deck + hole cards, never sent raw)
 *   KV  `names`         Record<playerId, display name>
 *   KV  `seed`          hex seed of the running hand; deleted on hand-ended (never sent while a hand runs)
 *   KV  `next-hand-at`  absolute ms when the next hand should start (auto-start / inter-hand delay)
 *   SQL `hands`         one row per hand: commit at start, reveal + result at end
 *   SQL `actions`       append-only action log per hand (replay = seed + this log)
 *   SQL `events`        every engine event per hand (unredacted; served only after the hand ends)
 *   SQL `ledger`        buy-in / add-chips / cash-out / hand-result rows (chips, signed for the player)
 *   SQL `outbox`        settlement ops drained by the alarm with backoff
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
  type TableConfig,
  type TableState,
  type TableView,
} from '@pokernight/engine';
import type { SettlementAdapter, SettlementReceipt } from '@pokernight/ledger';
import {
  parseClientCommand,
  type ChatEvent,
  type ClientCommand,
  type SeatEvent,
  type ServerMessage,
  type SettlementMode,
  type TableEvent,
  type TableSummary,
} from '@pokernight/protocol';
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
  chips: number;
  historyDigest: string;
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
`;

const HAND_START_DELAY_MS = 1500;
const NEXT_HAND_DELAY_MS = 3000;
const OUTBOX_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000] as const;
const MAX_TIMEOUTS_BEFORE_SIT_OUT = 2;

/* --------------------------------------------------------------------- DO */

export class PokerTableDO extends DurableObject<Env> {
  private meta: TableMeta | null = null;
  private state: TableState | null = null;
  private names: Record<string, string> = {};
  private adapter: SettlementAdapter | null = null;
  /** Serializes command/alarm processing so engine transitions never interleave across awaits. */
  private chain: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SCHEMA);
      const kv = await ctx.storage.get<unknown>(['meta', 'state', 'names']);
      this.meta = (kv.get('meta') as TableMeta | undefined) ?? null;
      this.state = (kv.get('state') as TableState | undefined) ?? null;
      this.names = (kv.get('names') as Record<string, string> | undefined) ?? {};
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
      return json({ tableId: this.meta.tableId, name: this.meta.name, settlement: this.meta.settlement, view: viewFor(this.state, null), names: this.names });
    }
    if (request.method === 'GET' && path === '/summary') {
      return json(this.summary());
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
    // Adapter must exist for this mode before we accept the table.
    try {
      this.adapter = createSettlementAdapter(meta.settlement, this.env);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    await this.ctx.storage.put({ meta, state, names: {} });
    this.meta = meta;
    this.state = state;
    this.names = {};
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
        const auth = await this.settlement().authorizeBuyIn({ tableId: meta.tableId, seat: cmd.seat, playerId, chips: cmd.buyIn, orderId });
        if (!auth.ok) return sendError(ws, 'settlement-failed', auth.reason);
        const next = sitDown(state, cmd.seat, playerId, cmd.buyIn);
        // Play-money settles inline; on-chain modes (phase 3) will enqueue settleBuyIn to the outbox
        // and credit the seat on receipt instead.
        const receipt = await this.settlement().settleBuyIn({ tableId: meta.tableId, seat: cmd.seat, playerId, chips: cmd.buyIn, orderId });
        this.writeLedger({ seat: cmd.seat, playerId, kind: 'buy-in', chips: cmd.buyIn, handNo: null, at: now, receipt });
        this.names[playerId] = name;
        await this.ctx.storage.put('names', this.names);
        this.setAttachmentSeat(playerId, cmd.seat);
        const stack = next.seats.find((s) => s.seat === cmd.seat)?.stack ?? cmd.buyIn;
        const ev: SeatEvent = { type: 'seat-joined', seat: cmd.seat, playerId, name, stack, status: 'active' };
        await this.commit(next, [], [ev], seatsBefore);
        return;
      }
      case 'leave': {
        const seat = this.seatOf(playerId);
        if (seat === null) throw new EngineError('not-seated', 'you are not seated');
        const { state: next, cashOut, events } = standUp(state, seat);
        const ledgerId = crypto.randomUUID();
        this.writeLedger({ id: ledgerId, seat, playerId, kind: 'cash-out', chips: -cashOut, handNo: state.hand?.handNo ?? null, at: now });
        const payload: CashOutPayload = {
          ledgerId,
          tableId: meta.tableId,
          seat,
          playerId,
          chips: cashOut,
          historyDigest: this.historyDigest(),
          orderId: `${meta.tableId}:${playerId}:${seat}:out:${now}`,
        };
        this.ctx.storage.sql.exec(
          'INSERT INTO outbox (id, kind, payload_json, attempts, next_at, done_at) VALUES (?, ?, ?, 0, ?, NULL)',
          crypto.randomUUID(),
          'settleCashOut',
          JSON.stringify(payload),
          now,
        );
        this.setAttachmentSeat(playerId, null);
        const ev: SeatEvent = { type: 'seat-left', seat, playerId, name, stack: cashOut };
        await this.commit(next, events, [ev], seatsBefore);
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
        const auth = await this.settlement().authorizeBuyIn({ tableId: meta.tableId, seat, playerId, chips: cmd.amount, orderId });
        if (!auth.ok) return sendError(ws, 'settlement-failed', auth.reason);
        const next = addChips(state, seat, cmd.amount);
        const receipt = await this.settlement().settleBuyIn({ tableId: meta.tableId, seat, playerId, chips: cmd.amount, orderId });
        this.writeLedger({ seat, playerId, kind: 'add-chips', chips: cmd.amount, handNo: state.hand?.handNo ?? null, at: now, receipt });
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
        const backoff = OUTBOX_BACKOFF_MS[Math.min(attempts, OUTBOX_BACKOFF_MS.length) - 1] ?? 120_000;
        console.warn(`outbox ${row.kind} ${row.id} failed (attempt ${attempts})`, e);
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
        });
        this.ctx.storage.sql.exec('UPDATE ledger SET receipt_json = ? WHERE id = ?', JSON.stringify(receipt), p.ledgerId);
        return;
      }
      default:
        throw new Error(`unknown outbox kind ${row.kind}`);
    }
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
    const transport = this.transportFor(seat);
    if (transport === 'a2a') {
      // TODO(phase 2): resolve the seat's A2A target and send `poker.act`
      // { tableId, handNo, seat, view: viewFor(state, seat), legal, deadlineMs } as the house; apply the
      // reply if it arrives before the alarm, else the alarm applies the default action.
      return;
    }
    const legal = legalActions(state, seat);
    const msg: ServerMessage = { type: 'turn', handNo: hand.handNo, seat, legal, deadline };
    for (const ws of this.ctx.getWebSockets()) {
      if (this.viewerSeat(ws) === seat) send(ws, msg);
    }
  }

  /* -------------------------------------------------------------- helpers */

  private transportFor(seat: number): SeatTransport {
    void seat;
    return 'ws'; // phase 2: 'a2a' for seats occupied by service agents
  }

  private settlement(): SettlementAdapter {
    if (!this.adapter) this.adapter = createSettlementAdapter((this.meta as TableMeta).settlement, this.env);
    return this.adapter;
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
