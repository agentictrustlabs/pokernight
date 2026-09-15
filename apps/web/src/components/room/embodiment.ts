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

/** The clips the graph plays, by the name they carry in the GLB. */
const CLIPS = {
  idle: 'Idle_Loop', talk: 'Idle_Talking_Loop', walk: 'Walk_Loop',
  sitDown: 'Sitting_Enter', seated: 'Sitting_Idle_Loop', seatedTalk: 'Sitting_Talking_Loop', standUp: 'Sitting_Exit',
  interact: 'Interact', pickUp: 'PickUp_Table', dance: 'Dance_Loop',
} as const;
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
const STATE_CLIP: Record<string, keyof typeof CLIPS> = { Idle: 'idle', Talk: 'talk', Walk: 'walk', SitDown: 'sitDown', Seated: 'seated', SeatedTalk: 'seatedTalk', StandUp: 'standUp', Interact: 'interact', PickUp: 'pickUp', Dance: 'dance' };

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

/** Which of the two bodies a palette word wears, and where its skin is. */
export function bodyOf(word: string): 'm' | 'f' { return word === 'rose' || word === 'moss' || word === 'brass' ? 'f' : 'm'; }
export const SKIN_WORDS = ['oak', 'slate', 'brass', 'rose', 'moss', 'ink'];

/**
 * THE BODIES every participant is instantiated from — two rigged, dressed humans (CC0, `public/room/person-m|f.glb`)
 * with the same clips on the same bone names — and a SKIN per palette word (`skin-<m|f>-<word>.webp`, the base
 * colour with the clothes painted on), loaded once each and shared.
 */
export class AvatarLibrary {
  private bodies: Record<'m' | 'f', ContainerLibrary>;
  private skins = new Map<string, pc.Asset>();
  constructor(readonly app: pc.Application, private readonly dir: string) {
    this.bodies = { m: new ContainerLibrary(app, `${dir}/person-m.glb`, 'person-m.glb'), f: new ContainerLibrary(app, `${dir}/person-f.glb`, 'person-f.glb') };
  }
  load(): void { this.bodies.m.load(); this.bodies.f.load(); }
  ready(sex: 'm' | 'f', fn: (a: pc.Asset) => void): void { this.bodies[sex].ready(fn); }
  get loaded(): boolean { return this.bodies.m.loaded && this.bodies.f.loaded; }
  /** The skin for this palette word on this body, loading it the first time it is asked for. */
  skin(sex: 'm' | 'f', word: string, fn: (t: pc.Texture) => void): void {
    const w = SKIN_WORDS.includes(word) ? word : 'slate';
    const key = `${sex}-${w}`;
    let asset = this.skins.get(key);
    if (!asset) {
      asset = new pc.Asset(`skin-${key}`, 'texture', { url: `${this.dir}/skin-${key}.webp` }, { srgb: true });
      this.app.assets.add(asset); this.skins.set(key, asset);
    }
    if (asset.loaded) { fn(asset.resource as pc.Texture); return; }
    asset.ready((a) => fn(a.resource as pc.Texture)); this.app.assets.load(asset);
  }
}

/**
 * THE FURNITURE KIT — Kenney's CC0 pieces (`public/room/lounge-kit.glb`, one named node each), instantiated once
 * as a template and CLONED per placement, so a lounge is a list of (piece, x, z, yaw) and a new piece is a
 * node in the file. A piece the kit does not carry places nothing and says so once.
 */
export class RoomKit extends ContainerLibrary {
  private template: pc.Entity | null = null;
  private missing = new Set<string>();
  /** each piece's footprint centre in its own frame — Kenney's pivots sit at a corner, and a chair must turn about its middle */
  private centres = new Map<string, pc.Vec3>();
  constructor(app: pc.Application, url: string) { super(app, url, 'lounge-kit.glb'); }
  private ensure(asset: pc.Asset): pc.Entity {
    if (!this.template) { this.template = (asset.resource as pc.ContainerResource).instantiateRenderEntity(); this.template.enabled = false; }
    return this.template;
  }
  /** A clone of `piece` at (x, z) on the floor, turned `yawDeg`, under `parent`. Null until the kit is loaded. */
  place(piece: string, parent: pc.Entity, x: number, z: number, yawDeg = 0, scale = 1): pc.Entity | null {
    if (!this.loaded) return null;
    let src: pc.Entity | null = null;
    this.ready((a) => { src = this.ensure(a).findByName(piece) as pc.Entity | null; });
    if (!src) { if (!this.missing.has(piece)) { this.missing.add(piece); console.warn('[room] no such piece in the kit:', piece); } return null; }
    const e = (src as pc.Entity).clone(); e.enabled = true;
    for (const r of e.findComponents('render') as pc.RenderComponent[]) { r.castShadows = true; r.receiveShadows = true; }
    let centre = this.centres.get(piece);
    if (!centre) {
      // the template stands at the origin: the union of its mesh bounds is the piece's footprint
      const box = new pc.BoundingBox(); let first = true;
      for (const r of (src as pc.Entity).findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) { if (first) { box.copy(mi.aabb); first = false; } else box.add(mi.aabb); }
      centre = new pc.Vec3(box.center.x, 0, box.center.z); this.centres.set(piece, centre);
    }
    // a pivot at the footprint's middle: the placement turns the piece about its centre, not a corner
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
  /** how the body moves: `direct` is placed by its owner each frame (your own), `follow` eases to its target (everybody else) */
  constructor(library: AvatarLibrary, private readonly palette: string, private readonly mode: 'direct' | 'follow') {
    this.entity = new pc.Entity('avatar');
    const sex = bodyOf(palette);
    library.ready(sex, (asset) => this.dress(asset, library, sex));
  }

  private dress(asset: pc.Asset, library: AvatarLibrary, sex: 'm' | 'f'): void {
    const res = asset.resource as pc.ContainerResource & { animations: pc.Asset[] };
    const body = res.instantiateRenderEntity();
    // one skin per person: the body's material, cloned, wears the palette word's painted clothes
    for (const render of body.findComponents('render') as pc.RenderComponent[]) {
      for (const mi of render.meshInstances) {
        const src = mi.material as pc.StandardMaterial;
        if (!/Superhero/.test(src.name)) continue;
        const m = src.clone(); mi.material = m;
        library.skin(sex, this.palette, (t) => { m.diffuseMap = t; m.update(); });
      }
      render.castShadows = true;
    }
    body.addComponent('anim', { activate: true });
    const anim = body.anim!;
    anim.loadStateGraph(new pc.AnimStateGraph(GRAPH));
    const tracks = new Map<string, pc.AnimTrack>();
    // the container names its animation ASSETS `<file>/animation/<i>`; the clip's own name is on the track
    for (const a of res.animations) { const t = a.resource as pc.AnimTrack; tracks.set(t.name, t); }
    for (const [state, key] of Object.entries(STATE_CLIP)) { const t = tracks.get(CLIPS[key]); if (t) anim.assignAnimation(state, t); }
    anim.setBoolean('seated', !!this.seat);
    this.entity.addChild(body);
    this.body = body;
    this.head = body.findByName('Head');
  }

  private get anim(): pc.AnimComponent | null { return this.body?.anim ?? null; }
  /** A bone's world position and rotation this frame (the dealer's hand, for the deck) — null until dressed. */
  bone(name: string): pc.GraphNode | null { return this.body?.findByName(name) ?? null; }
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
