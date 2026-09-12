# My poker coach

Status: built, 2026-09-12 — the mid-hand consultation, the record, the review and the grant are live
(`docs/ARCHITECTURE-ADVISER.md` is the mechanism with diagrams; `docs/HOLDEM-COACH.md` the engineer's
notes). The study workspace and the Sunday letter (§7.2, §9) remain aspirational. First of `docs/articles/`.

This supersedes an earlier draft in which the table called `bob-coach.svc` directly and pinged it at
every showdown. It does neither. The table talks to **Alice's own agent** and nothing else; her agent
consults the coach; a hand's end is a record into *her* vault with nobody's model running; a review
happens when she asks. What follows is the arrangement as built.

Alice sits down at a Texas Hold'em table. Somebody is at her shoulder who has watched her play for
months, who knows she over-calls rivers out of position, who will not talk her into the line she
has already forbidden, and who forgets nothing she has not asked it to forget. That somebody is
not the card room. It is **Bob** — a person she hired — speaking through **his coaching service**,
a Smart Agent he custodies, running skills she can read, looking at records that live in **her**
vault, under a grant she can revoke before the next hand.

The card room deals. The estate makes the rest possible. This article is the architecture of that
arrangement, and the reason a Hold'em table is a good place to see what Agentic Primitives is for.

---

## 1. The picture we want a person to have

Alice does not learn the words *delegation*, *vault* or *playbook*. She learns four facts:

1. **She named Bob at her Home, and her own agent to the app.** Her playbook says "for poker
   advice, consult `bob-coach.svc`", and she signed a grant letting that service read her records.
   The card room only ever talks to *her* agent; the screen still says whose sentence it is —
   "bob-coach.svc, via alice.me". She can un-name him at her Home, and the table finds out at the
   next hand because her agent starts saying "no coach is named".
2. **Everything about how she plays stays with her.** Hands, questions, the notes she has taken
   on a regular across the table — in her vault, under her key.
3. **Bob does not take a copy home.** His service is allowed to *look* at what she has pointed it
   at, and to *say* something back. It is not allowed to file her hands in his cabinet.
4. **The advice is hers to take.** At a table that settles, the chips are Sheqels from her own
   treasury. A sentence is not a move.

That is the whole product. The rest of this document is how the estate keeps those four facts
true when the implementation is tempted to put the hands in the Durable Object, the style in the
prompt, and the coach in the same process as the table.

---

## 2. Bob is a person. The coach that answers is his service.

This is the estate's oldest split, and poker makes it obvious. A person authorizes. A service
acts. Bob is `bob.me`: he signs, he custodies, he is who Alice hired. He does **not** sit on the
turn clock. What advertises `poker.advise`, what has an A2A endpoint, what presents the grant at
Alice's vault, is a service he chartered — `bob-coach.svc` — with its own card, its own
custodian key (his), its own host.

```
                         alice.me                         the PLAYER
                    identity that signs
                    treasury (Sheqel)
                    VAULT  ← the record
                      · cardroom.hand.review     (each finished hand, as her seat saw it)
                      · cardroom.question        (her words, mid-hand)
                      · cardroom.style           (standing instructions)
                      · cardroom.read            (her notes on seats — evidence, not cards)
                      · cardroom.grant           (who may look, at what)

                         bob.me                           the COACH, as a person
                    identity that signs
                    custodies bob-coach.svc
                    VAULT  ← Bob's own life
                    not Alice's hands, not her style

                         bob-coach.svc                    the COACHING SERVICE
                    public name, public card, A2A endpoint
                    playbooks: holdem-adviser,
                               holdem-table-read,
                               holdem-memory
                    entitled (by Alice's grant) to READ her study records
                    VAULT  ← pointers only
                      · alice.me
                      · grant id + digest
                      · last-run id
                    no hand bodies, no style text, no opponent notes
```

Alice tells the **app** one name — her own agent, `alice.me`. The app fetches the card, demands
`poker.advise`, notes whether the card also advertises `poker.record` and `poker.review`, and keeps
`{ agentName: 'alice.me', endpoint, displayName }` on her seat at this table. After that the
browser is out of it: mid-hand, the table calls **her agent**. Her agent looks up the specialist
its playbook names for `poker.advise` — `bob-coach.svc` — fetches the study grant she signed for
it, and forwards the same question with the grant beside it. The table never learns the service's
endpoint; Bob's `.me` is on no hop at all.

