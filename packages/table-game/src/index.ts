/**
 * THE PORT a seated, turn-based card game implements so the table service can host it.
 *
 * Types only. No rules, no I/O, no game — this package must never know that poker exists, and the
 * day it does is the day it has stopped being a port.
 *
 * WHY A PORT AND NOT A SHARED ENGINE. Games are not variants of each other. Hold'em has betting
 * rounds, a pot, side pots and a hand evaluator; canasta has melds, partnerships and a discard pile
 * that freezes; neither shares a line of rules with the other and trying to make them would produce
 * an engine that is bad at both. What they DO share is everything around the rules: a room with
 * seats, players who arrive and drop and come back, a turn with a deadline and a default, an
 * append-only log, a seeded shuffle that can be replayed, and a per-seat view that must never leak
 * another player's cards. That is what this file describes, and it is the reusable part.
 *
 * SO EACH GAME KEEPS ITS OWN ENGINE, pure and complete, and implements this to be hostable. Adding a
 * game is writing an engine and an adapter. It is not editing anybody else's rules.
 *
 * THE STATE IS OPAQUE TO THE HOST. `PokerTableDO` holds a game's state as `unknown` and hands it
 * straight back. Everything the host needs to know about the state without understanding it comes
 * through {@link TableGame.snapshot} — who is seated, whose turn it is, when their time runs out.
 * The host asks; it never reads a field.
 */

/** Which game a table plays. An id, stamped on the table at creation and never re-read. */
export type GameId = string;

/** Where a seat stands, in the words every seated game already needs. */
export type SeatStatus = 'active' | 'sitting-out' | 'waiting';

/** One seat, as the host sees it. Deliberately the smallest set that serves a lobby, a seat
 *  lifecycle and a ledger — and nothing about the game being played. */
export interface SeatSnapshot {
  seat: number;
  playerId: string;
  /**
   * What this seat holds, in the game's own units.
   *
   * Chips at a poker table. A game that is played for score and not for stakes reports `0` and
   * means it: the host's money paths are driven by the SETTLEMENT MODE, not by this number, so a
   * game with no stakes settles nothing rather than settling zero.
   */
  stack: number;
  status: SeatStatus;
  /**
   * Consecutive turns this seat has let run out.
   *
   * General to any game with a clock, and the host acts on it: two in a row and the seat is sat out
   * so a table is not held up by somebody who has walked away. The GAME counts them, because only
   * the game knows what "a turn" is and when the count resets.
   */
  timeouts: number;
}

/** What the table is doing right now, without saying what game it is. */
export interface TableSnapshot {
  /** Bounds the host enforces before it lets anybody sit: how many seats, and what a seat costs. */
  config: {
    seats: number;
    minStake: number;
    maxStake: number;
    /** How long a seat gets on the clock, in ms. The HOST arms the alarm; the game says how long. */
    turnMs: number;
  };
  seats: SeatSnapshot[];
  /** How many rounds this table has completed. A "hand" at a poker table. */
  round: number;
  /** True while a round is being played. False between rounds, and before the first. */
  roundInProgress: boolean;
  /** The seat whose turn it is, or null when nobody is on the clock. */
  toAct: number | null;
  /** When that seat's time runs out, in absolute ms, or null. */
  deadline: number | null;
}

/** What one round produced, per seat, once it has finished. The host writes this to the ledger and
 *  (later) to a season; it never interprets it. */
export interface RoundResult {
  /** Net change in each seat's stack for the round. Sums to zero, less anything raked. */
  net: Record<number, number>;
  /** Taken by the house, if the game takes anything. Usually zero. */
  rake: number;
}

/** A game's answer when it will not accept an action, in words a player can act on. */
export interface Refusal {
  ok: false;
  reason: string;
}

export type Applied<S, E> = { ok: true; state: S; events: E[] } | Refusal;

/**
 * A game the table service can host.
 *
 * Every method is PURE: it returns new state and never mutates its input, so a table's whole history
 * is (seed, action log) and a round replays byte-identically. That is not a nicety — it is what lets
 * a shuffle be committed before the deal and revealed after it, which is the only fairness claim
 * this product makes that a player can check for themselves.
 *
 * `S` state · `A` action · `V` per-seat view · `E` event · `C` config.
 */
export interface TableGame<S = unknown, A = unknown, V = unknown, E = unknown, C = unknown> {
  readonly id: GameId;
  /** What to call it to a person: "Texas Hold'em". */
  readonly name: string;

  /** A new table. Throws with a plain reason if the config is not one this game can deal. */
  create(config: Partial<C>): S;

  /** Everything the host needs about the state without understanding it. */
  snapshot(state: S): TableSnapshot;

  /* ---- the seat lifecycle, which every seated game has and none of them owns ---- */

