# Pokernight web app — inventory as built

This document is a factual account of every screen, panel, control, HTTP route, WebSocket message and
table mode that exists in the repository today, with a `path:line` for every claim so a reader can
check it. It is reference material for a navigation redesign; it describes what is there, not what
should be there, and where the code is genuinely ambiguous it says "unclear:" instead of guessing.

Read at commit `5ba803f` ("One coin, and a table that gets itself unstuck").

---

## 1. Routes and screens

Routing is **hash-only**, decided in one pure function: `apps/web/src/lib/routes.ts:28-40`.
`useHash` (`apps/web/src/lib/hooks.ts:16-25`) strips the leading `#`, so the router sees `/t/abc`,
not `#/t/abc`. There are four `Route` variants (`apps/web/src/lib/routes.ts:11-21`) and no server-side
routes in the client at all.

| URL | Parsed at | Renders | Reachable by |
|---|---|---|---|
| `#/` (signed out) | `routes.ts:39` → `{page:'home'}` | `Landing` — `App.tsx:362,384` | anyone, no session (`Landing.tsx:34`; its lobby strip calls `GET /tables` unauthenticated, `Landing.tsx:101`) |
| `#/` (signed in) | same | `Lobby` — `App.tsx:387` | any session |
| `#/signin` | `routes.ts:38` | `SignInPage` — `App.tsx:387` | signed out only; a signed-in visitor is bounced to `#/` (`App.tsx:331-333`) |
| `#/t/<tableId>` | `routes.ts:30-35` | `TableRoute` — `App.tsx:353-359` | anyone; the *table* decides. Pickup table = anyone incl. spectators; club table = 404 to a non-member (`apps/tables/src/index.ts:1161-1165`, `922-928`) |
| `#/t/<tableId>?practice=1` | `routes.ts:32-34` | same, with `practice` true → `CanastaPage practice` (`TableRoute.tsx:79`) | the practice flag is client-side only; the *server* gates practice actions on `practiceFor === session.playerId` (`index.ts:877-879, 897-899, 918`) |
| `#/join/<clubId>/<token>` | `routes.ts:36-37` | `JoinPage` — `App.tsx:335-351` | anyone holding the token; the greeting needs no session (`api.ts:247-248`, server `index.ts:692-697`) |
| anything else | `routes.ts:39` | falls through to `{page:'home'}` | — |

`#/t/<id>` fans out one more time, on the table's own `game` stamp, after one HTTP read
(`TableRoute.tsx:41-60`):

| Table's `game` | Screen | Line |
|---|---|---|
| `canasta` | `CanastaPage` | `TableRoute.tsx:79` |
| `poker` or absent | `TablePage` | `TableRoute.tsx:80` (`drawsGame`, `lib/games.ts:40-42`) |
| anything else | `OtherGame` — "no seat here yet" | `TableRoute.tsx:82-86`, `components/OtherGame.tsx` |
| table 404s | "That table is not here" | `TableRoute.tsx:62-76` |

### Screens that are not routes

- `Landing` in-page anchors: `#how` (`Landing.tsx:210`), `#live` (`:250`), `#signin` (`:45`). These do
  **not** hit the router (no leading `/`), so `route()` returns `{page:'home'}` and the landing page
  stays mounted — they behave as scroll anchors.
- `#stake` (`components/StartPanel.tsx:134`) and `#money` (`components/MoneyPanel.tsx:97`) are ids on
  panels, not routes. See §7 for what linking to `#stake` from a table actually does.

---

## 2. The signed-in lobby

`apps/web/src/pages/Lobby.tsx`. Layout is two columns: the table list on the left
(`Lobby.tsx:87`), and a side stack of four panels (`Lobby.tsx:88-109`) in this order.

One piece of state drives both columns: the selected club (`Lobby.tsx:42`), which is passed to both
`ClubsPanel` and the table list so they cannot disagree (`Lobby.tsx:35-41`).

| # | On screen | What it does | For whom | Where |
|---|---|---|---|---|
| — | **"Open tables"** / **"Tables at \<club\>"** | Polls `GET /tables` (or `?club=`) every 5 s (`Lobby.tsx:58-78`, `POLL_MS` `:17`); columns Table / Stakes / Seats / Buy-in (chips) / Hand / Settlement / Join | everyone | `Lobby.tsx:114-203` |
| 1 | **"Learn canasta"** → *Take me to my practice table* | `POST /practice` with game `canasta` hardcoded, then navigates to `#/t/<id>?practice=1` | any signed-in person | `components/PracticePanel.tsx:24-52`, game literal at `:40` |
| 2 | **"Your clubs"** | The whole club surface; see breakdown below | everyone, host controls gated | `components/ClubsPanel.tsx:70-103` |
| 3 | **"Get ready to play"** / **"Your money"** | One button running `POST /treasury/quick-start`, then the trip to the Home; shows balance and, when set up, a *Take a seat at \<table\>* link | any signed-in person on a deployment with a settlement asset | `components/StartPanel.tsx:133-227` |
| 4 | **"Open your own table"** / **"Open a table for this club"** (folded `<details>`) | `POST /tables` and navigate to it | shown to anyone; the server refuses a non-host for a club (`index.ts:823-825`) | `Lobby.tsx:105-108`, form `Lobby.tsx:205-334` |

### Panel 2, "Your clubs", in detail

