/**
 * WebSocket client for a PokerTableDO plus the pure state reducer that turns
 * `ServerMessage`s into what the table page renders.
 *
 * `reduce` is pure and fully tested in node; `TableSocket` wraps a browser
 * WebSocket with reconnect/backoff and is injectable for tests.
 */
import type { Card, ClientCommand, HandResult, LegalActions, PlayerInfo, ServerMessage, TableEvent, TableView } from './types';
import { DRAWN_GAME, drawsGame } from './games';

/* ------------------------------------------------------------------ state */

export interface TurnState {
  handNo: number;
  seat: number;
  legal: LegalActions;
  /** Absolute ms timestamp, or null when the server did not give one. */
  deadline: number | null;
}

export interface LastHand {
  handNo: number;
  seedCommit: string;
  seedReveal?: string;
  result?: HandResult;
  /** Board as it stood when the hand ended, so the winner moment survives `hand` going null. */
  board: Card[];
}

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TableState {
  tableId: string | null;
  /**
   * The game this table deals, from the socket's own first frame. Null until it arrives.
   *
   * Read it before reading `view`: this reducer keeps a view only for the game it draws, so on a
   * table dealing anything else `view` stays null forever and the page has this to say why.
   */
  game: string | null;
  /** The viewer's player id as the server sees it (null for anonymous spectators). */
  playerId: string | null;
  view: TableView | null;
  names: Record<string, string>;
  /** Who occupies each player id: human or agent, with the agent's name. */
  players: Record<string, PlayerInfo>;
  /** Latest events, oldest first, capped at LOG_LIMIT. */
  log: TableEvent[];
  /** Set while it is the viewer's turn. */
  turn: TurnState | null;
  error: { code: string; message: string } | null;
  /** Result of the most recent completed hand, kept until the next one starts. */
  lastHand: LastHand | null;
  connection: ConnectionStatus;
}

export const LOG_LIMIT = 50;

export const initialState: TableState = {
  tableId: null,
  game: null,
  playerId: null,
  view: null,
  names: {},
  players: {},
  log: [],
  turn: null,
  error: null,
  lastHand: null,
  connection: 'connecting',
};

/* ---------------------------------------------------------------- reducer */

function appendLog(log: TableEvent[], ev: TableEvent): TableEvent[] {
  const next = log.length >= LOG_LIMIT ? log.slice(log.length - LOG_LIMIT + 1) : log.slice();
  next.push(ev);
  return next;
}

/** Derive the viewer's turn from a full view (welcome / snapshot carry `legal`). */
function turnFromView(view: TableView): TurnState | null {
  if (!view.hand || view.viewerSeat == null || !view.legal) return null;
  if (view.hand.toAct !== view.viewerSeat) return null;
  return { handNo: view.hand.handNo, seat: view.viewerSeat, legal: view.legal, deadline: view.hand.actionDeadline };
}

/** Drop a pending turn once the view shows it has been consumed. */
function reconcileTurn(turn: TurnState | null, view: TableView): TurnState | null {
  if (!turn) return null;
  if (!view.hand) return null;
  if (view.hand.handNo !== turn.handNo) return null;
  if (view.hand.toAct !== turn.seat) return null;
  return turn;
}

function lastHandFromView(view: TableView, prev: LastHand | null): LastHand | null {
  const h = view.hand;
  if (h?.result) {
    return { handNo: h.handNo, seedCommit: h.seedCommit, seedReveal: h.seedReveal, result: h.result, board: h.board };
  }
  return prev;
}


/**
 * Seed the log from a view. Joining a table mid-session, the socket has no history, so the log
 * would read "Waiting for the first hand" while a hand is visibly in progress. The view carries
 * this hand's action records, so replay them as log lines to show what has already happened.
 */
export function seedLog(view: TableView): TableEvent[] {
  const hand = view.hand;
  if (!hand) return [];
  const seeded: TableEvent[] = [{ type: 'hand-started', handNo: hand.handNo, seedCommit: hand.seedCommit, button: view.button ?? 0, seats: view.seats.map((s) => s.seat) }];
  for (const record of hand.actions) seeded.push({ type: 'action', record });
  return seeded.slice(-LOG_LIMIT);
}

