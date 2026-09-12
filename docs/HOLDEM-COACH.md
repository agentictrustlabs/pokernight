# Hold'em coach — how advice sits in the Texas Hold'em flow

Status: as-built, 2026-09-11; updated 2026-09-12 for the coach service. Companion to `docs/DESIGN.md` §6
and `docs/GAMES.md`. **Read `docs/ARCHITECTURE-ADVISER.md` first** — since 2026-09-12 the person's own
agent CONSULTS a coaching service (`bob-coach.svc`) under a study grant and generates nothing itself, a
finished hand is RECORDED (`poker.record`) to the person's agent rather than reviewed, and a REVIEW
(`poker.review`) is the person's own question, forwarded to the coach. Where this document says the
person's agent "reasons" mid-hand, read: forwards to the coach, which reasons over her records.

A person at a Hold'em table can be playing **against** an agent, or being **advised by** one. Those
are different acts, different A2A skills, and different places the web app calls out. This document
is the map: where the browser talks to agent stuff, what happens on a real hand, where `SKILL.md`
playbooks sit, and which coach-specific artifacts tailor the advice.

The card room never holds a person's style. It asks, and it says whose answer it is showing.

## 1. Two jobs, three skills

| Job | A2A skill | Who calls | What comes back | Applied? |
|---|---|---|---|---|
| Take a seat's turn | `poker.act` | `PokerTableDO`, when that seat is an agent | `{ action, note? }` | yes — `game.parseAction` + `game.apply` |
| Say what **you** should do | `poker.advise` | `PokerTableDO`, when **you** asked and named an adviser | `{ say, because?, action? }` | no — `action` is a suggestion |
| Keep how the hand went | `poker.record` | `PokerTableDO`, after the hand, fire-and-forget, to the person's own agent only | nothing the table waits on | no |
| Review past hands | `poker.review` | `PokerTableDO`, when the person asks (`GET /tables/:id/review?q=`) | `{ say, because?, source? }` | no |

An agent may advertise any subset. The table reads the card and refuses the wrong job: an adviser
that only talks is never handed a seat; a mover that only acts is never named as somebody's coach.
That check is `hasActSkill` against the **named** skill, in `apps/tables/src/index.ts` (seating and
`POST /tables/:id/adviser`).

Canasta has the same three skills under `canasta.*`. The host picks by the table's stamped game.
Mixing them is refused, not guessed.

## 2. What is live on Hold'em today

The **wire and the table object already treat poker as a first-class advise/review game**. The
**board does not yet mount a coach**.

| Piece | Hold'em | Where |
|---|---|---|
| House personas advertise `poker.act` + `poker.advise` (neither record nor review — they keep nothing) | yes | `apps/agent-worker/src/card.ts` |
| Table asks `poker.act` when an agent seat is to act | yes | `table-do.ts` `startAgentTurn` |
| Table asks `poker.advise` when a seated person has named an adviser | yes | `table-do.ts` `askAdviser` |
| Table sends `poker.record` at hand end to each named adviser whose card advertises it | yes | `table-do.ts` `recordWithAdvisers` |
| Table forwards `poker.review` when the person asks; the panel offers "Review my hands" | yes | `table-do.ts` `/review`, `PokerCoach.tsx` |
| House fallback `TableGame.advise` | **no** — `pokerGame` does not declare it | `packages/engine/src/game.ts`; composed only onto canasta in `apps/tables/src/games.ts` |
| `GET /tables/:id/advice` with no named adviser | **404** `"this game has no coach"` | `table-do.ts:573-574` |
| Coach panel (`Tell me` / `Play for me`) | **canasta only** | `Coach.tsx` mounted from `CanastaPage`, not `TablePage` |
| Web `api.advice` / `setAdviser` | exist; poker board never calls them | `apps/web/src/lib/api.ts` |

So: a named personal adviser at a poker table works over HTTP today. A person who has named nobody
gets no house sentence, and the Hold'em screen has no button that asks. Canasta is the worked
example of the UI; Hold'em is the worked example of the playing-agent path.

## 3. App architecture — where the web app calls out

The browser talks to **one origin**: the tables Worker. It never opens a socket or an A2A call to
an agent host. Two different outbounds, for two different jobs:

