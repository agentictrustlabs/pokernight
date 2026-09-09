/**
 * What the landing page says about the live room. Every sentence there is a claim about a running
 * service, so the rule these tests hold is: never say more than the data supports, and say something
 * true when there is nothing to boast about.
 */
import { describe, expect, it } from 'vitest';
import type { TableSummary } from './types';
import { describeMoment, fmtSeats, isRunning, pickFeaturedTable, plural, summarizeLobby, summarizeRoster, type TableDetail } from './lobby';

const table = (over: Partial<TableSummary> = {}): TableSummary => ({
  tableId: 't1',
  name: 'Friday Night',
  config: { seats: 6, smallBlind: 1, bigBlind: 2, ante: 0, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 25000 },
  settlement: 'play-money',
  seated: 5,
  handNo: 754,
  createdAt: 1788881173377,
  ...over,
});

describe('formatters', () => {
  it('counts things in English', () => {
    expect(plural(1, 'table')).toBe('1 table');
    expect(plural(3, 'table')).toBe('3 tables');
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(0, 'player')).toBe('0 players');
  });

  it('shows seats taken over seats laid', () => {
    expect(fmtSeats(5, 6)).toBe('5/6');
    expect(fmtSeats(0, 9)).toBe('0/9');
  });

  it('knows a table cannot deal to one person', () => {
    expect(isRunning(table({ seated: 2 }))).toBe(true);
    expect(isRunning(table({ seated: 1 }))).toBe(false);
  });
});

describe('summarizeLobby', () => {
  it('adds up what is actually there', () => {
    const s = summarizeLobby([table(), table({ tableId: 't2', seated: 3, handNo: 137 }), table({ tableId: 't3', seated: 4, handNo: 27 })]);
    expect(s).toMatchObject({ tables: 3, running: 3, seated: 12, hands: 918 });
    expect(s.headline).toBe('3 tables open · 12 players seated · 918 hands dealt');
  });

  it('says the room is quiet rather than dressing up an empty lobby', () => {
    const s = summarizeLobby([]);
    expect(s).toMatchObject({ tables: 0, running: 0, seated: 0, hands: 0 });
    expect(s.headline).toMatch(/quiet/);
  });
});

describe('pickFeaturedTable', () => {
  it('shows the busiest table, and never an empty one', () => {
    expect(pickFeaturedTable([table({ tableId: 'a', seated: 3 }), table({ tableId: 'b', seated: 5 })])?.tableId).toBe('b');
    expect(pickFeaturedTable([table({ seated: 0 }), table({ tableId: 'x', seated: 0 })])).toBeNull();
    expect(pickFeaturedTable([])).toBeNull();
  });

  it('breaks ties the same way every poll, so the page does not flicker', () => {
    const a = table({ tableId: 'a', seated: 4, handNo: 10, createdAt: 2 });
    const b = table({ tableId: 'b', seated: 4, handNo: 90, createdAt: 3 });
    const c = table({ tableId: 'c', seated: 4, handNo: 90, createdAt: 1 });
    expect(pickFeaturedTable([a, b, c])?.tableId).toBe('c');
    expect(pickFeaturedTable([c, b, a])?.tableId).toBe('c');
  });
});

