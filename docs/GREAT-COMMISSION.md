# Great Commission — a substrate test played as a game

> **The default night is *Thursday in Greeley*** (2026-09-17): Weld County, Colorado, five real people groups
> cited by ROP id, invented households, and the part that carries it out of the room drawn by the seed. The
> Kettlewater marches remain as the invented twin. §4 and §5 below describe the shape; the county's own figures
> and the fence around them are in `~/skills/ontology/weld.ttl`.

**Source:** Paul Martel's concept note, *A Great Commission tabletop on the Mystery Night engine — a substrate test* (2026-09-17), read with the CAS brief, the four-conditions sequencing brief and the movements history. This document records how that note becomes the third game in this room, what is reused from Mystery Night, what is genuinely new, and the lines the game must never cross.

## 1 · The idea in one paragraph

Mystery Night already has what a substrate test needs: a cast of agents with private knowledge, rooms they move between, real people cast into roles, every action through Home, and memory that carries to the next night. Great Commission re-skins it. The hidden truth is no longer who committed the murder; it is **where, in a fictional region, the gospel is moving and where it is not.** The cast is the Great Commission's actual mix of agents. The cooperating characters try to assemble a true shared picture from what each holds in a vault. One adversary reads the same coarsened signals and tries to locate a believer. **The rails pass if the picture finds the motion before the adversary finds the person.** Detection and safeguarding are tested in the same run — the thing Home has to do in production and has not yet been made to do under pressure.

## 2 · Two rules that keep it honest, written as engine invariants

**Growth is exogenous.** The world engine holds each fictional people's hidden state and moves it on its own schedule, drawn from the seed the host committed to before the night began. *No character action produces a conversion, and no mechanic scores who might respond.* Carriers act freely — go, stay, tell, gather — and what comes of it is the engine's, opaque to them. Players detect, testify, resource, or miss. This is the CAS brief's boundary (carriers are agents; recipients are never modelled) as a rule the code enforces: there is no action whose handler touches a people's `truth`.

**Everything is fictional.** Invented peoples, invented geography, synthetic vault contents. The exercise rehearses an attack on presence data, so no real people-group name appears anywhere in it, and the region is authored as content (§7) under a name that could not be mistaken for a place.

**One more, from the analysis of the note.** The engine's per-people value is the simulation's **ground truth** — the hidden event state of the fictional world — and is never called the "true phase". A phase is an *assessment* made from testimony; the game scores the published assessment against the hidden events, and keeps the two words apart so nobody reads the game as saying the real picture could know such a thing if only it collected enough.

## 3 · It is a game, so it is a package

Mystery Night's rule is *one engine, many titles as content*. That holds for mysteries. Great Commission has a different hidden truth, a different verb set and a different score, so it is what the card room's own layout rule says a new game is: **a package with its own pure engine (`packages/commission`), a host object (`CommissionDO`), routes (`/commissions/*`), a page, a protocol binding (`commission.act` · `commission.direct` · `commission.consult`), cast personas and archetypes** — and one line wherever a game is registered. It shares no code with `packages/mystery`; it shares every *pattern*: the seeded draw and commitment, the act clock, the capped log, `clone` at the one door every change passes, `saw` on every room-scoped event, `viewFor`/`redactEvent`, `parseAction`/`apply` with the game refusing by name, `chooseAction` as the house's own policy, the cast table, the takeover.

## 4 · The world

A **region** (the venue) is a set of **peoples** and a set of **rooms that are workspaces**.