```
                         people
                            |
                            v
                    +---------------+
                    |  apps/web     |  Vite + React
                    |  TablePage    |  Hold'em board -- socket + HTTP
                    |  CanastaPage  |  canasta board + Coach panel
                    +-------+-------+
           WebSocket        |         HTTP (session)
           welcome/turn/    |         GET  /tables/:id
           event/act        |         GET  /tables/:id/advice      <- coach ask
                            |         POST /tables/:id/adviser     <- name your agent
                            |         POST /tables/:id/agents      <- seat a house bot
                            |         GET  /agents?game=poker      <- proxy, not A2A
                            v
                    +---------------+
                    |  apps/tables  |  Cloudflare Worker
                    |  index.ts     |  session, club gate, skill check
                    |  PokerTableDO |  state as unknown; asks the game
                    +-------+-------+
           A2A SendMessage  |         (server to server; browser never sees this)
           poker.act        |  when an agent SEAT is to act
           poker.advise     |  when THIS person named an adviser and asked
           poker.review     |  when the hand ends (waitUntil, no reply used)
                            v
                    +---------------+
                    | agent-worker  |  house personas (sharkbot.svc, ...)
                    |  OR           |
                    | person's Home |  <label>.me -- their own card + playbook
                    +---------------+
```

The web call-outs, precisely:

1. **Play against a house bot.** `GET /agents?game=poker` (tables Worker proxies
   `AGENT_BASE_URL/agents`) then `POST /tables/:id/agents` with `{ seat, buyIn, agentName }`. The
   Worker fetches the card, demands `poker.act`, and the DO stores the A2A endpoint on that seat.
   After that the browser is out of it: turns go table → agent. The Hold'em board has **no fill-seats
   UI**; canasta's `FillSeats` is the one that presses this. Seating a poker bot is the HTTP API
   (see `apps/agent-worker/README.md`).

2. **Ask what I should do.** `GET /tables/:id/advice?q=…` from `api.advice`. Session + club + **your
   own seat**. The Worker forwards `playerId` so two people at one table cannot share an adviser.
   `Coach.tsx` is the only caller, and it only mounts on canasta. Same route is legal on a poker
   table if something calls it.

3. **Name my coach.** `POST /tables/:id/adviser` `{ agentName }`. Worker resolves the card, demands
   `poker.advise` (or `canasta.advise`), stamps `{ agentName, endpoint, displayName }` on the DO
   keyed by `playerId`. `DELETE` drops it. The Coach panel's folded "Advised by …" form is the only
   UI; again, canasta-only.

4. **Take my own turn.** WebSocket `{ type: "act", handNo, action }`. Not an agent call. In canasta
   `play` mode the Coach later **sends this itself** with the suggested action — that is the person
   acting, not the adviser taking a seat.

What the web app does **not** do:

- It does not fetch `/.well-known/agent-card.json`.
- It does not POST `/api/a2a`.
- It does not load or send `SKILL.md`. Those live on the agent's side.

## 4. Two layers both called "skill"

The estate keeps these apart (ADR-0050 in `~/agenticprimitives`). Mixing the words is how a
playbook gets treated as authority, or a card skill gets treated as style.

```
  ┌─────────────────────────────────────────────────────────────┐
  │  A2A AgentSkill  (on the card, executable)                  │
  │  poker.act / poker.advise / poker.review                    │
  │  The table MATCHES these. No card skill → refused.          │
  │  Lives in pokernight: protocol constants + agent-worker     │
  │  card.ts. The card room reaches no further.                 │
  └─────────────────────────────────────────────────────────────┘
                              ▲
                              │  SendMessage names the skill
                              │
  ┌─────────────────────────────────────────────────────────────┐
  │  SKILL.md playbooks  (guidance / archetype corpus)          │
  │  ~/skills/archetypes/holdem-adviser                         │
  │  ~/skills/skills/card-room/holdem-table-read                │
  │  plus a person's own style (and, for canasta, memory)       │
  │  Compiled into THAT agent's harness. The card room never    │
  │  reads these files and has nowhere to put them.             │
  └─────────────────────────────────────────────────────────────┘
```

House personas in `apps/agent-worker` do **not** load `SKILL.md`. Their advise path is
`createPokerAdviseExecutor` → `readHand` in `@pokernight/agent-kit` — price, position, stack-to-pot,
said in words. That is the reference shape of the wire, not a personal coach.

