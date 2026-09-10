# Adding a game

Status: 2026-09-09. Companion to `docs/DESIGN.md`.

The table service hosts **games**, not poker. A game is a package with its own engine and a small
adapter; adding one is writing those two things and adding one line to a registry. Nothing in the
table object, the lobby, the clubs, the seat lifecycle or the settlement path changes.

## Why a port and not one engine

Games are not variants of each other. Hold'em has betting rounds, a pot, side pots and a hand
evaluator. Canasta has melds, partnerships, a discard pile that freezes and scoring to five thousand
across many hands. They share no rules, and an engine built to hold both would be bad at both.

What they **do** share is everything around the rules, and it is the expensive part: a room with
seats, players who arrive and drop and come back, a turn with a clock and a default, an append-only
log, a seeded shuffle that replays byte-identically, a per-seat view that must never leak another
player's cards, an outbox, an operator gate. That is what `@pokernight/table-game` describes.

So each game keeps its own engine, pure and complete, and implements the port to be hostable.
**Adding a game is never editing another game's rules.**

## The three pieces

```
packages/table-game       the PORT. Types only. Never learns that any game exists.
packages/deal             the seed, its commitment, and the shuffle. Belongs to no game.
packages/engine           poker's rules + `pokerGame`, its adapter.
packages/canasta          canasta's rules + `canastaGame`, its adapter.
packages/<your-game>      your rules + your adapter.
apps/tables/src/games.ts  the registry: one line per game.
```

Canasta is the second one, and it was built to find out what the port had got wrong. What it found is
in "what the port learned" below.

`PokerTableDO` holds a game's state as `unknown` and hands it straight back. Everything it needs to
know without understanding it comes through `snapshot(state)` — who is seated, what they hold, which
round it is, whose turn it is, when their clock runs out. It asks. It never reads a field.

## What you write

An **engine**: pure functions, new state returned and never mutated, no I/O, no timers, and no
randomness except the seed passed in. Every round must replay byte-identically from
(seed, action log), and its tests must assert that. This is the same rule the poker engine already
lives under, and it is what lets a shuffle be committed before the deal and revealed after — the one
fairness claim this product makes that a player can check themselves.

An **adapter** implementing `TableGame`, living in your package because an adapter belongs with the
game it adapts. Two of its methods carry more weight than the rest:

- `redact(event, seat)` is the only thing standing between a player and somebody else's cards. An
  adapter that returns the event unchanged has not implemented it.
- `snapshot(state)` is how the host sees your table. Get `roundInProgress` wrong and every "can this
  start?" decision downstream is wrong with it.

Then one line in `apps/tables/src/games.ts`.

## What the port already learned from being written

Two fields were added while wiring poker through it, and both are general rather than poker's:
`SeatSnapshot.timeouts`, because any game with a clock needs to sit out somebody who has walked away,
and `config.turnMs`, because the host arms the alarm but only the game knows how long a turn is.
Building CANASTA against it found three more. `TableGame.config(state)` — the host cannot describe a
game's own configuration and should not try, but it has to carry it, which is how a lobby shows
poker's blinds without knowing what a blind is. `TableGame.actSkill` — an agent that plays poker
cannot play canasta, and the two must not be able to be handed each other's turns. And `staked`
earned its keep: canasta is played for score, so the host opens no settlement path and writes no
ledger row, rather than settling amounts of zero.

It also found a bug the port had been hiding. `PokerTableDO` still had six `as TableState` casts —
the compiler being told to stop asking — and behind one of them the table summary was reading
poker's `handNo` off a canasta state and getting `undefined`. A cast is where a port stops working;
there are none left.

The port's own tests do not use poker. They define **High Card** — deal one card each, highest wins,
no betting and no stakes — and drive it through the port and the registry. A test that only ever ran
poker would prove nothing: the port was written from poker and of course it fits. A game that shares
nothing with Hold'em except being seated with a turn is the one that tests the claim.

## The wire

