import { describe, expect, it } from 'vitest';
import { LOG_LIMIT, TableSocket, dismissError, initialState, parseServerMessage, reduce } from './tableSocket';
import type { ServerMessage } from './types';
import { emptyView, endOfHandScript, event, fakeFactory, fakeTimers, flopView, seat, turn, welcome } from './mockServer';

describe('reduce: welcome', () => {
  it('adopts the view, names and viewer identity', () => {
    const s = reduce(initialState, welcome(emptyView([seat(0, 'p-alice', 200)], 0)));
    expect(s.tableId).toBe('t-1');
    expect(s.playerId).toBe('p-alice');
    expect(s.view?.seats).toHaveLength(1);
    expect(s.names['p-bob']).toBe('Bob');
    expect(s.connection).toBe('open');
    expect(s.turn).toBeNull();
  });

  it('derives a pending turn from the view when it is already the viewer to act', () => {
    const s = reduce(initialState, welcome(flopView(0)));
    expect(s.turn).toEqual({ handNo: 7, seat: 0, legal: flopView(0).legal, deadline: 1_700_000_030_000 });
  });

  it('spectators never get a turn', () => {
    const s = reduce(initialState, welcome(flopView(null), null));
    expect(s.playerId).toBeNull();
    expect(s.turn).toBeNull();
    expect(s.view?.seats[0]?.inHand?.holeCards).toBeUndefined();
  });

  it('does not mutate the previous state', () => {
    const before = { ...initialState, names: { x: 'X' } };
    const frozen = Object.freeze(before);
    const after = reduce(frozen, welcome(emptyView()));
    expect(after).not.toBe(frozen);
    expect(frozen.names).toEqual({ x: 'X' });
    expect(after.names).toMatchObject({ x: 'X', 'p-alice': 'Alice' });
  });
});

describe('reduce: turn', () => {
  it('records the turn with its deadline', () => {
    const v = flopView(0);
    const s = reduce(reduce(initialState, welcome(v)), turn(v, 123_456));
    expect(s.turn?.deadline).toBe(123_456);
    expect(s.turn?.legal.raise).toEqual({ min: 12, max: 194 });
  });

  it('clears the turn once the view shows someone else to act', () => {
    const v = flopView(0);
    let s = reduce(reduce(initialState, welcome(v)), turn(v));
    expect(s.turn).not.toBeNull();
    const [call] = endOfHandScript();
    s = reduce(s, call!);
    expect(s.turn).toBeNull();
  });

  it('clears the turn on stale-hand / not-your-turn errors', () => {
    const v = flopView(0);
    let s = reduce(reduce(initialState, welcome(v)), turn(v));
    s = reduce(s, { type: 'error', code: 'stale-hand', message: 'hand moved on' });
    expect(s.turn).toBeNull();
    expect(s.error?.code).toBe('stale-hand');
  });
});

