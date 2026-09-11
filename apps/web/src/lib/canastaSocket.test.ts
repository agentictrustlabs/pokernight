/**
 * The canasta reducer.
 *
 * The property it holds that matters most is the one about the CONTROLS: a turn is only live while
 * the server has said it is, and it goes the instant the view says otherwise. A stale legal set left
 * on screen is how a player presses a button for a turn they no longer have — and in a game where a
 * move is "these cards, that way", the move that goes through is one they never meant.
 */
import { describe, expect, it } from 'vitest';
import type { CanastaLegal, CanastaView } from './canasta';
import { LOG_LIMIT } from './tableSocket';
import {
  dismissCanastaError,
  dismissTookPile,
  initialCanastaState,
  reduceCanasta,
  seatOf,
  setCanastaConnection,
  type CanastaServerMessage,
} from './canastaSocket';

const LEGAL: CanastaLegal = {
  phase: 'play',
  canDraw: false,
  canTakePile: false,
  takePileReason: null,
  pileTop: '7C',
  pileSize: 3,
  minimumMeld: 50,
  discardable: ['7C', 'KD'],
  canGoOut: false,
};

function view(over: Partial<CanastaView> = {}): CanastaView {
  return {
    roundNo: 1,
    seedCommit: 'abc',
    seedReveal: null,
    dealer: 0,
    toAct: 0,
    phase: 'draw',
    actionDeadline: 1_700_000_030_000,
    stock: 80,
    pileTop: '7C',
    pileSize: 3,
    frozen: false,
    target: 5000,
    scores: { 0: 0, 1: 0 },
    winner: null,
    melds: { 0: [], 1: [] },
    redThrees: { 0: 0, 1: 0 },
    seats: [
      { seat: 0, playerId: 'p-alice', status: 'active', cards: 11, team: 0 },
      { seat: 1, playerId: 'p-bob', status: 'active', cards: 11, team: 1 },
      { seat: 2, playerId: 'p-carol', status: 'active', cards: 11, team: 0 },
      { seat: 3, playerId: 'p-dan', status: 'active', cards: 11, team: 1 },
    ],
    hand: ['7C', 'KD'],
    result: null,
    ...over,
  } as CanastaView;
}

const welcome = (v = view(), playerId: string | null = 'p-alice'): CanastaServerMessage => ({
  type: 'welcome',
  tableId: 't-1',
  game: 'canasta',
  playerId,
  view: v,
  names: { 'p-alice': 'Alice', 'p-bob': 'Bob' },
});

describe('welcome', () => {
  it('adopts the view, the names and who the viewer is', () => {
    const s = reduceCanasta(initialCanastaState, welcome());
    expect(s.tableId).toBe('t-1');
    expect(s.playerId).toBe('p-alice');
    expect(s.view?.seats).toHaveLength(4);
    expect(s.names['p-bob']).toBe('Bob');
    expect(s.connection).toBe('open');
  });

  it('gives NO turn from a view alone, because a view carries no legal moves', () => {
    // It is seat 0's turn and seat 0 is the viewer — and the controls still stay dead until the
    // server says what is legal. A client must not guess at legality in a game whose legality
    // depends on cards it does not hold.
    const s = reduceCanasta(initialCanastaState, welcome());
    expect(s.view?.toAct).toBe(0);
    expect(s.turn).toBeNull();
  });

  it('finds the viewer’s seat from the view, and none for a spectator', () => {
    expect(seatOf(view(), 'p-carol')).toBe(2);
    expect(seatOf(view(), 'p-nobody')).toBeNull();
    expect(seatOf(view(), null)).toBeNull();
    expect(seatOf(null, 'p-alice')).toBeNull();
  });

  it('does not mutate what it was given', () => {
    const before = Object.freeze({ ...initialCanastaState, names: { x: 'X' } });
    const after = reduceCanasta(before, welcome());
    expect(after).not.toBe(before);
    expect(before.names).toEqual({ x: 'X' });
  });
});

