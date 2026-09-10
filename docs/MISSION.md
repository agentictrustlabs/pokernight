# Fellowship with a mission — the guest at the table

Status: proposal, 2026-09-09. Author: Richard Pedersen with Claude.
Addendum to `docs/WORKSPACES.md`, which it extends and in three named places supersedes.
Read that document first; this one assumes its Club, Night, Table and Season vocabulary.

**Play together. Grow closer. Meet the mission.**

`docs/WORKSPACES.md` answered a question about logistics: a recurring game is more work to organise
than it is to play, so let the club organise itself. This document answers a question about purpose.
The evening is worth having for its own sake, and it is also an occasion — a chance for a group of
people who already meet to spend three hours getting to know an organisation doing work they care
about, as guests of each other rather than as an audience and a presenter.

The mission is a **guest at the table**, not a logo beside a donation button. Its people introduce
their work, join the conversation, answer questions, and can take a seat and play. Afterwards a
participant may learn more, ask something, stay in touch, or give. Each of those is a separate
choice, and none of them is a condition of playing, competing, or belonging.

The poker is the shared activity. Fellowship, understanding, and a relationship that continues are
the intended outcomes.

---

## 1. What this document is, and what it deliberately leaves out

This is **additive**. It does not rewrite the design it extends. Club → Night → Table → Season
survives unchanged, as does the financial boundary that keeps a club holding no money at all
(`docs/WORKSPACES.md` §12.1). Where this document changes that one, it says so by section number in
§4 and gives the reason.

**Two things are deliberately absent**, and their absence is a decision rather than an oversight.

**No named vendor.** The mission guide of §6 needs grounded answers with source attribution and a
clean handoff when the evidence runs out. Several products do that. Which one is an integration
decision, and naming one here would harden a replaceable adapter into an architectural commitment.
The requirement is stated; the supplier is not.

**No event, competition or submission framing.** The brief this addendum came from was written partly
for an event with a deadline and a judging rubric. Everything specific to that has been dropped:
tracks, criteria, demo scripts, build-window provenance. What is kept is what remains true of the
product on an ordinary Tuesday a year from now. A design document that dates itself to a deadline is
a document somebody has to un-write afterwards.

**One thing is carried forward from that brief and worth keeping in these words**: the play-chip and
separate-giving profile of §7 is a *proposal to implement*, not a description of what runs today.
Pokernight settles buy-ins on chain in Sheqels. Nothing here establishes that the Sheqel has no
redemption value, and no copy anywhere should imply it does.

---

## 2. Three people the existing design does not have

`docs/WORKSPACES.md` §1 has a host, a regular, and a newcomer. Two more arrive with the mission, and
one of them changes an assumption that runs through the whole design.

**The mission representative.** Anita works for the organisation hosting Thursday. She is invited to
one Night, not to the club. She joins the call, gives a five-minute introduction, then talks to
people for the rest of the evening. She may register to play, and if she does she takes a seat like
anybody else and sees exactly what anybody else sees. Her guest role expires when the Night does.

**The participant who does not play cards.** Sam comes for the company. He has never played
Hold'em, does not want to learn tonight, and would like to be in the room. **He must be able to
belong to the evening without taking a seat.** This is the assumption that breaks: today a Night has
a table, and being at the Night means being at the table. §5 separates them.

That separation is not a special case for one shy person. It is what makes a mission night work at
all — a representative who consumed a playing seat merely by joining the call would shrink a
nine-seat game to eight every time the guest turned up.

---

## 3. Guest dealer, game dealer, financial house

"Guest dealer" is the right words for the social role and the wrong words for everything underneath
it. Three responsibilities share that phrase and must not collapse into one.

| Role | What it is | What it must never carry |
|---|---|---|
| **Guest dealer / mission host** | Welcomes the group, shares the work, joins the conversation, may register to play. | Hidden cards, the deck, other people's private conversations, treasuries, donation records. |
| **Game dealer** | The deterministic engine. Deals, enforces the rules, moves the button. | Any personality, any host authority, any opinion about who should win. |
| **Financial house** | The settlement counterparty of `docs/WORKSPACES.md` §5.1. | Anything to do with being a guest. Inviting a mission to host must **never** make it the house. |

The screen can say *Tonight's guest dealer: Northfield Mission* while permissions enforce all three
distinctions. A guest host may not change the deck, inspect a hand, take a rake, approve a payout, or
reach a participant's account. A mission representative who plays gets an ordinary seat observation
and nothing more; hosting and playing are two hats and never worn at once.

The same rule governs the mission's **agent**. Authority to speak for an organisation is not
authority to spend a participant's money, and the two grants have nothing to do with each other.

---

## 4. What changes in `docs/WORKSPACES.md`

Section by section. Everything not listed stands.

