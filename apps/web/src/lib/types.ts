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
  ServerMessage,
  Session,
  TableConfig,
  TableEvent,
  TableSummary,
  TableView,
  WsErrorCode,
} from '@pokernight/protocol';
export type { Card, HandResult, HandRank, Pot, PotAward, SeatView, Street, ActionRecord } from '@pokernight/engine';
