/**
 * Rules-based WebSocket bot (phase 1).
 *
 *   node --import tsx ./src/bot.ts --server http://localhost:8787 --table <id> --seat <n> \
 *        --buy-in <chips> --name <name> [--think-ms 800]
 *
 * Flow: POST /dev/session (dev auth) → GET /tables/:id/ws?token= → join seat →
 * on every `turn` message run `decide` from @pokernight/agent-kit and send `act`.
 * Reconnects with backoff, logs hand results and stack, leaves cleanly on SIGINT.
 */

import WebSocket from 'ws';
import { decide } from '@pokernight/agent-kit';
import { SessionSchema, type ClientCommand, type PokerActInput, type ServerMessage, type Session } from '@pokernight/protocol';
import type { LegalActions, TableView } from '@pokernight/engine';

/* ------------------------------------------------------------------- args */

interface Args {
  server: string;
  table: string;
  seat: number;
  buyIn: number;
  name: string;
  thinkMs: number;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const eq = key.indexOf('=');
    if (eq >= 0) flags.set(key.slice(0, eq), key.slice(eq + 1));
    else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else flags.set(key, 'true');
    }
  }
  const get = (k: string, fallback?: string): string => {
    const v = flags.get(k) ?? fallback;
    if (v === undefined) {
      console.error(`missing --${k}`);
      console.error(
        'usage: bot --server <url> --table <id> --seat <n> --buy-in <chips> --name <name> [--think-ms 800]',
      );
      process.exit(2);
    }
    return v;
  };
  const num = (k: string, fallback?: string): number => {
    const n = Number(get(k, fallback));
    if (!Number.isFinite(n)) {
      console.error(`--${k} must be a number`);
      process.exit(2);
    }
    return n;
  };
  return {
    server: get('server', process.env.POKERNIGHT_SERVER ?? 'http://localhost:8787').replace(/\/+$/, ''),
    table: get('table'),
    seat: num('seat', '0'),
    buyIn: num('buy-in', '200'),
    name: get('name', `bot-${Math.random().toString(36).slice(2, 6)}`),
    thinkMs: num('think-ms', '800'),
  };
}

/* -------------------------------------------------------------------- bot */

function log(...parts: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}]`, ...parts);
}

async function createSession(server: string, name: string): Promise<Session> {
  const res = await fetch(`${server}/dev/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`POST /dev/session failed: ${res.status} ${await res.text()}`);
  return SessionSchema.parse(await res.json());
}

function wsUrl(server: string, table: string, token: string): string {
  const base = server.replace(/^http/, 'ws');
  return `${base}/tables/${encodeURIComponent(table)}/ws?token=${encodeURIComponent(token)}`;
}

class Bot {
  private ws: WebSocket | null = null;
  private view: TableView | null = null;
  private playerId: string | null = null;
  private names: Record<string, string> = {};
  private seat: number;
  private stopping = false;
  private backoffMs = 1000;
  private pendingTurn: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private stats = { hands: 0, won: 0, lost: 0, net: 0 };

  constructor(
    private readonly args: Args,
    private readonly session: Session,
  ) {
    this.seat = args.seat;
  }

