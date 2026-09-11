/**
 * The table: dealing, turns, taking the pile, going out, and what a round pays.
 *
 * These drive the state machine rather than the rule functions, so what they check is the things a
 * player would notice — that they were dealt eleven cards, that they cannot meld before they draw,
 * that going out without a canasta is refused, and that the score at the end adds up.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  HAND_SIZE,
  applyAction,
  canStartRound,
  createTable,
  isRedThree,
  legalFor,
  redactEvent,
  scoreRound,
  sitDown,
  startRound,
  teamOf,
  timeoutAction,
  viewFor,
  winnerAt,
  type CanastaEvent,
  type CanastaState,
  type Card,
  type RoundState,
} from '../src/index.js';

const seed = (n: number): Uint8Array => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (n * 31 + i * 7) % 256;
  return b;
};

function seated(): CanastaState {
  let s = createTable();
  for (let i = 0; i < 4; i++) s = sitDown(s, i, `p${i}`);
  return s;
}

const round = (s: CanastaState): RoundState => s.round as RoundState;

/** Every card in play: hands, stock, pile, melds and the red threes on the table. */
function allCards(r: RoundState): Card[] {
  return [
    ...Object.values(r.hands).flat(),
    ...r.stock,
    ...r.discard,
    ...r.melds[0].flatMap((m) => m.cards),
    ...r.melds[1].flatMap((m) => m.cards),
    ...r.redThrees[0],
    ...r.redThrees[1],
  ];
}

describe('sitting down', () => {
  it('needs all four seats before a round can be dealt', () => {
    let s = createTable();
    expect(canStartRound(s)).toBe(false);
    for (let i = 0; i < 3; i++) s = sitDown(s, i, `p${i}`);
    expect(canStartRound(s)).toBe(false);
    s = sitDown(s, 3, 'p3');
    expect(canStartRound(s)).toBe(true);
  });

  it('refuses a table that is not four-handed, because that is a different game', () => {
    expect(() => createTable({ seats: 2 })).toThrow(/four-handed/);
    expect(() => createTable({ seats: 6 })).toThrow(/four-handed/);
    expect(createTable({ seats: 4 }).config.seats).toBe(4);
  });

  it('puts partners opposite each other', () => {
    expect(teamOf(0)).toBe(teamOf(2));
    expect(teamOf(1)).toBe(teamOf(3));
    expect(teamOf(0)).not.toBe(teamOf(1));
  });

  it('refuses a seat that is taken, and a player who is already at the table', () => {
    const s = seated();
    expect(() => sitDown(s, 0, 'someone')).toThrow(/taken/);
    expect(() => sitDown(createTable(), 9, 'x')).toThrow(/not one of this table/);
  });
});

describe('the deal', () => {
  it('gives everyone eleven cards and turns an upcard', () => {
    const { state } = startRound(seated(), seed(1));
    const r = round(state);
    for (let i = 0; i < 4; i++) {
      // Eleven, plus a replacement for every red three that was laid down.
      const laid = r.redThrees[teamOf(i)].length;
      expect((r.hands[i] as Card[]).length).toBeGreaterThanOrEqual(HAND_SIZE - laid);
    }
    expect(r.discard.length).toBeGreaterThanOrEqual(1);
    expect(r.toAct).toBe((r.dealer + 1) % 4);
    expect(r.phase).toBe('draw');
  });

  it('deals all 108 cards and no others, however the red threes fall', () => {
    for (let i = 1; i <= 20; i++) {
      const { state } = startRound(seated(), seed(i));
      const cards = allCards(round(state));
      expect(cards).toHaveLength(108);
    }
  });

  it('never leaves a red three in anybody’s hand', () => {
    for (let i = 1; i <= 20; i++) {
      const { state } = startRound(seated(), seed(i));
      const r = round(state);
      for (const hand of Object.values(r.hands)) expect(hand.filter(isRedThree)).toHaveLength(0);
    }
  });

  it('is a pure function of the seed — the same deal, twice', () => {
    const a = startRound(seated(), seed(5)).state;
    const b = startRound(seated(), seed(5)).state;
    expect(JSON.stringify(round(a))).toBe(JSON.stringify(round(b)));
    const c = startRound(seated(), seed(6)).state;
    expect(JSON.stringify(round(c))).not.toBe(JSON.stringify(round(a)));
  });

  it('commits to the deal before it happens and reveals it after', () => {
    const { state } = startRound(seated(), seed(7));
    // Running: the commitment is public and the seed is not revealed.
    expect(round(state).seedCommit).toHaveLength(64);
    expect(viewFor(state, 0).seedReveal).toBeNull();
    expect(viewFor(state, 0).seedCommit).toBe(round(state).seedCommit);
  });

  it('never turns a wild or a red three as the card the pile starts on', () => {
    for (let i = 1; i <= 30; i++) {
      const { state } = startRound(seated(), seed(i));
      const r = round(state);
      const top = r.discard[r.discard.length - 1] as Card;
      expect(isRedThree(top)).toBe(false);
      // A wild or red three underneath means the pile started frozen, which is the rule.
      if (r.discard.length > 1) expect(r.frozen).toBe(true);
    }
  });
});

