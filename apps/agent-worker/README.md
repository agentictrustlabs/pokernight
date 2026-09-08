# pokernight-agent-worker

Poker personas, hosted as A2A service agents. One Cloudflare Worker serves all of them; each one
publishes an agent card at `/.well-known/agent-card.json` and answers `poker.act` over JSON-RPC at
`/api/a2a`, so a `PokerTableDO` can seat it exactly like a human seat (docs/DESIGN.md §6).

It speaks the **standard** A2A profile — `createStandardA2aServer` from
`@agenticprimitives/a2a/standard`, not the delegation profile. `SendMessage` there is synchronous: the
agent answers with a **message and no task**, so the whole turn comes back in the same HTTP response.
That is what a turn clock needs.

## Personas

| agent name           | display          | strategy | style / persona                                          |
| -------------------- | ---------------- | -------- | -------------------------------------------------------- |
| `sharkbot.svc`       | Sharkbot         | `rules`  | tight-aggressive — the agent-kit baseline, unmodified     |
| `callingstation.svc` | Calling Station  | `rules`  | loose-passive — the same `decide`, thresholds biased      |
| `deepthought.svc`    | Deep Thought     | `claude` | thoughtful: ranges, pot odds, board texture               |
| `bluffer.svc`        | The Bluffer      | `claude` | aggressive: attacks weakness, barrels scare cards         |

`GET /agents` returns this list at runtime, with each persona's live card and RPC URL.

The two `claude` personas call the Messages API. **Without `ANTHROPIC_API_KEY` they log once and play
the rules baseline**, so the Worker and its whole test suite run with no key at all.

## Running locally

```sh
pnpm dev:agents                 # or: pnpm --filter pokernight-agent-worker dev
```

`wrangler dev` on **:8788**. For the `claude` personas, `cp .dev.vars.example .dev.vars` and put a real
key in it (`.dev.vars` is gitignored; never put a key in `wrangler.toml`).

```sh
pnpm --filter pokernight-agent-worker test        # vitest, @cloudflare/vitest-pool-workers
pnpm --filter pokernight-agent-worker typecheck
```

## Persona URL forms

Production routes every persona to its own host; local dev cannot, so a persona can also be named in
the query string or the path. Resolution order is **query → path → host → default**:

| how          | agent card                                                   | JSON-RPC                                        |
| ------------ | ------------------------------------------------------------ | ----------------------------------------------- |
| query param  | `http://localhost:8788/.well-known/agent-card.json?agent=sharkbot.svc` | `http://localhost:8788/api/a2a?agent=sharkbot.svc` |
| path prefix  | `http://localhost:8788/sharkbot.svc/.well-known/agent-card.json`       | `http://localhost:8788/sharkbot.svc/api/a2a`       |
| Host header  | `https://sharkbot-svc.faithnet.ai/.well-known/agent-card.json`         | `https://sharkbot-svc.faithnet.ai/api/a2a`         |
| default      | `http://localhost:8788/.well-known/agent-card.json` → `sharkbot.svc`   | `http://localhost:8788/api/a2a` → `sharkbot.svc`   |

`?agent=` and the path prefix both take an agent name (`sharkbot.svc`), a host label (`sharkbot-svc`),
or the short id (`sharkbot`).

The host form is `agentNameToHost` from `@pokernight/protocol`: `sharkbot.svc` in zone `faithnet.ai`
becomes `sharkbot-svc.faithnet.ai`. `[env.faithnet]` claims `*.faithnet.ai/*`, so every persona host
lands on this one Worker with no per-persona DNS record and no per-persona deploy.

**The one URL to reach a persona in local dev:**

```
http://localhost:8788/sharkbot.svc/api/a2a
```

## Seating one at a table

The tables Worker takes an agent name and resolves it through its own `AGENT_CARD_ZONE`, or an explicit
`endpoint` that overrides name resolution (`SeatAgentRequest` in `@pokernight/protocol`). In local dev
the zone is `localhost` and `sharkbot-svc.localhost` does not point at :8788, so pass the endpoint:

```sh
# tables on :8787, agents on :8788
curl -X POST http://127.0.0.1:8787/tables/<tableId>/agents \
  -H 'content-type: application/json' \
  -d '{
        "seat": 3,
        "buyIn": 200,
        "agentName": "sharkbot.svc",
        "endpoint": "http://localhost:8788/?agent=sharkbot.svc"
      }'
```

The table appends `/.well-known/agent-card.json` and `/api/a2a` to that base **keeping the query
string**, which is why the `?agent=` form is the one to use for an endpoint override. Deployed, the
endpoint is omitted entirely and `agentName` resolves to `https://sharkbot-svc.faithnet.ai`.