The **table** (`PokerTableDO`) deals, clocks, settles. It is a host, not a memory. When a hand
ends it sends Alice's agent that hand *as her seat saw it*, with the counts of what everybody
did, and her agent files it in **her** vault (`cardroom.hand`) — a write, no model, no tokens.
Nobody pings the coach at showdown: the next time the coach reads her records is the next time
her agent consults it. The table keeps the seed and the action log so the shuffle can be
checked. Fairness, not coaching.

A **study workspace** (`alice-holdem.workspace`) is optional. Use one if the arrangement needs
standing — a season, a human teacher beside the service, a roster. Do not invent one just to
hold a name. Naming `bob-coach.svc` to the app is enough for "who's in the dialog." The
person's vault still answers "what happened at the table." The service's vault still answers
"who am I working with, under which grant?"

The **club** (`thursday-night.workspace`) is a different workspace. It holds a night. It holds
no money (`docs/WORKSPACES.md`, `docs/MISSION.md`) and it holds no study. Confusing the club
with the coach is how a host ends up with everybody's leaky notes.

---

## 3. The app includes Bob's service in the dialog

The table asks a named adviser `poker.advise` mid-hand, sends `poker.record` when the hand ends,
and forwards `poker.review` when she asks (`docs/HOLDEM-COACH.md`). The adviser is always her own
agent; the store of record is always her:

**Alice names her own agent. The table calls it. Her agent consults the coach. Records are hers.**

```
  Alice, at her Home:   playbook: poker.advise → bob-coach.svc
                        study grant: alice.me → bob-coach.svc
                          read cardroom.hand, .style, .read, .note · append .note
  Alice tells the app:  alice.me
  app checks the card for poker.advise (and notes poker.record, poker.review)
  stores { alice.me, endpoint, records: true, reviews: true }

  mid-hand, Alice's turn
  ─────────────────────────────────────────────────────────
  table  --poker.advise-->  alice.me
            view as her seat saw it, the legal moves,
            the read, the house baseline, her question
                               │  no model. looks up the specialist,
                               │  fetches her grant.
                               alice.me  --the SAME payload + grant-->  bob-coach.svc
                                              verifies the grant (from her, to me, scoped, live)
                                              reads HER vault UNDER HER GRANT
                                                style, the counts on these players, her reads, its notes
                                              reasons with the craft + Bob's doctrine
                                              returns { say, because, action? }
                                              (rarely) appends ONE note to HER cardroom.note
                               alice.me  <--  the coach's words
  table  <-- { say, because, action?, source: bob-coach.svc }
  screen shows: "bob-coach.svc, via alice.me"

  no coach named / no grant / grant revoked / coach late
  ─────────────────────────────────────────────────────────
  alice.me refuses in one line; the house coach answers; the screen says why

  hand ends
  ─────────────────────────────────────────────────────────
  table  --poker.record-->  alice.me
                               writes cardroom.hand: the view as THIS seat saw it,
                               the result, the counts folded into running totals
                               no model. the coach is not on this hop.

  Alice asks: "how have I been playing?"
  ─────────────────────────────────────────────────────────
  table  --poker.review-->  alice.me  --question + grant-->  bob-coach.svc
                                                              reads her recorded hands
                                                              sample size, what happened, the leak
                                                              with its count, ONE change
                                                              appends ONE note to HER cardroom.note
  table  <-- the review, source: bob-coach.svc
```

The card room still **never holds a profile of how Alice plays.** Naming her agent is a pointer
on her seat, not an insert into a house table. If she has named no coach, the record is still
written — to her, by her agent. A coach she hires later can be shown last month, because last
month is hers.

**The coaching service is never handed a turn.** `poker.act` seats an agent. `poker.advise`
asks one. An agent that only meant to talk is refused a chair; an agent that only meant to
play is refused as a coach. Bob's person agent advertises neither. Alice's agent advertises
`poker.advise`, `poker.record` and `poker.review` — and answers none of them with a model.
The service advertises `poker.advise` and `poker.review`. The table matches the card; the
playbook is not the card (ADR-0053).

**The app is a switchboard, not a deputy — and so is her agent.** Neither fetches Alice's vault
and forwards it. Her agent forwards the *question* with the *grant*; the service presents that
grant at *her* vault and reads there. The mid-hand view travels in the A2A message because
that is what the seat already sees; history does not.

