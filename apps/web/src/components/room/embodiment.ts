/**
 * EMBODIMENT — a person or an agent as a body in the room (docs/SPATIAL-ROOM.md §3.6, 2026-09-14).
 *
 * The architecture is A2A participant → Player Embodiment → Avatar template → animation controller → scene.
 * Presence and, later, the `scene.*` skills speak in SEMANTIC acts — `walkTo`, `sitAt`, `stand`, `lookAt`,
 * `gesture`, `talking` — and this layer makes them happen: the body is one rigged glTF human (Quaternius'
 * Universal Animation Library mannequin, CC0, `public/room/mannequin.glb`) instantiated per participant from
 * one loaded container, driven by ONE PlayCanvas anim state graph for everybody (idle ⇄ walk, sit down → seated
 * ⇄ seated talking → stand up, a gesture and back). Nothing above this file moves a limb; nothing in it knows
 * a card game. A different body (an Avaturn or Mixamo-rigged GLB later) is the same class with another
 * container, as long as its clips carry these names.
 */
import * as pc from 'playcanvas';

/**
 * WHAT THE ROOM ASKS OF A BODY, and every spelling it will accept (docs/AVATARS.md).
 *
 * A body is an ASSET, produced by whatever tool retargets best — Unity's Humanoid retargeting, Blender, or the
 * scratch pipeline. Each of those names its clips and bones its own way, so the room resolves both through
 * these alias lists rather than one hard-coded spelling: drop in a better body and it simply works. The FIRST
 * name in each list is what the docs ask an exporter to emit; the rest are what the common rigs already call it.
 */
const CLIPS = {
  idle: ['Idle_Loop', 'Idle', 'idle'],
  talk: ['Idle_Talking_Loop', 'Talking', 'Talk'],
  walk: ['Walk_Loop', 'Walk', 'Walking'],
  sitDown: ['Sitting_Enter', 'SitDown', 'Sit_Down', 'Sitting_Down'],
  seated: ['Sitting_Idle_Loop', 'Sitting', 'Seated', 'Sit_Idle'],
  seatedTalk: ['Sitting_Talking_Loop', 'Seated_Talking', 'Sitting_Talking'],
  standUp: ['Sitting_Exit', 'StandUp', 'Stand_Up', 'Standing_Up'],
  interact: ['Interact', 'Wave', 'Waving'],
  pickUp: ['PickUp_Table', 'PickUp', 'Pick_Up'],
  dance: ['Dance_Loop', 'Dance', 'Dancing'],
} as const;
/** Bones the room drives itself — the gaze, the dealing reach, the deck in the off hand. */
const BONES = {
  head: ['Head', 'mixamorig:Head', 'DEF-head', 'head'],
  armR: ['RightArm', 'mixamorig:RightArm', 'upperarm_r', 'DEF-upper_arm.R', 'UpperArm.R'],
  foreR: ['RightForeArm', 'mixamorig:RightForeArm', 'lowerarm_r', 'DEF-forearm.R', 'LowerArm.R'],
  foreL: ['LeftForeArm', 'mixamorig:LeftForeArm', 'lowerarm_l', 'DEF-forearm.L', 'LowerArm.L'],
  armL: ['LeftArm', 'mixamorig:LeftArm', 'upperarm_l', 'DEF-upper_arm.L', 'UpperArm.L'],
  handR: ['RightHand', 'mixamorig:RightHand', 'hand_r', 'DEF-hand.R', 'Palm.R'],
  handL: ['LeftHand', 'mixamorig:LeftHand', 'hand_l', 'DEF-hand.L', 'Palm.L'],
  spine: ['Spine', 'mixamorig:Spine', 'spine_01', 'DEF-spine.001', 'Torso'],
  thighL: ['LeftUpLeg', 'mixamorig:LeftUpLeg', 'thigh_l', 'DEF-thigh.L', 'UpperLeg.L'],
  thighR: ['RightUpLeg', 'mixamorig:RightUpLeg', 'thigh_r', 'DEF-thigh.R', 'UpperLeg.R'],
  shinL: ['LeftLeg', 'mixamorig:LeftLeg', 'calf_l', 'DEF-shin.L', 'LowerLeg.L'],
  shinR: ['RightLeg', 'mixamorig:RightLeg', 'calf_r', 'DEF-shin.R', 'LowerLeg.R'],
} as const;

/**
 * SITTING IS POSED, NOT PLAYED (2026-09-15).
 *
 * A retargeted seated clip was the worst thing in the room — hunched and twisted — because retargeting a whole
 * seated body between rigs is exactly where a hand-rolled re-basing fails. A chair does not need a clip: it
 * needs one pose, and a pose is seven angles that can be MEASURED (scratch `ual/axes.cjs`, on a standing body:
 * +X lifts a thigh forward and up, −X folds a shin back, +X leans the spine, +X brings an arm down and forward).
 * So the seated states play the body's own idle — which is correct, and keeps the breathing — and this bends it
 * into the chair on top, easing in and out. A body that brings a genuinely good seated clip can have this
 * turned off; nothing else changes.
 */
