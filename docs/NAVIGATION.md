# Navigation — the person, the club, and everything each can reach

Status: proposal, 2026-09-09. Author: Richard Pedersen with Claude.
Companion to `docs/DESIGN.md` (identity and money), `docs/WORKSPACES.md` (clubs, nights, seasons) and
`docs/MISSION.md` (the mission as guest). This document assumes their vocabulary and does not redefine
Club, Night, Table or Season. It answers one question those three leave open: **where does a person
stand, and what does that decide about what they see?**

This is a design, not a build. Every screen marked NEW below is a place reserved for work that has not
started — §16 and §19 of `docs/WORKSPACES.md` are the record of what is actually running.

---

## 1. Actors

Six people, because a navigation designed for one of them and hoped to work for the rest is how the
right column got to be a stack of unrelated panels in the first place.

| Actor | Wants, in one line |
|---|---|
| **The stranger** | To be at a table, playing or learning, inside a minute — and to not be asked what a club is before that happens. |
| **The invited guest** | To know who invited them and to what, before anything about signing in. |
| **The club member** | To see their clubs, know when the next night is, answer it, and sit down when it opens. |
| **The club host** | To schedule a night once and never think about it again until it is time to play. |
| **The mission guest** | To be welcomed to one Night, introduce their work, and optionally take a seat — and to have no reach into the club beyond that Night. |
| **The returning learner** | To get back to the same practice table they left, in one press, without re-deciding anything. |

Two of these — the stranger and the returning learner — are the common case and arrive with **no
club at all**. Any design that makes them look at an empty or half-built screen before they can play
has failed before it has shown them anything.

---

## 2. Modes

Two independent axes and one thing that is neither.

**Audience** — who may see the table and sit at it: a **pickup** table (public, anyone signed in) or a
**club** table (private, roster-gated, `docs/WORKSPACES.md` §6.1–6.2). This is the `club` field pinned
on `TableMeta` at creation.

**Settlement** — what a chip is worth when you leave: **play money** (settles nothing) or **money**
(Sheqel, moved by mandate transfer, `docs/DESIGN.md` §5). This is the `settlement` field, pinned
separately.

The two are orthogonal — a pickup table can be a money table, a club table can be play money — and the
existing `CreateTable` form (`apps/web/src/pages/Lobby.tsx`) already offers both dimensions
independently. This document does not collapse them into one control, because they answer different
questions: *who is this game for* and *does losing cost anything*. A design that fused them would need
a fifth option the day someone wanted a private money game for the four of them, which is the normal
case for a club.

**Practice** is neither axis. It is unlisted (no lobby entry at all, in no audience), settles nothing
(no ledger row is even written — it is not "play money," it is not scored), and belongs to exactly one
person. It is not a smaller version of a pickup table; it is a different kind of table, and the
navigation should never make it look like a third row in the audience axis.

| | Pickup | Club |
|---|---|---|
| **Play money** | today's default open table | a club's casual night |
| **Money (SHQ)** | today's money pickup table | a club's staked night |
| Practice | — belongs to neither axis, one seat, one person, unlisted — | |

**What must never be confusable.** Money vs. play money is a safety property, not a style choice: a
player must never be able to sit down expecting one and get the other. `SettlementTag`
(`apps/web/src/components/SettlementTag.tsx`) already carries this correctly — a `money`/`play` class
on a badge that repeats on the table row, the table header, every open seat and the buy-in box, driven
by the table's own pinned `settlement`, never inferred. **Every new surface this document proposes —
the Night page, the Season page, the mission's introduction — inherits this rule.** A Season's
standings are net Sheqels or they are net play-chips, and the page says which, the same badge, every
time money language appears. Club vs. pickup gets no equivalent badge, on purpose: it is a visibility
and seating rule, not a money rule, and giving it the same visual weight as the money badge would teach
players that the two are the same kind of fact. They are not.

---

## 3. A context switcher: person, or club

The request was: *"adopt our left navigation and principle of context as person or club (workspace)
and then actions relating to that."* Concretely, that means one control, always in the same place, that
answers "whose stuff am I looking at" before the navigation below it tries to answer anything else.