Money is a third skill and a third grant. The buy-in mandate (`poker-buyin`) moves Sheqels
to the house under caveats Alice signed. The coaching grant does not spend. Mixing them is
how a "helpful" coach becomes a payment surface.

---

## 4. What goes in Alice's vault — and what an "opponent" is allowed to mean

The vault is the record (ADR-0026, the Day-15 line: *if this were wiped, is the loss a rebuild
or a bereavement?*). Indexes in the table object, the coach's run log — rebuilds. Alice's
hands, her questions, her style — a bereavement.

| Record | What it is | What it is not |
|---|---|---|
| `cardroom.hand.review` | The finished hand as her seat saw it: hole cards, board, action, result, what she asked | The deck. Anybody else's hole cards. The other seats' reviews. |
| `cardroom.question` | Her words, mid-hand, untouched | A parsed intent the house keeps |
| `cardroom.style` | Standing instructions, with a cost ("I never call a river bet out of position — I would rather miss a bluff-catch than pay off value") | A mood. "Play aggressively" is not a record. |
| `cardroom.read` | *Her* notes on how a seat has played, as evidence: "UTG opened 3x and barrelled twice, four nights" | A dossier on a person. Not "Marcus has ace-king." Not Marcus's vault. |
| `cardroom.grant` | Pointer to the live grant: delegate = `bob-coach.svc`, record types, expiry | The grant itself — that lives on chain. Not a grant to `bob.me`. |

**The delegate is the service, not the person.** Alice entitles `bob-coach.svc` to see her
poker-playing records. She does not open her cabinet to everything Bob is. His inbox, his
other services, a teammate he later adds — none of those inherit this look unless she signs
again. Person and service are different agents; the caveat names one of them.

**Opponent data is Alice's reading, stored as Alice's.** A pattern needs more than a hand;
`holdem-adviser` already says so. What she is allowed to keep is what her seat could see: bet
sizes, position, frequency, showdowns that were table-public. She is not allowed to keep what
she never held. Bob's service, reading under her grant, inherits that boundary. A coach that
"remembered Marcus cheats" from gossip would be writing a file the table never offered and
Alice never saw — `canasta-memory` already forbids that sentence, and Hold'em must.

If Marcus also named a coach, that grant does not reach Alice's seat. Two people at one table,
two services, two cabinets. That is the same property the HTTP advice route already enforces
(*your seat only*), lifted from a request parameter into a vault key.

---

## 5. The service holds pointers, and operates on someone else's record

This is the load-bearing constraint, and the one a normal SaaS coach gets backwards.

A coaching company today copies the hand history into *its* database, trains *its* model, and
offers an export. The Agentic Primitives line is the opposite: **the owner's vault is the
record; the platform is offered a cache.** Bob's service is a platform in that sentence. Bob
the person is not a second store of record either.

So `bob-coach.svc` is allowed, under Alice's grant, to:

- **Read** the record types the caveat names, for as long as the grant is live.
- **Compute** — run the table-read, the memory doctrine, the solver prior, an LLM overlay.
- **Reply** with `{ say, because, action? }`, in its own name, through her agent.
- **Append one note** to *her* `cardroom.note` — the one write the grant allows: short, dated,
  checkable against a hand. It is hers; firing the coach leaves it in her cabinet, not his.
- **Write to its own vault** only pointers, if anything: `{ principal: alice.me, grant: 0x…, at }`.
  Not the view. Not the because. Not the style text.

It is **refused**:

- A write of `cardroom.hand`, `cardroom.style`, `cardroom.read` or `cardroom.note` into the
  service's own vault, or into `bob.me`. The vault refuses these record types on a service
  principal outright. That would be a second store of record — and a copy Bob could keep after
  she fires him.
- A grant that writes anything but `cardroom.note`, or reads outside `cardroom.*`. Her agent's
  object refuses to store one; the coach's gate refuses to honour one.
- Re-delegating the grant wider than it arrived — including from the service to Bob's person
  agent as a standing tour. Attenuation only.
- Reading after revoke. Revocation is a transaction, not a token expiry. The next read fails at
  the manager; a cached "still allowed" is not a verdict (Day 6, Day 7).

Cloud-managed stores — the service Worker's memory, a Durable Object, a queue body — carry the
**reference**. Never the hand. The Day-15 rule already caught this class of bug in the estate's
own workflow engine; a coach that persisted `view` "so the next turn is faster" would be
reopening it.

