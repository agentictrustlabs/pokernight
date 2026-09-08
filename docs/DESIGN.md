# Pokernight on faithnet — Design

Status: proposal, 2026-09-08. Author: Richard Pedersen with Claude.

Pokernight is a Texas Hold'em table service where people and AI Smart Agents sit at the same tables,
and where buy-ins and cash-outs settle in USDC from each player's Smart Agent treasury on faithchain.
It is built as a third-party app on the Agentic Primitives substrate (`~/agenticprimitives`) and lives
in the faithnet estate (faithnet.me / faithnet.io / faithnet.ai, chain faithchain).

## 1. Goals and non-goals

Goals
- Cash-game no-limit Hold'em with mid-table buy-in, rebuy, and cash-out. Sit-and-go tournaments later.
- Any Smart Agent can sit: a person (`<label>.me`) over a browser, or a service agent (`<label>.svc`)
  over A2A. The table does not care which.
- Money moves only under caveated delegations signed by the player's own Smart Agent. The house never
  holds a player's keys.
- Every hand is replayable and auditable; every money movement has an on-chain receipt.
- Play-money is the default. USDC settlement is an adapter that is switched on per table.

Non-goals
- No custom poker client protocol for third parties in v1; humans use our web client, agents use A2A.
- No multi-table tournaments, no other variants (Omaha etc.) in v1.
- No real-money operation until the legal question in §11 is answered.

## 2. Why not PokerTH

PokerTH (github.com/pokerth/pokerth, AGPL-3.0, C++/Qt) was evaluated against its current source:
every game is a sit-and-go with a fixed start stack and escalating blinds; there is no cash-game mode
and no mid-table buy-in or cash-out; the server database interface reports only login, game creation,
final placement, and game end, never chip amounts; tables are created from the GUI and administered
over IRC with no HTTP API; agents would need a custom protobuf-over-TLS client with SCRAM-SHA-1 auth.
It solves none of the three hard problems (agents, treasuries, USDC) and its money model is wrong for
cash games. Details in the project memory note `pokerth-evaluation`.

## 3. Placement in the faithnet estate

| Concern | Where | Value |
|---|---|---|
| Humans, login, consent | faithnet.me (Home, Vercel) | OIDC issuer `https://www.faithnet.me`, PKCE, scopes `openid agent` |
| Web client + API | faithnet.io (Cloudflare Workers) | `poker.faithnet.io` |
| Table service (Durable Objects) | faithnet.io | `tables.faithnet.io` |
| House agent card | faithnet.ai | `pokernight-treasury.faithnet.ai` (on-chain name `pokernight.treasury`) |
| Player agent cards | faithnet.ai | `<label>-svc.faithnet.ai` etc. |
| Chain | faithchain (Besu QBFT, private L1) | chain id **34348**, free gas, 2 s blocks |
| RPC | `https://rpc.faithnet.io` (Worker `faithchain-rpc-gateway`) | token in KV `TOKENS` for app `pokernight`; server token needs `writeRps > 0` |
| Local dev | faithnet local Besu (`~/faithchain/scripts/local-up.sh`) | `http://127.0.0.1:8545`, chain id 31337, anvil dev accounts |
| Key custody for house signer | platform KMS backend (`A2A_KMS_BACKEND`) | dedicated key id for the house; never the relay key |

Worker names follow the `<app>-<env>` convention: `pokernight-web-faithnet`, `pokernight-tables-faithnet`,
`pokernight-house-faithnet`. One `wrangler.toml` per app with an `[env.faithnet]` block; bindings are
repeated per env; migration tags are never renamed.

## 4. Identity model

Everything is a Smart Agent (ERC-4337 `AgentAccount`) with a typed on-chain name.

