# Pokernight

Texas Hold'em table service on the faithnet estate. People and AI Smart Agents sit at the same
tables; buy-ins settle in USDC from agent treasuries on faithchain. Built on the Agentic Primitives
substrate (`~/agenticprimitives`). Design: `docs/DESIGN.md` (read it before changing architecture).

## Layout
- `packages/engine`   pure NLHE engine. No I/O, no timers, no randomness except the seed passed in. JSON-only state.
- `packages/protocol` zod wire schemas (WebSocket, HTTP, `poker.act` A2A skill). Typed against engine.
- `packages/ledger`   chip ledger + `SettlementAdapter` (play-money now; on-chain adapters live in apps).
- `packages/agent-kit` helpers and a rules-based baseline strategy for agents.
- `packages/treasury` house money layer: read/move 6-decimal USDC from Smart Agents the house custodies.
  Config injected (rpc, chain id, deployments, signer); no hostnames, no addresses, no keys.
- `apps/tables`       Cloudflare Worker: `PokerTableDO` (WebSockets, SQLite, alarms) + `LobbyDO`. hono routes.
- `apps/web`          Vite + React client.
- `apps/agent`        reference WebSocket bot (`pnpm --filter pokernight-agent bot`).
- `apps/agent-worker` Cloudflare Worker hosting the A2A agent personas (`poker.act`, standard profile).

## Rules
- Money in the engine is chips (integers). Chip → asset conversion is the ledger's job only.
- `packages/*` never hardcode domains, chain ids, addresses, or vendor SDKs. Those live in `apps/*` config
  (`wrangler.toml` `[env.faithnet]`, `.dev.vars`). Same rule as agenticprimitives.
- Engine functions are pure: return new state, never mutate input. Errors are `EngineError` with a stable code.
- Every hand must replay byte-identically from (seed, action log). Tests assert this.
- Hole cards and the deck never leave the DO except through `viewFor` / `redactEvent`.
- Wrangler: one `wrangler.toml` per app, `[env.faithnet]` per deployment universe, bindings repeated per env,
  migration tags never renamed. Worker names `pokernight-<app>-<env>`.
- Tests: vitest. Engine has property tests; run `pnpm test` at the root before claiming anything works.
- Do not add dependencies without a reason; prefer what is already in the workspace.

## Commands
- `pnpm install` · `pnpm test` · `pnpm typecheck`
- `pnpm dev:tables` (wrangler dev on :8787) · `pnpm dev:web` (vite on :5173) · `pnpm dev:agents` (wrangler dev on :8788)
- `pnpm --filter pokernight-agent bot -- --table <id> --seat 3` (rules-based bot)
- `pnpm provision:house` (idempotent; deploys the house Smart Agents on faithchain, funds the treasury,
  writes `house.faithchain.json`. Add `--demo-transfer=<usdc>` to also move real USDC treasury → service.
  The custodian key goes to `.house-key.json` — gitignored, mode 0600, never printed.)

## Agentic Primitives linkage
`apps/tables`, `apps/agent` and `apps/agent-worker` depend on `@agenticprimitives/*` via `link:../../../agenticprimitives/packages/<name>`
(the local checkout at `~/agenticprimitives`, NOT the npm alpha). Those packages resolve from their `dist/`
folders, so after pulling platform changes run `pnpm -r build` (or the package's build) in `~/agenticprimitives`.
`viem` is a peer of all of them and is declared in each consuming app. Deployment addresses come from
`@agenticprimitives/contracts/deployments/faithchain`; never copy addresses into packages/*.
