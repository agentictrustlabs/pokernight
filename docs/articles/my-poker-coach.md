# My poker coach

Status: built, 2026-09-13 — coach on demand, the mid-hand consultation, the vault record, the
review, the grant, the private club (invite, schedule, nights), and the club huddle (video and
guests) are live on **poker.faithnet.io**. Mechanism: `docs/ARCHITECTURE-ADVISER.md`. Clubs:
`docs/WORKSPACES.md`. Ontology: [skills.faithnet.io](https://skills.faithnet.io) (`texas-holdem`).
The Sunday letter remains later. First of `docs/articles/`.

This is a story about a capability somebody asked for in another domain — a **named clinician,
a coach that knows the patient’s own record, a private practice that gathers people between
visits** — and about the card room that already ships that arrangement, as properties, on the
Agentic Primitives Home.

---

## 0. What was asked for

A practice enrolls you. A doctor’s name is on the door. Between appointments an AI coach
checks in: it knows the diagnosis, the plan, the goals, the last reading. You log what happened
today. The coach talks in under a minute. Urgent things escalate to the care team; the coach
never replaces the doctor. The clinic can gather — a call, a guest, a schedule. The record is
supposed to be *yours*, and the coach is supposed to help, not to become a second hospital.

That product, written as a consumer app, copies the chart into *its* database, trains *its*
model, and lets the team watch a dashboard. Export is a feature. Revoke is a settings toggle.

The estate does the opposite, and Hold'em is where you can press it.

**poker.faithnet.io is a custom app on the Home.** It deals cards. Everything that makes a
coach a coach — who you are, what may be looked at, who may sit in the call, which skills the
coach plays by, what a “hand” *is* — is the substrate. Swap the ontology and the surface and
the same joints are a care plan, a reading, a prescribed service, a practice huddle.

| The ask | What already runs |
|---|---|
| A named person enrolled you | Alice named **Bob**. He is `bob.me`. She signed a grant to **his service**, not to him. |
| An AI coach that knows *your* record | `bob-coach.svc` — a real A2A agent. Mid-hand, or when she presses **Ask on demand**. It reads **her** vault. |
| You log what happened; no one pays a model for the log | Each finished hand is `poker.record` into her vault. Counts, not a paragraph. No tokens. |
| The coach never replaces the clinician | A sentence is not a move. She presses the button. The house line stays free when the solver is certain. |
| A private practice: invite, schedule, guests, video | A club is a `.workspace` the host custodies. Invite, nights, guests. The huddle is the Home’s call — members and guests, playing or watching. |
| The craft is editable | `SKILL.md` files at [skills.faithnet.io](https://skills.faithnet.io). Bob’s doctrine is a file on his service. Redeploying the card room changes none of it. |
| The domain is real | The **texas-holdem** ontology: hand, seat, price, advice, opponent model, grant, review. Eighty-odd classes on the same spine a care ontology would use. |

The rest of this article is that table, lived as a Thursday night.

---

## 1. The picture we want a person to have

Alice does not learn *delegation*, *vault* or *playbook*. She learns four facts:

1. **She named Bob at her Home, and her own agent to the app.** Her playbook says “for poker
   advice, consult `bob-coach.svc`.” She signed a grant letting that service read her study
   records. The card room only ever talks to *her* agent. The screen still says whose sentence
   it is — “bob-coach.svc, via alice.me”. She can un-name him; the next ask finds out.
2. **Everything about how she plays stays with her.** Hands, questions, notes on a regular
   across the table — in her vault, under her key. Shared with the coach the way a grant
   shares: look, do not take home.
3. **Bob does not take a copy.** His service may *look* at what she pointed it at, and *say*
   something back. It may append one note *to her cabinet*. It may not file her hands in his.
4. **The advice is hers to take.** At a table that settles, the chips are Sheqels from her
   treasury. A sentence is not a move. That is the same sentence as “the coach never replaces
   the doctor.”

The implementation is tempted to put the hands in the Durable Object, the style in the prompt,
and the coach in the same process as the table. The estate is what keeps those four facts true
anyway.

---

## 2. What you can do tonight on poker.faithnet.io

**Sit down.** A practice table is one per person, derived, in no lobby. A pickup table is
public. A **private club** is a `.workspace` Smart Agent the host chartered at their own Home.
The card room records the address and never holds the key. You get in by invitation — a Home
join, a name, an email link — not by finding a directory. A club you are not in is
indistinguishable from one that does not exist.

**Come back next week.** The host sets a **schedule**. Nights are derived from it. Guests can
be invited for one night. The club holds the gathering. It holds no money and no hole cards
(`docs/WORKSPACES.md`, `docs/MISSION.md`).

**See each other.** The club **huddle** is the Home’s governed call (spec 378): audio, cameras,
screens on Cloudflare RealtimeKit; who may start or join is the club’s roster, playing or
watching. The card room verifies the session and asks the Home. A spectator still hears the
table. Guests in the club are guests in the call. The join token passes through once and is
kept nowhere.

**Ask for a coach when you want one.** The house line is free — rules plus solver charts — and
it answers when the chart is certain. When she wants a person, she names her agent and presses
**Ask on demand**, or leaves “Tell me” on. The table sends `poker.advise` to `alice.me`. Her
agent generates nothing: it consults `bob-coach.svc` with her grant beside the question. Tokens
run on the coach’s account, and only then. “Review my hands” is the same hop, later, when she
asks — never at showdown.

**Keep the night.** Every finished hand is written to **her** vault as she saw it, with the
counts of what everybody did. The coach is not on that hop. Next time it is asked, last month
is already there.

---

## 3. Bob is a person. The coach that answers is his service.

A person authorizes. A service acts. That is the estate’s oldest split; a prescribed coach
makes it obvious. Dr. Shah does not sit in the model. Bob does not sit on the turn clock.

```
  alice.me                         the PLAYER
    signs · treasury (Sheqel)
    VAULT  ← the record
      cardroom.hand      each finished hand, as her seat saw it, plus counts
      cardroom.question  her words, mid-hand
      cardroom.style     standing instructions
      cardroom.read      her notes on seats — evidence, not cards
      cardroom.note      the coach’s notes, in HER cabinet
      cardroom.grant     who may look, at what

  bob.me                           the COACH, as a person
    signs · custodies bob-coach.svc
    VAULT  ← Bob’s life. Not her hands.

  bob-coach.svc                    the COACHING SERVICE
    public card · A2A endpoint · custom host
    playbook compiled from SKILL.md at skills.faithnet.io
    entitled (her grant) to READ her study records and append a note
    VAULT  ← pointers only: alice.me, grant id, last-run
```

Alice tells the **app** one name — `alice.me`. The app checks the card for `poker.advise`
(and notes `poker.record`, `poker.review`) and keeps that pointer on her seat. Mid-hand the
table calls **her agent**. Her agent looks up the specialist its playbook names, fetches the
grant, and forwards the same question. The table never learns the service’s endpoint.

The **table** (`PokerTableDO`) deals, clocks, settles. Host, not memory. Fairness is the seed
and the action log. Coaching is her vault plus his playbook.

The **club** (`thursday-night.workspace`) is a different workspace from any study arrangement.
Confusing the club with the coach is how a host ends up with everybody’s leaky notes — or how
a clinic dashboard becomes a second chart.

---

## 4. A hand, and a night

**Mid-hand.** She is in the big blind with K♠ Q♠. Flop J♠ T♠ 2♣. She faces 20 into 80. She
has typed “am I getting the right price?” or simply left Ask on demand.

1. The table does the arithmetic (price as a percentage, outs, position, stack). The model is
   never asked to compute a fraction.
2. If the solver chart has seen this spot often and never disagreed, the **house** answers.
   Nobody’s tokens.
3. Otherwise `poker.advise` goes to `alice.me` — view as her seat saw it, legal moves, the
   read, the house baseline, her question. Her agent runs no model.
4. `bob-coach.svc` verifies the grant, reads her vault (style, counts on these players, its
   last note), reasons from the street skill plus Bob’s doctrine, returns `{ say, because,
   action? }`. It copies nothing.
5. The screen says *bob-coach.svc, via alice.me*. She calls, or she does not.

**Showdown.** `poker.record` to `alice.me`. Vault put. No model. The coach is not pinged.

**Later.** “Review my hands.” Same consult, now over the file. Sample size, the leak with its
count, one change, one note left in *her* cabinet.

**Meanwhile the club is on a huddle.** Faces and voices are the Home’s. Who may be there is
the roster — host, member, guest — not whoever has the link. Pause still means everybody,
including the service.

---

## 5. What the vault may hold — and what “the other player” may mean

The Day-15 line: if this were wiped, is the loss a rebuild or a bereavement? Table indexes
are a rebuild. Her hands, her style, her questions are a bereavement.

| Record | What it is | What it is not |
|---|---|---|
| `cardroom.hand` | The finished hand as her seat saw it: hole cards, board, action, result, `observeFor` counts | The deck. Anybody else’s hole cards. The other seats’ files. |
| `cardroom.question` | Her words, mid-hand | A parsed intent the house keeps |
| `cardroom.style` | Standing instructions with a cost | A mood. “Play aggressively” is not a record. |
| `cardroom.read` | *Her* notes on how a seat has played, as evidence | A dossier. Not “Marcus has ace-king.” Not Marcus’s vault. |
| `cardroom.note` | The coach’s short, dated note, written **here** | A file on `bob-coach.svc` |
| `cardroom.grant` | Pointer to the live grant: delegate = the service | A grant to `bob.me`. Not the club roster. |

**The delegate is the service.** She entitles `bob-coach.svc`. She does not open her cabinet to
everything Bob is. A teammate he later adds does not inherit the look.

**Opponent data is her reading.** Bet sizes, position, frequency, public showdowns. Not what
she never held. Two seats, two grants, two cabinets — the same property as “your cardiologist
does not inherit your dentist’s chart.”

In the product that was asked for, “the team can see your progress in real time” is the
sentence that usually means a copy. Here the team that is *people* sees you in the huddle.
The service that is *the coach* sees the record under a grant. Those are different hops.

---

## 6. The grant

Her Home asks, in words she can refuse:

> Bob’s coaching service (`bob-coach.svc`) may *read* your Hold'em study records — the hands
> you have played, the questions you asked, the way you have said you want to play — until you
> take this back. It may append a short note to that same cabinet. It may not move money. It
> may not take a seat. It may not keep a copy. This is not a grant to Bob himself.

That is an ERC-7710 delegation. Caveats are field-level. Revoke is a transaction. The next
uncached read fails. Find ≠ use: publishing `poker.advise` puts the service in the dialog; it
does not open the vault.

The buy-in mandate (`poker-buyin`) is the same object family with different caveats. Mixing
them is how a helpful coach becomes a payment surface — or how a wellness app starts billing
against a care grant.

---

## 7. Skills and the ontology

Two layers (ADR-0050). Mixing them is how a playbook becomes a permission.

**On the card** (what the table matches): `poker.act` seats; `poker.advise` talks; `poker.record`
files; `poker.review` looks back. Alice’s agent advertises the last three and answers none of
them with a model. The service advertises advise and review. Sharkbot advertises act. `bob.me`
advertises none of these.

**In the corpus** ([skills.faithnet.io](https://skills.faithnet.io), namespace `card-room`):

| Who wears it | Files | Job |
|---|---|---|
| `alice.me` | `holdem-consult` | Consult the named service; record the hand; forward a review. *Generate nothing.* |
| `alice.me` | `cardroom.style` (vault, not a file) | Her standing preferences. Outrank the craft. |
| `bob-coach.svc` | `holdem-coach`, `holdem-table-read`, the four streets, `holdem-memory`, `holdem-review` | Craft, memory, how to review when she asks. |
| `bob-coach.svc` only | `coach-bob` | His doctrine. Another coach is another file. |

Changing how she is coached is editing Bob’s playbook — or her style — and re-assigning.
`pokernight-tables` does not change.

**The texas-holdem ontology** is why this is not a pile of prompts. A hand is a *situation*.
Advice is a *recommendation* (evidence, never authority). An opponent model is a *knowledge
record* in *her* vault. A position is a *role a seat plays*. The T-box imports agentic-trust;
it does not copy person-steward. The skills *apply to* those classes. A cardiac context would
be the same shape: reading ⊑ observation, plan ⊑ recommendation, practice ⊑ workspace, the
coach a service, the clinician a person.

There is no `implementedBy exactly-1` from the card entry to the file (ADR-0053). Bob may add
a solver overlay next month. The card still says `poker.advise`.

---

## 8. Why this is a Home story, not a poker-app story

A card room that wanted a coach could fine-tune a model, store hands in the worker, and ship a
panel. A clinic that wanted HeartCoach could do the same with blood pressure. What they cannot
do as *properties* — and what this estate is for — is:

**Identity that signs, and a service that acts.** Alice is `alice.me`. Bob is `bob.me`. The
thing in the dialog is `bob-coach.svc`. The club is `thursday-night.workspace`. The house
treasury is `pokernight.treasury`. Suffixes are kinds (ADR-0061). The person who prescribed
the coach is not the endpoint on the clock. Day 5, Day 10.

**Authority is an artefact.** Coaching grant and buy-in mandate are the same family. There is
no OAuth scope a resource server reinterprets. Revoke is on chain.

**The vault is the record; the app is a cache.** Table SQLite is this hand. Club SQLite is a
*projection* of the Home’s roster (standing in one hop; Home is the truth). Her vault is last
month, a Home move, firing Bob. The huddle token is not a record at all.

**Find is not use.** A public `poker.advise` is how anyone knows who to ask. The grant is how
anyone looks.

**Two knowledge tiers.** Public: she is seated, the hand number advanced, she is advised by
Bob, the club meets Thursdays. Private: her cards, her questions, her style. They do not meet
in a lobby ranking — or in a “team dashboard” that is a second chart.

**Behaviour is generated; authority never is.** Playbooks on the service may change every
week. They do not mint a grant.

**A workspace is a context, not a pot.** The club holds the night and the huddle. A study
workspace, if she wants one later, holds the arrangement. Neither holds chips or hole cards.

**The host does not learn the game.** The table hosts games, not poker (`docs/GAMES.md`).
`poker.advise` is not `canasta.advise`. Adding a care surface does not open the Hold'em
cabinet.

**The custom app is allowed to be thin.** poker.faithnet.io is the table, the board, the
switchboard, the club page. Home is the agent, the vault, the grant, the huddle admission.
skills.faithnet.io is the craft and the model of the domain. That split is the product Ryan
is asking for, already running, with cards instead of a cuff.

---

## 9. The test

Wipe the card room’s Durable Objects. Alice still has her hands, her style, her questions, and
the name she trusts. The club’s *membership* is still at the Home; the projection rebuilds.
Wipe `bob-coach.svc`. She still has those records; she names someone else; the new service
reads under a new grant and does not inherit a shadow copy. Wipe Bob’s person vault: nothing
of Alice’s is there to lose. Wipe *her* vault and she has lost a year of study — which is the
definition of the record, and the reason it was never the house’s, never the club’s, and
never Bob’s.

That is my poker coach. The game is Hold'em. The substrate is why the next domain does not
need a new platform to be hers.
