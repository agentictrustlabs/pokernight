/**
 * @pokernight/protocol — wire schemas.
 *
 * Three surfaces share these types:
 *   1. WebSocket between a client (browser or bot) and a PokerTableDO.
 *   2. HTTP lobby/table API of the tables Worker.
 *   3. The `poker.act` A2A skill (agent turn request/response).
 *
 * Engine types are the source of truth; the zod schemas here validate untrusted
 * input at the edges and are typed against the engine to stay in sync.
 */

import { z } from 'zod';
import type { Action, LegalActions, TableConfig, TableView, EngineEvent } from '@pokernight/engine';

export type { Action, LegalActions, TableConfig, TableView, EngineEvent };

/* ------------------------------------------------------------------ cards */

export const CardSchema = z.string().regex(/^[2-9TJQKA][shdc]$/);

/* ---------------------------------------------------------------- actions */

export const ActionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call') }),
  z.object({ type: z.literal('bet'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('raise'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('all-in') }),
]);

export const LegalActionsSchema: z.ZodType<LegalActions> = z.object({
  fold: z.boolean(),
  check: z.boolean(),
  call: z.number().int().nonnegative().nullable(),
  bet: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  raise: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  allIn: z.number().int().nonnegative(),
});

/* ----------------------------------------------------------------- config */

export const TableConfigSchema: z.ZodType<TableConfig> = z.object({
  seats: z.number().int().min(2).max(9),
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  ante: z.number().int().nonnegative(),
  minBuyIn: z.number().int().positive(),
  maxBuyIn: z.number().int().positive(),
  actionTimeoutMs: z.number().int().min(1000),
});

export const TableConfigPatchSchema = (TableConfigSchema as unknown as z.AnyZodObject).partial();

/* --------------------------------------------------------- table settlement */

export const SettlementModeSchema = z.enum(['play-money', 'mandate-transfer', 'table-escrow']);
export type SettlementMode = z.infer<typeof SettlementModeSchema>;

/* --------------------------------------------------------------- HTTP API */

export const CreateTableRequestSchema = z.object({
  name: z.string().min(1).max(64),
  config: TableConfigPatchSchema.optional(),
  settlement: SettlementModeSchema.default('play-money'),
  /** Circle (context agent) that owns the table; optional in phase 1. */
  circle: z.string().optional(),
});
export type CreateTableRequest = z.infer<typeof CreateTableRequestSchema>;

export const TableSummarySchema = z.object({
  tableId: z.string(),
  name: z.string(),
  config: TableConfigSchema,
  settlement: SettlementModeSchema,
  seated: z.number().int(),
  handNo: z.number().int(),
  createdAt: z.number(),
});
export type TableSummary = z.infer<typeof TableSummarySchema>;

/** Dev-only login (DEV_AUTH=true). Production uses the Home OIDC flow. */
export const DevSessionRequestSchema = z.object({ name: z.string().min(1).max(32) });
export const SessionSchema = z.object({ token: z.string(), playerId: z.string(), name: z.string() });
export type Session = z.infer<typeof SessionSchema>;

/* ------------------------------------------------------- WebSocket: client */

export const ClientCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), seat: z.number().int().min(0).max(8), buyIn: z.number().int().positive() }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('sit-out') }),
  z.object({ type: z.literal('sit-in') }),
  z.object({ type: z.literal('add-chips'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('act'), handNo: z.number().int(), action: ActionSchema }),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(280) }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientCommand = z.infer<typeof ClientCommandSchema>;

/* ------------------------------------------------------- WebSocket: server */

export interface SeatEvent {
  type: 'seat-joined' | 'seat-left' | 'seat-status';
  seat: number;
  playerId: string;
  name?: string;
  stack?: number;
  status?: 'active' | 'sitting-out';
}

export interface ChatEvent {
  type: 'chat';
  playerId: string;
  name: string;
  text: string;
  at: number;
}

export type TableEvent = EngineEvent | SeatEvent | ChatEvent;

export type ServerMessage =
  | { type: 'welcome'; tableId: string; playerId: string | null; view: TableView; names: Record<string, string> }
  | { type: 'snapshot'; view: TableView; names: Record<string, string> }
  /** One event plus the fresh view after it. `event` is already redacted for this viewer. */
  | { type: 'event'; event: TableEvent; view: TableView }
  /** It is the viewer's turn. `deadline` is an absolute ms timestamp. */
  | { type: 'turn'; handNo: number; seat: number; legal: LegalActions; deadline: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; at: number };

export const WS_ERROR_CODES = [
  'unauthenticated',
  'bad-command',
  'seat-taken',
  'seat-invalid',
  'player-seated',
  'not-seated',
  'buy-in-range',
  'not-your-turn',
  'illegal-action',
  'stale-hand',
  'settlement-failed',
] as const;
export type WsErrorCode = (typeof WS_ERROR_CODES)[number];

/* ---------------------------------------------------------- A2A poker.act */

export const POKER_ACT_SKILL = 'poker.act';

export interface PokerActInput {
  tableId: string;
  handNo: number;
  seat: number;
  /** Redacted view for this seat (own hole cards included). */
  view: TableView;
  legal: LegalActions;
  /** Milliseconds the agent has to answer before the table applies the default. */
  deadlineMs: number;
}

export const PokerActOutputSchema = z.object({
  action: ActionSchema,
  /** Optional short rationale, logged with the hand history, never shown to other players during the hand. */
  note: z.string().max(280).optional(),
});
export type PokerActOutput = z.infer<typeof PokerActOutputSchema>;

/* ---------------------------------------------------------------- helpers */

export function parseClientCommand(raw: unknown): ClientCommand | { error: string } {
  const r = ClientCommandSchema.safeParse(raw);
  return r.success ? r.data : { error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