**The envelope is the host's; the payload is the game's.** The table service owns seats, chat, turns,
errors, the round counter and the settlement. A game owns its view, its legal actions, its actions
and its own events, and those cross the wire as `unknown`.

Not laziness. A type there would have to be a union of every game the deployment ever ships, which
means adding a game would mean editing the protocol and every other game's client would recompile
against it. Opaque payloads are what let a second game arrive as a package.

**Something has to read them, and whatever reads one knows a game.** So the protocol also publishes a
named binding — `PokerServerMessage`, `PokerTableEvent`, `pokerConfigOf` — and each poker client
narrows once at its own socket boundary rather than casting at every field. The web client aliases it
in `src/lib/types.ts`; the reference bot does it at its import; the table tests do it in their socket
helper. Your game publishes its own binding and its client aliases that.

Two things ride beside the opaque payloads because a lobby has to list a table it cannot describe.
`TableSummary.config` is the generic setup every table has — seats, minimum and maximum stake, turn
length — and `gameConfig` is the game's own, which is where poker's blinds live. A client that does
not know the game shows what the game is instead of inventing a number for it.

When there are three games these bindings should move out to each game's own package and the protocol
should stop importing an engine. With one, a binding beside the generic wire is cheaper than a package
that exists to hold six type aliases.

**The client.** The table screen draws a board, a pot, chips and betting controls. A second game
brings its own table screen. The lobby, the clubs panel, sign-in and the money panel do not change.

**Money.** Poker's model is chips at a seat, converted at a pinned rate, settled buy-in and cash-out
against the house. A game played for score has none of that, which is what `TableGame.staked` is for:
a game that answers `false` opens no settlement path at all and gets no ledger rows, rather than
settling amounts of nothing. A game that wants stakes in a different shape — one entry, one payout at
the end — is new settlement work and should be treated as such rather than bent onto the chip model.

## What canasta cost, measured

| Piece | Lines |
|---|---|
| `packages/canasta/src` — rules, scoring, adapter | ~1,150 |
| `packages/canasta/test` — rules, table, 300 rounds of random play | ~900 |
| Changes to the table service | one import and one line in the registry |
| Changes to poker | none |

The port held. Adding the game touched no other game's rules and no part of the host except the
registry line that names it.

## The stamp

A table records its game when it is opened, and never re-reads it. Same rule as the chip rate, the
settlement asset and the club, and the sharpest reason of the four: a table whose game was looked up
rather than recorded could be dealt different rules than the ones its players sat down to, with their
money already on it. A table stamped with a game the deployment no longer ships **fails loudly on
load** rather than quietly becoming poker.

A table with no stamp is poker. Every table opened before games were named is one.

## A client draws one game, and says so

The wire is general; the things that read it are not. `apps/web` draws a poker table — every board,
every action control and every log line in `components/` reads a poker view and knows no other. That
is a fine thing for a client to be. The dangerous version is the one that does not know it.

It cost a crash to learn. A canasta table was listed in the public lobby with a **Join →** link; the
poker board mounted against a canasta view and died on `view.config.bigBlind`, a field the canasta
view does not have and never will. Nothing was wrong with the table.

Three things now hold, and the first is the one that makes the other two possible:

1. **`welcome` carries `game`.** The socket says which game it deals in the same frame as the first
   view. A client that had to fetch the game over HTTP would be racing its own socket, and the race
   it loses is exactly the one that crashed. Absent means poker.
2. **The reducer drops foreign payloads.** `apps/web/src/lib/tableSocket.ts` keeps a view, a legal
   set or a game event only for the game it draws. On any other table `view` stays null forever, so
   no component can be handed a payload it cannot read, whatever a future page forgets to check.
3. **Every place that meets a table asks first.** `apps/web/src/lib/games.ts` states the rule once:
   the lobby will not offer a seat it cannot draw, the featured card will not narrate a view it
   cannot read, and the table page shows a plain screen naming the game instead of a board.

When a second board is written, `games.ts` is where it announces itself.