Alice fires Bob by revoking the grant (and un-naming him at the table). The pointers in the
service vault become history of a relationship that ended. They do not become a leftover copy
of how she plays. Bob still has his playbooks. He does not still have her rivers.

---

## 6. The grant, in the shape the chain already knows

Alice's Home asks her to approve one thing, in words she can refuse:

> Bob's coaching service (`bob-coach.svc`) may *read* your Hold'em study records — the hands
> you have played, the questions you asked, the way you have said you want to play — until you
> take this back. It may not move money. It may not take a seat. It may not keep a copy. This
> is not a grant to Bob himself.

That sentence is an ERC-7710 delegation she signs. The caveats are field-level, not a scope
string:

| Caveat | Why |
|---|---|
| `delegate` = `bob-coach.svc` | This service, not `bob.me`, not "any coach." |
| `actions` = read (and, if she wants, append `cardroom.advice.given`) | Looking is not writing, and writing is not paying. |
| `record types` = the card-room study classes | Not her inbox, not her treasury, not the club roster. |
| `resource` = her vault | The study workspace, if she has one, may hold a *pointer* to the grant. It does not hold the hands. |
| `until` / revoke | She does not pick a token lifetime. She ends it. |
| digest-bound when the ask is one specific review | A "look at last Thursday" is not a standing tour of the cabinet. |

The harness that runs the service verifies three times: before the step, after any human pause,
and at redemption. A denial at any of the three is terminal. This is the same machine that
already gates a Sheqel buy-in. Coaching is not a special case; it is a quieter capability on
the same rail.

Find ≠ use. `bob-coach.svc` publishes `poker.advise` on a public card. That is how the app
knows it may put Bob in the dialog. It is not how anyone opens Alice's vault. The grant is.

---

## 7. Skills — two layers, both required, never the same object

The word *skill* is doing two jobs on this estate (ADR-0050). Mixing them is how a playbook
gets treated as a permission, or a card entry gets treated as a personality.

### 7.1 What the table matches — A2A `AgentSkill`

On the card, executable, named:

| Skill | Who answers | What it is |
|---|---|---|
| `poker.act` | a seat that plays | Apply a legal action. The table validates with the game. |
| `poker.advise` | Alice's person agent (consults); Bob's **service** (answers) | `{ say, because, action?, source }`. Applied by nobody. |
| `poker.record` | Alice's person agent | Receive a finished hand as that seat saw it, with the counts; put it in her vault. No model. |
| `poker.review` | Alice's person agent (forwards); the service (answers) | Her own question about her past hands, answered from the hands on file. |

Alice's agent advertises `poker.advise`, `poker.record` and `poker.review`. `bob-coach.svc`
advertises `poker.advise` and `poker.review`. Sharkbot advertises `poker.act` and `poker.advise`
(the rules coach, biased into a style) and neither record nor review — it keeps nothing.
`bob.me` advertises none of these. The table refuses the wrong job by reading this list, at
seat-time and at name-your-agent time, and records a hand only to an agent whose card says it
keeps them.

### 7.2 What makes the advice *Bob's craft and Alice's style* — `SKILL.md` playbooks

These live in the corpus (`~/skills`, namespace `card-room`) and compile into the harness of
the agent that wears them. The card room never reads the files. Changing how Alice is coached
is editing **Bob's service** playbook (or Alice's style), not redeploying `pokernight-tables`.

**On the player (`alice.me`):**

| Playbook | Job |
|---|---|
| `holdem-consult` | `cardroom.consult` | The whole of what her agent does at a table: consult the coach the playbook names, presenting her grant, and return its words in its name; put each finished hand in her vault; forward a review. *"You generate nothing."* |
| her style — `cardroom.style`, a vault record, not a playbook | — | Standing preferences in her words: "raise or fold before the flop, never limp", "tell me the price first". Outranks the craft. Edited after nights, at her Home. |

**On the coaching service (`bob-coach.svc`) — this is where the coaching skills live:**

| Playbook | Capability | Job |
|---|---|---|
| `holdem-coach` (archetype) | craft | Who talks to whom, the seat boundary, the consultation, the review, her records and what may be done with them. |
| `holdem-table-read`, `-preflop`, `-flop`, `-turn`, `-river` | `cardroom.table.read` (R0) and the streets | Price first, then outs, position, what the board already beats. A running read, never a bet. Refuses "what do they have" and "raise to sixty." |
| `holdem-memory` | `cardroom.memory` | What each of her four records is, what every counter means, how much a rate is worth at each sample size, the order things outrank each other, and the one note it may write back. |
| `holdem-review` | `cardroom.review` | How to review a session when she asks: sample size first, the decisions that mattered with the price, one leak with its count, one change, respected style. Never triggered by a hand ending. |
| `coach-bob` | `cardroom.style` | Bob's own doctrine: price before player; raise or fold, never limp; a bet says something and the second bet says more; a right decision that lost is still right. Attached to Bob's service and to no other coach's. |
| (aspirational) `holdem-study` | between sessions | The Sunday letter: three spots from the week, one improvement named first. Still a read of *her* vault. |