| Control | Does | Actor | Where |
|---|---|---|---|
| Line: "You are in N clubs" | pure copy from `clubsLine` | everyone | `ClubsPanel.tsx:74`, `lib/clubs.ts:106-111` |
| **Open tables** pick | sets the selection to `null` (the public pickup lobby) | everyone — but only rendered when the person is in ≥1 club (`ClubsPanel.tsx:76`) | `ClubsPanel.tsx:78-83` |
| one button per club | `GET /clubs/:id`, sets the selection | member or host | `ClubsPanel.tsx:84-95` |
| Roster list, with `guest` / `host` tags | from `ClubView.roster` | member or host | `ClubsPanel.tsx:126-146` |
| **Remove** beside each member | `DELETE /clubs/:id/members/:member` | host only (`canInvite`, `ClubsPanel.tsx:119`; `lib/clubs.ts:17-19`) | `ClubsPanel.tsx:132-143` |
| **Charter it at your Home** | navigates to the Home charter ceremony | host, and only when `config.home.clubTemplate` is set (`lib/clubs.ts:142-152`) | `ClubsPanel.tsx:170-203` |
| "People you already play with: + \<name\>" | `GET /people`, then `POST /clubs/:id/members` per press | host | `ClubsPanel.tsx:329-389` |
| **Add someone** field + "What to call them" | one field, three roads: address/playerId/agent-name → `POST …/members`; email → `POST …/invites` | host | `ClubsPanel.tsx:265-297`, shape detection `lib/clubs.ts:50-58` |
| "Waiting to be opened" + **Take back** | `GET …/invites`, `DELETE …/invites/:token` | host | `ClubsPanel.tsx:398-439` |
| **Start a club** (folded `<details>`) | `POST /clubs` | any signed-in person | `ClubsPanel.tsx:443-481` |

### Panel 4, the create-table form

Fields (`Lobby.tsx:263-319`): Name; Game (`poker` \| `canasta`, from `BOARDS`, `lib/games.ts:27`);
and, poker only, Seats 2-9, Small blind, Big blind, Min buy-in, Max buy-in, Settlement
(`play-money` \| `mandate-transfer`). Canasta hides all five and is forced to `play-money`
(`Lobby.tsx:240`) because `canastaGame.staked` is false.

---

## 3. HTTP routes

Client view: `apps/web/src/lib/api.ts:159-330`. Server: `apps/tables/src/index.ts`.
Gate abbreviations: **session** = `resolveSession` non-null; **member/host** = `requireStanding`
(`index.ts:466-473`); **club-gate** = `clubGate`, which is a no-op on a pickup table and a 404 to a
non-member on a club table (`index.ts:478-486`); **operator** = `x-operator-token`
(`index.ts:1039-1041`, `apps/tables/src/operator.ts:31`).

