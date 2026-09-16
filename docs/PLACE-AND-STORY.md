# The place and the story are ontologies now

*2026-09-16. Two upper ontologies in `~/skills`, two Belvedere domains under them, and the Mystery Night
built from all four. This says what they are, why they exist, and what generates what.*

## The problem they solve

The Hôtel Belvedere was described three times. Once in `plan.ts` as two hundred lines of coordinates for the
renderer; once in `alpine-belvedere.ts` as rooms and props for the engine; and once, in prose, in whatever a
director was told. Snowfall at the Belvedere was described twice more. **Descriptions of one thing, kept in
several places, drift** — and when they drift the thing a player is told to look at stops being the thing on
the screen, which is exactly how "the guest register" ended up being a bare side table with a label over it.

There is one description of each now, and everything else is generated from it.

## The four documents

| | What it is | Where |
|---|---|---|
| **`place.ttl`** | UPPER. Somewhere a story can happen, described well enough to BUILD and well enough to TELL. Sites, buildings, storeys, rooms, open spaces, zones; doors, gates, windows, adjacencies, routes, sightlines; fixtures, furnishings, containers, features, surfaces, materials, palettes; extents, placements, stations, anchors, vantages, and the one stated bearing they are all read against; ambience, illumination, soundscape, weather. **It holds no plot.** | `~/skills/ontology/place.ttl` |
| **`story.ttl`** | UPPER. A story told at a place, and everybody whose job is to make it happen. The work, its storylines, acts, turning points, scenes and beats; parts, dramatic functions, castings; **the wright, the director, the conspirator and the audience**; facts, evidence, traits, secrets, claims, commitments, reveals and solvability; moves, discoveries, disclosures, lines, narration, cues and instructions; the staging, the performance and the pacing. | `~/skills/ontology/story.ttl` |
| **`belvedere.ttl`** | DOMAIN (A-box). The hotel: five rooms, a terrace, the grounds, every door, 93 things with the numbers to draw them, every feature with a line about what there is to see in it, and its weather. | `~/skills/ontology/belvedere.ttl` |
| **`belvedere-snowfall.ttl`** | DOMAIN (A-box). The story: 8 parts with ages, looks, wardrobes, secrets and traits; 3 acts with clocks, objectives, what they open and where a chance may fall; 28 clues; the four storylines; the eight dramatic functions; and the rule the culprit is drawn under. | `~/skills/ontology/belvedere-snowfall.ttl` |

## What generates what

```
~/skills/ontology/belvedere.ttl ──► scripts/place-to-plan.mjs ──► apps/web/src/components/mystery/plan.generated.ts
~/skills/ontology/belvedere-snowfall.ttl ──► scripts/story-to-title.mjs ──► packages/mystery/src/titles/belvedere-snowfall.generated.ts
                                        └──► scripts/story-to-archetypes.mjs ──► ~/skills/archetypes/belvedere-*/SKILL.md
```

Both generators were checked by round-trip against the files they replaced: **5 rooms and 93 things, and 8
parts, 3 acts and 28 clues, identical** to what was hand-written, with the whole engine suite green over the
generated title — including `checkTitle`, which proves the story solvable.

**They are compiled, not loaded.** The scene is built in a browser, on a lazy canvas, at the moment somebody
walks into a room; parsing a thousand triples there to find out how wide the lobby is would be a download and
a delay in exchange for nothing. The ontology is authoring-time truth.

## The three rules that make this work

**1. The building and the story hold no identifiers of each other.** They join on one string per thing: a
clue says `st:foundAtKey "register"` and the hotel says `pl:featureKey "register"`. A hotel can be re-lit and
a story re-cast without either touching the other, and a second story at this hotel is a new file rather than
a fork.

**2. Agentic Trust is the upper ontology both of these extend.** `pl:Place` is an `at:Location`, geometry is
`at:Geometry`, `pl:partOfPlace` is a sub-property of `at:spatiallyWithin`, `st:Commitment` IS `at:Commitment`,
`st:Performance` is an `at:ExecutionTrace`. Where `at:` has the word, these use it; what is added is only what
a general trust vocabulary has no reason to know — how wide a door is, and that a part can be lying. PROV-O
and DOLCE+DnS are imported vocabulary; GeoSPARQL, BOT/IFC, CIDOC-CRM, FRBR, Propp, Freytag, Drammar and the
BBC Storyline ontology are borrowed PATTERNS, named in each header and imported by none of them.

**3. RDF is a set and a story is an order.** `st:order` carries the sequence the author chose, on parts, acts,
clues and outfits. Without it the generated work is a shuffle of the authored one — the classic way an
ontology quietly loses something a file had.

## The archetypes

Four for the upper ontologies — one per job around a played story — and eight for this story's parts.

- **`place-wright`** builds places and writes no plot, because a place that knows what happens in it can only
  ever host that one story.
- **`story-wright`** writes a story to be played, proves it solvable, and stops at the curtain: *a wright may
  decide anything, and a director may decide nothing.*
- **`story-director`** runs it with a ceiling stated in the ontology rather than left to good manners —
  decides no outcome, invents no evidence, moves no player, overrules no refusal — because a model asked to
  make a story good will helpfully solve it for everybody.
- **`story-conspirator`** is the player who is in on it. What a director sends them is an **offer**; declining
  is a real move, and the story must give up its evidence either way.
- **`belvedere-concierge`** … **`belvedere-widow`** are generated from the story's own A-box, so each one
  carries that part's age, secret, traits, wardrobe and written voice — and, computed from the cast, *which of
  their traits are shared and which are theirs alone in the house*.

## Adding a second story at the Belvedere

Write one file: `~/skills/ontology/<your-story>.ttl`, an A-box over `story.ttl` that names `bv:hotel` and
joins to its features by key. Run `story-to-title.mjs` and `story-to-archetypes.mjs`. You describe no walls.
