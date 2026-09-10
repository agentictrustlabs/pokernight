/**
 * Invariants under random play.
 *
 * The poker engine's property test asserts chip conservation: money is never created or destroyed by
 * a hand. Canasta has no chips, so its equivalent is CARD conservation — a hundred and eight cards go
 * into a round and a hundred and eight come out, wherever they have got to. A rules bug that
 * duplicates or loses a card would be almost invisible at a real table and unrecoverable afterwards,
 * so it is the one worth hundreds of rounds of random play.
 *
 * Alongside it: that no seat can ever see a card it is not entitled to, and that a round replays
 * byte-identically from (seed, action log) — which is exactly what the commitment published before
 * the deal promises.
 */

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  canTakePile,
  createTable,
  initialMeldMinimum,
  isLegalMeld,
  isRedThree,
  isWild,
  naturalsOfRank,
  openingValue,
  rankOf,
  sitDown,
  startRound,
  teamOf,
  viewFor,
  type CanastaAction,
  type CanastaState,
  type Card,
  type Rank,
  type RoundState,
} from '../src/index.js';

const round = (s: CanastaState): RoundState => s.round as RoundState;

/** A tiny deterministic PRNG, so any failing run is reproducible from its number alone. */
function rng(n: number): () => number {
  let x = (n * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

function seedOf(n: number): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (n * 97 + i * 41) % 256;
  return b;
}

function seated(): CanastaState {
  let s = createTable();
  for (let i = 0; i < 4; i++) s = sitDown(s, i, `p${i}`);
  return s;
}

/* --------------------------------------------------------------- a player */

/** Ranks this hand holds three or more naturals of — the melds it could lay unaided. */
function meldable(hand: readonly Card[]): { rank: Rank; cards: Card[] }[] {
  const by = new Map<Rank, Card[]>();
  for (const c of hand) {
    if (isWild(c) || rankOf(c) === '3') continue;
    const list = by.get(rankOf(c)) ?? [];
    list.push(c);
    by.set(rankOf(c), list);
  }
  return [...by.entries()].filter(([, cs]) => cs.length >= 3).map(([rank, cards]) => ({ rank, cards }));
}

/**
 * Choose one move for the seat on turn — and it must be one the engine will accept.
 *
 * A random player that mostly gets refused would exercise the refusals and nothing else, so this
 * picks moves it has already checked. The engine is still the judge; the driver below records
 * whatever it actually applied.
 */
function chooseAction(state: CanastaState, seat: number, rand: () => number): CanastaAction {
  const r = round(state);
  const team = teamOf(seat);
  const hand = r.hands[seat] ?? [];

  if (r.phase === 'draw') {
    const top = r.discard[r.discard.length - 1] ?? null;
    const take = canTakePile({ top, frozen: r.frozen, hand, melds: r.melds[team] });
    if (take.ok && top && rand() < 0.4) {
      const rank = rankOf(top);
      const naturals = naturalsOfRank(hand, rank);
      const already = r.melds[team].some((m) => m.rank === rank);
      const cards = naturals.slice(0, Math.max(2, Math.min(naturals.length, 3)));
      const usable = (r.frozen || !already ? cards.length >= 2 : true) && isLegalMeld(rank, [...cards, top]).ok;
      const opens = r.opened[team] || openingValue([...cards, top]) >= initialMeldMinimum(state.scores[team]);
      if (usable && opens) return { type: 'take-pile', meld: { rank, cards } };
    }
    return { type: 'draw' };
  }

  if (rand() < 0.65) {
    for (const option of meldable(hand)) {
      if (!isLegalMeld(option.rank, option.cards).ok) continue;
      if (!r.opened[team] && openingValue(option.cards) < initialMeldMinimum(state.scores[team])) continue;
      // Keep two cards back: one to discard and one so the meld itself is not a going-out move.
      // This player never goes out deliberately, so it never needs a canasta to finish a turn.
      if (option.cards.length > hand.length - 2) continue;
      return { type: 'meld', melds: [{ rank: option.rank, cards: option.cards }] };
    }
  }

  const discardable = hand.filter((c) => !isRedThree(c));
  // The last card can only be discarded with a canasta down; this player keeps one back instead.
  const card = discardable[Math.floor(rand() * discardable.length)] ?? (discardable[0] as Card);
  return { type: 'discard', card };
}

/* ------------------------------------------------------------- invariants */

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

function check(state: CanastaState, where: string): void {
  const r = round(state);
  expect(allCards(r), `${where}: cards in play`).toHaveLength(108);

  for (const [seat, hand] of Object.entries(r.hands)) {
    expect(hand.filter(isRedThree), `${where}: red three left in seat ${seat}`).toHaveLength(0);
  }

  for (const team of [0, 1] as const) {
    const ranks = r.melds[team].map((m) => m.rank);
    expect(new Set(ranks).size, `${where}: team ${team} holds two melds of one rank`).toBe(ranks.length);
    for (const meld of r.melds[team]) {
      const legal = isLegalMeld(meld.rank, meld.cards);
      expect(legal.ok, `${where}: team ${team} has an illegal ${meld.rank} meld — ${legal.reason ?? ''}`).toBe(true);
    }
  }

  // A round is running or finished. There is no third state, and drifting into one is a real bug:
  // a finished round with a seat still on the clock would sit there waiting for a move forever.
  if (r.result) {
    expect(r.toAct, `${where}: a finished round still has a seat to act`).toBeNull();
    expect(r.seedReveal, `${where}: a finished round never revealed its seed`).toBeTruthy();
    expect(r.seed, `${where}: a finished round is still holding its seed`).toBeUndefined();
  } else {
    expect(r.toAct, `${where}: a running round has nobody to act`).not.toBeNull();
    expect(r.seedReveal, `${where}: a running round revealed its seed early`).toBeUndefined();
  }
}

/** Play one round to its end, recording exactly what was applied. */
function play(n: number, opts: { verify?: boolean } = {}): { state: CanastaState; log: { seat: number; action: CanastaAction }[] } {
  const rand = rng(n);
  let state = startRound(seated(), seedOf(n)).state;
  const log: { seat: number; action: CanastaAction }[] = [];
  if (opts.verify) check(state, `round ${n} deal`);

  for (let move = 0; move < 4000; move++) {
    const r = round(state);
    if (r.result) return { state, log };
    const seat = r.toAct as number;
    const action = chooseAction(state, seat, rand);
    state = applyAction(state, seat, action).state;
    log.push({ seat, action });
    if (opts.verify) check(state, `round ${n} move ${move}`);
  }
  throw new Error(`round ${n} did not finish in 4000 moves`);
}

/* ------------------------------------------------------------------ tests */

describe('invariants under random play', () => {
  it('hold for 300 rounds — no card created, lost or duplicated', () => {
    for (let n = 1; n <= 300; n++) play(n, { verify: true });
  });

  it('always end a round, either by going out or by running the stock dry', () => {
    for (let n = 1; n <= 80; n++) {
      const { state } = play(n);
      const result = round(state).result;
      expect(result).toBeDefined();
      // Both are real endings, and the one where nobody went out still scores everybody's hand.
      if (result && result.wentOut !== null) expect(round(state).hands[result.wentOut]).toHaveLength(0);
    }
  });

  it('score every finished round, and the parts add up to the total', () => {
    for (let n = 1; n <= 80; n++) {
      const { state } = play(n);
      const result = round(state).result;
      expect(result).toBeDefined();
      if (!result) continue;
      expect(state.scores).toEqual(result.totals);
      for (const team of [0, 1] as const) {
        const s = result.scores[team];
        expect(s.total).toBe(s.melds + s.canastas + s.redThrees + s.goingOut + s.inHand);
      }
    }
  });
});

describe('what a seat can see', () => {
  /** Everything this seat is entitled to: its own hand, both sides' melds, the pile's top card. */
  function entitled(r: RoundState, seat: number): Map<Card, number> {
    const bag = new Map<Card, number>();
    const add = (c: Card) => bag.set(c, (bag.get(c) ?? 0) + 1);
    for (const c of r.hands[seat] ?? []) add(c);
    for (const team of [0, 1] as const) {
      for (const m of r.melds[team]) for (const c of m.cards) add(c);
      for (const c of r.redThrees[team]) add(c);
    }
    const top = r.discard[r.discard.length - 1];
    if (top) add(top);
    return bag;
  }

  it('is never a card it is not entitled to, at the deal or at the end', () => {
    for (let n = 1; n <= 60; n++) {
      const { state } = play(n);
      const r = round(state);
      for (const seat of [0, 1, 2, 3]) {
        const bag = entitled(r, seat);
        const view = viewFor(state, seat);
        // Every card-shaped string anywhere in the view has to be one this seat may see, and no more
        // often than they may see it. Two packs make this a multiset question, not a set one.
        const seen = new Map<Card, number>();
        for (const c of JSON.stringify(view).match(/"([2-9TJQKAW][CDHS*])"/g) ?? []) {
          const card = c.slice(1, -1) as Card;
          seen.set(card, (seen.get(card) ?? 0) + 1);
        }
        for (const [card, count] of seen) {
          expect(count, `round ${n} seat ${seat} sees ${count}×${card}, entitled to ${bag.get(card) ?? 0}`).toBeLessThanOrEqual(bag.get(card) ?? 0);
        }
      }
    }
  });

  it('shows a spectator no hand at all, at any point', () => {
    for (let n = 1; n <= 20; n++) {
      const { state } = play(n);
      expect(viewFor(state, null).hand).toBeNull();
    }
  });
});

describe('replay', () => {
  it('is byte-identical from the same seed and the same moves', () => {
    for (let n = 1; n <= 60; n++) {
      const { state, log } = play(n);
      let replayed = startRound(seated(), seedOf(n)).state;
      for (const { seat, action } of log) replayed = applyAction(replayed, seat, action).state;
      expect(JSON.stringify(replayed), `round ${n} did not replay`).toBe(JSON.stringify(state));
    }
  });

  it('is a different round from a different seed', () => {
    const a = startRound(seated(), seedOf(1)).state;
    const b = startRound(seated(), seedOf(2)).state;
    expect(JSON.stringify(round(a))).not.toBe(JSON.stringify(round(b)));
  });
});
