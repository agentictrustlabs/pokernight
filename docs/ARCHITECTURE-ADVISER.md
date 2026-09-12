# How your own agent advises you at a hold'em table

*The whole journey, from a text file somebody wrote to a sentence on your screen — for anyone, technical or not.*

Status: as-built, 2026-09-12. The engineer's map of the same ground is `docs/HOLDEM-COACH.md`; the rules the code is held to are in `CLAUDE.md`. This document is the story with pictures.

---

## 0. The one-paragraph version

You sit at a hold'em table on **poker.faithnet.io**. When it is your turn, the card room works out the facts of your spot (the pot, what a call costs, your outs, your position), asks your own agent — the one that lives at your Home, **alice.me** — what you should do, and shows you the answer: one sentence, the reason, and a button for the move. Your agent answers from a **playbook** it carries: a handful of skill documents somebody wrote in plain English (how to read a hand, how to play the flop, the turn, the river), compiled into it once and kept in its own vault. After each hand the card room sends your agent what everybody did, as counts, so next hand it also remembers *"Sharkbot bets every flop he raises."* Nothing the agent says is ever played for you; you press the button or you don't.

---

## 1. The cast

```mermaid
flowchart LR
    subgraph People["People"]
        Alice["🧑 Alice<br/>the player"]
        Author["✍️ Skill author<br/>writes the playbook"]
    end
    subgraph Room["Poker Night — the card room<br/>(poker.faithnet.io · tables.faithnet.io)"]
        Screen["Screen<br/>the table, the coach panel"]
        Table["Table<br/>deals, keeps the hand, keeps score"]
        HouseCoach["House coach<br/>rules + solver charts · free"]
        Personas["House players<br/>Sharkbot, The Rock, …<br/>rules-based · free"]
    end
    subgraph Home["Alice's Home (faithnet.me)"]
        Agent["🤖 alice.me<br/>her own agent"]
        Vault["🔒 Vault<br/>her playbook · her memory"]
    end
    subgraph Skills["The skills estate (skills.faithnet.io)"]
        Repo["SKILL.md files<br/>in the ~/skills repo"]
        Corpus["Corpus<br/>published, versioned copies"]
        Registry["Registry (GraphDB)<br/>ontology · capabilities · archetypes"]
    end
    Author --> Repo --> Corpus --> Registry
    Registry -. "compiled playbook" .-> Vault
    Alice --> Screen --> Table
    Table <--> HouseCoach
    Table <--> Personas
    Table <-. "advice, over A2A" .-> Agent
    Agent <--> Vault
```

**In plain words.** There are three worlds. The **card room** deals the cards and runs the table. The **skills estate** is where the knowledge lives: text files an author writes, published as versioned artifacts, catalogued in a registry. **Alice's Home** is where her agent lives with its own private vault. The card room never holds Alice's playbook or memory — it *asks* her agent, and shows whose answer it is.

Three things can advise at a table, and Alice chooses which:

| Adviser | What it is | Costs |
|---|---|---|
| **House coach** (default) | A rules engine inside the card room, backed by solver charts | nothing |
| **A house player** (Sharkbot, The Rock, Deep Thought…) | The same rules engine, biased into a style | nothing |
| **Her own agent** (alice.me) | A language model at her Home, reasoning from her playbook and memory | her tokens — the panel says so before she picks it |

The house never spends tokens. The only language model in the room is a person's own, when they name it.

---

## 2. From a text file to your agent's playbook

*How a skill written by a person becomes something Alice's agent plays by.*

