/**
 * Fixtures. agent-kit's own `test-helpers.ts` is deliberately not exported from that package
 * (`exports: { ".": "./src/index.ts" }`), so the view builder is rebuilt here rather than reached into
 * through a path the package does not publish.
 */

import type { ActionRecord, Card, LegalActions, Street, TableView } from '@pokernight/engine';
import { POKER_ACT_SKILL, type PokerActInput } from '@pokernight/protocol';
import type { ExecutionContext, MessageV1, PartV1, TaskV1 } from '@agenticprimitives/a2a/standard';
import { createPokerActExecutor } from '../src/executor.js';
import type { Env } from '../src/env.js';
import type { Persona } from '../src/personas.js';

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
    waitingForBigBlind: false,
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
          smallBlindSeat: null,
          bigBlindSeat: null,
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

/** The legal-action record a host would compute for the viewer of `view`. */
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

export function makeInput(view: TableView, legal: LegalActions = legalFor(view), deadlineMs = 5000): PokerActInput {
  return { skill: POKER_ACT_SKILL, tableId: 't1', handNo: view.handNo, seat: view.viewerSeat ?? 0, view, legal, deadlineMs };
}

/* --------------------------------------------------------------- randomization */

/** Deterministic PRNG (mulberry32) so a failing fixture can be replayed from its seed. */
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

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

function deck(): Card[] {
  const out: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) out.push(`${r}${s}` as Card);
  return out;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];
const BOARD_SIZE: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

/**
 * A random but internally consistent turn: real cards, real stacks, and a `legal` record a host could
 * actually have produced. Every fifth fixture is deliberately adversarial (no fold, only an all-in,
 * an inverted range, no hand at all) — the legality guarantee has to survive those too.
 */
export function randomInput(rng: () => number): PokerActInput {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

  const seatCount = int(2, 9);
  const bigBlind = pick([2, 4, 10, 50]);
  const street = pick(STREETS);
  const cards = shuffle(deck(), rng);
  const board = cards.slice(0, BOARD_SIZE[street] ?? 0);
  const hole = cards.slice(5, 7);

  const viewer = int(0, seatCount - 1);
  const button = int(0, seatCount - 1);
  const currentBet = rng() < 0.4 ? 0 : int(bigBlind, bigBlind * 20);

  const seats: SeatSpec[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    const streetBet = currentBet === 0 ? 0 : rng() < 0.5 ? currentBet : int(0, currentBet);
    seats.push({
      seat,
      stack: int(0, bigBlind * 200),
      streetBet,
      totalBet: streetBet + int(0, bigBlind * 4),
      folded: seat !== viewer && rng() < 0.3,
      allIn: seat !== viewer && rng() < 0.1,
      out: seat !== viewer && rng() < 0.1,
      ...(seat === viewer ? { hole: hole as Card[] } : {}),
    });
  }

  const actions: ActionRecord[] = [];
  const actionCount = int(0, 6);
  for (let i = 0; i < actionCount; i++) {
    const seat = int(0, seatCount - 1);
    const kind = pick(['fold', 'check', 'call', 'bet', 'raise', 'all-in'] as const);
    actions.push({
      seat,
      street: pick(STREETS.slice(0, STREETS.indexOf(street) + 1)),
      action: kind === 'bet' || kind === 'raise' ? { type: kind, amount: int(bigBlind, bigBlind * 20) } : { type: kind },
      amount: int(0, bigBlind * 20),
    });
  }

  const noHand = rng() < 0.05;
  const view = makeView({
    seats,
    button,
    viewer,
    street,
    board: board as Card[],
    potAmount: int(0, bigBlind * 60),
    currentBet,
    minRaise: bigBlind,
    actions,
    config: { seats: Math.max(2, seatCount), bigBlind, smallBlind: Math.max(1, Math.floor(bigBlind / 2)) },
    noHand,
  });

  let legal = legalFor(view);
  const twist = int(0, 4);
  if (twist === 0) legal = { ...legal, fold: false };
  else if (twist === 1) legal = { fold: false, check: false, call: null, bet: null, raise: null, allIn: Math.max(1, legal.allIn) };
  else if (twist === 2 && legal.raise) legal = { ...legal, raise: { min: legal.raise.max, max: legal.raise.min } };
  else if (twist === 3) legal = { ...legal, bet: null, raise: null };

  return makeInput(view, legal, pick([1200, 5000, 30_000]));
}

/* ------------------------------------------------------------------- executor */

export const TEST_ENV: Env = {
  AGENT_CARD_ZONE: 'faithnet.ai',
  PUBLIC_ORIGIN: 'https://agents.faithnet.ai',
  DEFAULT_STRATEGY: 'rules',
  LLM_MODEL: 'claude-opus-5',
  LLM_EFFORT: 'low',
};

export interface ExecutorResult {
  replied: PartV1[] | null;
  failed: PartV1[] | null;
}

/**
 * Drive the executor with a hand-built `ExecutionContext`, the same one the standard server passes.
 * Only `reply` and `fail` are exercised; the rest record that they were reached (they must not be).
 */
export async function runExecutor(persona: Persona, parts: PartV1[], env: Env = TEST_ENV, rng?: () => number): Promise<ExecutorResult> {
  const result: ExecutorResult = { replied: null, failed: null };
  const task: TaskV1 = { id: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_SUBMITTED' }, history: [], artifacts: [] };
  const message: MessageV1 = { messageId: 'msg-1', role: 'ROLE_USER', parts, contextId: 'ctx-1', taskId: 'task-1' };
  const capture = (into: 'replied' | 'failed') => async (m?: PartV1[] | MessageV1) => {
    result[into] = Array.isArray(m) ? m : (m?.parts ?? []);
  };
  const unexpected = async () => {
    throw new Error('the poker.act executor must answer with reply() or fail(), nothing else');
  };
  const ctx: ExecutionContext = {
    message,
    task,
    principal: null,
    streaming: false,
    working: unexpected,
    inputRequired: unexpected,
    authRequired: unexpected,
    complete: unexpected,
    reject: unexpected,
    artifact: () => Promise.reject(new Error('the poker.act executor must not emit artifacts')),
    fail: capture('failed'),
    reply: capture('replied'),
  };
  await createPokerActExecutor(persona, env, rng ? { rng } : {}).execute(ctx);
  return result;
}