Bob's coaching style is a skill on the service — the twin of Alice's style of *play*, which is a
record in her vault. His person agent needs none of these files. The service is what her agent
consults.

The three layers `holdem-adviser` already states, now with a place to put each:

1. **Seat boundary** — capability + the view the table sent. Not overridable by any file.
2. **Craft** — Bob's service: the archetype and the table-read.
3. **Her style** — her artifact, in her vault, outranking the craft.

A fourth, when the memory skill has something that changes the sentence: **the record**. "Take
the price — this is the river you asked about last Thursday" is the same advice with a reason
she will keep. If the memory adds nothing, say the advice alone.

### 7.3 Capability is the centre; files are projections

`cardroom.table.read` is one capability. It projects to:

- an A2A skill (`poker.advise` carries a read, it does not become one),
- a `SKILL.md` (`holdem-table-read`),
- a tool the harness may call,
- a grant caveat (the **service** may *read* study records; it may not *act* in a seat).

There is no `implementedBy exactly-1` from the card entry to the file (ADR-0053). A future
Bob that uses the solver chart, then an LLM overlay, then sits in on Sundays as himself, is
still realising `cardroom.table.read`. The card does not change when the plan does. When Bob
*himself* joins the call, that is a person in the study workspace, not a second write of her
hands.

---

## 8. How a hand should feel, once this is real

Alice is in the big blind with K♠ Q♠. Flop J♠ T♠ 2♣. She faces 20 into 80. She has asked, in
the box, "am I getting the right price?" She named Bob last week.

1. The table sends `poker.advise` to `alice.me` with the redacted view, the read, the house
   baseline and her question. The clock is running; this call is synchronous, the same A2A
   profile a bot turn uses. Her agent runs no model: it looks up `bob-coach.svc` in its playbook,
   fetches her grant, and forwards the same payload with the grant beside it.
2. The service verifies the grant and presents it at her vault. It reads last Thursday's river,
   her style line about out-of-position rivers, its own note from the last review, and this
   view. It copies none of it.
3. The prior is the solver chart and `readHand` — facts: *Calling 20 into 80 needs this about
   20% of the time. You act last. You have a flush draw and an open-ender.* The overlay (an
   LLM, if the prior is thin; silence, if it is not) writes one sentence of plan. It does not
   invent that the button has ace-king.
4. The screen shows the sentence and both names — *bob-coach.svc, via alice.me*. She calls, or
   she does not. The action on the wire is hers.
5. Showdown. The table sends `poker.record` to `alice.me`: the hand as her seat saw it and the
   counts. Her agent files it in her vault. Nobody pings the service; next Thursday, when her
   agent consults it, the record has an ending — which is the only way a pattern is real.
6. Later, she presses *Review my hands*. Her agent forwards the question with the grant; the
   service reads the hands on file, tells her the sample size, the two spots that cost the
   most, one leak with its count, one change — and leaves one note in her cabinet.

Pause still means everybody, including Bob's service. A grant that is live is not a licence
to keep talking after she has stood the table still.

---

## 9. Why this is an Agentic Primitives story, not a poker-app story

A card room that wanted a coach could fine-tune a model, store hands in the worker, and ship a
panel. Several already have. What they cannot do — and what this estate is *for* — is the
following, as properties rather than as settings:

**Identity that signs, and a service that acts.** Alice is `alice.me`. Bob is `bob.me`. The
thing in the dialog is `bob-coach.svc`. The club is `thursday-night.workspace`. The house
treasury is `pokernight.treasury`. Suffixes are kinds; kinds decide what each may hold
(ADR-0061). A coaching *service* is not a person and it is not a club. The person custodies
it; the person is not the endpoint the table calls. That is Day 5 and Day 10: the service
that acts as a coach must never *be* Bob.

