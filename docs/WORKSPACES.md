# Clubs, nights and seasons — the workspace above the table

Status: proposal, 2026-09-09. Author: Richard Pedersen with Claude.
Companion to `docs/DESIGN.md`, which describes everything below the table. Read that first.

**Phase A is built** — see §16 for what that covers and §19 for what it does not.
**`docs/MISSION.md` extends this document** and supersedes three parts of it: the weekly recurrence
rule (§7.2), a Night's single table (§7.1), and the no-separate-mute rule (§12.2). Each is marked
below.

Today a table is the largest thing Pokernight knows about. Anyone can open one, anyone can see every
table that exists, and the only way a person learns that a game is happening is that somebody tells
them somewhere else. `docs/DESIGN.md` §4 already names the missing object — "Poker night / club,
context `circle`, `friday-night.circle`, membership decides who may sit; owns the lobby" — and that
document's §7 already says `LobbyDO` performs a "membership check". Neither exists in code. `circle` is a free-text
string that selects which `LobbyDO` instance is used and is never validated, never persisted on the
table, and never authorized against.

This document specifies that object and everything that hangs off it: a **club** with **members**, a
recurring **night** that members are **invited** to and **answer**, a **table** that the night opens
when it starts, and a **season** that adds up the results.

Sections 1–3 are what it is. Sections 4–9 are the model. Sections 10–12 are the machinery.
Sections 13–16 are how it gets built. Sections 17–18 are what other people learned and what could
still go wrong.

---

## 1. What a person does

Three narratives. Everything in this document exists to serve one of them.

**The host.** Barb signs in at poker.faithnet.io and presses "Start a club". She names it Thursday
Night, and her Home asks her to approve one thing: creating a workspace agent she custodies. She adds
six friends by name and two by email. She sets the night: every Thursday at 8pm Mountain, 1/2 blinds,
40–200 buy-in, nine seats. She presses "Send it". Nothing else is required of her, ever again — the
club sends the invitations, opens the table, and posts the standings.

**The regular.** Marcus gets a message at his Home on Monday: *Thursday Night, this Thursday at 8pm.
Six going.* He presses **I'm in**. On Thursday at 7:45pm he gets a second message: *Thursday Night
starts in fifteen minutes.* He presses it, lands on the table with his seat already reserved, and his
buy-in comes out of his own treasury under a mandate he approved once. At the end of the night the
club tells him he is third in the season with four nights to go.

**The newcomer.** Elena has never used the card room. She gets an emailed invitation from Barb. She
follows it, her Home creates her an account, a treasury, and ten thousand Sheqels, and hands her back
to the club with her membership already recorded. She answers the invitation and sits down on
Thursday. She never learns the words "delegation", "mandate" or "workspace".

Everything that follows is in service of those three, and any part of this design that makes one of
them press a button they should not have to press is wrong.

---

## 2. The naming decision: this is a workspace, not a circle

`docs/DESIGN.md` §4 says `friday-night.circle`. **That is wrong, and this document supersedes it.**
The club is a `.workspace` agent. The reasoning is worth writing down, because the two are genuinely
close and the estate supports both.

The Agentic Primitives naming grammar
(`~/agenticprimitives/packages/agent-naming/src/constants.ts`) admits ten typed suffixes, and both
are among them:

```
AGENT_TLDS = ['me','org','team','svc','workspace','treasury','registry','church','circle','household']
```

Both are also **context types**, meaning either can issue scoped names to agents beneath it
(`grammar.ts:58`):

```ts
const CONTEXT_TYPES: ReadonlySet<DerivedAgentType> =
  new Set(['org', 'team', 'workspace', 'church', 'circle', 'household']);
```

They diverge on agent class. `packages/agent-profile/src/derived-type.ts` decides which profiles each
suffix may wear:

```ts
case 'workspace': return ['service', 'mcpServer'];
case 'circle':    return ['circle', 'multisig'];
```

A `.circle` is **org-class** — a small-group-shaped organization. A `.workspace` is **service-class**.
In the Home, an org-class agent gets the Members panel (`MemberRoster.tsx`), the invite panel
(`OrgInvitePanel.tsx`), discussions, applications and entitlements. A service-class agent gets
`ServiceWorkspace.tsx`, whose own copy states the pattern exactly:

> The roster still lives at `gather27:organizations`; `gather27-a2a` reads it over the
> `service-agent-wire`, not this portal.

That is the deciding sentence. **A workspace is the shape the estate uses for "a relying app holds a
roster in an agent's vault and gates its own calls on it."** That is precisely what the card room is.
A circle is the shape for "a group of people who are an organization, whose Home renders their
membership as a first-class relationship." The club is the first thing, not the second: Thursday
Night is a game, not an institution its members belong to in the way they belong to a church.

Three further facts settle it beyond preference:

1. **The Home already has a workspace membership ceremony.** `POST /connect/workspace-invite`
   (`apps/demo-sso-next/server/connect/workspace-invite.ts`) is a two-leg, single-use handoff built
   for exactly this: the custodian signs the member's access in, the member claims it into their own
   tree, seven-day expiry. The curated delegation templates `workspace-create`,
   `workspace-member-invite` and `workspace-join` exist and are already granted to another relying
   app. Nothing has to be invented.
2. **The huddle scope enumerates `workspace` and not `circle`.** `HuddleScopeV1.kind` is
   `'conversation' | 'topic' | 'org' | 'team' | 'workspace'`. §6 below builds the table as a
   huddle-shaped run under a scope; choosing `circle` would put us outside a type the substrate
   already admits.
3. **`RoleScopeKind` enumerates `workspace`** (`packages/organization/src/roles.ts`), so role
   assignments scoped to a club are expressible without extending anything.

So: **a club is a `<label>.workspace` agent**, custodied by the person who created it, whose vault
holds the roster, the nights and the season. In product copy it is called a **club** and never a
workspace, because nobody organizes a poker game in a workspace.

`.circle` is not retired — it stays the right answer if a group ever wants to *be* something between
games. It is simply not what a card room needs, and `docs/DESIGN.md` §4's table row should be updated
to say so.

---

## 3. The vocabulary

Four nouns, and they are kept apart deliberately because three of them are words poker already uses
for something else.

| Word | What it is | What it is NOT |
|---|---|---|
| **Club** | A `.workspace` agent with members. Owns nights, tables and a season. | Not a table. A club with no game scheduled is still a club. |
| **Night** | One scheduled occurrence: a time, a stake, a seat cap. Members are invited to it and answer. | Not a table. A night exists before the table does, and outlives it. |
| **Table** | What `PokerTableDO` already is. A night opens one when it starts. | Not a night. A table can still be opened without one (a pickup game). |
| **Season** | A cumulative standing over a club's nights, with a start, an end and a scoring rule. | **Not a tournament.** |

That last row is the one that costs something. The request called the cumulative leaderboard a
tournament, and this document deliberately does not, because **tournament** already means a specific
thing in `docs/DESIGN.md` §1 ("Sit-and-go tournaments later") — one table, escalating blinds, play
until one player has the chips. Both features are wanted and they are different objects. Using one
word for both would make every later sentence about blind structure ambiguous. So: a **season** adds
up cash-game results across nights; a **tournament** is a future single-night format. A season may one
day be scored over tournaments as well as cash nights, which is another reason not to name it after
one of its inputs.

---

## 4. What the substrate already gives us

The most valuable output of this design work is knowing exactly which parts are free. Verified
first-hand against `~/agenticprimitives` at 2026-09-09.

| What we need | Substrate artifact | Status |
|---|---|---|
| A named, custodied club agent | `.workspace` TLD; `workspace-create` template | **Ships.** Used by Field and Gather27. |
| Roster in the club's vault | Workspace vault records; roster read over `service-agent-wire` | **Ships.** |
| "Is this person a member?" | `deriveStanding` (`packages/context/src/standing.ts`) → `self`/`steward`/`member`/`none` | **Ships.** |
| Invite an existing agent | `POST /connect/workspace-invite`, templates `workspace-member-invite` + `workspace-join` | **Ships.** |
| Invite by email | `POST /connect/app-invite/email` — `{ email, returnUrl, app }`, Home is the mailer | **Ships.** App-scoped, not org-class. Gather27 uses exactly this. |
| Membership shapes | `MembershipClass = 'standard'|'guest'|'external'|'observer'`; `EnrollmentSource` incl. `invite-link` | **Ships** as types (`packages/organization`). |
| Roles scoped to a club | `RoleScopeKind` includes `'workspace'`; `CANONICAL_ROLE_NAMES` | **Ships** as types. |
| A room under a scope, with admission | `@agenticprimitives/collaboration` huddle: `HuddleScopeV1`, `admissionFor`, invitations with outsider approval | **Ships**, and is the pattern §6 copies. |
| A message to a person | `@agenticprimitives/fabric` messaging: `MessageEnvelopeV1`, `inbox.data` in the recipient's vault | **Ships.** |
| A card with buttons in that message | `ActionCardV1` (transport) + `HomeActionCardV1`/`resolveCardAction` (render) | **Ships, but the kinds are wrong.** See §14. |
| **A calendar. Recurrence. A scheduled event.** | — | **ABSENT.** |