### 3.1 The switcher itself

```
┌─────────────────────┐
│  ♠ pokernight        │
├─────────────────────┤
│ PLAYING AS           │
│ ● You                │
│   Thursday Night      │
│   Tuesday Regulars    │
│ + Start or join a club│
├─────────────────────┤
│  Tables               │
│  Your money           │
└─────────────────────┘
```

`You` is a real, always-present, always-selected-by-default row — **not** a fallback that appears only
when a club has been picked and then unpicked. This is the deliberate choice, and the alternative
considered and rejected is a switcher that starts empty and only grows a "You" option once someone asks
"wait, where did my own tables go" — a worse design than starting with the row that is true for
everyone, including the stranger who will never add a club at all. `You` is not a hidden option under a
"Personal" menu; it is the first row, exactly the shape a club is.

Each row is a real navigational control — same height, same type weight, same left padding as a club
row — never rendered as a section label. A switcher where "You" reads smaller or greyer than the club
names beneath it is teaching the wrong hierarchy: the person is not a lesser context than a club they
happen to belong to, and a control that looks like a caption gets skipped by exactly the person deciding
between two contexts. (Reuse `.club-pick` from today's `ClubsPanel.tsx` for row styling; do not
introduce a second visual language for what is functionally the same control moved to a new place.)

**The `+` row is always present, even with zero clubs**, and always last. It does not compete with
`You` for the default selection, and it is one press to either the create form (`docs/WORKSPACES.md`
§13.1: "Barb presses Start a club") or a join-by-invitation path for someone who already has a link.

### 3.2 What changes when you switch

- The **Tables** destination's content: pickup tables under `You`, that club's private tables under a
  club. (Today's `TableList` already renders both shapes; only the routing that decides which one to
  ask for changes — see §6.)
- The set of nav items below the switcher: `You` offers Tables and Your money; a club offers Tables,
  Roster, Schedule, Nights and Season (§4).
- The page's own eyebrow — "Thursday Night's tables" vs. "Open tables" — so a screenshot or a browser
  tab alone says which context it is, the same three-signal discipline (switcher label, page eyebrow,
  nav group label) that keeps this legible once more than one club exists.

### 3.3 What does NOT change

- **Your money.** `docs/WORKSPACES.md` §12.1 is explicit: a club holds no treasury, no balance, no
  dues. Switching to a club must never make it look like you are now spending from a different account.
  `Your money` stays a `You`-scoped destination reachable from every context (§4), and its content is
  byte-for-byte the same whichever club is selected above it. This is the switcher's single strongest
  argument for existing at all: it makes "the club never touches money" a fact about the screen, not
  only a fact in a design document.
- Your session, your identity, and any table you are already seated at. Switching context in the
  sidebar never leaves a table you are playing at — a table is not a child of the switcher's selection
  (§4.3).
- Sign-in state, and the games this client can draw (`docs/GAMES.md`).

### 3.4 Nobody in a club — the common case, not an empty state

A stranger's switcher shows exactly one row (`You`) plus the `+`. This is not a stunted version of the
full switcher; it is what the switcher normally looks like for most visitors, and every item under `You`
(§4.1) is fully populated for them: open tables, a practice table, a path to money. **Nothing about the
first-run experience depends on a club existing.** The alternative — hiding the switcher entirely until
a second context exists — was considered and rejected, because a control that appears only after its
own precondition is met is a control nobody discovers in time to use it; a host who has never seen a
switcher does not go looking for one when they finally want to start a club.

---

## 4. The navigation itself

### 4.1 Items per context