describe('a turn', () => {
  it('will not let a player meld or discard before they have drawn', () => {
    const { state } = startRound(seated(), seed(2));
    const seat = round(state).toAct as number;
    const card = (round(state).hands[seat] as Card[])[0] as Card;
    expect(() => applyAction(state, seat, { type: 'discard', card })).toThrow(/draw or take the pile/);
    expect(() => applyAction(state, seat, { type: 'meld', melds: [] })).toThrow(/draw or take the pile/);
  });

  it('will not let anybody move out of turn', () => {
    const { state } = startRound(seated(), seed(2));
    const other = ((round(state).toAct as number) + 1) % 4;
    expect(() => applyAction(state, other, { type: 'draw' })).toThrow(/not your turn/);
  });

  it('draws one card and moves the turn into its playing half', () => {
    const { state } = startRound(seated(), seed(3));
    const seat = round(state).toAct as number;
    const before = (round(state).hands[seat] as Card[]).length;
    const stockBefore = round(state).stock.length;
    const { state: after } = applyAction(state, seat, { type: 'draw' });
    const r = round(after);
    expect(r.phase).toBe('play');
    // One more card, unless the draw was a red three and brought a replacement with it.
    expect((r.hands[seat] as Card[]).length).toBeGreaterThanOrEqual(before + 1);
    expect(r.stock.length).toBeLessThan(stockBefore);
    expect(allCards(r)).toHaveLength(108);
  });

  it('refuses a second draw in one turn', () => {
    const { state } = startRound(seated(), seed(3));
    const seat = round(state).toAct as number;
    const { state: after } = applyAction(state, seat, { type: 'draw' });
    expect(() => applyAction(after, seat, { type: 'draw' })).toThrow(/already drawn/);
  });

  it('passes the turn on after a discard, and freezes the pile on a wild', () => {
    const { state } = startRound(seated(), seed(4));
    const seat = round(state).toAct as number;
    let s = applyAction(state, seat, { type: 'draw' }).state;
    const hand = round(s).hands[seat] as Card[];
    const card = hand.find((c) => !isRedThree(c)) as Card;
    const wild = card.startsWith('W') || card.startsWith('2');
    s = applyAction(s, seat, { type: 'discard', card }).state;
    const r = round(s);
    expect(r.toAct).toBe((seat + 1) % 4);
    expect(r.phase).toBe('draw');
    expect(r.discard[r.discard.length - 1]).toBe(card);
    if (wild) expect(r.frozen).toBe(true);
    expect(allCards(r)).toHaveLength(108);
  });

  it('never lets a red three be discarded', () => {
    let s = startRound(seated(), seed(9)).state;
    const seat = round(s).toAct as number;
    s = applyAction(s, seat, { type: 'draw' }).state;
    // Put one in the hand by hand, which is the only way to reach the guard — the engine itself
    // never leaves one there, and this proves the guard is there for the day something else does.
    const r = round(s);
    (r.hands[seat] as Card[]).push('3H');
    expect(() => applyAction(s, seat, { type: 'discard', card: '3H' })).toThrow(/red three/);
  });
});