- Five peoples. **Who a people is and where they are are two things**, as the faith ontology keeps them (revised 2026-09-17 — the first draft subclassed `gc:PeopleGroup`, which is not a class): `cm:People` is a `gc:PeopleGroupIdentity` — a named identity drawn from an invented register, carrying no phase, place or status — and **`cm:PeopleCommunity` is a `gc:PeopleCommunity`, the key class of the game**: the enduring body of one people in the place they gather, the only kind of thing a phase may be claimed of. Each community has hidden ground truth: a **phase** on the Phases of Engagement sequence (0 Waiting · 1 Entry · 2 Evangelism · 3 Discipleship · 4 Local Church · 5 Reproducing Church · 6 Multiplying Church · 7 Sustained Gospel Presence; **0-R** a restart indicator), a **strength** (Unknown · Initial · Growing · Active · Flourishing), a **schedule** of phase moves per round, and the fine end the adversary wants — a **household circle** (`gc:FormationCommunity`: the carrier's kin who meet, no church behind them yet), which gathers in **one village** (`gc:NeighborhoodCommunity`) and counts **so many households**. Phase 4 on the ground is a circle recognized as a church, which mints a new body (`gc:EkklesiaCommunity`) rather than retyping the circle.
- **The grain axis is five faith classes, not five words:** person (`at:Person`) < household (`gc:FormationCommunity`) < village (`gc:NeighborhoodCommunity`) < province (`gc:PeopleCommunity`) < people (`gc:PeopleGroupIdentity`). "You may coarsen, never refine" is a walk up that ladder. A published reading is a `gc:CommunityPhaseResult` and says `gc:assignedLevel`; the hidden state says `cm:phase`, deliberately not a sub-property of it, so nothing can infer the world's fact is an assessment.
- Rooms: the **commons** (the convener's cross-organization workspace), the **agency office**, the **household** (the network's own room), the **research desk**, the **funders' table**, and **the road** (where the returnee is when she is not in a room). Each room carries a **disclosure rule**: the finest grain that may be spoken there. Moving between rooms is joining or leaving a workspace, and the convener admits.

The Toolkit vocabulary is © 2026 Phases of Engagement Collaborative, CC BY-NC-SA 4.0, encoded from the published form under its own names and attributed. The conversational walk follows Bud Houston's 2026-09-17 commentary, which is one member's wording and not the Toolkit text.

## 5 · The cast — seven, matching the engine

| Part | Holds in its vault | Why it is in the cast |
|---|---|---|
| Returnee | Own whereabouts, the kin network back home | Highest-yield carrier in the ignition record; absent from the people when the picture is taken |
| Lay household network | Who meets, where, how many generations | The unit growth runs through; the grain that must never travel |
| Sending agency | Worker deployments | Organization-grain testimony, structurally blind to the two above |
| Funder | Grants, criteria | Presses for headcounts — the "one million" failure mode |
| Researcher | Published assessments | Runs the phase walk; owns the public reading |
| Convener | Membership, workspace | Hosts the cross-organization room |
| Adversary | Nothing legitimate | Assembles presence at dangerous grain |

Each is played exactly as a mystery's part is: by a person, by a person's own persona agent chartered for it (the eight-step road `docs/…` and `scripts/charter-cast.mts` already walk), or by the house's rules. **The neutral steward is not a character. It is the rails.** If someone can play it, it has become a controller.

**The funder is not a villain.** The note's funder only presses for headcounts; the analysis is right that this makes a caricature. Here the funder holds a legitimate mandate — *allocate scarce resources responsibly and demonstrate stewardship without gaining access to identities or unsupported precision* — and the test is whether the instrument can satisfy a real accountability need without forcing unsafe disclosure. The pressure is real because the need is.

## 6 · Verbs, and what the engine records for each

Every action is validated by the engine and refused by name, like a mystery's. The verbs a scene may use:

- `move {room}` — join or leave a workspace. Refused if the room's membership does not admit the part.
- `say {text}` · `whisper {to, text}` — as a mystery. Heard by whoever is in the room *at the time* (`saw`).
- `testify {people, evidence, grain, to?}` — **a permission slip**: project one item from your vault at a chosen grain, to the room or to one person. You may coarsen, never refine. The engine records a **Disclosure** with its intended grain — and a **leak** when the grain spoken is finer than the room's disclosure rule allows.
- `assess {people, phase, strength}` — the researcher publishes a reading. Recorded with its **corroboration count**: how many *distinct* witnesses' testimony, received by the researcher, supports at least that phase — a number, never which witnesses.
- `corroborate {people, phase}` — a witness confirms a reading without revealing content. Increments the count.
- `commit {people, need, resource}` — the intent spine, thin: a typed need is emitted by each assessment (*what kind of worker a people needs next*), and the funder or agency makes an offering against it. A commitment nobody carries out stays **visibly stale**.
- `revoke {evidence}` — withdraw a slip. Later reads are refused; prior reads remain in the signed log; a later use of the revoked item by anyone is recorded as a **replay**.
- `infer {people, village?, households?}` — the adversary's move: a claim about where and who. Scored at the reveal against ground truth.
- `choose {choice, option}` — as a mystery: choices written for a part, whose consequences set outcomes and never touch canon.

There is deliberately **no verb that changes a people's ground truth.** That is Rule 1 as code.

## 7 · Rounds, nights and memory

Three **rounds** stand in for years; each is an act with a clock. At each interlude the world moves: the seed's schedule advances some peoples, stalls one, and reverses one; carriers' vaults gain what their position lets them see. The reveal opens the commitment and shows the ground truth.

A **night** is one staging; the smallest version is two nights so memory and 0-R get used. Night two opens from night one's published assessments, and the returnee has gone silent. The right move is to mark Phase 0-R; the wrong one is to let the old claim read as current. The engine scores which happened.

## 8 · Scoring — so every night is a regression test

Computed by the engine at the reveal, from the log, and shown to everybody:

- **Detection** — per people, the final assessed phase against the hidden event state, and how many rounds the picture lagged.
- **Exposure** — the adversary's final inference (where, who) against ground truth.
- **Leaks** — every disclosure that exceeded its room's grain, and every replay of a revoked slip.
- **Fabrication** — every number a character asserted that its vault did not support.
- **Staleness** — every claim still read as current after its carrier went silent.

The comparison that matters is the same scenario, same seed, before and after a substrate change.

## 9 · What each run should exercise (from the note), and where each lands

1. Discovery through signed cards and the registry — the cast's own cards, as today; the adversary's spoofed card fails the domain-binding check (a Home concern, exercised by casting).
2. Permission slips — `testify` at three grains to three audiences.
3. Person-held vaults and org-scoped pseudonymity — the returnee is accountable to the convener and visible to nobody else (the `household` room's rule).
4. Corroboration without exposure — `corroborate`, and the count on an assessment.
5. The intent spine — `commit`, and a commitment that stalls and stays stale.
6. A cross-organization workspace — the commons, its first exercise.
7. Revocation mid-run — `revoke`, and the replay record.
8. Memory across nights — night two and 0-R.
9. Pressure for precision — the funder's demand and the fabrication record.

## 9a · The place, and the wall

**Break-off spaces are the grains.** The club room's fireside, table and bar are places you *sit* to do a kind of talking. Here the kinds of talking are the game's own: every workspace carries a disclosure rule, so breaking off into a room is choosing the grain you may speak at — and the meeting house at Kettlewater (`~/skills/ontology/kettlewater-house.ttl`, under `place.ttl`) furnishes each room for its rule. The commons is the long hall, with the map of the marches on the end wall and the post-it wall beside the door — province grain, everybody. The household room is a hearth with three chairs — the fireside, where household grain may be said, and the door is the only thing between that sentence and the commons. The agency office is a desk, a roster and a ledger; the research desk a slate with the seven questions; the funders' table is round so nobody sits at its head; the road is outside, where the returnee is alone. The room ids are the workspace ids, joined on one string apiece, so the room a player walks into and the room whose rule binds what they may say are the same room by construction. There is no anchor of role "repose": nobody dies here.

**The wall is anonymous by construction.** `post` puts a topic on a room that has a wall; the event carries no author, no view ever does, and the author sits in state for the score alone. An unattributed people-grain sentence is the safest contribution the whole exercise allows, and a board of them is how a group finds what it wants to talk about without anybody having to be the one who asked.

**Messaging.** A whisper is already private and 1:1 — the shape of a direct message between two parts' agents at their Homes (`messaging.direct.send`); room talk and post-its are the shape of a post in the club's board (`messaging.topic.post`). **Whispers go over A2A now** (2026-09-17): the card room is each cast agent's own runtime on the standard surface (an ask wire pinned to `harness.ask`), and derives each message's mandate from a standing grant the custodian signed once — `apps/tables/src/cast-messaging.ts`, the ceremonies in the estate's `equip-cast-messaging.mts`. The words land in the hearer's inbox under the speaker's name, with the speaker's own copy beside it, so a person's Home shows every whisper their character received. **Room talk goes to the club's board (2026-09-18).** The same road with `messaging.topic.post`: the club's own agent opens an open topic titled for the night (`club.topic` on the Home's club door, idempotent by title; the channel id is stamped on the night's meta as `topic`), and every line SAID in a room by a part with a persona is posted there from that persona — Ruth's line typed by Alice arrives from `ruth-alice.me`. Two ceremonies per club make it possible (the estate's `equip-cast-board.mts`): the club's host INVITES each cast persona into the workspace (`org.invite:agent:<sa>`, which is what the organization's object checks before it admits a member's post), and each standing grant is re-minted with both verbs and the club among its locations. A night of your own has no club and no board. POST-ITS STAY IN THE ROOM: the wall is anonymous by construction, and a post under a character's name would print the one thing it exists not to say. Proven live in Alice's club: 23 posts from seven personas in the night's topic.

## 10 · What is reused, exactly

The Durable Object shape (presence, attention, `heard`, the host's hold, the readiness doorway, the agent cast on the alarm, the director asked for words); the club's night and the solo night; the cast list and the takeover; the transcript, the inspector, the host controls and the huddle on the page; the protocol's scene envelope; the estate scripts that charter a persona, link it, vault it, card it and assign its archetype. The 3D venue is **not** reused: the rooms here are workspaces, not a hotel, and the page draws the region as a map of five peoples and the rooms as a rail.

## 11 · What this does not claim

It moves no component past M1. It carries no real data. It is not the first real flywheel turn and it yields to the committed loop-close on any conflict. It is a laboratory for the machinery that will support the sensitive version of that loop, run on synthetic data and fictional peoples only.