const SEAT_POSE: Array<[keyof typeof BONES, number]> = [
  ['thighL', 60], ['thighR', 60],   // thighs forward, knee just under hip height
  ['shinL', -40], ['shinR', -40],   // shins down to the floor — MORE fold raises the foot, not lowers it
  ['spine', 4],                      // a little forward over the table
  ['armL', 12], ['armR', 12],        // upper arms barely forward — this rig cannot rest hands ON the felt
                                     // without the forearms folding through it (swept, seatsweep.cjs), so they
                                     // hang naturally at the sides instead of clipping the table
  ['foreL', 10], ['foreR', 10],
];
/** How far the hips drop when the legs fold — the difference between standing and sitting on a 0.45 m seat. */
let SEAT_DROP = 0.42;
/**
 * And how far the body SHIFTS BACK onto the chair. The room walks you to where your FEET go, a step in front of
 * the seat; sitting puts the hips over the pad behind that, with the knees forward of them. Without this the
 * geometry is right and the person is still sitting on air in front of their chair — which reads, exactly, as
 * "standing in the chair".
 */
const SEAT_BACK = 0.30;
// The pose is TUNED AGAINST MEASUREMENTS, not guessed: `scratch/seatsweep.cjs` sweeps these while reading the
// hip, knee and foot heights back, because a thigh's rotation changes what the shin's own axis means and no
// amount of reasoning from a standing body survives that.
(globalThis as unknown as { __seat?: unknown }).__seat = { pose: SEAT_POSE, drop: (v?: number) => (v === undefined ? SEAT_DROP : (SEAT_DROP = v)) };
/** The first of `names` this body actually carries. */
function findAny(body: pc.Entity, names: readonly string[]): pc.GraphNode | null {
  for (const n of names) { const f = body.findByName(n); if (f) return f; }
  return null;
}
export type Gesture = 'interact' | 'pickUp' | 'dance';