describe('the turn', () => {
  const turn = (): CanastaServerMessage => ({ type: 'turn', handNo: 1, seat: 0, legal: LEGAL, deadline: 1_700_000_030_000 });

  it('arrives with its legal moves and its clock', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, turn());
    expect(s.turn).toEqual({ roundNo: 1, seat: 0, legal: LEGAL, deadline: 1_700_000_030_000 });
  });

  it('survives a snapshot that still has the viewer to act, and takes the fresh deadline', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, turn());
    s = reduceCanasta(s, { type: 'snapshot', view: view({ actionDeadline: 1_700_000_099_000 }), names: {} });
    expect(s.turn?.legal).toEqual(LEGAL);
    expect(s.turn?.deadline).toBe(1_700_000_099_000);
  });

  it('GOES when the turn moves on', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, turn());
    s = reduceCanasta(s, { type: 'snapshot', view: view({ toAct: 1 }), names: {} });
    expect(s.turn).toBeNull();
  });

  it('GOES when the round ends, whoever was to act', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, turn());
    s = reduceCanasta(s, { type: 'snapshot', view: view({ result: {} as never }), names: {} });
    expect(s.turn).toBeNull();
  });

  it('GOES when a new round starts, even with the same seat to act', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, turn());
    s = reduceCanasta(s, { type: 'snapshot', view: view({ roundNo: 2 }), names: {} });
    expect(s.turn).toBeNull();
  });

  it('GOES when the server refuses a move as out of turn', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, turn());
    s = reduceCanasta(s, { type: 'error', code: 'not-your-turn', message: 'not your turn' });
    expect(s.turn).toBeNull();
    expect(s.error?.code).toBe('not-your-turn');
    expect(dismissCanastaError(s).error).toBeNull();
  });

  it('is kept when a refusal is about something else', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, turn());
    s = reduceCanasta(s, { type: 'error', code: 'illegal-action', message: 'that meld is short' });
    expect(s.turn).not.toBeNull();
  });
});

describe('events', () => {
  it('are logged in order, and carry the fresh view with them', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, { type: 'event', event: { type: 'drew', seat: 0, stock: 79 }, view: view({ stock: 79, phase: 'play' }) });
    s = reduceCanasta(s, { type: 'event', event: { type: 'discarded', seat: 0, card: 'KD', frozen: false }, view: view({ toAct: 1, stock: 79 }) });
    expect(s.log.map((e) => e.type)).toEqual(['drew', 'discarded']);
    expect(s.view?.stock).toBe(79);
  });

  it('learn a name from a seat taken mid-round', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, {
      type: 'event',
      event: { type: 'seat-joined', seat: 3, playerId: 'p-dan', name: 'Dan', kind: 'human' },
      view: view(),
    });
    expect(s.names['p-dan']).toBe('Dan');
    expect(s.players['p-dan']?.kind).toBe('human');
  });

  it('forget a player who left', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, { type: 'event', event: { type: 'seat-joined', seat: 3, playerId: 'p-dan', name: 'Dan', kind: 'human' }, view: view() });
    s = reduceCanasta(s, { type: 'event', event: { type: 'seat-left', seat: 3, playerId: 'p-dan' }, view: view() });
    expect(s.players['p-dan']).toBeUndefined();
  });
});

describe('the connection', () => {
  it('is set without touching anything else, and not re-set to what it already is', () => {
    const s = reduceCanasta(initialCanastaState, welcome());
    const down = setCanastaConnection(s, 'reconnecting');
    expect(down.connection).toBe('reconnecting');
    expect(down.view).toBe(s.view);
    expect(setCanastaConnection(down, 'reconnecting')).toBe(down);
  });
});

/**
 * THE LOG IS CAPPED, SO ITS LENGTH IS NOT A POSITION IN A STREAM.
 *
 * Once it is full its length stops changing while its contents keep moving, and anything tracking
 * where it had got to by length therefore stops seeing new events at exactly the cap. That is what
 * silenced the coach's commentary partway through every round: it talked, and then it did not, and
 * nothing about the table had changed.
 */
