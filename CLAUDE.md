# Game Night (repo: pokernight)

Card room on the faithnet estate — Texas Hold'em and Classic Canasta — at **gamenight.faithnet.io**
(API `games.faithnet.io`). The PRODUCT is "Game Night" since 2026-09-14; the repo, the Workers, the
domains it grew up on (`poker.faithnet.io` redirects, `tables.faithnet.io` still answers), the OIDC client
id and every namespace keep their `pokernight` names — see the product-name rule below. People and AI Smart Agents sit at the same
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
- `packages/commission` pure Great Commission engine — a substrate test played as a game (`docs/GREAT-COMMISSION.md`):
  five fictional peoples whose hidden state moves on its own, seven parts who testify at a grain, assess,
  corroborate, commit, revoke and infer, and a score. Regions and scenarios are CONTENT, generated from the
  ontology (`pnpm gen:commission`). Seeded, replayable, no I/O.
- `packages/treasury` house money layer: read/move the 6-decimal settlement asset from Smart Agents the
  house custodies. Names no currency: the address and ticker are injected by `apps/*`.
  Config injected (rpc, chain id, deployments, signer); no hostnames, no addresses, no keys.
- `apps/tables`       Cloudflare Worker: `PokerTableDO` (WebSockets, SQLite, alarms), `LobbyDO`,
  `SessionDO`; clubs are their agents at the Home (`clubs.ts`, KV `CLUB_WIRES`). hono routes.
- `apps/web`          Vite + React client.
- `apps/agent`        reference WebSocket bot (`pnpm --filter pokernight-agent bot`).
- `apps/agent-worker` Cloudflare Worker hosting the A2A agent personas (`poker.act`, standard profile).
  Its door admits the house service agent and nobody else (`src/admission.ts`; chain vars in `wrangler.toml`).

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
  arrival (find + seed the play coin, no signature) — what is left is the buy-in mandate, theirs to sign.
  **THE ROAD TO A COACH IS THE HOME'S CONNECT CEREMONY, AND THE OFFER IS A SHEET THAT IS ACTUALLY MOUNTED**
  (2026-09-13). The same ceremony puts the four card-room skills on the agent, names Bob/Carol in the playbook
  and has the person approve the study grant, idempotently — so `CoachQuestion`'s one button for an agent
  with no coach, no skills or no name is `onSetUp` = `startHomeSignIn` again, never a Capabilities page with
  skill ids to type. The hold'em sheet was imported in `ca49c53` and rendered nowhere for a day: anybody whose
  defaults had not run saw "the house coach" on every hand and was offered nothing. It mounts in `App.tsx`
  for every page and in `TablePage` for the table; only "don't ask again" is kept. Walk it with the scratch
  `sheet-branch.cjs` (stubs `/me/coach` for the three states) and `home-road2.cjs` (the real door, as Elena). The canasta coach card hands up `CanastaArrangement`; `VoiceSettings` is exported
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
- **WHAT IS BEHIND YOU ON CAMERA IS THE ROOM YOU ARE STANDING IN** (2026-09-15,
  `components/huddle/background.ts`). Cloudflare's RealtimeKit ships a video background transformer
  (`@cloudflare/realtimekit-virtual-background`, lazily imported because it carries a segmentation model):
  off, a blur, or a STILL OF THE 3D SCENE — the lounge or the Belvedere is already being drawn a few pixels
  from the person's face, so `roomStill()` reads that canvas and their camera sits in the very room their body
  does. It is a snapshot taken when they press it, never a per-frame render into a middleware. The setting
  lives on `ClubHuddleProvider`, not the dock, because a middleware lives on the TRACK: turning the camera off
  and on again makes a new one with no backdrop, so it is re-applied on `camOn`. An unsupported browser says so.
- **A CLUB HUDDLES — voice, faces and the table, for its members whether or not they are playing**
  (Home spec 378, `club` scope; principal and id are both the club's agent). The Home's huddle service
  decides who may start, join or end from standing IT derives; the card room's `POST /clubs/:id/huddle/:op`
  names the member to the Home under the paired secret (a person who signed in through their Home holds no
  Home bearer here), and passes the join's `authToken` through once. `components/huddle/` —
  `ClubHuddleProvider` (owns the call above every page), `ClubHuddleDock`, `HuddleAffordance` on the club page
  and in a club table's top bar.
- **A MISSION IS A REGISTERED ORGANIZATION, AND THE REGISTRY IS A KIT-BUILT ONE** (2026-09-14,
  `docs/MISSION-REGISTRY.md`). `urn:ap:registry:gamenight-missions` on the estate's `AgentRegistryBase`,
  controlled by a registry operator agent the house custodies (`house.faithchain.json → missionsRegistrySa`,
  `pnpm provision:missions-registry`; its wire to the house session key is `MISSIONS_REGISTRY_WIRE`,
  `pnpm mint:house-wire --as registry`). A mission REGISTERS ITSELF: the register form (`#/missions/new`)
  sends the steward to their Home with `org-create` + `org_purpose=mission` + `registry_entry`; the Home
  chooses or creates the org, has the steward sign the three-clause covenant, has the ORG sign its own
  `registerEntry` (RB-01), writes presence/covenant/contact to the org's vault, and returns everything on
  the `org` payload; `POST /missions/enrol` runs the admission pipeline (`src/missions.ts` — every hash
  against the chain's entry, the covenant against the steward's agent) and signs a receipt AS THE
  OPERATOR into `MissionRegistryDO` (entries, receipts, a hash-chained log). The map shows only what the
  COUNTRY CEILING allows (`@pokernight/missions` `displayPoint`, ported from Gather27's table — `~/engage`
  is the worked example and is touched by nothing here). A mission is a standing presence, never an event.
  Nothing on the hop is Gather27's: not its workspace, not its records.
- **A GUEST IS NAMED FROM THE REGISTRY AND STAMPED, LIKE THE CLUB** (2026-09-14). `CreateTableRequest.mission` is an
  entry id; the Worker resolves it against the registry (active only, `activeMission`) and stamps a `MissionRef` on
  the table (`TableMeta.mission`, on the summary and the spectator view); the top bar shows `♦ <name>` beside the
  club, linked to the mission's page. A club's schedule carries a STANDING guest (`defaults.mission`) and the nights
  record a per-night one (`guests[nightId]`: a ref, or `null` for none) — a night's `mission` is derived (`guestOf`),
  never stored on the night. `components/MissionPicker.tsx` is the one control for all three.
- **A CLUB'S PAGE IS A HEAD, FOUR TABS AND FLYOUTS — never one flow down the screen** (2026-09-14). The head
  carries the club's name and its actions (huddle, open a table); the tabs are Nights · Tables · People · About
  (`pages/ClubPage.tsx`, `People`/`About` in `components/ClubDetail.tsx`); a night's detail — its visit, its tables —
  opens in `components/Drawer.tsx` beside the page (`Nights.tsx` `selected`), so going into a thing never scrolls
  the page away from where the person was.
- **A NIGHT IS AN EVENT THAT HOSTS TABLES; A MISSION'S VISIT IS ITS PARTICIPATION** (2026-09-14,
  `docs/MISSION-REGISTRY.md` §3.1). `cr:ClubNight ⊑ at:Event`; one-time nights live beside the series
  (`NightsRecord.oneOffs`, `oneOffFrom`, `POST /clubs/:id/nights`) and `nightsOf` merges them by start; a night has
  any number of tables of its ONE game (`CreateTableRequest.night` → `TableMeta.night`, game enforced, guest
  inherited). `cr:MissionVisit ⊑ at:Participation` (`NightsRecord.visits`, `visitOf`; the old `guests` reads as an
  invited visit): the mission, the representative (name · agent · email/phone — host-only, stripped for members
  in `clubViewFor`), the status. OPENING A TABLE IS A PAGE (`#/tables/new`, `#/clubs/<id>/tables/new?night=`,
  `pages/TableNewPage.tsx`) — the table and the stakes side by side; the two `<details>` forms are gone.
