# Field Operations — a season of field work, played by real agents

> **The default season is *A Season North of Denver*** (2026-10-01): the four corridors above Denver, twelve of the
> public registry's people communities, four teams, four partner churches, six weeks that play out in minutes.
> The world is `~/skills/ontology/northern-colorado.ttl` over `fieldops.tbox.ttl`; where each people stands at open
> is read from `gc-public`.

**What it is.** Game Night's fourth game, and the first played on a map by real agents. *Thursday in Greeley* tests
the PICTURE — can a true reading be assembled without anybody being exposed. Field Operations tests the OPERATION
and the AGENTS that carry it: teams of workers who are persona agents custodied by the estate's demo people, partner
churches represented by game agents named for real congregations, circles and churches founded in play that adopt
real body agents, and a field workspace the Field Circles app (field.faithnet.io) shows exactly as it shows a real
one — every piece marked as a game's. A season starts each community where the registry's latest phase result put
it and the work moves it toward Phase 7; the score says how far the field moved and how every agent played.

## 1 · Three things this game is, and one it is not

1. **A season is work on a map.** The region is real: Weld, Larimer, Boulder–Broomfield and the Northeast Plains,
   their towns at their coordinates, I-25 and the highways. A worker is somewhere; acting among a people needs them
   in one of that people's towns; moving is free and comes first. Every act lights the town it happened in.
2. **The communities are the registry's, cited.** `fo:FieldCommunity` names its `gc:PeopleCommunity` node in
   `gc-public`; `scripts/registry-to-fieldops.mjs` reads the identity (scheme, ROP, PEID, PG id, language) and the
   latest `gc:CommunityPhaseResult` in the registry's own `fw-npl-phases`, and `scripts/world-to-fieldops.mjs` joins it
   with the A-box's towns, estimate and base readiness. Compiled, never loaded: a season opens on the floor this wrote,
   and the board says when it was read. 58 communities were read on 2026-10-01; the season works twelve.
3. **Every agent is real, and every one says it is a game's.** The workspace and the partner-church agents are Smart
   Agents at the Home custodied by demo people (`scripts/provision-fieldops.mjs`); the teams, circles and churches are
   Smart Agents the SEASON charters as its characters' acts (`apps/tables/src/field-charter.ts`); the sixteen
   parts are persona agents (`charter-cast.mts --cast demo/fieldops-cast.json`). Names carry `(game)`, descriptions say
   what they are, records are purposed as the game's, and the game's graph marks every node `fo:isGame true`. A partner
   church's AGENT represents a real congregation (`fo:representsChurch`, cited to the directory) and holds none of its
   authority.

**It is not an assessment of any real community.** A phase here is derived from the game's own counters about the
game's own copy of a community (`fo:isSimulated true`); the steward's reading is a claim about that copy. Nothing a
season writes attaches to a real community's node, and the field app's records are purposed and titled as a game's.

## 2 · The engine's invariants

- **The work opens doors; the seed decides what walks through.** Every outcome is `drawAt(seed, n)` against a hidden
  READINESS per community, authored as a base and perturbed by the seed at open, revealed at the end. No act writes
  readiness; no view carries it before the reveal. A season replays byte-identically from (seed, action log).
- **A phase is derived, never set.** `phaseOf` reads presence, conversations, baptisms, churches and generations
  against the registry's own level words (entry · sowing · baptisms · churches started · 2nd, 3rd, 4th generation or
  10%). The registry's phase at open is the FLOOR, seeded as counters and existing churches on the registry's word.
  A published reading (`assess`) is scored against the derivation.
- **One act a day, and a day is the unit.** Energy spends and comes back at night; below twenty the work weakens. A
  coach's lift and a partner's support raise a team's strength; a circle nobody gathers for twelve days stalls.
- **What the road brings is weather, not soil.** One day in three or so the seed draws from the season's list: a
  BARRIER that halves the work of anybody who does not speak the language for a week, PRESSURE that stalls a circle, a
  CALLING that spends a worker, PROVISION that fails a team, GRACE that brings a family asking. None touches readiness.
- **A decision changes the season, never the world.** Five parts face a choice on a day (`st:Choice`, opened by
  `fo:opensOnDay`): two options, each with a consequence and at most an effect on energy, capacity or where the part is.
  Taken once; it does not spend the day; the score shows what each chose.