  sitDown(state: S, seat: number, playerId: string, stake: number): S;
  /** Leave. `refund` is what goes back to the player, in the game's units. */
  standUp(state: S, seat: number): { state: S; refund: number; events: E[] };
  /** Put more in. A game with no stakes may refuse; the host asks first via {@link staked}. */
  addStake(state: S, seat: number, amount: number): S;
  sitOut(state: S, seat: number): S;
  sitIn(state: S, seat: number): S;

  /* ---- the round ---- */

  canStart(state: S): boolean;
  /** Deal. The seed is the host's, 32 bytes, committed before this is called and revealed after. */
  start(state: S, seed: Uint8Array): { state: S; events: E[] };
  /** What the seat on the clock may legally do, in a shape the client and an agent both read. */
  legalFor(state: S, seat: number): unknown;
  apply(state: S, seat: number, action: A): Applied<S, E>;
  /** What happens when the clock runs out. Every game must have an answer that is not "nothing". */
  timeout(state: S, seat: number): { state: S; events: E[] };
  setDeadline(state: S, deadline: number | null): S;

  /* ---- what each person is allowed to see ---- */

  /**
   * The game's OWN configuration, as the table was created with.
   *
   * The host cannot describe it and does not try — it carries it to a client that knows this game,
   * which is how a lobby shows poker's blinds without the lobby knowing what a blind is.
   */
  config(state: S): unknown;

  /** The table as one seat sees it. `null` for a spectator, who sees only what is public. */
  viewFor(state: S, seat: number | null): V;
  /** The same event as one seat may see it, or `null` if they may not see it at all. This is the
   *  only thing standing between a player and somebody else's cards; a game that returns the event
   *  unchanged has not implemented it. */
  redact(event: E, seat: number | null): E | null;

  /* ---- the wire ---- */

  /** Read an action off the socket. The GAME validates its own actions; the host never guesses. */
  parseAction(raw: unknown): { ok: true; action: A } | Refusal;
  /** The result carried by a round-ended event, or null for any other event. */
  resultOf(event: E): RoundResult | null;

  /**
   * The A2A skill an agent seat at this game answers on, e.g. `poker.act`.
   *
   * Per game, and named by the game, because an agent that can play poker cannot play canasta and
   * the two must not be able to be sent each other's turns by mistake.
   */
  readonly actSkill: string;

  /** Does this game move stakes at all? False for a game played purely for score, and the host then
   *  opens no settlement path for it rather than settling amounts of nothing. */
  readonly staked: boolean;

  /**
   * OPTIONAL: what a good player would do in this seat, and why.
   *
   * A game that has a strategy can lend it to the person sitting there — to play their hand while
   * they learn, or just to say what it would have done. A game that has none simply does not
   * declare this, and the host answers "no coach" rather than inventing one.
   *
   * It must reason from the SEAT'S OWN VIEW, never from the state it is handed: a coach that used
   * cards the learner cannot see would produce reasoning they can never reproduce, which teaches
   * them a way of playing that will not work when they are on their own.
   */
  advise?(state: S, seat: number): Advice | null;
}

/** What a coach says about one move: the move itself, one clause to speak, and the rule behind it. */
export interface Advice {
  /** The move, in the game's own action shape. A client sends it back as an ordinary action. */
  action: unknown;
  /** One clause, short enough to be spoken while the move happens. */
  say: string;
  /** The rule it turns on, meant to be read. This is the part that is actually teaching. */
  because: string;
}

/**
 * A game whose types the host does not know — which is every game, from the host's side.
 *
 * `unknown` throughout, and every method above is declared with METHOD syntax rather than as a
 * property holding an arrow function. That is deliberate: TypeScript checks method parameters
 * bivariantly, so a concrete `TableGame<TableState, Action, …>` is assignable to this, and a registry
 * can hold poker and canasta side by side. Written as properties they would be contravariant and
 * nothing would be assignable to anything.
 */
export type HostedGame = TableGame<unknown, unknown, unknown, unknown, unknown>;

/**
 * The games a deployment can host, by id.
 *
 * A registry rather than a switch so that adding one is adding a package and one line, and so that
 * an id a deployment does not know is refused BY NAME instead of falling through to whatever was
 * first in the list.
 */
export function createGameRegistry(games: readonly HostedGame[]): {
  get(id: GameId): HostedGame | null;
  ids(): GameId[];
} {
  const byId = new Map<GameId, HostedGame>();
  for (const g of games) {
    if (byId.has(g.id)) throw new Error(`two games registered as "${g.id}"`);
    byId.set(g.id, g);
  }
  return {
    get: (id) => byId.get(id) ?? null,
    ids: () => [...byId.keys()],
  };
}