- **THE VENUE IS THE LOUNGE'S MACHINERY, SO EVERY RULE ABOVE APPLIES TO IT** (2026-09-15). The mystery's cast wear
  the four colours the TITLE authors for their portraits — skin, hair, what they wear and an accent — because the
  bodies name their materials by what they are (`BodyLook` in `embodiment.ts`); that is how eight parts of different
  ages, tones and builds come off two body files, and `figure` says which body plays them with nothing inferred from
  a name. **A DOOR IS A LEAF ON A HINGE**: the kit's own panel hangs nowhere near its frame, so the leaf is a box
  hinged at one edge of the opening, MEASURED from the frame that is there; it swings as the body reaches it and the
  staging is not asked to move you until it is open. **THE NIGHT OPENS ON THE WHOLE ROOM FROM ABOVE** — a doll's
  house, everybody separated on the floor with their names readable — because the first thing a player needs is who
  is here and where; at eye height the room was a thin band with every plate piled on every other. Height rides the
  pitch, and the distance shortens as it climbs or a high camera looks at the roof from the next valley.
  **A NAME IN THE CAST LIST IS A PERSON IN A ROOM**: pressing one turns the camera on them, and on a victim where
  they are LYING — `room.death` says a death happened here and the PLAN says where a body lies in this room
  (`deathAt`), so the ski room is the foot of the racks and not a line of text. The dead play the body's own death
  clip (`Death_Pose`, kept by the build script) and are never walked or turned again.
  **THE ROOM STAYS ON THE SCREEN** (2026-09-15): the page was one long column — picture, log, then the things you
  could do in the room — so every act meant scrolling the room away, pressing a button you could not see the
  result of, and scrolling back. Both columns are height-bounded scrollers inside one screenful, the room's own
  controls sit directly under the picture, and NOTHING on the page scrolls the window. Selecting a person or a
  thing opens a FLYOUT over the picture (`Inspector`) and never moves the page.
  **HOVER PICKS IN CANVAS PIXELS, NOT CSS PIXELS**: `worldToScreen` answers in the canvas's backing store, which
  this app sizes up to 2× the CSS box for sharpness, and a DOM pointer event is in CSS pixels — so the venue's
  hover was testing a point up to twice as far from the middle as the cursor, and nothing lit on a 2× screen. The
  CLICK never had it, because that comes through PlayCanvas's own mouse event, which is already canvas-space.
  **AND WHAT IS "AT" THE CURSOR IS THE THING'S OWN SIZE ON SCREEN, never a number of pixels** — the same rule as
  the lounge's seats. A flat 90 px reach is about right beside somebody and about three metres of floor from the
  doll's-house view, so half the lobby selected a person; the reach is a fraction of how tall the thing is on
  screen (a third for a person, who is about that wide; over half for a thing on a table), measured from the
  geometry actually placed for it, and candidates are scored in their own widths so the nearest does not win by
  being biggest. Measured live: a person 29 px tall selects within about 12 px and not at 20.
  **LOOKING AT SOMETHING IS SAID OUT LOUD WHATEVER THE CAST VOICES ARE DOING** (`narrate` beside `sayAs`): the
  cast toggle is a preference about how noisy the night is; an inspection is an answer to a question the player
  just asked, and it still queues behind the story rather than talking over it. **WHAT YOU EXAMINE IS A THING YOU CAN SEE** — the register is a
  ledger on the desk and the racks are skis, not a label over a side table — and arriving at one leans the camera in
  over your shoulder to frame the OBJECT (its bounding box, not its spot on the floor: aiming at the floor put the
  camera under the desk). A planned primitive honours its shape, its height and its tilt; before that everything was
  a box standing on the floor whatever the plan said. `window.__venue` is the walk scripts' handle, like `__lounge`.
