/**
 * @pokernight/engine — public types.
 *
 * The engine is a pure, deterministic no-limit Texas Hold'em state machine.
 * Every value here is plain JSON (no classes, no Dates, no bigint) so a table
 * state can be stored in Durable Object SQLite and replayed byte-identically.
 *
 * Money inside the engine is always in CHIPS (integers). Converting chips to an
 * on-chain asset is the ledger's job, never the engine's.
 */

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
/** Two-character card, e.g. "As", "Td", "2c". */
export type Card = `${Rank}${Suit}`;

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

/** Result of evaluating the best 5-card hand from 5..7 cards. Higher `value` wins; equal `value` ties. */
export interface HandRank {
  category: HandCategory;
  /** Monotonic comparable score. Two hands with equal value split the pot. */
  value: number;
  /** The five cards that make the hand, best first. */
  cards: Card[];
  /** Human label, e.g. "Full house, kings over fours". */
  label: string;
}

export interface TableConfig {
  /** 2..9 */
  seats: number;
  smallBlind: number;
  bigBlind: number;
  /** Per-player ante posted before the blinds. Default 0. */
  ante: number;
  minBuyIn: number;
  maxBuyIn: number;
  /** Turn clock. The engine does not run timers; it records the deadline for the host to enforce. */
  actionTimeoutMs: number;
}

export type SeatStatus =
  /** Seated with chips, will be dealt in. */
  | 'active'
  /** Seated but not dealt in (chose to sit out, or timed out twice, or stack is 0 pending rebuy). */
  | 'sitting-out';

export interface Seat {
  seat: number;
  playerId: string;
  stack: number;
  status: SeatStatus;
  /** True until the player has posted a big blind or waited for it; new players may be asked to post. */
  waitingForBigBlind: boolean;
  /** Consecutive turns that ended by timeout. Host may sit the player out at 2. */
  timeouts: number;
  /** Set by standUp during a hand: the seat has been folded and is removed when the hand ends. */
  leaving?: boolean;
  /** Chips added with addChips during a hand; applied to the stack when the hand ends. */
  pendingAddChips?: number;
}

/** Per-seat state that exists only while a hand is in progress. */
export interface HandSeat {
  seat: number;
  holeCards: Card[];
  /** Chips this seat has put in on the current street. */
  streetBet: number;
  /** Chips this seat has put in for the whole hand (used for side pots). */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** Whether the seat has acted since the last raise on this street. */
  acted: boolean;
  /** Set at showdown if cards are shown. */
  shown?: boolean;
}