## The wire

One turn, in full. Request — exactly what `encodePokerActParts` produces:

```jsonc
POST /api/a2a          content-type: application/json
{
  "jsonrpc": "2.0",
  "id": "t1:7:3",                       // tableId:handNo:seat
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "…",
      "role": "user",
      "parts": [
        { "kind": "data",
          "data": { "skill": "poker.act",
                    "input": { "tableId": "t1", "handNo": 7, "seat": 3,
                               "view": { /* redacted TableView for seat 3 */ },
                               "legal": { "fold": true, "check": false, "call": 8,
                                          "bet": null, "raise": { "min": 16, "max": 180 },
                                          "allIn": 180 },
                               "deadlineMs": 5000 } } }
      ]
    }
  }
}
```

Response — a message, no task, in the same HTTP response:

```jsonc
{
  "jsonrpc": "2.0",
  "id": "t1:7:3",
  "result": {
    "message": {
      "messageId": "…",
      "role": "ROLE_AGENT",
      "contextId": "…",
      "parts": [
        { "kind": "data", "data": { "action": { "type": "call" },
                                    "note": "Pair of kings [top-pair] flop: call" } }
      ]
    }
  }
}
```

`kind` is carried on parts because `@pokernight/protocol` discriminates on it
(`encodePokerActParts` / `decodePokerActReply`); A2A 1.0's own `PartV1` is presence-based and ignores
it. Both readers are satisfied by the same part.

A **malformed** request is not a guessed fold — it comes back as a failed task whose status message
says what was missing:

```jsonc
{ "result": { "task": { "status": { "state": "TASK_STATE_FAILED",
    "message": { "parts": [ { "text": "sharkbot.svc: unsupported skill \"chess.move\"; …" } ] } } } } }
```

## Two guarantees

1. **The action is always legal.** Every strategy result is snapped through agent-kit's `legalize` and
   checked with `isLegal`; anything still illegal becomes check-else-fold. A strategy that throws,
   hangs, or invents chips cannot put an illegal action on the wire. 200 randomized fixtures — including
   hostile `legal` records where folding is not allowed, only an all-in is legal, or the raise range is
   inverted — assert this in `test/legality.test.ts`.
2. **The deadline is honoured.** An `AbortController` fires at `input.deadlineMs` minus 1 s of headroom.
   The LLM call takes that signal; a strategy that ignores it loses the race to a default action anyway.

## Layout

```
src/personas.ts          the registry + per-request persona resolution
src/card.ts              AgentCardV1 per persona
src/executor.ts          the poker.act executor: decode, deadline, dispatch, legality, reply
src/strategies/rules.ts  agent-kit `decide` + the loose-passive bias (an options object, not a fork)
src/strategies/claude.ts the Anthropic call: structured outputs, typed errors, rules fallback
src/table-text.ts        the table rendered as poker text for the LLM (not a JSON dump)
src/index.ts             routes: /health, /agents, /.well-known/agent-card.json, /api/a2a
```

## Configuration

`wrangler.toml` `[vars]` (repeated per env — wrangler does not inherit them):

| var                | dev                     | faithnet                     |
| ------------------ | ----------------------- | ---------------------------- |
| `AGENT_CARD_ZONE`  | `localhost`             | `faithnet.ai`                |
| `PUBLIC_ORIGIN`    | `http://localhost:8788` | `https://agents.faithnet.ai` |
| `DEFAULT_STRATEGY` | `rules`                 | `rules`                      |
| `LLM_MODEL`        | `claude-opus-5`         | `claude-opus-5`              |
| `LLM_EFFORT`       | `low`                   | `low`                        |

`ANTHROPIC_API_KEY` is a **secret**, never a var:

```sh
wrangler secret put ANTHROPIC_API_KEY --env faithnet
```

## Phase 3: authorization

`createStandardA2aServer` is configured today with **no `principal`**, so every caller is admitted —
safe only while a seat cannot move money. The seam is commented in `src/index.ts`: wiring
`sessionWirePrincipal` from `@agenticprimitives/a2a/standard` makes an unauthenticated request a 401
before any method runs, and lets the executor check `ctx.principal.agent` against the A2A grant the
owner issued for `poker.act`.

## Deploying

```sh
WRANGLER_ENV=faithnet pnpm --filter pokernight-agent-worker deploy
```

The script refuses without `WRANGLER_ENV`: a bare `wrangler deploy` would publish a second Worker named
`pokernight-agent-worker` instead of updating `pokernight-agent-worker-faithnet`.
