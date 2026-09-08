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