That last row is the headline. There is no calendar, event, occurrence or recurrence primitive
anywhere in the substrate. A repository-wide search for `calendar`, `rrule`, `recurrence`,
`scheduledFor`, `startsAt` and `occurrence` across every package returns one hit, and it is a
reservation rather than an implementation — `packages/coordination/src/projections/index.ts`:

```ts
// Reserved API surface for spec 333/334 (derived read models — board, calendar, My Work).
// No logic ships here.
export const PROJECTIONS_STATUS = 'reserved-spec-333';
```

and spec 334's own table lists `Calendar | milestones, deadlines, availability, scheduled rules |
later`. **Scheduling is Pokernight's to build.** §7 specifies it as a small, self-contained, pure
module so that it can be lifted into `@agenticprimitives/coordination` unchanged when that wave
arrives — which is the single most useful thing this project could contribute back.

---

## 5. Membership: derived, never asserted

The club's roster lives in the club's own vault. A relying app never tells the substrate who is a
member; it asks. This is not a stylistic preference — `packages/context/src/standing.ts` opens with
the rule and the reason:

> DERIVED, NOT ASSERTED. An app that told us "this person is a steward" would be supplying an
> authorization claim, which is the pattern ADR-0041 forbids.

`deriveStanding(deps, { principal, subject })` returns one of four relations, in this order of
evidence: `self` (you are the club), `steward` (you hold a stewardship delegation from the club that
is ERC-1271-valid against it, unrevoked on chain, and of governance *shape* — a member's data grant
does not count), `member` (the club records you, or you record the club, or you are in its published
listing), and `none` (looked everywhere, found nothing).

Pokernight maps the four onto three club roles:

| Standing | Club role | May |
|---|---|---|
| `self` / `steward` | **Host** | Everything: schedule, invite, remove, cancel, set the season, retire the club. |
| `member` | **Regular** | See the club, its nights, its roster and its standings. Answer an invitation. Sit at its tables. Invite a guest, subject to §5.2. |
| `none` | **Stranger** | Nothing. A club is not discoverable by a stranger and its existence is not confirmed. |

**Standing is derived per request and cached nowhere.** `apps/demo-a2a/src/index.ts` shows the exact
recipe the tables Worker copies (`huddleStandingFor`), and it is worth quoting because the shape is
the specification:

```ts
if (scope.principal === caller.toLowerCase()) return 'steward';
const standing = await deriveStanding({
  readSubjectRecord,
  verifyStewardship: chainStewardshipCheck({ readContract, chainId, delegationManager,
    allowedTargetsEnforcer, vaultRecordScopeEnforcer, isRevokedAbi, validatorAbi, validator }),
}, { principal: caller, subject: scope.principal }).catch(() => null);
return standing?.relation === 'steward' || standing?.relation === 'self' ? 'steward'
     : standing?.relation === 'member' ? 'member' : 'none';
```

The Worker verifies the caller's session, derives their standing, and hands the Durable Object
`{ actor, standing }`. **The Durable Object never sees a session and never derives anything.** That
separation is what makes the DO testable and what keeps one authorization decision in one place.

### 5.1 Guests

`MembershipClass` already has the word for the friend somebody brings once: `guest`. A guest is
recorded on the club with a validity window covering exactly one night. They may sit at that night's
table and see nothing else. They do not score in the season unless the host says guests score
(§8.4). When the window passes the membership is not deleted — it expires, which is a different fact
and a better one, because "Elena played once in March" is worth being able to answer.

### 5.2 Who may invite

Default: **hosts only.** A regular pressing "bring someone" creates a *proposal* the host approves,
which is exactly the outsider path the huddle already models — `HuddleInvitationV1.outsider` with
admission parked until `approvedBy` is set:

```ts
if (inv.outsider && !inv.approvedBy)
  return { ok: false, reason: 'your invitation is waiting on a steward’s approval', parks: true };
```

A club may set `guestPolicy: 'host-only' | 'members-may-invite' | 'members-may-propose'`. The default
is `members-may-propose`, because the failure mode of the alternative is a host who has to be awake
for a game to fill, and the failure mode of `members-may-invite` is a stranger at a table where real
money settles.

### 5.3 One seat per owner

`docs/DESIGN.md` §11 already names the rule and puts it here: *"Enforce one seat per owner per
table in the lobby."* The club is the lobby now, so it is the club that enforces it. Two agents whose
owner relationship resolves to the same principal may not both be seated at one table. This matters
more with a club than without one, because a club is exactly where somebody would keep a stable of
agents.

---

## 6. The table, re-founded under a scope

Today `POST /tables` takes a `circle` string, uses it to pick a `LobbyDO`, and forgets it. There is no
authentication on the route at all. That changes.

### 6.1 The table belongs to the club, pinned at creation

A table gains three fields on `TableMeta`, stamped once at creation and never re-read, by the same
rule and for the same reason as `chipValue` and `asset`:

```ts
export interface TableMeta {
  tableId: string;
  name: string;
  settlement: SettlementMode;
  createdAt: number;
  chipValue?: string;
  asset?: string;
  assetSymbol?: string;
  club?: string;      // the workspace agent's address, lowercased. NEW.
  clubName?: string;  // its display label at creation. NEW.
  nightId?: string;   // the night that opened it, when a night did. NEW.
}
```

`club` is pinned for the same reason `asset` is: it makes "whose table is this?" a question about the
table's own data rather than about a variable somebody could repoint. A table whose club has been
retired still knows what it was, and its hand history still means something.

A table with no `club` is a **pickup table** — exactly what exists today, still reachable, still
listed on the public lobby. Pickup tables are how a stranger tries the card room without being
invited to anything, and deleting that would be a regression.

### 6.2 Admission is huddle-shaped

`PokerTableDO` becomes the serving-plane object for a scope, in the shape `HuddleRoomDO` already
uses. The parallel is close enough to be worth stating plainly: **a poker table is a huddle whose
provider is a card game instead of a media server.** Both are a durable room under a scope, both
admit on derived standing plus per-run invitations, both end on an empty-room grace, and both keep
serving-plane state that is a rebuild rather than a bereavement if lost.

The scope is `{ kind: 'workspace', principal: <club address>, id: <tableId> }`. Seat admission
becomes a function of standing, mirroring `admissionFor`:

| Table `club` | Caller standing | May take a seat |
|---|---|---|
| unset (pickup) | anything | yes |
| set | `steward` / `member` | yes |
| set | `none`, holds an unexpired invitation to this table's night | yes, admitted on `ground: 'invitation'` |
| set | `none`, no invitation | **no** — "this table belongs to a club you are not in" |

Spectating follows the same rule, with one deliberate difference: a club table is not *listed* to a
stranger at all. `GET /tables` returns pickup tables plus the tables of clubs the caller has standing
in, and a stranger asking for a club table by id gets 404, not 403. A 403 confirms that the club
exists, and the club's own membership read (`membership-read.ts`) makes the same choice for the same
reason — an empty list reads as "this organization has nobody in it", which is a different and false
statement.

### 6.3 What this fixes today

Adding a club is also the fix for three things that are wrong right now, independent of any of this:

- `POST /tables` has **no authentication whatsoever**. Any unauthenticated caller can create tables in
  any lobby, forever. After this, creating a club table requires host standing; creating a pickup
  table requires a session.
- `GET /tables` shows every table in the `default` lobby to a signed-out browser.
- `POST /tables/:id/seat-agent` requires *a* session but performs no ownership check, so any signed-in
  person may seat an agent at anyone's table.

---

## 7. Nights: the scheduling layer Pokernight has to build

§4 established that the substrate has no calendar. This section specifies the smallest one that does
the job, designed so that it could be lifted into `@agenticprimitives/coordination` unchanged.

### 7.1 A rule and its occurrences are different objects

The single most common way a scheduling feature goes wrong is treating "every Thursday at 8" as one
row and computing dates from it forever. Then a host cannot skip a week, cannot move one game to
Friday, cannot cap one night at six seats because someone is travelling, and cannot answer "who came
on the 12th" after the rule has changed. So there are two objects.

**`ClubSchedule`** is the rule. There is at most one active schedule per club, plus any number of
retired ones kept for history.

```ts
export interface ClubScheduleV1 {
  version: 'pokernight.club-schedule.v1';
  scheduleId: string;
  club: Address;
  /** Local wall-clock start, NOT an instant: '20:00'. */
  startLocal: `${number}${number}:${number}${number}`;
  /** IANA zone the wall clock is read in: 'America/Denver'. */
  timezone: string;
  recurrence: Recurrence;
  /** Defaults every night inherits and may override. */
  defaults: NightDefaults;
  /** No occurrence is materialised before this instant. */
  activeFrom: number;
  /** …or after this one. Absent = open-ended. */
  activeUntil?: number;
  createdBy: Address;
  createdAt: number;
  status: 'active' | 'paused' | 'retired';
}
```

**`Night`** is one occurrence — materialised, durable, individually editable.

```ts
export type NightStatus =
  | 'scheduled'   // in the future, invitations may or may not have gone out
  | 'open'        // its table exists and is accepting seats
  | 'playing'     // hands are being dealt
  | 'finished'    // the table closed and results were recorded
  | 'cancelled'   // the host called it off
  | 'skipped';    // the schedule generated it; the host removed just this one

