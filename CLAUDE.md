# Pokernight

Texas Hold'em table service on the faithnet estate. People and AI Smart Agents sit at the same
tables; buy-ins settle from agent treasuries on faithchain in **Sheqel (SHQ)**, the card room's own
currency (`contracts/`). Built on the Agentic Primitives substrate (`~/agenticprimitives`). Design:
`docs/DESIGN.md` (read it before changing architecture).

## Layout
- `contracts`         the card room's OWN contracts, and only those: `AppCurrency` (a parameterised
  ERC-20) and `Sheqel`, its Poker Night deployment. Foundry, no submodules, no dependencies.
  `pnpm test:contracts` · `pnpm deploy:sheqel`. Platform contracts stay in `~/agenticprimitives`.
- `packages/table-game` the PORT a game implements to be hostable. Types only; never learns a game exists.
- `packages/deal`     the seed, its sha256 commitment, and the seeded shuffle. Belongs to no game.
- `packages/engine`   pure NLHE engine + `pokerGame`, its adapter. No I/O, no timers, no randomness
  except the seed passed in. JSON-only state.
- `packages/canasta`  pure Classic Canasta engine (four-handed partnership) + `canastaGame`. Same rules
  as above: pure, seeded, replayable. Played for SCORE — `staked: false`, so it settles nothing.
- `packages/protocol` zod wire schemas (WebSocket, HTTP, `poker.act` A2A skill). Typed against engine.
- `packages/ledger`   chip ledger + `SettlementAdapter` (play-money now; on-chain adapters live in apps).
- `packages/agent-kit` helpers and a rules-based baseline poker strategy for agents.
- `packages/canasta-agent` the same for canasta: `chooseCanastaAction(view, legal, seat)`, pure, and
  verified against the engine's own helpers before it returns. Property-tested over 200 seeded rounds.
- `packages/treasury` house money layer: read/move the 6-decimal settlement asset from Smart Agents the
  house custodies. Names no currency: the address and ticker are injected by `apps/*`.
  Config injected (rpc, chain id, deployments, signer); no hostnames, no addresses, no keys.
- `apps/tables`       Cloudflare Worker: `PokerTableDO` (WebSockets, SQLite, alarms), `LobbyDO`,
  `SessionDO`, `ClubDO` + `ClubIndexDO`. hono routes.
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
- **A TABLE HOSTS A GAME; it does not know which.** `PokerTableDO` holds state as `unknown` and asks
  `game.snapshot(state)` for anything it needs to know. Adding a game is a package with its own engine
  and adapter plus one line in `apps/tables/src/games.ts` — never editing another game's rules. A
  table STAMPS its game at creation and never re-reads it; no stamp means poker.
- **ONE BOARD PER GAME in the web client, and each knows only its own.** `apps/web` draws poker
  (`components/Table.tsx`) and canasta (`components/CanastaTable.tsx`); `pages/TableRoute.tsx` reads
  the table's stamped game and mounts the right one BEFORE either opens a socket. `lib/games.ts`
  states the rule once — `hasBoard` is "is there a screen for this?", `drawsGame` is "will the POKER
  board understand this?". The transport (`TableSocket<M>`) is shared and generic in its message
  type; the reducer, the components and the page are not. Never branch on the game inside a board.
- **THE NAVIGATION IS A RAIL OF VERBS, AND A CLUB IS A DESTINATION — NOT A CONTEXT THE APP ENTERS.**
  `Play` (`#/`), `Tables` (`#/tables`), `Your money` (`#/money`), then the clubs you are in, by name
  (`#/clubs/<id>`). There is deliberately NO person/club switcher: a switcher is a container's
  instrument, and switching club here changes a roster and a calendar while the tables, the money and
  the identity stay yours wherever you are. `apps/web/src/lib/nav.ts` decides every row, purely, and
  carries the reasoning; `docs/NAVIGATION-DECIDED.md` records the decision and what was rejected.
  `#/` is PLAY, not the table list — the list is first for whoever comes back, which is why leaving a
  table lands on `#/tables` and not on the front door. There is no club directory and no `#/clubs`
  page: a club you are not in is indistinguishable from one that does not exist, so an invitation
  carries the club instead. A club's page leads with ITS TABLES, then the roster. No rail at a table.
  `pnpm walk:nav` drives all of it against the live deployment as a real signed-in person.
