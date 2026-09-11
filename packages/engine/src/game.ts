/**
 * POKER, as a game the table service can host.
 *
 * The adapter and nothing else. Every method here forwards to the rules in `table.ts`, which know
 * nothing about ports, hosts or Durable Objects and are not going to start. What this file adds is
 * the translation between two vocabularies: a hand is a round, chips are a stack, a buy-in is a
 * stake — words chosen so a game with no betting can answer in them without lying.
 *
 * It lives in this package because an adapter belongs with the game it adapts. A second game brings
 * its own engine and its own adapter, and neither package has to know the other exists.
 */

import type { Applied, RoundResult, SeatSnapshot, TableGame, TableSnapshot } from '@pokernight/table-game';
import {
  addChips,
  applyAction,
  canStartHand,
  createTable,
  legalActions,
  redactEvent,
  setActionDeadline,
  sitDown,
  sitIn,
  sitOut,
  standUp,
  startHand,
  timeoutAction,
  viewFor,
} from './table.js';
import type { Action, EngineEvent, TableConfig, TableState, TableView } from './types.js';

export const POKER_GAME_ID = 'poker';

/**
 * The action shapes the engine accepts. Parsed here rather than at the host, because which actions
 * are legal at all is the game's question and only the game can answer it.
 *
 * SPELLED EXACTLY AS THE `Action` UNION SPELLS IT. This list read `allin` while the union, the wire
 * schema and every strategy in the workspace say `all-in` — so an agent that shoved was told "all-in
 * is not something you can do at a poker table" by the one function whose job is to know that it is.
 * Nothing caught it because only the A2A seat path and the coach's suggested move come through here.
 */
const ACTION_TYPES = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all-in']);

function seatSnapshot(s: TableState['seats'][number]): SeatSnapshot {
  return { seat: s.seat, playerId: s.playerId, stack: s.stack, status: s.status, timeouts: s.timeouts };
}

export const pokerGame: TableGame<TableState, Action, TableView, EngineEvent, TableConfig> = {
  id: POKER_GAME_ID,
  name: "Texas Hold'em",
  staked: true,
  actSkill: 'poker.act',

  create: (config) => createTable(config),

  /**
   * A ROUND IS IN PROGRESS while a hand exists and has no result yet.
   *
   * Both halves matter. A finished hand is still `state.hand` — the engine keeps it so the result can
   * be read and shown — so asking only whether a hand exists would say a table was mid-hand for the
   * whole gap between deals, and every "can this table start?" decision downstream would be wrong.
   */
  snapshot: (state): TableSnapshot => ({
    config: {
      seats: state.config.seats,
      minStake: state.config.minBuyIn,
      maxStake: state.config.maxBuyIn,
      turnMs: state.config.actionTimeoutMs,
    },
    seats: state.seats.map(seatSnapshot),
    round: state.hand?.handNo ?? state.handNo,
    roundInProgress: state.hand !== null && state.hand.result === undefined,
    toAct: state.hand?.toAct ?? null,
    deadline: state.hand?.actionDeadline ?? null,
  }),

  sitDown: (state, seat, playerId, stake) => sitDown(state, seat, playerId, stake),
  standUp: (state, seat) => {
    const { state: next, cashOut, events } = standUp(state, seat);
    return { state: next, refund: cashOut, events };
  },
  addStake: (state, seat, amount) => addChips(state, seat, amount),
  sitOut: (state, seat) => sitOut(state, seat),
  sitIn: (state, seat) => sitIn(state, seat),

  canStart: (state) => canStartHand(state),
  start: (state, seed) => startHand(state, seed),
  legalFor: (state, seat) => legalActions(state, seat),

  /**
   * Apply an action, turning the engine's THROW into an answer.
   *
   * The engine throws `EngineError` for an illegal action, which is right for a pure state machine
   * and wrong at a socket: a player who bets out of turn should be told so, not disconnect the
   * table. The host gets a refusal with the engine's own words rather than a stack trace.
   */
  apply: (state, seat, action): Applied<TableState, EngineEvent> => {
    try {
      const { state: next, events } = applyAction(state, seat, action);
      return { ok: true, state: next, events };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'that is not a legal action here' };
    }
  },

  timeout: (state, seat) => timeoutAction(state, seat),
  setDeadline: (state, deadline) => setActionDeadline(state, deadline),

  config: (state) => state.config,
  viewFor: (state, seat) => viewFor(state, seat),
  redact: (event, seat) => redactEvent(event, seat),

  parseAction: (raw) => {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'an action has to be an object' };
    const a = raw as { type?: unknown; amount?: unknown };
    if (typeof a.type !== 'string' || !ACTION_TYPES.has(a.type)) {
      return { ok: false, reason: `"${String(a.type)}" is not something you can do at a poker table` };
    }
    if (a.amount !== undefined && (typeof a.amount !== 'number' || !Number.isInteger(a.amount) || a.amount < 0)) {
      return { ok: false, reason: 'an amount has to be a whole number of chips' };
    }
    return { ok: true, action: raw as Action };
  },

  resultOf: (event): RoundResult | null => {
    if (event.type !== 'hand-ended') return null;
    return { net: event.result.net, rake: event.result.rake };
  },
};