- **THE PLACE AND THE STORY ARE ONTOLOGIES, AND THE APP IS GENERATED FROM THEM** (2026-09-16,
  `docs/PLACE-AND-STORY.md`). The Hôtel Belvedere was described three times — coordinates for the renderer,
  rooms and props for the engine, prose for the director — and descriptions of one thing kept in several places
  drift, which is how "the guest register" became a bare side table with a label over it. Now: `~/skills`
  carries two UPPER ontologies (`place.ttl` — buildings, rooms, open spaces, openings, features, geometry,
  ambience, holding no plot; `story.ttl` — the work, acts, parts, evidence against claims, and the three jobs
  around a played story: the WRIGHT who may decide anything, the DIRECTOR who may decide nothing, and the
  CONSPIRATOR who is offered chances and may decline) and two A-BOX domains under them (`belvedere.ttl`,
  `belvedere-snowfall.ttl`). `scripts/place-to-plan.mjs` and `scripts/story-to-title.mjs` COMPILE those into
  `plan.generated.ts` and `belvedere-snowfall.generated.ts`; `story-to-archetypes.mjs` writes the eight part
  archetypes. Compiled, never loaded — the scene is built on a lazy canvas in a browser and a thousand triples
  there would be a download for nothing. THE TWO DOCUMENTS HOLD NO IDENTIFIERS OF EACH OTHER: they join on one
  string per thing (`st:foundAtKey` ↔ `pl:featureKey`), so a second story here is a new file, not a fork.
  Both generators were proven by round-trip — 5 rooms and 93 things, 8 parts, 3 acts and 28 clues identical to
  the hand-written files, whole suite green. AGENTIC TRUST IS THE UPPER BOTH EXTEND (`at:Location`,
  `at:Geometry`, `at:spatiallyWithin`, `at:Commitment`, `at:ExecutionTrace`); PROV-O and DOLCE+DnS are
  imported; GeoSPARQL, BOT/IFC, CIDOC-CRM, FRBR, Propp and the BBC Storyline ontology are borrowed PATTERNS,
  named in each header and imported by none. `st:order` carries sequence, because RDF is a set and a story is
  an order. Editing the hotel or the story means editing the TTL and running the generator — never the .ts.
- **A DOMAIN NEEDS A T-BOX OR THERE IS NOTHING TO LOOK AT** (2026-09-16). Both Belvedere contexts were
  registered as pure A-box, so the skills app's Graph drew nothing for either: its Model view renders classes
  in semantic clusters and they declared no class of their own. Each now has `<name>.tbox.ttl` +
  `<name>.clusters.ttl` beside its data (hotel 28 classes in 4 cuts, story 26 in 5), and every individual is
  typed TWICE — upper class and domain class, ADDED and never substituted, because nothing here runs a
  reasoner and `place-to-plan.mjs` must keep finding five `pl:Room`s. Re-running both generators after the
  retyping produced byte-identical output, which is the check that it was additive.
- **THE VENUE'S ZOOM HAS TO REACH THE PEOPLE** (2026-09-16). The Belvedere's camera derived its HEIGHT from
  the room's size and the pitch and nothing else, so the wheel slid it toward the middle of the room at
  thirteen metres up and never descended. All eight characters were drawn and enabled the whole time — as
  specks, under name plates stacked into "Marek NovákKai Brunner", which is why the room looked as though only
  the played characters were in it. Height now scales with zoom (floored at 1.6 m) and the range reaches 0.3,
  so wound in you are standing among them: measured 12.97 m → 3.89 m. AND PLATES DE-OVERLAP: a name colliding
  with one already placed is lifted a row, nearest body keeping its natural height, so eight people read as
  eight people. Diagnose it with playwright as the alice demo persona — `window.__venue` carries `bodies` and
  `camera`, and "who is drawn" and "where is the camera" are two evaluates.
- **A NAME IN THE CAST LIST IS A PLACE TO WALK TO** (2026-09-16). Pressing one used to swing the CAMERA at
  somebody, and only if they were already in your room; anybody else got "not in this room", which is a refusal
  rather than an answer. `venue.goTo(role)` walks your own body instead — breadth-first over the plan's own
  doors, a hop at a time, re-read every frame because each door is an engine round trip and the room changes
  under it. A victim is where they FELL, so the same press is how you go and look at a body. Every row says
  which room, and a death is now SAID with its room ("Marek is dead, in the kitchen") rather than leaving eight
  people to ask each other where. `ViewPerson.room` is public on purpose: this game's deduction rests on traits
  and evidence, never on whereabouts, and a party where you cannot find the person you want to talk to is a
  party nobody enjoys.
- **A THING YOU CAN EXAMINE IS A THING YOU CAN SEE — the drinks and the piano got the register's treatment**
  (2026-09-16). "The drinks" was the coffee table with a label over it and "the piano" was a bookcase turned
  ninety degrees, so the one clue found there — a photograph on the lid — was found on a shelf. Both are built
  from primitives in `belvedere.ttl` now: a silver tray with four glasses, a decanter and a dead ice bucket;
  an upright with lid, black and white keys, the music desk, the stool pushed back and the photograph in its
  frame. The feature hangs on the TRAY and on the piano BODY, so a close-up frames the thing rather than the
  furniture it stands on. Prop detail lives in two places that must agree — the A-box's `pl:detail` and the
  venue's `VenueProp.detail` — because the first is what the hotel is and the second is what the engine ships.
- **AN EVENING HAS A HOST, AND THE HOST IS NOT AN ADMIN** (2026-09-16, `ontology/story-hosting.ttl`). The
  club's host already set a night up and raised its curtain; what was missing was everything else about the
  OCCASION. **A HOLD IS THE HOST'S**: every socket could send `pause`, so any one of eight people could stop
  the whole evening — the clock, the characters, their agents — for the other seven, and nobody could tell who
  had. `isHost` gates it in the object and the button is drawn for nobody else; a solo night's host is its
  owner, so one person alone is unaffected. **TAKING A PART IS A PROMISE; ARRIVING IS AN OBSERVATION.** The
  cast list says who claimed a part, which is why the curtain used to go up on people still making tea. The
  staging summary carries `ready` — taken, present, and the names in the gap — and the club page shows a
  DOORWAY. Presence is an open socket OR a look at the night within `PRESENCE_MS` (20 s, and the club page
  polls every 5), because during casting nobody has a socket at all and presence from sockets alone reported
  an empty room right up to the curtain. It never blocks: the button reads "Start anyway", because refusing to
  begin an evening is not this app's decision — a host who knows somebody is stuck on a call is right, and
  whatever nobody plays is played by the house. The host's ceiling is the MIRROR of the director's and
  separable from it: everything about the occasion, nothing about the story (`st:HostPolicy`, a SHACL shape
  fixing `decidesStory` false; `st:StartCondition` is advisory by shape for the same reason).