/** The shape `GET /tables/:id` actually returns, trimmed to what the landing page reads. */
const detail = (over: Partial<TableDetail> = {}): TableDetail =>
  ({
    tableId: 't1',
    name: 'Friday Night',
    settlement: 'play-money',
    names: {},
    players: {
      'agent:sharkbot.svc': { playerId: 'agent:sharkbot.svc', name: 'Sharkbot', kind: 'agent', agentName: 'sharkbot.svc', agentKind: 'rules' },
      'agent:bluffer.svc': { playerId: 'agent:bluffer.svc', name: 'The Bluffer', kind: 'agent', agentName: 'bluffer.svc', agentKind: 'claude' },
      'home:0xabc': { playerId: 'home:0xabc', name: 'rich.me', kind: 'human' },
    },
    view: {
      config: { seats: 6, smallBlind: 1, bigBlind: 2, ante: 0, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 25000 },
      seats: [
        { seat: 2, playerId: 'agent:bluffer.svc', stack: 100, status: 'active', waitingForBigBlind: false },
        { seat: 0, playerId: 'home:0xabc', stack: 238, status: 'active', waitingForBigBlind: false },
        { seat: 1, playerId: 'agent:sharkbot.svc', stack: 50, status: 'active', waitingForBigBlind: false },
      ],
      button: 0,
      handNo: 754,
      hand: {
        handNo: 754,
        seedCommit: 'abc',
        smallBlindSeat: 1,
        bigBlindSeat: 2,
        street: 'flop',
        board: [],
        pots: [{ amount: 4, eligible: [1, 2] }],
        toAct: null,
        currentBet: 6,
        minRaise: 4,
        actions: [],
        actionDeadline: null,
      },
      viewerSeat: null,
      legal: null,
    },
    ...over,
  }) as TableDetail;

describe('summarizeRoster', () => {
  it('reads the seats in seat order and tells agents from people', () => {
    const r = summarizeRoster(detail());
    expect(r.humans).toEqual(['rich.me']);
    expect(r.agents).toEqual(['Sharkbot', 'The Bluffer']);
    expect(r.agentNames).toBe('Sharkbot and The Bluffer');
    expect(r.line).toBe('2 agents and 1 person');
  });

  it('says no one is seated rather than nothing at all', () => {
    expect(summarizeRoster(null).line).toBe('No one is seated');
    expect(summarizeRoster(detail({ view: { ...detail().view, seats: [] } })).line).toBe('No one is seated');
  });

  it('falls back to the legacy names map, then to the seat number', () => {
    const d = detail({ players: undefined, names: { 'home:0xabc': 'rich.me' } });
    expect(summarizeRoster(d).humans).toEqual(['rich.me', 'Seat 2', 'Seat 3']);
  });
});

describe('describeMoment', () => {
  it('only claims agents are playing when there is a hand and there are agents', () => {
    const d = detail();
    const m = describeMoment(d, summarizeRoster(d));
    expect(m.agentsPlaying).toBe(true);
    expect(m.state).toBe('Flop · pot 4');
    expect(m.line).toBe('Sharkbot and The Bluffer and 1 person — hand #754, Flop · pot 4');
  });

  it('says the pot in money too when the table settles, at the table’s own rate', () => {
    const d = { ...detail(), settlement: 'mandate-transfer', chipValue: '1000000' };
    expect(describeMoment(d, summarizeRoster(d)).state).toBe('Flop · pot 4 (4.00 SHQ)');
    // The same pot at the rate an older table was opened with is a different amount of money.
    const older = { ...d, chipValue: '10000' };
    expect(describeMoment(older, summarizeRoster(older)).state).toBe('Flop · pot 4 (0.04 SHQ)');
  });

  it('does not claim a hand is running between hands', () => {
    const d = detail({ view: { ...detail().view, hand: null } });
    const m = describeMoment(d, summarizeRoster(d));
    expect(m.agentsPlaying).toBe(false);
    expect(m.state).toBe('between hands');
    expect(m.line).toMatch(/754 hands dealt, waiting for the next one/);
  });

  it('claims nothing at all with no table to describe', () => {
    const m = describeMoment(null, summarizeRoster(null));
    expect(m.agentsPlaying).toBe(false);
    expect(m.line).toBe('');
  });

  it('does not call a table of people an agent table', () => {
    const d = detail({ players: { 'home:0xabc': { playerId: 'home:0xabc', name: 'rich.me', kind: 'human' } } });
    const m = describeMoment(d, summarizeRoster(d));
    expect(m.agentsPlaying).toBe(false);
  });
});