A person's own agent (`carol.me`) is where the playbooks run. Naming it as adviser is how the table
asks *that* harness. The style stays in their vault; `poker.review` is how a memory skill learns
how a decision turned out.

## 5. Hold'em SKILL.md artifacts — what exists, what tailors coaching

Corpus: `~/skills` (not this repo). Namespace `card-room`.

### 5.1 What a Hold'em coach can wear today

| Artifact | Kind | Capability | What it is for |
|---|---|---|---|
| `archetypes/holdem-adviser/SKILL.md` | archetype (craft) | — | How to advise one seat: price first, then outs, position, what the board already beats. Seat boundary is absolute. **Their style outranks this.** |
| `skills/card-room/holdem-table-read/SKILL.md` | capability skill | `cardroom.table.read` (R0) | A running **read**, never a bet. Answers "am I getting the right price", "what are my outs", "what can beat me". Refuses "what do the others have" (unknowable) and "raise to sixty" (that is `cardroom.table.act`). |

There is **no** `holdem-style` and **no** `holdem-memory` in the corpus yet. Canasta already has
both, and they are the pattern Hold'em should copy when somebody wants a coach that plays *their*
way and remembers across nights.

### 5.2 The canasta set, as the missing Hold'em pieces

| Artifact | Kind | Why a Hold'em coach would want the analogue |
|---|---|---|
| `archetypes/canasta-partner/SKILL.md` | craft | Partner play. Hold'em's craft file is `holdem-adviser` (advise, not sit). |
| `skills/card-room/canasta-table-read/SKILL.md` | `cardroom.table.read` | Twin of `holdem-table-read`. |
| `skills/card-room/canasta-style/SKILL.md` | `cardroom.style` | **This is how coaching is tailored.** Standing preferences ("never take a frozen pile") outrank the archetype. Edited after games. |
| `skills/card-room/canasta-memory/SKILL.md` | `cardroom.memory` | What to keep from `*.review`: questions in their own words, recurring mistakes, what they have since got right. Not a dossier on the table. Raised once per pattern per evening, never mid-clock unless it decides this turn. |
| `skills/card-room/canasta-partner-play/SKILL.md` | `cardroom.table.act` (R2, mandate) | Sit and move. Different job from advising. |

### 5.3 How to tailor a Hold'em coach

Three layers, same order as `holdem-adviser` itself states:

1. **Seat boundary** — their two cards and the board. Nobody else's. Not overridable.
2. **`holdem-adviser` + `holdem-table-read`** — the craft when nothing else has been said.
3. **Their style** — a `SKILL.md` they own, same shape as `canasta-style`: standing instructions
   with a cost ("I never call river bets out of position — I would rather miss a bluff-catch than
   pay off value"). Where craft and style disagree, style wins; say afterwards what it cost.

A fourth layer, when someone writes `holdem-memory` (or reuses `canasta-memory`: it is about one
person's play, not a game's rules): `poker.review` after each hand is the write. The card room
keeps no profile.

The house reference adviser cannot be tailored this way. It has no vault and no playbook. Tailoring
means **name your own agent** (`POST /adviser`) whose Home has compiled those skills.

## 6. What each side actually sees

Advice discloses nothing the seat does not already hold. The table sends `game.viewFor(state, seat)`
and `game.legalFor(state, seat)` — the same redacted `TableView` the socket already gave that
person: hole cards, board, stacks, pots, action so far. Not the deck, not anyone else's hole cards.

`readHand` (and `holdem-table-read`) are written to that constraint: a read of an opponent is
evidence ("raised early and bet twice") never knowledge ("they have ace-king").

## 7. Scenarios

### 7.1 Sharkbot takes a seat — not coaching

Alice opens a cash table, seats herself, and something seats `sharkbot.svc` on her left (HTTP
`POST /tables/:id/agents`, or an operator script). The hand deals. It is Sharkbot's turn.

```
Alice browser          tables Worker         PokerTableDO              sharkbot.svc
     │                      │                     │                         │
     │  WS act (her turn)   │                     │                         │
     │─────────────────────►│────────────────────►│  apply                  │
     │                      │                     │                         │
     │  event + view        │                     │                         │
     │◄─────────────────────│◄────────────────────│                         │
     │                      │                     │  toAct = sharkbot       │
     │                      │                     │  startAgentTurn         │
     │                      │                     │  poker.act + view/legal │
     │                      │                     │────────────────────────►│
     │                      │                     │  { action: call, note } │
     │                      │                     │◄────────────────────────│
     │                      │                     │  parse + apply          │
     │  event + view        │                     │                         │
     │◄─────────────────────│◄────────────────────│                         │
```

Pace: the table **requests immediately** and **applies after `AGENT_PACE_MS`** (default 2800), so
Alice sees the move, not a 200 ms snap. Clock is not charged for the think time of a house bot
beyond the deadline; a late reply loses to check-else-fold.

`SKILL.md` is not in this path. Sharkbot's `poker.act` is `decide()` from agent-kit (or Claude for
`deepthought.svc` / `bluffer.svc`).