- **A STORY IS EXECUTABLE DRAMA, AND A CHOICE IS A CONSEQUENCE THE NIGHT CARRIES** (2026-09-16,
  `docs/PLACE-AND-STORY.md` "The second layer"). Six modules under `story.ttl` — intent, social, epistemic,
  dramaturgy, performance, place-compat — and `story.data.ttl`, which makes each archetype an
  `at:CapabilityRealizationContract`. `belvedere-snowfall-v2.ttl` writes every part a Goal, a Stake and a CHOICE
  with two options whose consequences set OUTCOMES (`books:told`, `hotel:selling`…) and, by shape and by code,
  touch no canon. The engine's `choose` action (own part, once, in or after its act) records the outcome and says
  the consequence in the room; the view carries `choices` and `outcomes`; Your Part shows "Before you". THE
  GENERATOR READS `<story>-v2.ttl` BESIDE THE BASE and emits `choices`. `pnpm check:capabilities` fails the build
  on any capability id that is not the protocol's own (contracts, skill frontmatter, registry scripts, written
  effects); `pnpm check:place` answers whether a story can run in a place with a BINDING WITNESS per requirement
  or the exact reason it cannot (the Belvedere without its piste door fails `repose`). The piste door is in the
  A-box and NOT in the 3D plan: `place-to-plan.mjs` emits only doors between `pl:Room`s. `pnpm gen:story`
  regenerates all three compiled files.
- **MYSTERY NIGHT IS A STORY AT A PLACE** — `docs/MYSTERY-NIGHT.md`; **P1 built 2026-09-15**:
  `packages/mystery` (the pure engine + the Belvedere venue + `belvedere-snowfall`, one engine and titles as
  CONTENT), `MysteryDO` (one object per staging, migration v7, the clock and the agent cast on its alarm),
  `/mysteries` · `/mysteries/solo` · `/mysteries/:id` · `/mysteries/:id/ws`, and `pages/MysteryPage.tsx` at
  `#/m/<staging>` — the place page, which is the PRIMARY client and not a fallback. A solo night is derived
  from its owner like a practice table (same night when you ask twice; a new one when you ask for another,
  or for another part). `checkTitle` proves a title solvable before anybody plays it — every possible
  killer narrowed to exactly themselves by the traits two deaths give up — and it runs in the package's
  own tests. What P2–P4 still owe (`.cast` agents, role archetypes at the Home, the director, the 3D venue)
 is §14 of the spec. **WALKING IN ON A NIGHT THAT HAS BEGUN**: a club member who arrives after
  the curtain is not a spectator — whatever nobody took is being played by the house, and they may TAKE ONE OVER
  (`POST /mysteries/:id/cast` after casting). Same character, same history, same secret; only the mind behind it
  changes, which is the swap the cast list already describes. ONE PART PER PERSON PER NIGHT AND NO SWAPPING —
  not only because an abandoned character is a hole in the story, but because the killer is drawn from the cast,
  so somebody able to try parts on would have the answer in eight goes. A part a PERSON plays is never taken from
  them and a dead one is not a part. Its own invariants, learned by playing it: **NOBODY HERE, NOBODY ASKED — AND AN OPEN
  SOCKET IS A TAB, NOT A PERSON** (`ATTENTION_MS`, twenty minutes, 2026-09-15). Every wake of the alarm may ask
  a character's agent for a line, and that agent is a language model at somebody's Home — so a night left open
  in a tab is not idle, it is a hotel full of models talking to each other, billed to whoever custodies them,
  with nobody reading a word. The clock and the cast run only while a PERSON has done something inside the
  window (a line, an act, walking in, the curtain); A PING DOES NOT COUNT — it heals a lost alarm but is a tab
  proving it is still a tab. Past the window the object stops RE-ARMING rather than waking to decide again, and
  the next thing anybody does starts it and catches the night up. `heard` is persisted, so an eviction does not
  reset the clock. The card room's tables have had the same rule at ten minutes since 2026-09-13. The clock
  and the cast run only while a socket is open, and the night CATCHES UP (`catchUp`, bounded) the moment
  somebody reads or reconnects, so a staging left alone stops where it stood rather than running an empty
  hotel or waking up an act behind; WHAT YOU HEARD, YOU HEARD (every room-scoped event carries who was in the
  room at the time — redacting on where somebody is NOW un-remembers the first act the moment they walk
  through a door); A CHANCE DOES NOT OPEN AT THE DOOR (`murderAfter`, halfway through an act, for a human
  killer and an agent alike); THE ONE PERSON PLAYING IS NOT THE VICTIM (a party may kill a player — a solo
  player would spend the evening reading a transcript); and ONE CHARACTER ANSWERS, NOT ALL OF THEM (everybody
  in a room derives the same answerer from the words, so a question gets a reply and not a chorus). The third game and the first that is not a table: ONE engine (`packages/mystery`)
  and many TITLES as content; venue · title · staging are three separate things; every character is a CUSTODIED
  agent (`.cast`, a vertical type over `person`) cast in a ROLE that is an ARCHETYPE in a new `mystery` skills
  context; the engine owns facts and the director service owns only words; the killer is drawn by the seed,
  committed before the night and revealed after; a clue is a card (`viewFor`/`redact`); one player and seven of
  the estate's own agents is the DEFAULT shape, drawn as the room's own bodies. Read it before building any of it.