/** Pure: `state` is never mutated. */
export function reduce(state: TableState, msg: ServerMessage): TableState {
  // A table dealing a game this client cannot draw gets its identity kept and its GAME payloads
  // dropped on the floor. Every view, legal-action set and game event on that socket is shaped for
  // rules these components do not know, and the components have no way to tell: they would read a
  // canasta round as a poker hand and crash on the first field that is not there. Refusing the
  // payload here means no board can ever be handed one, whatever a future page forgets to check.
  const known = drawsGame(msg.type === 'welcome' ? (msg.game ?? DRAWN_GAME) : state.game);
  if (!known && msg.type !== 'welcome' && msg.type !== 'error' && msg.type !== 'pong') return state;
  switch (msg.type) {
    case 'welcome':
      if (!known) {
        // Enough to name the table and say what it deals, and not one field more.
        return { ...state, tableId: msg.tableId, game: msg.game ?? DRAWN_GAME, playerId: msg.playerId, view: null, turn: null, connection: 'open' };
      }
      return {
        ...state,
        tableId: msg.tableId,
        game: msg.game ?? DRAWN_GAME,
        playerId: msg.playerId,
        view: msg.view,
        names: { ...state.names, ...msg.names },
        players: { ...state.players, ...msg.players },
        turn: turnFromView(msg.view),
        lastHand: lastHandFromView(msg.view, state.lastHand),
        // Only seed on a first join; a reconnect keeps whatever the client already saw.
        log: state.log.length === 0 ? seedLog(msg.view) : state.log,
        connection: 'open',
      };
    case 'snapshot':
      return {
        ...state,
        view: msg.view,
        names: { ...state.names, ...msg.names },
        players: { ...state.players, ...msg.players },
        turn: turnFromView(msg.view) ?? reconcileTurn(state.turn, msg.view),
        lastHand: lastHandFromView(msg.view, state.lastHand),
      };
    case 'event': {
      const ev = msg.event;
      let names = state.names;
      let players = state.players;
      if ((ev.type === 'seat-joined' || ev.type === 'seat-status' || ev.type === 'seat-left') && ev.name) {
        names = { ...names, [ev.playerId]: ev.name };
      } else if (ev.type === 'chat' && state.names[ev.playerId] !== ev.name) {
        names = { ...names, [ev.playerId]: ev.name };
      }
      // A seat-joined carries who took the seat, so an agent seated mid-session is badged
      // immediately rather than waiting for the next snapshot.
      if (ev.type === 'seat-joined' && ev.kind) {
        players = {
          ...players,
          [ev.playerId]: {
            playerId: ev.playerId,
            name: ev.name ?? state.names[ev.playerId] ?? ev.playerId,
            kind: ev.kind,
            ...(ev.agentName ? { agentName: ev.agentName } : {}),
            ...(ev.agentKind ? { agentKind: ev.agentKind } : {}),
          },
        };
      }
      // Why a seat is sitting out travels with the status change, so the person it happened to can be
      // told — including the case that matters most, where it happened while they were disconnected
      // and the `welcome` they reconnect with carries the reason on `players` instead.
      if (ev.type === 'seat-status') {
        const known = players[ev.playerId];
        const base = known ?? { playerId: ev.playerId, name: ev.name ?? names[ev.playerId] ?? ev.playerId, kind: 'human' as const };
        const { sitOutReason: _dropped, ...rest } = base;
        players = { ...players, [ev.playerId]: { ...rest, ...(ev.sitOutReason ? { sitOutReason: ev.sitOutReason } : {}) } };
      }
      if (ev.type === 'seat-left' && players[ev.playerId]) {
        const rest = { ...players };
        delete rest[ev.playerId];
        players = rest;
      }
      let lastHand = state.lastHand;
      if (ev.type === 'hand-started') lastHand = null;
      if (ev.type === 'hand-ended') {
        lastHand = {
          handNo: ev.handNo,
          seedCommit: msg.view.hand?.seedCommit ?? state.view?.hand?.seedCommit ?? '',
          seedReveal: ev.seedReveal,
          result: ev.result,
          board: msg.view.hand?.board ?? state.view?.hand?.board ?? [],
        };
      }
      let turn = reconcileTurn(state.turn, msg.view);
      // The private `turn` engine event carries legal actions for the viewer; the
      // dedicated `turn` server message normally follows and adds the deadline.
      if (ev.type === 'turn' && msg.view.hand && msg.view.viewerSeat === ev.seat && ev.seat === msg.view.hand.toAct) {
        turn = { handNo: msg.view.hand.handNo, seat: ev.seat, legal: ev.legal, deadline: msg.view.hand.actionDeadline };
      }
      return { ...state, view: msg.view, names, players, log: appendLog(state.log, ev), turn, lastHand };
    }
    case 'turn':
      return { ...state, turn: { handNo: msg.handNo, seat: msg.seat, legal: msg.legal, deadline: msg.deadline } };
    case 'error':
      return {
        ...state,
        error: { code: msg.code, message: msg.message },
        // A rejected action means the server no longer expects this turn as we knew it. `no-hand`
        // belongs here too: there is no hand at all, so there is certainly not a turn in one.
        turn: msg.code === 'stale-hand' || msg.code === 'not-your-turn' || msg.code === 'no-hand' ? null : state.turn,
      };
    case 'pong':
      return state;
    default:
      return state;
  }
}

/* --------------------------------------------------- local (non-wire) ops */

export function dismissError(state: TableState): TableState {
  return state.error ? { ...state, error: null } : state;
}

export function setConnection(state: TableState, connection: ConnectionStatus): TableState {
  return state.connection === connection ? state : { ...state, connection };
}