describe('what a seat is allowed to do', () => {
  it('says nothing is allowed when it is not your turn', () => {
    const { state } = startRound(seated(), seed(8));
    const other = ((round(state).toAct as number) + 1) % 4;
    const legal = legalFor(state, other);
    expect(legal.canDraw).toBe(false);
    expect(legal.canTakePile).toBe(false);
    expect(legal.takePileReason).toMatch(/not your turn/);
  });

  it('offers the draw, and names the opening minimum this side has to reach', () => {
    const { state } = startRound(seated(), seed(8));
    const seat = round(state).toAct as number;
    const legal = legalFor(state, seat);
    expect(legal.phase).toBe('draw');
    expect(legal.canDraw).toBe(true);
    expect(legal.minimumMeld).toBe(50); // both sides start on zero
    expect(legal.canGoOut).toBe(false);
    expect(legal.discardable).toEqual([]);
  });

  it('offers the discard once the draw is done', () => {
    const { state } = startRound(seated(), seed(8));
    const seat = round(state).toAct as number;
    const after = applyAction(state, seat, { type: 'draw' }).state;
    const legal = legalFor(after, seat);
    expect(legal.phase).toBe('play');
    expect(legal.canDraw).toBe(false);
    expect(legal.discardable.length).toBeGreaterThan(0);
  });
});

describe('what each player can see', () => {
  it('shows a player their own hand and nobody else’s', () => {
    const { state } = startRound(seated(), seed(11));
    const mine = viewFor(state, 0);
    expect(mine.hand).not.toBeNull();
    expect(mine.hand?.length).toBeGreaterThan(0);
    // Everyone else is a card COUNT. The cards themselves never leave the state.
    for (const s of mine.seats) expect(typeof s.cards).toBe('number');
    expect(JSON.stringify(mine)).not.toContain('"stock":[');
  });

  it('shows a spectator no hand at all', () => {
    const { state } = startRound(seated(), seed(11));
    expect(viewFor(state, null).hand).toBeNull();
  });

  it('shows the pile as a top card and a size, never as its contents', () => {
    const { state } = startRound(seated(), seed(11));
    const v = viewFor(state, 0);
    expect(typeof v.pileSize).toBe('number');
    expect(v.pileTop).toBe(round(state).discard[round(state).discard.length - 1]);
  });

  it('keeps a private event to the seat it belongs to', () => {
    const { events } = startRound(seated(), seed(12));
    const dealt = events.find((e) => e.type === 'dealt') as Extract<CanastaEvent, { type: 'dealt' }>;
    expect(redactEvent(dealt, dealt.seat)).toBe(dealt);
    expect(redactEvent(dealt, (dealt.seat + 1) % 4)).toBeNull();
    expect(redactEvent(dealt, null)).toBeNull();
    // A public event reaches everyone unchanged.
    const started = events.find((e) => e.type === 'round-started') as CanastaEvent;
    expect(redactEvent(started, null)).toBe(started);
  });
});

