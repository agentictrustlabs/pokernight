# Bodies for the Room — what the room asks for, and how to make one

The room draws people by loading ONE rigged, clothed body and telling it what it is doing
(`apps/web/src/components/room/embodiment.ts`). **The body is an asset, not code.** Anything that can produce a
glTF with the clips and bones below drops straight in — Unity, Blender, or the scratch pipeline that built the
one shipping today. Nothing in the room needs to change to accept a better body.

## Why this document exists

The body shipping today was retargeted by hand-rolled quaternion maths (`scratch/ubc/retarget.mjs`): the clip
library and the body come from different rigs whose rest frames differ by up to 158°, so every clip has to be
re-expressed on the new skeleton. That code gets the limbs roughly right and the **spine and shoulders wrong**,
which is why a seated player looks hunched and twisted. Retargeting between humanoid rigs is a solved problem in
tools built for it, and badly solved by a few hundred lines of my own. **Unity's Humanoid retargeting is the
best-in-class answer** — this is the one job worth leaving the browser for.

## A body's OWN clips beat any retarget

The body shipping today uses its own `Idle` and `Walk` — authored on its own rig, so they carry none of the
retarget's error — and only the clips it does not have (the seated set, the gestures) are retargeted. If a body
you export already has a clip the room asks for, name it and ship it; never retarget over it.

## What the room requires

**Format** — `.glb` (binary glTF), one file, skinned mesh + skeleton + clips embedded.

**Height** — about **1.8 m** standing, feet at y = 0, facing **+Z**. The room places bodies in metres and does
not rescale them.

**Clips** — the room's whole vocabulary. Each row lists the name to emit first, then the other spellings the
room already accepts (`CLIPS` in `embodiment.ts`); a missing clip is named in the console, and its state plays a
T-pose.

| What it is | Emit this name | Also accepted |
| --- | --- | --- |
| standing idle | `Idle_Loop` | `Idle`, `idle` |
| standing, talking | `Idle_Talking_Loop` | `Talking`, `Talk` |
| walking (in place) | `Walk_Loop` | `Walk`, `Walking` |
| lowering into a chair | `Sitting_Enter` | `SitDown`, `Sitting_Down` |
| seated idle | `Sitting_Idle_Loop` | `Sitting`, `Seated` |
| seated, talking | `Sitting_Talking_Loop` | `Seated_Talking` |
| rising from a chair | `Sitting_Exit` | `StandUp`, `Standing_Up` |
| a wave / gesture | `Interact` | `Wave` |
| reaching to the table | `PickUp_Table` | `PickUp` |
| celebrating | `Dance_Loop` | `Dance` |

Loops must loop cleanly. `Walk_Loop` should be **in place** — the room moves the body itself; a clip with root
motion will slide.

**Bones** — the room drives six of them itself (the gaze, the dealing reach, the deck in the off hand). Mixamo
naming is what to emit; Unreal and Rigify spellings are also accepted (`BONES` in `embodiment.ts`).

`Head`, `RightArm`, `RightForeArm`, `LeftArm`, `RightHand`, `LeftHand`

A body with none of these still walks and sits — it just will not look at anyone or reach out, and says so once
in the console.

**Outfit** — the shipping body's clothes are a 32×32 palette its UVs point at, so an outfit is a ~140-byte
recoloured swatch (`public/room/skin-<word>.png`) rather than another body. A body that instead bakes its
clothes into one texture works too: ship it as `person.glb` and let every palette word load the same swatch, or
export one body per outfit and accept the download.

## Making one in Unity (the recommended route)

Unity is used here **as an asset tool only**. Nothing of Unity ships; the room stays as it is.

1. **New project**, any recent LTS, 3D. Install **glTFast** (`com.unity.cloud.gltfast`) via Package Manager —
   it exports `.glb`. (UnityGLTF also works.)
2. **Import the body** (`.fbx` or `.glb`). In its Import Settings → **Rig**, set **Animation Type: Humanoid**,
   then **Apply**. Open **Configure…** and check every bone is mapped green — this is the step that makes
   retargeting work, and the step my own pipeline has no equivalent of.
3. **Import the clip library** the same way: **Animation Type: Humanoid**, and under **Avatar Definition**
   choose **Copy From Other Avatar** → the body's avatar. Unity now retargets every clip onto the body's
   proportions and rest pose, correctly, including the spine and shoulders.
4. In each clip's **Animation** tab: tick **Loop Time** on the looping ones, and for `Walk_Loop` tick **Bake
   Into Pose** for Root Transform Position (XZ) so the walk stays in place.
5. **Name the clips** exactly as the table above asks.
6. Put the body in a scene, drag the clips onto it, then **select the body GameObject → glTFast → Export
   glTF-Binary**, with **animations included**. Save as `person.glb`.
7. Drop it at `apps/web/public/room/person.glb` and reload the room. Nothing else changes.

### Checking it before you ship it

`scripts/check-body.mjs` reads a `.glb` and reports what the room will make of it — clips found and missing,
bones found and missing, height, and whether the walk has root motion:

```
node scripts/check-body.mjs apps/web/public/room/person.glb
```

Run that first; it answers "will the room like this body?" without opening a browser.

## The alternative, if Unity is a nuisance

**Blender** does the same job, free and scriptable: import both rigs, use the **Rokoko** or **Auto-Rig Pro**
retarget add-on (or Blender's own bone constraints), export glTF. It is scriptable headlessly, which the Unity
Editor is not, so it is the better choice if this ever needs to run in CI.

## What is NOT worth doing

Replacing the room's runtime with Unity WebGL. The room shares thirteen modules with the rest of the app — the
action bar, the cards, the huddle's live video, both sockets, the routes — and a Unity canvas is opaque to all
of them; each becomes a JS↔Unity bridge, with WebRTC video into Unity textures the worst of them. The build goes
from under a megabyte of assets to tens of megabytes. None of that buys anything the retargeting above does not.
