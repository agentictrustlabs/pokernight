/**
 * THE PORT, EXERCISED BY A GAME THAT IS NOT POKER.
 *
 * The claim this package makes is that a second game can be hosted without editing the first one, the
 * table object, or anything else. A test that only ever ran poker through the port would not test
 * that claim — poker fits because the port was written from it.
 *
 * So this file defines HIGH CARD: deal one card each, highest wins, one round, no betting and no
 * stakes. It shares nothing with Hold'em except being a seated card game with a turn, which is
 * exactly the surface the port is supposed to describe. If the port is right, this is enough to be
 * hostable; if it is wrong, this is where it shows.
 */

import { describe, expect, it } from 'vitest';
import { createGameRegistry, type HostedGame, type TableGame, type TableSnapshot } from '../src/index.js';

/* ------------------------------------------------------------------ high card */

interface HighCardConfig {
  seats: number;
  turnMs: number;
}

interface HighCardSeat {
  seat: number;
  playerId: string;
  card: number | null;
  taken: boolean;
  timeouts: number;
  out: boolean;
}

interface HighCardState {
  config: HighCardConfig;
  seats: HighCardSeat[];
  round: number;
  dealt: boolean;
  toAct: number | null;
  deadline: number | null;
  winner: number | null;
}

type HighCardAction = { type: 'take' } | { type: 'pass' };
type HighCardEvent = { type: string; [k: string]: unknown };

const clone = (s: HighCardState): HighCardState => ({ ...s, seats: s.seats.map((x) => ({ ...x })) });
/** Seat order among those still to act. Deterministic, which is the only property that matters. */
const nextToAct = (s: HighCardState): number | null => s.seats.find((x) => !x.taken && !x.out)?.seat ?? null;

const highCard: TableGame<HighCardState, HighCardAction, unknown, HighCardEvent, HighCardConfig> = {
  id: 'high-card',
  name: 'High Card',
  staked: false,
  actSkill: 'high-card.act',

  create: (config) => {
    const seats = config.seats ?? 4;
    if (seats < 2 || seats > 9) throw new Error('high card seats 2 to 9');
    return { config: { seats, turnMs: config.turnMs ?? 10_000 }, seats: [], round: 0, dealt: false, toAct: null, deadline: null, winner: null };
  },

  snapshot: (state): TableSnapshot => ({
    config: { seats: state.config.seats, minStake: 0, maxStake: 0, turnMs: state.config.turnMs },
    seats: state.seats.map((x) => ({ seat: x.seat, playerId: x.playerId, stack: 0, status: x.out ? 'sitting-out' : 'active', timeouts: x.timeouts })),
    round: state.round,
    roundInProgress: state.dealt && state.winner === null,
    toAct: state.toAct,
    deadline: state.deadline,
  }),

  config: (state) => state.config,

  sitDown: (state, seat, playerId) => {
    const next = clone(state);
    next.seats.push({ seat, playerId, card: null, taken: false, timeouts: 0, out: false });
    next.seats.sort((a, b) => a.seat - b.seat);
    return next;
  },
  standUp: (state, seat) => {
    const next = clone(state);
    next.seats = next.seats.filter((x) => x.seat !== seat);
    return { state: next, refund: 0, events: [{ type: 'left', seat }] };
  },
  addStake: (state) => state,
  sitOut: (state, seat) => {
    const next = clone(state);
    const s = next.seats.find((x) => x.seat === seat);
    if (s) s.out = true;
    return next;
  },
  sitIn: (state, seat) => {
    const next = clone(state);
    const s = next.seats.find((x) => x.seat === seat);
    if (s) s.out = false;
    return next;
  },

  canStart: (state) => !state.dealt && state.seats.filter((x) => !x.out).length >= 2,
  start: (state, seed) => {
    const next = clone(state);
    next.round += 1;
    next.dealt = true;
    next.winner = null;
    // Deterministic from the seed, which is the whole fairness story here as it is at a poker table.
    next.seats.forEach((s, i) => {
      s.card = seed.length ? (seed[i % seed.length] as number) : i;
      s.taken = false;
    });
    next.toAct = nextToAct(next);
    return { state: next, events: [{ type: 'dealt', round: next.round }] };
  },
  legalFor: (state, seat) => (state.toAct === seat ? { take: true, pass: true } : { take: false, pass: false }),

  apply: (state, seat, action) => {
    if (state.toAct !== seat) return { ok: false, reason: 'it is not your turn' };
    const next = clone(state);
    const s = next.seats.find((x) => x.seat === seat);
    if (!s) return { ok: false, reason: 'you are not at this table' };
    s.taken = true;
    if (action.type === 'pass') s.card = -1;
    next.toAct = nextToAct(next);
    const events: HighCardEvent[] = [{ type: 'took', seat }];
    if (next.toAct === null) {
      const best = [...next.seats].sort((a, b) => (b.card ?? -1) - (a.card ?? -1))[0];
      next.winner = best?.seat ?? null;
      next.dealt = false;
      events.push({ type: 'round-ended', winner: next.winner, net: {}, rake: 0 });
    }
    return { ok: true, state: next, events };
  },

  timeout: (state, seat) => {
    const next = clone(state);
    const s = next.seats.find((x) => x.seat === seat);
    if (s) s.timeouts += 1;
    const r = highCard.apply(next, seat, { type: 'pass' });
    return r.ok ? { state: r.state, events: r.events } : { state: next, events: [] };
  },
  setDeadline: (state, deadline) => ({ ...clone(state), deadline }),

  // A seat sees its own card and nobody else's. This is the method that matters most in the port.
  viewFor: (state, seat) => ({
    round: state.round,
    seats: state.seats.map((s) => ({ seat: s.seat, card: seat === s.seat ? s.card : null })),
  }),
  redact: (event, seat) => (event.type === 'dealt-to' && event.seat !== seat ? null : event),

  parseAction: (raw) => {
    const a = raw as { type?: unknown };
    return a?.type === 'take' || a?.type === 'pass'
      ? { ok: true, action: raw as HighCardAction }
      : { ok: false, reason: 'you can take or pass' };
  },
  resultOf: (event) => (event.type === 'round-ended' ? { net: event.net as Record<number, number>, rake: 0 } : null),
};