const GRAPH = {
  layers: [{
    name: 'Base',
    states: [
      { name: 'START' },
      { name: 'Idle', speed: 1, loop: true, defaultState: true },
      { name: 'Talk', speed: 1, loop: true },
      { name: 'Walk', speed: 1, loop: true },
      { name: 'SitDown', speed: 1.4, loop: false },
      { name: 'Seated', speed: 1, loop: true },
      { name: 'SeatedTalk', speed: 1, loop: true },
      { name: 'StandUp', speed: 1.4, loop: false },
      { name: 'Interact', speed: 1, loop: false },
      { name: 'PickUp', speed: 1, loop: false },
      { name: 'Dance', speed: 1, loop: false },
    ],
    transitions: [
      // a body that is already in a chair when it appears starts seated, not sitting down
      { from: 'START', to: 'Seated', priority: 0, conditions: [{ parameterName: 'seated', predicate: pc.ANIM_EQUAL_TO, value: true }] },
      { from: 'START', to: 'Idle', priority: 1 },
      { from: 'Idle', to: 'Walk', time: 0.2, conditions: [{ parameterName: 'speed', predicate: pc.ANIM_GREATER_THAN, value: 0.25 }] },
      { from: 'Talk', to: 'Walk', time: 0.2, conditions: [{ parameterName: 'speed', predicate: pc.ANIM_GREATER_THAN, value: 0.25 }] },
      { from: 'Walk', to: 'Idle', time: 0.25, conditions: [{ parameterName: 'speed', predicate: pc.ANIM_LESS_THAN, value: 0.25 }] },
      { from: 'Idle', to: 'Talk', time: 0.3, conditions: [{ parameterName: 'talking', predicate: pc.ANIM_EQUAL_TO, value: true }] },
      { from: 'Talk', to: 'Idle', time: 0.3, conditions: [{ parameterName: 'talking', predicate: pc.ANIM_EQUAL_TO, value: false }] },
      { from: 'Idle', to: 'SitDown', time: 0.15, priority: 0, conditions: [{ parameterName: 'seated', predicate: pc.ANIM_EQUAL_TO, value: true }] },
      { from: 'Talk', to: 'SitDown', time: 0.15, priority: 0, conditions: [{ parameterName: 'seated', predicate: pc.ANIM_EQUAL_TO, value: true }] },
      { from: 'Walk', to: 'SitDown', time: 0.15, priority: 0, conditions: [{ parameterName: 'seated', predicate: pc.ANIM_EQUAL_TO, value: true }] },
      { from: 'SitDown', to: 'Seated', time: 0.1, exitTime: 0.95 },
      { from: 'Seated', to: 'SeatedTalk', time: 0.3, conditions: [{ parameterName: 'talking', predicate: pc.ANIM_EQUAL_TO, value: true }] },
      { from: 'SeatedTalk', to: 'Seated', time: 0.3, conditions: [{ parameterName: 'talking', predicate: pc.ANIM_EQUAL_TO, value: false }] },
      { from: 'Seated', to: 'StandUp', time: 0.1, priority: 0, conditions: [{ parameterName: 'seated', predicate: pc.ANIM_EQUAL_TO, value: false }] },
      { from: 'SeatedTalk', to: 'StandUp', time: 0.1, priority: 0, conditions: [{ parameterName: 'seated', predicate: pc.ANIM_EQUAL_TO, value: false }] },
      { from: 'StandUp', to: 'Idle', time: 0.15, exitTime: 0.95 },
      { from: 'Idle', to: 'Interact', time: 0.15, conditions: [{ parameterName: 'gesture', predicate: pc.ANIM_EQUAL_TO, value: 1 }] },
      { from: 'Idle', to: 'PickUp', time: 0.15, conditions: [{ parameterName: 'gesture', predicate: pc.ANIM_EQUAL_TO, value: 2 }] },
      { from: 'Idle', to: 'Dance', time: 0.15, conditions: [{ parameterName: 'gesture', predicate: pc.ANIM_EQUAL_TO, value: 3 }] },
      { from: 'Interact', to: 'Idle', time: 0.2, exitTime: 0.95 },
      { from: 'PickUp', to: 'Idle', time: 0.2, exitTime: 0.95 },
      { from: 'Dance', to: 'Idle', time: 0.2, exitTime: 0.95 },
    ],
  }],
  parameters: {
    speed: { name: 'speed', type: pc.ANIM_PARAMETER_FLOAT, value: 0 },
    seated: { name: 'seated', type: pc.ANIM_PARAMETER_BOOLEAN, value: false },
    talking: { name: 'talking', type: pc.ANIM_PARAMETER_BOOLEAN, value: false },
    gesture: { name: 'gesture', type: pc.ANIM_PARAMETER_INTEGER, value: 0 },
  },
};
// Seated states run the body's OWN idle (and its talking variant) — `applySeat` bends it into the chair.
// A BODY WHOSE SEATED CLIPS WERE AUTHORED ON ITS OWN RIG plays them instead (`NATIVE_SEAT_CLIP`, 2026-09-15):
// the Quaternius base characters come with a real sit-down, a real seated idle and a real stand-up, and posing
// idle over those made a woman sit with her arms out and her back tipped. The two land in the same place — the
// native clip drops the hips 0.37 m and 0.28 m back, the pose 0.42 m and 0.30 m — so a chair fits either.
const STATE_CLIP: Record<string, keyof typeof CLIPS> = { Idle: 'idle', Talk: 'talk', Walk: 'walk', SitDown: 'idle', Seated: 'idle', SeatedTalk: 'talk', StandUp: 'idle', Interact: 'interact', PickUp: 'pickUp', Dance: 'dance' };
const NATIVE_SEAT_CLIP: Record<string, keyof typeof CLIPS> = { SitDown: 'sitDown', Seated: 'seated', SeatedTalk: 'seatedTalk', StandUp: 'standUp' };

/** A glTF container loaded once per application and handed to whoever asked, in order. */
export class ContainerLibrary {
  private asset: pc.Asset | null = null;
  private waiting: Array<(a: pc.Asset) => void> = [];
  private failed: string | null = null;
  constructor(readonly app: pc.Application, private readonly url: string, private readonly filename: string) {}
  load(): void {
    if (this.asset || this.failed) return;
    this.app.assets.loadFromUrlAndFilename(this.url, this.filename, 'container', (err, asset) => {
      if (err || !asset) { this.failed = String(err ?? 'no asset'); console.warn(`[room] ${this.filename} did not load:`, this.failed); return; }
      this.asset = asset; for (const w of this.waiting) w(asset); this.waiting = [];
    });
  }
  ready(fn: (a: pc.Asset) => void): void { if (this.asset) fn(this.asset); else { this.waiting.push(fn); this.load(); } }
  get loaded(): boolean { return !!this.asset; }
}

export const SKIN_WORDS = ['oak', 'slate', 'brass', 'rose', 'moss', 'ink'];
/**
 * OUTFITS THAT ARE NOT IN THE RANDOM DRAW.
 *
 * `SKIN_WORDS` is what a body is dressed in when nobody said — six palettes, handed out by a hash. A costume
 * belongs to a JOB and must never be dealt to a passer-by: the dealer's evening blacks (`tux`) are worn by
 * the one person at the table whose job is different, and by nobody else in the room.
 */
export const COSTUMES = ['tux'];

/** Which bodies the room ships. A figure is a LOOK a person is given, never a fact recorded about them. */
export type Figure = 'm' | 'f' | 'tux';
const FIGURE_FILE: Record<Figure, string> = { m: 'person.glb', f: 'person-f.glb', tux: 'person-tux.glb' };
/**
 * A GARMENT IS A MATERIAL ON THE BODY, not a repainted texture (2026-09-15).
 *
 * The bodies the room ships now carry their own materials — Shirt, Pants, Skin, Hair, Shoes, Eyes as separate
 * flat colours — so an outfit is one cloned material tinted, and everything that makes the person a person is
 * left exactly as the artist authored it. This is what the 32×32 palette was imitating, done properly: eight
 * people in eight outfits still cost one download per figure.
 */