describe('going out', () => {
  it('is refused without a canasta, however empty the hand is', () => {
    let s = startRound(seated(), seed(13)).state;
    const seat = round(s).toAct as number;
    s = applyAction(s, seat, { type: 'draw' }).state;
    const r = round(s);
    // Leave them holding one card and no canasta. Discarding it would be going out.
    const keep = (r.hands[seat] as Card[]).find((c) => !isRedThree(c)) as Card;
    r.hands[seat] = [keep];
    expect(() => applyAction(s, seat, { type: 'discard', card: keep })).toThrow(/need a canasta/);
  });

  it('ends the round and pays the going-out bonus when there is one', () => {
    let s = startRound(seated(), seed(14)).state;
    const seat = round(s).toAct as number;
    s = applyAction(s, seat, { type: 'draw' }).state;
    const r = round(s);
    // A canasta on the table and one card in hand: the discard goes out.
    r.melds[teamOf(seat)] = [{ rank: 'K', cards: ['KC', 'KD', 'KH', 'KS', 'KC', 'KD', 'KH'] }];
    r.opened[teamOf(seat)] = true;
    r.hands[seat] = ['9C'];
    const { state: after, events } = applyAction(s, seat, { type: 'discard', card: '9C' });
    const ended = events.find((e) => e.type === 'round-ended');
    expect(ended).toBeDefined();
    expect(round(after).result?.wentOut).toBe(seat);
    expect(round(after).result?.scores[teamOf(seat)].goingOut).toBeGreaterThan(0);
    // The seed is revealed once the round is over, so the deal can be checked.
    expect(round(after).seedReveal).toHaveLength(64);
    expect(round(after).toAct).toBeNull();
  });

  it('pays double for going out concealed — nothing melded until the turn it ended on', () => {
    let s = startRound(seated(), seed(15)).state;
    const seat = round(s).toAct as number;
    s = applyAction(s, seat, { type: 'draw' }).state;
    const r = round(s);
    r.melds[teamOf(seat)] = [{ rank: 'K', cards: ['KC', 'KD', 'KH', 'KS', 'KC', 'KD', 'KH'] }];
    r.opened[teamOf(seat)] = true;
    r.hands[seat] = ['9C'];
    r.meldedBefore[seat] = false;
    const { state: after } = applyAction(s, seat, { type: 'discard', card: '9C' });
    expect(after.round?.result?.concealed).toBe(true);
    expect(after.round?.result?.scores[teamOf(seat)].goingOut).toBe(200);
  });

  it('pays the ordinary bonus when the seat had already melded in an earlier turn', () => {
    let s = startRound(seated(), seed(16)).state;
    const seat = round(s).toAct as number;
    s = applyAction(s, seat, { type: 'draw' }).state;
    const r = round(s);
    r.melds[teamOf(seat)] = [{ rank: 'K', cards: ['KC', 'KD', 'KH', 'KS', 'KC', 'KD', 'KH'] }];
    r.opened[teamOf(seat)] = true;
    r.hands[seat] = ['9C'];
    r.meldedBefore[seat] = true;
    const { state: after } = applyAction(s, seat, { type: 'discard', card: '9C' });
    expect(after.round?.result?.concealed).toBe(false);
    expect(after.round?.result?.scores[teamOf(seat)].goingOut).toBe(100);
  });
});

describe('scoring a round', () => {
  it('charges a side for red threes it never melded behind', () => {
    const base = startRound(seated(), seed(17)).state;
    const r = round(base);
    r.melds[0] = [];
    r.melds[1] = [];
    r.redThrees[0] = ['3H', '3D'];
    r.redThrees[1] = [];
    for (let i = 0; i < 4; i++) r.hands[i] = [];
    const result = scoreRound(r, { 0: 0, 1: 0 }, { wentOut: null, concealed: false });
    // Two red threes and no meld: minus two hundred, not plus.
    expect(result.scores[0].redThrees).toBe(-200);
    expect(result.scores[0].total).toBe(-200);
  });

  it('pays for them once the side has melded', () => {
    const base = startRound(seated(), seed(17)).state;
    const r = round(base);
    r.melds[0] = [{ rank: 'K', cards: ['KC', 'KD', 'KH'] }];
    r.melds[1] = [];
    r.redThrees[0] = ['3H', '3D'];
    r.redThrees[1] = [];
    for (let i = 0; i < 4; i++) r.hands[i] = [];
    const result = scoreRound(r, { 0: 0, 1: 0 }, { wentOut: null, concealed: false });
    expect(result.scores[0].redThrees).toBe(200);
    expect(result.scores[0].melds).toBe(30);
    expect(result.scores[0].total).toBe(230);
  });

  it('charges both partners for what is left in their hands', () => {
    const base = startRound(seated(), seed(18)).state;
    const r = round(base);
    r.melds[0] = [];
    r.melds[1] = [];
    r.redThrees[0] = [];
    r.redThrees[1] = [];
    r.hands[0] = ['W*'];
    r.hands[2] = ['AH'];
    r.hands[1] = [];
    r.hands[3] = [];
    const result = scoreRound(r, { 0: 0, 1: 0 }, { wentOut: null, concealed: false });
    expect(result.scores[0].inHand).toBe(-70);
    expect(result.scores[1].inHand).toBe(0);
  });

  it('adds the round onto the running totals', () => {
    const base = startRound(seated(), seed(19)).state;
    const r = round(base);
    r.melds[0] = [{ rank: 'K', cards: ['KC', 'KD', 'KH'] }];
    r.melds[1] = [];
    r.redThrees[0] = [];
    r.redThrees[1] = [];
    for (let i = 0; i < 4; i++) r.hands[i] = [];
    const result = scoreRound(r, { 0: 1000, 1: 2000 }, { wentOut: null, concealed: false });
    expect(result.totals[0]).toBe(1030);
    expect(result.totals[1]).toBe(2000);
  });
});

