/**
 * The few moments worth interrupting for.
 *
 * A commentary that says what everybody did is a record. What a learner needs on top of it is the
 * handful of moments where something is ABOUT to matter and they cannot yet see it — and the rule
 * that keeps that useful is that each one is said ONCE. A warning repeated every turn is noise, and
 * noise is what gets a coach muted.
 */
import { describe, expect, it } from 'vitest';
import { alertsFor, newAlerts } from './alerts';
import type { CanastaView } from './canasta';

const nameOf = (s: number) => ['Melder', 'Alice', 'Pile Hawk', 'Red Three'][s] ?? `Seat ${s + 1}`;

function view(over: Record<string, unknown> = {}): CanastaView {
  return {
    roundNo: 1,
    seedCommit: 'x',
    seedReveal: null,
    dealer: 0,
    toAct: 1,
    phase: 'play',
    actionDeadline: null,
    stock: 60,
    pileTop: '7C',
    pileSize: 2,
    frozen: false,
    target: 5000,
    scores: { 0: 0, 1: 0 },
    winner: null,
    melds: { 0: [], 1: [] },
    redThrees: { 0: 0, 1: 0 },
    seats: [0, 1, 2, 3].map((seat) => ({ seat, playerId: `p${seat}`, status: 'active', cards: 11, team: (seat % 2) as 0 | 1 })),
    hand: [],
    result: null,
    ...over,
  } as CanastaView;
}

const texts = (v: CanastaView, seat: number | null = 1) => alertsFor(v, seat, nameOf).map((a) => a.text);

describe('a quiet table says nothing', () => {
  it('at the start of an ordinary round', () => {
    expect(alertsFor(view(), 1, nameOf)).toEqual([]);
  });

  it('once the round is scored, because it is too late to act on any of it', () => {
    expect(alertsFor(view({ result: {}, pileSize: 20, stock: 2 }), 1, nameOf)).toEqual([]);
  });
});

describe('the pile', () => {
  it('is called out once it is big enough to change the game', () => {
    expect(texts(view({ pileSize: 9 }))[0]).toMatch(/pile is up to 9 cards/);
    expect(texts(view({ pileSize: 6 }))).toEqual([]);
  });

  it('says a frozen pile needs two naturals, which nothing on the cards shows', () => {
    expect(texts(view({ frozen: true, pileSize: 5 })).join(' ')).toMatch(/frozen.*two natural cards/s);
  });
});

describe('somebody about to go out', () => {
  it('warns you to dump your expensive cards', () => {
    const low = view({ seats: [0, 1, 2, 3].map((seat) => ({ seat, playerId: `p${seat}`, status: 'active', cards: seat === 0 ? 2 : 11, team: (seat % 2) as 0 | 1 })) });
    expect(texts(low)[0]).toBe('Melder has 2 left — get rid of your expensive cards.');
  });

  it('does not tell you to dump them when it is your own PARTNER who is close', () => {
    // Seats 1 and 3 are one side; the viewer is seat 1.
    const partner = view({ seats: [0, 1, 2, 3].map((seat) => ({ seat, playerId: `p${seat}`, status: 'active', cards: seat === 3 ? 2 : 11, team: (seat % 2) as 0 | 1 })) });
    expect(texts(partner)[0]).toBe('Red Three has 2 left.');
  });

  it('says it plainly when the seat is your own', () => {
    const me = view({ seats: [0, 1, 2, 3].map((seat) => ({ seat, playerId: `p${seat}`, status: 'active', cards: seat === 1 ? 3 : 11, team: (seat % 2) as 0 | 1 })) });
    expect(texts(me)[0]).toBe('You are down to 3 cards.');
  });
});

describe('the stock running out', () => {
  it('says what happens when it does, because the round simply stops', () => {
    expect(texts(view({ stock: 5 }))[0]).toMatch(/5 left in the stock.*ends where it stands/s);
    expect(texts(view({ stock: 40 }))).toEqual([]);
  });
});

describe('your side having a canasta', () => {
  it('says what it unlocks — the rule people miss is that you cannot go out without one', () => {
    const withCanasta = view({ melds: { 0: [], 1: [{ rank: '7', cards: [], canasta: true, natural: false }] } });
    expect(texts(withCanasta)[0]).toMatch(/can go out whenever/);
  });

  it('says nothing to a spectator, who has no side', () => {
    const withCanasta = view({ melds: { 0: [], 1: [{ rank: '7', cards: [], canasta: true, natural: false }] } });
    expect(texts(withCanasta, null)).toEqual([]);
  });
});

describe('saying each thing once', () => {
  it('drops what has already been said', () => {
    const v = view({ pileSize: 9, stock: 5 });
    const all = alertsFor(v, 1, nameOf);
    expect(all.length).toBeGreaterThan(1);
    const seen = new Set(all.map((a) => a.key));
    expect(newAlerts(alertsFor(v, 1, nameOf), seen)).toEqual([]);
  });

  it('says the SAME warning again in a new round, because it is new news', () => {
    const first = alertsFor(view({ roundNo: 1, stock: 5 }), 1, nameOf);
    const seen = new Set(first.map((a) => a.key));
    expect(newAlerts(alertsFor(view({ roundNo: 2, stock: 5 }), 1, nameOf), seen)).toHaveLength(1);
  });

  it('says the pile again once it has grown a lot more', () => {
    const seen = new Set(alertsFor(view({ pileSize: 8 }), 1, nameOf).map((a) => a.key));
    expect(newAlerts(alertsFor(view({ pileSize: 9 }), 1, nameOf), seen), 'nagged about one more card').toEqual([]);
    expect(newAlerts(alertsFor(view({ pileSize: 15 }), 1, nameOf), seen)).toHaveLength(1);
  });
});