```mermaid
sequenceDiagram
    autonumber
    participant Author as Skill author
    participant Repo as ~/skills repo<br/>(SKILL.md files)
    participant Corpus as Corpus<br/>(skills.faithnet.io)
    participant Registry as Registry<br/>(GraphDB)
    participant Home as Alice's Home
    participant Vault as Alice's vault

    Author->>Repo: writes / edits<br/>holdem-table-read, -preflop, -flop, -turn, -river
    Author->>Corpus: publish (signed)<br/>each file becomes a versioned artifact<br/>with a fingerprint (sha-256)
    Author->>Registry: attach the skills to the<br/>person-steward archetype
    Note over Registry: The registry knows:<br/>capabilities (poker.advise, poker.review)<br/>skills (the five artifacts)<br/>archetypes (which skills an agent kind carries)
    Home->>Registry: "compile the person-steward playbook"
    Registry-->>Home: one document: every included skill's text,<br/>with a digest of what went in
    Home->>Vault: store it (archetype.assignment)
    Note over Vault: A snapshot. Editing a SKILL.md later<br/>changes the corpus and the website,<br/>not Alice's agent — until it is re-assigned.
```

**In plain words.** A skill is a short essay in a `SKILL.md` file — *"the price of a call is toCall ÷ (pot + toCall)… never fold when checking is free…"*. Publishing it makes a numbered, fingerprinted copy nobody can quietly change. The registry is the catalogue: it records that these five skills realise the **capabilities** `poker.advise` and `poker.review`, and that the **person-steward** archetype (the blueprint every person's own agent is built from) includes them. When Alice's Home *assigns* that archetype to her agent, the registry compiles all the included skills into one playbook and the Home stores it in her vault. From then on her agent plays by that copy.

Why a copy and not a live link? So that what her agent answered on Tuesday can be explained on Wednesday: the playbook is versioned and fingerprinted, like a signed contract. The cost is that a newly published skill only reaches her after re-assignment.

**The three words, defined once.**

- **Capability** — a thing an agent can do, by name: `poker.advise` (say what to do from a seat), `poker.review` (remember a finished hand), `poker.act` (take a turn — only the house players carry this; a coach is not a player).
- **Skill** — a `SKILL.md` document: the *how*. Five of them for hold'em: the shared craft of reading a hand, then one per street.
- **Archetype** — a blueprint for a kind of agent: which capabilities it has and which skills it carries. Alice's agent is a *person steward*; the hold'em skills are part of that one blueprint rather than a separate "poker agent", because a person holds one blueprint and swapping it would lose her payments and invitations for the length of a card game.

---

## 3. One hand: from the deal to the advice on your screen

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant Screen as Screen (coach panel)
    participant Table as Table (card room)
    participant Coach as House coach
    participant Home as Alice's Home (edge)
    participant Agent as alice.me<br/>playbook.answer
    participant Vault as Alice's vault

    Table->>Screen: deals — "your turn" (60-second clock)
    Screen->>Table: GET /advice — "what should I do?"
    Table->>Table: THE READ: pot, to call, what the price is for,<br/>price as a percentage, outs, position, chips behind, the hand so far
    Table->>Coach: what would the rules do here?
    Coach-->>Table: baseline: "call" · certain? · mixed?
    alt The solver is certain (saw the spot 50+ times, never disagreed)
        Table-->>Screen: the house's line, and why nobody else was asked
    else A real decision
        Table->>Home: poker.advise, signed AS THE HOUSE<br/>carrying: your seat's view, the legal moves,<br/>the read, the baseline, your question
        Home->>Agent: run playbook.answer (no planner — the skill is named)
        Agent->>Vault: my playbook · what I remember of these players
        Vault-->>Agent: the street's stage skill + table-read craft<br/>+ "Sharkbot bets the flop after raising, 3 of 3"
        Agent->>Agent: reason first (price, outs, position, board, money behind),<br/>then decide — one sentence, the reason, the move
        Agent-->>Home: {say, because, action}
        Home-->>Table: the answer, attributed to alice.me
        Table-->>Screen: "Advised by alice.me"
    end
    Screen->>Alice: says the sentence aloud, shows the reason,<br/>offers ONE button: the move
    Alice->>Table: presses it (or doesn't — nothing is played for her)
```

**In plain words.** When it's your turn, the screen asks the card room for advice. The card room does the arithmetic first — the model is never asked to compute a percentage, because it gets those wrong; it is *handed* the numbers. It also asks its own rules coach for a baseline. If the solver charts have seen this exact spot dozens of times and always agreed (a clear fold, a clear raise), the house answers and your agent's tokens are saved. Otherwise the card room signs the question **as the house** (so your agent knows who's asking) and sends it to your Home. There, your agent skips the usual planning step — the question names the skill — and answers straight from its playbook: the shared craft plus the one stage skill for this street, plus what it remembers about the players at this table. It writes its reasoning first, then the answer. Back at the table, the panel shows *whose* voice it is. Eight to fifteen seconds, door to door.

Two things a coach is held to, by the code and by the ontology:
- **It sees only what your seat sees.** Your two cards and the board — never anyone else's cards. Advice built on hidden cards would teach a way of playing you can never reproduce alone.
- **Advice is evidence, never authority.** The card room applies nothing it returns. You press the button.

---

## 4. After the hand: what your agent remembers

```mermaid
sequenceDiagram
    autonumber
    participant Table as Table (card room)
    participant Home as Alice's Home
    participant Agent as alice.me
    participant Vault as Alice's vault

    Table->>Table: hand over — count what each player did, from Alice's seat:<br/>put money in? raised? folded to a bet? bet the flop after raising?<br/>check-raised? barrelled the turn? bet the river? showed down? won?
    Table->>Home: poker.review — the counts (no cards, no transcript)
    Home->>Agent: playbook.answer, review mode
    Agent->>Vault: add these counts to playbook.memory:poker
    Note over Agent,Vault: Arithmetic, not judgement:<br/>no language model runs, no tokens are spent.
    Note over Vault: Sharkbot: pfr 3/3, cbet 3/3<br/>The Rock: foldToBet 2/2<br/>you: vpip 3/3, foldToBet 3/6
```

**In plain words.** The card room keeps no record of how anybody plays — it has nowhere to put one. What it does is *report* each finished hand to your agent as counts, and your agent keeps them in its own vault. Next hand, those counts come back with the rates worked out (*"folds to a bet 80% of the time, over 5"*), and the skill teaches what they mean. You can also ask your agent directly, from the panel: **"How am I playing?"** — it answers from your own line in that memory (*"you're calling every hand preflop with zero raises…"*).

This review used to cost a model call per hand and remember nothing. Now it remembers and costs nothing.

---

## 5. Where everything lives

```mermaid
flowchart TB
    subgraph SK["~/skills  (the knowledge)"]
        S1["skills/card-room/holdem-*/SKILL.md<br/>the five skills"]
        S2["ontology/texas-holdem.ttl<br/>the model of the game — hands, seats,<br/>advice, memory — grounded on the upper ontologies"]
        S3["ontology/texas-holdem.data.ttl<br/>capabilities, skills, the archetype,<br/>vocabularies, one worked hand"]
        S4["GraphDB: skills-contexts<br/>the registry the web app and the Home read"]
        S1 --> S4
        S2 --> S4
        S3 --> S4
    end
    subgraph AP["~/agenticprimitives  (the Home)"]
        A1["playbook.answer<br/>the tool that answers a question of judgement"]
        A2["playbook-memory<br/>folds counts into the vault"]
        A3["the vault<br/>archetype.assignment · playbook.memory:poker"]
    end
    subgraph PN["~/pokernight  (the card room)"]
        P1["packages/engine<br/>the rules of hold'em"]
        P2["packages/agent-kit<br/>the read, the counts, the solver charts"]
        P3["apps/tables<br/>the table: deals, asks, reports"]
        P4["apps/web<br/>the screen and the coach panel"]
        P5["apps/agent-worker<br/>the house players"]
    end
    S4 -. "compile playbook" .-> A3
    P3 -. "poker.advise / poker.review<br/>over A2A, signed as the house" .-> A1
    A1 --> A3
    A2 --> A3
    P4 --> P3
    P3 --> P2 --> P1
    P3 --> P5
```

**In plain words.** Three repositories, three jobs. **skills** holds the knowledge and the model of the game (the *texas-holdem* ontology says what a hand, a seat, a decision spot, a piece of advice and a memory *are*, in the same terms every other domain uses). **agenticprimitives** is the Home: where a person's agent runs, and where its vault is. **pokernight** is the card room: the rules of the game, the arithmetic of a read, the solver charts the house plays by, the table, the screen, and the house players.

The charts deserve one sentence: the house coach's baseline is not folklore. It's a lookup built from 560,000 solver-labelled decisions (PokerBench), scoring 91% preflop and 80% postflop against the solver's held-out set, and when the solver itself splits on a spot the baseline says so — which is exactly where your agent's memory of the player across the table earns its keep.

---

## 6. Glossary, in plain words

| Word | Meaning here |
|---|---|
| **A2A** | Agent-to-agent: the standard way one agent sends another a message and gets an answer. The card room and your Home talk this way. |
| **Home** | The place your own agent lives (faithnet.me). It holds your vault and signs things for you; the card room never holds your keys. |
| **Vault** | Your agent's private records. Your playbook and your poker memory are two of them. |
| **Archetype** | A blueprint for a kind of agent — which capabilities and skills it carries. Yours is *person steward*. |
| **Capability** | A named thing an agent can do: `poker.advise`, `poker.review`, `poker.act`. |
| **Skill / SKILL.md** | A plain-English document of *how* to do something. Five of them for hold'em. |
| **Playbook** | All of an agent's skills compiled into one document, fingerprinted, stored in its vault. |
| **The read** | The facts of your spot, computed by the card room: pot, price, outs, position, money behind, the hand so far. |
| **Baseline** | The house coach's own answer for the spot, sent along so your agent starts from something right about the mechanics. |
| **Certain** | The solver saw this exact spot many times and never disagreed — so the house answers and your agent isn't asked. |
| **Mixed** | The solver itself splits (bet 32% / check 68%) — carried as such, so your agent's memory can pick a side. |
| **Review** | The card room telling your agent how a finished hand went, as counts. |
| **Registry / GraphDB** | The catalogue of ontologies, capabilities, skills and archetypes that the website shows and the Home compiles from. |
| **Ontology** | The formal model of what things are — a hand is a *situation*, the rule book is a *description*, "button" is a *role a seat plays* — shared across every domain so they can be reasoned about together. |
| **The house** | The card room's own service identity. It deals, it asks your agent on your behalf, and it spends no tokens. |

---

## 7. Where to look in the code

| Step | Where |
|---|---|
| The skills | `~/skills/skills/card-room/holdem-*/SKILL.md` |
| The model of the game | `~/skills/ontology/texas-holdem.{ttl,clusters.ttl,data.ttl}` |
| Registering skills on the archetype | `~/skills/ontology/agentic-trust.data.ttl` (person-steward), `~/skills/scripts/publish-ontology-skills.mjs` |
| Compiling and assigning the playbook | `~/agenticprimitives/scripts/assign-person-archetype.mts` |
| The read, the counts, the charts | `packages/agent-kit/src/{explain,observe,preflop-chart,postflop-chart}.ts` |
| The table asking and reporting | `apps/tables/src/table-do.ts` (`/advice`, `askAdviser`, `reviewWithAdvisers`), `apps/tables/src/a2a.ts` |
| Signing as the house | `apps/tables/src/house-caller.ts` |
| The Home answering | `~/agenticprimitives/apps/demo-a2a/src/playbook-answer.ts`, `playbook-memory.ts` |
| The screen | `apps/web/src/components/PokerCoach.tsx`, `Coach.tsx` (the adviser picker) |
| The house players | `apps/agent-worker/src/personas.ts` |
