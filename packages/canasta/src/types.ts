/**
 * Classic Canasta — the state, the moves, and what a round produces.
 *
 * FOUR PLAYERS IN TWO PARTNERSHIPS, which is the classic game and the only one this engine deals.
 * Seats 0 and 2 are one side, 1 and 3 the other. The two- and three-hand variants are different
 * games with different deals and different rules about going out, and pretending one engine covers
 * all three is how a rules bug reaches a table.
 */

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'W';
/** `*` is the joker's non-suit. */
export type Suit = 'C' | 'D' | 'H' | 'S' | '*';

/** `${Rank}${Suit}` — `AS`, `TD`, `W*`. A plain string so a hand is JSON and compares by value. */
export type Card = string;

/** Seats 0 and 2 are team 0; seats 1 and 3 are team 1. */
export type TeamId = 0 | 1;

export const SEATS = 4;

export function teamOf(seat: number): TeamId {
  return (seat % 2) as TeamId;
}

export function partnerOf(seat: number): number {
  return (seat + 2) % SEATS;
}

export interface CanastaConfig {
  /** Always four. Present so the host can read it like any other table's seat count. */
  seats: number;
  /** The score that ends the game. Classic is 5000. */
  target: number;
  /** How long a seat gets on the clock, in ms. */
  turnMs: number;
}

export type SeatStatus = 'active' | 'sitting-out';

export interface CanastaSeat {
  seat: number;
  playerId: string;
  status: SeatStatus;
  /** Consecutive turns let run out. The host sits a seat out on the second. */
  timeouts: number;
}

/** Cards of one rank on a partnership's table. Seven or more is a canasta. */
export interface Meld {
  rank: Rank;
  cards: Card[];
}

/** What a player asks to meld: a rank, and the cards from their hand that go into it. */
export interface MeldSpec {
  rank: Rank;
  cards: Card[];
}

export type CanastaAction =
  /** Take the top card of the stock. A red three lays itself down and draws again. */
  | { type: 'draw' }
  /**
   * Take the whole discard pile, using its top card in `meld`.
   *
   * `also` lays further melds from the hand in the same move. It exists because a side that has not
   * opened has to reach its minimum in ONE action, and the pile's top card alone is often not
   * enough — without it, taking the pile to open would be impossible at the higher minimums.
   */
  | { type: 'take-pile'; meld: MeldSpec; also?: MeldSpec[] }
  /** Lay new melds, or add to your side's existing ones. Any number, in one move. */
  | { type: 'meld'; melds: MeldSpec[] }
  /** End the turn. Emptying your hand goes out, and needs a canasta. */
  | { type: 'discard'; card: Card };

/** Where a turn has got to. A seat must draw or take the pile before it may do anything else. */
export type TurnPhase = 'draw' | 'play';

/** What a finished round paid, per side, and why — the sentence a scoreboard shows. */
export interface TeamScore {
  /** Card values of everything melded. */
  melds: number;
  /** 500 a natural canasta, 300 a mixed one. */
  canastas: number;
  /** 100 each, 800 for all four — and negative if this side never melded. */
  redThrees: number;
  /** 100 for going out, 200 if concealed. */
  goingOut: number;
  /** Card values still in both partners' hands, as a negative number. */
  inHand: number;
  /** The four above, summed. */
  total: number;
  naturalCanastas: number;
  mixedCanastas: number;
}

export interface CanastaResult {
  /** The seat that went out, or null when the stock ran out first. */
  wentOut: number | null;
  concealed: boolean;
  scores: Record<TeamId, TeamScore>;
  /** Each side's running total after this round. */
  totals: Record<TeamId, number>;
}

export interface RoundState {
  roundNo: number;
  /** sha256 of the seed, published before the deal. */
  seedCommit: string;
  /** Hex seed while the round runs. Never shown to a player; revealed when the round ends. */
  seed?: string;
  seedReveal?: string;
  dealer: number;
  stock: Card[];
  /** The last element is the top card. */
  discard: Card[];
  /**
   * A frozen pile can only be taken by a player holding two natural cards of its top rank.
   *
   * It freezes when a wild card is discarded onto it, and starts frozen if the first upcard was a
   * wild or a red three. Nothing thaws it: it stays frozen until somebody takes it, and then there
   * is no pile to be frozen.
   */
  frozen: boolean;
  hands: Record<number, Card[]>;
  melds: Record<TeamId, Meld[]>;
  redThrees: Record<TeamId, Card[]>;
  toAct: number | null;
  phase: TurnPhase;
  actionDeadline: number | null;
  /** Whether a side has met its initial-meld minimum and is now melding freely. */
  opened: Record<TeamId, boolean>;
  /**
   * Seats that had melded in some EARLIER turn. Going out having never melded before is "concealed"
   * and pays double, so this is the flag that decides it — and it must be updated at the END of a
   * turn, never during one, or a player's own opening meld would disqualify their own going out.
   */
  meldedBefore: Record<number, boolean>;
  /** Whether the seat on turn has put anything down yet in THIS turn. Folded into `meldedBefore`
   *  when the turn ends. */
  meldedThisTurn: boolean;
  result?: CanastaResult;
}

export interface CanastaState {
  config: CanastaConfig;
  seats: CanastaSeat[];
  /** Rounds completed. The round in progress is `round`. */
  roundNo: number;
  round: RoundState | null;
  /** Running scores across rounds. */
  scores: Record<TeamId, number>;
  /** Set once a side passes the target at the end of a round. */
  winner: TeamId | null;
}

/** What a seat is allowed to do right now, in a shape a client and an agent both read. */
export interface CanastaLegal {
  phase: TurnPhase;
  canDraw: boolean;
  canTakePile: boolean;
  /** Why the pile cannot be taken, when it cannot. Always a sentence, never a code. */
  takePileReason: string | null;
  /** The rank on top of the pile, so a client can show what taking it would need. */
  pileTop: Card | null;
  pileSize: number;
  /** What this side must lay to open. Zero once it has. */
  minimumMeld: number;
  /** Cards that may be discarded. Empty while the seat still has to draw. */
  discardable: Card[];
  /** True when this side has a canasta, and so may go out. */
  canGoOut: boolean;
}

export class CanastaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CanastaError';
  }
}