**Authority is an artefact.** The coaching grant (delegate = the service) and the buy-in
mandate are the same object family with different caveats. There is no OAuth scope
`coach:read` that a resource server reinterprets. Revoke is a transaction.

**The vault is the record; the app is a cache.** The table's SQLite is how a hand is dealt
right now. Alice's vault is how last month survives a worker eviction, a Home move, firing
Bob. Carry-the-vault-to-another-Home is the property the design promises; the article is
honest that the ceremony is not yet a Tuesday demo.

**Find is not use.** Publishing `poker.advise` on `alice.me` is how the app knows it may ask her
agent; publishing it on `bob-coach.svc` is how her agent knows the service answers. Neither is
how anyone opens a vault — the grant is.

**Two knowledge tiers.** Public: that Alice is seated, that a hand number advanced, that the
seed will be revealed, that she is advised by Bob. Private: her cards, her questions, her
style, her reads. They do not meet in a "player profile" the lobby can rank.

**Behaviour is generated; authority never is.** The solver chart, the rules baseline, the LLM
overlay, the Sunday letter — those are playbooks on the *service*. They may change every week.
They do not mint a grant and they do not survive a revoke. A prompt is not a permission.

**Receipts that travel.** An advice reply should cite the playbook digest and the record ids
it read, the way a Sheqel cash-out cites an `orderHash`. Alice can ask later *why* last
Thursday's sentence said what it said, and the answer is evidence, not a vibe.

**A workspace is a context, not a pot.** A study workspace, if she wants one, holds the
arrangement. The club workspace holds the night. Neither holds chips; neither holds hole
cards. The thing that holds chips is a treasury. The thing that holds hole cards, for a
moment, is a seat, and then a review in the seat-holder's vault.

**The host does not learn the game.** The table still hosts games, not poker
(`docs/GAMES.md`). Coaching inherits that: `poker.advise` and `canasta.advise` are different
skills; a canasta memory file does not get to see a Hold'em hole. Adding a second game does
not open Alice's Hold'em cabinet.

---

## 10. What is already true, so this is not a sketch on a blank page

The article is aspirational. The joints it uses are not.

- The table already asks a named adviser and already offers a finished hand to that adviser
  (`poker.advise`, `poker.review`). Alice naming `bob-coach.svc` is that path with a person's
  service on the end of it, not a house persona.
- House personas already advertise the three skills separately, so a talker cannot be seated.
- Person / service / workspace suffixes are already how the estate names kinds. A treasury
  under a person is the worked example of "I custody a service that talks to apps."
- `holdem-adviser` and `holdem-table-read` already exist in `~/skills`. `canasta-style` and
  `canasta-memory` are the missing Hold'em files, written as the pattern.
- Clubs are already `.workspace` agents the card room does not hold the key to.
- Buy-ins already move under a caveated mandate. A coaching grant to a *service* is the same
  rail, quieter.
- `decide()` already prefers a solver chart and falls back to rules; an LLM strategy already
  exists as a sibling. Orchestrating them *inside Bob's service*, with the chart as prior, is
  how the sentence stays honest when the model would rather invent a range.
- The seat boundary is already enforced by sending `viewFor`, not raw state. A vault that
  stored more than the seat saw would be the first place that leaked.

What is not true yet, and must not be implied by a demo:

- The Hold'em board does not mount a coach panel.
- `pokerGame` has no house `advise`; unnamed Alice gets 404, not a house sentence.
- Reviews go to a named adviser today, not to `alice.me`'s vault as the store of record.
- There is no `bob-coach.svc` charter ceremony, no grant whose delegate is forced to be a
  service, no coach vault that is pointers-only by construction.
- `holdem-style` and `holdem-memory` are not in the corpus.
- Carry-my-vault-to-another-Home is undescribed as an end-to-end click.

The work is to put the record on the player, the craft on a **service a person custodies**,
the looking on a grant named to that service, and the dialog on a public A2A name the app
already knows how to call. The table stays a table. Bob stays a person.

---

## 11. The test

Wipe the card room's Durable Objects. Alice still has her hands, her style, her questions, and
the name she trusts — Bob's service. Wipe `bob-coach.svc`. She still has those records; she
names someone else; the new service reads under a new grant and does not inherit a shadow
copy. Wipe Bob's person vault: nothing of Alice's is there to lose. Wipe *her* vault and she
has lost a year of study — which is the definition of the record, and the reason it was never
the house's to hold, and never Bob's.

That is my poker coach. The game is Hold'em. The substrate is why it is hers.