| Method | Path | Does | Gate | Server | Client |
|---|---|---|---|---|---|
| GET | `/health` | liveness + chain id | none | `index.ts:115` | **never called** |
| GET | `/auth/config` | which sign-in doors, buy-in caps, club template | none | `index.ts:122` | `api.authConfig` `api.ts:160` |
| POST | `/auth/home` | finish Home OIDC → session | none (proof is the code) | `index.ts:181` | `api.homeLogin` `:161` |
| POST | `/auth/home/demo` | finish Home quick-connect → session | none | `index.ts:212` | `api.demoLogin` `:162` |
| POST | `/auth/home/mandate` | record the buy-in mandate ceremony | session | `index.ts:288` | `api.homeMandate` `:182` |
| POST | `/auth/signout` | stand up every seat, drop the session record | session | `index.ts:339` | `api.signOut` `:172` |
| POST | `/dev/session` | mint a play-money session by name | `DEV_AUTH=true` only | `index.ts:411` | `api.devLogin` `:184` (only from `SignInPanel.tsx:215`, itself gated on `config.devAuth`, `SignInPanel.tsx:104`) |
| POST | `/clubs` | start a club; caller becomes host | session | `index.ts:499` | `api.createClub` `:195` |
| GET | `/clubs` | the clubs you are in | session | `index.ts:519` | `api.listClubs` `:198` |
| GET | `/clubs/:clubId` | one club + roster + your standing | member (404 otherwise) | `index.ts:526` | `api.getClub` `:206` |
| POST | `/clubs/:clubId/charter` | record the club's chartered agent | host + ceremony matches session | `index.ts:543` | `api.charterClub` `:303` |
| GET | `/clubs/:clubId/members` | the roster | member | `index.ts:572` | **never called** — the client reads the roster off `GET /clubs/:clubId` instead |
| POST | `/clubs/:clubId/members` | add by address / playerId / agent name | host | `index.ts:581` | `api.inviteMember` `:214` |
| DELETE | `/clubs/:clubId/members/:member` | remove | host | `index.ts:754` | `api.removeMember` `:305` |
| POST | `/clubs/:clubId/invites` | open an email invitation, ask the Home to mail it | host | `index.ts:624` | `api.inviteByEmail` `:227` |
| GET | `/clubs/:clubId/invites` | invitations, spent and unspent | host | `index.ts:670` | `api.listInvites` `:234` |
| DELETE | `/clubs/:clubId/invites/:token` | take one back | host | `index.ts:676` | `api.revokeInvite` `:237` |
| GET | `/clubs/:clubId/invite/:token` | the greeting shown before sign-in | **none** | `index.ts:692` | `api.inviteGreeting` `:247` |
| POST | `/clubs/:clubId/invite/:token/claim` | spend it, keyed to whoever signed in | session | `index.ts:705` | `api.claimInvite` `:250` |
| GET | `/people` | everyone on the roster of any club of yours | session | `index.ts:732` | `api.knownPeople` `:295` |
| GET | `/agents` | agents this room can seat, narrowed by `?game=` | none (proxy; empty list on failure, `index.ts:784-788`) | `index.ts:774` | `api.listAgents` `:290` |
| GET | `/tables` | pickup lobby, or `?club=`'s own | none for pickup; member for a club | `index.ts:793` | `api.listTables` `:187` |
| POST | `/tables` | open one | session; **host** when `club` is set | `index.ts:813` | `api.createTable` `:189` |
| POST | `/practice` | your one practice table for a game | session | `index.ts:848` | `api.practiceTable` `:262` |
| POST | `/tables/:id/pause` | hold clock, agents and next round | session + `practiceFor === you` | `index.ts:871` | `api.setPaused` `:265` |
| POST | `/tables/:id/pace` | agent move delay | session + `practiceFor === you` | `index.ts:891` | `api.setPace` `:268` |
| POST | `/tables/:id/reset` | deal again, keep the seats | session + `practiceFor === you` | `index.ts:909` | `api.resetPractice` `:271` |
| GET | `/tables/:id` | spectator view + name + settlement + rate + game | club-gate | `index.ts:922` | `api.getTable` `:307` |
| GET | `/tables/:id/advice` | what to play in **your** seat | session + club-gate + seated | `index.ts:941` | `api.advice` `:282` |
| GET | `/tables/:id/hands/:handNo` | stored hand record (seed reveal, actions) | club-gate | `index.ts:958` | **never called** — no client method exists; the seed reveal on screen comes off the socket (`components/SeedCommit.tsx` via `StatusBar.tsx:47`) |
| POST | `/tables/:id/seat-agent` | seat an A2A agent | session + club-gate | `index.ts:974` | `api.seatAgent` `:292` |
| DELETE | `/tables/:id/seat-agent/:seat` | stand an agent up and cash it out | session only — **no club-gate, no seat ownership check** | `index.ts:1071-1077` | **never called** |
| DELETE | `/tables/:id/seat/:seat` | clear an abandoned seat | operator + three DO-side conditions | `index.ts:1036` | **never called** |
| DELETE | `/tables/:id` | retire a table nobody sits at | operator | `index.ts:1059` | **never called** |
| GET | `/tables/:id/settlement` | your money rows at this table | session (scoped to caller, `index.ts:1151`) | `index.ts:1148` | `api.getTableSettlement` `:328` |
| GET | `/treasury` | chosen treasury, balance, candidates, mandate | session | `index.ts:1083` | `api.getTreasury` `:310` |
| POST | `/treasury/quick-start` | treasury + stake + authority in one | session | `index.ts:1096` | `api.quickStart` `:313` |
| POST | `/treasury/select` | choose which treasury funds play | session | `index.ts:1102` | `api.selectTreasury` `:315` |
| POST | `/treasury/create` | charter one | session | `index.ts:1114` | `api.createTreasury` `:318` |
| POST | `/treasury/mandate` | sign / record the buy-in mandate | session | `index.ts:1127` | `api.signMandate` `:322` |
| POST | `/treasury/fund` | mint test asset | session + `isTestAsset` | `index.ts:1135` | `api.fundTreasury` `:325` |
| GET | `/tables/:id/ws` | WebSocket | none for pickup (spectator allowed); member for a club (404 otherwise) | `index.ts:1155` | `tableSocketUrl` `api.ts:333-341` |

**Totals: 42 server routes; 35 client methods.**

- **Server routes the client never calls (6):** `/health`, `GET /clubs/:clubId/members`,
  `GET /tables/:id/hands/:handNo`, `DELETE /tables/:id/seat-agent/:seat`,
  `DELETE /tables/:id/seat/:seat`, `DELETE /tables/:id`. The last three are the only way to unstick a
  table or clear a seat, and two of them need a token no browser has.
- **Client calls with no server route:** none. Every `api.*` path matches a hono route.
- The four `treasury/*` write routes are only reachable from the folded "Show the details" disclosure
  (`StartPanel.tsx:223-226` → `components/TreasuryPanel.tsx:75,84,94,103`); the default path is
  `quick-start`.

---

## 4. WebSocket

Schemas: `packages/protocol/src/index.ts`. Handling: `apps/tables/src/table-do.ts`.
Admission is decided in the Worker before the socket exists (`index.ts:1155-1172`); the DO reads
`x-player-id` / `x-player-name` at `table-do.ts:892-894`, so "spectator" means a socket with no
`x-player-id`.

### Client commands — `ClientCommandSchema` (`protocol/src/index.ts:467-478`)

There are no per-game commands. Only `act.action` is the game's, and it crosses as `unknown`.