const GARMENT = /^(shirt|top|dress|jacket|coat|vest|blouse)\d*$/i;
const OUTFITS: Record<string, [number, number, number]> = {
  oak: [0.32, 0.20, 0.10], slate: [0.13, 0.17, 0.25], brass: [0.42, 0.30, 0.09],
  rose: [0.38, 0.13, 0.19], moss: [0.11, 0.24, 0.14], ink: [0.08, 0.08, 0.11],
  tux: [0.02, 0.02, 0.02],
};

/**
 * THE BODY every participant is instantiated from — one rigged, clothed, ordinary human (CC0,
 * `public/room/person.glb`) — and an OUTFIT per palette word. The outfit is a 32×32 palette the mesh's UVs point
 * at, so a person's clothes are a 140-byte swatch swapped onto a cloned material, not another body: six people
 * in six outfits cost one 756 KB download and six swatches.
 */
export class AvatarLibrary extends ContainerLibrary {
  private skins = new Map<string, pc.Asset>();
  /**
   * WHICH BODIES SIT ON THEIR OWN CLIPS. `person.glb` (the low-poly man) carries the seated set RETARGETED from a
   * foreign rig, which hunches, so the room poses its idle instead; `person-f.glb` is a Quaternius base character
   * whose seated clips are its own. A body is an asset, and this is the one fact about an asset the room cannot
   * measure from the file at load — so it is stated here, beside the file names, and moves with them.
   */
  static readonly NATIVE_SEAT: Record<Figure, boolean> = { m: true, f: true, tux: true };
  sitsNatively(which: Figure): boolean { return AvatarLibrary.NATIVE_SEAT[which]; }
  /** Figures other than the default, each loaded the first time somebody asks for it. */
  private others = new Map<Figure, ContainerLibrary>();
  constructor(app: pc.Application, private readonly dir: string) { super(app, `${dir}/person.glb`, 'person.glb'); }

  /**
   * TWO FIGURES, ONE RIG.
   *
   * A room where everybody has the same build is a room of one person copied, and the first thing anybody
   * notices is that Alice is not a woman. Both bodies come off the same skeleton with the same clip names
   * (`scripts/check-body.mjs` proves it before either ships), so the animation graph, the seated pose, the
   * gaze layer and every outfit swatch are shared — a second figure costs one download and no code.
   */
  figure(which: Figure): ContainerLibrary {
    if (which === 'm') return this;
    let lib = this.others.get(which);
    if (!lib) { lib = new ContainerLibrary(this.app, `${this.dir}/${FIGURE_FILE[which]}`, FIGURE_FILE[which]); lib.load(); this.others.set(which, lib); }
    return lib;
  }
  /** The colour this outfit word dresses a garment in, for a body that wears real materials. */
  static outfit(word: string): pc.Color { const [r, g, b] = OUTFITS[word] ?? [0.13, 0.17, 0.25]; return new pc.Color(r, g, b); }
  /** The outfit for this palette word, loading it the first time it is asked for. */
  skin(word: string, fn: (t: pc.Texture) => void): void {
    const w = SKIN_WORDS.includes(word) || COSTUMES.includes(word) ? word : 'slate';
    let asset = this.skins.get(w);
    if (!asset) {
      asset = new pc.Asset(`skin-${w}`, 'texture', { url: `${this.dir}/skin-${w}.png` }, { srgb: true });
      this.app.assets.add(asset); this.skins.set(w, asset);
    }
    if (asset.loaded) { fn(asset.resource as pc.Texture); return; }
    asset.ready((a) => fn(a.resource as pc.Texture)); this.app.assets.load(asset);
  }
}

/**
 * THE FURNITURE KIT — Kenney's CC0 pieces (`public/room/lounge-kit.glb`, one named node each), instantiated once
 * as a template and CLONED per placement, so a lounge is a list of (piece, x, z, yaw) and a new piece is a node
 * in the file. Kenney's pivots sit at a CORNER, so every clone is wrapped in a pivot at its footprint's centre —
 * without it a chair turns about its arm and the person sits beside it.
 */
