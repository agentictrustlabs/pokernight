import type { LobbyDO } from './lobby-do.js';
import type { PokerTableDO } from './table-do.js';

/** Worker bindings. Vars come from wrangler.toml `[vars]` / `[env.<name>.vars]`; secrets from `.dev.vars` or `wrangler secret put`. */
export interface Env {
  TABLES: DurableObjectNamespace<PokerTableDO>;
  LOBBIES: DurableObjectNamespace<LobbyDO>;

  CHAIN_ID: string;
  RPC_URL: string;
  /** "true" enables POST /dev/session. Never true in a deployed env. */
  DEV_AUTH: string;
  /** Comma-separated list of allowed browser origins. */
  ALLOWED_ORIGINS: string;
  /** Asset base units per chip (default 10000 = 0.01 USDC at 6 decimals). */
  CHIP_VALUE: string;
  HOME_ORIGIN: string;
  HOME_ZONE: string;
  AGENT_CARD_ZONE: string;

  /** Phase 3 contract addresses; empty in dev. */
  ASSET?: string;
  ENTRY_POINT?: string;
  AGENT_ACCOUNT_FACTORY?: string;
  DELEGATION_MANAGER?: string;
  PAYMENT_ENFORCER?: string;
  DIGEST_BINDING_ENFORCER?: string;
  PAYMENT_RECEIPT_REGISTRY?: string;
  HOUSE_SA?: string;
  HOUSE_DELEGATE?: string;

  /** Secrets. */
  SESSION_SECRET?: string;
  RPC_TOKEN?: string;
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