| `type` | Fields | Does | Handler | Who | Enforced at |
|---|---|---|---|---|---|
| `ping` | — (`:476`) | replies `pong` | `table-do.ts:941` | any connection, spectators included | answered *before* the auth gate (`table-do.ts:944`); the `case 'ping'` at `:1199` is unreachable |
| `join` | `seat` 0-8, `buyIn` (`:468`) | authorise buy-in, seat, settle, emit `seat-joined` | `table-do.ts:1080-1112` | any session | session `:944`; seat/duplicate/range refused by the engine (`packages/engine/src/table.ts:142,144,147`) and surfaced by `ruleRefusal` `:952` |
| `leave` | — (`:469`) | cash-out row + outbox op + `seat-left` | `:1113-1119` → `standUpSeat` `:1287` | seated, own seat | `:944`, `:1114` (seat derived from `playerId`, never from the frame) |
| `sit-out` | — (`:470`) | `game.sitOut`, reason `requested` | `:1120-1131` | seated, own seat | `:1122` |
| `sit-in` | — (`:471`) | `game.sitIn` | `:1120-1131` | seated, own seat | `:1122` |
| `add-chips` | `amount` (`:472`) | authorise, `addStake`, auto-`sitIn` when broke and sitting out (`:1151-1157`) | `:1132-1171` | seated, own seat | `:1133`, settlement `:1145` |
| `act` | `handNo`, `action: unknown` (`:474`) | game parses and judges, then commit | `:1172-1193` | seated, on the clock | `:1173` seated, `:1178` paused, `:1183` no-hand, `:1184` stale-hand, `:1188` malformed, `:1190` illegal |
| `chat` | `text` 1-280 (`:475`) | broadcast to every socket | `:1194-1198` | **any session — a seat is not required**; no rate limit, not persisted | `:944` only |

**No owner or host command exists on the socket.** Pause, pace, reset, seat/unseat agent, operator
clear and retire are all HTTP (`table-do.ts:533,541,553,557,561,569,577,580`).

### Server messages — `ServerMessage` (`protocol/src/index.ts:555-577`)

All six leave through one typed helper, `send` (`table-do.ts:2426-2432`).

| `type` | Fields | Sent |
|---|---|---|
| `welcome` | `tableId`, `game?`, `playerId\|null`, `view`, `names`, `players?` (`:564`) | first frame of every socket, `table-do.ts:916-927` |
| `snapshot` | `view`, `names`, `players?` (`:565`) | only pause/resume `:657-664` and practice reset `:721-728`. **No client command produces one** |
| `event` | `event: TableEvent`, `view` (`:567`) | host events `:1986`; redacted game events `:1997` |
| `turn` | `handNo`, `seat`, `legal`, `deadline` (`:575`) | `:2013-2016`, only to the socket whose seat matches (`:2015`); an `a2a` seat is diverted to the A2A call (`:2006-2010`) |
| `error` | `code`, `message` (`:576`) | `sendError` `:2454`; call sites `932,937,940,944,953,955,1091,1145,1178,1183,1184,1188,1190` |
| `pong` | `at` (`:577`) | `:941` |

`PokerServerMessage` (`:594-600`) and `CanastaServerMessage` (`:628-635`) are the same six with the
`unknown`s narrowed — that is the per-game binding a client narrows against at its own socket boundary.

### Gaps

- No command in the schema goes unhandled; the switch at `table-do.ts:1079-1201` is exhaustive.
- `error.code` is typed `string` on the wire (`protocol:576`) but `WS_ERROR_CODES` (`:653-672`) reads
  like an enumeration. `ruleRefusal` (`table-do.ts:2447-2452`) forwards any code matching
  `/^[a-z][a-z0-9-]{1,31}$/` off an `Error`, so codes not in that list reach clients — poker's
  `hand-in-progress` / `not-enough-players` (`packages/engine/src/table.ts:343,346`) and canasta's
  `illegal-meld`, `draw-first`, `black-threes`, … (`packages/canasta/src/table.ts:87-514`).
- `not-your-turn` (`protocol:665`) is **never emitted**: an out-of-turn `act` arrives as
  `illegal-action` because `pokerGame.apply` converts the engine throw into a refusal
  (`packages/engine/src/game.ts:91-98`).
- Dead code in the host: `isLegalAction` (`table-do.ts:2398-2415`) has no call site;
  `LegalActionsSchema` (`protocol:35`) and `TableConfigPatchSchema` (`protocol:56`) have no callers
  anywhere in the repo.

### The game-agnostic boundary

Crossing as `unknown`: `GamePayload` (`protocol:93-94`), `act.action` (`:474`), `welcome.view`
(`:564`), `snapshot.view` (`:565`), `event.event` (`:567`, via open `GameEvent` `:524-527`),
`turn.legal` (`:575`), `CreateTableRequest.config` (`:283`), `TableSummary.gameConfig` (`:333`), and
the A2A envelope's `view`/`legal`/`action` (`:699-700,707`). The DO holds state as `unknown`
(`table-do.ts:401`) and reads it only through `snap()` (`:803-805`); three named casts back to poker's
wire types are isolated at `wireView` / `wireLegal` / `wireEvents` (`table-do.ts:815-825`).

---

## 5. The modes a table can be in

