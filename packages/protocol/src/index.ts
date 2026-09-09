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

/**
 * Asset base units one chip is worth AT THIS TABLE, as a decimal string (bigints do not survive
 * JSON). It is captured when the table is created and never changes afterwards, so a stack bought
 * at one rate can never be cashed out at another — see `PokerTableDO`.
 *
 * Optional because a table created before rates were pinned has none until its first load, and
 * because a deployment with no `CHIP_VALUE` configured has no rate to pin. A client that does not
 * know the rate must say so rather than guess one.
 */
export const ChipValueSchema = z.string().regex(/^\d+$/);

/**
 * The settlement ASSET a table pays in, as a 20-byte address, pinned exactly like the chip rate and
 * for the same reason — only harder. A rate that moved under an open table over- or under-paid a
 * stack; an ASSET that moved under an open table would take a buy-in in one currency and pay the
 * cash-out in another, which is not a mispricing but a different promise altogether.
 *
 * Optional because a table created before the asset was pinned has none until its first load, and
 * because a play-money table settles in nothing at all.
 */
export const AssetAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/** What the pinned asset calls itself, e.g. `SHQ` or `USDC`. A label for the address above, so a
 *  client can name the money without holding a table of addresses. */
export const AssetSymbolSchema = z.string().min(1).max(12);

export const TableSummarySchema = z.object({
  tableId: z.string(),
  name: z.string(),
  config: TableConfigSchema,
  settlement: SettlementModeSchema,
  seated: z.number().int(),
  handNo: z.number().int(),
  createdAt: z.number(),
  /** This table's chip rate. See {@link ChipValueSchema}. Meaningless on a play-money table. */
  chipValue: ChipValueSchema.optional(),
  /** This table's settlement asset. See {@link AssetAddressSchema}. */
  asset: AssetAddressSchema.optional(),
  /** What that asset calls itself. See {@link AssetSymbolSchema}. */
  assetSymbol: AssetSymbolSchema.optional(),
});
export type TableSummary = z.infer<typeof TableSummarySchema>;

/**
 * What a chip is worth, for a client that has to show both units.
 *
 * `null` is the honest answer on a play-money table (chips are the whole story there) and on a
 * settled one whose rate has not been read yet. The two are different situations and callers that
 * care distinguish them by `settlement`; what they must never do is invent a rate.
 */
export function tableChipValue(summary: Pick<TableSummary, 'settlement' | 'chipValue'>): bigint | null {
  if (summary.settlement === 'play-money') return null;
  if (!summary.chipValue || !/^\d+$/.test(summary.chipValue)) return null;
  const v = BigInt(summary.chipValue);
  return v > 0n ? v : null;
}

/**
 * What this table's money is CALLED, for a client that has to put a ticker next to a number.
 *
 * `null` on a play-money table, where there is no money. A settled table that states no symbol is a
 * table opened before the app had a currency of its own, and those settle in USDC — which is why
 * that, and not the deployment's current coin, is the fallback. Naming today's coin on a table that
 * pays in yesterday's would be a wrong label on a real amount of money.
 */
export const LEGACY_ASSET_SYMBOL = 'USDC';

export function tableAssetSymbol(summary: Pick<TableSummary, 'settlement' | 'assetSymbol'>): string | null {
  if (summary.settlement === 'play-money') return null;
  const s = (summary.assetSymbol ?? '').trim();
  return s === '' ? LEGACY_ASSET_SYMBOL : s;
}

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

/* ------------------------------------------------------ sign-out / seat clearing */

/**
 * What happened to ONE seat a player was holding when something stood them up.
 *
 * `pending` is the honest half: on a settled table the cash-out is queued on the table's outbox and
 * the USDC has NOT moved yet. A client that reports "your money is back" off the back of a 200 here
 * would be lying, so the shape makes the difference impossible to gloss over.
 */
export interface SeatStoodUp {
  tableId: string;
  tableName?: string;
  seat: number;
  /** Chips that left the seat. */
  chips: number;
  settlement: SettlementMode;
  /** True when a real asset movement is queued and has not settled yet. Always false on play money. */
  pending: boolean;
}

/** A seat we could not stand the player up from, and why. Their chips are still on it. */
export interface SeatStandUpFailure {
  tableId: string;
  tableName?: string;
  reason: string;
}

/** `POST /auth/signout`. An explicit sign-out gives up every seat; see the route's own comment. */
export interface SignOutResult {
  ok: boolean;
  stoodUp: SeatStoodUp[];
  failed: SeatStandUpFailure[];
}

/**
 * The four conditions `DELETE /tables/:id/seat/:seat` requires, in the order it checks them. A
 * refusal always names exactly one of them, so an operator is never left guessing which gate closed.
 *
 *   'operator'  — the caller did not present the operator token.
 *   'empty'     — nobody is on that seat.
 *   'connected' — the seat still has a live socket; a connected player is not abandoned.
 *   'in-hand'   — the seat is in a hand that is still running.
 *   'idle'      — the seat has been active more recently than the idle threshold.
 */
export const SEAT_CLEAR_REFUSALS = ['operator', 'empty', 'connected', 'in-hand', 'idle'] as const;
export type SeatClearRefusal = (typeof SEAT_CLEAR_REFUSALS)[number];

/** Body of a refusal from the operator seat-clearing route. */
export interface SeatClearRefused {
  error: string;
  refused: SeatClearRefusal;
}

/** Body of a successful clear. Same shape of truth as {@link SeatStoodUp}: `pending` is not a lie. */
export interface SeatCleared {
  ok: true;
  tableId: string;
  seat: number;
  playerId: string;
  name: string;
  chips: number;
  settlement: SettlementMode;
  pending: boolean;
  /** How long the seat had been idle when it was cleared, in ms. */
  idleMs: number;
}

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

/**
 * WHY a seat is sitting out. A sit-out is not self-explanatory to the person it happened to: a
 * player who closed a laptop lid and came back has no idea their seat was taken out of the deal, and
 * a table that simply stops dealing to them looks broken. Every sit-out therefore carries the reason
 * it happened, so the client can say it in a sentence next to the button that undoes it.
 *
 *   'requested'    — the player pressed "Sit out".
 *   'disconnected' — their last socket closed. Their seat and chips are untouched; nothing settles.
 *   'timeouts'     — they missed enough turns in a row that the table stopped dealing them in.
 */
export const SIT_OUT_REASONS = ['requested', 'disconnected', 'timeouts'] as const;
export type SitOutReason = (typeof SIT_OUT_REASONS)[number];

export interface SeatEvent {
  type: 'seat-joined' | 'seat-left' | 'seat-status';
  seat: number;
  playerId: string;
  name?: string;
  stack?: number;
  status?: 'active' | 'sitting-out';
  /** Set with `status: 'sitting-out'`; absent when the seat is active again. See {@link SitOutReason}. */
  sitOutReason?: SitOutReason;
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
  /**
   * Why this player's seat is sitting out, when it is. Carried on `players` (and so on `welcome`)
   * as well as on the `seat-status` event, because the person who most needs the explanation is
   * exactly the one who was not connected when it happened.
   */
  sitOutReason?: SitOutReason;
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
  /** An action arrived while NO hand was running. Distinct from not-your-turn on purpose: telling a
   *  player it is not their turn when there is no turn to have sends them looking for a hand that
   *  does not exist. */
  'no-hand',
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