export interface Pot {
  amount: number;
  /** Seats eligible to win this pot. */
  eligible: number[];
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Open the betting on a street. `amount` is the total bet size. */
  | { type: 'bet'; amount: number }
  /** Raise TO `amount` (the new total street bet), not by. */
  | { type: 'raise'; amount: number }
  | { type: 'all-in' };

export interface LegalActions {
  fold: boolean;
  check: boolean;
  /** Chips needed to call, if calling is possible (0 means check instead). */
  call: number | null;
  /** Legal open-bet range (total street bet), if betting is possible. */
  bet: { min: number; max: number } | null;
  /** Legal raise-to range, if raising is possible. */
  raise: { min: number; max: number } | null;
  /** Chips the seat would commit by going all-in (always legal if the seat has chips). */
  allIn: number;
}

export interface ActionRecord {
  seat: number;
  street: Street;
  action: Action;
  /** Chips actually moved into the pot by this action. */
  amount: number;
  /** True when the host applied the default action because the clock ran out. */
  timedOut?: boolean;
}

export interface HandState {
  handNo: number;
  /** sha256(seed) as hex, published at hand start. */
  seedCommit: string;
  /** Seed hex, present only after the hand ends (reveal). */
  seedReveal?: string;
  /** Seed hex while the hand is running (moved to seedReveal at hand end). Never sent to clients. */
  seed?: string;
  button: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  street: Street;
  board: Card[];
  /** Remaining undealt cards (never sent to clients). */
  deck: Card[];
  seats: HandSeat[];
  pots: Pot[];
  /** Seat to act, or null when the hand is over or no action is pending. */
  toAct: number | null;
  /** Highest total street bet so far this street. */
  currentBet: number;
  /** Minimum legal raise increment this street. */
  minRaise: number;
  /** Seat that made the last aggressive action this street; null if none. */
  lastAggressor: number | null;
  actions: ActionRecord[];
  /** Absolute ms timestamp by which `toAct` must act; set by the host, not the engine. */
  actionDeadline: number | null;
  /** Filled in when the hand completes. */
  result?: HandResult;
}

export interface PotAward {
  potIndex: number;
  amount: number;
  seat: number;
  /** Absent when everyone else folded (no showdown). */
  rank?: HandRank;
}

export interface HandResult {
  awards: PotAward[];
  /** Net chip change per seat for this hand (sum is zero, less rake). */
  net: Record<number, number>;
  /** Seats that showed at showdown, with their hole cards. */
  shown: { seat: number; holeCards: Card[]; rank: HandRank }[];
  rake: number;
}

export interface TableState {
  config: TableConfig;
  seats: Seat[];
  /** Button position for the NEXT hand (or current hand when one is running). Null before the first hand. */
  button: number | null;
  handNo: number;
  hand: HandState | null;
}

/* ----------------------------------------------------------------------------
 * Events emitted by applyAction / startHand. The host persists these and
 * forwards a redacted form to clients. Private events carry a `seat` audience.
 * ------------------------------------------------------------------------- */

export type EngineEvent =
  | { type: 'hand-started'; handNo: number; seedCommit: string; button: number; seats: number[] }
  | { type: 'blind-posted'; seat: number; kind: 'small' | 'big' | 'ante'; amount: number }
  | { type: 'hole-cards'; seat: number; cards: Card[]; private: true }
  | { type: 'action'; record: ActionRecord }
  | { type: 'street'; street: Exclude<Street, 'preflop'>; board: Card[] }
  | { type: 'pots'; pots: Pot[] }
  | { type: 'showdown'; shown: { seat: number; holeCards: Card[]; rank: HandRank }[] }
  | { type: 'hand-ended'; handNo: number; result: HandResult; seedReveal: string }
  | { type: 'turn'; seat: number; legal: LegalActions };

/* ----------------------------------------------------------------------------
 * Redacted view sent to a client (or an agent). Never contains the deck or
 * another seat's hole cards.
 * ------------------------------------------------------------------------- */

export interface SeatView {
  seat: number;
  playerId: string;
  stack: number;
  status: SeatStatus;
  /** Seated but not yet dealt in: waiting for the big blind to reach them. */
  waitingForBigBlind: boolean;
  /** Only present in a hand. */
  inHand?: {
    streetBet: number;
    totalBet: number;
    folded: boolean;
    allIn: boolean;
    /** Present only for the viewer's own seat, or for shown cards at showdown. */
    holeCards?: Card[];
  };
}

export interface TableView {
  config: TableConfig;
  seats: SeatView[];
  button: number | null;
  handNo: number;
  hand: {
    handNo: number;
    seedCommit: string;
    seedReveal?: string;
    /** Blind positions for this hand, so a client draws the pucks from fact, not inference. */
    smallBlindSeat: number | null;
    bigBlindSeat: number | null;
    street: Street;
    board: Card[];
    pots: Pot[];
    toAct: number | null;
    currentBet: number;
    minRaise: number;
    actions: ActionRecord[];
    actionDeadline: number | null;
    result?: HandResult;
  } | null;
  /** The viewer's seat, or null for a spectator. */
  viewerSeat: number | null;
  /** Legal actions for the viewer if it is their turn. */
  legal: LegalActions | null;
}

export class EngineError extends Error {
  constructor(
    public readonly code:
      | 'seat-taken'
      | 'seat-invalid'
      | 'player-seated'
      | 'not-seated'
      | 'buy-in-range'
      | 'hand-in-progress'
      | 'no-hand'
      | 'not-your-turn'
      | 'illegal-action'
      | 'not-enough-players',
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