describe('reduce: event', () => {
  it('appends to the log and adopts the fresh view', () => {
    let s = reduce(initialState, welcome(flopView(0)));
    for (const m of endOfHandScript()) s = reduce(s, m);
    expect(s.log.map((e) => e.type)).toEqual(['action', 'street', 'street', 'showdown', 'hand-ended']);
    expect(s.view?.hand?.street).toBe('showdown');
  });

  it('keeps the last hand result and seed reveal until the next hand starts', () => {
    let s = reduce(initialState, welcome(flopView(0)));
    for (const m of endOfHandScript()) s = reduce(s, m);
    expect(s.lastHand?.handNo).toBe(7);
    expect(s.lastHand?.seedReveal).toMatch(/^deadbeef/);
    expect(s.lastHand?.result?.awards[0]?.seat).toBe(0);
    s = reduce(s, event({ type: 'hand-started', handNo: 8, seedCommit: 'abc', button: 3, seats: [0, 1] }, emptyView()));
    expect(s.lastHand).toBeNull();
  });

  it('learns names from seat events and chat', () => {
    let s = reduce(initialState, welcome(emptyView()));
    s = reduce(s, event({ type: 'seat-joined', seat: 4, playerId: 'p-dave', name: 'Dave', stack: 100 }, emptyView([seat(4, 'p-dave', 100)])));
    expect(s.names['p-dave']).toBe('Dave');
    s = reduce(s, event({ type: 'chat', playerId: 'p-erin', name: 'Erin', text: 'hi', at: 1 }, s.view!));
    expect(s.names['p-erin']).toBe('Erin');
  });

  it('caps the log at LOG_LIMIT, dropping the oldest', () => {
    let s = reduce(initialState, welcome(emptyView()));
    for (let i = 0; i < LOG_LIMIT + 10; i++) {
      s = reduce(s, event({ type: 'chat', playerId: 'p', name: 'P', text: `m${i}`, at: i }, s.view!));
    }
    expect(s.log).toHaveLength(LOG_LIMIT);
    const first = s.log[0];
    expect(first?.type === 'chat' && first.text).toBe('m10');
  });

  it('turns the private turn engine event into a pending turn', () => {
    const v = flopView(0);
    const s = reduce(reduce(initialState, welcome({ ...v, legal: null })), event({ type: 'turn', seat: 0, legal: v.legal! }, v));
    expect(s.turn?.seat).toBe(0);
    expect(s.turn?.legal.call).toBe(6);
  });
});

describe('reduce: error', () => {
  it('stores the error and dismissError clears it', () => {
    const s = reduce(initialState, { type: 'error', code: 'buy-in-range', message: 'buy-in must be 40..200' });
    expect(s.error).toEqual({ code: 'buy-in-range', message: 'buy-in must be 40..200' });
    expect(dismissError(s).error).toBeNull();
    expect(dismissError(initialState)).toBe(initialState);
  });
});

describe('parseServerMessage', () => {
  it('accepts known message types and rejects junk', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'pong', at: 1 }))).toEqual({ type: 'pong', at: 1 });
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'nope' }))).toBeNull();
    expect(parseServerMessage(42)).toBeNull();
  });
});

describe('TableSocket', () => {
  function make() {
    const ff = fakeFactory();
    const timers = fakeTimers();
    const received: ServerMessage[] = [];
    const statuses: string[] = [];
    const sock = new TableSocket({
      url: 'ws://x/tables/t-1/ws',
      onMessage: (m) => received.push(m),
      onStatus: (s) => statuses.push(s),
      factory: ff.factory,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      pingIntervalMs: 0,
    });
    return { ff, timers, received, statuses, sock };
  }

  it('delivers parsed messages and sends commands as JSON', () => {
    const { ff, received, sock } = make();
    sock.connect();
    const ws = ff.sockets[0]!;
    ws.serverOpen();
    ws.serverSend(welcome(emptyView()));
    expect(received[0]?.type).toBe('welcome');
    sock.send({ type: 'chat', text: 'gg' });
    expect(ws.received()).toEqual([{ type: 'chat', text: 'gg' }]);
  });

  it('queues commands until open, reconnects after a drop, and stops after close()', () => {
    const { ff, timers, statuses, sock } = make();
    sock.connect();
    sock.send({ type: 'sit-in' });
    const first = ff.sockets[0]!;
    expect(first.sent).toEqual([]);
    first.serverOpen();
    expect(first.received()).toEqual([{ type: 'sit-in' }]);

    first.serverDrop();
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(timers.size).toBe(1);
    timers.flush();
    expect(ff.sockets).toHaveLength(2);
    ff.sockets[1]!.serverOpen();
    expect(statuses.at(-1)).toBe('open');

    sock.close();
    expect(statuses.at(-1)).toBe('closed');
    expect(ff.sockets[1]!.readyState).toBe(3);
    timers.flush();
    expect(ff.sockets).toHaveLength(2);
  });

  it('gives up on an auth rejection and surfaces it as an error message', () => {
    const { ff, received, sock } = make();
    sock.connect();
    ff.sockets[0]!.serverDrop(4401, 'bad token');
    expect(received.at(-1)).toEqual({ type: 'error', code: 'unauthenticated', message: 'bad token' });
    expect(sock.status).toBe('closed');
  });
});
