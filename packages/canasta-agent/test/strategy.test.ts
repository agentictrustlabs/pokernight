/**
 * One decision at a time, each test named for the RULE it holds rather than the branch it runs.
 *
 * The view and the legal-action set are built by hand here, which is the point: `chooseCanastaAction`
 * reads nothing else, so a decision can be stated as a position — this hand, this pile, this much
 * on the table — and the expected move written next to it. The companion file, `play.test.ts`, is
 * what proves these decisions survive contact with the real engine.
 */

import { describe, expect, it } from 'vitest';
import { isWild, type CanastaLegal, type CanastaView, type Card, type Rank, type TeamId } from '@pokernight/canasta';
import { chooseCanastaAction } from '../src/index.js';

/* -------------------------------------------------------------- fixtures */

function down(rank: Rank, cards: Card[]): { rank: Rank; cards: Card[]; canasta: boolean; natural: boolean } {
  return { rank, cards, canasta: cards.length >= 7, natural: cards.length >= 7 && !cards.some(isWild) };
}

function view(patch: Partial<CanastaView> = {}): CanastaView {
  return {
    roundNo: 1,
    seedCommit: 'commit',
    seedReveal: null,
    dealer: 3,
    toAct: 0,
    phase: 'play',
    actionDeadline: null,
    stock: 40,
    pileTop: null,
    pileSize: 0,
    frozen: false,
    target: 5000,
    scores: { 0: 0, 1: 0 },
    winner: null,
    melds: { 0: [], 1: [] },
    redThrees: { 0: 0, 1: 0 },
    seats: [0, 1, 2, 3].map((seat) => ({ seat, playerId: `p${seat}`, status: 'active', cards: 11, team: (seat % 2) as TeamId })),
    hand: [],
    result: null,
    ...patch,
  };
}

/** `legal` is derived from the view wherever the engine would derive it, so the two cannot drift. */
function legal(v: CanastaView, patch: Partial<CanastaLegal> = {}): CanastaLegal {
  return {
    phase: v.phase,
    canDraw: v.phase === 'draw' && v.stock > 0,
    canTakePile: false,
    takePileReason: null,
    pileTop: v.pileTop,
    pileSize: v.pileSize,
    minimumMeld: 0,
    discardable: v.phase === 'play' ? (v.hand ?? []).slice() : [],
    canGoOut: v.melds[0].some((m) => m.canasta),
    ...patch,
  };
}

const decide = (v: CanastaView, patch: Partial<CanastaLegal> = {}) => chooseCanastaAction(v, legal(v, patch), 0);

/* ------------------------------------------------------------- the pile */

describe('the discard pile is taken for what is under the top card', () => {
  it('takes a pile big enough to be worth the naturals it costs', () => {
    const v = view({ phase: 'draw', pileTop: '8D', pileSize: 5, hand: ['8H', '8S', 'KC', 'KD', '5C'] });
    const { action } = decide(v, { canTakePile: true });
    expect(action.type).toBe('take-pile');
    if (action.type !== 'take-pile') return;
    expect(action.meld.rank).toBe('8');
    expect(action.meld.cards.slice().sort()).toEqual(['8H', '8S']);
  });

  it('leaves a two-card pile that starts nothing — two cards back for two naturals spent is a loss', () => {
    const v = view({ phase: 'draw', pileTop: '8D', pileSize: 2, hand: ['8H', '8S', 'KC', 'KD', '5C'] });
    expect(decide(v, { canTakePile: true }).action.type).toBe('draw');
  });

  it('takes even a one-card pile when the top card walks onto a meld already down', () => {
    const v = view({
      phase: 'draw',
      pileTop: '8S',
      pileSize: 1,
      hand: ['KC', 'KD', '5C'],
      melds: { 0: [down('8', ['8C', '8D', '8H'])], 1: [] },
    });
    const { action } = decide(v, { canTakePile: true });
    expect(action.type).toBe('take-pile');
    // Nothing comes out of the hand: the top card joins the meld on its own.
    if (action.type === 'take-pile') expect(action.meld.cards).toEqual([]);
  });

  it('draws when the engine says the pile is not takeable at all', () => {
    const v = view({ phase: 'draw', pileTop: '8D', pileSize: 9, hand: ['KC', 'KD', '5C'] });
    expect(decide(v, { canTakePile: false, takePileReason: 'you need two natural 8s' }).action.type).toBe('draw');
  });
});

/* ------------------------------------------------------------- opening */

describe('a side opens in one move or not at all', () => {
  it('never lays a meld worth less than the minimum', () => {
    const v = view({ hand: ['4C', '4D', '4H', 'KC', '9S'] });
    // Three fours are fifteen points against a minimum of fifty, and nothing else pairs up.
    expect(decide(v, { minimumMeld: 50 }).action.type).toBe('discard');
  });

  it('combines ranks to reach the minimum, because the engine will not let it be met in halves', () => {
    const v = view({ hand: ['KC', 'KD', 'KH', 'QC', 'QD', 'QH', '5S', '5D'] });
    const { action } = decide(v, { minimumMeld: 50 });
    expect(action.type).toBe('meld');
    if (action.type !== 'meld') return;
    expect(action.melds.map((m) => m.rank).sort()).toEqual(['K', 'Q']);
  });

  it('spends a wild to open, which is the one time a three-card meld is worth one', () => {
    const v = view({ hand: ['KC', 'KD', 'W*', '9S', '9H', '4C'] });
    const { action } = decide(v, { minimumMeld: 50 });
    expect(action.type).toBe('meld');
    if (action.type !== 'meld') return;
    expect(action.melds.flatMap((m) => m.cards)).toContain('W*');
  });
});