| Mode | Values | Decided | Stamped | What says so on screen |
|---|---|---|---|---|
| **Settlement** | `play-money` \| `mandate-transfer` | the create form (`Lobby.tsx:214,240,314-319`); server takes it as given (`index.ts:816`) | `TableMeta.settlement` at `init`, `table-do.ts:762`; never re-read | `SettlementTag` badge — lobby row (`Lobby.tsx:178`), landing row (`Landing.tsx:316`), table topbar (`TablePage.tsx:160`), above the buy-in box (`Table.tsx:444`), every open seat (`Table.tsx:425`). Copy from `describeMode`, `lib/money.ts:164-181` |
| **Chip rate** | `chipValue` + `assetSymbol` | `CHIP_VALUE` / `ASSET` at the moment of creation (`table-do.ts:754-758`) | `TableMeta.chipValue` / `.asset` / `.assetSymbol`, `table-do.ts:764-766`. Pre-pin tables get `LEGACY_CHIP_VALUE` stamped on first load (`table-do.ts:434-438`) | the rate beside the badge when `withRate` is set (`SettlementTag.tsx:26`), and the second line under every chip figure (`dualAmount`, e.g. `Lobby.tsx:170-174`) |
| **Game** | `poker` \| `canasta` (registry, `apps/tables/src/games.ts:47`) | the create form (`Lobby.tsx:213`), or `POST /practice` (canasta default, `index.ts:852`) | `TableMeta.game`, always written incl. the default (`table-do.ts:771`); resolved once on load (`:426`) | which page mounts (`TableRoute.tsx:79-86`); the `canasta` tag in the topbar (`CanastaPage.tsx:198`); the Stakes column falls back to the game's name (`Lobby.tsx:161`, `lib/lobby.ts` `stakeLabel`) |
| **Club vs pickup** | a club id, or absent | `POST /tables` body `club`; host verified server-side (`index.ts:820-828`) | `TableMeta.club` / `.clubName`, `table-do.ts:767-768`; and the table lives in that club's own `LobbyDO` (`lobby-do.ts:6-8`) | **only indirectly.** The lobby heading says "Tables at \<club\>" (`Lobby.tsx:118`) — but the *table page itself* prints no club name anywhere. `TablePage.tsx:152-169` and `CanastaPage.tsx:192-207` show name, settlement, hand no.; not the club |
| **Practice vs ordinary** | `practiceFor` set, or not | `POST /practice` → `ensurePracticeTable` (`practice.ts:57-86`); id derived from `sha256(playerId+game)` (`:38-42`); never in any lobby (`:16-19`) | `TableMeta.practiceFor`, `table-do.ts:772` | the "Your practice table" panel, but **only when the URL carries `?practice=1`** (`CanastaPage.tsx:269`). See §7 |
| **Paused** | `pausedAt` present, or not | `POST /tables/:id/pause`, practice tables only (`index.ts:871-888`, DO refuses others `table-do.ts:535`) | `TableMeta.pausedAt`, `table-do.ts:631` | the ⏸/▶ button's own label (`CanastaPage.tsx:292`) and the coach's line "Paused. Nothing moves until you carry on." (`Coach.tsx:373`). Client state is optimistic and reverts on failure (`CanastaPage.tsx:284-289`) |
| **Coach** | `off` \| `watch` ("Tell me") \| `play` ("Play for me") | three buttons, `Coach.tsx:337-361`; type at `Coach.tsx:27` | **not stamped anywhere** — client React state only (`Coach.tsx:96`), reset on every mount. Default is `off`, except a practice table which starts at `play` (`CanastaPage.tsx:258`) | the panel heading changes with the mode — "Playing your hand" / "Telling you what to do" / "Teach me" (`Coach.tsx:334`), plus an "on" pip (`:335`) |

Notes tying these together:

- Only poker can be opened in money. Canasta is forced to `play-money` client-side (`Lobby.tsx:240`)
  because `canastaGame.staked` is false; the DO gates the money paths on `staked`, not on the game id
  (`table-do.ts:1014,1941`).
- Only canasta has a coach. `advise` is optional on the port (`packages/table-game/src/index.ts:182`),
  is composed onto canasta in the app (`apps/tables/src/games.ts:33-44`), and `pokerGame` does not
  implement it — so `GET /tables/:id/advice` answers 404 "this game has no coach"
  (`table-do.ts:515`) at a poker table. The `Coach` panel is correspondingly only mounted on
  `CanastaPage` (`CanastaPage.tsx:242-261`).
- The mandate-currency safety check compares `SessionDO.mandateAsset` against the table's own asset
  stamp (`table-do.ts:2111-2126`). With one coin it should never fire.
- Practice tables are the only tables anything can pause, pace or reset. Every other table has **no**
  operator surface reachable from a browser (see §3).

---

## 6. What the docs promise that the code does not do

One line per promise. "NOT BUILT" means the identifier appears nowhere in `apps/` or `packages/` —
checked by grep — and the citation names the file it would have lived in.