### 7.2 Alice asks her own agent what to do — coaching

Alice has named `carol.me` at this table (`POST /adviser`). It is her turn on the flop: she holds
K♠ Q♠, board is J♠ T♠ 2♣, she faces 20 into a pot of 80.

```
Alice browser          tables Worker         PokerTableDO              carol.me
     │                      │                     │                         │
     │  GET /tables/t/advice?q=am+I+getting+the+price
     │─────────────────────►│                     │                         │
     │                      │  session + club     │                         │
     │                      │  seat == Alice      │                         │
     │                      │  GET /advice?seat=0&player=alice&q=…          │
     │                      │────────────────────►│                         │
     │                      │                     │  advisers[alice] = carol│
     │                      │                     │  viewFor(seat 0)        │
     │                      │                     │  poker.advise           │
     │                      │                     │  { view, legal,         │
     │                      │                     │    question: "am I…" }  │
     │                      │                     │────────────────────────►│
     │                      │                     │                         │  harness:
     │                      │                     │                         │  holdem-adviser
     │                      │                     │                         │  holdem-table-read
     │                      │                     │                         │  + her style
     │                      │                     │  { say, because }       │
     │                      │                     │◄────────────────────────│
     │  { say: "You are being asked 20 into 80 — about 20%.",
     │    because: "You asked: am I getting the price. …",
     │    source: { agent: "carol.me", displayName: "Carol" } }
     │◄─────────────────────│◄────────────────────│                         │
     │                      │                     │                         │
     │  WS act { type: call }   ← she decides, or a future Coach "Play for me" sends this
     │─────────────────────►│────────────────────►│  apply                  │
```

If `carol.me` is down, the DO tries `game.advise`. On Hold'em that is missing, so the person gets
**502** with the reach error, not a silent house sentence. Canasta falls back to the house coach
and **says so** (`source: "house"`, `note: "Carol could not be reached — …"`).

`question` is Alice's own words, passed through untouched. The table does not parse it. An adviser
that remembers is remembering questions as much as boards.

### 7.3 The hand ends — carol learns, the table does not wait