describe('counting events', () => {
  const drew = (stock: number): CanastaServerMessage => ({
    type: 'event',
    event: { type: 'drew', seat: 1, stock },
    view: view({ stock }),
  });

  it('counts every arrival, not what is still in the log', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    expect(s.logSeq).toBe(0);
    for (let i = 0; i < 5; i++) s = reduceCanasta(s, drew(100 - i));
    expect(s.log).toHaveLength(5);
    expect(s.logSeq).toBe(5);
  });

  it('KEEPS counting after the log is full and its length stops moving', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    for (let i = 0; i < LOG_LIMIT + 20; i++) s = reduceCanasta(s, drew(200 - i));
    expect(s.log.length, 'the log grew past its cap').toBe(LOG_LIMIT);
    expect(s.logSeq, 'the count stopped when the log filled').toBe(LOG_LIMIT + 20);
    // …and one more still counts, which is the whole point.
    s = reduceCanasta(s, drew(1));
    expect(s.log).toHaveLength(LOG_LIMIT);
    expect(s.logSeq).toBe(LOG_LIMIT + 21);
  });

  it('keeps the NEWEST events when it overflows', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    for (let i = 0; i < LOG_LIMIT + 3; i++) s = reduceCanasta(s, drew(500 - i));
    const last = s.log[s.log.length - 1] as { stock?: number };
    expect(last.stock).toBe(500 - (LOG_LIMIT + 2));
  });
});

/**
 * WHAT JUST HAPPENED TO YOUR OWN CARDS.
 *
 * Both of these ride on PRIVATE events, which only ever arrive for the seat they belong to — so the
 * reducer never has to ask whose they are, and one seat's draw can never mark up another's hand.
 */
describe('the card you just drew', () => {
  const drewCard = (card: string, v = view()): CanastaServerMessage =>
    ({ type: 'event', event: { type: 'drew-card', seat: 0, card, private: true }, view: v }) as CanastaServerMessage;

  it('is remembered, so the hand can point at it', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, drewCard('KD'));
    expect(s.drawn).toBe('KD');
  });

  it('is forgotten when YOUR OWN discard ends the turn', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, drewCard('KD'));
    s = reduceCanasta(s, { type: 'event', event: { type: 'discarded', seat: 0, card: 'KD', frozen: false }, view: view() } as CanastaServerMessage);
    expect(s.drawn).toBeNull();
  });

  it('survives everybody ELSE discarding, which happens three times a lap', () => {
    // The first version cleared the highlight on any `discarded` event, so the card you drew stopped
    // being marked the moment the next player threw something away.
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, drewCard('KD'));
    for (const seat of [1, 2, 3]) {
      s = reduceCanasta(s, { type: 'event', event: { type: 'discarded', seat, card: '4H', frozen: false }, view: view() } as CanastaServerMessage);
    }
    expect(s.drawn).toBe('KD');
  });

  it('is forgotten when a new round starts, because nothing from the last one is worth pointing at', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, drewCard('KD'));
    s = reduceCanasta(s, {
      type: 'event',
      event: { type: 'round-started', roundNo: 2, seedCommit: 'x', dealer: 1, stock: 80 },
      view: view({ roundNo: 2 }),
    } as CanastaServerMessage);
    expect(s.drawn).toBeNull();
  });
});

describe('the pile you just took', () => {
  const took = (v = view()): CanastaServerMessage =>
    ({
      type: 'event',
      event: {
        type: 'took-pile-cards',
        seat: 0,
        cards: ['4H', 'KD', '9S', '7C'],
        top: '7C',
        toMeld: ['7D', '7H', '7C'],
        toHand: ['4H', 'KD', '9S'],
        private: true,
      },
      view: v,
    }) as CanastaServerMessage;

  it('keeps the pile, and what became of every card in it', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, took());
    expect(s.took?.cards).toHaveLength(4);
    expect(s.took?.top).toBe('7C');
    expect(s.took?.toHand).toEqual(['4H', 'KD', '9S']);
    // The top card came from the PILE; the other two in the meld came from the hand. That is the
    // distinction the reveal is about, and it is why the top card is carried separately.
    expect(s.took?.toMeld).toContain('7C');
  });

  it('counts each take separately, so a second pile is a second reveal', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, took());
    const first = s.took?.seq as number;
    s = reduceCanasta(s, took());
    expect(s.took?.seq).toBe(first + 1);
  });

  it('is dismissed once, and nothing brings it back', () => {
    let s = reduceCanasta(initialCanastaState, welcome());
    s = reduceCanasta(s, took());
    s = dismissTookPile(s);
    expect(s.took).toBeNull();
    // Idempotent: dismissing nothing is not a new state object.
    expect(dismissTookPile(s)).toBe(s);
  });
});
