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

/** Seat an A2A agent at a table. The table resolves the agent card, then calls `poker.act` on its turn. */
export const SeatAgentRequestSchema = z.object({
  seat: z.number().int().min(0).max(8),
  buyIn: z.number().int().positive(),
  /** Agent name, e.g. "sharkbot.svc". Resolved to a host via the table's AGENT_CARD_ZONE. */
  agentName: z.string().min(1).max(128),
  /** Explicit base URL, overriding name resolution. Used in local dev. */
  endpoint: z.string().url().optional(),
  /** Display name at the table; defaults to the agent card's name. */
  displayName: z.string().min(1).max(32).optional(),
});
export type SeatAgentRequest = z.infer<typeof SeatAgentRequestSchema>;

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
  /** Carried on seat-joined so a client can badge an agent seated mid-session, before any snapshot. */
  kind?: 'human' | 'agent';
  agentName?: string;
  agentKind?: string;
}

export interface ChatEvent {
  type: 'chat';
  playerId: string;
  name: string;
  text: string;
  at: number;
}

export type TableEvent = EngineEvent | SeatEvent | ChatEvent;

/** Who occupies a seat. `names` stays for compatibility; `players` carries the richer record. */
export interface PlayerInfo {
  playerId: string;
  name: string;
  kind: 'human' | 'agent';
  /** For agents: the A2A agent name, e.g. "sharkbot.svc". */
  agentName?: string;
  /** For agents: a short label for the strategy behind it, e.g. "rules" or "claude". */
  agentKind?: string;
}

export type ServerMessage =
  | { type: 'welcome'; tableId: string; playerId: string | null; view: TableView; names: Record<string, string>; players?: Record<string, PlayerInfo> }
  | { type: 'snapshot'; view: TableView; names: Record<string, string>; players?: Record<string, PlayerInfo> }
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

/* ------------------------------------------------- A2A standard transport */

/**
 * Pokernight speaks the STANDARD A2A profile from `@agenticprimitives/a2a/standard`,
 * not the delegation profile. `SendMessage` there is synchronous: the agent replies
 * with a message and no task, which is what a turn clock needs. Authorization is
 * added in phase 3, when a seat can move money.
 */
export const A2A_JSONRPC_PATH = '/api/a2a';
export const A2A_AGENT_CARD_PATH = '/.well-known/agent-card.json';
export const A2A_SEND_MESSAGE = 'SendMessage';

/** Map an agent name to its card host: `sharkbot.svc` in zone `faithnet.ai` → `sharkbot-svc.faithnet.ai`. */
export function agentNameToHost(agentName: string, zone: string): string {
  const label = agentName.trim().toLowerCase().replace(/\./g, '-');
  return `${label}.${zone}`;
}

/** The turn request as A2A message parts: one data part carrying PokerActInput. */
export function encodePokerActParts(input: PokerActInput): Array<{ kind: 'data'; data: Record<string, unknown> }> {
  return [{ kind: 'data', data: { skill: POKER_ACT_SKILL, input: input as unknown as Record<string, unknown> } }];
}

/** Pull a PokerActOutput out of an A2A reply. Accepts a data part, or a text part holding JSON. */
export function decodePokerActReply(parts: unknown): PokerActOutput | { error: string } {
  if (!Array.isArray(parts)) return { error: 'reply has no parts' };
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { kind?: string; data?: unknown; text?: string };
    let candidate: unknown;
    if (p.kind === 'data' && p.data && typeof p.data === 'object') {
      const d = p.data as Record<string, unknown>;
      candidate = 'action' in d ? d : d['output'];
    } else if (p.kind === 'text' && typeof p.text === 'string') {
      try { candidate = JSON.parse(p.text); } catch { continue; }
    }
    if (!candidate) continue;
    const r = PokerActOutputSchema.safeParse(candidate);
    if (r.success) return r.data;
  }
  return { error: 'no valid poker.act output in reply' };
}