export interface NightV1 {
  version: 'pokernight.night.v1';
  nightId: string;
  club: Address;
  /** The schedule that generated it. Absent for a one-off night. */
  scheduleId?: string;
  /** The resolved instant, computed once at materialisation from (startLocal, timezone, date). */
  startsAt: number;
  /** Carried so a later timezone-database change cannot silently move a past night. */
  startLocal: string;
  timezone: string;
  status: NightStatus;
  title?: string;
  note?: string;
  stake: NightStake;          // blinds, buy-in range, seats, settlement, chip rate
  seatCap: number;
  /** Set when the night opens its table.
   *  SUPERSEDED by `docs/MISSION.md` §4: a Night associates with TABLES. A tournament runs several
   *  at once, and a person's durable hold is their registration, not a table id. */
  tableId?: string;
  /** Season this night scores into, pinned at materialisation. */
  seasonId?: string;
  createdAt: number;
  cancelledAt?: number;
  cancelledBy?: Address;
  reason?: string;
}
```

Editing the schedule changes **future** occurrences only, and only ones nobody has answered yet. A
night somebody has already said yes to is theirs as much as the host's; moving it silently is the
behaviour that makes people stop trusting a calendar. Moving such a night is allowed, but it is an
explicit act that re-notifies everyone who answered and shows them what changed.

### 7.2 Recurrence, deliberately tiny

RFC 5545's `RRULE` is the standard and it is enormous. Pokernight implements the subset a poker night
actually uses, in a shape that is a strict subset of `RRULE` semantics so that emitting a real
`RRULE` later is a serialisation change rather than a redesign.

```ts
export type Recurrence =
  | { kind: 'once' }
  | { kind: 'weekly';   weekday: Weekday; interval?: 1 | 2 | 3 | 4 }
  | { kind: 'monthly-nth'; weekday: Weekday; nth: 1 | 2 | 3 | 4 | -1 };
