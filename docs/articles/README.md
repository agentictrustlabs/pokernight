# Articles — the card room as a window onto the substrate

A series that uses Pokernight to show what the Agentic Primitives estate is *for*.

These are not as-built maps. The as-built maps live next door: `docs/DESIGN.md`, `docs/GAMES.md`,
`docs/HOLDEM-COACH.md`, `docs/WORKSPACES.md`. An article here is allowed to be a year ahead of the
code, so long as every agent, vault, grant and skill it names is a thing the substrate already
knows how to be.

The game is the worked example. The claim is about the estate.

| # | Article | Status | What it is for |
|---|---|---|---|
| 1 | [My poker coach](my-poker-coach.md) | built, 2026-09-13 | Named coach as a person, service that advises, vault that is hers, private club (invite, schedule, huddle). The working proof that Home + skills + a custom app is the capability a prescribed coach asks for. |

Later pieces, when they earn a file:

- **The table that does not know the game** — a host that holds state as `unknown` and asks the
  port. Why adding Canasta was one registry line.
- **The club that holds no money** — a `.workspace` that organises a night, an invite and a
  huddle, and is never the settlement counterparty. Started in the coach article; the full
  doctrine is `docs/WORKSPACES.md` and `docs/MISSION.md`.
- **A seat is not a login** — people and service agents at the same table; `poker.act` is not
  `poker.advise`; a buy-in mandate is not a coaching grant.

Write the next one when a reader of the first is left holding a question this index does not
answer. Do not write it to fill a slot.