- **GREAT COMMISSION IS A SECOND GAME, NOT A TITLE** (2026-09-17, `docs/GREAT-COMMISSION.md`). Paul Martel's
  tabletop note re-skinned Mystery Night as a substrate test: five fictional peoples whose hidden state moves on
  its own, seven parts (returnee, household network, sending agency, funder, researcher, convener, adversary)
  who hold testimony in vaults, a picture assembled from PERMISSION SLIPS, and one adversary reading the same
  coarsened signals. THE RAILS PASS IF THE PICTURE FINDS THE MOTION BEFORE THE ADVERSARY FINDS THE PERSON. Its
  hidden truth, verbs and score are not a murder's, so it is what the layout rule says a new game is — its own
  package (`packages/commission`), `CommissionDO`, `/commissions/*`, `pages/CommissionPage.tsx` at `#/gc/<id>`,
  `commission.act|direct|consult`, cast personas and archetypes — sharing every PATTERN a mystery proved (seeded
  draw and commitment, `saw` on every room-scoped event, `viewFor`/`redactEvent`, the cast table, takeover, the
  host's hold, presence and attention) and no code. **GROWTH IS EXOGENOUS**: `state.truth` is written in `tick`
  and nowhere else, and no action carries a field that names it — the CAS brief's boundary (carriers are agents;
  the response of those who hear is never modelled) as a type. **THE HIDDEN STATE IS NEVER CALLED THE TRUE
  PHASE**: a phase is an assessment made from testimony; the engine's value is the fictional ground truth the
  assessment is scored against, and `cm:HiddenEventState` and `cm:PhaseReading` are two classes no property
  joins. **YOU MAY COARSEN, NEVER REFINE**: a slip finer than its room's rule is a LEAK, a number the vault does
  not hold is a FABRICATION, a corroboration standing only on a withdrawn slip is a REPLAY — recorded, never
  adjudicated in the room, and shown in the score. **THE WORLD IS AUTHORED UNDER THE FAITH ONTOLOGY**:
  `~/skills/ontology/commission.tbox.ttl` sits under `faith.ttl` and `story.ttl`. WHO A PEOPLE IS AND WHERE THEY ARE ARE
  TWO NODES (2026-09-17; the first draft subclassed `gc:PeopleGroup`, which is not a class): `cm:People ⊑
  gc:PeopleGroupIdentity` (a name in an invented register — no phase, no place) and `cm:PeopleCommunity ⊑
  gc:PeopleCommunity`, THE KEY CLASS — the body in a place that the schedule, the reading and the carrier belong to and
  the only thing a phase is claimed of. The grain axis is five faith classes: `at:Person` < `gc:FormationCommunity` (the
  household circle, the hidden fine end) < `gc:NeighborhoodCommunity` (village) < `gc:PeopleCommunity` (province) <
  `gc:PeopleGroupIdentity` (people). A reading is a `gc:CommunityPhaseResult` saying `gc:assignedLevel` /
  `gc:engagementStrength` (`poe:PhaseN`, `poe:StrengthX`); a hidden state says `cm:phase`, NOT a sub-property of it; `kettlewater.ttl` is the A-box; `scripts/world-to-commission.mjs` compiles it
  and `test/roundtrip.test.ts` proves the compiled world equals the hand-written one (the ontology's `st:order`
  is canonical — the TypeScript bends to it). Everything an instance names is INVENTED, by shape
  (`cm:isFictional true`): no real people-group name may appear anywhere in it. The Toolkit's phases are
  © 2026 Phases of Engagement Collaborative, CC BY-NC-SA 4.0, referenced by IRI and not re-declared.
- **A CHARACTER'S WHISPER IS A DIRECT MESSAGE FROM ITS OWN AGENT** (2026-09-17, `apps/tables/src/cast-messaging.ts`,
  both game objects' `carryWhispers` on every save). A whisper is private and 1:1 — the shape of a direct message —
  so when an agent-played part whispers, its words land in the hearer's inbox at their Home UNDER THE SPEAKER'S NAME
  (a cast persona's, or the person's own agent when a person plays the hearer), with the sender's own copy beside it.
  THE HOUSE CANNOT SEND IT: `messaging.direct.send` runs only as the agent whose run it is, and the recipient's
  delivery door (`messaging.deliver`, at the agent's own subdomain) is behind the estate's gateway assertion, which
  this Worker must not hold — so the `MYSTERY_CAST_WIRES` idea (a wire pinned to `messaging.deliver`) was a door the
  card room cannot reach. What works is spec 400 W2a, the card room as EACH CHARACTER'S OWN RUNTIME on the standard
  surface: an ASK WIRE (character → the house session key, `harness.ask`) makes it the character's principal-by-wire;
  the run parks AUTH_REQUIRED naming what it needs; the Worker DERIVES that mandate from a STANDING GRANT the custodian
  signed once (character → session key, `messaging.direct.send`, bounded to the cast and the seven demo people, no
  intent binding), signs the child with its own key and continues the same task presenting [child, standing]. Four
  ceremonies per character, all at the estate (`equip-cast-messaging.mts`): the archetype offers the tool (a plan
  naming a tool the playbook lacks is refused as `unknown_tool`), the rail (`enableMessaging` — without it an
  authorized send cannot leave, `wire_absent`), the standing grant recorded on the character's own object, the ask wire.
  The note is thirty kilobytes of signed delegations, so it lives in KV `CLUB_WIRES` under `cast-messaging` (a Worker
  secret holds five; `CAST_MESSAGING` in the env is the dev/test path). **THE CHARACTER IS THE IDENTITY** (corrected
  the same day, and it is a rule about the whole game, not about messaging): a `Casting`'s `agent` and `name` are the
  CHARACTER's and stay the character's through a takeover — Dr Wren is `wren-alice.me` and is called Dr Wren whoever is
  behind her — and the person driving her is `playerId` / `custodian` / `playedBy`. Taking a part used to overwrite both
  with the player's own agent and the player's own name, which put a character's mail in a player's inbox and a player's
  name where a character's belonged. Only a part the estate never chartered a persona for is addressed at the player's
  own agent. So both ends of a whisper are the part's STANDING PERSONA from the deployment's cast list, whoever plays it
  tonight — a whisper to Dr Wren lands in `wren-alice.me`'s inbox and the person reads it at their Home AS that persona
  (`/as/<address>`), and a whisper a person types as Dr Wren goes out FROM `wren-alice.me`. The first version routed a
  person-played part to the person's own agent, which put a character's mail in alice.me's inbox; the game addresses
  characters, never players. Only a role with no persona at all falls back to the cast entry's own agent. The two helpers are
  `@agenticprimitives/runtime-member`'s `deriveForNeed` and `askAs`/`continueAs`, carried locally because that
  package's index drags in a Node keystore the Worker cannot load (subpath exports are committed upstream, unpublished);
  the JSON-RPC client is our own too, because the pinned a2a (alpha.22) `createStandardA2aClient` has no `signRequest` and
  silently sent the first version unsigned ("admits only an authenticated principal").
  Proven live before any of this was written: Ilse's agent → Teodor's inbox, one conversation on both sides.
- **THE PLACES ARE A ROOM, A TABLE AND A CLUB — there is no "card room"** (2026-09-15). That phrase was in a
  hundred lines of copy and named nothing a person could point at; the vocabulary is the three things the app
  actually has. `lib/brand.ts` still owns the product name.
- **A CLOSING SOCKET IS NOT SOMEBODY LEAVING** (`SceneDO.leave`, `LINGER_MS` 12 s, `ROOM_LINGER_MS` for tests):
  taking a seat by the fire moves a person to that seat's own page and the page they came from closes its
  socket on the way, so removing them at once made everybody watch them VANISH and reappear seconds later. The
  body lingers; a reconnect inside the grace cancels the removal and is seamless. The room page also POSES INTO
  THE CHAIR BEFORE IT NAVIGATES, and the seat's page poses the moment the manifest lands rather than on a timer.
- **THE FRONT DOOR IS ONE CHOICE AND A LIST OF ERRANDS** (2026-09-15): "Come play or hang out" is the button,
  and beside it a quiet, evenly-weighted list — sign up, start a club, the missions, how it works — each row
  saying where it goes and each going to a PAGE that stands on its own. Four buttons of similar weight had made
  arriving a decision, when almost everybody who lands here wants the same thing.
- **SIGNING UP IS ITS OWN PAGE** (`#/signup`, `pages/SignUpPage.tsx`): three lines of what happens, the name,
  and the same one trip to the Home. `SignInPanel` takes `startSigningUp` / `showSwitch` so the page opens
  straight into its sign-up half without the door-swapping link.
- **SIGNING UP AND COMING BACK ARE TWO DOORS** (2026-09-15, `SignInPanel`): "what should we call you" belongs to
  sign-up and waits behind "first time here"; a returning player gets one press. Whether this browser has ever
  held a session (`pokernight.ever`) is the only honest thing the page can know before anybody signs in, and a
  wrong guess costs nothing since both doors lead to the same ceremony. THE DISCLOSURE IS ON BOTH DOORS — the
  Home and the ceiling, on whichever one is actually going to be pressed.
- **THE FIRST SCREEN IS AN INVITATION, NOT A PRICE LIST** (2026-09-15). Sign-in leads with "Come in and play" and a
  button that says the same. THE BUY-IN CEILING IS NOT STATED HERE (2026-09-15): the person's own Home shows
  those numbers and asks them to sign, which is where the consent happens and the only place it can be refused,
  so repeating them on the way made a games site open on money for no gain. Nothing on it is poker's: this room
  deals more than one game, and no copy names a phone number as the way in.
- **STARTING A CLUB IS A HOST'S OWN ROAD, OPEN TO A VISITOR** (2026-09-15, `pages/NewClubPage.tsx`), the same
  shape as a mission steward's: `#/clubs/new` renders for somebody with no session (special-cased in `App.tsx`
  beside `newMission`), explains the road, and takes ONE trip to their Home. Sending them through the room's
  sign-in first made them a player before it let them be a host — play money, a buy-in ceiling, a seat, a coach,
  none of which a host came for.