## The second board, and what it cost

Written, and the numbers are the point. `apps/web` now draws canasta as well as poker.

| | |
|---|---|
| New files | `lib/canasta.ts`, `lib/canastaSocket.ts`, `pages/CanastaPage.tsx`, `pages/TableRoute.tsx`, `components/CanastaTable.tsx`, `components/CanastaHand.tsx`, `components/CanastaLog.tsx` |
| Poker files changed | none of its components, its reducer or its page |
| Shared, unchanged | `TableSocket` (made generic in its message type and nothing else), `Card`, the session, the topbar |
| Bundle | 268 kB → 288 kB (84 → 90 kB gzipped) |
| Protocol | one more binding beside poker's; the generic wire untouched |

**The transport is the host's and knows no game.** `TableSocket<M>` gained a type parameter
defaulting to poker's binding, so every existing caller is unchanged. The reconnect, the backoff and
the keepalive never depended on the payloads, and now nothing pretends they did.

**The BOARD is per game, and so is the reducer.** `reduceCanasta` is not `reduce` with branches: it
keeps a canasta view, a canasta turn and a canasta log, and drops what poker keeps that canasta has
no equivalent of (`lastHand`, which exists so a poker winner survives the hand going null; a canasta
result rides on the view itself). A page that branched on game inside one board would have carried
poker's money furniture — the pot, the blinds, the buy-in, the treasury — into a game that
`staked: false` says has none.

**`TableRoute` chooses the board before either mounts.** One HTTP read of the table's stamped game,
then the right page. Mounting a board and discovering afterwards that it is the wrong one means the
wrong socket, the wrong reducer and a frame of the wrong screen.

**Two card codecs, one card component.** Poker deals `Ah`; canasta deals `AS` and `W*`. Both are
`${Rank}${Suit}`, so `cardSuit` folds the case and `cardRank` renders `W` as `JK`. That is the whole
change, and it is what stopped a second card component existing.

**The client keeps a copy of five card predicates** (`isWild`, `isRedThree`, `cardValue`, …) rather
than importing them, because a value import of `@pokernight/canasta` drags its engine into the
bundle — the same rule that keeps `pokerConfigOf` a local three-liner. A copy is only safe if
something checks it, so `canasta.test.ts` checks all five against the engine over the whole 108-card
pack. The engine is a dev dependency there and never ships.


## Agents, and the second thing the port had to give up

A canasta table could deal itself long before it had anybody to deal to. The A2A turn call was
`poker.act` with a poker view and a poker action, baked in — so the one game that most needs agents
could not have them. Canasta is four-handed: poker deals to two, so a person with one friend has a
game, and a person alone at a canasta table has nothing at all.

Three things moved, and they are the same three the socket had already learned:

1. **The skill is named per game.** `poker.act` and `canasta.act`. The table asks for its own game's
   skill by name and refuses to seat an agent whose card does not advertise it, so the two can never
   be handed each other's turns. A canasta persona sent a poker spot refuses rather than guessing —
   there is a test for exactly that, in both directions.
2. **The request is opaque.** `ActInput` carries `skill`, the table, the round, the seat and a
   deadline; `view`, `legal` and the returned `action` are the game's. Each game keeps a named
   binding beside it, the same way `PokerServerMessage` sits beside `ServerMessage`.
3. **The host stopped judging moves.** It used to check an agent's reply against poker's legal
   actions. It now calls `game.parseAction` and lets `game.apply` refuse — so the log says
   `raise 1000000 out of range` instead of `illegal action`, and a canasta reply is judged by
   canasta's rules rather than rejected by poker's.

`packages/canasta-agent` is the strategy: pure, deterministic, and verified against the engine's own
`applyMelds` / `openingValue` / `hasCanasta` before it returns anything. Across 200 seeded rounds
every round ends with a seat going out and every round produces a canasta. Three personas exist
because a table seats an agent by its NAME, and a solo player has three empty chairs to fill.
