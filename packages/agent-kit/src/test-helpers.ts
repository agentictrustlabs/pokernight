/**
 * Test-only helpers: a TableView fixture builder and a small, honest 7-card
 * evaluator so strength/strategy tests run before the engine's evaluator lands.
 * Not exported from the package index.
 */

import {
  parseCard,
  rankValue,
  type ActionRecord,
  type Card,
  type HandCategory,
  type HandRank,
  type LegalActions,
  type Street,
  type TableView,
} from '@pokernight/engine';
import type { PokerActInput } from '@pokernight/protocol';

export const CONFIG = {
  seats: 6,
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  minBuyIn: 40,
  maxBuyIn: 200,
  actionTimeoutMs: 30_000,
};

export interface SeatSpec {
  seat: number;
  stack: number;
  folded?: boolean;
  allIn?: boolean;
  streetBet?: number;
  totalBet?: number;
  hole?: Card[];
  /** Not dealt into the hand (sitting out or arrived mid-hand). */
  out?: boolean;
}

export interface ViewSpec {
  seats: SeatSpec[];
  button: number;
  viewer: number;
  street?: Street;
  board?: Card[];
  potAmount?: number;
  currentBet?: number;
  minRaise?: number;
  actions?: ActionRecord[];
  config?: Partial<typeof CONFIG>;
  noHand?: boolean;
}

export function makeView(spec: ViewSpec): TableView {
  const config = { ...CONFIG, ...spec.config };
  const seats = spec.seats.map((s) => ({
    seat: s.seat,
    playerId: `p${s.seat}`,
    stack: s.stack,
    status: 'active' as const,
    ...(spec.noHand || s.out
      ? {}
      : {
          inHand: {
            streetBet: s.streetBet ?? 0,
            totalBet: s.totalBet ?? s.streetBet ?? 0,
            folded: s.folded ?? false,
            allIn: s.allIn ?? false,
            ...(s.seat === spec.viewer && s.hole ? { holeCards: s.hole } : {}),
          },
        }),
  }));
  const dealt = spec.seats.filter((s) => !s.out).map((s) => s.seat);
  const eligible = dealt.filter((seat) => !spec.seats.find((s) => s.seat === seat)?.folded);
  return {
    config,
    seats,
    button: spec.button,
    handNo: 7,
    hand: spec.noHand
      ? null
      : {
          handNo: 7,
          seedCommit: 'deadbeef',
          street: spec.street ?? 'preflop',
          board: spec.board ?? [],
          pots: [{ amount: spec.potAmount ?? 0, eligible }],
          toAct: spec.viewer,
          currentBet: spec.currentBet ?? 0,
          minRaise: spec.minRaise ?? config.bigBlind,
          actions: spec.actions ?? [],
          actionDeadline: null,
        },
    viewerSeat: spec.viewer,
    legal: null,
  };
}

export function legalFor(view: TableView, overrides: Partial<LegalActions> = {}): LegalActions {
  const me = view.seats.find((s) => s.seat === view.viewerSeat)!;
  const cur = view.hand?.currentBet ?? 0;
  const mine = me.inHand?.streetBet ?? 0;
  const call = Math.min(me.stack, cur - mine);
  const minRaise = view.hand?.minRaise ?? view.config.bigBlind;
  const maxTo = mine + me.stack;
  const base: LegalActions =
    call > 0
      ? {
          fold: true,
          check: false,
          call,
          bet: null,
          raise: maxTo > cur + minRaise ? { min: cur + minRaise, max: maxTo } : null,
          allIn: me.stack,
        }
      : {
          fold: true,
          check: true,
          call: null,
          bet: { min: Math.max(view.config.bigBlind, minRaise), max: maxTo },
          raise: null,
          allIn: me.stack,
        };
  return { ...base, ...overrides };
}

export function makeInput(view: TableView, legal: LegalActions = legalFor(view)): PokerActInput {
  return { tableId: 't1', handNo: view.handNo, seat: view.viewerSeat ?? 0, view, legal, deadlineMs: 5000 };
}

/* ------------------------------------------------------- fake evaluator */

const CATEGORIES: HandCategory[] = [
  'high-card',
  'pair',
  'two-pair',
  'three-of-a-kind',
  'straight',
  'flush',
  'full-house',
  'four-of-a-kind',
  'straight-flush',
];

function straightHigh(values: number[]): number | null {
  const set = new Set(values);
  if (set.has(14)) set.add(1);
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let r = hi; r > hi - 5; r--) if (!set.has(r)) ok = false;
    if (ok) return hi;
  }
  return null;
}

