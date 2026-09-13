import type { LobbyDO } from './lobby-do.js';
import type { SessionDO } from './session-do.js';
import type { PokerTableDO } from './table-do.js';

/** Worker bindings. Vars come from wrangler.toml `[vars]` / `[env.<name>.vars]`; secrets from `.dev.vars` or `wrangler secret put`. */
export interface Env {
  TABLES: DurableObjectNamespace<PokerTableDO>;
  LOBBIES: DurableObjectNamespace<LobbyDO>;
  /** One instance per playerId; holds the server-side half of a Home session (see session-do.ts). */
  SESSIONS: DurableObjectNamespace<SessionDO>;
  /** One instance per club; holds its roster and answers standing (see club-do.ts). */
  /** One instance per playerId; the index of clubs they are in. A projection, never the record. */

  CHAIN_ID: string;
  RPC_URL: string;
  /** "true" enables POST /dev/session. Never true in a deployed env. */
  ALLOW_AGENT_ENDPOINT?: string;
  /**
   * HOW THE CARD ROOM NAMES ITSELF TO A PERSON'S OWN AGENT. Both secrets, both from
   * `scripts/mint-house-wire.mts`: the wire is a narrow delegation from the house service Smart Agent to
   * a session key, pinned to the one selector a Home's standard surface admits; the key is the only thing
   * this Worker holds. Absent, calls to agents outside the house go out unsigned — which a Home refuses,
   * and the refusal names the fact.
   */
  HOUSE_A2A_WIRE?: string;
  HOUSE_A2A_SESSION_KEY?: string;
  AGENT_BASE_URL?: string;
  /** Comma-separated list of allowed browser origins. */
  ALLOWED_ORIGINS: string;
  /**
   * Asset base units per chip for tables opened FROM NOW ON (1000000 = 1 Sheqel at 6 decimals). Read
   * once, when a table is created, and stamped on it. Never read at settlement time.
   */
  CHIP_VALUE: string;
  /**
   * The rate tables created before the rate was pinned have been settling at. Used ONLY to stamp
   * such a table on its first load, so raising `CHIP_VALUE` cannot re-value stacks that are already
   * on a table. Removable once every live table has loaded once.
   */
  LEGACY_CHIP_VALUE?: string;
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
  /** How long ADVICE may take. Longer than a turn call: a person's own agent at their Home reasons
   *  through a spot in 15–20 s, and advice is read by a person, not applied by a clock. */
  A2A_ADVICE_TIMEOUT_MS?: string;
  A2A_REVIEW_TIMEOUT_MS?: string;
  /** The estate's AgentProfileResolver — where `atl:capabilities` (what an agent answers) is read from. */
  AGENT_PROFILE_RESOLVER?: string;
  /** Coach SERVICES this card room offers for hire, by typed name (`bob-coach.svc,…`). Each must advertise
   *  `poker.advise`; the hiring itself happens at the person's Home. */
  COACH_SERVICES?: string;
  /** The Home's coach-hire template name, when this deployment's Home supports it. Unset ⇒ hiring is not offered. */
  HOME_COACH_TEMPLATE?: string;
  /**
   * THE PAIRED SECRET with the Home's A2A worker (`CLUB_ROSTER_SECRET` there; `wrangler secret put` on both).
   * Two uses: naming a member to the Home's club huddle (spec 378), and asking which clubs a person is in.
   * Everything else about a club is done AS the club under its wire (`clubs.ts`).
   */
  CLUB_ROSTER_SECRET?: string;
  /** The wires clubs signed for this card room, keyed `wire:<club agent>` — the one thing kept about a club. */
  CLUB_WIRES?: KVNamespace;
  /** The estate's UniversalSignatureValidator — how a club's wire is checked against the club's own account. */
  UNIVERSAL_SIGNATURE_VALIDATOR?: string;
  /** The Home's A2A worker origin the browser talks to for huddles — `https://a2a.faithnet.io` (`/config` carries it). */
  HOME_A2A_ORIGIN?: string;
  /**
   * How long an agent's answer WAITS before it is applied, in ms. Default 1400; 0 disables.
   *
   * An agent answers in a couple of hundred milliseconds, so three of them take a whole round of
   * turns between two frames and a person at the table sees results without ever seeing the moves.
   * The pause is spent after the agent has already thought, so it costs the table nothing on the
   * clock — it uses time the turn was allowed anyway — and it is what makes a bot game watchable.
   */
  AGENT_PACE_MS?: string;