export class RoomKit extends ContainerLibrary {
  private template: pc.Entity | null = null;
  private missing = new Set<string>();
  private centres = new Map<string, pc.Vec3>();
  constructor(app: pc.Application, url: string) { super(app, url, 'lounge-kit.glb'); }
  private ensure(asset: pc.Asset): pc.Entity {
    if (!this.template) { this.template = (asset.resource as pc.ContainerResource).instantiateRenderEntity(); this.template.enabled = false; }
    return this.template;
  }
  /**
   * A clone of `piece` at (x, z) on the floor, turned `yawDeg`, under `parent`. Null until the kit is loaded.
   *
   * `stain` MULTIPLIES each cloned material's diffuse rather than replacing it (2026-09-15). The kit is pale
   * beige throughout, which beside dark-walnut card chairs and a parquet floor reads as furniture borrowed from
   * another room; multiplying keeps the piece's own light and shade — cushion against frame, seat against leg —
   * and only moves the whole thing into the room's wood. Replacing the material flattens the piece to one colour.
   */
  place(piece: string, parent: pc.Entity, x: number, z: number, yawDeg = 0, scale = 1, stain?: pc.Color): pc.Entity | null {
    if (!this.loaded) return null;
    let src: pc.Entity | null = null;
    this.ready((a) => { src = this.ensure(a).findByName(piece) as pc.Entity | null; });
    if (!src) { if (!this.missing.has(piece)) { this.missing.add(piece); console.warn('[room] no such piece in the kit:', piece); } return null; }
    const e = (src as pc.Entity).clone(); e.enabled = true;
    for (const r of e.findComponents('render') as pc.RenderComponent[]) {
      r.castShadows = true; r.receiveShadows = true;
      if (stain) for (const mi of r.meshInstances) {
        const m = (mi.material as pc.StandardMaterial).clone(); mi.material = m;
        m.diffuse = new pc.Color(m.diffuse.r * stain.r, m.diffuse.g * stain.g, m.diffuse.b * stain.b);
        m.update();
      }
    }
    let centre = this.centres.get(piece);
    if (!centre) {
      const box = new pc.BoundingBox(); let first = true;
      for (const r of (src as pc.Entity).findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) { if (first) { box.copy(mi.aabb); first = false; } else box.add(mi.aabb); }
      centre = new pc.Vec3(box.center.x, 0, box.center.z); this.centres.set(piece, centre);
    }
    const pivot = new pc.Entity(piece);
    const s0 = (src as pc.Entity).getLocalScale();
    e.setLocalScale(s0.x, s0.y, s0.z); e.setLocalPosition(-centre.x, 0, -centre.z);
    pivot.addChild(e);
    pivot.setLocalScale(scale, scale, scale); pivot.setLocalPosition(x, 0, z); pivot.setLocalEulerAngles(0, yawDeg, 0);
    parent.addChild(pivot);
    return pivot;
  }
}

export interface Seat { at: pc.Vec3; yaw: number; /** the felt's centre, where a seated body rests its eyes */ centre?: pc.Vec3 }

/**
 * ONE PARTICIPANT'S BODY. Owns its place and its facing, eases toward where it is told to be, and tells the
 * animation graph only what it is doing — how fast it moves, whether it is in a chair, whether it is talking.
 */
export class ParticipantAvatar {
  readonly entity: pc.Entity;
  /** where the body is, on the floor */
  readonly pos = new pc.Vec3();
  yaw = 0;
  private target = new pc.Vec3();
  private last = new pc.Vec3();
  private targetYaw = 0;
  private seat: Seat | null = null;
  private body: pc.Entity | null = null;
  private speed = 0;
  private talk = false;
  private pendingGesture: Gesture | null = null;
  /** the head bone, once dressed, and where it is looking — eased, applied after the clip each frame */
  private head: pc.GraphNode | null = null;
  private gaze: pc.Vec3 | null = null;
  private gazeYaw = 0; private gazePitch = 0;
  /** the right arm, for a procedural dealing reach applied after the clip */
  private upperArmR: pc.GraphNode | null = null;
  private foreArmR: pc.GraphNode | null = null;
  private upperArmL: pc.GraphNode | null = null;
  private cheerPulse = 0; // a winner's arms going up, seated or standing
  private seatBlend = 0; // 0 standing … 1 sitting, eased
  private nodPulse = 0;  // a greeting, when somebody looks at you
  private posed = new Map<keyof typeof BONES, pc.GraphNode>();
  private dealPulse = 0; // 1 the instant a card is dealt, decaying — the arm flicks toward the felt
  /** how the body moves: `direct` is placed by its owner each frame (your own), `follow` eases to its target (everybody else) */
  private nativeSeat = false;
  constructor(library: AvatarLibrary, private readonly palette: string, private readonly mode: 'direct' | 'follow', readonly which: Figure = 'm') {
    this.entity = new pc.Entity('avatar');
    // The FIGURE decides which GLB is instantiated; the LIBRARY still holds every outfit, because the two
    // bodies share a rig and a UV layout and therefore share swatches.
    library.figure(which).ready((asset) => this.dress(asset, library));
  }