| Section | Change |
|---|---|
| §1 narratives | Add the mission representative and the non-playing participant. State fellowship and the mission relationship as the purpose, not the logistics. |
| §2 workspace vs circle | **Keep** the `.workspace` club. Add an optional reference to the real group behind it — a life group, a men's group, a church small group — which keeps its own identity and governance. Referencing is not merging: the club never inherits the group's roster or authority, and the group survives the club being deleted. |
| §3 vocabulary | Add **MissionVisit**, **MissionProfile**, **TournamentRun**, **FollowConsent**, **DonationIntent**. Season and Tournament stay distinct, and the distinction now earns its keep. |
| §5 membership | Add a time-bounded **guest host** capability. A mission visit is not membership: no club history, no roster access, no standing after the Night ends. |
| §7.2 recurrence | **Superseded.** `{ kind: 'weekly', weekday }` becomes `{ kind: 'weekly', weekdays: Weekday[] }` — a validated, non-empty, deduplicated set sharing one local time. Tuesday and Thursday at seven is the common case and the current rule cannot express it. Different times on different days remain out of scope and need separate schedules. |
| §7.1 one schedule | A club may hold more than one active schedule. The single-schedule rule was a simplification, not a principle, and it fails the first group that plays a weekly game and runs a monthly tournament. |
| §7.1 `Night.tableId` | **Superseded.** A Night associates with *tables*, not a table. See §5 below. |
| §8 answers | Separate four things the current design conflates: answering the invitation, registering to play, being assigned a seat, and being present without playing. |
| §9 season | A one-off tournament requires **no** Season. Donations never touch standings, in either direction. |
| §12.2 no separate mute | **Superseded, and this one is a reversal.** That rule said leaving the club is how you stop its messages, on the grounds that a mute which leaves you on the roster lies to the host's headcount. That reasoning holds for *event* messages and does not survive contact with mission follow-up. Three categories now: club membership, essential event updates, and optional mission messages. A person may mute the third and stay a member. |
| §11 surfaces | A mission invitation uses the same message envelope and action card as every other invitation. No second, mission-only inbox. |
| §16 phases | One complete mission night lands before agent personalities and production multi-table scale. |

The recurrence and table changes are not preferences. The current specification permits one active
schedule, defines weekly recurrence with a single weekday, and gives a Night one table id. A group
meeting Tuesday and Thursday with a mission hosting across three tables cannot be expressed in it.

---

## 5. The two shapes an evening takes

### 5.1 The recurring group night

A leader sets Tuesday and Thursday at seven, invites the group once, and invites a mission to a
particular Night. The invitation carries the time, the game, the attendance choices **and** the
mission's introduction, so a person answers knowing who they will meet.

The evening opens in the lounge before any cards. The representative gives a short introduction and
then simply takes part. Questions can go to them out loud, or privately to the mission's guide —
which matters more than it sounds, because the question somebody will not interrupt a table to ask is
usually the one they most want answered.

A mission may return. A rotation introduces a group to many organisations; a returning guest builds
one relationship over months. Those are different goods and the product should support both rather
than choosing.

### 5.2 The one-off tournament

A different event shape, not a bigger table. One Night holds a shared introduction, several tables,
table-level conversation, synchronised breaks, a final table, and a closing word from the mission.
The mission hosts the whole event and may visit permitted tables.

**An eliminated player stays in the evening.** Busting out of the tournament returns you to the
lounge; it does not eject you from the fellowship. This is the single most important behaviour in the
tournament format and the one most easily lost by treating a Night as its table.

Registration capacity is event-wide. A player registers once, is assigned a table, and can be moved
between tables without losing their stack, their identity, or their invitation link.

---

## 6. New records

Shapes, not schemas. Each belongs to the principal named, and none of them lives in the club's own
records unless it is genuinely the club's fact.

**`MissionVisit`** — the join between a Night and a mission. Visit id, club, night, mission agent,
approved representatives, the content revision they are hosting under, the guest capabilities granted,
an expiry, and a status: `proposed → invited → accepted → active → completed`, or `cancelled`.
**Invitation is not acceptance**, and the states are separate so that a Night can honestly say
"waiting on the mission" rather than showing a guest who never agreed to come.

**`MissionProfile`** — owned by the **mission**, never by the club or the card room. The accountable
publisher, a public description, approved stories with their sources, contact route, giving
destination, and the evidence behind any verification claim. A verified agent identity says an agent
is who it says it is. It says nothing about whether an organisation is worth giving to, and the
profile must not blur the two.

**`TournamentRun`** — night, format, a frozen rules revision, the blind schedule, registrations,
table associations, seat assignments, status, and finalised results. Table ids are runtime resources;
the durable thing a person holds is their registration.

**`FollowConsent`** — a participant's choice to hear from a mission again. Channel, purpose, scope,
expiry, revocation. Recorded **separately** from club membership and from event attendance, because
it is a different decision and conflating them is how somebody ends up on a mailing list for turning
up to a poker game.

