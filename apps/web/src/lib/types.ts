/**
 * Type-only re-exports of the wire contract. The web client never imports
 * protocol *values* (zod schemas), so nothing from `zod` ends up in the bundle.
 */
/**
 * THIS CLIENT SPEAKS POKER, and this is where it says so.
 *
 * The protocol carries a game's view, legal actions and events opaquely, because it has to serve
 * every game the deployment ships. A client serves one. So `ServerMessage` and `TableEvent` here are
 * the protocol's POKER BINDING of those messages, aliased to the generic names the rest of this app
 * already uses — one narrowing, at the app's type boundary, instead of a cast at every field.
 *
 * `PokerTableDO` widens at the matching seam on its side. A canasta client would alias a canasta
 * binding here and change nothing else about how it reads a socket.
 */
export type {
  PokerServerMessage as ServerMessage,
  PokerTableEvent as TableEvent,
  PokerGameConfig,
  Action,
  ClientCommand,
  ClubMember,
  ClubStanding,
  ClubSummary,
  ClubView,
  ClubSchedule,
  MissionVisit,
  MissionVisitStatus,
  Night,
  NightStatus,
  KnownPerson,
  CreateTableRequest,
  EngineEvent,
  LegalActions,
  PlayerInfo,
  SeatStandUpFailure,
  SeatStoodUp,
  Session,
  SignOutResult,
  SitOutReason,
  TableConfig,
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
