import type { LobbyDO } from './lobby-do.js';
import type { SessionDO } from './session-do.js';
import type { PokerTableDO } from './table-do.js';

/** Worker bindings. Vars come from wrangler.toml `[vars]` / `[env.<name>.vars]`; secrets from `.dev.vars` or `wrangler secret put`. */
export interface Env {
  TABLES: DurableObjectNamespace<PokerTableDO>;
  LOBBIES: DurableObjectNamespace<LobbyDO>;
  /** One instance per playerId; holds the server-side half of a Home session (see session-do.ts). */
  SESSIONS: DurableObjectNamespace<SessionDO>;

  CHAIN_ID: string;
  RPC_URL: string;
  /** "true" enables POST /dev/session. Never true in a deployed env. */
  DEV_AUTH: string;
  ALLOW_AGENT_ENDPOINT?: string;
  AGENT_BASE_URL?: string;
  /** Comma-separated list of allowed browser origins. */
  ALLOWED_ORIGINS: string;
  /** Asset base units per chip (default 10000 = 0.01 USDC at 6 decimals). */
  CHIP_VALUE: string;
  /** The person's Home (OIDC issuer). Sign-in redirects here; the Worker exchanges the code here. */
  HOME_ORIGIN: string;
  /** Zone the Home lives under. The issuer allowlist accepts the apex and single-label subdomains. */
  HOME_ZONE: string;
  /** OIDC `client_id` registered with the Home (= the id_token `aud`). */
  HOME_CLIENT_ID: string;
  /** The relying-site delegate the Home scopes its grant TO. Address, from the client registration. */
  HOME_DELEGATE: string;
  /** The registered redirect URI, byte-identical at authorize and at /token. Defaults to the first
   *  ALLOWED_ORIGINS entry + "/" so `wrangler dev` needs no extra config. */
  HOME_REDIRECT_URI?: string;
  AGENT_CARD_ZONE: string;
  /** Wall clock for one A2A call (agent card fetch, `poker.act` turn). Default 20000. */
  A2A_TIMEOUT_MS?: string;

  /** Phase 3 contract addresses; empty in dev. */
  ASSET?: string;
  ENTRY_POINT?: string;
  AGENT_ACCOUNT_FACTORY?: string;
  DELEGATION_MANAGER?: string;
  PAYMENT_ENFORCER?: string;
  DIGEST_BINDING_ENFORCER?: string;
  /** The three enforcers a payment mandate composes besides PAYMENT_ENFORCER. Without them a player
   *  cannot be ASKED to sign a buy-in mandate, and the treasury routes say so by name. */
  TIMESTAMP_ENFORCER?: string;
  ALLOWED_TARGETS_ENFORCER?: string;
  ALLOWED_METHODS_ENFORCER?: string;
  /** `AgentNameRegistry` and the `.treasury` subregistry — only the optional label needs them. */
  AGENT_NAME_REGISTRY?: string;
  TREASURY_SUBREGISTRY?: string;
  PAYMENT_RECEIPT_REGISTRY?: string;
  /** Paymaster that sponsors the house's UserOps (dev mode on faithchain). */
  SMART_AGENT_PAYMASTER?: string;
  /** The Poker Site's own Smart Agents, provisioned by scripts/provision-house.mts. */
  HOUSE_SERVICE_SA?: string;
  HOUSE_TREASURY_SA?: string;
  /** Alias of HOUSE_TREASURY_SA (see settlement.ts). */
  HOUSE_SA?: string;
  HOUSE_DELEGATE?: string;

  /** The biggest single buy-in a mandate may cover, in chips, and how many of them a night allows.
   *  Both are the player's exposure ceiling, shown on the consent screen before they sign. */
  MANDATE_MAX_BUY_IN_CHIPS?: string;
  MANDATE_MAX_BUY_INS?: string;
  /** How long a signed mandate lasts, in seconds. One night, not one year. */
  MANDATE_VALID_SECONDS?: string;

  /** Secrets. */
  SESSION_SECRET?: string;
  RPC_TOKEN?: string;
  /**
   * Private key of the EOA that custodies HOUSE_SERVICE_SA / HOUSE_TREASURY_SA. It SIGNS the
   * userOpHash of every house transfer and nothing else — the asset lives in the Smart Agents.
   * `wrangler secret put HOUSE_CUSTODIAN_KEY --env <env>`. Never a var; never in git.
   */
  HOUSE_CUSTODIAN_KEY?: string;
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isDevAuth(env: Env): boolean {
  return env.DEV_AUTH === 'true';
}

/**
 * Whether `seat-agent` accepts a caller-supplied `endpoint`. Deliberately SEPARATE from DEV_AUTH:
 * dev auth governs who may log in, this governs which hosts the table will fetch every turn.
 * Defaults to false, so a deployment has to opt in.
 */
/**
 * Operator-configured base for agent personas served from ONE host, e.g.
 * `https://agents.faithnet.io` + `/sharkbot.svc`. Set, it wins over per-agent host resolution.
 * This is deployment config, never caller input, so it is not part of the SSRF surface.
 */
export function agentBaseUrl(env: Env): string | null {
  const v = (env.AGENT_BASE_URL ?? '').trim();
  return v === '' ? null : v.replace(/\/+$/, '');
}

export function allowAgentEndpoint(env: Env): boolean {
  return env.ALLOW_AGENT_ENDPOINT === 'true';
}

/** Default wall clock for one A2A request. The turn clock always bounds it further. */
export const DEFAULT_A2A_TIMEOUT_MS = 20_000;

export function a2aTimeoutMs(env: Env): number {
  const n = Number(env.A2A_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_A2A_TIMEOUT_MS;
}