Showdown. Net chips are written (Hold'em is `staked: true`). Then:

```
PokerTableDO                         carol.me
     │                                    │
     │  waitUntil(                        │
     │    poker.review                    │
     │    view = seat 0's FINAL view      │
     │    including the result            │
     │  )                                 │
     │───────────────────────────────────►│
     │  (no await on the HTTP the table   │  holdem-memory / canasta-memory
     │   is about to send Alice)          │  writes what will make a LATER
     │                                    │  sentence better; keeps nothing
     │                                    │  about Bob's cards
```

Only Alice's adviser is told, and only Alice's seat view. Bob naming a different agent does not
see this hand as Alice saw it.

The house reference `createReviewExecutor` replies `{ noted: true }` and **keeps nothing**. It says
so. A personal coach that claimed to have remembered while writing nowhere would be the dishonest
version of the same call.

### 7.4 House coach on canasta — the UI Hold'em does not have yet

Same HTTP, no named adviser, game has `advise`:

```
CanastaPage / Coach          tables          PokerTableDO
     │  (mode watch|play)         │                │
     │  heartbeat: my turn,       │                │
     │  no advice yet             │                │
     │  GET /advice               │                │
     │───────────────────────────►│───────────────►│  game.advise(state, seat)
     │                            │                │  = chooseCanastaAction
     │                            │                │    + explainMove
     │  { say, because, action,   │                │
     │    source: "house" }       │                │
     │◄───────────────────────────│◄───────────────│
     │  watch: show + speak WHY   │                │
     │  play: countdown, then     │                │
     │  WS act with advice.action │                │
     │───────────────────────────►│───────────────►│
```

This is why canasta can teach with nobody named. Hold'em has `readHand` in agent-kit and
`createPokerAdviseExecutor` on every house persona — the **strategy exists** — but it is only
reached when someone is named as adviser (or when a client calls `/advice` after naming one).
Wiring `pokerGame` with an `advise` that calls `readHand`, and mounting a Hold'em-aware Coach on
`TablePage`, is what would make 7.4 work for cash-game Hold'em without a personal agent.

A Hold'em Coach must not import canasta types. `Coach.tsx` today is bound to `CanastaView` /
`CanastaTableEvent` (commentary, alerts, meld heartbeat). A second board gets a second panel, or
the panel is stripped to the HTTP + speech half that does not know a game.

### 7.5 Alice writes a style — tailoring, no card-room change

After a night she edits a skill on her Home, same ceremony as `canasta-style`:

```markdown
---
name: holdem-style
namespace: card-room
capability: cardroom.style
---
- Never call a river bet out of position unless I can beat top pair.
- 3-bet or fold from the blinds vs a late open; I do not want to float.
- Ask me before I put more than half my stack in on the flop.
```

Next `poker.advise` to `carol.me` is answered under that file. The table still sends the same
view. Nothing in pokernight is redeployed. That is the whole point of "the reasoning is
somewhere this card room never reaches."

## 8. Sequence inside one Hold'em hand (both jobs)

Alice in the big blind, Sharkbot on the button, Carol named as Alice's adviser. Coach UI imagined
as present (or Alice calling `/advice` herself).

```
  deal
    │
    ├─► preflop: Sharkbot to act ── poker.act ── raise
    │
    ├─► Alice's turn
    │     Coach / GET /advice
    │       └── named? ──yes── poker.advise ── carol.me (playbooks)
    │                 └──no─── game.advise? ── Hold'em: 404
    │     Alice (or play-mode) ── WS act ── call
    │
    ├─► flop / turn / river: same split
    │     agent seat  → poker.act     (applied)
    │     Alice asks  → poker.advise  (shown)
    │
    └─► showdown
          ledger rows (staked)
          poker.review → carol.me only, her seat's final view
          next-hand delay
```

## 9. Invariants the diagrams depend on

- **A coach sees only what the seat sees.** Enforced by sending `viewFor`, not raw state. Advice
  built on hidden cards teaches a game they cannot play alone.
- **Your seat only.** `/advice` 404s if you are watching. A coach that answered for the seat
  across the table would be a device for reading a hand.
- **Advising is not acting.** Separate skill ids; suggestion is never applied by the host.
- **Whose advice this is is always shown.** `source: "house"` or `{ agent, displayName }`.
- **Pause stops the coach.** `act` refused with `paused`; the canasta Coach stops asking and
  hushes speech. Same rule must hold if Hold'em mounts a panel — otherwise a "Play for me" coach
  keeps a paused table moving.
- **Packages name no hosts.** Endpoints and zones live in `apps/*` config.

## 10. Closing the Hold'em coach loop

Already there: protocol (`poker.advise` / `poker.review`), DO ask + review, agent-worker routing
and `readHand`, adviser naming + card check, `SKILL.md` craft + table-read, canasta as the UI
rehearsal.

Not there:

1. `advise` on `pokerGame` (or composed in `games.ts` like canasta) so an unnamed person gets a
   house sentence instead of 404.
2. A Hold'em Coach on `TablePage` that calls `api.advice` / `setAdviser` and does not import
   canasta.
3. `holdem-style` and `holdem-memory` in `~/skills`, so a personal agent has a documented place
   to put standing preferences and `poker.review` writes.
4. Fill-seats (or equivalent) on the Hold'em board if "sit a house bot" should be a person
   gesture rather than an HTTP call.

(1) and (2) are card-room work. (3) is corpus work and is how coaching is tailored. (4) is
orthogonal: it seats a *player*, not a coach.