  /**
   * A BODY THAT CAME DRESSED IS NOT REPAINTED.
   *
   * The two figures are built differently and both are right: the first is ONE mesh with one material and a
   * 32-byte palette its UVs point at, so an outfit is a swatch; the second is the base character with its own
   * clothes, hair and eyes baked as textures. Painting the palette over the second put a man's shirt colours
   * across a woman's face — the swatch only belongs to the body whose UVs were laid out for it.
   */
  private dress(asset: pc.Asset, library: AvatarLibrary): void {
    const res = asset.resource as pc.ContainerResource & { animations: pc.Asset[] };
    const body = res.instantiateRenderEntity();
    const palette = (body.findComponents('render') as pc.RenderComponent[])
      .every((r) => r.meshInstances.every((mi) => /texture/i.test((mi.material as pc.StandardMaterial).name ?? '')));
    // one outfit per person: the body's material, cloned, wears this palette word's swatch. NEAREST filtering,
    // because it is a palette — smoothing it bleeds the shirt's colour into the skin along every UV seam.
    for (const render of body.findComponents('render') as pc.RenderComponent[]) {
      for (const mi of render.meshInstances) {
        const src = mi.material as pc.StandardMaterial;
        if (palette) {
          // A PALETTE BODY: its UVs point at a 32×32 swatch, so the outfit IS the texture.
          const m = src.clone(); mi.material = m;
          library.skin(this.palette, (t) => { t.minFilter = pc.FILTER_NEAREST_MIPMAP_NEAREST; t.magFilter = pc.FILTER_NEAREST; m.diffuseMap = t; m.update(); });
        } else if (GARMENT.test(src.name ?? '')) {
          // A BODY WITH ITS OWN MATERIALS: only the garment is this person's, and everything else — skin, hair,
          // eyes, shoes — stays exactly as the artist authored it. Repainting all of them was the bug that put
          // the old palette over a textured woman and left her looking undressed.
          const m = src.clone(); mi.material = m;
          m.diffuse = AvatarLibrary.outfit(this.palette); m.update();
        }
      }
      render.castShadows = true;
    }
    body.addComponent('anim', { activate: true });
    const anim = body.anim!;
    anim.loadStateGraph(new pc.AnimStateGraph(GRAPH));
    const tracks = new Map<string, pc.AnimTrack>();
    // the container names its animation ASSETS `<file>/animation/<i>`; the clip's own name is on the track
    for (const a of res.animations) { const t = a.resource as pc.AnimTrack; tracks.set(t.name, t); }
    const missing: string[] = [];
    this.nativeSeat = library.sitsNatively(this.which);
    const stateClip: Record<string, keyof typeof CLIPS> = this.nativeSeat ? { ...STATE_CLIP, ...NATIVE_SEAT_CLIP } : STATE_CLIP;
    for (const [state, key] of Object.entries(stateClip)) {
      const t = CLIPS[key].map((n) => tracks.get(n)).find(Boolean);
      // A STATE WITH NO TRACK plays a placeholder of duration MAX_VALUE and the body stands in a T-pose there,
      // with nothing said; naming what is missing is the difference between a bad body and a mystery.
      if (t) anim.assignAnimation(state, t); else missing.push(`${state} (${CLIPS[key][0]})`);
    }
    if (missing.length) console.warn('[room] this body has no clip for:', missing.join(', '), '— see docs/AVATARS.md');
    anim.setBoolean('seated', !!this.seat);
    this.entity.addChild(body);
    this.body = body;
    this.head = findAny(body, BONES.head);
    this.upperArmR = findAny(body, BONES.armR); this.foreArmR = findAny(body, BONES.foreR);
    this.upperArmL = findAny(body, BONES.armL);
    if (!this.head || !this.upperArmR) console.warn('[room] this body carries no bone the room knows by name — the gaze and the reach will not run. See docs/AVATARS.md.');
    for (const [key] of SEAT_POSE) { const n = findAny(body, BONES[key]); if (n) this.posed.set(key, n); }
  }

