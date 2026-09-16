# Fidelity in the room — what to use for people, and for the scene

*2026-09-15. The question was "what do we use for higher-fidelity people and graphics in the club room?" This is
the answer, the measurements it rests on, and the order to do it in. It extends `docs/AVATARS.md` (how a body is
made) and `docs/SPATIAL-ROOM.md` §3.1 (the lounge as one glTF); it changes neither.*

## The answer in one paragraph

The runtime is already right and stays: PlayCanvas on a canvas with the React HUD over it. Fidelity in this room
is **assets and light, not an engine** — the engine was being fed low-poly CC0 and a flat ambient, and a
mid-poly PBR room under image-based light is something it draws today without a line of new rendering code.
The order that reads as "better" to a person looking at the screen is: **(1) light like a room and close the
void, (2) one authored lounge with baked light, (3) one body family with its own sit and walk, (4) the huddle's
faces on heads, (5) outfits and a second body family.** Step 1 shipped today; step 3 is half done because the
body it needs is already built.

## What was measured (so the plan is about this room, not rooms in general)

| Thing | Before today | Now |
|---|---|---|
| `person.glb` (the man) | Quaternius "Animated Human": **1,578 tris**, one 32×32 palette; every seated clip RETARGETED from a foreign rig, so the room poses its idle into a chair (`SEAT_POSE`) | unchanged — the next asset to replace |
| `person-f.glb` (the woman) | shipped bare, the man's palette painted over her | Quaternius **Universal Base Character**, dressed: **19,446 tris**, six PBR textures (4 × 1k, 2 × 256), and **her own seated clips**, which the room now plays (`AvatarLibrary.NATIVE_SEAT`) instead of bending idle — the bend is what put her arms out |
| `person-m.glb` (built, not shipped; scratch `ubc/`) | — | the same family's man: **16,603 tris**, same textures and clips, `check-body.mjs`: "The room will take this body" (1.85 m, feet at 0, walk in place) |
| `lounge-kit.glb` | Kenney furniture, 2,432 tris, vertex colours | unchanged; the table chairs are primitives now |
| Light | a flat ambient (0.25, 0.3, 0.27) + sun + fill + rim, no environment; a green fog behind the walls and no ceiling — "the void" | ambient from an **image** (Poly Haven "Billiard Hall", CC0: the 1k HDRI box-filtered to 256×128 flat RGBE, **131 KB**, prefiltered on the GPU into the engine's env atlas at load), **ACES** tone mapping on the camera, a ceiling, a warm dark fog |
| Surfaces | flat colours | herringbone parquet, painted plaster tinted the club's green, dark wood on the tables — Poly Haven CC0 scans at 512 px with normal maps, **~170 KB** the lot |

Everything on the page is still under a megabyte before the bodies, and the bodies are 0.75 MB (man) and
1.34 MB (woman).

## People

### What to use

**The Quaternius Universal Base Characters, for both figures, now.** They are CC0, already in hand, already
dressed by the scratch pipeline (`ubc/dress.py` → `build-person.mjs` → `finish.mjs`), 16–19k triangles with
1k textures, and — the part that matters most in a chair — **their clips were authored on their own rig**: a real
sit-down, seated idle, seated talking and stand-up, a walk with no root motion, an idle that breathes. The
woman is that body today. Shipping the man (`person-m.glb`, built, checked) makes everyone in the room one
family, and retires the seated pose-bending and the 1.5k-triangle mannequin with it.

The alternatives, and why not first:

| Source | What you get | Why it is not the first move |
|---|---|---|
| **Ready Player Me / Avaturn export** | one stock body per person, 10–15k tris, 1–2k textures, a face from a photo | licensed (not CC0), needs an account per export, and the clips come from elsewhere — every one has to be retargeted in Unity/Blender before the room will take the body. Worth it later for *"that is me"* faces; not for the first upgrade |
| **Mixamo characters + clips** | a dozen clothed stock humans with a huge clip library | Adobe account and a browser session, nothing scriptable; the clips retarget cleanly only through Unity's Humanoid (`docs/AVATARS.md`) — the road is written, but it is a day per body in an editor we do not run here |
| **Commissioned 2–3 humans** | a house look nobody else has | the right move once the lounge is authored and the light is final, so the artist sees the room the body will stand in |
| **MetaHuman / live RPM SDK in the client** | photoreal | no: 10× the weight, a second runtime beside the app, and at conversation distance the huddle's video on a head beats any mesh |

### The seated question, settled

A body either sits on its own clips or the room poses it. `AvatarLibrary.NATIVE_SEAT` states which, per file,
because it is the one thing about a body the loader cannot measure: the low-poly man's `Sitting_Idle_Loop` is a
retarget that hunches, so he is posed; the base characters' are their own, so they are played. The two land in
the same place — the native clip drops the hips 0.37 m and 0.28 m back, the pose 0.42 m and 0.30 m — so one chair
geometry serves both, and swapping the man for `person-m.glb` is one line in that table.

### Outfits on a textured body

The palette trick (137-byte swatches) does not apply to a body with real textures. The dressed base colours
exist for all six outfit words in both figures (`ubc/dressed-{m,f}-<word>.png`) but at 800 KB each as PNG;
resampled to 512 px JPEG they are 70–120 KB, and only the words actually worn need to load. The plan is one body
per figure with `slate` baked in, and the other five as base-colour swaps fetched on first sight — the same
"one download and a swatch" idea, with a bigger swatch.

### Who is a woman? Nobody's PII

The room must not ask for, store or infer a gender. What it needs is a **look** — which body, which outfit, which
hair — and that is a *choice the person makes about their own avatar*, not a fact about them. The right record
is `cardroom.look` in the person's own vault, written by their agent the way `cardroom.style` is, read once at
room entry; until it exists the fixture table `ESTATE_FIGURES` in `Lounge.tsx` names the seven demo people and
everyone else gets a stable pick from a hash of their id. Alice looks like Alice because Alice chose it, and
Bob's own tab and the seat he took while his tab shows the flat board draw the same figure (that was today's bug:
a seat was built without the figure and everybody sat down as a man).

