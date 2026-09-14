# Pokernight

Texas Hold'em table service on the faithnet estate. People and AI Smart Agents sit at the same
tables; buy-ins settle from agent treasuries on faithchain in **Sheqel (SHQ)**, the card room's own
currency (`contracts/`). Built on the Agentic Primitives substrate — the published `@agenticprimitives/*`
packages on npm, and the estate's Home the card room signs people in through. Design:
`docs/DESIGN.md` (read it before changing architecture). The adviser's whole journey — skill file →
corpus → registry → compiled playbook → vault → a hand's advice on the screen → the memory after —
with diagrams a non-engineer can follow: `docs/ARCHITECTURE-ADVISER.md`.

## Layout
- `contracts`         the card room's OWN contracts, and only those: `AppCurrency` (a parameterised
  ERC-20) and `Sheqel`, its Poker Night deployment. Foundry, no submodules, no dependencies.
  `pnpm test:contracts` · `pnpm deploy:sheqel`. Platform contracts come from `@agenticprimitives/contracts`.
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
  `SessionDO`; clubs are their agents at the Home (`clubs.ts`, KV `CLUB_WIRES`). hono routes.
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
- **A TURN IS NINETY SECONDS in both games (2026-09-13; hold'em's was 30 s).** A person reading a coach's word,
  or waiting the 15–20 s their own agent takes to write it, was sat out by a clock meant for somebody else.
  `packages/engine` `DEFAULT_CONFIG.actionTimeoutMs`, `packages/canasta` `DEFAULT_CONFIG.turnMs`; a table is
  pinned to its clock at creation.
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
- **A TABLE DEALS WHILE SOMEBODY IS AT IT — an open socket is a tab, not a person.** Agent seats have
  no socket, so a practice table whose owner closed the tab kept three house bots playing each other
  all night — an alarm every few seconds, a hand a minute, and a record of every hand to whatever agent
  the owner had named, at their Home. Then a tab left OPEN did the same. The alarm's next-deal branch
  starts a hand only when `anybodyAttending()`: an open socket AND (a human seat that is not sitting
  out, OR a socket opened / a command sent within `ATTENTION_MS`, ten minutes — pings do not count).
  `scheduleAlarm` leaves `next-hand-at` out of its candidates otherwise, so the DO goes quiet instead
  of re-arming; the next socket to open (`wakeForWatcher`) or the next command after idleness re-times
  a stale next deal to now + the ordinary delay and sets the alarm again. A hand in progress still
  finishes (turns time out; two in a row sit the person out, after which no human seat is active and
  the bots stop within the window). A record goes only to an adviser whose person was DEALT the round.
  **A COACH PLAYING FOR SOMEBODY IS NOT SOMEBODY** (2026-09-13). In play-for-me mode the client acts every
  turn, so the seat stayed active, the table kept dealing, and every turn consulted a language-model coach
  for a tab left open on a second monitor. An `act` the coach sends carries `auto: true`; the table does not
  count it as attention, and `anybodyAttending()` is now a person's own input within `ATTENTION_MS` (a seated
  human sends something every turn or the clock sits them out) — `test/attention.test.ts`. Both coach
  panels also switch OFF after ten minutes without a pointer, key, wheel or touch (`useUserIdle`), saying why.
  **THE COACH IS QUIET UNLESS ASKED (2026-09-13).** Modes: "Don't ask", "Ask on demand" (a word only when
  you press Ask), "Ask every turn", "Play for me". Every table opens in "Don't ask" except your own practice
  table, which exists to be talked through and opens in "Ask every turn".
  **NOBODY LOOKING, NOBODY ASKED — and sat out means off.** The coach panels (`PokerCoach`, `Coach`)
  do not ask an adviser while `document.visibilityState` is hidden, and switch themselves OFF when
  the person's seat is sat out for timeouts, saying why; the person presses "Tell me" to turn it back
  on. A named adviser costs its coach's tokens per question, and every one of these was a question
  asked of an empty chair.
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
  **ON A PHONE, HOLD'EM IS PLAYED WITHOUT SCROLLING** (2026-09-13; `@media (max-width: 899px)`): the ACTION
  BAR is the bottom sheet (`useActionSheet` → `--action-sheet`), the coach is one strip above it (mode chip +
  whose voice; the four modes appear when the chip is tapped), and the coach's sentence, its "Why?" and the
  mark on the button it means live IN the action bar (`CoachStatus.because/action` → `.advised`). Your own
  seat is drawn ABOVE the felt (`.seats { display: contents }` and flex order), the status bar is one line,
  and the page pads its bottom by both sheets. A spectator (no seat) still gets the coach card as a sheet
  (`useCoachSheet` → `--coach-sheet`); the canasta felt puts the three other seats in one row of small plates. Walk it
  with the scratch `mobile-walk.cjs` (iPhone 13 viewport, plays a few turns, screenshots each). A COACH'S
  MOVE IS CHECKED BEFORE A BUTTON IS DRAWN: `askAdviser` parses and applies the adviser's `action` against
  the current state and drops it (words kept, a clause added) when the game would refuse it — a
  language-model coach named a two-card canasta meld and the person got `illegal-action` for pressing it.
  **THE CANASTA SIDE IS THE SAME SHAPE** (`components/CanastaSide.tsx`), plus a SEAT BAR above the coach
  card that is always on screen: which seat, whose side, sit back in, and LEAVE — the leave button used to
  be three panels down. The hold'em page has the same bar (seat, stack, sit out / back in, leave).
  **A NEW PERSON ARRIVES READY TO PLAY**: the Home's connect-time defaults make them a money account when
  they have none (`CLIENT_DEFAULTS.pokernight.treasury`), and `App.tsx` runs `quick-start` once on
  arrival (find + seed the play coin, no signature) — what is left is the buy-in mandate, theirs to sign. The canasta coach card hands up `CanastaArrangement`; `VoiceSettings` is exported
  from `Coach.tsx` and lives on the Table tab.
  **THE HOLD'EM SIDE IS TWO THINGS: the coach card and one panel of tabs.** `PokerCoach` is about THE
  HAND — mode, wait, advice, move, whose voice in one line — and hands everything else up
  (`Arrangement`: adviser, coach, feed, earlier advice, the ask callback). `components/TableSide.tsx`
  is the rest, sorted by what a person came for: Talk (commentary, chat, the full log folded), Ask
  (question, earlier advice, the N-day review), People (the voice chain, name your agent, hire a coach,
  who's who), Table (practice hold/restart/pace, money). Seven panels one under the other was "just a
  running list of stuff"; a panel mounted inside a tab is flattened by `.side-section > .panel`.
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
- **A CLUB IS ITS WORKSPACE AGENT AT THE HOME, AND THE CARD ROOM KEEPS NOTHING OF IT BUT THE WIRE**
  (2026-09-13, `docs/WORKSPACES.md` §5.0; `apps/tables/src/clubs.ts`). There is no `ClubDO`, no roster
  table, no club index, no email invitations, no dev login: everyone is a person with a Home, and a club is a
  `<label>.workspace` Smart Agent its host custodies there. Its id IS the agent's address. Who belongs is the
  workspace's own membership (`org.membership:member:<sa>`, spec 325), written by two Home ceremonies — the
  host's `workspace-member-invite` (her agent then MESSAGES the person with the link to `#/join/<club>`) and the
  member's `workspace-join`. What the club calls itself, when it meets and how each night diverges from the
  rule are three records in the workspace's vault — `cardroom.club.profile|schedule|nights`
  (apctx:CardRoomClub, CardRoomClubSchedule, CardRoomClubNights; cr:Club, cr:ClubSchedule, cr:ClubNight in
  the card-room ontology) — written by the club's OWN agent when the card room acts as it. STARTING A CLUB is
  two ceremonies (`workspace-create`, then `service-agent-wire` with `grant_org` = the club: the host signs, as
  custodian, a wire from the club's agent to this card room's session key — `/admin/signer-address` and
  `/admin/service-wire` answer the Home; the wire is checked on chain and kept in KV `CLUB_WIRES`) and one
  first act (`POST /clubs/:id/found` writes the profile). Every club route then asks the club's agent at the
  Home (`POST <a2a>/clubs/act` under an `A2A-Session` assertion over the wire, `club.read` / `club.write`, no
  model, ~2 s): the view is ONE read (profile, schedule, nights record, roster, and the person's standing —
  host/member/none — derived by the Home from ITS records and the chain, never a row here). Nights are DERIVED
  from the rule at read time (`nightsOf`), exceptions laid over; nothing is materialised. Standing at a club
  is asked of the Home per request; the Home remembers a POSITIVE answer a minute, never `none`. Each act
  carries a nonce, because the assertion is spent once and a page reads the club several times a second. The
  one read still on the paired secret is `GET <a2a>/clubs/mine` — which of a person's linked workspaces keep a
  club profile — for the rail. A club nobody has standing in, or that this card room holds no wire for,
  answers **404, never 403**. A table with no `club` is a PICKUP table: public, and what every table was.
  Tables, the lobby per club, and the person's session stay in Durable Objects because they are live.
  `pnpm walk:club` proves the whole road; `pnpm walk:nav` presses the two-ceremony start.
- **A CLUB IS RETIRED BY ITS HOST, AND ITS AGENT IS NOT OURS TO RETIRE.** `DELETE /clubs/:clubId` LOOKS FIRST
  and refuses (409, naming them) if anybody is seated at one of the club's tables; then closes the club's
  tables; then marks the club's profile `retiredAt` at its Home (the rail skips retired clubs) and lets go of
  the wire. It NEVER touches the club's Smart Agent: that lives at the host's Home and this card room has
  never held its key — the answer returns the address so the client can say so.
- **A CLUB HUDDLES — voice, faces and the table, for its members whether or not they are playing**
  (Home spec 378, `club` scope; principal and id are both the club's agent). The Home's huddle service
  decides who may start, join or end from standing IT derives; the card room's `POST /clubs/:id/huddle/:op`
  names the member to the Home under the paired secret (a person who signed in through their Home holds no
  Home bearer here), and passes the join's `authToken` through once. `components/huddle/` —
  `ClubHuddleProvider` (owns the call above every page), `ClubHuddleDock`, `HuddleAffordance` on the club page
  and in a club table's top bar.
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
  `pnpm ask:as-house alice-me.faithnet.ai "…"` — Alice's agent answered through her playbook.
  A PERSON'S AGENT ADVISES THROUGH THE HOME'S `playbook.answer` TOOL (`master` in
  the Home, 2026-09-11): the Home's harness is a tool
  planner, and that is the one tool that answers a question of judgement over material the message
  carried, listed only for a skill the agent's `atl:capabilities` advertises. The advice request
  therefore carries the answer's SHAPE in its data part (`adviseAnswerShape`) — the answering step at
  a Home reads the data, not the text. Putting the four skills on a demo person's card is
  the Home operator's `add-cardroom-skills`, `rebuild-card-release` and `republish-card-record` scripts. A Home run takes ~14 s against the 20 s A2A limit; a miss falls back
  to the house coach and the panel says so.
  **THE PERSON'S AGENT CONSULTS A COACH SERVICE; IT GENERATES NOTHING ITSELF** (2026-09-12,
  the Home's `card-room` module; the story with diagrams is
  `docs/ARCHITECTURE-ADVISER.md`). The table addresses ONE agent per seat — the person's own
  (`alice.me`) — and never learns the coach's endpoint. On `poker.advise` that agent runs no model: it
  reads the specialist its playbook names for the skill (`{capability:'poker.advise', executor:
  'bob-coach.svc'}`, a `.svc` — a coach is a service, never a person), fetches the STUDY GRANT the
  person signed for it (delegator the person, delegate the service, vault-record-scope read on
  `cardroom.hand|style|read|note`, write on `cardroom.note` only), forwards the SAME seat payload with
  the grant beside it, and returns the coach's `{say, because, action}` with `source` = the service.
  No specialist, no grant, revoked, or late ⇒ one-line refusal; the table falls back to the house and
  the panel says why. The screen names both voices ("bob-coach.svc, via alice.me"). The coach reads
  her records at HER vault under the grant and appends at most one note to HER `cardroom.note`; the
  vault refuses `cardroom.hand/style/read/note` on a service principal, so firing the coach (revoking
  the grant) leaves nothing of hers behind. Estate: `charter-coach.mts bob bob-coach`,
  `bind-coach-specialist.mts alice bob-coach.svc`, `seed-cardroom-style.mts`, `add-cardroom-skills.mts
  --service bob-coach.svc --by bob`; the registry archetype is `holdem-coach-bob` (texas-holdem).
- **ONE CABINET PER GAME, ONE COACH PER GAME (2026-09-13).** Canasta has its own coach service —
  `carol-coach.svc`, custodied by carol.me, archetype `canasta-coach-carol` in the registry's `canasta`
  context — hired the same way Bob is, and consulted the same way: the table addresses the person's own
  agent with `canasta.advise`, the agent consults the specialist its playbook names for THAT skill under a
  grant scoped to canasta's records. Hold'em's study records keep the bare names (`cardroom.hand`, …);
  every other game's carry the family — `cardroom.canasta.hand`, `.hands:<day>`, `.style`, `.read`,
  `.note` — so a hold'em grant covers nothing of canasta's and a canasta round never resets the hold'em
  counts. The card room's coach routes take `?game=` (`/coaches`, `/me/coach`, `/me/coach/asked`,
  `/me/review`, `/me/hands/backfill`; `CARD_ROOM_SKILLS` in the protocol names the four skills per game),
  `COACH_SERVICES` lists both coaches, and canasta's `observeFor` counts a finished round from the seat's
  final view (rounds, roundsWon, canastas, naturalCanastas, wentOut, concealed, redThrees, inHandValue,
  opened, netScore — per seat, with its side's outcome). The web asks "want a coach?" once PER GAME
  (canasta's when a canasta table is first opened), auto-appoints the person's own agent at a canasta
  table when it has a canasta coach, and the canasta page carries a coach desk. Proven live: Alice's
  practice canasta table → "carol-coach.svc, via alice.me" with Carol's doctrine in the words.
- **A FINISHED ROUND IS RECORDED TO THE PERSON'S OWN AGENT — A VAULT PUT, NO MODEL, NEVER TO THE
  COACH.** `TableGame.observeFor?(state, seat)` is the other end of `readFor`: the round as the seat
  saw it, IN COUNTS — vpip, pfr, three-bet, fold-to-bet, c-bet, showdowns, won, net — keyed by the
  player id the view shows, never cards, never a transcript (`agent-kit/src/observe.ts`).
  `recordWithAdvisers` sends the final view and the counts in the `poker.record` message
  (`encodeRecordParts`, whose text says the round is OVER and asks for nothing) with the host's names
  on the subjects, only to an adviser whose card advertises `*.record` (a person's own agent; the house
  personas advertise neither record nor review and refuse both by name). The card room keeps none of
  it. At the Home the person's agent puts it into `cardroom.hand` — the hand kept whole, the counts
  folded into running totals — without a model call; the coach reads them back at the next
  consultation with rates ("foldToBet 80% of 5"), and `holdem-memory` teaches what the numbers mean.
  A REVIEW is the person's own question (`poker.review`, `GET /tables/:id/review?q=`, the panel's
  "Review my hands"): forwarded by their agent to the coach with the grant, answered from the hands on
  file, one note written back. A hand ending never triggers one. A new vault record type is four
  registrations (ontology tbox + binding, the two grant-scope lists, the DO allowlist) and a grant
  re-issue per agent (`scripts/reissue-interactions-grants.mts alice`), the same as every one before
  it. **A MIXED SPOT IS CARRIED AS ONE**: the postflop chart keeps the solver's runner-up
  (`Decision.mix`, `Advice.mix`, `baseline.mix` on the wire), the house words say "the solver also
  bets here 32% of the time", and the person's agent is told the memory is what picks a side — proven
  live: top pair checked to as the caller, baseline check 68/32, "The Rock folds to bets" → bet.
- **THE POSTFLOP CHART IS COUNTS AT FOUR LEVELS, SMOOTHED AT LOOKUP.** `postflopKeys` returns the
  spot's feature vector and three coarser cousins (dropping the money behind, the board, the draw); the
  builder tallies every level; `postflopChartDecision` adds each level's counts to the coarser level's
  distribution scaled to `PRIOR_WEIGHT` spots. Features: street, position, what is faced and how big,
  the preflop pot (who raised, three-bet or not) and the line (initiative, barrels), the made hand
  finely (kicker, top two, top set, nut straight/flush, overcards for air), the draw, the texture and
  what the last card did, SPR. Tokens are stored in `short` form, ONE LINE PER KEY IN ONE STRING
  (`postflop-chart.data.ts`, generated, 3.2 MB / 580 KB gzipped; lookup is `indexOf`) — never a JSON
  object: a hundred thousand keys as an object, imported as `.json`, cost a test isolate two hundred
  megabytes of heap and workerd died of it. `pnpm test`'s summary lines are what to read: a grep for
  "failed" alone let that crash pass as green for an hour. PokerBench postflop 54.5% (rules) → 73.1% (one level) → 80.5%. The bench
  replay carries the PREFLOP actions into the view now, because the chart reads who raised — a bench
  view without them scored a feature no live table produces. Some old scenario tests said what the
  folklore says (shove top pair under one SPR); they now say what the solver says (call a small bet). A cold ask is ~12–15 s door to door: the playbook's vault read (~3.5 s), the model
  (~5.5 s) and the edge (~2.5 s); the standing and catalog reads now start beside the playbook's.
- Wrangler: one `wrangler.toml` per app, `[env.faithnet]` per deployment universe, bindings repeated per env,
  migration tags never renamed. Worker names `pokernight-<app>-<env>`.
- Tests: vitest. Engine has property tests; run `pnpm test` at the root before claiming anything works.
- Do not add dependencies without a reason; prefer what is already in the workspace.

## Commands
- `pnpm install` · `pnpm test` · `pnpm typecheck`
- `pnpm dev:tables` (wrangler dev on :8787) · `pnpm dev:web` (vite on :5173) · `pnpm dev:agents` (wrangler dev on :8788)
- `pnpm --filter pokernight-agent bot -- --table <id> --seat 3` (rules-based bot)
- `pnpm walk:nav` (presses every road through the card room on the live deployment as one of the Home's
  demo people: every rail row, a refresh on two pages, a club chartered at the Home and found in the rail, a
  club you are not in, and leaving a table. `--site` to point it elsewhere, `--headed` to watch.)
- `pnpm walk:club` (a club end to end: Alice charters and founds one, invites Bob at her Home, Bob joins at his
  from the door her agent's message links, the club's own agent answers the roster, and both huddle.)
- `pnpm walk:coach` (presses "deal me in" for BOTH games on the live deployment and checks the coach
  came with them: on by default at a practice table, narrating, saying whose advice it is.)
- `pnpm walk:round-end` (the end of a canasta round on the live deployment: the curtain, the freeze
  asked of the CARD ROOM rather than of the screen, "look at the board" leaving it held, and the card
  you drew being marked in your hand.)
- `pnpm play:canasta` (plays a WHOLE GAME of canasta against the three house bots through the live
  site, signed in as one of the Home's demo people — the real door, not a dev session. `--site` to
  point it elsewhere, `--headed` to watch. Playwright is a root devDependency — `pnpm exec playwright
  install chromium` once — required rather than imported, which is why the script is `.cjs`.)
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
`apps/tables`, `apps/agent`, `apps/agent-worker`, `apps/web` and `packages/treasury` depend on the PUBLISHED
`@agenticprimitives/*` packages from npm, pinned to exact versions (`0.0.0-alpha.22` for `a2a` and
`payments`, `1.0.0-alpha.24` for the rest, `connect-client` `1.0.0-alpha.14` at the time of writing). This
repository is public and links to no private checkout: bump the pins when the platform publishes, then
`pnpm install`, `pnpm typecheck`, `pnpm test`. `viem` is a peer of all of them and is declared in each
consuming app. Deployment addresses come from `@agenticprimitives/contracts/deployments/faithchain`; never
copy addresses into packages/*. The estate's Home (sign-in, agents, vaults, the coach services, club
workspaces) is operated separately; what this card room needs of it is documented where it is used.