  private get anim(): pc.AnimComponent | null { return this.body?.anim ?? null; }
  /** A bone's world position and rotation this frame (the dealer's hand, for the deck) — null until dressed. */
  bone(name: keyof typeof BONES): pc.GraphNode | null { return this.body ? findAny(this.body, BONES[name]) : null; }
  /** The right hand's world position (the dealer deals from here) — null until dressed. */
  get dealHand(): pc.Vec3 | null { const h = this.bone('handR'); return h ? h.getPosition().clone() : null; }
  /** Somebody is looking at you: nod back, once. */
  nod(): void { if (this.nodPulse <= 0.01) this.nodPulse = 1; }
  /** The nod itself, layered on the head after the gaze — a dip and back over about half a second. */
  applyNod(dt: number): void {
    if (this.nodPulse <= 0.001 || !this.head) { this.nodPulse = Math.max(0, this.nodPulse - dt * 2); return; }
    const dip = Math.sin(this.nodPulse * Math.PI) * 16;
    const right = new pc.Vec3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.head.setRotation(new pc.Quat().setFromAxisAngle(right, -dip).mul(this.head.getRotation()));
    this.nodPulse = Math.max(0, this.nodPulse - dt * 2);
  }
  /** Reach with the dealing arm now — a card leaving the hand, or chips pushed out. */
  dealFlick(): void { this.dealPulse = 1; }
  /**
   * WON THE POT: both arms up, twice, over about a second and a half.
   *
   * Not the `Dance_Loop` clip, because the graph only reaches a gesture from Idle and a winner is usually IN A
   * CHAIR — a standing dance clip on a seated body stands them up out of it. Arms layered on whatever clip is
   * playing celebrate from the chair, which is what winning a pot actually looks like.
   */
  celebrate(): void { this.cheerPulse = 1; }
  /**
   * AFTER THE CLIP: the reach, layered on the right arm IN THE BONE'S OWN FRAME, out and back over ~0.45 s.
   *
   * THE AXIS WAS MEASURED, not guessed (scratch `armaxis.cjs`): on this rig +X on `upperarm_r` carries the hand
   * UP AND FORWARD — 0.26 m at 40° — which is the dealing motion; Z, which this used at first, slid the hand
   * sideways 0.17 m and read as nothing. The delta POST-multiplies the clip's local rotation, so it is the
   * bone's own frame, exactly as the probe measured it.
   */
  applyDeal(dt: number): void {
    if (this.dealPulse <= 0.001 || !this.upperArmR || !this.foreArmR) { this.dealPulse = Math.max(0, this.dealPulse - dt * 1.3); return; }
    const swing = Math.sin(this.dealPulse * Math.PI); // 0 → out → 0 as the pulse decays
    const du = new pc.Quat().setFromEulerAngles(swing * 52, 0, 0);
    const df = new pc.Quat().setFromEulerAngles(swing * 46, 0, 0);
    this.upperArmR.setLocalRotation(this.upperArmR.getLocalRotation().clone().mul(du));
    this.foreArmR.setLocalRotation(this.foreArmR.getLocalRotation().clone().mul(df));
    this.dealPulse = Math.max(0, this.dealPulse - dt * 1.3); // ~0.8 s: a reach a person actually sees
  }
  /**
   * THE CHAIR, layered after the clip: the legs fold, the spine leans, the arms come to the table, and the whole
   * body drops by the height of a seat. Eased both ways, so sitting down and standing up are a movement rather
   * than a snap. Applied in the bone's own frame, from angles measured on a standing body.
   */
  applySeat(dt: number): void {
    if (this.nativeSeat) return; // the clip sits the body; there is nothing to bend
    const want = this.seat ? 1 : 0;
    this.seatBlend += (want - this.seatBlend) * Math.min(1, dt * 5);
    if (this.seatBlend < 0.002) return;
    const k = this.seatBlend;
    for (const [key, deg] of SEAT_POSE) {
      const n = this.posed.get(key); if (!n) continue;
      n.setLocalRotation(n.getLocalRotation().clone().mul(new pc.Quat().setFromEulerAngles(deg * k, 0, 0)));
    }
    const p = this.entity.getPosition(); const back = SEAT_BACK * k;
    this.entity.setPosition(p.x - Math.sin(this.yaw) * back, -SEAT_DROP * k, p.z - Math.cos(this.yaw) * back);
  }
  /**
   * The winner's arms, layered after the clip like the reach. MEASURED (scratch `liftaxis.cjs`): −X raises BOTH
   * upper arms, by about half a metre at 80° — the Y this first used moved a hand by a centimetre, which is to
   * say the celebration was invisible.
   */
  applyCheer(dt: number): void {
    if (this.cheerPulse <= 0.001 || !this.upperArmR || !this.upperArmL) { this.cheerPulse = Math.max(0, this.cheerPulse - dt * 0.55); return; }
    const p = this.cheerPulse;
    const lift = Math.sin(p * Math.PI) * (0.7 + 0.3 * Math.sin(p * Math.PI * 6)); // up, with two pumps in it
    const q = new pc.Quat().setFromEulerAngles(-lift * 105, 0, 0);
    this.upperArmR.setLocalRotation(this.upperArmR.getLocalRotation().clone().mul(q));
    this.upperArmL.setLocalRotation(this.upperArmL.getLocalRotation().clone().mul(q));
    this.cheerPulse = Math.max(0, this.cheerPulse - dt * 0.55); // ~1.8 s of arms in the air
  }
  /** for the walk scripts: which state the graph is in */
  get debug(): Record<string, unknown> { const an = this.anim; return { dressed: !!this.body, state: an?.baseLayer?.activeState, playing: an?.playing, playable: an?.playable, speed: this.speed, seated: !!this.seat, talking: this.talk }; }