function straightCards(cards: Card[], hi: number): Card[] {
  const out: Card[] = [];
  for (let r = hi; r > hi - 5; r--) {
    const want = r === 1 ? 14 : r;
    const c = cards.find((x) => rankValue(parseCard(x).rank) === want && !out.includes(x));
    if (c) out.push(c);
  }
  return out;
}

/**
 * Straightforward best-of-7 evaluator (category + ordered kickers) matching the
 * engine's documented value encoding. Good enough for tests; not optimized.
 */
export function fakeEvaluate(input: readonly Card[]): HandRank {
  const cards = [...input];
  const byRank = new Map<number, Card[]>();
  const bySuit = new Map<string, Card[]>();
  for (const c of cards) {
    const { rank, suit } = parseCard(c);
    const v = rankValue(rank);
    byRank.set(v, [...(byRank.get(v) ?? []), c]);
    bySuit.set(suit, [...(bySuit.get(suit) ?? []), c]);
  }
  const groups = [...byRank.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const flushSuit = [...bySuit.entries()].find(([, cs]) => cs.length >= 5)?.[1];

  let category: HandCategory;
  let kickers: number[];
  let five: Card[];

  const sfHigh = flushSuit ? straightHigh(flushSuit.map((c) => rankValue(parseCard(c).rank))) : null;
  if (flushSuit && sfHigh !== null) {
    category = 'straight-flush';
    kickers = [sfHigh];
    five = straightCards(flushSuit, sfHigh);
  } else if (groups[0]![1].length === 4) {
    category = 'four-of-a-kind';
    const quad = groups[0]![0];
    const kicker = Math.max(...[...byRank.keys()].filter((v) => v !== quad));
    kickers = [quad, kicker];
    five = [...groups[0]![1], byRank.get(kicker)![0]!];
  } else if (groups[0]![1].length === 3 && groups[1] && groups[1][1].length >= 2) {
    category = 'full-house';
    kickers = [groups[0]![0], groups[1]![0]];
    five = [...groups[0]![1], ...groups[1]![1].slice(0, 2)];
  } else if (flushSuit) {
    category = 'flush';
    const sorted = [...flushSuit].sort((a, b) => rankValue(parseCard(b).rank) - rankValue(parseCard(a).rank)).slice(0, 5);
    kickers = sorted.map((c) => rankValue(parseCard(c).rank));
    five = sorted;
  } else {
    const sh = straightHigh([...byRank.keys()]);
    if (sh !== null) {
      category = 'straight';
      kickers = [sh];
      five = straightCards(cards, sh);
    } else if (groups[0]![1].length === 3) {
      category = 'three-of-a-kind';
      const rest = [...byRank.keys()].filter((v) => v !== groups[0]![0]).sort((a, b) => b - a).slice(0, 2);
      kickers = [groups[0]![0], ...rest];
      five = [...groups[0]![1], ...rest.map((v) => byRank.get(v)![0]!)];
    } else if (groups[0]![1].length === 2 && groups[1] && groups[1][1].length === 2) {
      category = 'two-pair';
      const rest = [...byRank.keys()].filter((v) => v !== groups[0]![0] && v !== groups[1]![0]).sort((a, b) => b - a);
      kickers = [groups[0]![0], groups[1]![0], rest[0] ?? 0];
      five = [...groups[0]![1], ...groups[1]![1], ...(rest[0] ? [byRank.get(rest[0])![0]!] : [])];
    } else if (groups[0]![1].length === 2) {
      category = 'pair';
      const rest = [...byRank.keys()].filter((v) => v !== groups[0]![0]).sort((a, b) => b - a).slice(0, 3);
      kickers = [groups[0]![0], ...rest];
      five = [...groups[0]![1], ...rest.map((v) => byRank.get(v)![0]!)];
    } else {
      category = 'high-card';
      const rest = [...byRank.keys()].sort((a, b) => b - a).slice(0, 5);
      kickers = rest;
      five = rest.map((v) => byRank.get(v)![0]!);
    }
  }
  const k = [...kickers, 0, 0, 0, 0, 0].slice(0, 5);
  const value = CATEGORIES.indexOf(category) * 15 ** 5 + k[0]! * 15 ** 4 + k[1]! * 15 ** 3 + k[2]! * 15 ** 2 + k[3]! * 15 + k[4]!;
  return { category, value, cards: five, label: category };
}

/** Deterministic PRNG for fixtures (mulberry32). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
