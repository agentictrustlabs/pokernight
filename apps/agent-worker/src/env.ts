/**
 * Worker bindings for `pokernight-agent-worker`.
 *
 * Vars come from `wrangler.toml` `[vars]` / `[env.<name>.vars]`. The Anthropic key is a SECRET and is
 * never listed in `[vars]`: `wrangler secret put ANTHROPIC_API_KEY --env <env>` (or `.dev.vars` locally).
 */
export interface Env {
  /** Zone the persona agent cards live on, e.g. `faithnet.ai`. `sharkbot.svc` -> `sharkbot-svc.faithnet.ai`. */
  AGENT_CARD_ZONE: string;
  /** Public origin of this Worker, used to build card URLs when the request did not arrive on a persona host. */
  PUBLIC_ORIGIN: string;
  /** Strategy used when a persona does not name one (and the floor when it names an unknown one). */
  DEFAULT_STRATEGY: string;
  /** Anthropic model id for the `claude` strategy. */
  LLM_MODEL: string;
  /** `output_config.effort`. "low" keeps a turn inside the table's action clock. */
  LLM_EFFORT: string;

  /** SECRET. Absent is fine: the `claude` strategy logs once and plays the rules baseline. */
  ANTHROPIC_API_KEY?: string;
  /**
   * ADMISSION (2026-09-13). Set all of these and the A2A door admits ONLY the card room's house agent: an
   * `A2A-Session` assertion over the house wire (delegator = HOUSE_SERVICE_SA), verified against the house
   * account's ERC-1271 through the estate's validator, unrevoked at the DelegationManager, pinned by the
   * enforcers. Leave them unset (local dev, tests) and the door is open, as it was in phase 2 — and says so
   * once in the log. Never enable a language-model persona on a deployment with the door open.
   */
  RPC_URL?: string;
  CHAIN_ID?: string;
  UNIVERSAL_SIGNATURE_VALIDATOR?: string;
  DELEGATION_MANAGER?: string;
  TIMESTAMP_ENFORCER?: string;
  ALLOWED_METHODS_ENFORCER?: string;
  HOUSE_SERVICE_SA?: string;
}

/** Effort levels the Messages API accepts; anything else falls back to "low". */
export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function llmEffort(env: Env): LlmEffort {
  const raw = (env.LLM_EFFORT ?? '').trim().toLowerCase();
  return (EFFORTS.includes(raw) ? raw : 'low') as LlmEffort;
}

export function llmModel(env: Env): string {
  return (env.LLM_MODEL ?? '').trim() || 'claude-opus-5';
}