**`DonationIntent`** — payee, amount, asset or currency, purpose, expiry, the approval evidence, and
an idempotency key. Success is recorded on authoritative confirmation only. **Opening a giving link
is not evidence that a gift happened**, and a product that records it as one will overstate its own
results to the people who trust it least.

---

## 7. Giving, and the boundary around it

The recommended starting profile is **free, non-redeemable play chips, with giving entirely separate
from the game.** The first implementation of giving can be a handoff to the mission's own approved
page, or a clearly labelled sandbox transaction. A treasury-integrated version can follow the same
interaction later and needs its own scoped mandate: **the buy-in mandate is not a donation grant**,
and no amount of convenience justifies reusing it as one.

The club remains a coordinator and a scoreboard. It never becomes an intermediary balance holding
somebody's donation on its way somewhere else. That is `docs/WORKSPACES.md` §12.1 unchanged, and the
arrival of a giving flow is exactly the moment it would be tempting to change it.

Five invariants, and they are testable:

1. Declining to give changes nothing about membership, attendance, eligibility, or standings.
2. Losing chips creates no obligation to give. The two are not connected and the product never
   suggests they are.
3. Giving buys no advantage at the table and no place in the standings.
4. A host cannot see who declined.
5. Public totals, if shown at all, are opt-in, aggregated, and distinguish intended from confirmed.

A donation request names the exact recipient, amount, currency and purpose before approval, and the
payee comes from the stored `MissionProfile` — never from an address produced in a conversation.

Real stakes, prizes, rake and funds administration need jurisdiction-specific legal review, which
`docs/DESIGN.md` §11 already flags and this document does not resolve. A charitable purpose does not
by itself settle whether an activity is regulated gaming. Keeping the hosted evening on play chips
and the giving outside it is what lets the product be built while that question is answered properly.

---

## 8. Three agents, and what each may not do

The most valuable thing an agent does here is not win a hand. It is make an evening happen and help
a person understand something, without exceeding what it was allowed to do.

**The club's host agent** turns "invite our group Thursday and ask Northfield to host" into a
reviewable plan: who it resolved, what it will send, what it will do at what time. The leader
approves the plan, and the schedule, the reminders and the capacity then run **deterministically**.
A recurring reminder does not need a language model to decide whether to fire.

**The mission's guide agent** answers from approved material and cites what it used. When the
material does not answer the question it says so and hands the question to a human representative.
It never claims first-hand experience, never speaks as a missionary, and never invents a beneficiary
or an impact figure. Retrieved documents are information, not instructions: content in the mission's
pack cannot grant the agent a tool or an authority it did not already have.

**The participant's own agent** handles private questions, reminders, and explicit next steps. Its
memory belongs to its person. It does not become a fundraising profile, and nothing said to it
becomes visible to the club or the mission because a conversation happened during an event.

**The poker agents** stay, in clearly labelled practice and mixed play, where they are genuinely
useful for teaching a newcomer and filling a short table. They are a supporting capability. They are
not the point, and a product about people meeting each other should not lead with them.

The content pack is public-facing material only. Field locations, beneficiary identities, prayer
requests and private financial discussion stay out of it. A guide that could be asked "where exactly
is the team working" and would answer is a guide that should not have been given the document.

---

## 9. What to measure

Repeat attendance. Organiser effort avoided. Whether people say they came to know the mission.
Grounded-answer quality, measured as *cited or handed off*, never as answers produced. Requested
follow-ups, which are consented and therefore meaningful.

Donation totals are one outcome among several and must not become the definition of fellowship.
Do not rank generosity. Do not infer anybody's faith from their attendance. Do not treat time spent
in the product as evidence that it did any good.

---

## 10. Build order

Each step is usable before the next begins, and none leaves a half-built object in the data.

1. **`MissionProfile` and `MissionVisit`**, with the guest-host capability time-bounded to one Night.
   Nothing about tournaments, nothing about giving. A mission can be invited, can accept, and appears
   on the Night.
2. **The mission night invitation and arrival** — the existing card, carrying the mission, and a
   lounge a person can be in without a seat. This is where §2's non-playing participant lands and
   where the Night stops meaning its table.
3. **Grounded questions** — the guide, its approved pack, citation, and the handoff when it has no
   answer. The handoff is the feature; answering is the easy half.
4. **`FollowConsent`** — one bounded opt-in, revocable, separate from membership.
5. **Giving as a handoff** — `DonationIntent`, the five invariants of §7, and no treasury.
6. **`TournamentRun`** — two tables, one registration, movement between them, and the lounge that
   survives elimination.

Steps 1 and 2 are worth doing even if nothing after them is, because together they are the whole of
"the mission is a guest" and the rest is elaboration.
