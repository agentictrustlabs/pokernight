/**
 * CANASTA, as a game the table service can host.
 *
 * The adapter and nothing else, exactly as poker's is. Every method forwards to the rules in
 * `table.ts`, which know nothing about ports or hosts. What this file adds is the translation
 * between two vocabularies — a canasta ROUND is the host's round, a canasta score is not a stack —
 * and the honest answer to the one question the host really needs: this game moves no stakes.
 */

import type { Applied, RoundResult, SeatSnapshot, TableGame, TableSnapshot } from '@pokernight/table-game';
import {
  applyAction,
  canStartRound,
  createTable,
  legalFor,
  redactEvent,
  roundRunning,
  setActionDeadline,
  sitDown,
  sitIn,
  sitOut,
  standUp,
  startRound,
  timeoutAction,
  viewFor,
  type CanastaEvent,
  type CanastaView,
} from './table.js';
import type { CanastaAction, CanastaConfig, CanastaSeat, CanastaState } from './types.js';

export const CANASTA_GAME_ID = 'canasta';

const ACTIONS = new Set(['draw', 'take-pile', 'meld', 'discard']);

/**
 * A seat's stack is ZERO and means it.
 *
 * Canasta is played for score, not for stakes, and the score belongs to a partnership rather than a
 * seat. Reporting a running score here would put a number in the host's money column that no money
 * corresponds to; `staked: false` is what tells the host to open no settlement path at all.
 */
function seatSnapshot(s: CanastaSeat): SeatSnapshot {
  return { seat: s.seat, playerId: s.playerId, stack: 0, status: s.status, timeouts: s.timeouts };
}

export const canastaGame: TableGame<CanastaState, CanastaAction, CanastaView, CanastaEvent, CanastaConfig> = {
  id: CANASTA_GAME_ID,
  name: 'Canasta',
  staked: false,
  actSkill: 'canasta.act',

  create: (config) => createTable(config),

  snapshot: (state): TableSnapshot => ({
    config: { seats: state.config.seats, minStake: 0, maxStake: 0, turnMs: state.config.turnMs },
    seats: state.seats.map(seatSnapshot),
    round: state.round?.roundNo ?? state.roundNo,
    // A finished round stays on the state so its score can be read, so "in progress" is both halves.
    roundInProgress: roundRunning(state),
    toAct: state.round?.toAct ?? null,
    deadline: state.round?.actionDeadline ?? null,
  }),

  config: (state) => state.config,

  sitDown: (state, seat, playerId, stake) => sitDown(state, seat, playerId, stake),
  standUp: (state, seat) => standUp(state, seat),
  // Nothing to add to. A seat's holding in this game is its cards, and those come from the deal.
  addStake: (state) => state,
  sitOut: (state, seat) => sitOut(state, seat),
  sitIn: (state, seat) => sitIn(state, seat),

  canStart: (state) => canStartRound(state),
  start: (state, seed) => startRound(state, seed),
  legalFor: (state, seat) => legalFor(state, seat),

  /**
   * Apply a move, turning the engine's THROW into an answer.
   *
   * The engine throws for an illegal move, which is right for a pure state machine and wrong at a
   * socket: a player who melds out of turn should be told so, not disconnect the table.
   */
  apply: (state, seat, action): Applied<CanastaState, CanastaEvent> => {
    try {
      const { state: next, events } = applyAction(state, seat, action);
      return { ok: true, state: next, events };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'that is not a legal move here' };
    }
  },

  timeout: (state, seat) => timeoutAction(state, seat),
  /**
   * FOUR, not the host's default of two.
   *
   * A canasta turn is reading a hand of a dozen cards, hunting melds in it, weighing whether the pile
   * is worth taking, and only then discarding — and a player learning the game is doing all of that
   * for the first time. Two missed turns is about a minute and a half of thinking before the table
   * takes their seat away, which is the complaint this answers: "it keeps taking the person out".
   *
   * Missing a turn already costs something — the clock draws and throws the cheapest card for them —
   * so this is only the point at which the table stops waiting, and being slow at a thinking game is
   * not the same as being gone.
   */
  maxTimeouts: 4,
  setDeadline: (state, deadline) => setActionDeadline(state, deadline),

  viewFor: (state, seat) => viewFor(state, seat),
  redact: (event, seat) => redactEvent(event, seat),

  parseAction: (raw) => {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'a move has to be an object' };
    const a = raw as { type?: unknown };
    if (typeof a.type !== 'string' || !ACTIONS.has(a.type)) {
      return { ok: false, reason: `"${String(a.type)}" is not a move in canasta — draw, take the pile, meld or discard` };
    }
    return { ok: true, action: raw as CanastaAction };
  },

  /**
   * What a round paid, per seat.
   *
   * Each partner is credited with what their SIDE scored, so it does not sum to zero — and it is not
   * meant to. Canasta is played for score; the host writes no ledger row for an unstaked game.
   */
  resultOf: (event): RoundResult | null => {
    if (event.type !== 'round-ended') return null;
    return { net: event.net, rake: 0 };
  },
};