- **THE THINGS YOU DO ONCE LIVE IN THE HEADER** (`.topbar-secondary`): registering a mission is a steward's
  errand and starting a club is a host's, and neither belongs in front of somebody who came to play. Missions
  are still SHOWN everywhere (the map on the front door and on Play); only the REGISTER road moved.
- **SITTING DOWN FLIPS TO THE FLAT BOARD, STANDING UP GOES BACK TO THE ROOM** (2026-09-15, `lib/fromRoom.ts`).
  One place seen two ways: the room is where you walk and see who is here, the table is where a hand is played
  with readable cards, a real action bar and the coach. Taking a seat in the room navigates to `#/t/<id>`;
  giving the seat up there returns to the room it was taken from — WHICH room is remembered in `sessionStorage`,
  because the board has no idea where you were standing and the hall and each club's lounge are different
  places. The table's leave button reads "Stand up" when there is a room to go back to.
- **THREE PLACES YOU SIT: A TABLE, THE FIRESIDE, THE BAR** (2026-09-15, `pages/FiresidePage.tsx`). A table is
  where a hand is played. THE FIRESIDE is where the night's GUEST is met — six chairs on an arc facing a hearth
  that actually burns, and the mission's own representative hosts the call there. THE BAR is a place to talk
  with no guest. All three are taken the same way (walk up, the chair lights, sit) and all three open a 2D page;
  `BAR` / `FIRE` are the pseudo-table ids the room uses to tell them from a real seat.
- **A SEAT'S ANGLE USES THE TABLE'S CONVENTION, always**: a seat at angle `a` sits at `(sin a, cos a) · r` from
  the centre, the chair piece is turned `a` degrees, and the BODY's yaw is `a + π`. That one demonstrably faces
  inward; deriving it afresh with cos/sin and an `atan2` is what left the fireside's chairs looking at the wall.
- **PARENTING SOMETHING ONTO A BONE INHERITS THE BONE'S SCALE** (2026-09-16). PlayCanvas `reparent` keeps a
  node's LOCAL transform, and these rigs are authored tiny under an armature that scales them back up — the
  head bone on all three shipped bodies carries a world scale of about 36.8. So the dealer's hat, put on the
  head bone to make it turn and nod with the skull, became an eleven-metre red disc standing in the club room.
  Divide the parent's measured scale back out (`hd.getWorldTransform().getScale()`, then the reciprocal as the
  child's local scale) rather than hardcoding a number, so a body authored at 1:1 gets 1. Reading a bone's
  POSITION is safe and is all the mystery's camera does; attaching to one is what needs this.
- **A HIGHLIGHT CLONES THE MATERIAL THAT IS THERE and only adds emissive.** Swapping in a foreign
  `StandardMaterial` made the kit's chairs VANISH under the pointer instead of lighting up.
- **"AT THE FIRE" IS A DISTANCE, NOT THE ROOM'S ZONE** (`isAtPlace`, `lib/roomSeats.ts`): the fire anchor's
  radius is 2.5 m and its chairs stand at 2.55, so a body sitting in one was never inside the zone and a
  fireside with people in it reported nobody. Both views measure the distance themselves, from one shared
  definition of where those seats are, so the two cannot drift apart.
- **THE FIRESIDE AND THE BAR KEEP THEIR OWN PRESENCE** (`FiresidePage` opens a `RoomSocket` and poses at the
  anchor): sitting down leaves the 3D room for a 2D page, so without it the two people who had both sat down
  could not see each other at all — each alone in a room about meeting people.