- **A PRACTICE TABLE IS ONE PER PERSON, DERIVED NOT STORED, AND IN NO LOBBY.** `POST /practice`
  returns `sha256(playerId + game)` as a UUID and inits that table, so asking twice is asking about
  the same one and nothing has to remember it exists. It is created directly rather than by a
  `LobbyDO`, which is what keeps it out of every listing; it always settles play money; and its
  owner may `POST /tables/:id/reset` to deal again, which KEEPS THE SEATS and throws the scores
  away. A reset at any other table is refused by the object, whoever asks.
- **AGENT MOVES ARE PACED, and the pause is spent AFTER the agent has answered.** An agent replies in
  a couple of hundred milliseconds, so three of them take a whole lap between two frames and a
  person sees results without ever seeing the moves. `AGENT_PACE_MS` (default 2800) delays the
  answer's application, never the request, so it costs the turn clock nothing. A practice table
  carries its own `paceMs`; an ordinary one cannot, because one person's preference must not slow
  everybody else down. **A CLIENT NEVER SENDS A PACE IT HAS NOT BEEN TOLD.** `CanastaPage` opens on a
  guess and posts the pace on a debounce, so before `paceKnown` it stamped that guess over the table's
  real value on arrival — you set the pace, left, came back, and it had reset itself.
- **MELDING DOES NOT END A CANASTA TURN.** Round and phase are both unchanged after one, so anything
  that re-triggers on those alone will fire once and then sit there until the clock runs out. The
  coach keys its heartbeat on "there is no advice" instead, because playing a move is what clears it.
- **NO HOOK AFTER AN EARLY RETURN.** React counts hooks and matches the count between renders, so a
  `useState` after `if (!view) return …` is error #310 — a white screen, not a warning. It happened
  twice in one afternoon on the canasta board and no render test caught it, because
  `renderToStaticMarkup` renders once and never compares. `apps/web/src/hooks.test.ts` reads the
  files instead and fails on any hook below the first top-level `return` in a component.
- **DRAGGING IS POINTER EVENTS, never HTML5 drag-and-drop.** HTML5 dragging does not exist on a
  touchscreen and cannot be driven by an ordinary mouse press even where it does, so a card game
  built on it works for some people and silently does nothing for others. Drop targets are marked
  `data-drop="…"` and resolved with `elementFromPoint` on release.
- **A PAUSE HOLDS FOR EVERYBODY, including whoever pressed it.** Holding only the clock and the
  agents left human moves going through, so anything still playing that seat kept the whole table
  moving and a pause took a minute to look like one. `act` is refused with code `paused`, the coach
  stops asking, and the client hushes the voice mid-sentence. Resuming gives back the time the pause
  took — except the NEXT-DEAL timer, which is capped at the ordinary start delay rather than shifted,
  or a table paused overnight sits there the next morning waiting out an elapsed delay.
- **A ROUND ENDS BEHIND A CURTAIN, AND THE FREEZE IS THE TABLE'S OWN PAUSE.** Twenty minutes of
  canasta used to end in a tenth of a second: last card, numbers jump, board clears, next deal out.
  `RoundCurtain` stops it with the arithmetic and the board still underneath. Winning celebrates;
  LOSING GETS CREDIT for the largest true thing that side earned, which is not consolation — "bad
  luck" teaches nothing and "two canastas, 800 of your 1,100" is a reason to play the next round. A
  spectator gets neither, because telling somebody who was not playing that they won invents a stake.
  The freeze reuses the PAUSE rather than inventing a hold, so the clock, the agents and the next deal
  stop together — and only at your own practice table, because one person studying the board must not
  stop three others. It is spent ONCE PER ROUND, marked the first time the curtain is seen including
  when the table was already held: the result stays on the view until the next round starts, so an
  effect that re-checked it re-froze the table a frame after "deal the next round" let it go.
- **SPEECH IS RATE-LIMITED AND THE TABLE IS NOT.** A lap is a dozen events, each line takes two or
  three seconds to say, and the lap takes about ten — so narrating per EVENT means the queue drops
  the oldest and a player hears only whatever arrived last. Narrate per TURN: one sentence, flushed
  when a seat discards. The screen still gets every event; reading is not rate-limited.