```

> **Superseded by `docs/MISSION.md` §4.** `weekly` takes a `weekdays: Weekday[]` — a validated,
> non-empty, deduplicated set sharing one local time. A group meeting Tuesday and Thursday at seven
> is the common case and one weekday cannot express it. Different times on different days still need
> separate schedules, and a club may hold more than one active schedule.

`{ kind: 'weekly', weekday: 'thu' }` is every Thursday; `interval: 2` is every other Thursday;
`{ kind: 'monthly-nth', weekday: 'fri', nth: -1 }` is the last Friday of the month. That covers every
home game anyone actually runs. Daily, hourly, by-month-day, `COUNT`, `BYSETPOS` and the rest are not
implemented and are refused by name at the API rather than accepted and ignored.

### 7.3 Wall clock, not instants — and why

`startLocal` plus `timezone` is stored; the instant is derived. Storing `20:00 America/Denver` and
resolving per occurrence means the game stays at 8pm through a daylight-saving transition. Storing an
instant means it becomes 7pm or 9pm in November, which is the single most reported bug in every
recurring-event product, and one this design should not have to learn a second time.

The resolved `startsAt` is written onto each `Night` at materialisation and is then **immutable**.
This is the same doctrine as the chip rate and the asset stamp in `docs/DESIGN.md` §5: read once, pin
it, never re-derive. A tzdata update that shifts a rule must not retroactively move a night people
already attended.

Workers have `Intl.DateTimeFormat` with full IANA support, so zone resolution needs no dependency.
The conversion is a pure function in `@pokernight/protocol` with property tests across every DST
boundary in the last and next ten years for a handful of representative zones.

### 7.4 Materialisation, and the horizon

Occurrences are generated ahead, not on demand. A `ClubDO` alarm runs a **materialiser** that keeps
the next `HORIZON_NIGHTS` (default 8) occurrences of every active schedule existing as durable rows.

Ahead-of-time materialisation is what makes the rest of the feature possible: an invitation cannot be
sent to an occurrence that does not exist, an RSVP cannot be recorded against a computed date, and
"who is coming on the 12th" cannot be answered by a generator. It also bounds the work — the
materialiser is idempotent, keyed by `(scheduleId, localDate)`, so running it twice creates nothing.

### 7.5 The clock

One `ClubDO` alarm drives everything, set to the earliest of the pending deadlines, in the same
pattern `PokerTableDO.scheduleAlarm` already uses:

| Deadline | Default | What fires |
|---|---|---|
| Materialise | daily | Top the horizon back up to 8 nights. |
| Announce | `startsAt − 72h` | The invitation goes out to every member. |
| Nudge | `startsAt − 24h` | A reminder to anyone who has not answered. Once, never twice. |
| Open | `startsAt − 15m` | Create the table; message everyone who said yes with the link. |
| Last call | `startsAt + 20m` | Only if the table is under the minimum to deal. |
| Close | table empty for 30m | Finish the night, record results, update the season. |

Every one of those is per-club configurable and every one can be turned off. The defaults are chosen
so that a host who configures nothing gets a working poker night, which is the point.

**The nudge is once.** Products in this space fail by nagging; §17 has the evidence. A person who has
not answered by the day of the game has communicated something, and the correct response is to stop
asking them, not to ask harder.

---

## 8. Invitations, answers, and the headcount

### 8.1 The invitation is a real message, not a row in our database

An invitation is a `MessageEnvelopeV1` delivered to the member's own inbox
(`inbox.data` in their vault, `@agenticprimitives/fabric`), carrying an `ActionCardV1` whose
`allowedActions` are the answers. That is the substrate's existing mechanism for "an agent asks a
person something and the person presses a button", and the Home already renders it: `HomeActionCardV1`
plus `resolveCardAction`, where an action the card did not declare resolves to `null` and is rejected
rather than defaulted.

Using the real rail rather than an app-local notifications table buys three things that matter. The
invitation appears where the person already looks. It survives the card room being down. And pressing
a button produces a **signed transition** attributable to the member, which is what makes the
headcount evidence rather than a claim.

### 8.2 The answer

Four states, and the fourth is not optional:

| Answer | Meaning | Counts toward the seat cap |
|---|---|---|
| `in` | I am playing | yes |
| `out` | I am not | no |
| `maybe` | Probably, don't hold a seat | no, but shown separately |
| `waitlist` | The night is full; seat me if someone drops | no, until promoted |

`waitlist` exists because a nine-seat cap and a twelve-person club is the normal case, and without it
the third person to answer yes gets a worse experience than the second for no reason they can see.
When someone who said `in` changes to `out`, the first waitlisted member is promoted automatically and
told so. That promotion is the single highest-value piece of automation in this entire document,
because it is the thing a human host does badly and late.

An answer is changeable until the night opens. After that it is a fact, not a plan.

### 8.3 The headcount

`GET /clubs/:club/nights/:nightId` returns, to anyone with standing at the club:

```ts
{
  night: NightV1,
  answers: { in: Attendee[], maybe: Attendee[], out: Attendee[], waitlist: Attendee[], silent: Attendee[] },
  counts: { in: number, maybe: number, out: number, waitlist: number, silent: number, seatCap: number },
  you: { answer: Answer | null, seat: number | null, canAnswer: boolean },
}
```

`silent` — members who were invited and have not answered — is listed on purpose. Most products drop
them, and the host's real question on Wednesday night is "who haven't I heard from", which an
un-listed silence cannot answer.

### 8.4 Reaching a person who has no Home yet

A member invited by email has no agent, so there is no inbox to deliver to. That path is the Home's
existing `org-invite/email` flow: a tokenised link, the raw address never stored (only its hash), the
person's Home created on arrival. `docs/DESIGN.md`'s onboarding doctrine applies unchanged — the
newcomer gets an account, a treasury and ten thousand Sheqels in one action, and the invitation's
`?return=` parameter lands them back at the club. That parameter already exists and is already used
this way; `OrgInvitePanel.tsx` carries the comment *"Steward arrived from a relying app — send
invitees back there after they join."*

The endpoint is `POST /connect/app-invite/email`, which is **app-scoped rather than org-class**, so a
workspace can use it unchanged. Gather27 calls exactly this, forwarding the inviting steward's own
bearer so the Home authorises the mail as that person and the card room never holds a mail key:

```ts
await fetch(`${home}/connect/app-invite/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
  body: JSON.stringify({ email, returnUrl: joinUrl, app: 'pokernight' }),
});
```

Its answer is `delivery: 'sent' | 'logged' | 'not-sent'`, and on anything but `sent` it hands the
join URL back so the host can pass it on themselves. Copy that honesty exactly. An invitation the
product silently failed to send is worse than one it admits it could not send, because the host stops
holding a seat for somebody who was never asked.

> This third value was written `unavailable` here and shipped as `not-sent`
> (`apps/tables/src/index.ts`, `apps/web/src/lib/api.ts`). The doc is the one that moved: the value
> says what happened to the invitation, not what state some mailer was in, and `unavailable` reads as
> a fact about the service when it is a fact about the message.

### 8.5 The seat is the cap, and the cap is real

A nine-seat table with twelve members is the normal case, and it is the case every general-purpose
invite product gets right and every poker product gets wrong. The rule here is that **capacity is
enforced at the answer, not at the door.** A member who says `in` when nine people already have is
waitlisted at that moment and told so, rather than discovering it when they arrive and the table is
full. The forums are explicit about the cost of the alternative:

> The key (obviously) is the max player limit of 10. You can't just send out a party invite if not
> everyone can attend.

An `in` holds a seat from the moment it is given until fifteen minutes after the night opens. After
that the hold expires and the seat goes to the waitlist, because a held seat that nobody sits in is
worse for the game than no reservation at all.

**`maybe` never holds a seat.** This is the one place where copying the invite products would be a
mistake: a soft yes is the canonical source of phantom headcounts, and with a hard nine-seat cap it
is worse than a no. `maybe` exists so a person can say something true without lying in either
direction, and it is shown to the host as its own count. It reserves nothing.

### 8.6 Attendance, and the no-show

When a night closes, each answer resolves to an outcome: `played` (they took a seat),
`no-show` (they said `in`, held a seat, and never sat), or `excused` (they said `out` or `maybe`, or
were never seated because the waitlist never reached them). The distinction between *didn't play* and
*said they would and didn't* is the one fact a host cannot reconstruct later and the one that
actually changes behaviour, and it costs one column to record.

It is recorded and shown. It is not punished by the software. Whether three no-shows means anything
is a matter between friends, and a card room that automatically demotes people would be answering a
question nobody asked it.

### 8.7 Reminders, and the discipline of not sending them

Notification volume is the fastest way to make people stop reading a club's messages. The rules:

- Never message someone who said `out`. Ever, for that night.
- Nudge the silent **once**, at the 24-hour mark, and never again.
- Message the `in` list when the table opens, because that message is useful.
- Message a waitlisted member the moment they are promoted, because that message is the feature.
- A host may send one broadcast to a night's list per night, addressed by answer state, which is what
  a group chat does badly and a card room can do well.

Anything beyond that list is a bug, not a setting.

---

## 9. The season

A season is a cumulative standing over a club's nights. It is the feature that turns a series of
disconnected games into something people come back for, and it is the one part of this design where
the existing products have genuinely thought hard and are worth copying closely.

### 9.1 What already exists in the code

Almost everything. `PokerTableDO` writes a `ledger` row per player per hand at `hand-ended`:

```ts
for (const [seatStr, chips] of Object.entries(ev.result.net)) {
  const seat = Number(seatStr);
  const playerId = seatsBefore.get(seat) ?? ... ;
  this.writeLedger({ seat, playerId, kind: 'hand-result', chips, handNo: ev.handNo, at: now });
}
```

So `(playerId, handNo, chips, at)` per hand already exists, durably, with buy-in, add-chips and
cash-out rows beside it. A night's result per player is four sums over one table's ledger. **No new
recording is needed at the table at all** — only a route that exposes it and a place to keep the
total. That is unusually cheap for a headline feature, and it is worth noticing that it fell out of
`docs/DESIGN.md` §5.2's decision to write an immutable settlement row per hand.

### 9.2 The default score is money

Every home-league scoring formula in wide use — Dr. Neau's, the Bar Poker Open's, Card Player's,
the WSOP's — takes a **finishing position** as its central term. Dr. Neau's, the de facto standard
among home leagues, is:

```
score = SQRT(n * b * b / e) / (f + 1)
   n = participants, b = standard buy-in, e = that player's total spend, f = finishing position
```

Those formulas exist because in a tournament the money is not the achievement: everyone below the
bubble gets zero, and a formula is needed to distinguish eleventh from fiftieth. **A cash game has no
finishing position.** It has a number, in the player's own currency, that already expresses exactly
how the night went.

So the default season score is **net Sheqels**, and this document recommends against making anything
else the default. Adding a points formula on top of a cash result invents a second currency that
measures the same thing worse, and then requires everyone to learn it. `e` — the rebuy penalty that
is Dr. Neau's cleverest term — is actively wrong for a cash game, where rebuying is normal play and
not a failure to be docked for.

What the formulas are right about is that people want *different questions answered*, which PokerDIY
solves with a menu rather than an argument. A club picks one ranking mode:

| Mode | Ranks by | For a club that thinks |
|---|---|---|
| `net` (default) | total net Sheqels across the season | the money is the score |
| `average` | net per night played | somebody who plays three nights should not beat somebody who plays ten by losing less |
| `nights` | nights played | showing up is the thing |
| `points` | a formula over per-night placement | we want a league, and a bad night should not erase a season |

`points` mode ranks players within each night by net, then scores that placement. It is off by
default and exists for the clubs that will otherwise go and build a spreadsheet. When sit-and-go
tournaments arrive per `docs/DESIGN.md` §1, Dr. Neau's formula applies to them unmodified with a real
finishing position, and that is the moment `points` mode becomes the natural default for a
tournament season rather than a transplant into a cash one.

### 9.3 Season structure

```ts
export interface SeasonV1 {
  version: 'pokernight.season.v1';
  seasonId: string;
  club: Address;
  name: string;                 // 'Autumn 2026'
  startsAt: number;
  endsAt?: number;              // absent = open-ended until closed
  mode: 'net' | 'average' | 'nights' | 'points';
  /** Count only each player's best N nights. 0 = count all. */
  bestOf: number;
  /** Drop each player's worst N nights. */
  dropWorst: number;
  /** Nights a player must have played to appear in the final standings. */
  minNights: number;
  /** points mode only. */
  formula?: string;
  status: 'open' | 'closed';
  closedAt?: number;
  /** Written once at close. The standings then never move again. */
  finalStandings?: Standing[];
}
```

`bestOf`, `dropWorst` and `minNights` are lifted from what real leagues actually run, and each one
solves a named problem. Counting only the best N stops a single catastrophic night ending a season in
March. Dropping the worst N means missing a night for a wedding is survivable. A minimum
participation threshold stops somebody who played once and ran hot from topping a table of people who
played twelve times. The defaults are `bestOf: 0`, `dropWorst: 0`, `minNights: 1` — that is, none of
it — because a club of six friends does not want a rulebook, and a club that wants one will ask.

**Closing a season freezes it.** `finalStandings` is written once and the season becomes history in
the club's vault. The smallest useful season primitive in this entire product space is PokerNow's
"Reset to Zero" button, and closing a season is that button with a name and a saved copy.

### 9.4 A night can opt out

`NightV1` carries `scores: boolean`, default true. A host running a casual night, or a night with
four people and a bot, sets it false and the night happens without touching the standings. That is one
boolean, taken directly from PokerStars Home Games, and it is what lets league nights and casual
nights live on the same calendar instead of forcing a club to choose.

### 9.5 What a season deliberately does not do

**No prize pool, and no settle-up.** Every general-purpose home-game tool in this space converges on
Splitwise's *Simplify Debts* — collapse who-owes-whom into the fewest payments — because their money
is a spreadsheet and somebody has to Venmo somebody at the end of the night. **Pokernight has no debt
graph to simplify.** Every buy-in and cash-out already settled on chain, per player, at the moment it
happened, under that player's own mandate. There is nobody to pay at the end of the night and nothing
to reconcile, which is the single largest thing this design gets for free from `docs/DESIGN.md` §5.

That is worth saying to players rather than only to tests, because it is the answer to the loudest
complaint in the entire home-poker world: the host who came up fifteen dollars short at cash-out and
ate it, the IOUs that are "friendship poison", the club-app player whose agent and club each blame the
other for a withdrawal that never arrived. A season here is a scoreboard. It is not a bank.

---

## 10. Where everything lives

The substrate's rule is that a subject's own records live in that subject's vault, and that an app
holds serving-plane state which is a rebuild rather than a bereavement if lost. Pokernight already
follows the second half — `PokerTableDO`'s SQLite is the authority for a hand in progress — and this
design follows both.

The test for each record is one question: **would losing this be a data loss, or a rebuild?**

| Record | Home | Why |
|---|---|---|
| The club's identity, name, custody | On chain (`.workspace` SA + `PermissionlessSubregistry`) | It is the identity. Deployed on faithchain at `0x823D…d56A` for the `workspace` root. |
| Roster: who is a member, since when, in what class | **Club's vault** | It is the club's own record about itself, read over the `service-agent-wire` delegation. Losing it is a data loss. |
| A member's own link to the club | **Member's vault** (`related:<person>:<club>`) | ADR-0025: a person↔group link is a private holder-resident credential, never an on-chain edge. This is also what makes `deriveStanding` answer `member`. |
| Schedule and materialised nights | **Club's vault**, mirrored into `ClubDO` | The nights are the club's own record. The DO mirror is an index for alarms and listing. |
| Invitations and answers | **Message envelopes in each member's inbox**, projected into `ClubDO` | The invitation is a real message (§8.1). The headcount is a projection over answers, and a projection is a rebuild. |
| Season definition and final standings | **Club's vault** | A closed season is history. It must outlive any Durable Object. |
| Live standings mid-season | `ClubDO` SQLite | Derived from hand results; recomputable. |
| Hands, actions, ledger, outbox | `PokerTableDO` SQLite | Unchanged from today. |
| Sessions | `SessionDO` | Unchanged. Deliberately narrow and self-deleting; **not** a place for membership. |

### 10.1 `ClubDO` — one Durable Object per club

A new DO namespace, `CLUBS`, keyed by the club's address. It is the serving plane: the alarm clock,
the index, and the projection. It never derives standing and never sees a session.

```sql
CREATE TABLE IF NOT EXISTS club (
  address     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  settings_json TEXT NOT NULL      -- guest policy, notice windows, defaults
);
CREATE TABLE IF NOT EXISTS schedules (
  schedule_id TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  status      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nights (
  night_id    TEXT PRIMARY KEY,
  schedule_id TEXT,
  starts_at   INTEGER NOT NULL,
  local_date  TEXT NOT NULL,        -- with schedule_id, the idempotency key of materialisation
  status      TEXT NOT NULL,
  table_id    TEXT,
  season_id   TEXT,
  json        TEXT NOT NULL,
  UNIQUE (schedule_id, local_date)
);
CREATE INDEX IF NOT EXISTS nights_upcoming ON nights (status, starts_at);
CREATE TABLE IF NOT EXISTS answers (
  night_id    TEXT NOT NULL,
  member      TEXT NOT NULL,        -- Smart Agent address, lowercased
  answer      TEXT NOT NULL,        -- in | out | maybe | waitlist
  at          INTEGER NOT NULL,
  message_id  TEXT,                 -- the envelope the answer arrived on
  seat_hold   INTEGER,              -- reserved seat, when one is held
  PRIMARY KEY (night_id, member)
);
CREATE TABLE IF NOT EXISTS members (
  member      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  class       TEXT NOT NULL,        -- standard | guest | external | observer
  joined_at   INTEGER NOT NULL,
  valid_until INTEGER,              -- guests expire
  invited_by  TEXT
);
CREATE TABLE IF NOT EXISTS results (
  night_id    TEXT NOT NULL,
  member      TEXT NOT NULL,
  hands       INTEGER NOT NULL,
  net_chips   INTEGER NOT NULL,
  bought_in   INTEGER NOT NULL,
  cashed_out  INTEGER NOT NULL,
  place       INTEGER,
  points      REAL,
  PRIMARY KEY (night_id, member)
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, done_at INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (done_at, next_at);
```

The `members` table is a **cache of the club's vault roster**, refreshed on read when stale and on
every membership change. It is not the authority. The distinction matters when the two disagree: the
vault wins, and the cache is repaired, in the same spirit as the stuck-table repair tick already in
`PokerTableDO`.

`outbox` is deliberately the same pattern as `PokerTableDO`'s, for the same reason: sending a hundred
invitations must never be on the request path, must retry with backoff, and must give up visibly
rather than silently. Reuse the existing shape, the existing backoff table
(`[1s, 5s, 30s, 120s]`, six attempts), and the existing failure-recording discipline.

### 10.2 `LobbyDO` keeps its job, narrowed

`LobbyDO` is already one-per-`circle` and is where `docs/DESIGN.md` §7 put the membership check. It
stays as the table index for a club, and `ClubDO` becomes the thing that knows who the members are.
Splitting them keeps the DO that fans out over tables separate from the DO that holds an alarm clock,
and means a club with fifty retired tables does not slow down its invitations.

`LobbyDO.idFromName(club ?? 'default')` — the `default` lobby is where pickup tables continue to live,
which is precisely today's behaviour with a name for it.

---

## 11. Surfaces

### 11.1 HTTP

Every route below requires a session. `<club>` is the club's address or its name; standing is derived
per request and the answer is the same shape as §5's table.

| Method + path | Standing | Purpose |
|---|---|---|
| `POST /clubs` | session | Create a club: charter the workspace agent, record the creator as host. |
| `GET /clubs` | session | Clubs this person has standing in. Never a global list. |
| `GET /clubs/:club` | member | The club, its next night, its standings, your role. |
| `PATCH /clubs/:club` | host | Rename, settings, guest policy, notice windows. |
| `GET /clubs/:club/members` | member | The roster. 404 for a stranger, never 403. |
| `POST /clubs/:club/members` | host | Invite by agent name or by email. |
| `POST /clubs/:club/members/propose` | member | Propose a guest; parks for host approval. |
| `DELETE /clubs/:club/members/:member` | host | Remove. Cascades per §12.3. |
| `GET /clubs/:club/schedule` | member | The active schedule. |
| `PUT /clubs/:club/schedule` | host | Set or replace it. Re-materialises the horizon. |
| `GET /clubs/:club/nights` | member | Upcoming and recent nights with counts. |
| `POST /clubs/:club/nights` | host | A one-off night outside the schedule. |
| `GET /clubs/:club/nights/:nightId` | member | The night and its headcount (§8.3). |
| `PATCH /clubs/:club/nights/:nightId` | host | Move, re-stake, cancel, skip. Re-notifies if answered. |
| `POST /clubs/:club/nights/:nightId/answer` | member or invitee | `{ answer: 'in'\|'out'\|'maybe' }`. |
| `POST /clubs/:club/nights/:nightId/open` | host | Open the table now, before the scheduled time. |
| `GET /clubs/:club/season` | member | Current standings. |
| `PUT /clubs/:club/season` | host | Define or close a season. |
| `GET /clubs/:club/season/:seasonId` | member | A closed season's final standings. |

Two existing routes change meaning:

- `POST /tables` gains an optional `club`. With one, host standing is required and the table is
  stamped. Without one, a **session is now required** where none was before. That is a breaking change
  for any script that creates tables anonymously, and it is the point.
- `GET /tables` returns pickup tables plus the tables of clubs the caller has standing in. Signed
  out, it returns pickup tables only.

### 11.2 WebSocket

No new message types on the table socket. A table is a table. The club's live state — someone
answered, the headcount moved, the table opened — is polled on the club page at the same five-second
cadence the lobby already uses. Adding a second socket protocol for a page that changes a few times an
hour would be cost with no benefit.

### 11.3 A2A skills on the club agent

The club is an agent, so it answers questions. Three skills, declared through
`@agenticprimitives/surface-catalog` so the agent card, the MCP tools and the OpenAPI document are
generated from one declaration rather than written three times:

| Skill | Input | Output | Authority |
|---|---|---|---|
| `club.nights` | `{ club, from?, to? }` | upcoming nights with counts | caller must have standing |
| `club.answer` | `{ club, nightId, answer }` | the new headcount | the member's own answer, signed |
| `club.standings` | `{ club, seasonId? }` | the leaderboard | caller must have standing |

`club.answer` is the one that matters: it is what lets a person's own agent answer an invitation on
their behalf — *"tell Thursday Night I'm in"* — which is the whole reason the club is an agent rather
than a database table. Spec 344 §9 records as an open question whether `workspace.*` skills should be
standardised; they are not, so these ids are Pokernight's and interoperate with nothing yet. That is
worth saying out loud rather than implying a standard that does not exist.

**Agents can be club members.** A `.svc` poker persona can hold a membership exactly as a person does,
which is how a club keeps a house bot that fills a short table. Its "answer" is a policy, not a
message. This falls out of the design rather than being added to it, because standing is derived
about an address and the substrate does not care what kind of agent that address is.

---

## 12. Authority

Four grants. Each is separate on purpose, and the separation is the security property: a club that may
message you may not spend your money, and a table that may spend your money may not add you to a club.

| Grant | Delegator → delegate | Template | What it permits |
|---|---|---|---|
| **Club charter** | person → club agent | `workspace-create` | Create the club under the person's name; hold its roster in its own vault; authorise Pokernight to act as it, revocably. |
| **Club wire** | club → Pokernight service SA | `service-agent-wire` | Read and write the club's own vault records — roster, nights, season. This is the only delegation the roster path presents. |
| **Membership** | club → member | `workspace-member-invite` + `workspace-join` | The member may read the club. Two legs through the single-use stash at `POST /connect/workspace-invite`. |
| **Buy-in** | member's treasury → house | `poker-buyin` | Unchanged from `docs/DESIGN.md` §5.1. A club does not touch money. |

### 12.1 The club never holds money

This is the most important line in this section. A club has members, a schedule and a leaderboard. It
has **no treasury, no balance, no dues, no rake and no bankroll.** Money continues to move exactly as
`docs/DESIGN.md` §5 describes: from the player's own treasury to the house, under the player's own
mandate, and back on cash-out.

Two reasons, and the second is the real one. A club treasury would need its own custody, its own
budget ceiling and its own answer to "what happens when the host disappears" — a large amount of
machinery for a feature nobody asked for. And a club that collects money is a different regulated
thing from a card room that runs a game, which `docs/DESIGN.md` §11 already flags as unresolved. A
club that holds nothing cannot make that question worse.

If dues or a prize pool are ever wanted, they are a `.treasury` agent chartered *under* the club, with
its own mandate and its own consent screen, and they are out of scope here.

### 12.2 Sending invitations without the host present

This is the one genuinely new authority problem, and it is worth being precise about, because getting
it wrong is how an app ends up able to mail everyone in an estate.

In the shipped Home, an organization sends mail by having a steward's browser present the org's
stewardship delegation — `sendMessage({ person: <org address>, stewardship: <wire>, recipient })` in
`apps/demo-sso-next/src/lib/messaging-send.ts`, whose header states the doctrine:

> the browser asks the person's own agent, and the agent performs an authorized A2A delivery under a
> wire the person signed.

A weekly poker night cannot work that way. The Monday invitation goes out when nobody is looking.

So the club wire (`service-agent-wire`) must cover message delivery **as the club**, and it must be
caveated so that the authority it carries is exactly "tell this club's own members about this club's
own nights" and nothing more:

- `allowedMethods` — the `messaging.deliver` selector only. Not a general A2A grant.
- **Recipients bounded by the roster.** The Worker refuses to address anyone the club's own vault does
  not record as a member, before signing. This is an app-level check because the caveat language has
  no way to say "everyone in that vault record", and it must therefore be tested as a security
  property, not assumed.
- `frequency` — a redemption ceiling per window, sized to the roster and the notice windows. A club of
  twelve with four messages a night needs about fifty a week; a thousand is a bug.
- `validUntil` — a year, matching the other workspace templates, and revocable by the host at any
  moment from their Home.

A member who does not want the club's mail revokes their own membership wire and stops being a member.
There is no separate mute, because a mute that leaves you on the roster is a lie to the host's
headcount.

> **Reversed by `docs/MISSION.md` §4.** That reasoning holds for EVENT messages and does not survive
> mission follow-up. Three categories, separately controlled: club membership, essential event
> updates, and optional mission messages. A person may mute the third and stay a member — muting a
> fundraising channel says nothing about whether they are coming on Thursday.

### 12.3 Removal cascades

Removing a member is not one write. `packages/organization/src/revocation-cascade.ts` exists for
exactly this and its plan is the specification: end the membership, revoke the membership delegation,
withdraw outstanding answers, release any held seat, and expire pending invitations. Their **past
results stay** — a season they played in is history, and deleting somebody from a leaderboard they
earned a place on would be falsifying it. They appear as a former member, which is what they are.

---

## 13. Flows, end to end

### 13.1 Barb starts a club

1. `POST /clubs { name: 'Thursday Night', label: 'thursday-night' }`.
2. The card room hands her to her Home for the `workspace-create` ceremony. Her Home deploys
   `thursday-night.workspace` counterfactually, custodied by her, registers the link on her Home as
   `kind: 'workspace'`, `parent: <her person SA>`, `relationship: 'steward'`, and provisions the
   workspace's vault key.
3. She returns to the card room, which records the club and shows an empty roster.
4. **One more ceremony, once:** the `service-agent-wire`, which authorises the Pokernight service SA's
   KMS key as the club's delegate. Until she runs it, the card room can read nothing and says so in
   those words rather than showing an empty club.

This is Gather27's exact sequence and it is worth reusing rather than reinventing, including its two
REST routes (`GET /admin/signer-address` → `{ identity, delegate, skills }`, then
`POST /admin/service-wire { wire }`) and its refusal text:

> the workspace agent has not authorized this service yet — its custodian runs the
> `service-agent-wire` ceremony from Home

One check from that code is worth copying verbatim, because getting it wrong is the commonest
ceremony mistake and it is silent: the wire's delegate must be **the signing key**, not the agent
account. Gather27's signer refuses to start if the configured key *is* the service identity, with the
reason written out — *"that is custody, not delegation."*

### 13.2 Barb adds members

- **By name.** She types `marcus.me`; the card room resolves it on chain, and her Home runs
  `workspace-member-invite`, stashing the grant at `POST /connect/workspace-invite`. Marcus signs in,
  the card room calls the same endpoint with `claim: true`, his Home writes his own link, and he is a
  member. `deriveStanding` now answers `member` for him without anyone asserting it.
- **By email.** `POST /connect/app-invite/email` with a `returnUrl` into the club. Elena arrives with
  no account and leaves with an account, a treasury, ten thousand Sheqels and a membership.

### 13.3 The night runs itself

`startsAt − 72h` — the materialised night is announced to every member. Each gets a message carrying a
card: **I'm in · Maybe · Can't make it**, and the club's current count.

`startsAt − 24h` — anyone silent is nudged once. Nobody who answered is messaged.

`startsAt − 15m` — the club creates the table:

```
POST /tables { name: 'Thursday Night · 12 Mar', club, nightId,
               settlement: 'mandate-transfer', config: night.stake }
```

stamped with `club`, `clubName` and `nightId`, and every `in` gets the link. Their seat is held.

`startsAt + 15m` — unclaimed holds expire and the waitlist is promoted, each promotion messaged.

**The night closes** when the table has been empty for thirty minutes. The club reads the table's
ledger, writes a `results` row per player, updates the season, and messages the standings. The table
itself is left alone and retires by the existing operator path.

### 13.4 Marcus answers from his own agent

*"Tell Thursday Night I'm in."* His agent invokes `club.answer` on the club agent under his own
authority. The club records it, the headcount moves, and the host sees it as it happened. Nothing
about that path is special-cased — it is the same skill his browser calls.

---

## 14. What has to change outside this repository

Four things, all in `~/agenticprimitives`, none of them large. They are listed in the order they block
work.

**1. Four delegation templates on the `pokernight` client.** Today
`apps/demo-sso-next/src/whitelabel/config.ts` grants Pokernight `['site-login', 'poker-buyin']`. It
needs `workspace-create`, `workspace-member-invite`, `workspace-join` and `service-agent-wire`. These
are **curated-only** — `SELF_SERVICE_TEMPLATES` is `['site-login', 'org-create']` — so this is a pull
request against the Home, not a settings change. Field already carries exactly this set, so the entry
is a copy.

**2. `serviceAgentConfig` on that entry — and NOT `operational_delegate`.** This is a correction to
an earlier draft of this section, made while doing it. `operational_delegate` mints an org→agent
*operational intent* grant at org-create so an app can submit endeavor intents to an organization's
A2A endpoint; the card room submits none, and a grant nobody redeems is authority sitting there for
no reason. What the wire ceremony actually needs is `serviceAgentConfig.a2aBase`, the place the Home
reads the service's signing key from and hands the signed wire back to. The ceremony takes its
delegate from the service's own answer at that endpoint, not from the registry, so there is nothing
else to name here.

**3. Stale copy and five failing guard tests on the existing entry.** Done. The `poker-buyin` consent
screen read *"Move **USDC** from the treasury you pick"* — the wrong currency, shown at the exact
moment somebody approves spending. It now names no currency at all, because the amounts and the coin
are generated from `new_member.currency` by `currencyConsentLines`; one place says how much and in
what, instead of two that can disagree.

Underneath that, five registry guard tests in `lib/new-member.test.ts` were **already failing on
master**. They asserted that no live app had a coin, and said in a comment that they would fail "on
purpose, the day someone fills the address in without meaning to turn it on". The Sheqel address was
filled in. They fired exactly as designed and nobody had made the decision they were asking for. The
decision is made now: the coin is on for pokernight, the guards assert that it is on for pokernight
and off for everyone else, and the two `⚠️ PLACEHOLDER` comments that still said the token did not
exist are gone.

**4. An RSVP action card kind — the one genuine substrate gap.** `HomeActionCardKind` is a closed
union of eleven kinds, and `ActionDescriptorV1.transition` must be an `InteractionTransitionType`
drawn from `CaseTransition` (`submit | triage | ask-info | submit-info | approve | issue-credential |
deliver-credential | deny | expire | revoke | fail`). An invitation maps onto `approve` and `deny`
awkwardly and **`maybe` does not map at all.** Two options:

- **Ship first, standardise later.** Use `uiProfile: 'open-json-ui'` with the club's own actions.
  Renders, works, is not a native Home card.
- **Propose `'event-invitation'` upstream** with a `defer` transition. This is the better answer,
  because an RSVP is not poker-specific and every future app on this substrate that schedules
  anything will want it.

Recommendation: build against `open-json-ui`, and open the upstream proposal in parallel with the
evidence from a working implementation attached. A proposal with a shipped user is a much easier one
to accept than a proposal with a design.

### 14.1 What this project should offer back

The scheduling module of §7 — recurrence, wall-clock resolution, materialisation — is written as a
pure, dependency-free module against no Pokernight type on purpose. `@agenticprimitives/coordination`
has already **reserved** the calendar projection and named it "later"
(`PROJECTIONS_STATUS = 'reserved-spec-333'`; spec 334 §11 lists `Calendar | … | later`). Spec 344's
workspace plane is likewise designed and unimplemented through waves W0–W6. A working recurrence
expander with property tests over every DST boundary is a contribution the substrate has an empty slot
waiting for, and building it inside `packages/protocol` with no import from `apps/*` costs nothing
extra.

---

## 15. Migration

Everything here is additive, with two deliberate exceptions.

**Nothing existing breaks structurally.** `TableMeta` gains three optional fields; a table without
them is a pickup table, which is what every table is today. `LobbyDO`'s schema is unchanged. The
engine, the protocol, the ledger and the treasury packages are untouched — the club never sees a card
or a chip.

**Two behaviour changes, both intended.** `POST /tables` will require a session where it requires
nothing today, and `GET /tables` will stop showing a signed-out browser every table in the estate.
Both are the fixes named in §6.3.

**New:** one Durable Object namespace (`CLUBS`) and one migration tag (`v3`,
`new_sqlite_classes = ["ClubDO"]`). Tags are never renamed, per the project rule.

**The `circle` parameter.** `CreateTableRequest.circle` is a free-text string today, used only by
tests. It becomes `club`, an address or a resolvable `.workspace` name, validated and stamped.
`circle` is accepted as a deprecated alias for one release and then removed. Nothing in production
sends it.

---

## 16. Phases

Each phase ends with something a person can use. No phase leaves a half-built object in the data.

**Phase A — the club exists. BUILT, except the charter.** `ClubDO`, `ClubIndexDO`, the roster, standing
derived on every club route, tables stamped and gated, members invited by address. No schedule, no
invitations, no season. *Exit: two people, one club, a private table a non-member cannot see, watch or
sit at.*

Note the exit wording changed while building it. An earlier draft said the non-member is "refused by
name", which contradicts §6.2 — a stranger gets 404 precisely so the club's existence is not
confirmed. It is a MEMBER who lacks host authority that gets a named refusal, because they already
know the club is there and the useful answer is which authority is missing. Both are tested.

**Phase B — the calendar.** `ClubSchedule`, `Night`, the recurrence expander with DST property tests,
materialisation, and the alarm ladder. Nights appear and open their tables on time. Nobody is
messaged yet. *Exit: a club set to weekly opens a correctly-configured table at the right local time
across a daylight-saving boundary, unattended, four weeks running.*

**Phase C — invitations and answers.** Message delivery as the club, the action card, the four
answers, the seat cap, the waitlist and its promotion, the reminder ladder, the headcount. Email
invitations for people with no Home. *Exit: Barb's three narratives in §1 run end to end, with a
newcomer arriving by email and sitting down the same evening.*

**Phase D — the season.** Result capture from the table ledger, the four ranking modes, `bestOf` /
`dropWorst` / `minNights`, closing a season into the club's vault. *Exit: a six-night season ranks
correctly, and closing it produces standings that no later play can move.*

Phase A is worth doing on its own even if nothing else follows, because it is also the fix for an
unauthenticated table-creation endpoint.

---

## 17. Prior art

Surveyed 2026-09-09. The finding that shaped this design: **no product covers all three of a
persistent club, a real calendar, and a trustworthy ledger.** Every one does one or two and pushes the
rest into a group chat or a spreadsheet.

| Product | Club | Schedule | RSVP | Standings | Ledger |
|---|---|---|---|---|---|
| PokerNow | yes, paid, capped at 10–100 members | **none** | none | ledger doubles as the leaderboard; "Reset to Zero" is the season | in-table plus CSV |
| PokerBros / PPPoker / ClubGG / X-Poker | rich: owner, manager, **agent**, member; unions | none — the schedule is a Telegram message | none | club rake races | **off-platform, on human credit** |
| PokerStars Home Games | Club ID + invite code + approval | a real creation form, **no recurrence** | registration is the RSVP | yes, with a per-event "counts toward standings" toggle | play chips |
| Pokerrrr 2 | owner + 5 managers | none | none | **none** | banker mode, tip box to 50% |
| The Tournament Director / Blind Valet | player database | live event only | — | **formula engines, seasons** | buy-ins and rebuys |
| Partiful / Luma / Meetup | — | the reference implementations | **the gold standard** | — | — |

### 17.1 What this design takes

**The master/instance/exception model with an edit-scope fork**, from Google Calendar and Meetup. §7.1
is that model. Meetup's rule that **each occurrence carries its own RSVP list** is §8's, and it is the
rule that stops a yes in March silently committing someone in June.

**The waitlist with in-order automatic promotion and a message on promotion.** This is the single most
requested missing feature in the home-poker forums, stated almost as a specification:

> prioritize those who commit early, has a wait list, and will promote players from the wait list when
> people cancel

**Evite's reminder discipline** — never message the people who said no. §8.7.

**Meetup's no-show flag, distinct from "did not attend."** §8.6.

**PokerStars' per-event standings toggle.** §9.4, one boolean.

**Luma's authorize-then-capture on a waitlist** — a card authorised at RSVP and charged only on
promotion. That is a startlingly exact description of a signed buy-in mandate that settles only at
sit-down, which `docs/DESIGN.md` §5.1 already implements. The convergence is worth noting because it
means the money design was right for a reason that had not come up yet.

**PokerNow's Rathole Time** — a player cannot leave and rebuy shorter within N minutes. A good rule,
cheap to add as a club setting, and absent from most products.

### 17.2 What this design refuses

**The agent and credit-line model** used by PokerBros, PPPoker, ClubGG and X-Poker, in which the
platform never touches money and a human intermediary extends credit and settles weekly by hand.
Every serious scandal in that ecosystem follows from it, and the structure diffuses blame by design:

> your agent might blame the club, and the club may say it's the agent's fault

Pokernight's answer already exists and is the whole point of `docs/DESIGN.md` §5. Every buy-in and
cash-out settles on chain, per player, at the moment it happens, under that player's own mandate, and
the house never holds a player's keys. **There is no club balance, no credit and nobody to chase.**

**Membership as the paywall.** PokerNow's Plus tier allows ten members per club — fewer than a full
table plus substitutes. A cap that makes the product unusable for its own use case is a pricing
decision that has to be made once, badly, and then lived with.

**A club without a calendar.** Four major products ship clubs with no scheduling, and every one of
their communities runs the actual schedule in Telegram or WhatsApp. A club whose schedule lives
somewhere else is decoration. This is why §7 exists and why the calendar is Phase B rather than
Phase D.

**A soft "interested" state.** Facebook's Interested is the canonical source of phantom headcounts.
`maybe` exists here, but §8.5 makes it hold nothing.

**Anything that makes a host rake to cover a fee.** Meetup's subscription pushed poker groups into
raking pots to pay for it, which drove members away and manufactured the exact trust problem the
product should have solved. Raking is also the line that separates a social game from a regulated one
in most US jurisdictions, which `docs/DESIGN.md` §11 already flags. Whatever this ever costs, it must
never be something a host recoups from the pot.

### 17.3 The complaint this design is actually aimed at

Host burnout is a named phenomenon with its own forum threads, and the specific cause is not the
poker:

> The only times I ever contemplate giving up hosting are the occasional times when people cancel
> late/waffle about showing up. That drives me bonkers.

> the league has kind of taken on a life of it's own to the point where it now feels like an
> obligation.

Almost everything in this document — the automatic invitation, the enforced cap, the waitlist that
promotes itself, the headcount that lists the silent, the standings that compute themselves — is
aimed at that one sentence. The host should have to do nothing on Thursday except play.

---

## 18. Risks and open questions

**A guest cannot RSVP without a Home.** Partiful's join path is a link, a name, a phone number and an
SMS code — no account. Pokernight's is an OIDC ceremony that charters a Smart Agent. For a member
that is right and already built. For the friend a regular brings once, it is the difference between
nine players and six. There is a real tension here between the substrate's identity model and filling
a table, and this document does not resolve it. The narrow version worth considering is a
**read-and-answer-only guest token** that permits exactly one answer to one night and nothing else, on
the same bearer-link semantics Gather27 already uses for its invites, with the full ceremony deferred
until the guest actually sits down and needs money.

**Sending mail as the club is the sharpest edge in the design.** §12.2 bounds it, and the recipient
bound is enforced in application code rather than in a caveat, because the caveat language cannot
express "everyone this vault record names". It must therefore be tested as a security property with
the same seriousness as the SSRF gate on `ALLOW_AGENT_ENDPOINT`. A club that could address anyone in
the estate would be a spam engine with a poker table attached.

**The club wire will be presented for more than it names.** Gather27's wire lists one skill in
`allowedMethods` and is presented for reads of four different record types, which works because the
vault rails enforce record scope rather than the skill selector. It is a widening the wire's own text
does not describe. Pokernight should name every skill it will present the wire for, and should expect
that list to grow with each phase.

**A club whose host disappears.** Custody is the host's. If they lose their credential, the club's
vault is unreadable and its nights stop. The substrate's answer is the recovery machinery in
`account-custody`, and clubs should be encouraged toward more than one custodian from the start. This
document does not specify a floor-transfer flow and probably should.

**Collusion gets easier with a club, not harder.** `docs/DESIGN.md` §11 already requires one seat per
owner per table. A club is exactly where somebody would keep a stable of agents, and the check moves
from a lobby that does not exist to a club that does. It should be built in Phase A, with the table,
rather than deferred.

**Seasons and money.** A season is a scoreboard and §9.5 keeps it that way. The moment a club wants to
play *for* the season — a prize pool, a buy-in per night that accumulates — it becomes a thing that
holds money over time, and `docs/DESIGN.md` §11's unresolved legal question gets sharper rather than
staying where it is. That is a deliberate stopping point, not an oversight.

**Timezones are the most likely source of a silent bug.** No part of the substrate is timezone-aware;
every timestamp in it is UTC or unix milliseconds. §7.3 puts the wall clock in Pokernight's own model
and pins the resolved instant per occurrence, which is the right shape, but it means Pokernight owns
the correctness. The property tests over DST boundaries are not optional.

**`GET /tables/:id/hands/:n` is public.** It serves a completed hand's actions, events, result and
revealed seed to anyone with the id. That is a fairness feature and it should stay one, but a club
table's history is arguably the club's. `docs/DESIGN.md` §7 says hand histories belong in the
player's own vault, which is not implemented. A club makes that gap more visible and is a reasonable
occasion to close it.


---

## 19. What Phase A actually shipped

Written after building it, because the difference between a design and what is running is the most
useful thing a design document can record.

**Built and tested.** `ClubDO` (one per club: the roster, and the only thing that answers standing)
and `ClubIndexDO` (one per player: which clubs they are in, a projection the club writes to). The
six club routes of §11.1 that concern membership. Standing derived per request by the Worker and
handed to the object, which never sees a session. Tables stamped with `club` and `clubName` and
pinned, following the chip-rate rule exactly. One `LobbyDO` per club, so a club's tables are private
by not being in the public index rather than by being filtered out of it. A clubs panel in the web
client: start one, see the roster, add somebody, and switch the table list to a club's own tables.

**Three things this closed that were already wrong**, independent of clubs, all named in §6.3:
`POST /tables` accepted anonymous callers and now requires a session; `GET /tables` showed every
table in the estate to a signed-out browser and now shows the pickup lobby; and seating an agent at
somebody else's table needed only *a* session, not standing at that table's club.

**One thing this design introduced and then had to fix.** The sign-out sweep read the pickup lobby
only. With clubs, a player could be sitting at a club table when they signed out, and their chips
would have stayed on a table they could no longer reach — their money, stranded. The sweep now walks
every lobby the player's club index names. This is the first thing that index was needed for, and it
is worth recording that the bug arrived with the feature rather than being found later.

**The charter, built after the first pass.** A club can now be a `<label>.workspace` Smart Agent.
The host is sent to their own Home for the `workspace-create` ceremony, the Home deploys and custodies
the agent, and `POST /clubs/:clubId/charter` records what came back. Two checks before anything is
written, and they answer different questions: host standing says this person may charter this club,
and the id_token subject says the ceremony they are handing over is their own. A club is chartered
**once** — the same agent again is a quiet success, a different one is refused, because the vault, the
roster and the club's own future messages all hang off that address and repointing it would orphan
every one of them while the club id stayed put. A ceremony that comes back with no address is a
failure, not a partial success: recording a club as chartered when nothing was chartered is the worst
of the three outcomes.

**Verified live, 2026-09-09**, against the deployed Home and faithchain rather than a fake one. A
demo persona signed in at poker.faithnet.io, started a club, pressed *Charter it at your Home*, and
came back to a club carrying `agent: 0x3864a225…b156fa10` — a contract with real bytecode on chain,
custodied by them and not by the card room.

Two things that run only showed.

**The ceremony has a step this design did not know about.** Before the workspace consent, the Home
shows the app-coin consent — the ten thousand Sheqels and the buy-in ceiling — because a persona
chartering their first club is also a first connect. Two consent screens in a row, both correct, and
the second one is the club. Worth knowing before anyone calls the flow "one approval".

**A quick-connect persona has no Home session, and the ceremony needs one.** They arrived at a
"Continue with Social / email / phone / passkey" screen and none of those four is a thing they have:
the Home holds their key, which is the whole point of a persona. The substrate already solves this —
`QuickConnectSession.homeSession` is *"the same person's Home session, so an app can hand off into
their portal already signed in"* — and the fix is to hand it back on the ceremony URL as `#session=`,
which the Home consumes exactly like its own cookie. Without a session the client now asks for
`prompt=select_account` rather than guessing.

That token is kept in `sessionStorage` under its own key and deliberately NOT on the session object,
which is written to `localStorage`. It is a bearer token for somebody's Home, and the difference
between the two stores is the difference between a Home credential that dies with the tab and one
that outlives the browser. Signing out forgets it, because keeping the more powerful credential after
being told to let go of the lesser one is not a thing to do quietly.

**One bug found on the consent screen itself**, and fixed upstream. `workspace-create`'s consent copy
read *"Create a Field Workspace under your name"* and *"Authorize Field to act as that workspace"* —
another app's product name, shown to a Poker Night host, on the one screen whose entire job is to say
who is being trusted with what. Those bullets are rendered verbatim (`fmt` is not applied to
`canDo`/`cannotDo`), so the template's own words are what everybody sees. They now say "a workspace"
and "this app"; the sheet already shows the asking app's name and domain directly above them.

### 19.1 Three ways to name somebody, built after the first pass

For its first month this form took one thing: a forty-character Smart Agent address. That is the
identifier a host is **least** likely to have, and the one they cannot ask a friend for without first
explaining what it is. A host knows their friends by name. Three roads now reach a roster, and the
field decides which one it is on from what was typed rather than making the host choose a mode:

| Typed | What happens | When it becomes a membership |
|---|---|---|
| `carol.me` | one `readContract` at `AgentNameUniversalResolver` | at once |
| `0x…` / a `playerId` | as before | at once |
| `marcus@example.com` | a pending invitation, mailed by the host's Home | when they open it and sign in |

And above the field, the shortest road of all: **the people this host already plays with**, from
`GET /people` — everyone on the roster of a club of theirs, by the name a host typed for them once.
One press each. The most common invitation there is needs no identifier at all.

**An invitation is not a membership, and the two tables say so.** A roster row is keyed by a
`playerId` and grants standing. An invitation is keyed by a token, grants nothing, and is spent when
somebody signs in. Nothing maps an inbox to an agent, so a roster row keyed by an email would be a
membership no session could ever satisfy — an invitation that reads as accepted and is not. Three
consequences fall out of that and all three are tested: the membership is keyed to **whoever signed
in**, never to the address the mail went to, because a forwarded invitation admits the person who
opened it and that is the only identity a session can present; a second invitation to the same
address **replaces** the first, because a host pressing the button twice means "send it again", not
"let two people in"; and the greeting shown to whoever holds the link is smaller than the record —
the club's name, who invited them, whether it is still good — because they have proved only that
they hold a token.

**The card room holds no mail key and should not.** `POST /connect/app-invite/email` rides the
host's own id_token, so the invitation goes out as something a person did. The link must be on an
origin registered for this app, which is what stops the route becoming an open mailer. When a Home
has no mailer the answer is `logged`, not silence — and the host is shown the link either way, so a
mailer that is down costs an invitation nothing.

**Not verified.** The email actually arriving. A dev session has no id_token, so under dev sign-in
`delivery` is always `not-sent` and the link is returned instead — correct behaviour, and not the
same thing as having watched a real Home send one.

**Not built, and next, in order.**

1. **The club's vault.** The charter gives a club an agent; it does not yet move the roster into that
   agent's vault. `ClubDO` is still the record rather than the cache it is named for. That needs the
   `service-agent-wire` ceremony — registered at the Home now, with `/admin/signer-address` and
   `/admin/service-wire` still to write on the tables Worker.
2. **Everything in §7 and §8** — the schedule, the nights, the invitations and the answers. This is
   the part with no substrate underneath it and the most work in it. §19.1 built the *membership*
   invitation; a NIGHT invitation is a different message with an RSVP on it.
3. **§9's season**, which is the cheapest of the three: the per-hand result rows it needs are already
   being written.