/* -------------------------------------------------------------- melding */

describe('what goes down once the side is open', () => {
  it('holds a wild back rather than spend it on a fresh meld of three', () => {
    const v = view({ melds: { 0: [down('5', ['5C', '5D', '5H'])], 1: [] }, hand: ['9C', '9D', 'W*', 'KC', '7H'] });
    const { action } = decide(v);
    // Two nines and a joker is a legal meld and a bad one: that joker is a canasta later.
    expect(action.type).toBe('discard');
    if (action.type === 'discard') expect(action.card).not.toBe('W*');
  });

  it('spends a wild the moment it closes a canasta', () => {
    const v = view({
      melds: { 0: [down('5', ['5C', '5D', '5H', '5S', '5C', '5D'])], 1: [] },
      hand: ['W*', 'KC', '9S', '4D'],
    });
    const { action } = decide(v);
    expect(action.type).toBe('meld');
    if (action.type !== 'meld') return;
    expect(action.melds).toEqual([{ rank: '5', cards: ['W*'] }]);
  });

  it('never melds down to one card, which would leave the turn with no legal end', () => {
    // Three kings are a legal meld and a trap: the hand would be empty, and going out needs a canasta.
    const v = view({ melds: { 0: [down('5', ['5C', '5D', '5H'])], 1: [] }, hand: ['KC', 'KD', 'KH'] });
    expect(decide(v).action.type).toBe('discard');
  });
});

/* --------------------------------------------------------------- go out */

describe('going out', () => {
  it('empties the hand as soon as the side has a canasta', () => {
    const v = view({
      melds: { 0: [down('6', ['6C', '6D', '6H', '6S', '6C', '6D', '6H']), down('K', ['KC', 'KD', 'KH'])], 1: [] },
      hand: ['KS', 'KC'],
    });
    const { action } = decide(v);
    expect(action.type).toBe('meld');
    if (action.type !== 'meld') return;
    expect(action.melds).toHaveLength(1);
    expect(action.melds[0]?.cards.slice().sort()).toEqual(['KC', 'KS']);
  });

  it('discards the last card when the meld is already complete', () => {
    const v = view({
      melds: { 0: [down('6', ['6C', '6D', '6H', '6S', '6C', '6D', '6H'])], 1: [] },
      hand: ['9S'],
    });
    expect(decide(v).action).toEqual({ type: 'discard', card: '9S' });
  });

  it('does not go out without a canasta, however meldable the hand is', () => {
    const v = view({ melds: { 0: [down('6', ['6C', '6D', '6H'])], 1: [] }, hand: ['6S', '6C'] });
    expect(decide(v).action.type).toBe('discard');
  });
});

/* -------------------------------------------------------------- discard */

describe('the discard is the least useful card in hand', () => {
  it('throws the cheapest card when nothing else separates them', () => {
    const v = view({ melds: { 0: [down('5', ['5C', '5D', '5H'])], 1: [] }, hand: ['4C', 'KH', 'AS'] });
    expect(decide(v).action).toEqual({ type: 'discard', card: '4C' });
  });

  it('never throws a red three — it belongs on the table, and the engine refuses it', () => {
    const v = view({ melds: { 0: [down('5', ['5C', '5D', '5H'])], 1: [] }, hand: ['3H', '4C'] });
    expect(decide(v).action).toEqual({ type: 'discard', card: '4C' });
  });

  it('avoids a rank the opponents have down, even at the cost of a dearer card', () => {
    const v = view({
      melds: { 0: [down('K', ['KC', 'KD', 'KH'])], 1: [down('4', ['4C', '4D', '4H'])] },
      hand: ['4C', '9H'],
    });
    // The four is cheaper to hold, and hands the whole pile to the other side for one card.
    expect(decide(v).action).toEqual({ type: 'discard', card: '9H' });
  });

  it('keeps a pair together rather than throw half a meld', () => {
    const v = view({ melds: { 0: [down('K', ['KC', 'KD', 'KH'])], 1: [] }, hand: ['9C', '9D', '8S', 'AH'] });
    // A nine and an eight cost the same to hold, but the second nine is half a meld that is not there yet.
    expect(decide(v).action).toEqual({ type: 'discard', card: '8S' });
  });

  it('would rather throw a black three than anything else that cheap — it stops the pile dead', () => {
    const v = view({ melds: { 0: [down('K', ['KC', 'KD', 'KH'])], 1: [] }, hand: ['3S', '4C', 'QD'] });
    expect(decide(v).action).toEqual({ type: 'discard', card: '3S' });
  });
});

/* -------------------------------------------------------------- always legal */

describe('it always answers', () => {
  it('draws when the phase is draw and there is nothing else to do', () => {
    expect(decide(view({ phase: 'draw', hand: ['KC', 'KD'] })).action).toEqual({ type: 'draw' });
  });

  it('still returns a move when the view is missing its hand', () => {
    const v = view({ phase: 'draw', hand: null });
    expect(decide(v).action).toEqual({ type: 'draw' });
  });
});
