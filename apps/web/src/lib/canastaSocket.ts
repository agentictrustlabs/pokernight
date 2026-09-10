/**
 * What a canasta table looks like to this client, and the pure reducer that keeps it.
 *
 * The poker equivalent (`tableSocket.ts`) holds a poker view, a poker turn and the last hand's
 * result. This holds canasta's, and shares the transport with it — the reconnect, the backoff and
 * the keepalive never depended on which game was being played.
 *
 * ONE DIFFERENCE WORTH NAMING. Poker's `lastHand` survives the hand going null so a winner stays on
 * screen; canasta's `result` rides on the view itself and is cleared by the next round, so there is
 * nothing to hold here. What this keeps instead is the LOG, because a canasta round is long and what
 * has been melded is the thing a player most needs to look back at.
 */

import type { CanastaLegal, CanastaTableEvent, CanastaView } from './canasta';
import type { PlayerInfo } from './types';
import type { CanastaServerMessage } from '@pokernight/protocol';
import { LOG_LIMIT, type ConnectionStatus } from './tableSocket';

export type { CanastaServerMessage };

/** Set while it is the viewer's turn: what they may do, and by when. */
export interface CanastaTurn {
  roundNo: number;
  seat: number;
  legal: CanastaLegal;
  /** Absolute ms timestamp, or null when the server did not give one. */
  deadline: number | null;
}

export interface CanastaTableState {
  tableId: string | null;
  playerId: string | null;
  view: CanastaView | null;
  names: Record<string, string>;
  players: Record<string, PlayerInfo>;
  /** Latest events, oldest first, capped at LOG_LIMIT. */
  log: CanastaTableEvent[];
  /**
   * HOW MANY EVENTS HAVE EVER ARRIVED — not how many are still in the log.
   *
   * The log is capped, so once it is full its LENGTH stops changing while its contents keep moving.
   * Anything tracking its position by length therefore stops seeing new events at exactly the cap,
   * which is what silenced the commentary partway through every round: it talked, and then it did
   * not, and nothing about the table had changed.
   */
  logSeq: number;
  turn: CanastaTurn | null;
  error: { code: string; message: string } | null;
  connection: ConnectionStatus;
}

export const initialCanastaState: CanastaTableState = {
  tableId: null,
  playerId: null,
  view: null,
  names: {},
  players: {},
  log: [],
  logSeq: 0,
  turn: null,
  error: null,
  connection: 'connecting',
};

function appendLog(log: CanastaTableEvent[], ev: CanastaTableEvent): CanastaTableEvent[] {
  const next = log.length >= LOG_LIMIT ? log.slice(log.length - LOG_LIMIT + 1) : log.slice();
  next.push(ev);
  return next;
}

/**
 * Derive the viewer's turn from a full view.
 *
 * A view carries no legal-move set of its own, so a turn known only from a view has none either —
 * and the controls stay dead until the `turn` message arrives with it. That is the honest state:
 * the client must not guess at what is legal in a game whose legality depends on cards the server
 * has and it does not.
 */
function turnFromView(view: CanastaView, playerSeat: number | null, prev: CanastaTurn | null): CanastaTurn | null {
  if (playerSeat == null || view.toAct !== playerSeat || view.result) return null;
  if (prev && prev.seat === playerSeat && prev.roundNo === view.roundNo) {
    return { ...prev, deadline: view.actionDeadline };
  }
  return null;
}

/** Which seat the viewer is in, from the view's own seat list. Null for a spectator. */
export function seatOf(view: CanastaView | null, playerId: string | null): number | null {
  if (!view || !playerId) return null;
  return view.seats.find((s) => s.playerId === playerId)?.seat ?? null;
}

/** Pure: `state` is never mutated. */
export function reduceCanasta(state: CanastaTableState, msg: CanastaServerMessage): CanastaTableState {
  switch (msg.type) {
    case 'welcome': {
      const playerId = msg.playerId;
      const seat = seatOf(msg.view, playerId);
      return {
        ...state,
        tableId: msg.tableId,
        playerId,
        view: msg.view,
        names: { ...state.names, ...msg.names },
        players: { ...state.players, ...msg.players },
        turn: turnFromView(msg.view, seat, state.turn),
        connection: 'open',
      };
    }
    case 'snapshot': {
      const seat = seatOf(msg.view, state.playerId);
      return {
        ...state,
        view: msg.view,
        names: { ...state.names, ...msg.names },
        players: { ...state.players, ...msg.players },
        turn: turnFromView(msg.view, seat, state.turn),
      };
    }
    case 'event': {
      const ev = msg.event;
      let names = state.names;
      let players = state.players;
      if ((ev.type === 'seat-joined' || ev.type === 'seat-status' || ev.type === 'seat-left') && 'name' in ev && ev.name) {
        names = { ...names, [ev.playerId]: ev.name };
      } else if (ev.type === 'chat' && state.names[ev.playerId] !== ev.name) {
        names = { ...names, [ev.playerId]: ev.name };
      }
      if (ev.type === 'seat-joined' && ev.kind) {
        players = {
          ...players,
          [ev.playerId]: {
            playerId: ev.playerId,
            name: ev.name ?? state.names[ev.playerId] ?? ev.playerId,
            kind: ev.kind,
            ...(ev.agentName ? { agentName: ev.agentName } : {}),
            ...(ev.agentKind ? { agentKind: ev.agentKind } : {}),
          },
        };
      }
      if (ev.type === 'seat-left' && players[ev.playerId]) {
        const rest = { ...players };
        delete rest[ev.playerId];
        players = rest;
      }
      const seat = seatOf(msg.view, state.playerId);
      // A round that has ended, or moved on to somebody else, takes the controls with it. Leaving a
      // stale legal set on screen is how a player presses a button for a turn they no longer have.
      const turn = turnFromView(msg.view, seat, state.turn);
      return { ...state, view: msg.view, names, players, log: appendLog(state.log, ev), logSeq: state.logSeq + 1, turn };
    }
    case 'turn':
      return { ...state, turn: { roundNo: msg.handNo, seat: msg.seat, legal: msg.legal, deadline: msg.deadline } };
    case 'error':
      return {
        ...state,
        error: { code: msg.code, message: msg.message },
        // A refused move means the server no longer expects the turn as we knew it.
        turn: msg.code === 'not-your-turn' || msg.code === 'no-hand' ? null : state.turn,
      };
    case 'pong':
      return state;
    default:
      return state;
  }
}

export function dismissCanastaError(state: CanastaTableState): CanastaTableState {
  return state.error ? { ...state, error: null } : state;
}

export function setCanastaConnection(state: CanastaTableState, connection: ConnectionStatus): CanastaTableState {
  return state.connection === connection ? state : { ...state, connection };
}