## 3 · The parts

| Kind | Who | Does |
|---|---|---|
| worker (8) | Naomi, Yusuf · Farid, Grace · Tomás, Olena · Hodan, Luis | visit · share · study · found · gather · baptize · train · recognize · send · report |
| coach (2) | Carla (Weld), Mark (Boulder–Longmont) | coach · report, and field work when nobody else can |
| steward (1) | Dr Priya Natarajan | assess — publishes readings |
| coordinator (1) | Sam Whitaker | anything; moves people to where the work is |
| partner (4) | Dan (Christ Community, Greeley) · Kim (Timberline, Fort Collins) · Jenna (LifeBridge, Longmont) · Walt (Trinity Lutheran, Fort Morgan) | support — funds, volunteers, a venue, prayer |

Each has gifts (share · disciple · gather · lead · coach), languages, a brief, a secret, and lines the house uses when
no model is asked. Everybody is invented; the congregations are real and cited.

## 4 · The test of the agents

`FieldOpsDO` asks each agent-played part for its DAY over A2A (`fieldops.act`, the scene envelope, the field's shape
in `encodeFieldOpsParts`), with the engine's own `may` list, and validates the answer like anybody's. Per agent it
counts: asked, answered, applied, refused by the engine, unparsed, missed, average latency, days the house had to play
for it. The tally rides every view (`agents`), the page shows it as it runs, and the reveal shows it beside the
house-played control. A day is at least nine seconds per agent-played part (`paceFor`), so every agent is asked once a
day whatever pace was chosen.

## 5 · The estate

**A season bootstraps from its characters** (2026-10-02). It opens with no teams and no community taken up, like a
workspace nobody has set up. A character founds a team where they stand (`found-team`: a day; they are its steward;
they ask whom they like, and each asked part joins or declines, free); a team's steward takes the registry's
communities up (`adopt`, free — nobody works among a people nobody has taken up) or defines a new People Community
in a town, in their own words (`define-community`: a day; invented and marked; the seed draws its readiness); then
the work begins, and a circle a worker founds belongs to their team. Each of those is the field app's own ceremony —
"Create team", "Invite someone", "Add a circle or church", "Define a new People Community" — run by the season as the
character's act: `apps/tables/src/field-charter.ts` deploys the agent custodied by the character's custodian, binds
its vault, links it at the Homes (the character's persona as STEWARD; the custodian, the workspace's custodian and
each joined member as members), grants its storage planes, then runs the Home's own membership ceremonies — the
organization invites, the member's own session joins (which writes the organization's `aporg:OrganizationMembership`
record with its role assignment), the member countersigns the has-member credential, and the steward countersigns a
steward-of credential — and the records follow. Membership, the role on it, and stewardship stay three things; only
the delegations authorize anything. A character gets its own session by its custodian signing in "as" it. The Home signs for a demo
custodian on request (`/connect/persona-sign`); the Worker holds no key. A charter takes a minute or two and is
retried; a body whose charter fails is still a body, with no agent of its own.

**The workspace is a service; the organization has the members** (2026-10-02). `Northern Colorado Field — Game
Night` is a `.workspace` agent that coordinates the realm and holds its records; it cannot have members. Beside it
stands `Northern Colorado Field — Game Night (organization)`, chartered first and custodied by nathan: the sixteen
characters are ITS members (their persona sessions join; each has a has-member credential; nathan is founder and
steward), and `ws-membership` rows on the workspace are projections carrying `organization` and `membershipRecord`.
A team a character founds is an organization of its own with the same shape; a circle or church likewise. Custodians
are never members — the game addresses characters. `pnpm admit:fieldops` runs the admissions idempotently.

**Where the talk goes.** What a character says is posted to its team's open `general` topic on the team's board (the
field app's own team conversation; a character on no team speaks on the organization's `general`), as that character.
What a character whispers is a direct message from the character's agent to the other's, over the character's
messaging wire (`pnpm admit:fieldops --wires-only` mints the sixteen rails). `FieldOpsDO.carryTalk` does both after
every save, each line once, and logs a line that stayed in the field.