- **A COACH SEES ONLY WHAT THE SEAT SEES.** `TableGame.advise?(state, seat)` is optional and reasons
  from `viewFor(state, seat)` — never from the state it is handed. Advice built on cards the learner
  cannot see teaches a way of playing they can never reproduce alone. `GET /tables/:id/advice` is
  gated on a session, the club, and the seat being the caller's OWN; a game with no coach answers
  404 rather than inventing one. BOTH games have one, and both are composed in
  `apps/tables/src/games.ts`, because each strategy depends on its engine and an engine must not
  depend back on a strategy written for it. Hold'em's takes its MOVE from `agent-kit`'s `decide` and
  its WORDS from `readHand` — a coach that explained itself by restating its own choice would teach
  the choice, and what a learner needs is the reading. It runs with `rng: () => 1`, which takes every
  mixed line off the table: advice that changes when you ask again is not advice, and the
  straightforward value line is the one a beginner can reproduce.
  **ONE SET OF WORDS PER GAME, like the boards.** `components/Coach.tsx` + `lib/canastaWords.ts` +
  `lib/alerts.ts` are canasta's; `components/PokerCoach.tsx` + `lib/pokerWords.ts` are hold'em's.
  Canasta's barrier is the RULES, so its coach says which moves exist; hold'em's is the PRICE, so
  its coach keeps saying what a call costs against what it can win. `Adviser` is the one shared
  piece, because naming your own agent is a fact about you rather than about a game.
- **AN AGENT SEAT IS ASKED IN ITS OWN GAME'S SKILL.** `poker.act` and `canasta.act` are different
  skill ids, the table asks for its game's by name, and it refuses to seat an agent whose card does
  not advertise it. The A2A turn request (`ActInput`) carries `view`, `legal` and `action` opaquely,
  exactly as the socket does; the host validates a reply with `game.parseAction` + `game.apply` and
  reports the GAME's own refusal, never its own idea of legality.
- **The wire's ENVELOPE is the host's; the PAYLOAD is the game's.** View, legal actions, actions and
  game events cross as `unknown`; a client narrows once at its own socket boundary against the
  protocol's per-game binding (`PokerServerMessage`). `TableSummary.config` is the generic setup;
  `gameConfig` is the game's own. Guide: `docs/GAMES.md`.
- The PRODUCT NAME is copy and lives in `apps/web/src/lib/brand.ts`. Everything that says
  `pokernight` elsewhere — Workers, domains, packages, the OIDC client id, the session key, the house
  agents' salts — is an identifier other systems have bound to, and stays. Renaming the product must
  never become a migration.
- Every hand must replay byte-identically from (seed, action log). Tests assert this.
- Hole cards and the deck never leave the DO except through `viewFor` / `redactEvent`.
- **A CLUB is a group of people, and standing in it is DERIVED, never asserted.** `ClubDO` holds the
  roster and answers `host` / `member` / `none`; the Worker verifies the caller, asks, and decides.
  The Durable Object never sees a session. A club nobody has standing in answers **404, never 403** —
  a refusal would confirm the club exists, which is a fact about other people's arrangements.
  A table with no `club` is a PICKUP table: public, and what every table was before clubs.
  A club is CHARTERED ONCE as a `<label>.workspace` Smart Agent at the host's own Home
  (`workspace-create`); the card room records the address and never holds the key. Re-chartering to a
  different agent is refused. Design: `docs/WORKSPACES.md`.
- **A CLUB IS RETIRED BY ITS HOST, AND ITS AGENT IS NOT OURS TO RETIRE.** `DELETE /clubs/:clubId` is
  the only way one ends. There is exactly one host — `created_by` — so a member gets 403 by name and a
  stranger gets 404, the same answer a club that does not exist gives. It LOOKS FIRST and refuses the
  whole thing (409, naming them) if anybody is seated at one of the club's tables, because a seat holds
  chips and at a settled table those chips are money; nothing is destroyed by a refusal. Then it closes
  the club's tables — a club table left behind is private to a club that no longer exists, reachable by
  direct link and by nothing else — and last it drops the club from every member's index, so nobody's
  rail keeps a row that 404s. It NEVER touches the club's Smart Agent, and the answer returns the
  address so the client can say so: that agent lives at the host's own Home and this card room has
  never held its key.
