/**
 * The coach's words at a hold'em table.
 *
 * Two things are being pinned here. THE MOVE IS NAMED CORRECTLY — "raise to 24", never "raise 24",
 * because the engine's amount is the new total street bet and a player who reads it the other way
 * loses a pot rather than a moment. And THE PRICE IS SAID, every time there is one, because that is
 * the number a beginner is actually missing and it is nowhere on the felt.
 */
import { describe, expect, it } from 'vitest';
import { actionWords, pokerAlerts, spokenAction, spokenPokerLine } from './pokerWords';
import { newAlerts } from './alerts';
import type { TableEvent, TableView } from './types';

const nameOf = (s: number) => ['You', 'Sharkbot', 'The Bluffer', 'Deep Thought'][s] ?? `Seat ${s + 1}`;
const ctx = { seatName: nameOf, viewerSeat: 0 };

function view(over: Record<string, unknown> = {}, handOver: Record<string, unknown> = {}): TableView {
  return {
    config: { seats: 6, smallBlind: 1, bigBlind: 2, ante: 0, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 30_000 },
    seats: [0, 1, 2].map((seat) => ({
      seat,
      playerId: `p${seat}`,
      stack: 200,
      status: 'active',
      waitingForBigBlind: false,
      inHand: { streetBet: 0, totalBet: 0, folded: false, allIn: false },
    })),
    button: 0,
    handNo: 4,
    hand: {
      handNo: 4,
      seedCommit: 'x',
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      street: 'flop',
      board: ['2c', '7d', 'Ks'],
      pots: [{ amount: 30, eligible: [0, 1, 2] }],
      toAct: 0,
      currentBet: 0,
      minRaise: 2,
      actions: [],
      actionDeadline: null,
      ...handOver,
    },
    viewerSeat: 0,
    legal: { fold: true, check: true, call: null, bet: null, raise: null, allIn: 200 },
    ...over,
  } as unknown as TableView;
}

describe('naming a move', () => {
  it('says raise TO, because the amount is the new total and not the increment', () => {
    expect(actionWords({ type: 'raise', amount: 24 })).toBe('Raise to 24');
  });

  it('puts the price on the call button, because that is the whole decision', () => {
    expect(actionWords({ type: 'call' }, { fold: true, check: false, call: 8, bet: null, raise: null, allIn: 200 })).toBe('Call 8');
    // No legal actions to read the price off: still a button, just without a number it cannot know.
    expect(actionWords({ type: 'call' })).toBe('Call');
  });

  it('has a word for every move the engine has, including the one spelled with a hyphen', () => {
    expect(actionWords({ type: 'fold' })).toBe('Fold');
    expect(actionWords({ type: 'check' })).toBe('Check');
    expect(actionWords({ type: 'bet', amount: 12 })).toBe('Bet 12');
    expect(actionWords({ type: 'all-in' })).toBe('All in');
    expect(spokenAction({ type: 'all-in' })).toBe('all in');
  });

  it('does not throw on an answer from an adviser it cannot read', () => {
    // Advice can come from somebody else's agent, so the action is whatever they sent.
    expect(actionWords(null)).toBe('act');
    expect(actionWords({ type: 'interpretive-dance' })).toBe('Act');
  });
});

describe('what is said out loud', () => {
  it('names the actor and the move, short enough to finish before the next one', () => {
    const ev = { type: 'action', record: { seat: 1, street: 'flop', action: { type: 'raise', amount: 18 }, amount: 18 } } as TableEvent;
    expect(spokenPokerLine(ev, ctx)).toBe('Sharkbot raises to 18.');
  });

  it('says the street rather than reading the board out card by card', () => {
    // Three cards spoken one at a time outruns a table that moves every couple of seconds, and the
    // cards are on screen anyway. What a player needs to HEAR is that the hand just changed.
    expect(spokenPokerLine({ type: 'street', street: 'turn', board: [] } as TableEvent, ctx)).toBe('Turn.');
  });

  it('stays quiet about the events that do not need a voice', () => {
    expect(spokenPokerLine({ type: 'pots', pots: [] } as TableEvent, ctx)).toBeNull();
    expect(spokenPokerLine({ type: 'hole-cards', seat: 0, cards: ['As', 'Ks'], private: true } as TableEvent, ctx)).toBeNull();
  });
});

describe('the moments worth interrupting for', () => {
  const texts = (v: TableView | null, seat: number | null = 0) => pokerAlerts(v, seat, nameOf).map((a) => a.text);

  it('says what a call costs and how often it therefore has to be best', () => {
    const v = view({ legal: { fold: true, check: false, call: 10, bet: null, raise: null, allIn: 200 } });
    // 10 into 30 wins 40, so it needs to be good 25% of the time.
    expect(texts(v).some((t) => t.includes('10 to win 40') && t.includes('25%'))).toBe(true);
  });

  it('calls a bad price a lot, and a good one only a number', () => {
    const dear = view(
      { legal: { fold: true, check: false, call: 90, bet: null, raise: null, allIn: 200 } },
      { pots: [{ amount: 30, eligible: [0, 1, 2] }] },
    );
    expect(texts(dear).some((t) => t.includes('which is a lot'))).toBe(true);
  });

  it('says nothing about a price when it is not your decision', () => {
    // The legal actions on the view are the viewer's, but they are only a decision on their turn.
    const v = view({ legal: { fold: true, check: false, call: 10, bet: null, raise: null, allIn: 200 } }, { toAct: 1 });
    expect(texts(v).some((t) => t.includes('to win'))).toBe(false);
  });

  it('says when the hand has become heads-up, and names who is left', () => {
    const v = view();
    (v.seats[2] as { inHand: { folded: boolean } }).inHand.folded = true;
    expect(texts(v).some((t) => t.includes('Sharkbot') && t.includes('weaker hand is worth more'))).toBe(true);
  });

  it('says when you are short, in big blinds, because that is the unit the decision is in', () => {
    const v = view();
    (v.seats[0] as { stack: number }).stack = 20;
    expect(texts(v).some((t) => t.includes('10 big blinds'))).toBe(true);
  });

  it('says when the pot has outgrown the stack behind it', () => {
    const v = view({}, { pots: [{ amount: 240, eligible: [0, 1, 2] }] });
    expect(texts(v).some((t) => t.includes('the hand is for your stack'))).toBe(true);
  });

  it('has nothing to say between hands, or to a spectator', () => {
    expect(texts(view({ hand: null }))).toEqual([]);
    expect(texts(view(), null)).toEqual([]);
    expect(texts(null)).toEqual([]);
  });

  it('fires each warning once, so it does not become noise', () => {
    const v = view();
    (v.seats[0] as { stack: number }).stack = 20;
    const all = pokerAlerts(v, 0, nameOf);
    const seen = new Set(all.map((a) => a.key));
    expect(newAlerts(pokerAlerts(v, 0, nameOf), seen)).toEqual([]);
  });

  it('asks again in a new hand, because the same warning is new news on a new deal', () => {
    const v = view();
    (v.seats[0] as { stack: number }).stack = 20;
    const seen = new Set(pokerAlerts(v, 0, nameOf).map((a) => a.key));
    const next = view({}, { handNo: 5 });
    (next.seats[0] as { stack: number }).stack = 20;
    expect(newAlerts(pokerAlerts(next, 0, nameOf), seen).length).toBeGreaterThan(0);
  });
});