/* ---------------------------------------------------------------------- tests */

describe('a game that is not poker', () => {
  it('satisfies the port without the port knowing anything about it', () => {
    // The assignment IS the test: `HostedGame` is what the table object holds, and a game that
    // cannot be assigned to it cannot be hosted.
    const hosted: HostedGame = highCard;
    expect(hosted.id).toBe('high-card');
    expect(hosted.staked).toBe(false);
    expect(hosted.actSkill).toBe('high-card.act');
  });

  it('answers every question the host asks, in the host’s words', () => {
    let s = highCard.create({ seats: 3 });
    s = highCard.sitDown(s, 0, 'alice', 0);
    s = highCard.sitDown(s, 1, 'bob', 0);

    const idle = highCard.snapshot(s);
    expect(idle.seats.map((x) => x.playerId)).toEqual(['alice', 'bob']);
    expect(idle.roundInProgress).toBe(false);
    expect(idle.config).toEqual({ seats: 3, minStake: 0, maxStake: 0, turnMs: 10_000 });

    expect(highCard.canStart(s)).toBe(true);
    const dealt = highCard.start(s, new Uint8Array([7, 3]));
    const mid = highCard.snapshot(dealt.state);
    expect(mid.roundInProgress).toBe(true);
    expect(mid.round).toBe(1);
    expect(mid.toAct).toBe(0);
  });

  it('keeps one seat’s card away from another, which is the port’s sharpest requirement', () => {
    let s = highCard.create({ seats: 2 });
    s = highCard.sitDown(s, 0, 'alice', 0);
    s = highCard.sitDown(s, 1, 'bob', 0);
    s = highCard.start(s, new Uint8Array([9, 2])).state;

    const asAlice = highCard.viewFor(s, 0) as { seats: { seat: number; card: number | null }[] };
    expect(asAlice.seats.find((x) => x.seat === 0)?.card).toBe(9);
    expect(asAlice.seats.find((x) => x.seat === 1)?.card).toBeNull();
  });

  it('refuses an action rather than throwing, so a bad move is an answer', () => {
    let s = highCard.create({ seats: 2 });
    s = highCard.sitDown(s, 0, 'alice', 0);
    s = highCard.sitDown(s, 1, 'bob', 0);
    s = highCard.start(s, new Uint8Array([5, 5])).state;

    const outOfTurn = highCard.apply(s, 1, { type: 'take' });
    expect(outOfTurn.ok).toBe(false);
    if (!outOfTurn.ok) expect(outOfTurn.reason).toMatch(/not your turn/);

    expect(highCard.parseAction({ type: 'meld' }).ok).toBe(false);
    expect(highCard.parseAction({ type: 'take' }).ok).toBe(true);
  });

  it('plays a round to the end and reports a result the host can write down', () => {
    let s = highCard.create({ seats: 2 });
    s = highCard.sitDown(s, 0, 'alice', 0);
    s = highCard.sitDown(s, 1, 'bob', 0);
    s = highCard.start(s, new Uint8Array([4, 8])).state;

    const a = highCard.apply(s, 0, { type: 'take' });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = highCard.apply(a.state, 1, { type: 'take' });
    expect(b.ok).toBe(true);
    if (!b.ok) return;

    expect(highCard.snapshot(b.state).roundInProgress).toBe(false);
    const ended = b.events.find((e) => e.type === 'round-ended');
    expect(ended).toBeDefined();
    expect(highCard.resultOf(ended as HighCardEvent)).toEqual({ net: {}, rake: 0 });
    // Bob drew the 8.
    expect((b.state as HighCardState).winner).toBe(1);
  });

  it('counts a timeout, because the host sits out a seat that keeps missing its turn', () => {
    let s = highCard.create({ seats: 2 });
    s = highCard.sitDown(s, 0, 'alice', 0);
    s = highCard.sitDown(s, 1, 'bob', 0);
    s = highCard.start(s, new Uint8Array([1, 2])).state;
    const after = highCard.timeout(s, 0);
    expect(highCard.snapshot(after.state).seats.find((x) => x.seat === 0)?.timeouts).toBe(1);
  });
});

describe('the registry', () => {
  it('holds two games at once and hands back the one that was asked for', () => {
    const other: HostedGame = { ...(highCard as HostedGame), id: 'other', name: 'Other' };
    const r = createGameRegistry([highCard, other]);
    expect(r.ids()).toEqual(['high-card', 'other']);
    expect(r.get('high-card')?.name).toBe('High Card');
    expect(r.get('other')?.name).toBe('Other');
  });

  it('answers null for a game it does not have, so the caller refuses by name', () => {
    expect(createGameRegistry([highCard]).get('poker')).toBeNull();
  });

  it('refuses two games claiming the same id, at construction', () => {
    // Loudly, and at start-up: two games under one id means a table's stamp stops identifying it.
    expect(() => createGameRegistry([highCard, highCard])).toThrow(/two games registered as "high-card"/);
  });
});
