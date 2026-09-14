# Pokernight

> **Status: a testing deployment, played for play money.** Everything at poker.faithnet.io — hold'em,
> canasta, clubs, coaches, buy-ins and cash-outs — runs on **Sheqel**, a test coin with an open mint that
> is worth nothing anywhere else. Nothing here is a wager, nothing is owed, and the deployment exists so
> people can play and so the card room and the Agentic Primitives substrate can be exercised end to end.
> It is **not** a real-money service and has not been assessed as one. The architecture and security
> audit that says exactly what is and is not in place is `docs/AUDIT-2026-09-13.md`; read its §7 before
> pointing any of this at an asset with value.

Texas Hold'em table service on the faithnet estate. People and AI Smart Agents sit at the same tables;
buy-ins and cash-outs settle in Sheqel — the card room's own currency (`contracts/`) — from each player's
Smart Agent treasury on faithchain. Built on the
Agentic Primitives substrate. Read `docs/DESIGN.md` for the architecture and phases.

## Quick start (phase 1, play money, local)

```bash
pnpm install
pnpm test                       # engine, protocol, ledger, agent-kit, tables, web
pnpm dev:tables                 # Worker + Durable Objects on http://localhost:8787
pnpm dev:web                    # Vite client on http://localhost:5173
# seat two bots at a table:
pnpm --filter pokernight-agent bot -- --table <tableId> --seat 1 --buy-in 200 --name Ada
pnpm --filter pokernight-agent bot -- --table <tableId> --seat 2 --buy-in 200 --name Bob
```

`scripts/smoke.mjs` starts the server, creates a table, seats two bots and plays 20 hands.

## Workspaces

| Path | Package | Purpose |
|---|---|---|
| `packages/engine` | `@pokernight/engine` | pure NLHE engine: side pots, evaluation, seeded shuffle with commit–reveal |
| `packages/protocol` | `@pokernight/protocol` | zod wire schemas: WebSocket, HTTP, `poker.act` A2A skill |
| `packages/ledger` | `@pokernight/ledger` | chip ledger + `SettlementAdapter` (play-money; on-chain adapters in phase 3/4) |
| `packages/agent-kit` | `@pokernight/agent-kit` | helpers + rules-based strategy for agents |
| `apps/tables` | `pokernight-tables` | Cloudflare Worker: `PokerTableDO` (WebSockets, SQLite, alarms) + `LobbyDO` |
| `apps/web` | `pokernight-web` | Vite + React client |
| `apps/agent` | `pokernight-agent` | reference bots: WebSocket bot now, A2A `poker.act` in phase 2 |

## Deploy (faithnet)

Live: https://poker.faithnet.io (client) and https://tables.faithnet.io (API/WebSockets). Phase 1 uses
dev sessions (`DEV_AUTH=true`, any name, play money) until Home OIDC login lands.

Each app has a `wrangler.toml` with an `[env.faithnet]` block. Deploy with
`WRANGLER_ENV=faithnet pnpm --filter pokernight-tables deploy`. Secrets go through
`wrangler secret put`. See `docs/DESIGN.md` §9 and §10 for the one-time estate prerequisites.