| Context | Nav item | Content | Today's equivalent |
|---|---|---|---|
| `You` | **Tables** (home) | Open pickup tables + "Open a table" | `TableList` + folded `CreateTable`, unfiltered |
| `You` | **Your money** | Treasury status, stake set-up, buy-in mandate, details disclosure | `StartPanel` + `TreasuryPanel` |
| Club | **Tables** | That club's private tables + "Open a table for this club" | `TableList` + folded `CreateTable`, `club` set |
| Club | **Roster** | Members, charter, invite by name/email, pending invites | `ClubsPanel`'s `Roster` |
| Club | **Schedule** | The recurring rule: day(s), time, stake defaults | **NEW** — §5.1 |
| Club | **Nights** | Upcoming and past nights, headcount | **NEW** — §5.2 |
| Club | **Season** | Standings | **NEW** — §5.3 |

A **practice table is not a nav item.** It is a pinned card at the top of `You → Tables`, kept exactly
as prominent as it is today (`PracticePanel`'s one button), because turning it into a fourth row the
stranger has to notice and click into would cost the one thing that panel is for — the return trip in
one press, from the first screen they land on, with no navigation required at all. `Coach.tsx` is
unaffected; it lives inside the table page, not the lobby.

**What survives, what moves, what is deleted:**

- `TableList` — **survives**, becomes the content of the `Tables` item, in both contexts.
- `CreateTable` (folded `<details>`) — **survives**, unfolds as a section of the same `Tables` page
  rather than a details/summary toggle. It was folded because opening a table is "a thing a host does,
  not a step in playing" (the code's own comment) — that reasoning holds better as a secondary section
  of a page you had to navigate to on purpose than as a collapsed accordion competing for space with a
  table list on the busiest screen in the app.
- `PracticePanel` — **survives**, moves from the right-column stack to a pinned card atop `You →
  Tables`. Not deleted, not demoted — moved to the one place a stranger already lands.
- `ClubsPanel` — **splits**. Its club-picking buttons become the switcher (§3.1). Its `Roster` component
  becomes the `Roster` nav item's content, unchanged internally. Its `Charter` component stays attached
  to `Roster` (it is the club's own identity, not the member list, but it is a host action taken from
  the same page today and there is no reason yet to separate it). Its `StartClub` form moves behind the
  switcher's `+` (§3.1, §6).
- `StartPanel` / `TreasuryPanel` — **survive**, become `Your money`'s content, unchanged internally. The
  cross-links stay both ways: `Your money` still offers "Take a seat" once ready, and `Tables` still
  shows a callout to `Your money` for anyone not yet set up — the two were already written to agree
  with each other (`stakeStage`, `pickSeat`) and nothing here changes that contract.
- `SettlementTag` — **survives unchanged**, and extends to every new money-adjacent surface (§2).
- Nothing is deleted. The current design has no panel that becomes pure waste — the waste was in
  stacking all of it vertically regardless of context, not in any one piece of it.

### 4.2 The shell

```
┌───────────┬──────────────────────────────────────────┐
│ pokernight │  Thursday Night · Tables                 │
│───────────│  ────────────────────────────────────────│
│ PLAYING AS │  [ Open a table for this club ]           │
│ ○ You      │                                            │
│ ● Thursday │  Table          Stakes   Seats   …         │
│   Night    │  ─────────────────────────────────────    │
│ ○ Tuesday  │  Fri 12 Mar     1/2      4/9     Join →    │
│   Regulars │                                            │
│ + Start or │                                            │
│   join     │                                            │
│───────────│                                            │
│ Tables     │                                            │
│ Roster     │                                            │
│ Schedule   │                                            │
│ Nights     │                                            │
│ Season     │                                            │
└───────────┴──────────────────────────────────────────┘
```

Narrow left rail, wide content pane — the master/detail relationship already established for Field's
Home nav (mark-only rail plus a wider pane) and the right shape for a card room that never needs more
than seven nav items in its busiest context. A full sidebar with icons and section headers was
considered and rejected: at seven items with no sub-navigation, headers would have nothing to organize,
and a heading with one child under it reads as a heading with extra clicks rather than as structure.

### 4.3 A table is not nested under a context

`#/t/<tableId>` stays exactly what it is — a full-bleed table screen with no left nav at all, the same
as today. A table's own admission was already decided server-side at seat time
(`docs/WORKSPACES.md` §6.2); the client does not need to re-assert "you are viewing this as club X" once
you are seated, and a nav rail competing for width with a poker board would cost the one screen where
every pixel is doing something. Leaving a table returns you to wherever the switcher last pointed, not
to a context recomputed from the table you were just at.

### 4.4 Accessibility

The switcher is a `<nav aria-label="Playing as">` with the active row `aria-current="true"`, not a
`<select>` — the row-per-context shape matters visually and a native select would collapse it into
something a screen reader announces correctly but a sighted host cannot scan. Rows are real buttons at
44×44px minimum, keyboard-reachable in document order before the context nav items, and switching
context moves focus to the new pane's `<h1>` rather than leaving it stranded on the row just pressed.
Route changes (§6) get a page title update for the same reason — someone using a screen reader needs
"Thursday Night · Roster" announced, not silence.

---

## 5. New screens

None of these exist. They are placed here so that Phases B–D of `docs/WORKSPACES.md` §16 land in slots
the navigation has already reserved, rather than each phase re-opening the question of where it goes.

### 5.1 Schedule (`#/clubs/<clubId>/schedule`)

The rule, not an occurrence — `docs/WORKSPACES.md` §7.1's `ClubScheduleV1`. A host sets it once.

```
Schedule                                    [ Edit ]
─────────────────────────────────────────────────────
Every Tuesday and Thursday, 7:00pm America/Denver

Defaults for a new night
  1 / 2 blinds · 40–200 buy-in · 9 seats · Sheqel

Next 4 nights                               (from §5.2)
  Tue 10 Mar   Thu 12 Mar   Tue 17 Mar   Thu 19 Mar
```

A club with no schedule shows one sentence — "No recurring night is set" — and the same `Edit` button,
never a blank page. Editing changes future, unanswered occurrences only, per §7.1; the form says so
before it lets a host save one.

### 5.2 Nights (`#/clubs/<clubId>/nights`) and a single Night (`#/clubs/<clubId>/nights/<nightId>`)

The list is small and plain: date, status, headcount, a link. The single Night is where
`docs/WORKSPACES.md` §8 and `docs/MISSION.md` §5 actually live, and it is the one screen in this whole
document that has to hold two different shapes without looking like two different products.

**A recurring night, no mission:**

```
Thursday Night · Thu 12 Mar, 8:00pm                     [ I'm in ] [ Maybe ] [ Can't make it ]
─────────────────────────────────────────────────────────────────────────────────────────────
In (7/9)        Marcus, Elena, Carol, …            Waitlist (1)   Dana
Maybe (1)       Priya                              Silent (2)    Tom, Sam
                                                                   [ Nudge silent — once ]

Table opens automatically 15 minutes before start.  →  once open: Join the table
```

**A mission night, one-off tournament, `docs/MISSION.md` §5.2 — the shape that has to carry a lounge:**

```
Thursday Night · guest: Northfield Mission          Tournament · Thu 12 Mar, 8:00pm
─────────────────────────────────────────────────────────────────────────────────────────────
Tonight's guest dealer: Northfield Mission — "Clean water in three villages, one year in."
[ Read more ]  [ Ask a question ]

Registered (14/16)                              Lounge (3 — here, not playing)
  Table 1 (6)   Table 2 (6)                       Sam, Priya, + Anita (Northfield)
  [ Register to play ]                             [ Join the lounge ]

Elena busted out of Table 2 → moved to the lounge. She is still at the Night.
```

Two things this wireframe is doing on purpose. The **lounge is a first-class list, not an
afterthought under the tables** — `docs/MISSION.md` §2 is explicit that being at the Night and being at
a table are different facts, and a page that only lists seats would silently eject Sam and every busted
player the moment the cards stop. And the mission's introduction sits **above** the registration
controls, not beside them, because `docs/MISSION.md` §1's whole point is that the mission is a guest a
person meets before they decide anything about playing, not a sponsor logo next to the buy-in button.

This is also where a member answers without visiting the site at all: `docs/WORKSPACES.md` §8.1 sends
the same four buttons as a Home action card, and pressing one there updates this exact page for everyone
looking at it. The web page is a second way to answer, not the only way.

### 5.3 Season (`#/clubs/<clubId>/season`)

```
Autumn 2026 · net Sheqels · 6 of 10 nights played
─────────────────────────────────────────────────────
1. Carol      +1,840 SHQ
2. Marcus     +  620 SHQ
3. You        −  110 SHQ
...
Closes 15 Nov. A closed season's standings never move again.
```

The word **tournament** never appears here (`docs/WORKSPACES.md` §3's deliberate separation); a
one-off `TournamentRun` (`docs/MISSION.md` §6) shows its own bracket inside its Night page (§5.2) and
contributes nothing to this list unless the club has explicitly opted a scored variant in. A season with
no nights played yet says so in one sentence, with the schedule's next date beside it, rather than
showing an empty table with column headers and nothing under them.

### 5.4 A mission or guest arrival (`#/nights/<nightId>?rsvp=<token>`)

Anita has no club membership and never will (`docs/MISSION.md` §2). She needs one screen, reachable by
a bearer link, that greets her by name and by Night before asking anything else — the same discipline
`JoinPage.tsx` already uses for a membership invitation, extended to a Night instead of a club:

```
Barb invited Northfield Mission to guest-host Thursday Night, Thu 12 Mar

You'll open the evening, then you're welcome to stay, talk, and play if you'd like.
[ I'll be there ]   [ Can't make it ]

Playing is optional and changes nothing about hosting.
```

This route is deliberately **not** nested under `/clubs/<clubId>/` in its own URL even though the club
owns the Night, mirroring `#/join/<clubId>/<token>`'s existing shape of "carry just enough to look the
right thing up, and nothing that leaks a directory of clubs to someone guessing tokens." It is marked
NEW and unbuilt; `docs/WORKSPACES.md` §18 already flags the underlying question — a guest who can answer
without a Home ceremony — as unresolved, and this screen is where that answer will be spent once it
exists.

---

## 6. The route table

Every route, old and new. **Nothing existing is renamed or redirected** — everything below is additive,
the same discipline `docs/WORKSPACES.md` §15 used for the server side. Paths are chosen for what they
are, not for containing the word `pokernight`; that word stays reserved for identifiers per
`CLAUDE.md`, and no route here needs to be one.

| Route | Context | Status | Purpose |
|---|---|---|---|
| `#/` | `You` | **built** | Landing when signed out; `You → Tables` when signed in. Unchanged hash, reorganized content. |
| `#/signin` | — | built | Unchanged. |
| `#/t/<tableId>` (+`?practice=1`) | none (§4.3) | built | A table. Unchanged. |
| `#/join/<clubId>/<token>` | — | built | A club membership invitation. Unchanged. |
| `#/money` | `You` | **NEW** | `Your money` — today's `StartPanel`/`TreasuryPanel`, promoted from the lobby's side stack to its own destination. |
| `#/clubs` | `You` | **NEW** | Your own clubs (never a public directory — `ClubsPanel`'s existing rule holds) plus "Start a club." Reached from the switcher's `+`. |
| `#/clubs/<clubId>` | Club | **NEW** | The club's overview: next night, standings snapshot, your role. Landing point after switching or after `#/join`. |
| `#/clubs/<clubId>/tables` | Club | **NEW**, content built | That club's private tables. Same `TableList`/`CreateTable` code, now addressable by URL instead of client state. |
| `#/clubs/<clubId>/roster` | Club | **NEW**, content built | `ClubsPanel`'s `Roster` component, moved. |
| `#/clubs/<clubId>/schedule` | Club | **NEW**, §5.1 | Phase B. |
| `#/clubs/<clubId>/nights` | Club | **NEW**, §5.2 | Phase C. |
| `#/clubs/<clubId>/nights/<nightId>` | Club | **NEW**, §5.2 | Phase C. |
| `#/clubs/<clubId>/season` | Club | **NEW**, §5.3 | Phase D. |
| `#/nights/<nightId>?rsvp=<token>` | none | **NEW**, §5.4 | A mission or unaffiliated guest's one-Night RSVP. Depends on `docs/WORKSPACES.md` §18's open guest-token question. |

The one behavior change, not a route change: **club selection moves from `useState` in `Lobby.tsx` into
the URL.** Today, picking a club in `ClubsPanel` does not touch `location.hash` at all — refreshing the
page, or following a link back from a Home action card, drops you back to the pickup lobby with no
memory of which club you were looking at. That is worth fixing on its own even before any of §5's new
screens exist (§7.1).

---

## 7. What to build first

Smallest valuable step first. Every step here is usable on its own and none leaves a dangling nav item
pointing at nothing — an item for an unbuilt screen shows the "nothing here yet, ask your host" state
from day one rather than a 404.

1. **Put club selection in the URL** (`#/clubs/<clubId>`, replacing `Lobby.tsx`'s `club` state). Smallest
   possible change, and it fixes a real, already-shipped bug: today a club's context does not survive a
   refresh or a deep link, which is precisely the failure mode `docs/WORKSPACES.md` §13.3's "the night
   runs itself" story depends on not happening.
2. **Build the switcher and the shell** (§3, §4.2), moving `ClubsPanel`'s club-picker into it. No new
   data — it is the same `GET /clubs` call the panel already makes — so this is a pure layout move that
   makes the "context" principle visible before a single new backend feature ships.
3. **Split the side stack into routed destinations**: `#/money` and `#/clubs/<clubId>/roster`. Mechanical
   — move two existing components behind two new routes — and it stops the stack from growing a fourth
   and fifth panel the day scheduling arrives, which is the exact problem this document was asked to
   solve.
4. **Fix `JoinPage`'s redirect** to land on `#/clubs/<clubId>` instead of `#/`. One line, and it is the
   difference between "Elena joins and has to go find Thursday Night herself" and
   `docs/WORKSPACES.md` §1's actual promise that she "answers the invitation and sits down."
5. **Give the stranger and the returning learner a second door on the landing page** — a practice/learn
   call to action beside the sign-in pitch (`Landing.tsx` currently only pitches a money seat). Content
   change only, and it serves the two actors named in this document's opening line as the common case.
6. **Build §5's screens as Phases B–D land**, in that order, because the nav already has their slots
   reserved and their routes already named — the largest work in this document, sequenced last on
   purpose, so nothing above it has to be reworked when it arrives.

---

## 8. Open questions

Escalated rather than guessed at, per the usual rule that a design should say what it does not know
rather than quietly deciding it.

- **The mission/guest RSVP token (§5.4).** `docs/WORKSPACES.md` §18 already names this as unresolved —
  a bearer link that can answer one Night and nothing else, with no Home ceremony behind it. This
  document assumes it will exist and reserves a route for it; **Security** owns whether that token can
  be built without becoming a way to enumerate nights or clubs.
- **Presence in the lounge (§5.2) is a new piece of state** — "who is here but not seated" — that
  nothing today records. It needs a home (`ClubDO`, most likely, alongside `answers`) before the Night
  page can show it truthfully. Flagged to the **Information Architect**, since it is new persisted data
  about who showed up, not a projection of something that already exists the way the season's numbers
  are.
- **The switcher at scale.** This document assumes a person is in a small number of clubs — the design
  target throughout `docs/WORKSPACES.md` is "six friends," not sixty. If a person ever ends up in a
  dozen clubs, a flat list of rows stops working and `#/clubs` (§6) needs to become the primary way in,
  with the switcher itself showing only recent or favorited clubs. Not a problem worth solving before it
  exists.
- **`Your money`'s relationship to a club table's buy-in box.** Today's `StartPanel` already links
  forward to a seat once ready; once `#/money` is its own route, confirm with **Developer** that the
  reverse link (a club's `Tables` page pointing an unset-up member at `#/money`) can carry them back to
  the exact table they were trying to sit at, the same way `rememberReturn`/`takeReturn` already does for
  the trip to a Home.
