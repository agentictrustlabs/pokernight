# The navigation, decided and built

`docs/NAVIGATION.md` designed it. `docs/NAVIGATION-RESEARCH.md` surveyed eleven products against it.
`docs/INVENTORY.md` said what actually exists. They agreed on nearly everything and disagreed on the
one decision that mattered. This is what was settled and what shipped; the three source documents stay
as they are, including the part of the design that was not taken.

## The one disagreement

`docs/NAVIGATION.md` §3 argued **for** a context switcher — `You` as an always-present, always-default
first row, "exactly the shape a club is" — and its strongest reason was that a switcher makes "a club
never touches your money" a fact about the screen rather than only a fact in a design document.

`docs/NAVIGATION-RESEARCH.md` §14.1 argued **against** one: not one game product in the survey has a
context switcher, the only two examples anywhere are Discord and Slack, and Slack ships persistent
workspace switching off by default.

**The research won, and the design's own §3.3 is why.** That section lists what does *not* change when
you switch context: your money, your session, your identity, any table you are seated at, your sign-in,
and the games this client can draw. What *does* change is a table list's filter and the four items
underneath. A control that reframes the application in order to swap a filter and a menu is a promise
that cannot be kept, and the commonest visitor — who has no club — would meet it first, as a menu with
one item in it.

The money argument turns out to cut the other way. If `Your money` has to sit outside the switcher and
read identically in every context, the switcher has already conceded that it is not a container.

## What shipped

A left rail of things that are yours wherever you are, and clubs as a pinned, named list inside it.
Every one of the design's club destinations survives; they are reached by clicking the club rather than
by entering a mode.

```
Play          #/            a hand now, against the house
Tables        #/tables      what is running
Your money    #/money
─ YOUR CLUB(S) ─
Thursday Night  #/clubs/<id>
Start a club    #/clubs/new
```

- **`lib/nav.ts`** decides every row, purely, and carries the reasoning. Tested in `lib/nav.test.ts`,
  including that nothing in the rail is a switcher.
- **`#/` is Play**, not the table list. Six products in the survey put "play" in slot one; the list is
  first for everybody who comes *back*, which is why it is second and why leaving a table lands there.
- **A club is a route**, so it can be linked, refreshed, and landed on by an invitation. Its page leads
  with **its tables**, then the roster — a member arriving at a club and being shown a roster has been
  shown the one thing they cannot act on.
- **No club directory, and no `#/clubs` page.** A club you are not in is indistinguishable from one that
  does not exist, so there is nothing to list; the invitation carries the club instead. A club you have
  no standing in gets one sentence for both reasons — a second sentence would confirm which.
- **No rail at a table.** A table is not a child of anything in the rail.
- **The landing page has a second door.** It offered only "Start a club", which asks a stranger to
  organise something; "Or just play a hand" is beside it now, and sign-in lands on Play, so it is kept.

## Two shipped bugs this fixed, and two it exposed

`docs/NAVIGATION.md` §7 named the first two and both were real:

1. **Club selection lived in `Lobby.tsx`'s `useState`.** No URL, so it did not survive a refresh and
   could not be linked. It is `#/clubs/<id>` now, and `scripts/walk-nav.cjs` asserts the refresh.
2. **`JoinPage` redirected to bare `#/`.** Somebody who answered an invitation landed on a lobby that
   did not mention the club they had just joined. It lands on the club.

The third was found by driving it:

3. **`ClubDO` wrote the player's club index fire-and-forget** (`void this.indexAdd(...)`). `POST /clubs`
   answered 201, the client asked "which clubs am I in?", and the club it had just made was not in the
   answer — so a new host had no row in the rail, which is the only place they could go next. The write
   is awaited now. Its `catch` is what makes it best-effort, which is what makes awaiting safe; the
   `void` was never doing that job.

4. **Arriving at your practice table threw its pace away.** `CanastaPage` opens with `pace = 3500`, and a
   debounced effect posts whatever `pace` holds — so it stamped that default over the table's real value
   before the request that would have told it the real value came back. You set the pace, left, came
   back, and the table had quietly gone back to 3.5 s. Nothing is sent now until the table has said what
   it is already set to (`paceKnown`). Found because a script set the pace over the API and the slider
   still read 3.8 s.

`<a href="#stake">` at `Table.tsx` and `MoneyPanel.tsx` was the dead end `docs/INVENTORY.md` proved:
it matched no route, fell through to home, and unmounted the table with its socket — at a money table
that is a *disconnect*, not a stand-up, so the seat was left sitting out holding chips. It is
`components/StakeLink.tsx` now, which scrolls.

## What is checked, and how

- `apps/web/src/lib/nav.test.ts` — every row, every route, and the degradation by club count.
- `apps/web/src/render.test.ts` — the rail and all four pages at rest, which is the state that shows on
  a slow connection and the one nobody looks at while building.
- `apps/tables/test/club.test.ts` — the new club is in the listing the instant the create answers.
- `pnpm play:canasta` opens a table from the lobby and clicks every control itself; `--practice` takes
  your own table at full speed and watches the coach play the hand, which is the one that scores a round.
  A finished round is detected by the ROUND NUMBER going up — the end-of-round summary shows for a moment
  and the next round deals over it, so polling for it on screen walks straight past it and reports that
  nothing ever finished while the table sits on round four.
- `pnpm walk:nav` — twenty-nine assertions against the live deployment, as a real signed-in person:
  every rail row lands where it says, a refresh survives on two pages, a new club appears in the rail
  and is marked as current, a club you are not in says one thing for both reasons, `#/clubs` is not a
  directory, Play deals you in in one press, a table has no rail, and leaving one returns you to
  `#/tables`.

## Closing a club

Retiring one was the gap this work exposed and could not work around: `DELETE /clubs/:id/members/:member`
refuses the creator with *"retire the club instead"*, and that route did not exist — so a club, once made,
was permanent, and a mistake or a group that stopped meeting sat in its members' navigation for good.

`DELETE /clubs/:clubId` closes it. Only its host, and the refusals split the way every club refusal does:
a stranger gets 404 (a club they are not in must stay indistinguishable from one that is not there), a
member gets 403 by name (they can already see the club, so who may close it leaks nothing).

It looks before it touches anything. If somebody is seated at one of the club's tables it refuses the
whole thing, names the tables, and destroys nothing — a seat holds chips, and at a settled table those
chips are money. Otherwise it closes the club's tables (a club table left behind is private to a club
that no longer exists), then drops the club from every member's index, so nobody's rail keeps a row that
answers 404 when they press it.

**It does not touch the club's Smart Agent, and it says so.** That `<label>.workspace` agent was deployed
at the host's own Home and this card room has never held its key. Reporting "closed" while an agent of
that name goes on existing in the estate would mislead a host about something still out there with their
name on it, so the address comes back in the answer and the screen states it.

In the UI it is folded shut, last on the club's page, lists every consequence before the control, and the
button is dead until the club's own name is typed back — case and stray space forgiven, because the point
is knowing which club you are closing, not typing accurately.

## Not built, and deliberately not stubbed

`docs/NAVIGATION.md` §5 reserves rail slots for Schedule, Nights and Season. They have no rows, because
`docs/INVENTORY.md` found 27 of 32 documented promises unbuilt and a nav item pointing at an empty state
is the 28th. They arrive as sections of the club's page, in the order §14.3 gives — next night, tables,
members, season — when there is something behind them.