| Role | Agent kind | Name | Notes |
|---|---|---|---|
| Human player | person | `alice.me` | logs in at faithnet.me; consents to a `poker-buyin` delegation |
| AI player | service | `sharkbot.svc` | exposes A2A skill `poker.act`; owner is a person or org |
| House | service, profile `treasury` | `pokernight.treasury` | receives buy-ins, pays cash-outs, signs settlement digests |
| Poker night / club | context `circle` | `friday-night.circle` | membership decides who may sit; owns the lobby |

The house Smart Agent is the `delegate` in every player delegation and the `payee` of every buy-in.
Its UserOps are signed by a dedicated KMS key (like the platform's interactions key), submitted through
the platform relayer. On faithchain gas is free, so the paymaster is not needed for cost, but the
allowlist-mode `SmartAgentPaymaster` can still sponsor to keep the house account ETH-free.

## 5. Money model

Asset: parameterized `ASSET` address. On faithchain today this is `MockUSDC`
(`0xdaE09066A2cc32f6203605619137dcF01A9B49Ae`, 6 decimals, open mint). Real USDC does not exist on
faithchain; if the chain ever bridges one, only the env var changes.

Units: chips are integers in the table ledger. `chipValue` (default 10 000 = 0.01 USDC) converts
chips to asset base units. Blinds and buy-in limits are configured in chips.

### 5.0 The player's treasury

A treasury is a `treasury`-kind Smart Agent of the player's own, chartered under their person agent at
their Home. It is NOT the person agent itself: that is their identity, and spending from it would
conflate who someone is with what they are willing to stake. An early build made exactly that mistake.

One treasury per person, kept across nights and tables, until they choose to switch. A player with none
is required to create one before sitting at a settled table, and the card room makes that a step in the
flow rather than an errand elsewhere.

Discovery is `GET /connect/related-orgs` at the Home with the player's own id_token, filtered to
`kind === 'person-treasury'`. Creation depends on who is playing: the Home's own bootstrap endpoint
needs a custody-grade session this app can never hold, so a real player is handed to the Home portal's
"Create personal treasury" and returns, while a demo persona is created server-side on the
build/sign/submit rail with `/connect/persona-sign` and then recorded back at the Home.

The card room never holds the treasury's key, exactly as it does not hold the house's.

### 5.1 Buy-in (player → house)

Nothing is credited out of order. A settled seat requires, in this sequence and refused by name at
each step: a treasury chosen from the person's own Home (never their person agent), enough of the
asset in it, and a mandate that covers this buy-in from that treasury. `seatBlock` says it in the
browser and `authorizeBuyIn` says it on the server, in the same words. A settled table never falls
back to play money.

1. Player's Home shows the `poker-buyin` template. Consent screen text comes from
   `describePaymentMandate`. The player signs a delegation to the house delegate with caveats built by
   `buildPaymentMandateCaveats`: `asset = ASSET`, `maxAmount = max buy-in × rebuys`, `validUntil = end
   of night`, `allowedTargets = [ASSET]`, `allowedMethods = [transfer]`, plus a `frequency` constraint
   (max redemptions per window) that bounds rebuys. For a demo persona, whose custodian key the Home
   holds, the card room builds that same delegation and the Home signs its EIP-712 digest. Either way
   the delegator is the TREASURY, the mandate is bound to it, and switching treasury invalidates it.
2. To sit, the player (browser or A2A) sends `table.join {seat, buyInChips}` carrying the delegation.
3. The table Durable Object validates the delegation off-chain (`evaluateCaveats`,
   `verifyLiveDelegation`), then enqueues a settlement op. The house redeems the delegation: one ERC-20
   `transfer` of `buyInChips × chipValue` from the player's Smart Agent to the house treasury.
4. On inclusion, the ledger credits the seat and a receipt is written to `PaymentReceiptRegistry`
   with `orderHash = hash(tableId, seatSession, buyInIndex)`.

### 5.2 During play

Chips move only inside the Durable Object ledger. Every hand appends an immutable settlement row
(pots, winners, rake if any). Nothing touches the chain per hand.

### 5.3 Cash-out (house → player)

1. Player sends `table.leave` (or is timed out / the table closes).
2. The table enqueues a settlement op: house `transfer` of `stackChips × chipValue` to the player's
   Smart Agent, receipted with the same `orderHash` family. The house signs under its own authority
   (it is paying its own funds), bound to a settlement digest via `DigestBindingEnforcer` so the
   payout can be audited against the hand history.
3. Player's seat session closes; the delegation may be revoked by the player at any time; unused
   buy-in allowance simply expires.

### 5.4 Trust and hardening

The MVP house is a custodian of the table bankroll, bounded by: player caveats (max, time, method,
frequency), per-hand hashed history, on-chain receipts, and the house's own budget Durable Object
(`SmartAgentBudgetDO`) as a hard ceiling on outflow. Phase 4 replaces custody with a `TableEscrow`
contract: buy-ins deposit into the escrow keyed by `tableId`, and the house can only settle by
submitting a signed net-result vector whose digest matches the published hand history. Note that the
platform's `PaymentEscrow` has a single fixed payee per hold, so it cannot express split settlement;
that is why a poker-specific escrow is a later phase and not the MVP.

## 6. Agents as players

Every AI player is a service agent with an agent card at `/.well-known/agent-card.json` on faithnet.ai
and a JSON-RPC endpoint at `/api/a2a`. It registers one skill:

`poker.act` — input: `{ tableId, handId, seat, view, legalActions, deadlineMs }` where `view` is the
same redacted table view a human sees (own hole cards, board, stacks, pot, action history).
Output artifact: `{ action: fold|check|call|bet|raise|allin, amount? }`.

**Which A2A profile.** The platform's A2A package ships two surfaces. The delegation profile queues a task
and runs the skill on a later alarm, and it requires a signed delegation on every message; its realistic
floor is several seconds. The standard profile answers synchronously and makes authorization optional.
Pokernight uses the standard profile for turns, because a turn clock wants a request and a reply. The
authorization seam is real and named, so phase 3 can require a signed grant once a seat can move money.

Turn loop (inside the table Durable Object):
1. Engine says seat N is to act. If seat N is an agent, the DO resolves its A2A target
   (`resolveA2aTarget`) and sends `message/send` with the `poker.act` input. The house is the caller and
   signs the request.
2. An alarm is set for `deadlineMs`. If the reply arrives first and is legal, it is applied. Otherwise
   the engine applies the default (check if free, else fold) and the seat is marked "sitting out" after
   two consecutive timeouts.
3. Every request/reply pair is logged with its task id for replay.

Authorization: seating an agent requires an A2A grant from the agent's owner allowing the house to
invoke `poker.act` (`buildA2aGrantCaveats` with `skillSelector('poker.act')`). Payment authority comes
separately from the owner's `poker-buyin` delegation, so an agent can be allowed to play without being
allowed to spend.

Reference agents shipped in the monorepo:
- `apps/agent` — an LLM-backed player using the platform's Anthropic planner with a single tool
  that returns the action, plus a rules-based fallback (tight-aggressive baseline).
- `apps/agent/src/adapters/idagents.ts` — optional adapter that forwards `poker.act` to an idagents
  team member via the manager's synchronous ask on port 4100 and parses the reply. This is the bridge
  for your existing CLI agents.

Humans connect over WebSocket from the web client. From the engine's point of view a human seat and an
agent seat are identical; only the transport of the `act` request differs.

## 7. Table service (realtime)

The platform has no WebSocket app yet; this is the new part. Pattern on `PrincipalGatewayDO` (SQLite
plus alarm-driven outbox) and add hibernatable WebSockets.

`PokerTableDO` (one instance per table)
- SQLite tables: `table` (config, engine snapshot), `seats` (agent address, session, stack, status),
  `hands`, `actions` (append-only log), `ledger` (buy-in, cash-out, hand result rows), `outbox`
  (settlement ops with attempts and backoff), `spectators`.
- WebSockets: humans and spectators attach with a session token minted after Home login; the DO uses
  the hibernation API so idle tables cost nothing.
- Alarms: turn timer, blind schedule, hand-start delay, outbox retry.
- Engine: `@pokernight/engine` runs inside the DO; state is serialized after each action.

`LobbyDO` (one per circle): lists tables, membership check, creates tables.

Fairness: each hand uses a server-generated 32-byte seed. `sha256(seed)` is broadcast at hand start;
the seed is revealed at hand end; the deck is derived deterministically from the seed. Anyone can
verify after the fact that the shuffle was fixed before any action.

Privacy: hole cards go only to the owning connection or agent. Hand histories for a player are stored
in that player's vault using the estate's envelope-encryption convention (one KEK per owner address),
not in a shared database.

### Performance targets

Poker is turn-based, so the budget is set by the players, not the engine. Measured on Node 24 with an
off-the-shelf evaluator, a three-way showdown costs about 36 µs; a live table produces roughly one
action every few seconds. Targets, enforced by the engine benchmark in CI:

| Stage | Target |
|---|---|
| Engine: apply one action | < 1 ms |
| Engine: 7-card showdown (3 evaluations + winners) | < 100 µs |
| Simulation mode (engine in-process, rule-based agents, one core) | > 10 000 hands/s |
| Action applied and broadcast, edge to edge, p95 | < 150 ms |
| Rule-based agent reply | < 100 ms |
| LLM-backed agent reply | 30 s clock + per-session time bank, configurable per table |
| Settlement (buy-in, cash-out) | seconds, asynchronous via the outbox, never on the action path |

For comparison, PokerTH's own defaults are a 20 s action timeout and a 6 s pause between hands; its C++
engine is fast but the game is paced at human speed by design, and its server cannot run in-process
simulations at all.

## 8. Monorepo layout

```
pokernight/
  packages/
    engine/      @pokernight/engine    pure NLHE state machine, side pots, evaluator, seeded shuffle; no I/O
    protocol/    @pokernight/protocol  zod schemas for table events, act requests, A2A skill I/O
    ledger/      @pokernight/ledger    chip ledger + SettlementAdapter { playMoney, mandateTransfer, tableEscrow }
    agent-kit/   @pokernight/agent-kit helpers for writing a poker agent (view parsing, legal-action helpers)
  apps/
    tables/      pokernight-tables-*   Worker + PokerTableDO + LobbyDO, A2A caller, settlement outbox
    web/         pokernight-web-*      Worker + Vite/React SPA (from create-primitives-app), Home OIDC login
    house/       pokernight-house-*    house service agent: agent card, receipts, budget DO, admin skills
    agent/       reference A2A poker agent (+ idagents adapter)
  contracts/     TableEscrow.sol (phase 4), Foundry
  docs/          this file, ADRs
```

Package manager pnpm; Turborepo for task graph; vitest; Foundry for contracts. Follows the substrate
rule that `packages/*` never hardcode domains or vendors; all faithnet specifics live in `apps/*` config.

## 9. Configuration (faithnet env)

`apps/tables/wrangler.toml`, `[env.faithnet]` vars (non-secret):
`CHAIN_ID=34348`, `RPC_URL=https://rpc.faithnet.io`, `HOME_ORIGIN=https://www.faithnet.me`,
`HOME_ZONE=faithnet.me`, `AGENT_CARD_ZONE=faithnet.ai`, `ENTRY_POINT`, `AGENT_ACCOUNT_FACTORY`,
`DELEGATION_MANAGER`, `PAYMENT_ENFORCER`, `DIGEST_BINDING_ENFORCER`, `PAYMENT_RECEIPT_REGISTRY`,
`ASSET` (= `MOCK_USDC`), `HOUSE_SA`, `HOUSE_DELEGATE`, `CHIP_VALUE=10000`, `ALLOWED_ORIGINS`.
Secrets via `wrangler secret put`: `SESSION_SECRET`, `RPC_TOKEN`, `AKCS_TOKEN` (or the GCP KMS key name).
Bindings: DO `TABLES` (`PokerTableDO`, sqlite), DO `LOBBIES` (`LobbyDO`, sqlite), service binding to the
house Worker. Local dev: `CHAIN_ID=31337`, `RPC_URL=http://127.0.0.1:8545`.

## 10. Phases and prerequisites

Prerequisites on the estate (one-time, operator tasks in `~/agenticprimitives`)
- Register the OIDC client for `poker.faithnet.io` at the Home developer page; note the exact redirect URI.
- Add a curated `poker-buyin` delegation template next to `x402-pay` in the SSO whitelabel config and
  allow it for the pokernight client id. Self-registration cannot request it.
- Mint an RPC gateway token for app `pokernight` with `writeRps > 0` for the tables Worker.
- Register `pokernight.treasury` under the treasury subregistry and deploy its Smart Agent; provision a
  dedicated KMS key for it.
- (Phase 4) deploy `TableEscrow` to faithchain with `DEPLOY_NETWORK=faithchain`.

Phase 1 — engine and play money (no chain)
- `@pokernight/engine` with property tests (side pots, all-in, split pots, dead blinds), seeded shuffle,
  commit-reveal.
- `PokerTableDO` with WebSockets, alarms, action log, play-money ledger. Web client with Home login.
- Exit: two browsers play a full session on local dev; hand history replays byte-identical.

Phase 2 — agents over A2A
- `poker.act` skill schema in `@pokernight/protocol`; DO turn loop calls A2A with deadline.
- Reference LLM agent and rules-based agent; idagents adapter.
- Exit: a table of six with two humans and four agents runs unattended for an hour on local dev.

Phase 3 — USDC settlement with mandates (faithchain, MockUSDC)
- `mandateTransfer` settlement adapter, outbox with retries, receipts in `PaymentReceiptRegistry`.
- Consent flow with `poker-buyin` template; budget DO ceiling for the house.
- Exit: buy-in, play, cash-out reconcile on-chain; balances match ledger to the base unit.

Phase 4 — trust-minimized escrow
- `TableEscrow.sol`, `tableEscrow` adapter, digest-bound settlement; house loses custody.

## 11. Risks and open questions

- Real-money gambling is regulated in most jurisdictions. MockUSDC on a private chain is fine; do not
  switch `ASSET` to a real stablecoin without a legal answer. The adapter design keeps this a config
  change so the engineering does not have to wait.
- Agent collusion: two agents owned by the same principal at one table is detectable on-chain
  (owner relationship records). Enforce one seat per owner per table in the lobby.
- WebSockets in Durable Objects are net-new for the estate; budget time for hibernation edge cases
  and reconnect/rejoin.
- Escrow: `PaymentEscrow` is not deployed on faithchain and cannot express split settlement; the MVP
  uses direct mandate transfers with the house as bounded custodian.
- Key custody: the faithnet env currently points the A2A KMS backend at the AKCS pilot while the estate
  notes say the live backend is GCP Cloud KMS. The house key id must be provisioned in whichever is
  actually live before Phase 3.
- Agent endpoints are a fetch primitive: seating an agent with an explicit `endpoint` makes the table
  fetch that URL every turn. Gated on `ALLOW_AGENT_ENDPOINT`, default off, enabled only in local dev;
  elsewhere the agent name must resolve inside `AGENT_CARD_ZONE`, so the reachable set is exactly the
  published agents. Deliberately independent of `DEV_AUTH`.
- Turn latency: LLM-backed agents may need 5–20 s per decision. Default turn clock 30 s, per-table
  configurable, with a per-session time bank.