### Faces

The huddle already carries a live camera for everyone in it, and the design (spec §5.4) puts that track on the
head within ~8 m and a portrait ring beyond. At the distance two people talk, that IS the high-fidelity person,
and it costs no triangles. It comes before any second body family.

## The scene

### What to use

**One authored lounge as a single glTF with baked lightmaps**, exactly as `docs/SPATIAL-ROOM.md` §3.1 planned:
felt tables, real chairs, the bar, lamps, floor, walls and ceiling, with the anchors SceneDO already addresses
(`table.1`, `bar`, `fire`, `door`) as named empties so nothing server-side changes. Author it in **Blender** —
free, scriptable headlessly (so a CI job can re-export it), and the bake is a button — or the PlayCanvas editor
if a team is going to work on it visually. Kenney's kit stays as the fallback while the file is loading.

Why not the engine's runtime lightmapper: it needs a second UV set on every static mesh, which primitives and
the kit do not have, and a bake at load is work every visitor pays for. Bake once, ship the texture.

### Budget

- Lounge: 20–40k triangles static, lightmapped, one 2k lightmap atlas; served from R2 by content hash
  (20–60 MB per lounge with textures, ranged, edge-cached — §5.2 of the spatial spec).
- Bodies: 8–15k each is the target; the base characters are 16–19k, which is fine at eight bodies (~150k tris —
  the swiftshader probe still runs) and would want a decimated LOD past that.
- One shadow-casting directional (the "sun" through the ceiling, the key), the omni lamps for warmth, the
  environment atlas for everything else. Freeze animation past ~25 m; video on heads only in the near field.

### Light, which is most of it

Today's step was the cheapest and the largest: ambient from a real interior, tone mapping, textured surfaces
with normals, and a ceiling. With those, the same kit chairs stop reading as toys because the picture finally
says where the light comes from. The next lift of the same kind is the baked lightmap in the authored lounge —
contact shadows under every chair and table, the lamps' pools on the felt — and it is an asset, not code.

## Order, and what each step touches

1. **Light + close the void** — done today. `Lounge.tsx` (env atlas, ACES, textured floor/walls/wood, ceiling),
   `public/room/{env.hdr, floor-parquet*, wall-plaster*, wood-dark*}`, `LICENSE.txt`.
2. **Authored lounge glTF** — Blender file in a new `assets/lounge/` (source, not shipped) → `public/room/lounge.glb`
   for now, R2 later; `RoomKit` learns to place the whole scene and read its anchors. The anchors' names are the
   contract with `SceneDO` and do not move.
3. **One body family** — copy `ubc/person-m.glb` to `public/room/person.glb`, flip `NATIVE_SEAT.m`, delete
   `SEAT_POSE` and `applySeat` when nothing is posed any more. Outfits as 512 px base-colour swaps.
4. **Faces on heads** — the huddle's `MediaStreamTrack` as a video texture on the head bone's plate in the near
   field (`SpatialVoice.tsx` already knows which body owns which participant).
5. **Second body family / house look** — commissioned, or Mixamo through the Unity route, once the lounge is
   the room they will stand in.

## What not to do

Switch to three.js / R3F (decided against, §3.1); ship Unity or Unreal in the browser (`docs/AVATARS.md`
"What is NOT worth doing"); put MetaHumans or a live avatar SDK in the client; sculpt fidelity in `Lounge.tsx`
primitives (the dealer's hat and shirt are placeholders for a costume on the body); retarget in
`ubc/retarget.mjs` again — the base characters need no retarget, and anything else goes through Unity's Humanoid
or Blender.
