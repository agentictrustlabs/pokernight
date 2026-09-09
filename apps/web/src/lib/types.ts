/**
 * Type-only re-exports of the wire contract. The web client never imports
 * protocol *values* (zod schemas), so nothing from `zod` ends up in the bundle.
 */
export type {
  Action,
  ClientCommand,
  CreateTableRequest,
  EngineEvent,
  LegalActions,
  PlayerInfo,
  SeatStandUpFailure,
  SeatStoodUp,
  ServerMessage,
  Session,
  SignOutResult,
  SitOutReason,
  TableConfig,
  TableEvent,
  TableSummary,
  TableView,
  WsErrorCode,
} from '@pokernight/protocol';
export type { Card, HandResult, HandRank, Pot, PotAward, SeatView, Street, ActionRecord } from '@pokernight/engine';

import type { Session } from '@pokernight/protocol';

/**
 * The session as the client holds it. `Session` (token/playerId/name) is the wire contract every
 * route already speaks; the extra fields are display-only and come from `POST /auth/home`.
 */
export interface AppSession extends Session {
  /** Which door this session came through. `demo` is a Home quick-connect identity: a real Smart
   *  Agent, verified the same way, but one the Home lends to anyone who asks. */
  via: 'home' | 'dev' | 'demo';
  /** Person's Smart Agent address, lowercased (Home sessions only). */
  address?: string;
  /** The `agent_name` the Home asserted, e.g. `richard.me` (Home sessions only). */
  agentName?: string;
}