/* --------------------------------------------------------------- parsing */

const SERVER_TYPES = new Set(['welcome', 'snapshot', 'event', 'turn', 'error', 'pong']);

/** Parse a frame into a ServerMessage, or null if it is not one we understand. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const t = (data as { type?: unknown }).type;
  if (typeof t !== 'string' || !SERVER_TYPES.has(t)) return null;
  return data as ServerMessage;
}

/* ---------------------------------------------------------------- client */

/** Minimal WebSocket surface so tests can inject a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

/**
 * The TRANSPORT is the host's and knows no game.
 *
 * `M` is whichever binding of the wire the page speaks — poker's by default, because every caller
 * but one speaks poker. A canasta page passes `CanastaServerMessage` and gets the same reconnect,
 * the same backoff and the same keepalive, because none of that has ever depended on the payloads.
 * The narrowing happens once, here, at the app's socket boundary, exactly as the protocol says.
 */
export interface TableSocketOptions<M = ServerMessage> {
  url: string;
  onMessage: (msg: M) => void;
  onStatus?: (status: ConnectionStatus) => void;
  /** Injected for tests; defaults to the browser WebSocket. */
  factory?: SocketFactory;
  /** Injected timers for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Keepalive ping interval; 0 disables. */
  pingIntervalMs?: number;
  now?: () => number;
}

const OPEN = 1;

export class TableSocket<M = ServerMessage> {
  private ws: SocketLike | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectHandle: unknown = null;
  private pingHandle: unknown = null;
  private queue: string[] = [];
  private readonly opts: Required<Omit<TableSocketOptions<M>, 'onStatus'>> & Pick<TableSocketOptions<M>, 'onStatus'>;

  constructor(options: TableSocketOptions<M>) {
    this.opts = {
      factory: (url) => new WebSocket(url) as unknown as SocketLike,
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      minBackoffMs: 500,
      maxBackoffMs: 10_000,
      pingIntervalMs: 20_000,
      now: () => Date.now(),
      onStatus: undefined,
      ...options,
    };
  }

  get status(): ConnectionStatus {
    if (this.closed) return 'closed';
    if (this.ws && this.ws.readyState === OPEN) return 'open';
    return this.attempt > 0 ? 'reconnecting' : 'connecting';
  }

  connect(): void {
    if (this.closed) return;
    this.opts.onStatus?.(this.attempt > 0 ? 'reconnecting' : 'connecting');
    let ws: SocketLike;
    try {
      ws = this.opts.factory(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.opts.onStatus?.('open');
      for (const frame of this.queue.splice(0)) ws.send(frame);
      this.startPing();
    };
    ws.onmessage = (ev) => {
      // Parsed structurally — the envelope is checked, the payload is the game's and is carried
      // whole. `M` is the binding this page reads it as, and the page is the thing that knows.
      const msg = parseServerMessage(ev.data);
      if (msg) this.opts.onMessage(msg as unknown as M);
    };
    ws.onerror = () => {
      /* onclose follows; nothing to do here */
    };
    ws.onclose = (ev) => {
      this.stopPing();
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      // 4401/4403 are the server's "unauthenticated / forbidden" — do not retry.
      if (ev.code === 4401 || ev.code === 4403) {
        this.closed = true;
        this.opts.onStatus?.('closed');
        this.opts.onMessage({ type: 'error', code: 'unauthenticated', message: ev.reason || 'connection refused' } as unknown as M);
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectHandle != null) return;
    const base = Math.min(this.opts.maxBackoffMs, this.opts.minBackoffMs * 2 ** this.attempt);
    const jitter = base * (0.5 + Math.random() * 0.5);
    this.attempt += 1;
    this.opts.onStatus?.('reconnecting');
    this.reconnectHandle = this.opts.setTimeout(() => {
      this.reconnectHandle = null;
      this.connect();
    }, Math.round(jitter));
  }

  private startPing(): void {
    this.stopPing();
    if (this.opts.pingIntervalMs <= 0) return;
    const tick = () => {
      if (this.closed) return;
      this.send({ type: 'ping' });
      this.pingHandle = this.opts.setTimeout(tick, this.opts.pingIntervalMs);
    };
    this.pingHandle = this.opts.setTimeout(tick, this.opts.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingHandle != null) {
      this.opts.clearTimeout(this.pingHandle);
      this.pingHandle = null;
    }
  }

  /** Send now, or queue until the socket (re)opens. Pings are never queued. */
  send(cmd: ClientCommand): void {
    if (this.closed) return;
    const frame = JSON.stringify(cmd);
    if (this.ws && this.ws.readyState === OPEN) {
      this.ws.send(frame);
    } else if (cmd.type !== 'ping') {
      this.queue.push(frame);
    }
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    if (this.reconnectHandle != null) {
      this.opts.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, 'client closed');
      } catch {
        /* ignore */
      }
    }
    this.opts.onStatus?.('closed');
  }
}
