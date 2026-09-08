/**
 * Test-only mock of a PokerTableDO. Produces `ServerMessage`s the way the real
 * server would (welcome → events with fresh views → turn), plus a fake
 * WebSocket factory for exercising `TableSocket` without a network.
 *
 * Not shipped: only imported from *.test.ts.
 */
import type { SocketLike } from './tableSocket';
import type { Card, ClientCommand, LegalActions, SeatView, ServerMessage, TableConfig, TableEvent, TableView } from './types';

export const CONFIG: TableConfig = {
  seats: 6,
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  minBuyIn: 40,
  maxBuyIn: 200,
  actionTimeoutMs: 30_000,
};

export const EMPTY_LEGAL: LegalActions = { fold: false, check: false, call: null, bet: null, raise: null, allIn: 0 };

export function seat(n: number, playerId: string, stack: number, extra: Partial<SeatView> = {}): SeatView {
  return { seat: n, playerId, stack, status: 'active', ...extra };
}

export function emptyView(seats: SeatView[] = [], viewerSeat: number | null = null): TableView {
  return { config: CONFIG, seats, button: null, handNo: 0, hand: null, viewerSeat, legal: null };
}

/** A view mid-hand: hand #7 on the flop, seat 0 (viewer) to act facing a bet of 6. */
export function flopView(viewerSeat: number | null = 0): TableView {
  const legal: LegalActions = { fold: true, check: false, call: 6, bet: null, raise: { min: 12, max: 194 }, allIn: 194 };
  return {
    config: CONFIG,
    button: 1,
    handNo: 7,
    viewerSeat,
    legal: viewerSeat === 0 ? legal : null,
    seats: [
      seat(0, 'p-alice', 194, { inHand: { streetBet: 0, totalBet: 2, folded: false, allIn: false, holeCards: viewerSeat === 0 ? ['Ah', 'Kd'] : undefined } }),
      seat(1, 'p-bob', 192, { inHand: { streetBet: 6, totalBet: 8, folded: false, allIn: false } }),
      seat(3, 'p-carol', 150, { inHand: { streetBet: 0, totalBet: 0, folded: true, allIn: false } }),
    ],
    hand: {
      handNo: 7,
      seedCommit: '3f9a2c5e7b1d4a6f3f9a2c5e7b1d4a6f3f9a2c5e7b1d4a6f3f9a2c5e7b1d4a6f',
      street: 'flop',
      board: ['Ah', '7d', '2c'],
      pots: [{ amount: 4, eligible: [0, 1] }],
      toAct: viewerSeat === 0 ? 0 : 0,
      currentBet: 6,
      minRaise: 6,
      actions: [],
      actionDeadline: 1_700_000_030_000,
    },
  };
}

export const NAMES: Record<string, string> = { 'p-alice': 'Alice', 'p-bob': 'Bob', 'p-carol': 'Carol' };

export function welcome(view: TableView, playerId: string | null = 'p-alice'): ServerMessage {
  return { type: 'welcome', tableId: 't-1', playerId, view, names: { ...NAMES } };
}

export function event(ev: TableEvent, view: TableView): ServerMessage {
  return { type: 'event', event: ev, view };
}

export function turn(view: TableView, deadline = 1_700_000_030_000): ServerMessage {
  if (!view.hand || view.viewerSeat == null || !view.legal) throw new Error('view has no viewer turn');
  return { type: 'turn', handNo: view.hand.handNo, seat: view.viewerSeat, legal: view.legal, deadline };
}

/** Script the end of hand #7: Alice calls, river runs out, Alice wins at showdown. */
export function endOfHandScript(): ServerMessage[] {
  const v = flopView(0);
  const afterCall: TableView = {
    ...v,
    legal: null,
    hand: { ...v.hand!, toAct: 1, pots: [{ amount: 16, eligible: [0, 1] }] },
  };
  const board: Card[] = ['Ah', '7d', '2c', 'Kc', '9s'];
  const ended: TableView = {
    ...afterCall,
    hand: {
      ...afterCall.hand!,
      street: 'showdown',
      board,
      toAct: null,
      seedReveal: 'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb',
      result: {
        awards: [{ potIndex: 0, amount: 16, seat: 0, rank: { category: 'two-pair', value: 3_000_000, cards: ['Ah', 'Ad', 'Kd', 'Kc', '9s'], label: 'Two pair, aces and kings' } }],
        net: { 0: 8, 1: -8 },
        shown: [{ seat: 0, holeCards: ['Ah', 'Kd'], rank: { category: 'two-pair', value: 3_000_000, cards: ['Ah', 'Ad', 'Kd', 'Kc', '9s'], label: 'Two pair, aces and kings' } }],
        rake: 0,
      },
    },
  };
  return [
    event({ type: 'action', record: { seat: 0, street: 'flop', action: { type: 'call' }, amount: 6 } }, afterCall),
    event({ type: 'street', street: 'turn', board: board.slice(0, 4) }, { ...afterCall, hand: { ...afterCall.hand!, street: 'turn', board: board.slice(0, 4) } }),
    event({ type: 'street', street: 'river', board }, { ...afterCall, hand: { ...afterCall.hand!, street: 'river', board } }),
    event({ type: 'showdown', shown: ended.hand!.result!.shown }, ended),
    event({ type: 'hand-ended', handNo: 7, result: ended.hand!.result!, seedReveal: ended.hand!.seedReveal! }, ended),
  ];
}

/* ------------------------------------------------------- fake WebSocket */

export class FakeSocket implements SocketLike {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(public readonly url: string) {}

  send(data: string): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error('not open');
    this.sent.push(data);
  }
  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /* --- server side --- */
  serverOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.({});
  }
  serverSend(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverDrop(code = 1006, reason = 'dropped'): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
  received(): ClientCommand[] {
    return this.sent.map((s) => JSON.parse(s) as ClientCommand);
  }
}

/** Factory that records every socket it creates, so tests can drive them. */
export function fakeFactory(): { sockets: FakeSocket[]; factory: (url: string) => SocketLike } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
  };
}

/** Manual timer queue: `flush()` runs everything scheduled so far. */
export function fakeTimers() {
  let seq = 0;
  const pending = new Map<number, () => void>();
  return {
    setTimeout: (fn: () => void, _ms: number) => {
      const id = ++seq;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (h: unknown) => {
      pending.delete(h as number);
    },
    flush(): number {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
      return fns.length;
    },
    get size() {
      return pending.size;
    },
  };
}
