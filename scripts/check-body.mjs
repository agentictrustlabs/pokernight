/**
 * WILL THE ROOM LIKE THIS BODY? Reads a .glb and reports exactly what `embodiment.ts` will make of it —
 * clips found and missing, the six bones the room drives, height, and whether the walk carries root motion.
 * Usage: node check-body.mjs <file.glb>   (docs/AVATARS.md)
 */
import { readFileSync } from 'fs';
const CLIPS = {
  idle: ['Idle_Loop', 'Idle', 'idle'], talk: ['Idle_Talking_Loop', 'Talking', 'Talk'], walk: ['Walk_Loop', 'Walk', 'Walking'],
  sitDown: ['Sitting_Enter', 'SitDown', 'Sit_Down', 'Sitting_Down'], seated: ['Sitting_Idle_Loop', 'Sitting', 'Seated', 'Sit_Idle'],
  seatedTalk: ['Sitting_Talking_Loop', 'Seated_Talking', 'Sitting_Talking'], standUp: ['Sitting_Exit', 'StandUp', 'Stand_Up', 'Standing_Up'],
  interact: ['Interact', 'Wave', 'Waving'], pickUp: ['PickUp_Table', 'PickUp', 'Pick_Up'], dance: ['Dance_Loop', 'Dance', 'Dancing'],
};
const BONES = {
  head: ['Head', 'mixamorig:Head', 'DEF-head', 'head'], armR: ['RightArm', 'mixamorig:RightArm', 'upperarm_r', 'DEF-upper_arm.R', 'UpperArm.R'],
  foreR: ['RightForeArm', 'mixamorig:RightForeArm', 'lowerarm_r', 'DEF-forearm.R', 'LowerArm.R'], armL: ['LeftArm', 'mixamorig:LeftArm', 'upperarm_l', 'DEF-upper_arm.L', 'UpperArm.L'],
  handR: ['RightHand', 'mixamorig:RightHand', 'hand_r', 'DEF-hand.R', 'Palm.R'], handL: ['LeftHand', 'mixamorig:LeftHand', 'hand_l', 'DEF-hand.L', 'Palm.L'],
};
const file = process.argv[2];
if (!file) { console.error('usage: node check-body.mjs <file.glb>'); process.exit(2); }
const d = readFileSync(file);
if (d.slice(0, 4).toString() !== 'glTF') { console.error('not a binary glTF (.glb)'); process.exit(2); }
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.slice(20, 20 + jsonLen).toString());
const bin = d.slice(20 + jsonLen + 8);
const names = new Set(j.nodes.map((n) => n.name));
const anims = (j.animations ?? []).map((a) => a.name);
let bad = 0;
console.log(`\n${file} — ${(d.length / 1024 / 1024).toFixed(2)} MB\n`);
console.log('CLIPS');
for (const [k, list] of Object.entries(CLIPS)) {
  const hit = list.find((n) => anims.includes(n));
  console.log(`  ${hit ? '✓' : '✗'} ${k.padEnd(11)} ${hit ?? `missing — wanted ${list[0]}`}`);
  if (!hit) bad++;
}
const extra = anims.filter((a) => !Object.values(CLIPS).some((l) => l.includes(a)));
if (extra.length) console.log(`  · ${extra.length} clip(s) the room does not use: ${extra.slice(0, 8).join(', ')}`);
console.log('\nBONES');
for (const [k, list] of Object.entries(BONES)) {
  const hit = list.find((n) => names.has(n));
  console.log(`  ${hit ? '✓' : '✗'} ${k.padEnd(6)} ${hit ?? `missing — wanted ${list[0]}`}`);
  if (!hit) bad++;
}
// HEIGHT, from the POSITION accessors' bounds carried through the FULL node transforms. Scaling by the Y scale
// alone is not enough: a rig authored Z-up sits under an armature node turned −90° about X, so the mesh's own
// Y is the body's DEPTH and a 1.78 m person measures 0.37. The eight corners of each bounding box go through
// the composed matrix, which is what the engine does to draw it.
const parentOf = new Map();
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const trs = (n) => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
};
const worldOf = (i) => { let m = trs(j.nodes[i]), at = parentOf.get(i); while (at !== undefined) { m = mul(trs(j.nodes[at]), m); at = parentOf.get(at); } return m; };
let lo = Infinity, hi = -Infinity;
j.nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  const m = worldOf(i);
  for (const p of j.meshes[n.mesh].primitives) {
    const a = j.accessors[p.attributes.POSITION];
    if (!a?.min || !a?.max) continue;
    for (let corner = 0; corner < 8; corner++) {
      const v = [corner & 1 ? a.max[0] : a.min[0], corner & 2 ? a.max[1] : a.min[1], corner & 4 ? a.max[2] : a.min[2]];
      const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
  }
});
const h = hi - lo;
console.log(`\nHEIGHT  ${h.toFixed(2)} units${h > 1.5 && h < 2.1 ? ' ✓ (about right for metres)' : `  ✗ the room wants ~1.8 m`}`);
if (!(h > 1.5 && h < 2.1)) bad++;
console.log(`FEET    y = ${lo.toFixed(2)}${Math.abs(lo) < 0.05 ? ' ✓' : '  ✗ feet should stand at y = 0'}`);
// root motion on the walk: a translation channel on the skeleton root that actually travels
const walkName = CLIPS.walk.find((n) => anims.includes(n));
if (walkName) {
  const walk = j.animations.find((a) => a.name === walkName);
  let travel = 0;
  for (const c of walk.channels) {
    if (c.target.path !== 'translation') continue;
    const acc = j.accessors[walk.samplers[c.sampler].output];
    if (acc?.min && acc?.max) travel = Math.max(travel, Math.hypot(acc.max[0] - acc.min[0], acc.max[2] - acc.min[2]));
  }
  console.log(`WALK    horizontal travel ${travel.toFixed(3)}${travel < 0.2 ? ' ✓ (in place)' : '  ✗ root motion — the body will slide; bake it into the pose'}`);
  if (travel >= 0.2) bad++;
}
console.log(bad === 0 ? '\nThe room will take this body.\n' : `\n${bad} thing(s) to fix — see docs/AVATARS.md\n`);
process.exit(bad === 0 ? 0 : 1);