  start(): void {
    this.connect();
    const onSignal = () => this.shutdown();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  private send(cmd: ClientCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
  }

  private connect(): void {
    if (this.stopping) return;
    const url = wsUrl(this.args.server, this.args.table, this.session.token);
    log(`connecting to ${url.replace(/token=.*/, 'token=***')}`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.backoffMs = 1000;
      log('connected');
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 20_000);
    });
    ws.on('message', (data) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data.toString()) as ServerMessage;
      } catch {
        log('unparseable message', data.toString().slice(0, 120));
        return;
      }
      this.onMessage(msg);
    });
    ws.on('close', (code, reason) => {
      this.clearTimers();
      if (this.stopping) {
        log('disconnected, bye');
        process.exit(0);
      }
      const delay = this.backoffMs;
      this.backoffMs = Math.min(30_000, this.backoffMs * 2);
      log(`disconnected (${code} ${reason.toString()}), reconnecting in ${delay}ms`);
      setTimeout(() => this.connect(), delay);
    });
    ws.on('error', (err) => log('socket error:', err.message));
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.pendingTurn) clearTimeout(this.pendingTurn);
    this.pendingTurn = null;
  }

  private join(): void {
    log(`joining seat ${this.seat} with ${this.args.buyIn} chips`);
    this.send({ type: 'join', seat: this.seat, buyIn: this.args.buyIn });
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.view = msg.view;
        this.names = msg.names;
        log(`welcome to table ${msg.tableId} as ${msg.playerId ?? 'spectator'}`);
        if (msg.view.viewerSeat === null) this.join();
        else {
          this.seat = msg.view.viewerSeat;
          log(`already seated at ${this.seat}`);
        }
        break;
      case 'snapshot':
        this.view = msg.view;
        this.names = msg.names;
        if (msg.view.viewerSeat !== null) this.seat = msg.view.viewerSeat;
        break;
      case 'event':
        this.view = msg.view;
        if (msg.view.viewerSeat !== null) this.seat = msg.view.viewerSeat;
        this.onEvent(msg);
        break;
      case 'turn':
        if (msg.seat === this.view?.viewerSeat) this.onTurn(msg.handNo, msg.legal, msg.deadline);
        break;
      case 'error':
        this.onError(msg.code, msg.message);
        break;
      case 'pong':
        break;
    }
  }

  private onEvent(msg: Extract<ServerMessage, { type: 'event' }>): void {
    const ev = msg.event;
    switch (ev.type) {
      case 'seat-joined':
        if (ev.playerId === this.playerId) {
          this.seat = ev.seat;
          log(`seated at ${ev.seat}, stack ${ev.stack ?? this.args.buyIn}`);
        } else log(`${ev.name ?? ev.playerId} sat down at seat ${ev.seat}`);
        break;
      case 'seat-left':
        if (ev.playerId !== this.playerId) log(`${this.names[ev.playerId] ?? ev.playerId} left seat ${ev.seat}`);
        break;
      case 'hand-started':
        log(`hand #${ev.handNo} started, button ${ev.button}, ${ev.seats.length} players`);
        break;
      case 'hole-cards':
        if (ev.seat === this.seat) log(`hole cards: ${ev.cards.join(' ')}`);
        break;
      case 'street':
        log(`${ev.street}: ${ev.board.join(' ')}`);
        break;
      case 'hand-ended': {
        const net = ev.result.net[this.seat] ?? 0;
        this.stats.hands++;
        this.stats.net += net;
        if (net > 0) this.stats.won++;
        else if (net < 0) this.stats.lost++;
        const stack = msg.view.seats.find((s) => s.seat === this.seat)?.stack ?? '?';
        const shown = ev.result.shown.map((s) => `seat ${s.seat} ${s.holeCards.join('')} (${s.rank.label})`).join(', ');
        log(
          `hand #${ev.handNo} ended: ${net >= 0 ? '+' : ''}${net} chips, stack ${stack} | ` +
            `won ${this.stats.won} lost ${this.stats.lost} of ${this.stats.hands}, net ${this.stats.net}` +
            (shown ? ` | showdown: ${shown}` : ''),
        );
        break;
      }
      case 'chat':
        log(`<${ev.name}> ${ev.text}`);
        break;
      default:
        break;
    }
  }

  private onTurn(handNo: number, legal: LegalActions, deadline: number): void {
    if (!this.view || this.view.viewerSeat === null) return;
    const input: PokerActInput = {
      tableId: this.args.table,
      handNo,
      seat: this.view.viewerSeat,
      view: this.view,
      legal,
      deadlineMs: Math.max(0, deadline - Date.now()),
    };
    let out;
    try {
      out = decide(input);
    } catch (err) {
      log('decide threw, folding:', err instanceof Error ? err.message : err);
      out = { action: legal.check ? ({ type: 'check' } as const) : ({ type: 'fold' } as const), note: 'error' };
    }
    // Leave a safety margin before the table's deadline.
    const wait = Math.max(0, Math.min(this.args.thinkMs, input.deadlineMs - 500));
    if (this.pendingTurn) clearTimeout(this.pendingTurn);
    this.pendingTurn = setTimeout(() => {
      this.pendingTurn = null;
      const a = out.action;
      log(`act: ${'amount' in a ? `${a.type} ${a.amount}` : a.type}${out.note ? ` — ${out.note}` : ''}`);
      this.send({ type: 'act', handNo, action: a });
    }, wait);
  }

  private onError(code: string, message: string): void {
    log(`error ${code}: ${message}`);
    switch (code) {
      case 'seat-taken':
      case 'seat-invalid': {
        const seats = this.view?.config.seats ?? 9;
        const taken = new Set(this.view?.seats.map((s) => s.seat) ?? []);
        let next = -1;
        for (let i = 1; i <= seats; i++) {
          const candidate = (this.seat + i) % seats;
          if (!taken.has(candidate)) {
            next = candidate;
            break;
          }
        }
        if (next < 0) {
          log('no free seat, waiting for one to open');
          setTimeout(() => this.join(), 10_000);
          return;
        }
        this.seat = next;
        this.join();
        break;
      }
      case 'buy-in-range': {
        const cfg = this.view?.config;
        if (cfg) {
          const clamped = Math.min(cfg.maxBuyIn, Math.max(cfg.minBuyIn, this.args.buyIn));
          if (clamped !== this.args.buyIn) {
            log(`adjusting buy-in ${this.args.buyIn} -> ${clamped}`);
            this.args.buyIn = clamped;
            this.join();
          }
        }
        break;
      }
      case 'player-seated':
        // Already at the table (reconnect); the next snapshot tells us where.
        break;
      case 'unauthenticated':
        log('session rejected, exiting');
        this.shutdown();
        break;
      default:
        break;
    }
  }

  shutdown(): void {
    if (this.stopping) return;
    this.stopping = true;
    log(`leaving (won ${this.stats.won} lost ${this.stats.lost} of ${this.stats.hands}, net ${this.stats.net})`);
    this.clearTimers();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'leave' });
      setTimeout(() => this.ws?.close(1000, 'bye'), 200);
      setTimeout(() => process.exit(0), 2000).unref();
    } else {
      process.exit(0);
    }
  }
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  log(`${args.name}: creating dev session at ${args.server}`);
  const session = await createSession(args.server, args.name);
  log(`session ok, playerId ${session.playerId}`);
  new Bot(args, session).start();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