  // ── the semantic acts ──
  /** Put the body here now, facing this way (your own, each frame; everybody else's first appearance). */
  place(x: number, z: number, yaw: number): void { this.pos.set(x, 0, z); this.target.set(x, 0, z); this.last.set(x, 0, z); this.yaw = yaw; this.targetYaw = yaw; this.entity.setPosition(this.pos); this.entity.setEulerAngles(0, yaw * 180 / Math.PI, 0); }
  /** Head for here (everybody else's poses arrive this way; your own goal is walked by the controller). */
  walkTo(x: number, z: number, yaw: number): void { if (this.seat) return; this.target.set(x, 0, z); this.targetYaw = yaw; }
  /** Into this chair: the body goes to the seat and the graph sits it down. */
  sitAt(seat: Seat): void { this.seat = seat; this.target.copy(seat.at); this.targetYaw = seat.yaw; this.anim?.setBoolean('seated', true); }
  /** Out of the chair. */
  stand(): void { if (!this.seat) return; this.seat = null; this.anim?.setBoolean('seated', false); }
  get seated(): boolean { return !!this.seat; }
  get seatCentre(): pc.Vec3 | null { return this.seat?.centre ? new pc.Vec3(this.seat.centre.x, 0.95, this.seat.centre.z) : null; }
  /** Mouth moving: the talking loops, standing or seated. */
  talking(on: boolean): void { if (this.talk === on) return; this.talk = on; this.anim?.setBoolean('talking', on); }
  /** A one-shot from the idle: a wave-like interact, a reach to the table, a dance. */
  gesture(g: Gesture): void { this.pendingGesture = g; }
  /** Turn to face a point on the floor (a standing body turns its whole self; a seated one turns its head). */
  lookAt(x: number, z: number): void { if (this.seat) { this.gaze = new pc.Vec3(x, 1.2, z); return; } this.targetYaw = Math.atan2(x - this.pos.x, z - this.pos.z); }
  /** Look at this point with the HEAD only — whoever is acting, speaking, or walking up. Null looks ahead again. */
  lookHead(target: pc.Vec3 | null): void { this.gaze = target; }
  /**
   * AFTER THE CLIP, EVERY FRAME: turn the head toward the gaze, within what a neck does (±70° yaw, ±25° pitch),
   * eased. The clip sets the head's rotation in `update`; this is applied in `postUpdate`, on top of it, in
   * world space, so it holds for every clip and every body without knowing the rig's rest pose.
   */
  applyGaze(dt: number): void {
    const h = this.head; if (!h) return;
    let wantYaw = 0, wantPitch = 0;
    if (this.gaze) {
      const hp = h.getPosition();
      const dx = this.gaze.x - hp.x, dy = this.gaze.y - hp.y, dz = this.gaze.z - hp.z;
      const dist = Math.hypot(dx, dz);
      wantYaw = clamp(wrap(Math.atan2(dx, dz) - this.yaw), -1.22, 1.22);
      wantPitch = clamp(Math.atan2(dy, dist), -0.44, 0.44);
      // behind you is nobody's business: past the neck's reach the head just comes back to the front
      if (Math.abs(wrap(Math.atan2(dx, dz) - this.yaw)) > 1.9) { wantYaw = 0; wantPitch = 0; }
    }
    const k = Math.min(1, dt * 6);
    this.gazeYaw += (wantYaw - this.gazeYaw) * k; this.gazePitch += (wantPitch - this.gazePitch) * k;
    if (Math.abs(this.gazeYaw) < 1e-3 && Math.abs(this.gazePitch) < 1e-3) return;
    // yaw about the world's up, pitch about the body's right, composed onto the clip's world rotation
    const right = new pc.Vec3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const q = new pc.Quat().setFromAxisAngle(pc.Vec3.UP, this.gazeYaw * 180 / Math.PI);
    const qp = new pc.Quat().setFromAxisAngle(right, -this.gazePitch * 180 / Math.PI);
    h.setRotation(q.mul(qp).mul(h.getRotation()));
  }

  /** Every frame: ease toward the target (follow mode), face the way we are going, tell the graph. */
  update(dt: number): void {
    if (this.mode === 'follow' || this.seat) {
      this.pos.lerp(this.pos, this.target, Math.min(1, dt * (this.seat ? 6 : 8)));
    }
    // speed is measured from where the body was last frame, whoever moved it — the controller (your own) or the easing
    const stepped = this.pos.distance(this.last) / Math.max(dt, 1e-3);
    this.last.copy(this.pos);
    this.speed += (stepped - this.speed) * Math.min(1, dt * 10);
    this.yaw += wrap(this.targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.entity.setPosition(this.pos);
    this.entity.setEulerAngles(0, this.yaw * 180 / Math.PI, 0);
    const anim = this.anim;
    if (!anim) return;
    anim.setFloat('speed', this.seat ? 0 : this.speed);
    if (this.pendingGesture) {
      const n = this.pendingGesture === 'interact' ? 1 : this.pendingGesture === 'pickUp' ? 2 : 3;
      anim.setInteger('gesture', n); this.pendingGesture = null;
      setTimeout(() => anim.setInteger('gesture', 0), 400);
    }
  }
  /** Your own body: the controller moved `pos` itself this frame; keep the target with it (the facing is `face`'s). */
  moved(): void { this.target.copy(this.pos); }
  /** Face this way now — the controller's own turn, not eased. */
  face(yaw: number): void { this.yaw = yaw; this.targetYaw = yaw; }
  destroy(): void { this.entity.destroy(); }
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function wrap(a: number): number { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
