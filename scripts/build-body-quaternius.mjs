/**
 * A QUATERNIUS "ANIMATED WOMEN/MEN" BODY, PREPARED FOR THE ROOM.
 *
 * These packs (CC0) ship a clothed low-poly human with its OWN materials — Shirt, Skin, Pants, Shoes, Hair,
 * Eyes as separate base colours — and its OWN clips, including a real sit-down and stand-up. Nothing is
 * retargeted here: the clips are renamed into the room's vocabulary, the long Sitting clip is cut into the
 * transition and the held pose the room's state graph wants, and the body is scaled to human height.
 *
 *   node build-quat.mjs <in.glb> <out.glb> [Female|Man]
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, unpartition } from '@gltf-transform/functions';

const [, , inFile, outFile, sexArg] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inFile);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const sex = sexArg ?? (root.listAnimations().some((a) => /Female/.test(a.getName())) ? 'Female' : 'Man');
const clip = (n) => root.listAnimations().find((a) => a.getName() === `HumanArmature|${sex}_${n}`);

/** A new animation holding the slice [t0, t1] of `src`, with its own accessors and time rebased to 0. */
function slice(src, t0, t1, name) {
  const out = doc.createAnimation(name);
  for (const ch of src.listChannels()) {
    const s = ch.getSampler();
    const input = s.getInput(), output = s.getOutput();
    const n = input.getCount(), stride = output.getElementSize();
    const times = [], values = [];
    for (let i = 0; i < n; i++) {
      const t = input.getElement(i, [])[0];
      if (t < t0 - 1e-6 || t > t1 + 1e-6) continue;
      times.push(t - t0);
      values.push(...output.getElement(i, new Array(stride)));
    }
    if (times.length === 0) continue;
    if (times.length === 1) { times.push(times[0] + 0.001); values.push(...values.slice(-stride)); } // a pose needs two keys
    const ns = doc.createAnimationSampler()
      .setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)))
      .setOutput(doc.createAccessor().setType(output.getType()).setArray(new Float32Array(values)))
      .setInterpolation(s.getInterpolation());
    out.addSampler(ns);
    out.addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(ns));
  }
  return out;
}
const duration = (a) => Math.max(...a.listChannels().map((c) => { const i = c.getSampler().getInput(); return i.getElement(i.getCount() - 1, [])[0]; }));

// THE SIT IS ONE LONG CLIP: about two thirds of a second of sitting down, then the pose held. The room's graph
// wants those as two states, so the transition becomes Sitting_Enter and the held tail becomes the seated idle.
const sitting = clip('Sitting');
const SIT_ENTER = 0.75;
const enter = slice(sitting, 0, SIT_ENTER, 'Sitting_Enter');
const held = slice(sitting, SIT_ENTER + 0.25, Math.min(duration(sitting), SIT_ENTER + 4.25), 'Sitting_Idle_Loop');
const heldTalk = slice(sitting, SIT_ENTER + 0.25, Math.min(duration(sitting), SIT_ENTER + 4.25), 'Sitting_Talking_Loop');

// what the room asks for ← what the pack calls it
const RENAME = {
  Idle: 'Idle_Loop', Walk: 'Walk_Loop', Standing: 'Sitting_Exit',
  Clapping: 'Interact', Punch: 'PickUp_Table', Jump: 'Dance_Loop',
  // A BODY THAT IS DEAD IS LYING DOWN, and the pack authored that on this very rig. The room plays it once and
  // holds the last frame, so a victim is found where they fell rather than standing about being not alive.
  Death: 'Death_Pose',
};
const keep = new Set([enter, held, heldTalk]);
for (const a of root.listAnimations()) {
  if (keep.has(a)) continue;
  const short = a.getName().replace(`HumanArmature|${sex}_`, '');
  const want = RENAME[short];
  if (want) { a.setName(want); keep.add(a); continue; }
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}
// TALKING IS THE IDLE until a pack ships one: the body keeps breathing and the room's own nod carries the beat.
const idle = root.listAnimations().find((a) => a.getName() === 'Idle_Loop');
slice(idle, 0, duration(idle), 'Idle_Talking_Loop');

/**
 * EVERY CLIP DRIVES EVERY BONE THE OTHERS DO.
 *
 * The pack's Idle animates three bones — the body and two shoulders — and leaves the rest alone, which is
 * correct in a player where a clip starts from the bind pose and wrong in a state graph that crossfades. A
 * bone no clip is currently writing simply KEEPS what the last one left: stop walking and the legs freeze
 * mid-stride with a foot stretched out behind, which is what "his feet are not correct" looks like. Worse,
 * the room composes the gaze onto the head bone each frame on top of whatever the clip wrote — with no head
 * curve in Idle there is nothing to compose onto, so the gaze multiplies into itself and the head spins.
 *
 * So the union of every animated (node, path) is taken across the kept clips, and each clip is filled out
 * with a two-key constant channel at the node's REST value for whatever it does not already drive.
 */
const REST = { translation: (n) => n.getTranslation(), rotation: (n) => n.getRotation(), scale: (n) => n.getScale() };
{
  const union = new Map(); // `${node}|${path}` → [node, path]
  for (const a of root.listAnimations()) for (const c of a.listChannels()) union.set(`${c.getTargetNode().getName()}|${c.getTargetPath()}`, [c.getTargetNode(), c.getTargetPath()]);
  let filled = 0;
  for (const a of root.listAnimations()) {
    const has = new Set(a.listChannels().map((c) => `${c.getTargetNode().getName()}|${c.getTargetPath()}`));
    const end = duration(a);
    for (const [k, [node, path]] of union) {
      if (has.has(k)) continue;
      const v = [...REST[path](node)];
      const sampler = doc.createAnimationSampler()
        .setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, end])))
        .setOutput(doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array([...v, ...v])))
        .setInterpolation('LINEAR');
      a.addSampler(sampler);
      a.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
      filled++;
    }
  }
  console.log(`filled ${filled} missing channel(s) across ${root.listAnimations().length} clips (${union.size} driven bones)`);
}

// STAND AT HUMAN HEIGHT, FEET ON THE FLOOR. The pack authors these under an armature scaled 100×, so the raw
// file is nearly five metres tall; everything below the scene's children scales with them.
const before = getBounds(scene);
const k = 1.78 / (before.max[1] - before.min[1]);
for (const n of scene.listChildren()) {
  const s = n.getScale(); n.setScale([s[0] * k, s[1] * k, s[2] * k]);
  const p = n.getTranslation(); n.setTranslation([p[0] * k, p[1] * k, p[2] * k]);
}
// hips travel in the clips is in the armature's own units and scales with it; nothing else to do.
const after = getBounds(scene);
for (const n of scene.listChildren()) { const p = n.getTranslation(); n.setTranslation([p[0], p[1] - after.min[1], p[2]]); }

// the materials are the pack's own — six or seven flat base colours. Only tidy them for the room's lighting.
for (const m of root.listMaterials()) { m.setRoughnessFactor(/eye/i.test(m.getName()) ? 0.35 : 0.8); m.setMetallicFactor(0); }

await doc.transform(dedup(), prune(), unpartition());
await io.write(outFile, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
console.log(outFile, 'height', (b.max[1] - b.min[1]).toFixed(2), 'feet', b.min[1].toFixed(3));
console.log('clips:', doc.getRoot().listAnimations().map((a) => `${a.getName()} ${duration(a).toFixed(2)}s`).join(', '));
