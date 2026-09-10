/**
 * What the landing page says about the live room. Every sentence there is a claim about a running
 * service, so the rule these tests hold is: never say more than the data supports, and say something
 * true when there is nothing to boast about.
 */
import { describe, expect, it } from 'vitest';
import type { TableSummary } from './types';
import { describeMoment, fmtSeats, isRunning, pickFeaturedTable, pickSeat, plural, stakeLabel, summarizeLobby, summarizeRoster, type TableDetail } from './lobby';

const table = (over: Partial<TableSummary> = {}): TableSummary => ({
  tableId: 't1',
  name: 'Friday Night',
  // The generic setup any table has, and poker's own beside it.
  config: { seats: 6, minStake: 40, maxStake: 200, turnMs: 25000 },
  game: 'poker',
  gameConfig: { seats: 6, smallBlind: 1, bigBlind: 2, ante: 0, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 25000 },
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
    // A busy canasta table is not the one to narrate: the featured card reads a poker view, and
    // another game's view has no street, no pot and no hand number in it to read.
    expect(pickFeaturedTable([table({ tableId: 'c', seated: 4, game: 'canasta' }), table({ tableId: 'p', seated: 2 })])?.tableId).toBe('p');
    expect(pickFeaturedTable([table({ tableId: 'c', seated: 4, game: 'canasta' })])).toBeNull();
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
      // The generic setup any table has, and poker's own beside it.
  config: { seats: 6, minStake: 40, maxStake: 200, turnMs: 25000 },
  game: 'poker',
  gameConfig: { seats: 6, smallBlind: 1, bigBlind: 2, ante: 0, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 25000 },
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
    expect(m.handRunning).toBe(true);
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
    expect(m.handRunning).toBe(false);
    expect(m.state).toBe('between hands');
    expect(m.line).toMatch(/754 hands dealt, waiting for the next one/);
  });

  it('claims nothing at all with no table to describe', () => {
    const m = describeMoment(null, summarizeRoster(null));
    expect(m.agentsPlaying).toBe(false);
    expect(m.line).toBe('');
  });

  it('does not call a table of people an agent table — but a hand there is still a hand', () => {
    const d = detail({ players: { 'home:0xabc': { playerId: 'home:0xabc', name: 'rich.me', kind: 'human' } } });
    const m = describeMoment(d, summarizeRoster(d));
    expect(m.agentsPlaying).toBe(false);
    // The front door says "a hand is running right now" and reads THIS. Answering false here for a
    // table of people would have made the live strip go dark on the busiest kind of table there is.
    expect(m.handRunning).toBe(true);
  });
});

/**
 * The stakes column has to work for a table this client cannot describe, because one day there will
 * be one. Poker shows its blinds; anything else shows what it is rather than an invented number.
 */
describe('pickSeat', () => {
  it('prefers a settled table with room, and takes any free seat otherwise', () => {
    const play = table({ tableId: 'play', seated: 1 });
    const money = table({ tableId: 'money', seated: 1, settlement: 'mandate-transfer' });
    expect(pickSeat([play, money])?.tableId).toBe('money');
    expect(pickSeat([play])?.tableId).toBe('play');
    expect(pickSeat([table({ seated: 6 })])).toBeNull();
    expect(pickSeat(null)).toBeNull();
  });

  it('offers a canasta seat, because this client has a canasta board', () => {
    expect(pickSeat([table({ tableId: 'canasta', seated: 0, game: 'canasta' })])?.tableId).toBe('canasta');
  });

  it('never sends a player to a game this client has no board for', () => {
    // The empty table is the one with the most room in the room, and it is exactly the one that
    // must not be offered: there is no seat on the screen it would open.
    const gin = table({ tableId: 'gin', seated: 0, game: 'gin-rummy', settlement: 'mandate-transfer' });
    expect(pickSeat([gin])).toBeNull();
    expect(pickSeat([gin, table({ tableId: 'holdem', seated: 3 })])?.tableId).toBe('holdem');
  });
});

describe('stakeLabel', () => {
  it('shows poker’s blinds, which live on the game’s own config', () => {
    expect(stakeLabel(table())).toBe('1/2');
  });

  it('names the game when it is not poker, instead of inventing blinds for it', () => {
    // The NAME, as a person says it — not the id the host routes on.
    expect(stakeLabel({ game: 'canasta', gameConfig: { target: 5000 } })).toBe('Canasta');
  });

  it('falls back to the id for a game it has never heard of', () => {
    expect(stakeLabel({ game: 'gin-rummy', gameConfig: {} })).toBe('gin-rummy');
  });

  it('says something rather than nothing for a table with no game config at all', () => {
    // An older table, or one whose summary came from the lobby's fallback row. Blinds cannot be
    // shown without the config that holds them, so it says what the table IS instead.
    expect(stakeLabel({ game: 'poker' })).toBe("Texas Hold'em");
    // No game named at all is poker, because that is what every table opened before games were.
    expect(stakeLabel({})).toBe("Texas Hold'em");
  });
});