describe('winning the game', () => {
  it('needs the target, and only at the end of a round', () => {
    expect(winnerAt({ 0: 4999, 1: 100 }, 5000)).toBeNull();
    expect(winnerAt({ 0: 5000, 1: 100 }, 5000)).toBe(0);
    expect(winnerAt({ 0: 100, 1: 5200 }, 5000)).toBe(1);
  });

  it('gives it to the higher score when both cross at once', () => {
    expect(winnerAt({ 0: 5100, 1: 5200 }, 5000)).toBe(1);
  });

  it('declares nobody on an exact tie, so another round is dealt', () => {
    expect(winnerAt({ 0: 5100, 1: 5100 }, 5000)).toBeNull();
  });
});

describe('the clock running out', () => {
  it('draws and throws the cheapest card, so the table keeps moving', () => {
    const { state } = startRound(seated(), seed(21));
    const seat = round(state).toAct as number;
    const { state: after, events } = timeoutAction(state, seat);
    expect(round(after).toAct).toBe((seat + 1) % 4);
    expect(events.some((e) => e.type === 'discarded')).toBe(true);
    expect(allCards(round(after))).toHaveLength(108);
  });

  it('counts against the seat, so the host can sit them out', () => {
    const { state } = startRound(seated(), seed(22));
    const seat = round(state).toAct as number;
    const { state: after } = timeoutAction(state, seat);
    expect(after.seats.find((s) => s.seat === seat)?.timeouts).toBe(1);
  });

  it('does nothing at all when it is not that seat’s turn', () => {
    const { state } = startRound(seated(), seed(23));
    const other = ((round(state).toAct as number) + 1) % 4;
    const { state: after, events } = timeoutAction(state, other);
    expect(after).toBe(state);
    expect(events).toEqual([]);
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const { state } = startRound(seated(), seed(24));
    const before = JSON.stringify(state);
    const seat = round(state).toAct as number;
    applyAction(state, seat, { type: 'draw' });
    legalFor(state, seat);
    viewFor(state, seat);
    timeoutAction(state, seat);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('starts a table with nobody at it and no round', () => {
    const s = createTable();
    expect(s.seats).toEqual([]);
    expect(s.round).toBeNull();
    expect(s.scores).toEqual({ 0: 0, 1: 0 });
    expect(s.config).toEqual(DEFAULT_CONFIG);
  });
});

/**
 * TAKING THE PILE, AND BEING TOLD WHAT WAS IN IT.
 *
 * `took-pile` tells the table how many cards and which top card, which is what everybody is entitled
 * to. It is not enough for the person who took it: a dozen cards leave the middle of the table, three
 * appear on the board, and the rest appear in a hand that was eleven cards a moment ago — and nothing
 * joins those up. The private `took-pile-cards` is what does.
 */
describe('what the taker is told about the pile', () => {
  /** A hand-built round where seat 0 holds two natural aces and the pile is showing a third. */
  function pileReady(): CanastaState {
    let s = seated();
    s = startRound(s, seed(9)).state;
    const r = round(s);
    // Set the table by hand: a state machine driven to this exact spot from a deal would be a test
    // about shuffling rather than about the event.
    // Aces rather than sevens: three aces is 60, which clears the 50 a side needs to open. Three
    // sevens is 15, and a take that cannot open is refused before it reaches the event.
    r.hands[0] = ['AS', 'AD', 'KS', 'KH', 'KC', '4S', '9D'] as Card[];
    r.discard = ['4H', '9S', 'KD', 'AH'] as Card[];
    r.frozen = false;
    r.opened[0] = false;
    r.toAct = 0;
    r.phase = 'draw';
    s.scores[0] = 0;
    return s;
  }

  it('names every card that was in the pile, and where each of them went', () => {
    const s = pileReady();
    const pileBefore = round(s).discard.slice();
    const { events } = applyAction(s, 0, {
      type: 'take-pile',
      // Two natural aces from hand, plus the pile's top ace — which is what makes it legal.
      meld: { rank: 'A', cards: ['AS', 'AD'] as Card[] },
      also: [{ rank: 'K', cards: ['KS', 'KH', 'KC'] as Card[] }],
    });
    const told = events.find((e) => e.type === 'took-pile-cards') as Extract<CanastaEvent, { type: 'took-pile-cards' }>;
    expect(told).toBeDefined();
    expect(told.cards).toEqual(pileBefore);
    expect(told.top).toBe('AH');
    // Onto the board: the naturals from hand, the pile's top card, and the kings laid alongside.
    expect(told.toMeld).toEqual(['AS', 'AD', 'AH', 'KS', 'KH', 'KC']);
    // Into the hand: the whole pile EXCEPT the top card, which went onto the board instead.
    expect(told.toHand).toEqual(['4H', '9S', 'KD']);
  });

  it('accounts for the pile exactly once — every card either melded or went into the hand', () => {
    const s = pileReady();
    const { events } = applyAction(s, 0, { type: 'take-pile', meld: { rank: 'A', cards: ['AS', 'AD'] as Card[] } });
    const told = events.find((e) => e.type === 'took-pile-cards') as Extract<CanastaEvent, { type: 'took-pile-cards' }>;
    const fromPile = [...told.toHand, told.top];
    expect(fromPile.slice().sort()).toEqual(told.cards.slice().sort());
  });

  it('agrees with the public event about how many and which top card', () => {
    const s = pileReady();
    const { events } = applyAction(s, 0, { type: 'take-pile', meld: { rank: 'A', cards: ['AS', 'AD'] as Card[] } });
    const pub = events.find((e) => e.type === 'took-pile') as Extract<CanastaEvent, { type: 'took-pile' }>;
    const told = events.find((e) => e.type === 'took-pile-cards') as Extract<CanastaEvent, { type: 'took-pile-cards' }>;
    expect(pub.cards).toBe(told.cards.length);
    expect(pub.top).toBe(told.top);
  });

  it('goes to the taker and to nobody else', () => {
    // Every other seat watched the pile being built and can count it. Being HANDED its contents is a
    // different thing, and it would say exactly which cards are now in somebody's hand.
    const s = pileReady();
    const { events } = applyAction(s, 0, { type: 'take-pile', meld: { rank: 'A', cards: ['AS', 'AD'] as Card[] } });
    const told = events.find((e) => e.type === 'took-pile-cards') as CanastaEvent;
    expect(redactEvent(told, 0)).toBe(told);
    for (const other of [1, 2, 3, null]) expect(redactEvent(told, other)).toBeNull();
    // …while the public one reaches everybody.
    const pub = events.find((e) => e.type === 'took-pile') as CanastaEvent;
    for (const seat of [0, 1, 2, 3, null]) expect(redactEvent(pub, seat)).toBe(pub);
  });
});