- **A HUDDLE BELONGS TO A SEAT — AND TO THE ROOM** (2026-09-15, revised the same day): a call is offered at a
  table you are SITTING at (`mySeat != null`), at the fireside, at the bar, and IN THE CLUB'S ROOM. The seat-only
  rule was written when a call could only be a grid of faces, which belongs to the people sitting down together;
  the room has since grown what that rule was missing — `SpatialVoice` places every voice at the BODY that owns
  it and each person's camera hangs beside their own body, so the room is the one place in the club where a call
  is a PLACE rather than a window. Sending somebody to a table to be able to say hello in the lounge was the tail
  wagging the dog. Same club scope either way. A spectator at a table still gets no call, and a SOLO mystery has
  no club, no roster and therefore no call — the page says so rather than leaving an empty corner.
  **AND IN A MYSTERY THE CONTROLS LIVE IN "YOUR PART"**, beside the wardrobe — the WAY IN as well as the
  toggles. Turning a camera on there is not joining a call, it is whether the room can see and hear YOU, which is
  the same question as what you are wearing; leaving the join as a chip in the page header meant the panel that is
  about being seen said nothing until you had already found the call somewhere else. A character a person plays
  wears THEIR camera in the cast list too, falling back to the drawn face, so the list says at a glance which of
  the eight are people you can actually talk to tonight.
- **A HOST MAY CLEAR A TABLE** (`mayManageTable` in `apps/tables/src/index.ts`): whoever opened a table or a host
  of its club may stand somebody up at it, not only an operator. Telling a host to "stand them up first" while
  giving them no way to do it pinned a table open for good once anybody walked away from a seat. A stranger's
  session is refused 403 (authenticated, not permitted); no session at all is still the operator gate's 401.
- **THE ROOM IS A PLACE; A TABLE IS A THING IN IT** (2026-09-14, `docs/SPATIAL-ROOM.md`). `SceneDO` (one per room:
  `hall`, `club:<id>`; migration v6) holds presence — who stands where, in which zone — and NOTHING about cards; the
  Worker admits by the club's standing and lays the lobby's poker tables on the lounge's anchors on every entry.
  The client (`pages/RoomPage.tsx`, `components/room/Lounge.tsx`, **PlayCanvas** — chosen over three.js for its editor
  and asset pipeline) is LAZY-LOADED like Leaflet — the engine never at module time; name plates are HTML projected
  with `camera.worldToScreen` (its `z` is view depth — behind the camera is negative, nothing else). A body in a table's zone is offered the FLAT table (step 5 draws the felt in the
  room); sitting is the table's own `seat` command, never the room's. PlayCanvas primitives are unit-sized (a
  capsule is 2 m tall at scale 1); lights are `directional` / `omni` with an `intensity` around 1–2.
- **VOICE IN A CLUB'S LOUNGE IS THE CLUB'S HUDDLE, PLACED** (2026-09-14, `components/room/SpatialVoice.tsx`). The
  same RealtimeKit meeting; each participant's audio track goes through a `PannerNode` (HRTF, inverse rolloff) at
  the body that owns it, the listener at yours, matched by the huddle's display name = the session's name. The
  dock's `<audio>` elements stay ATTACHED but muted (`HuddleCtx.spatial`): a remote WebRTC track flows into Web
  Audio only while some media element holds it. The hall has no huddle (no `hall` scope at the Home yet).
  Walk: scratch `voice-walk.cjs` (fake media; `window.__spatialVoices` counts placed voices).