`scripts/provision-fieldops.mjs` (sourcing `~/engage/scripts/seed/faithnet.env`) charters only the REALM, idempotently:

- the workspace **Northern Colorado Field — Game Night**, custodied by nathan — its own realm, never the real field —
  with every demo person who custodies a part on its roster, so their characters' teams show at their field app;
- four partner-church agents (kind `org`, purpose `field-partner`) named for the congregations, marked as game agents.

Each: deploy · vault · Home link · storage planes (engage's `enable-org-storage.mjs`) · records through the Home's
library. It writes `fieldops-estate.faithnet.json` (state, addresses) and `fieldops-estate.note.json` (the ESTATE NOTE
the Worker reads), and `--graph` publishes the static part to the game's graph. The note goes in KV `CLUB_WIRES` under
`fieldops-estate` (`--remote`), or in the secret `FIELDOPS_ESTATE`.

The cast: `charter-cast.mts --cast demo/fieldops-cast.json`, then `add-mystery-skills.mts --as <x>.me --by <h> --game
fieldops` per persona, `register-fieldops.mjs` (the domain, six craft skills, three capabilities, eighteen archetypes),
`assign-org-archetype.mts` with `CONTEXT=field-operations ARCHETYPE=north-<part>`, `activate-cast-vaults.mts`, and the
`FIELDOPS_CAST` line in `wrangler.toml`. Messaging between parts is the commission's road (`equip-cast-messaging.mts`).

**Playing again.** `pnpm reset:fieldops [--dry] [--keep-graph] [--retire-seeded]` retires what the seasons chartered.
Every team, circle and church a season chartered is in KV `fieldops-chartered`; the reset lets go of every Home link
the season made for each (the steward persona's, the custodian's, the workspace custodian's, the members') through the
same door that made them, wipes the workspace's rows that point at them (`field/workspace-teams`, `-communities`,
`-bodies`, `phase-results`, the team rows of `-agents`), clears the ledger and removes the seasons' subjects from the
game graph. A chartered agent is an agent on chain and is not deleted; it is simply nobody's any more. The realm — the
workspace, its roster, the partners' agents — stays. `--retire-seeded` does the same for the four teams and twelve pool
bodies the first provisioning seeded.

## 6 · The field app

At every week's end and at the reveal, `field-estate.ts` writes the season's records where field.faithnet.io reads
them: `activity` per act and `observation` per report into the team's vault; `formation-community` /
`ekklesia-community` per body the season founded; `body-profile` and `body-community` into an adopted body agent's
vault and the active `ws-body` row on the workspace; `community-phase-result` per reading on the workspace. Ids derive
from the season and the event, so a week written twice is the same rows. The writer signs in as the demo person who
custodies each vault (`/connect/demo-signin`) — a DEMO estate's property, said in the code; a real field would write
through its own ceremony. At the reveal the founded bodies and readings go to
`https://graph.global.church/g/gamenight/field-operations` in `gc-public` when the Worker holds `GRAPHDB_URL` and
`GRAPHDB_BASIC`.

## 7 · The page

`#/fo/<staging>`: the field drawn (`components/fieldops/FieldMap.tsx` — corridors, towns, roads, partner crosses,
every worker where they stand, every body beside its town by generation, an act pulsing its town), the day strip, THE
BOARD (each community: the registry's floor marked on a gauge, the derived phase lit, the reading outlined, the
counters, what blocks the next phase), the road's weather, the ACTIVITY with filters; on the side YOUR DAY (the verbs
from `may`, the pickers each needs, a decision when one is before you), THE TEAMS (who, where, what today), THE AGENTS
(the tally), the partners, THE FIELD APP (what has been written, a link, the host's "write it out now"), and the reveal.

## 8 · Commands

`pnpm gen:fieldops` (registry → world → archetypes) · `pnpm provision:fieldops` · `pnpm reset:fieldops` (clean vaults for another season, keeping the estate) · `pnpm walk:fieldops`.

`pnpm cleanup:fieldops [--dry] [--all]` lets go of the game organizations that pile up on the demo users' Homes across seasons — it reads every character persona's and custodian's own links and removes each one that is not the current realm (the organization, the workspace, the partner churches) or, unless `--all`, the current season. The agents stay on chain; they are simply nobody's any more.
