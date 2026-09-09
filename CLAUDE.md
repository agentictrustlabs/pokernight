# Pokernight

Texas Hold'em table service on the faithnet estate. People and AI Smart Agents sit at the same
tables; buy-ins settle from agent treasuries on faithchain in **Sheqel (SHQ)**, the card room's own
currency (`contracts/`). Built on the Agentic Primitives substrate (`~/agenticprimitives`). Design:
`docs/DESIGN.md` (read it before changing architecture).

## Layout
- `contracts`         the card room's OWN contracts, and only those: `AppCurrency` (a parameterised
  ERC-20) and `Sheqel`, its Poker Night deployment. Foundry, no submodules, no dependencies.
  `pnpm test:contracts` · `pnpm deploy:sheqel`. Platform contracts stay in `~/agenticprimitives`.
- `packages/engine`   pure NLHE engine. No I/O, no timers, no randomness except the seed passed in. JSON-only state.
- `packages/protocol` zod wire schemas (WebSocket, HTTP, `poker.act` A2A skill). Typed against engine.
- `packages/ledger`   chip ledger + `SettlementAdapter` (play-money now; on-chain adapters live in apps).
- `packages/agent-kit` helpers and a rules-based baseline strategy for agents.
- `packages/treasury` house money layer: read/move the 6-decimal settlement asset from Smart Agents the
  house custodies. Names no currency: the address and ticker are injected by `apps/*`.
  Config injected (rpc, chain id, deployments, signer); no hostnames, no addresses, no keys.
- `apps/tables`       Cloudflare Worker: `PokerTableDO` (WebSockets, SQLite, alarms) + `LobbyDO`. hono routes.
- `apps/web`          Vite + React client.
- `apps/agent`        reference WebSocket bot (`pnpm --filter pokernight-agent bot`).
- `apps/agent-worker` Cloudflare Worker hosting the A2A agent personas (`poker.act`, standard profile).

## Rules
- Money in the engine is chips (integers). Chip → asset conversion is the ledger's job only.
- **The Sheqel (SHQ) is the ONLY currency.** No USDC, no second asset, no conversion, no legacy
  fallback. A table that cannot be opened in Sheqel is not opened.
- A table is PINNED, at creation, to both its chip rate AND its settlement asset, and neither is ever
  re-read from the environment afterwards. `CHIP_VALUE` / `ASSET` open new tables; `LEGACY_CHIP_VALUE`
  is what tables older than the RATE pin have been settling at, stamped on first load. There is no
  `LEGACY_ASSET` and no asset migration — the asset stamp is kept because it makes "which currency is
  this table?" a question about the table's own data, not because two currencies are supported.
- The mandate-currency check (`SessionDO.mandateAsset` vs the table's asset) stays. It is a safety
  property, not a mixed-currency feature: with one coin it should never fire.
- The faucet and the new-player seed are gated on the ASSET itself simulating an open `mint`
  (`isTestAsset`), never on a name or a flag. A real asset must never be mintable by this code.
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
- `pnpm settle:persona -- --handle elena --chips 200` (the whole money flow against the LIVE Home and
  faithchain: sign in as one of the Home's demo people, discover or create their treasury, fund it,
  have their Home sign a real buy-in mandate, then settle a buy-in and a cash-out on chain.)
- `pnpm deploy:sheqel` (deploys `contracts/src/Sheqel.sol` to faithchain with the house custodian key
  and seeds the house treasury; records the address in `house.faithchain.json`)
- `pnpm provision:house` (idempotent; deploys the house Smart Agents on faithchain, funds the treasury,
  writes `house.faithchain.json`. Add `--demo-transfer=<shq>` to also move Sheqels treasury → service.
  The custodian key goes to `.house-key.json` — gitignored, mode 0600, never printed.)

## Agentic Primitives linkage
`apps/tables`, `apps/agent` and `apps/agent-worker` depend on `@agenticprimitives/*` via `link:../../../agenticprimitives/packages/<name>`
(the local checkout at `~/agenticprimitives`, NOT the npm alpha). Those packages resolve from their `dist/`
folders, so after pulling platform changes run `pnpm -r build` (or the package's build) in `~/agenticprimitives`.
`viem` is a peer of all of them and is declared in each consuming app. Deployment addresses come from
`@agenticprimitives/contracts/deployments/faithchain`; never copy addresses into packages/*.
