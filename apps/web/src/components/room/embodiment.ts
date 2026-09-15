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

/** The one body every participant is instantiated from: the container, loaded once per application. */
export class AvatarLibrary {
  private asset: pc.Asset | null = null;
  private waiting: Array<(a: pc.Asset) => void> = [];
  private failed: string | null = null;
  constructor(private readonly app: pc.Application, private readonly url: string) {}
  load(): void {
    if (this.asset || this.failed) return;
    this.app.assets.loadFromUrlAndFilename(this.url, 'mannequin.glb', 'container', (err, asset) => {
      if (err || !asset) { this.failed = String(err ?? 'no asset'); console.warn('[room] the body did not load:', this.failed); return; }
      this.asset = asset; for (const w of this.waiting) w(asset); this.waiting = [];
    });
  }
  ready(fn: (a: pc.Asset) => void): void { if (this.asset) fn(this.asset); else { this.waiting.push(fn); this.load(); } }
  get loaded(): boolean { return !!this.asset; }
}

export interface Seat { at: pc.Vec3; yaw: number }

/** Body palettes, from the presence record's `body` word. */
const BODY_COLOURS: Record<string, [number, number, number]> = {
  oak: [0.66, 0.49, 0.18], slate: [0.31, 0.36, 0.41], brass: [0.85, 0.70, 0.42], rose: [0.65, 0.22, 0.18], moss: [0.18, 0.44, 0.32], ink: [0.11, 0.14, 0.13],
};

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
  /** how the body moves: `direct` is placed by its owner each frame (your own), `follow` eases to its target (everybody else) */
  constructor(library: AvatarLibrary, private readonly palette: string, private readonly mode: 'direct' | 'follow') {
    this.entity = new pc.Entity('avatar');
    library.ready((asset) => this.dress(asset));
  }

  private dress(asset: pc.Asset): void {
    const res = asset.resource as pc.ContainerResource & { animations: pc.Asset[] };
    const body = res.instantiateRenderEntity();
    // one palette per person: the mannequin's material, cloned and tinted, so every body is its own colour
    const [r, g, b] = BODY_COLOURS[this.palette] ?? [0.5, 0.5, 0.5];
    for (const render of body.findComponents('render') as pc.RenderComponent[]) {
      render.meshInstances.forEach((mi, i) => {
        const m = (mi.material as pc.StandardMaterial).clone();
        m.diffuse = i === 0 ? new pc.Color(r, g, b) : new pc.Color(0.93, 0.87, 0.78);
        m.update(); mi.material = m;
      });
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
  }

  private get anim(): pc.AnimComponent | null { return this.body?.anim ?? null; }
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
  /** Mouth moving: the talking loops, standing or seated. */
  talking(on: boolean): void { if (this.talk === on) return; this.talk = on; this.anim?.setBoolean('talking', on); }
  /** A one-shot from the idle: a wave-like interact, a reach to the table, a dance. */
  gesture(g: Gesture): void { this.pendingGesture = g; }
  /** Turn to face a point on the floor (a seated body turns its whole self a little; head-only comes with layer masks). */
  lookAt(x: number, z: number): void { if (this.seat) return; this.targetYaw = Math.atan2(x - this.pos.x, z - this.pos.z); }

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
  /** Your own body: the controller moved `pos`/`yaw` itself this frame; keep the target with it. */
  moved(): void { this.target.copy(this.pos); this.targetYaw = this.yaw; }
  destroy(): void { this.entity.destroy(); }
}

function wrap(a: number): number { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