- **A MISSION IS A GUEST AT THE TABLE, and the club still holds no money.** A mission organisation
  hosts one Night as guest dealer. That is a social role: it never carries hidden cards, the deck, a
  rake, a payout approval, or any reach into a player's account, and inviting a mission to host must
  never make it the settlement counterparty. Giving is separate from the game — declining changes
  nothing, losing chips owes nobody anything, and giving buys no advantage and no standing. The
  buy-in mandate is NOT a donation grant. Design: `docs/MISSION.md`, which supersedes three parts of
  `docs/WORKSPACES.md` (weekly recurrence, a Night's single table, the no-mute rule).
- **THE CARD ROOM NAMES ITSELF TO A PERSON'S OWN AGENT, AS THE HOUSE.** A Home agent's standard A2A
  surface answers nobody it cannot name: a person's Home session bearer, or an agent on a session
  wire. The card room holds no person's bearer, so when it asks somebody's own agent for advice it asks
  as the HOUSE SERVICE SMART AGENT (`house.faithchain.json`), signing each request with a session key
  the custodian delegated to it ONCE, offline (`pnpm mint:house-wire` → secrets `HOUSE_A2A_WIRE`,
  `HOUSE_A2A_SESSION_KEY`; `pnpm verify:house-wire` checks it on chain the way a Home will). Never the
  custodian key itself: `treasury.ts` says that key signs userOpHashes and nothing else, and a wire is
  revocable on chain without a redeploy. `house-caller.ts` signs the EXACT bytes sent, the method, the
  host and the moment; the house's own personas get no header, because they ask nobody's name.
  A message goes WHERE THE CARD SAYS (`messageUrlFromCard`): a Home agent answers at the estate's edge
  (`edge…/api/a2a/<name>`) and refuses its own host with `gateway_assertion_required`. Proven live:
  `pnpm ask:as-house alice-me.faithnet.ai "…"` — Alice's agent answered through her playbook. What
  stops her ADVISING is her card: `poker.advise` is not in her on-chain `atl:capabilities`, and that
  is a Home act under her own delegation, not the card room's.
- Wrangler: one `wrangler.toml` per app, `[env.faithnet]` per deployment universe, bindings repeated per env,
  migration tags never renamed. Worker names `pokernight-<app>-<env>`.
- Tests: vitest. Engine has property tests; run `pnpm test` at the root before claiming anything works.
- Do not add dependencies without a reason; prefer what is already in the workspace.

## Commands
- `pnpm install` · `pnpm test` · `pnpm typecheck`
- `pnpm dev:tables` (wrangler dev on :8787) · `pnpm dev:web` (vite on :5173) · `pnpm dev:agents` (wrangler dev on :8788)
- `pnpm --filter pokernight-agent bot -- --table <id> --seat 3` (rules-based bot)
- `pnpm walk:nav` (presses every road through the card room on the live deployment as one of the Home's
  demo people: every rail row, a refresh on two pages, a club created and found in the rail, a club you
  are not in, and leaving a table. `--site` to point it elsewhere, `--headed` to watch.)
- `pnpm walk:coach` (presses "deal me in" for BOTH games on the live deployment and checks the coach
  came with them: on by default at a practice table, narrating, saying whose advice it is.)
- `pnpm walk:round-end` (the end of a canasta round on the live deployment: the curtain, the freeze
  asked of the CARD ROOM rather than of the screen, "look at the board" leaving it held, and the card
  you drew being marked in your hand.)
- `pnpm play:canasta` (plays a WHOLE GAME of canasta against the three house bots through the live
  site, signed in as one of the Home's demo people — the real door, not a dev session. `--site` to
  point it elsewhere, `--headed` to watch. Playwright lives at `~/node_modules` and is required by
  absolute path, which is why the script is `.cjs`.)
- `pnpm mint:house-wire [--days 90] [--rotate]` (the custodian signs, ONCE and offline, the narrow
  delegation the card room uses to name itself to a person's own agent. Writes the session key to
  `.house-a2a-session.json` — gitignored, mode 0600 — and prints the wire; both become Worker secrets.)
- `pnpm verify:house-wire <wire.json>` · `pnpm ask:as-house <host> "<question>"` (the wire checked on
  chain, and one signed question to a Home agent — a language-model run at that person's Home, so once.)
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