- **A BODY IS TOLD WHAT IT IS DOING, NEVER HOW TO MOVE A LIMB** (2026-09-14, `components/room/embodiment.ts`,
  spec §3.6). `ParticipantAvatar` takes semantic acts — `place`, `walkTo`, `sitAt(seat)`, `stand`, `lookAt`,
  `gesture`, `talking` — and ONE PlayCanvas anim state graph for everybody makes them happen on ONE rigged,
  CLOTHED, ordinary human (`public/room/person.glb`, CC0) whose outfit is a 32×32 PALETTE the mesh's UVs point at
  (`skin-<word>.png`, ~140 bytes) — so six people in six outfits cost one download and six swatches, and a new
  outfit is a recoloured swatch rather than another body. Never `quantize` a skinned body.
  **A BODY IS AN ASSET, NOT CODE** (`docs/AVATARS.md`, 2026-09-15). The room resolves both CLIPS and the six
  bones it drives through ALIAS LISTS (`CLIPS`, `BONES` in `embodiment.ts`), so a body retargeted by any tool —
  Unity's Humanoid retargeting, Blender, the scratch pipeline — drops in with no code change; a missing clip or
  bone is named in the console rather than silently playing a T-pose. `pnpm exec node scripts/check-body.mjs
  <file.glb>` answers "will the room take this body?" without a browser: clips, bones, height, feet at y=0, and
  root motion on the walk. Retargeting BETWEEN HUMANOID RIGS IS THE ONE JOB WORTH LEAVING THE BROWSER FOR — the
  hand-rolled version below gets limbs roughly right and spine and shoulders wrong, which is why seated players
  look hunched. A Unity WebGL runtime is NOT worth it: the room shares thirteen modules with the app (the action
  bar, the cards, the huddle's live video, both sockets), each of which becomes a JS↔Unity bridge.
  **A BODY SITS ON ITS OWN CLIPS; POSING ONE IS THE FALLBACK** (2026-09-15). Every body the room ships — the three
  Quaternius "Animated Men/Women" bodies, `person.glb`, `person-f.glb` and the dealer's `person-tux.glb` — carries a
  real sit-down, seated idle and stand-up authored on its own rig, so the room plays them and touches no bone:
  measured live, the pelvis lands at 0.464 against a cushion top of 0.493 and the feet at 0.019. `AvatarLibrary.
  NATIVE_SEAT` says which file sits natively, because that is the one fact the loader cannot measure; `SEAT_POSE` +
  `applySeat` (seven angles and a hip drop, eased) stay for a body that has no seated clip. Posing a body that HAD
  its own sit put her arms out and her back tipped.
  **AN OUTFIT IS A MATERIAL, NOT A REPAINTED TEXTURE.** `dress()` clones only the GARMENT materials (shirt, top,
  dress, jacket…) and tints them with the person's outfit word; skin, hair, eyes and shoes stay as the artist
  authored them. Repainting every material with the old 32×32 palette is what left a textured woman looking
  undressed. The palette path remains for a body whose UVs point at a swatch.
  **THE ROOM'S MATERIALS ARE MADE PER APPLICATION, NEVER ONCE FOR THE MODULE** (2026-09-15). A `StandardMaterial`
  keeps the shader variants it compiled against the device that compiled them, and the room is destroyed and rebuilt
  every time somebody comes back from the flat board — so module-level materials drew the chairs with a dead
  device's shaders and nothing appeared, until a hover CLONED one and the clone compiled fresh ("the chairs show
  when I hover over them"). Every one is a `let`, reassigned in the app effect. The angles are TUNED AGAINST MEASUREMENTS (`scratch/seatsweep.cjs` sweeps them while
  reading hip, knee and foot heights back), because a thigh's rotation changes what the shin's own axis means:
  MORE shin fold RAISES the foot, which no amount of reasoning from a standing body would have told you.
  A BODY'S OWN CLIPS BEAT ANY RETARGET: the shipping body uses its native `Idle` and `Walk`, renamed into the
  room's vocabulary, and only the clips it lacks (the seated set, the gestures) are retargeted at all.
  **RETARGETING A CLIP LIBRARY ONTO A FOREIGN RIG IS NOT A NAME-MAPPED COPY** (scratch `ubc/retarget.mjs`): the
  two rigs hold their bones in rest frames up to 158° apart (`restcmp.py` measures it), so what carries across is
  the bone's motion away from ITS OWN rest, re-based globally — `Gt = Gs·Gs_rest⁻¹·Gt_rest`, then back to a local
  rotation parents-first. Both skeletons are read in ARMATURE space (from the root bone, ignoring the armature
  node). The hips' travel scales by the two BODIES' measured heights — bone rest positions lie when a rig is
  authored tiny under a scaled armature node (a hip-to-foot of 0.0001 threw the body skyward). And `prune()`
  before a texture is attached throws away the mesh's UVs.
  **FIDELITY IS ASSETS AND LIGHT, NOT A NEW ENGINE** (`docs/FIDELITY.md`, 2026-09-15): the room's ambient comes
  from an IMAGE (a 131 KB HDRI prefiltered into the env atlas at load), the camera tone-maps, the floor and walls are
  photographed scans with normals, and the room has a ceiling — the flat ambient over a green void is what made every
  body and chair read as a toy. The order that reads as better: light → one authored lounge glTF with baked lightmaps →
  one body family with its own sit and walk → the huddle's faces on heads → outfits. Never gender in anybody's
  records: a figure is a LOOK the person chooses (`cardroom.look`, not yet written); `ESTATE_FIGURES` is the fixture.
  A FIGURE IS A BODY FILE, AND NEVER A FACT ABOUT A PERSON: `Figure` is `'m' | 'f' | 'tux'` over
  `FIGURE_FILE`, and a fourth body is one entry there plus one line in `ESTATE_FIGURES`. Bone alias lists carry the
  `Name.L`/`Name.R` convention beside Mixamo's and UE's, and `check-body.mjs` measures height through the FULL node
  transforms — these rigs are authored Z-up under an armature turned −90° about X, so scaling by the Y scale alone
  measured a 1.78 m person at 0.37. KIT FURNITURE IS STAINED, NOT REPLACED (`RoomKit.place(…, stain)`): the stain
  MULTIPLIES each material so a piece keeps its own light and shade and only the timber changes; replacing the
  material flattens the piece to one colour, and leaving the kit pale beige beside walnut chairs reads as furniture
  wheeled in from another room.
  Presence, the `scene.*` skills and the Mystery Night's cues all speak that vocabulary; the block `Figure` is
  gone. Traps: a container's animation ASSETS are named `<file>/animation/<i>` — the clip's name is on the TRACK
  (`asset.resource.name`); a state assigned no track plays a placeholder of duration `MAX_VALUE` and the body
  stands in a T-pose. Playwright's fake camera is `--use-fake-device-for-media-stream` (not `-capture`).
  Walk: scratch `body-walk.cjs` (standing, walking, seen by another, seated, seen seated; `window.__lounge`).
  THE CHAIR YOU ARE TAKING LIGHTS UP (gold, `chairLit`, its materials swapped and restored) from the moment it is
  chosen until you are in it, and the scene says "Taking seat N — dealing you in…" over itself: walking across a
  room and then waiting a second for the board reads as "it did not work" when nothing answers the click.
  ARRIVING SHOWS THE ROOM, NOT THE FLOOR: the walking camera sits just over the shoulder at head height (2.35 m,
  3.6 m back) and looks ACROSS the room rather than down at the body, which at 4.2 m up it did.
  **WALKING UP TO A CHAIR IS HOW YOU SIT** (`lib/roomSeat.ts`, `RoomPage.onSitRequest`, scratch `sit-walk.cjs`): a
  click near a free chair, or its "Sit at N" button, walks the body there; on arrival the page VISITS THE TABLE'S
  SOCKET — `join` with the practice stack, wait for `seat-joined`, close — and re-reads the room so the body sits.
  Play-money tables only; a money seat stays a button on the flat board. "Stand up" is the same visit with `leave`.
  A seat outlives the socket that took it (a socket is a tab), which is exactly what lets the room take one.
  **THE FELT IN THE ROOM IS THE VIEW, PROJECTED** (step 5, scratch `felt-walk.cjs`): seated at a hold'em table,
  `RoomPage` holds the table's socket beside the room's and the lounge lays `view` on the felt as `card`/`pot`
  plates (the flat board's `Card` art, sized by depth); the HUD is your two cards and the flat `ActionBar`. TRAP:
  `useRef(expr)` evaluates `expr` EVERY render — a WebGL probe written that way opened a context per render, and
  once the seated table's clock re-rendered the page twice a second the browser lost the lounge's context ("too
  many active WebGL contexts"). Probes go in a `useState` initializer, and release their context.
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
  host and the moment — for the house's own personas too, since 2026-09-13: the agent worker ADMITS ONLY THE
  HOUSE (`apps/agent-worker/src/admission.ts`, the house service agent on a session wire), so an unsigned
  `poker.act` gets 401 and a bot never moves. EVERY A2A call site signs (`callAct` was the one that did not,
  and every practice table sat at "toAct 3" until it did); a failed wire check is never memoised.
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
- `pnpm gen:commission` (compiles `~/skills/ontology/kettlewater.ttl` into the commission's world; `pnpm gen:story` is the mystery's)
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