The code says the same thing in three places: `apps/web/src/components/ClubsPanel.tsx:13` ("The
schedule, the invitations and the season come next"), `packages/protocol/src/index.ts:107` ("(later)
the schedule and season"), and `apps/tables/src/club-do.ts:356-359`, which says removal would cascade
into "outstanding answers, held seats, pending invitations" that "do not exist yet". `WORKSPACES.md`
§19 (`:1309-1320`) lists what Phase A actually shipped and it is membership only.

### WORKSPACES §7 — nights and the schedule

| Doc | Promise | State | Proof |
|---|---|---|---|
| §7.1 `:344-366` | `ClubScheduleV1`, ≤1 active per club | NOT BUILT | would live in the protocol clubs block, `packages/protocol/src/index.ts:103-260`; `ClubSchedule` → 0 hits |
| §7.1 `:371-377` | `NightStatus` (scheduled/open/playing/finished/cancelled/skipped) | NOT BUILT | same block; `NightStatus` → 0 hits |
| §7.1 `:379-406` | `NightV1` — pinned `startsAt`, `startLocal`+`timezone`, `seatCap`, `tableId`, `seasonId` | NOT BUILT | `NightV1`, `startLocal`, `seatCap`, `seasonId` → 0 hits; every "night" in the code is prose |
| §7.1 (via §10.1) | Nights and schedule mirrored in `ClubDO` | NOT BUILT | `apps/tables/src/club-do.ts:124-155` creates exactly three tables: `club`, `members`, `invites` |
| §7.1 `:408-412` | Editing a schedule touches only future unanswered nights; a moved answered night re-notifies | NOT BUILT | `apps/tables/src/club-do.ts:159-226` is the DO's whole surface |
| §7.2 `:420-430` | `Recurrence` union `once`/`weekly`/`monthly-nth`, weekly taking `weekdays[]` | NOT BUILT | `Recurrence`, `Weekday`, `monthly-nth` → 0 hits |
| §7.2 `:434` | Unsupported recurrence refused **by name** at the API | NOT BUILT | no schedule route exists; the club routes are `apps/tables/src/index.ts:499,519,526,543,572,581,624,670,676,692,705,754` |
| §7.3 `:438-450` | Wall-clock storage, a pure local→instant converter in the protocol, DST property tests | NOT BUILT | `timezone` / `timeZone` / `Intl.` → 0 hits in `apps` and `packages`; `packages/protocol` has no test directory |
| §7.4 `:452-460` | `HORIZON_NIGHTS` materialiser, idempotent per `(scheduleId, localDate)` | NOT BUILT | `materialis`, `HORIZON` → 0 hits |
| §7.5 `:462-481` | One `ClubDO` alarm driving six deadlines (materialise, announce −72h, nudge −24h, open −15m, last call +20m, close) | NOT BUILT | `ClubDO` has **no** `alarm()`; its only entry point is `fetch` at `apps/tables/src/club-do.ts:159`. The pattern exists and works at the table: `apps/tables/src/table-do.ts:1679,1801` |

### WORKSPACES §8 — invitations, answers, headcount

| Doc | Promise | State | Proof |
|---|---|---|---|
| §8.1 `:489-499` | The invitation is a `MessageEnvelopeV1` into a member's vault inbox carrying an `ActionCardV1` | NOT BUILT | `MessageEnvelope`, `ActionCard`, `@agenticprimitives/fabric` → 0 hits. What ships is an emailed token link: `apps/tables/src/index.ts:624-667` |
| §8.2 `:505-518` | Four answers `in`/`out`/`maybe`/`waitlist`, changeable until the night opens | NOT BUILT | `waitlist`, `rsvp` → 0 hits; no answer schema in `packages/protocol/src/index.ts:103-260` |
| §8.2 `:514-516` | Automatic promotion of the first waitlisted member | NOT BUILT | as above |
| §8.3 `:520-535` | `GET /clubs/:club/nights/:nightId` with `answers` / `counts` / `you` / `silent` | NOT BUILT | no `/nights` route in `apps/tables/src/index.ts`; `headcount` → 0 hits |
| §8.4 `:537-562` | Reach a person with no Home: tokenised link, mailed by the host's own Home, `returnUrl` back to the club | **BUILT** | token `apps/tables/src/index.ts:631`, link `:611`, 14-day TTL `:607`; Home call with the host's bearer at `apps/tables/src/invite-mail.ts:57-67`; arrival `apps/web/src/lib/routes.ts:36-37` → `apps/web/src/pages/JoinPage.tsx:44,59` → `apps/tables/src/club-do.ts:413-465` |
| §8.4 `:541-545` | A newcomer gets an account, a treasury and ten thousand Sheqels in one action | **BUILT** | `apps/tables/src/routes-treasury.ts:978` (`SEED_AMOUNT = '10000'`), gated on `isTestAsset` (`apps/tables/src/treasury.ts:359`) at `routes-treasury.ts:1188` |
| §8.4 `:559-562` | Delivery reported honestly as `sent` \| `logged` \| `unavailable`, link handed back either way | **PARTIAL** | behaviour matches (`apps/tables/src/invite-mail.ts:23-26,76`; link always returned `index.ts:659`), but the third value is named `not-sent`, not `unavailable` — `apps/tables/src/index.ts:662`, `apps/web/src/lib/api.ts:228` |
| §8.5 `:564-582` | Capacity enforced at the answer; an `in` holds a seat until 15 m after open | NOT BUILT | `seatCap`, `waitlist` → 0 hits; no such column in `apps/tables/src/club-do.ts:124-155` |
| §8.6 `:584-594` | Per-answer outcome `played` / `no-show` / `excused` at close | NOT BUILT | `no-show`, `attendance` → 0 hits |
| §8.7 `:596-607` | Notification discipline (never message an `out`, nudge silent once, one host broadcast) | NOT BUILT | the only outbound message the card room makes is the invite mail, `apps/tables/src/invite-mail.ts:46-77` |

### WORKSPACES §9 — the season

| Doc | Promise | State | Proof |
|---|---|---|---|
| §9.1 `:619-633` | The per-hand ledger the season would read already exists | **BUILT** (pre-existing) | `apps/tables/src/table-do.ts:1945` writes a `hand-result` row per player per hand; `writeLedger` `:2235`; buy-in `:1101,1238`; cash-out `:1293-1297` |
| §9.1 `:630-632` | "Only a route that exposes it and a place to keep the total" | NOT BUILT | the one ledger reader is per-caller settlement, `apps/tables/src/index.ts:1148-1153`; the `club.standings` A2A skill promised at `WORKSPACES.md:894` is absent from `apps/tables/src/a2a.ts` |
| §9.2 `:658-666` | Ranking modes `net` / `average` / `nights` / `points` | NOT BUILT | `Season` → 0 hits. `ClubStanding` (`packages/protocol/src/index.ts:119`) is host/member/none, a different concept |
| §9.3 `:674-709` | `SeasonV1` with `bestOf`, `dropWorst`, `minNights`, frozen `finalStandings` | NOT BUILT | all five identifiers → 0 hits; the only "season" mentions are four comments |
| §9.4 `:710-715` | `NightV1.scores` so a night can opt out | NOT BUILT | no `NightV1`; the `scores` hits in the repo are canasta scoring |
| §9.5 `:717-731` | No prize pool, no debt graph, no settle-up | **held, vacuously** | settlement is per player at the moment it happens (`table-do.ts:1101,1238,1293-1297`); nothing pools or nets between players. The copy that promises it is `apps/web/src/pages/Landing.tsx:61-63` |

### MISSION §10 — build order

| Doc | Promise | State | Proof |
|---|---|---|---|
| step 1 `:261-263` (types `:156-166`) | `MissionProfile` + `MissionVisit`, guest-host capability bounded to one Night | NOT BUILT | both → 0 hits; would live in `packages/protocol/src/index.ts:103-260` |
| step 2 `:264-266` | A mission-night invitation card, and a lounge a person can be in without a seat | NOT BUILT | `lounge` → 0 hits; the only non-seated presence is spectating (`apps/tables/src/index.ts:1161-1165`) |
| step 3 `:267-268` | Grounded questions: a guide, an approved pack, citations, handoff on no answer | NOT BUILT | no guide/pack identifier anywhere |
| step 4 `:269` | `FollowConsent`, bounded and revocable, separate from membership | NOT BUILT | → 0 hits |
| step 5 `:270` | Giving as a handoff — `DonationIntent`, §7's five invariants, no treasury | NOT BUILT | `DonationIntent`, `donation` → 0 hits outside the landing copy at `apps/web/src/pages/Landing.tsx:61-63` |
| step 6 `:271-272` | `TournamentRun`: two tables, one registration, movement between them | NOT BUILT | → 0 hits; there is no registration concept (`packages/protocol/src/index.ts:266-348` is the whole table-creation surface) |

**Unbuilt promises: 27 of the 32 checked. Built: the email invitation path and the newcomer seed (WORKSPACES §8.4, one of its three clauses only partially), the per-hand ledger a season would read (§9.1), and the no-pool/no-settle-up invariant (§9.5), which holds because nothing pools in the first place.**

### What the marketing copy already promises for these

The landing page sells all of it as if it were there — `Landing.tsx:180-197` (`STEPS`): "Set the
night. Once or twice a week at a time that suits you"; "Invite a mission to host"; "Everybody gets
asked, the table opens itself on time, and the season keeps its own score" — and `Landing.tsx:201-206`
(`MISSION_ACTIONS`: Learn / Ask / Stay connected / Give). None of the five has an implementation.

- unclear: whether the Agentic Primitives repository already exports the `MessageEnvelopeV1` / `ActionCardV1` rail
  §8.1 depends on. Proved only that pokernight imports no `@agenticprimitives/fabric` package (0 hits
  across `apps` and `packages`, `package.json`s included). To settle it, read
  `@agenticprimitives/fabric`.

---

## 7. Dead ends and rough edges

Each of these is provable from the cited line; nothing here is inferred from behaviour I did not read.

### The worst one: `#stake` navigates away from the table

`Table.tsx:274` and `Table.tsx:476` and `MoneyPanel.tsx:112` render `<a href="#stake">`. `#stake` is
an element id on `StartPanel` (`StartPanel.tsx:134`). But clicking a plain anchor sets
`location.hash = '#stake'`, which fires `hashchange`; `useHash` (`hooks.ts:16-17`) hands the router
`'stake'`; `route()` matches none of `/t/…`, `/join/…`, `/signin` and falls through to
`{page:'home'}` (`routes.ts:30-39`). So the app **leaves the table entirely** and renders the lobby.
The socket is torn down (`TablePage.tsx:70-73`), and on a settled table the seat is treated as a
disconnect rather than a stand-up.

Worse, the link is redundant where it appears: on `TablePage` the `StartPanel` it points at is
rendered *in the same sidebar*, and the two conditions overlap almost exactly —
`settles && session && !ready` (`TablePage.tsx:182`) against `seatBlock(...) !== null`
(`Table.tsx:219`, `lib/treasury.ts:298-341`). A player who is one step short of a seat is offered a link whose only effect is to
throw away the table they were sitting at.

There is no test covering `route('stake')`; `apps/web/src/lib` has no `routes.test.ts`.

### Other dead ends

| What | Why it is a dead end | Where |
|---|---|---|
| The front page is unreachable once signed in | `showLanding = r.page === 'home' && !session` (`App.tsx:362`), and a signed-in visitor at `#/signin` is bounced to `#/` (`App.tsx:331-333`). So "How a night works", the mission explanation and the giving boundary — the whole product explanation — cannot be read by anyone who has an account | `App.tsx:331-333,362,387`; content at `Landing.tsx:180-238` |
| `SignInPage`'s "Read the front page" link lies to a signed-in reader | it points at `#/`, which renders the lobby for anyone with a session | `SignInPage.tsx:19` |
| Landing table rows are not links | the signed-out lobby strip prints table names as plain text, while the signed-in one links them (`Lobby.tsx:158`). Spectating is allowed by the server (`index.ts:1155-1172`, no session needed on a pickup table) and the poker board renders a spectator hint for `session == null` (`Table.tsx:525-529`) — so a visitor is shown a live table with no way to click into it | `Landing.tsx:314-333` vs `Lobby.tsx:158` |
| A practice table opened without `?practice=1` loses all its controls | pause, reset and pace are conditioned on the `practice` prop (`CanastaPage.tsx:269`), which comes only from the query string (`routes.ts:33`). Landing on `#/t/<practice-id>` without the query — a bookmark, a typed or copied link — gives a table the server still treats as yours (`index.ts:877,897,918`) but a screen with no way to reset or unpause it. Nothing on that screen says it is a practice table | `CanastaPage.tsx:269`, `routes.ts:32-34` |
| A table page never says which club it belongs to | `TableSummary.club`/`clubName` are read by `TableRoute` only to pick a board; neither table page renders them | `TablePage.tsx:83-88`, `CanastaPage.tsx:82-86` |

### Controls shown to people who cannot use them

| What | Where |
|---|---|
| **"Open a table for this club"** is rendered for any selected club, whatever the caller's standing. `lib/clubs.ts:22` exports `canOpenTable` for exactly this and **no component imports it** (only `noTablesLine` does, `clubs.ts:121`). A member presses it and gets a 403 from `index.ts:823-825` | `Lobby.tsx:105-108` |
| The empty-club line hardcodes `'member'`, so a **host** of a club with no tables is told "A host opens them" instead of "Open one below" | `Lobby.tsx:127`, string at `lib/clubs.ts:120-124` |
| The lobby's Settlement select offers `mandate-transfer` regardless of whether the person has a treasury or a mandate; nothing checks `stakeStage(treasury)` before offering it, so a table can be opened that its own creator cannot sit at | `Lobby.tsx:314-319` vs the gate at `lib/treasury.ts:298-341` |
| The chat box is rendered disabled with the placeholder "Log in to chat" and no link to do so | `components/LogPanel.tsx:64-75` |
| "Take a seat at \<table\>" after money set-up can point at a **canasta** table, where the money just configured is irrelevant: `pickSeat` prefers a settling table but falls back to `open[0]`, and `hasBoard` includes canasta | `Lobby.tsx:83,102`, `lib/lobby.ts:103-109`, `lib/games.ts:27` |

### Actions with no feedback

| Action | Failure handling | Where |
|---|---|---|
| Remove a member | `.catch(() => undefined)`, then re-read the roster. A refused removal looks identical to a successful one until the list comes back | `ClubsPanel.tsx:136-139` |
| Add a known person | `catch { /* … */ }` — comment says the roster is the record | `ClubsPanel.tsx:375-377` |
| Take back an invitation | `.catch(() => undefined)` | `ClubsPanel.tsx:428` |
| "Start a new game" at a practice table | `catch { /* the table says its own piece */ }` — but the DO's 409 for a non-practice table (`table-do.ts:683`) never reaches a screen | `CanastaPage.tsx:301-303` |
| Pause / carry on | reverts the toggle on failure and says nothing | `CanastaPage.tsx:284-289` |
| Reading the treasury in the lobby | `catch { /* the panel says its own piece */ }` — but `StartPanel` renders `stage === 'loading'` → "Reading your money…" forever when the read fails, because `treasury` stays `null` | `Lobby.tsx:50-52`, `StartPanel.tsx:178-179`, `lib/stake.ts` `stakeStage(null) === 'loading'` |
| A failed invitation claim | the error prints, but the page keeps saying "One moment…" underneath it and offers no link but the topbar brand | `JoinPage.tsx:128-130` |

### States with no explanation

- `<span className={`conn ${state.connection}`}>{state.connection}</span>` prints the raw connection
  state word in the topbar with no tooltip and no recovery control
  (`TablePage.tsx:166`, `CanastaPage.tsx:204`).
- `snapshot` frames arrive only from a pause/resume or a practice reset (`table-do.ts:657,721`); a
  table that has gone quiet for any other reason produces no message at all, and the client has no
  "ask again" affordance — the socket's own backoff reconnect is the only recovery (`lib/tableSocket.ts:328-372`).
- unclear: whether a *poker* table can end up in a state a player cannot leave. `Table.tsx` covers
  waiting-for-players (`:246`), waiting-to-be-dealt-in (`:253`) and sitting-out-with-no-chips
  (`:260-296`) with an explanation and a button each; whether the DO's load-time "one between-hands
  tick" repair (`table-do.ts:439-450`) closes the remaining case would need reading
  `table-do.ts` around the alarm scheduler and `settleBustedAgents`.