  /**
   * The settlement asset — Poker Night's own coin, Sheqel (`contracts/src/Sheqel.sol`), and the
   * ONLY currency this card room settles in. Read once, when a table is created, and stamped on it,
   * so every amount a table moves is denominated in the coin the TABLE records rather than in
   * whatever this variable currently says.
   */
  ASSET?: string;
  /** What `ASSET` calls itself (`SHQ`). Stamped alongside the address so a table can label its own
   *  money without a lookup table of addresses. */
  ASSET_SYMBOL?: string;
  /** Phase 3 contract addresses; empty in dev. */
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
  /**
   * `AgentNameUniversalResolver` — the one contract that answers "what address is `carol.me`?".
   *
   * Wired so a host can put somebody on a club roster by the name they know them by. Absent means
   * this deployment cannot resolve names, and every invitation by name is refused saying exactly
   * that rather than falling back to a guess.
   */
  AGENT_NAME_UNIVERSAL_RESOLVER?: string;
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

  /**
   * How long a seat must have been silent before an operator may clear it, in ms. The fourth of the
   * four conditions on `DELETE /tables/:id/seat/:seat`; see `SEAT_IDLE_MS` in wrangler.toml.
   */
  SEAT_IDLE_MS?: string;

  /** Secrets. */
  SESSION_SECRET?: string;
  /**
   * Operator authority for `DELETE /tables/:id/seat/:seat`, presented as `x-operator-token`.
   *
   * There is no admin ROLE in this app — no player is an operator and no session can become one —
   * so the one route that can take a seat away from somebody is gated on a shared secret held by
   * whoever runs the deployment. It is compared in constant time (`operator.ts`), it is never
   * logged, and on its own it clears nothing: three further conditions about the seat itself must
   * also hold. `wrangler secret put OPERATOR_TOKEN --env <env>`; never a var, never in git.
   */
  OPERATOR_TOKEN?: string;
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

/**
 * Where the SITE is — the thing a person opens, not the API.
 *
 * A calendar entry has to carry a link somebody can press from their phone, and a Worker only knows
 * its own origin. The first allowed origin IS the site (that is what the list is: the browsers this
 * API answers), so this needs no new configuration to be right on every deployment.
 */
export function siteOrigin(env: Env): string {
  return allowedOrigins(env)[0] ?? 'https://poker.faithnet.io';
}

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
/**
 * Long enough to watch a card move and hear the line that goes with it.
 *
 * Arrived at by playing: 1400 was reported as about twice too fast, 2800 was closer, and 3500 is
 * where a line of commentary finishes before the next move starts. A pace shorter than the spoken
 * line means the voice is permanently behind the table. A table can set its own — `TableMeta.paceMs`
 * — and a person who knows the game will want it faster.
 */
export const DEFAULT_AGENT_PACE_MS = 3500;

export function a2aTimeoutMs(env: Env): number {
  const n = Number(env.A2A_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_A2A_TIMEOUT_MS;
}

/**
 * The advice budget — its own number, because it is a different kind of wait.
 *
 * A turn call is inside a clock: an agent that is slow costs everybody at the table time, so 20 s is
 * generous. Advice goes to ONE person's own agent at their Home, where a run that reasons through the
 * spot takes 15–20 s, and the only thing waiting on it is that person's decision. Cut at 20 s, the
 * best answers were the ones that timed out and fell back to the house. Defaults to 35 s.
 */
export const DEFAULT_A2A_ADVICE_TIMEOUT_MS = 35_000;
export function a2aAdviceTimeoutMs(env: Env): number {
  const n = Number(env.A2A_ADVICE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_A2A_ADVICE_TIMEOUT_MS;
}

/**
 * The review budget. A review is the person's own question about their past hands, forwarded by their
 * agent to their coach, which reads the recorded hands and writes a few paragraphs — a minute is the
 * right order, and nothing at the table waits on it but the person who asked. Defaults to 75 s.
 */
export const DEFAULT_A2A_REVIEW_TIMEOUT_MS = 75_000;
export function a2aReviewTimeoutMs(env: Env): number {
  const n = Number(env.A2A_REVIEW_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_A2A_REVIEW_TIMEOUT_MS;
}

/** How long an agent's answer waits before it lands. `0` turns the pacing off entirely. */
export function agentPaceMs(env: Env): number {
  const raw = (env.AGENT_PACE_MS ?? '').trim();
  if (!raw) return DEFAULT_AGENT_PACE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 5000) : DEFAULT_AGENT_PACE_MS;
}

/**
 * How long a seat must have been silent before an operator may clear it. Default five minutes: long
 * enough that a player refilling a glass of water cannot be cleared out from under their chips,
 * short enough that a table silted up with abandoned seats is recoverable the same evening.
 */
export const DEFAULT_SEAT_IDLE_MS = 5 * 60 * 1000;

export function seatIdleMs(env: Env): number {
  const n = Number(env.SEAT_IDLE_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_SEAT_IDLE_MS;
}
