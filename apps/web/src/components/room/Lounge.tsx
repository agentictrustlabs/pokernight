import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pc from 'playcanvas';
import type { RoomManifest, RoomPerson } from '@pokernight/protocol';
import type { TableView } from '../../lib/types';
import type { RoomSocket, RoomState } from '../../lib/roomSocket';
import { Portrait } from '../huddle/Portrait';
import { AvatarLibrary, ParticipantAvatar, RoomKit, type Seat } from './embodiment';
import { isSpeaking } from './speaking';
import { Deck3D } from './cards3d';
import { Chips3D } from './chips3d';

/**
 * THE LOUNGE — the scene, on PlayCanvas (docs/SPATIAL-ROOM.md §3.1, phase 1 steps 1–2; PlayCanvas chosen
 * 2026-09-14 for its editor and asset pipeline — a lounge and its bodies will be authored there and loaded as
 * scenes, and this file is the runtime that stands the room up from the manifest).
 *
 * Built-in scenery for now: a felt-green floor, walls, tables under lamps on the manifest's anchors, the bar,
 * the fire, the guest's lectern. BODIES ARE `ParticipantAvatar`s (embodiment.ts): one rigged human per
 * participant, told what it is doing — walk here, sit there, stand, talk — never how to move a limb. Name
 * plates and speech bubbles are HTML laid over the canvas at each body's projected screen position, so they
 * are real text. Your body walks with WASD / arrows or a click on the floor; the camera follows from behind
 * and above; others ease toward their last pose. The scene draws PRESENCE and nothing else — who is in which
 * chair is the table's to say.
 */

const WALK_SPEED = 2.0; // m/s — the walk clip's stride, so feet do not slide
const ROOM_DIR = '/room';
const KIT_URL = '/room/lounge-kit.glb';
const CHAIR_R = 1.78; // where a seated body's feet go, from the table's centre — knees under the rail, as at a real table
const TABLE_SOLID = 1.72; // a walking body cannot come nearer the centre than this (just inside CHAIR_R)
const CHAIR_BACK = 0.32; // the seated hips sit this far behind the feet (measured on the seated clip), so the chair does too
const deckSide = new pc.StandardMaterial();
const CHAIR_PIECE = 'loungeChair'; // a padded armchair at the felt, not a kitchen chair
const CHAIR_SCALE = 0.85; // the kit's chairs are 1.15 m with the pad at ~0.55; at 0.85 the pad meets the seated hips (~0.47)

export interface LoungeProps {
  socket: RoomSocket;
  state: RoomState;
  onZone?: (zone: string | null) => void;
  /** Your body has walked up to this chair and turned to it: the page takes the seat at the TABLE. */
  onSitRequest?: (tableId: string, seat: number) => void;
  /** THE FELT (spec §3.4, step 5): the seated table's view, drawn on its table — cards, pot, whose turn. */
  board?: { tableId: string; view: TableView; names: Record<string, string> } | null;
}
/** What the page can tell the lounge to do with your body. */
export interface LoungeHandle {
  /** Walk to this chair; `onSitRequest` fires on arrival. */
  walkToSeat: (tableId: string, seat: number) => boolean;
}

interface BodyHandle { avatar: ParticipantAvatar; name: string }
interface Plate {
  id: string; kind: 'name' | 'table' | 'anchor' | 'bubble' | 'pot'; text: string; sub?: string; world: pc.Vec3; you?: boolean;
  /** whose face hangs on the plate, when the huddle has one */ face?: string;
  /** a name plate's own second line (the agent), kept so "to act" can come and go over it */ agentSub?: string;
  x?: number; y?: number; z?: number; visible?: boolean;
}

export const Lounge = forwardRef<LoungeHandle, LoungeProps>(function Lounge({ socket, state, onZone, onSitRequest, board }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const bodies = useRef(new Map<string, BodyHandle>());
  const scenery = useRef<pc.Entity | null>(null);
  const library = useRef<AvatarLibrary | null>(null);
  const kit = useRef<RoomKit | null>(null);
  const deck = useRef<Deck3D | null>(null);
  const chips = useRef<Chips3D | null>(null);
  const felt = useRef<pc.Entity | null>(null);
  /** the count of chips each seat has already pushed toward the pot this street, so raising THROWS the new chips */
  const pushed = useRef<Map<number, number>>(new Map());
  /** THE DEALER at each table — a body standing at the ring's gap, whose hands the cards come from. */
  const dealers = useRef(new Map<string, { avatar: ParticipantAvatar; hand: pc.Vec3; deck: pc.Entity }>());
  /** cards in the air: from the dealer's hand to their place on the felt, one after another */
  const flights = useRef<Array<{ entity: pc.Entity; from: pc.Vec3; to: pc.Vec3; yawFrom: number; yawTo: number; t: number; delay: number; tilt?: number }>>([]);
  /** which cards were already on the felt last time, so only the NEW ones are dealt (keyed by hand) */
  const dealt = useRef<{ handNo: number; ids: Set<string> }>({ handNo: -1, ids: new Set() });
  const feltSig = useRef('');
  const chipRoot = useRef<pc.Entity | null>(null);
  const chipSig = useRef('');
  const chipHand = useRef(-1);
  const chipFlights = useRef<Array<{ entity: pc.Entity; from: pc.Vec3; to: pc.Vec3; t: number; delay: number }>>([]);
  /** the camera is placed, not flown, the first time it has a body to follow */
  const camSettled = useRef(false);
  const [kitReady, setKitReady] = useState(false);
  const me = useRef<{ avatar: ParticipantAvatar; name: string; goal: pc.Vec3 | null; heading: { tableId: string; seat: number; yaw: number } | null } | null>(null);
  const onSitRef = useRef(onSitRequest); onSitRef.current = onSitRequest;
  /** where the acting player sits at your table (a head height point), for every seated body to look at */
  const actingRef = useRef<pc.Vec3 | null>(null);
  const actingPlayer = useRef<string | null>(null);
  /** a house bot's plate id by the player id its seat carries */
  const botPlate = useRef(new Map<string, string>());
  /** Every chair in the room, by table and seat, with whether somebody is in it — from the manifest. */
  const chairs = useRef<Array<{ tableId: string; seat: number; at: pc.Vec3; yaw: number; taken: boolean }>>([]);
  /** House bots in chairs — bodies for occupants no person in the room owns. */
  const bots = useRef(new Map<string, ParticipantAvatar>());
  const keys = useRef(new Set<string>());
  const [plates, setPlates] = useState<Plate[]>([]);
  const plateRef = useRef<Map<string, Plate>>(new Map());
  const manifestRef = useRef<RoomManifest | null>(null);
  const sceneryStamp = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => { onZone?.(state.zone); }, [state.zone, onZone]);

  // ── the application, once ──
  useEffect(() => {
    const c = canvas.current;
    if (!c || app.current) return;
    const a = new pc.Application(c, {
      mouse: new pc.Mouse(c),
      keyboard: new pc.Keyboard(window),
      touch: new pc.TouchDevice(c),
      graphicsDeviceOptions: { antialias: true, powerPreference: 'high-performance' },
    });
    a.setCanvasFillMode(pc.FILLMODE_NONE);
    // AT THE SCREEN'S OWN RESOLUTION. PlayCanvas renders at 1× unless told otherwise, and on a HiDPI monitor
    // that blurred every pip on the felt while the smooth bodies hid it — "the people look clear, the cards do not".
    a.graphicsDevice.maxPixelRatio = Math.min(2, window.devicePixelRatio || 1);
    a.setCanvasResolution(pc.RESOLUTION_AUTO);
    const size = () => { const r = host.current?.getBoundingClientRect(); if (r) a.resizeCanvas(Math.floor(r.width), Math.floor(r.height)); };
    size();
    const ro = new ResizeObserver(size); if (host.current) ro.observe(host.current);
    a.scene.ambientLight = new pc.Color(0.25, 0.3, 0.27);
    a.scene.fog.type = pc.FOG_LINEAR; a.scene.fog.color = new pc.Color(0.055, 0.18, 0.125); a.scene.fog.start = 20; a.scene.fog.end = 40;

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.055, 0.18, 0.125), fov: 50, nearClip: 0.1, farClip: 80 });
    camera.setPosition(0, 6, -14);
    a.root.addChild(camera);

    const sun = new pc.Entity('sun');
    // SHADOWS THAT DO NOT SPECKLE THE FELT: the table and the cards are flat receivers, and a 1024 map over 30 m
    // (~3 cm a texel, hard-filtered) put a grain of shadow acne over every flat thing while the curved bodies looked
    // fine. A 2048 map over 22 m with 5-tap PCF and a little more bias is smooth on both; the cards receive none.
    sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.96, 0.88), intensity: 1.1, castShadows: true, shadowType: pc.SHADOW_PCF5_32F, shadowBias: 0.3, normalOffsetBias: 0.08, shadowResolution: 2048, shadowDistance: 22 });
    sun.setEulerAngles(55, 30, 0);
    a.root.addChild(sun);

    let plateClock = 0;
    // walking, clicking, the follow camera — every frame
    a.keyboard!.on(pc.EVENT_KEYDOWN, (e: pc.KeyboardEvent) => { const k = keyOf(e.key ?? -1); if (k) { keys.current.add(k); if (me.current) me.current.goal = null; e.event?.preventDefault(); } });
    a.keyboard!.on(pc.EVENT_KEYUP, (e: pc.KeyboardEvent) => { const k = keyOf(e.key ?? -1); if (k) keys.current.delete(k); });
    a.mouse!.on(pc.EVENT_MOUSEDOWN, (e: pc.MouseEvent) => {
      if (!me.current || e.button !== pc.MOUSEBUTTON_LEFT) return;
      const from = camera.camera!.screenToWorld(e.x, e.y, camera.camera!.nearClip);
      const to = camera.camera!.screenToWorld(e.x, e.y, camera.camera!.farClip);
      const ray = new pc.Ray(from, to.sub(from).normalize());
      const hit = new pc.Vec3();
      if (!new pc.Plane(pc.Vec3.UP, 0).intersectsRay(ray, hit)) return;
      // A CLICK NEAR A FREE CHAIR is "sit there": walk to it and, on arrival, ask the table for the seat.
      let best: (typeof chairs.current)[number] | null = null; let bd = 0.9;
      for (const ch of chairs.current) { if (ch.taken) continue; const d = Math.hypot(ch.at.x - hit.x, ch.at.z - hit.z); if (d < bd) { bd = d; best = ch; } }
      if (best && !me.current.avatar.seated) { me.current.goal = best.at.clone(); me.current.heading = { tableId: best.tableId, seat: best.seat, yaw: best.yaw }; }
      else { me.current.goal = new pc.Vec3(hit.x, 0, hit.z); me.current.heading = null; }
    });
    a.on('update', (dt: number) => {
      const m = me.current;
      if (m && m.avatar.seated) {
        // in the chair: the body is where the seat is; the camera looks over its right shoulder, above the chair
        // back, down at the felt — the table is what a seated person looks at
        m.avatar.update(dt);
        const p = m.avatar.pos, yaw = m.avatar.yaw;
        const behind = new pc.Vec3(p.x - Math.sin(yaw) * 1.05 + Math.cos(yaw) * 0.45, 2.75, p.z - Math.cos(yaw) * 1.05 - Math.sin(yaw) * 0.45);
        // arriving already in the chair, the camera is simply there — no swoop down from the door over the felt
        if (!camSettled.current) { camera.setPosition(behind); camSettled.current = true; }
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(p.x + Math.sin(yaw) * 1.9, 0.72, p.z + Math.cos(yaw) * 1.9);
      } else if (m) {
        const av = m.avatar; const pos = av.pos;
        let dx = 0, dz = 0;
        const k = keys.current;
        if (k.has('up')) dz += 1; if (k.has('down')) dz -= 1; if (k.has('left')) dx -= 1; if (k.has('right')) dx += 1;
        let moved = false;
        if (dx || dz) {
          m.heading = null;
          const len = Math.hypot(dx, dz); dx /= len; dz /= len;
          const cp = camera.getPosition();
          const heading = Math.atan2(cp.x - pos.x, cp.z - pos.z) + Math.PI;
          const fx = Math.sin(heading) * dz + Math.cos(heading) * dx;
          const fz = Math.cos(heading) * dz - Math.sin(heading) * dx;
          pos.x += fx * WALK_SPEED * dt; pos.z += fz * WALK_SPEED * dt; av.face(Math.atan2(fx, fz)); moved = true;
        } else if (m.goal) {
          const d = new pc.Vec3().sub2(m.goal, pos); d.y = 0;
          if (d.length() < 0.1) {
            m.goal = null;
            // arrived at a chair: turn to the felt and ask for the seat, once
            if (m.heading) { av.face(m.heading.yaw); av.moved(); socket.pose(pos.x, pos.z, av.yaw); const h = m.heading; m.heading = null; onSitRef.current?.(h.tableId, h.seat); }
          } else { d.normalize(); pos.x += d.x * WALK_SPEED * dt; pos.z += d.z * WALK_SPEED * dt; av.face(Math.atan2(d.x, d.z)); moved = true; }
        }
        // The walls are at ±11; a body stops a step short, and the camera never leaves the room.
        pos.x = Math.max(-9.5, Math.min(9.5, pos.x)); pos.z = Math.max(-9.5, Math.min(9.5, pos.z));
        // FURNITURE IS SOLID: a table is a disc a little wider than its rail, the bar a box; a step that lands
        // inside is pushed back out along the nearest edge, so the body slides around rather than through. A
        // chair's seated anchor (CHAIR_R) lies just outside the disc, so walking up to sit is never blocked.
        const mf = manifestRef.current;
        if (mf) {
          for (const t of mf.tables) { const an = mf.anchors[t.anchor]; if (!an) continue; const dx = pos.x - an.x, dz = pos.z - an.y; const d = Math.hypot(dx, dz); if (d < TABLE_SOLID && d > 1e-4) { pos.x = an.x + dx / d * TABLE_SOLID; pos.z = an.y + dz / d * TABLE_SOLID; } }
          const bar = mf.anchors.bar; if (bar) { const dx = pos.x - bar.x, dz = pos.z - bar.y; if (Math.abs(dx) < 0.9 && Math.abs(dz) < 2.9) { if (0.9 - Math.abs(dx) < 2.9 - Math.abs(dz)) pos.x = bar.x + Math.sign(dx || 1) * 0.9; else pos.z = bar.y + Math.sign(dz || 1) * 2.9; } }
        }
        av.moved(); av.update(dt);
        if (moved) socket.pose(pos.x, pos.z, av.yaw);
        const behind = new pc.Vec3(Math.max(-10.5, Math.min(10.5, pos.x - Math.sin(av.yaw) * 5.5)), 4.2, Math.max(-10.5, Math.min(10.5, pos.z - Math.cos(av.yaw) * 5.5)));
        if (!camSettled.current) { camera.setPosition(behind); camSettled.current = true; }
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(pos.x, 1.2, pos.z);
      }
      if (m) m.avatar.talking(isSpeaking(m.name));
      // the others ease toward their last pose; mouths move for whoever the huddle hears
      for (const bt of bots.current.values()) bt.update(dt);
      for (const dl of dealers.current.values()) {
        dl.avatar.update(dt);
        // the deck rides in the LEFT hand; the cards leave from the RIGHT (dealing) hand
        const l = dl.avatar.bone('hand_l');
        if (l) { const hp = l.getPosition(); dl.deck.setPosition(hp.x, hp.y + 0.03, hp.z); dl.deck.setEulerAngles(0, dl.avatar.yaw * 180 / Math.PI, 0); }
        const r = dl.avatar.dealHand; if (r) dl.hand.copy(r);
      }
      for (const b of bodies.current.values()) { b.avatar.talking(isSpeaking(b.name)); b.avatar.update(dt); }
      // cards in the air: an arc from the dealer's hand to the felt, a quarter second each, one after another
      for (const f of flights.current) {
        if (f.delay > 0) { f.delay -= dt; continue; }
        f.t = Math.min(1, f.t + dt / 0.42);
        const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2; // in-out: leaves the hand, settles on the felt
        const p = new pc.Vec3().lerp(f.from, f.to, e); p.y += Math.sin(e * Math.PI) * 0.22;
        f.entity.setPosition(p);
        // a spin on the way — one turn — and the card's own yaw when it lands; a pitch that levels out
        f.entity.setEulerAngles((1 - e) * 35 + e * (f.tilt ?? 0), (f.yawFrom + (f.yawTo - f.yawFrom + 2 * Math.PI) * e) * 180 / Math.PI, 0);
      }
      flights.current = flights.current.filter((f) => f.t < 1);
      for (const f of chipFlights.current) { f.t = Math.min(1, f.t + dt / 0.3); const e = 1 - (1 - f.t) * (1 - f.t); const p = new pc.Vec3().lerp(f.from, f.to, e); p.y += Math.sin(e * Math.PI) * 0.12; f.entity.setLocalPosition(p); }
      chipFlights.current = chipFlights.current.filter((f) => f.t < 1);
      // the plates follow their bodies on screen — at 25 Hz, which is what text over a body needs
      plateClock += dt;
      if (plateClock >= 0.04) {
        plateClock = 0;
        const cam = camera.camera!;
        const out = new pc.Vec3();
        const next: Plate[] = [];
        for (const pl of plateRef.current.values()) {
          cam.worldToScreen(pl.world, out);
          // z is camera-space depth in world units; behind the camera is negative.
          next.push({ ...pl, x: out.x, y: out.y, z: out.z, visible: out.z > 0 });
        }
        setPlates(next);
      }
    });
    library.current = new AvatarLibrary(a, ROOM_DIR); library.current.load();
    kit.current = new RoomKit(a, KIT_URL); kit.current.ready(() => setKitReady(true));
    deck.current = new Deck3D(a);
    chips.current = new Chips3D(a);
    deckSide.diffuse = new pc.Color(0.92, 0.9, 0.85); deckSide.update();
    // the walk scripts read the bodies' states through this; nothing in the app does
    (window as unknown as { __lounge?: unknown }).__lounge = { me, bodies, bots, library, kit, scenery, felt, dealers, flights, chipRoot };
    // GAZE, after the clips have posed the bodies: a seated body looks at whoever is acting at its table (or the
    // felt); a standing body looks at the nearest person within a few steps, the one talking first; yours looks
    // where the others do. Cheap — a dozen bodies, a dozen distances.
    a.on('postupdate', (dt: number) => {
      const all: Array<{ avatar: ParticipantAvatar; name: string }> = [];
      if (me.current) all.push(me.current);
      for (const b of bodies.current.values()) all.push(b);
      for (const bt of bots.current.values()) all.push({ avatar: bt, name: '' });
      for (const dl of dealers.current.values()) { dl.avatar.applyGaze(dt); dl.avatar.applyDeal(dt); }
      const acting = actingRef.current;
      for (const b of all) {
        const av = b.avatar;
        if (av.seated) { av.lookHead(acting && acting.distance(av.pos) > 0.5 ? acting : (av.seatCentre ?? null)); }
        else {
          let best: ParticipantAvatar | null = null; let bd = 3.5; let bestTalks = false;
          for (const o of all) { if (o === b) continue; const d = o.avatar.pos.distance(av.pos); const talks = o.name ? isSpeaking(o.name) : false; if (d < bd && (talks || !bestTalks)) { bd = d; best = o.avatar; bestTalks = talks; } }
          av.lookHead(best ? new pc.Vec3(best.pos.x, best.seated ? 1.1 : 1.55, best.pos.z) : null);
        }
        av.applyGaze(dt);
      }
    });
    a.start();
    app.current = a;
    return () => { ro.disconnect(); a.destroy(); app.current = null; library.current = null; kit.current = null; deck.current = null; felt.current = null; bodies.current.clear(); bots.current.clear(); dealers.current.clear(); flights.current = []; chipFlights.current = []; chipRoot.current = null; me.current = null; scenery.current = null; plateRef.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── the scenery, from the manifest ──
  useEffect(() => {
    const a = app.current; const manifest = state.manifest; const k = kit.current;
    if (!a || !manifest) return;
    const stamp = `${kitReady ? 'kit' : 'bare'}`;
    if (manifestRef.current === manifest && sceneryStamp.current === stamp) return;
    manifestRef.current = manifest; sceneryStamp.current = stamp;
    const furnished = kitReady && !!k?.loaded;
    scenery.current?.destroy();
    for (const [id, pl] of [...plateRef.current]) if (pl.kind === 'table' || pl.kind === 'anchor') plateRef.current.delete(id);
    const root = new pc.Entity('scenery'); a.root.addChild(root); scenery.current = root;
    const mat = (r: number, g: number, b: number, extra: Partial<pc.StandardMaterial> = {}) => { const m = new pc.StandardMaterial(); m.diffuse = new pc.Color(r, g, b); Object.assign(m, extra); m.update(); return m; };
    const felt = mat(0.12, 0.42, 0.29), feltHi = mat(0.16, 0.49, 0.35), wall = mat(0.08, 0.25, 0.17), wood = mat(0.23, 0.16, 0.10), brass = mat(0.85, 0.70, 0.42, { metalness: 0.6, gloss: 0.7, useMetalness: true }), chairFree = mat(0.36, 0.29, 0.53), chairTaken = mat(0.54, 0.25, 0.20), shade = mat(0.11, 0.14, 0.13), rail = mat(0.24, 0.13, 0.09, { gloss: 0.5 });
    const prim = (type: string, material: pc.StandardMaterial, pos: [number, number, number], scale: [number, number, number], rotY = 0) => {
      const e = new pc.Entity(type); e.addComponent('render', { type, material, castShadows: type !== 'plane', receiveShadows: true }); e.setLocalPosition(...pos); e.setLocalScale(...scale); e.setLocalEulerAngles(0, rotY, 0); root.addChild(e); return e;
    };
    prim('plane', felt, [0, 0, 0], [22, 1, 22]);
    prim('box', wall, [0, 2, 11], [22, 4, 0.3]); prim('box', wall, [0, 2, -11], [22, 4, 0.3]); prim('box', wall, [11, 2, 0], [0.3, 4, 22]); prim('box', wall, [-11, 2, 0], [0.3, 4, 22]);
    const a2 = manifest.anchors;
    for (const t of manifest.tables) {
      const p = a2[t.anchor]!;
      const g = new pc.Entity(`table:${t.tableId}`); g.setLocalPosition(p.x, 0, p.y); root.addChild(g);
      const add = (type: string, material: pc.StandardMaterial, pos: [number, number, number], scale: [number, number, number], rotY = 0) => { const e = new pc.Entity(type); e.addComponent('render', { type, material, castShadows: true, receiveShadows: true }); e.setLocalPosition(...pos); e.setLocalScale(...scale); e.setLocalEulerAngles(0, rotY, 0); g.addChild(e); };
      // A POKER TABLE: a thin felt at 0.76 m inside a padded leather rail, on a pedestal — not a drum
      add('cylinder', feltHi, [0, 0.77, 0], [2.84, 0.02, 2.84]);
      add('cylinder', rail, [0, 0.745, 0], [3.1, 0.03, 3.1]);
      add('cylinder', wood, [0, 0.715, 0], [3.16, 0.03, 3.16]);
      add('cylinder', wood, [0, 0.4, 0], [0.5, 0.66, 0.5]);
      add('cylinder', wood, [0, 0.03, 0], [1.6, 0.06, 1.6]);
      // A CHAIR is the kit's, a little outside where the body's feet go (CHAIR_R), turned to the felt; a seat pad
      // and a back stand in until the kit has loaded.
      for (let i = 0; i < t.seats; i++) {
        const ang = (i / t.seats) * Math.PI * 2; const c = i < t.seated ? chairTaken : chairFree; const r = CHAIR_R + CHAIR_BACK;
        if (furnished && k!.place(CHAIR_PIECE, g, Math.sin(ang) * r, Math.cos(ang) * r, ang * 180 / Math.PI, CHAIR_SCALE)) continue;
        add('box', c, [Math.sin(ang) * r, 0.42, Math.cos(ang) * r], [0.5, 0.08, 0.5], ang * 180 / Math.PI);
        add('box', c, [Math.sin(ang) * (r + 0.22), 0.7, Math.cos(ang) * (r + 0.22)], [0.5, 0.6, 0.06], ang * 180 / Math.PI);
      }
      add('cone', shade, [0, 3.4, 0], [1.2, 0.5, 1.2]);
      const lamp = new pc.Entity('lamp'); lamp.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.94, 0.8), intensity: 2.2, range: 10, castShadows: false }); lamp.setLocalPosition(0, 3.1, 0); g.addChild(lamp);
      plateRef.current.set(`table:${t.tableId}`, { id: `table:${t.tableId}`, kind: 'table', text: t.name, sub: `${t.seated}/${t.seats} seated`, world: new pc.Vec3(p.x, 1.9, p.y) });
    }
    if (a2.bar) {
      // THE BAR: the kit's counter in four lengths with its two ends, stools along the room side, a lamp behind
      const bx = a2.bar.x, bz = a2.bar.y; const yaw = a2.bar.yaw * 180 / Math.PI;
      if (furnished) {
        for (let i = -2; i < 2; i++) k!.place('kitchenBar', root, bx, bz + i * 1.08 + 0.54, yaw + 90);
        k!.place('kitchenBarEnd', root, bx, bz - 2.16 - 0.125, yaw + 90); k!.place('kitchenBarEnd', root, bx, bz + 2.16 + 0.125, yaw + 90);
        for (let i = -1; i <= 1; i++) k!.place('stoolBar', root, bx + 0.9, bz + i * 1.2, yaw + 90);
        k!.place('lampRoundFloor', root, bx - 0.9, bz - 2.9, 0); k!.place('lampRoundFloor', root, bx - 0.9, bz + 2.9, 0);
      } else { prim('box', wood, [bx, 0.55, bz], [1, 1.1, 5]); prim('box', brass, [bx, 1.12, bz], [1.2, 0.06, 5.2]); }
      plateRef.current.set('anchor:bar', { id: 'anchor:bar', kind: 'anchor', text: 'The bar', world: new pc.Vec3(bx, 1.8, bz) });
    }
    if (a2.fire) {
      prim('box', mat(0.36, 0.29, 0.23), [a2.fire.x, 0.8, a2.fire.y], [0.6, 1.6, 2.2]);
      if (furnished) {
        // a rug, a sofa facing the hearth and a chair each side
        k!.place('rugRound', root, a2.fire.x - 2.2, a2.fire.y, 0);
        k!.place('loungeSofa', root, a2.fire.x - 3.4, a2.fire.y, 90);
        k!.place('loungeChair', root, a2.fire.x - 2.0, a2.fire.y - 1.9, 0); k!.place('loungeChair', root, a2.fire.x - 2.0, a2.fire.y + 1.9, 180);
        k!.place('pottedPlant', root, a2.fire.x - 0.6, a2.fire.y + 2.2, 0);
      }
      const fire = new pc.Entity('fire'); fire.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.6, 0.24), intensity: 1.6, range: 7 }); fire.setLocalPosition(a2.fire.x - 0.6, 0.5, a2.fire.y); root.addChild(fire);
      plateRef.current.set('anchor:fire', { id: 'anchor:fire', kind: 'anchor', text: 'The fire', world: new pc.Vec3(a2.fire.x, 1.9, a2.fire.y) });
    }
    if (furnished) {
      // the room's dressing: a doorway where you come in, bookcases and plants along the walls, lamps in the corners
      if (a2.door) k!.place('doorway', root, a2.door.x, -10.85, 0);
      k!.place('bookcaseOpen', root, -4, -10.6, 0); k!.place('bookcaseOpen', root, 4, -10.6, 0);
      k!.place('bookcaseOpen', root, -10.6, -6, 90); k!.place('bookcaseOpen', root, 10.6, -7, -90);
      for (const [x, z] of [[-10.3, 10.3], [10.3, 10.3], [-10.3, -10.3], [10.3, -10.3]] as const) k!.place('pottedPlant', root, x, z, 0);
      k!.place('lampRoundFloor', root, -10.3, 0, 0); k!.place('lampRoundFloor', root, 10.3, 1, 0);
    }
    if (a2.lectern) { prim('box', wood, [a2.lectern.x, 0.6, a2.lectern.y], [0.5, 1.2, 0.5]); plateRef.current.set('anchor:lectern', { id: 'anchor:lectern', kind: 'anchor', text: "♦ The guest's lectern", world: new pc.Vec3(a2.lectern.x, 1.7, a2.lectern.y) }); }
  }, [state.manifest, kitReady]);

  // ── the people, from presence ──
  useEffect(() => {
    const a = app.current; const manifest = state.manifest; const lib = library.current; if (!a || !state.you || !manifest || !lib) return;
    // WHERE A CHAIR IS: the table's anchor plus the seat's place around it, facing the felt. The seated anchor
    // is where the body's feet go; the sit clip puts the hips on the chair behind them.
    const chairOf = (tableId: string, seat: number): Seat | null => {
      const t = manifest.tables.find((x) => x.tableId === tableId); const an = t ? manifest.anchors[t.anchor] : undefined;
      if (!t || !an) return null;
      const ang = (seat / t.seats) * Math.PI * 2; // seats are 0-based, as the flat board's ring draws them
      return { at: new pc.Vec3(an.x + Math.sin(ang) * CHAIR_R, 0, an.y + Math.cos(ang) * CHAIR_R), yaw: ang + Math.PI, centre: new pc.Vec3(an.x, 0, an.y) };
    };
    const seen = new Set<string>();
    for (const p of state.people.values()) {
      seen.add(p.playerId);
      const chair = p.seatedAt ? chairOf(p.seatedAt.tableId, p.seatedAt.seat) : null;
      const isMe = p.playerId === state.you;
      if (isMe) {
        if (!me.current) {
          const av = new ParticipantAvatar(lib, p.body, 'direct'); av.place(p.x, p.y, p.yaw); a.root.addChild(av.entity);
          me.current = { avatar: av, name: p.name, goal: null, heading: null };
        }
        if (chair) me.current.avatar.sitAt(chair); else me.current.avatar.stand();
        // your own name hangs over your body while you walk; seated, the camera is over your shoulder and the plate
        // would sit on the felt — you know who you are, and the HUD is yours
        if (chair) plateRef.current.delete(`name:${p.playerId}`);
        else plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: `${p.name} · you`, face: p.name, world: me.current.avatar.pos.clone().add(new pc.Vec3(0, 2.05, 0)), you: true });
        continue;
      }
      let b = bodies.current.get(p.playerId);
      if (!b) { const av = new ParticipantAvatar(lib, p.body, 'follow'); av.place(p.x, p.y, p.yaw); a.root.addChild(av.entity); b = { avatar: av, name: p.name }; bodies.current.set(p.playerId, b); }
      if (chair) b.avatar.sitAt(chair); else { b.avatar.stand(); b.avatar.walkTo(p.x, p.y, p.yaw); }
      const head = (chair ? chair.at : new pc.Vec3(p.x, 0, p.y)).add(new pc.Vec3(0, chair ? 1.55 : 2.05, 0));
      // The agent under the name only when it IS a name — an address says nothing to anyone.
      const agentSub = p.agent && p.agent.includes('.') ? p.agent : undefined;
      plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: p.name, face: p.name, agentSub, sub: actingPlayer.current === p.playerId ? 'to act' : agentSub, world: head });
      const said = p.said && Date.now() - p.said.at < 8000 ? p.said.text : null;
      if (said) plateRef.current.set(`bubble:${p.playerId}`, { id: `bubble:${p.playerId}`, kind: 'bubble', text: said, world: head.clone().add(new pc.Vec3(0, 0.5, 0)) }); else plateRef.current.delete(`bubble:${p.playerId}`);
    }
    for (const [id, b] of [...bodies.current]) if (!seen.has(id)) { b.avatar.destroy(); bodies.current.delete(id); plateRef.current.delete(`name:${id}`); plateRef.current.delete(`bubble:${id}`); }
    // THE HOUSE'S BOTS AND ABSENT PLAYERS: an occupant no body in the room owns is drawn seated in its chair
    // as a quieter figure — a persona's body is decoration for a seat, not presence (spec §3.5).
    chairs.current = manifest.tables.flatMap((t) => Array.from({ length: t.seats }, (_, i) => { const c = chairOf(t.tableId, i)!; return { tableId: t.tableId, seat: i, at: c.at, yaw: c.yaw, taken: (t.occupants ?? []).some((o) => o.seat === i) }; }));
    const seenBots = new Set<string>();
    for (const t of manifest.tables) for (const o of t.occupants ?? []) {
      if (state.people.has(o.playerId)) continue;
      const key = `${t.tableId}:${o.seat}`; seenBots.add(key);
      const chair = chairOf(t.tableId, o.seat); if (!chair) continue;
      let bt = bots.current.get(key);
      if (!bt) { bt = new ParticipantAvatar(lib, o.kind === 'agent' ? 'slate' : 'ink', 'follow'); bt.place(chair.at.x, chair.at.z, chair.yaw); bt.sitAt(chair); a.root.addChild(bt.entity); bots.current.set(key, bt); }
      botPlate.current.set(o.playerId, `bot:${key}`);
      plateRef.current.set(`bot:${key}`, { id: `bot:${key}`, kind: 'name', text: o.name ?? (o.kind === 'agent' ? 'house bot' : 'seated'), sub: actingPlayer.current === o.playerId ? 'to act' : undefined, world: chair.at.clone().add(new pc.Vec3(0, 1.55, 0)) });
    }
    for (const [key, bt] of [...bots.current]) if (!seenBots.has(key)) { bt.destroy(); bots.current.delete(key); plateRef.current.delete(`bot:${key}`); }
    // THE DEALER: a body at every table that has anybody at it, standing at the gap between the last seat and the
    // first, facing the felt. A social figure — the deal is the table's, the dealer only shows it happening.
    const seenDealers = new Set<string>();
    for (const t of manifest.tables) {
      if (!t.seated) continue;
      seenDealers.add(t.tableId);
      if (dealers.current.has(t.tableId)) continue;
      const an = manifest.anchors[t.anchor]; if (!an) continue;
      const ang = ((t.seats - 0.5) / t.seats) * Math.PI * 2; const r = CHAIR_R;
      const at = new pc.Vec3(an.x + Math.sin(ang) * r, 0, an.y + Math.cos(ang) * r); const yaw = ang + Math.PI;
      const av = new ParticipantAvatar(lib, 'ink', 'follow'); av.place(at.x, at.z, yaw); a.root.addChild(av.entity);
      // seated, like every dealer — on a stool of their own at the gap
      av.sitAt({ at, yaw, centre: new pc.Vec3(an.x, 0, an.y) });
      if (kit.current?.loaded && scenery.current) kit.current.place('stoolBar', scenery.current, an.x + Math.sin(ang) * (r + CHAIR_BACK), an.y + Math.cos(ang) * (r + CHAIR_BACK), ang * 180 / Math.PI, 0.8);
      av.lookHead(new pc.Vec3(an.x, 0.9, an.y));
      // THE DECK in the dealer's left hand: a stack of cards (the back on top) that follows the hand bone each frame
      const deck3 = new pc.Entity('deck');
      const stack = new pc.Entity('stack'); stack.addComponent('render', { type: 'box', material: deckSide, castShadows: true }); stack.setLocalScale(0.063 * 1.4, 0.022, 0.088 * 1.4); deck3.addChild(stack);
      const top = deck.current!.card(null, 0, 0.0115, 0, 0, deck3); top.setLocalScale(0.063 * 1.4, 1, 0.088 * 1.4);
      a.root.addChild(deck3);
      dealers.current.set(t.tableId, { avatar: av, hand: new pc.Vec3(at.x + Math.sin(yaw) * 0.45, 0.98, at.z + Math.cos(yaw) * 0.45), deck: deck3 });
      plateRef.current.set(`dealer:${t.tableId}`, { id: `dealer:${t.tableId}`, kind: 'name', text: 'the dealer', world: at.clone().add(new pc.Vec3(0, 2.05, 0)) });
    }
    for (const [id, dl] of [...dealers.current]) if (!seenDealers.has(id)) { dl.avatar.destroy(); dl.deck.destroy(); dealers.current.delete(id); plateRef.current.delete(`dealer:${id}`); }
  }, [state.people, state.you, state.manifest]);

  // ── CHIPS: each seat's street bet pushed toward the pot, and the pot pile — rebuilt when any bet changes ──
  useEffect(() => {
    const a = app.current; const ch = chips.current;
    const manifest = state.manifest; const you = state.you ? state.people.get(state.you) : undefined;
    const t = board && manifest ? manifest.tables.find((x) => x.tableId === board.tableId) : undefined; const an = t ? manifest!.anchors[t.anchor] : undefined;
    if (!a || !ch || !board || !manifest || !you?.seatedAt || you.seatedAt.tableId !== board.tableId || !t || !an) { chipRoot.current?.destroy(); chipRoot.current = null; return; }
    const v = board.view; const cx = an.x, cz = an.y;
    const sig = JSON.stringify([v.hand?.handNo ?? -1, v.seats.map((s2) => [s2.seat, s2.stack, s2.inHand?.streetBet ?? 0]), v.hand?.pots.map((p) => p.amount) ?? []]);
    if (sig === chipSig.current && chipRoot.current) return;
    const fresh = new pc.Entity('chips-root'); a.root.addChild(fresh);
    const H = 0.79;
    // each seat's own stack sits just in front of its cards; its street bet is pushed a third of the way to the middle
    for (const seat of v.seats) {
      const ang = (seat.seat / t.seats) * Math.PI * 2; const sx = Math.sin(ang), sz = Math.cos(ang);
      { const px = Math.cos(ang), pz = -Math.sin(ang); if (seat.stack > 0) ch.pile(seat.stack, cx + sx * 1.18 + px * 0.42, H, cz + sz * 1.18 + pz * 0.42, fresh, 0.08); }
      const bet = seat.inHand?.streetBet ?? 0;
      if (bet > 0) {
        const px = Math.cos(ang), pz = -Math.sin(ang); const bx = cx + sx * 0.78 + px * 0.42, bz = cz + sz * 0.78 + pz * 0.42;
        const { entity, top } = ch.pile(bet, bx, H, bz, fresh);
        // NEW chips this street fly in from where the seat sits — "throwing out chips"
        const was = pushed.current.get(seat.seat) ?? 0;
        if (bet > was) { const from = new pc.Vec3(cx + sx * 1.18 + px * 0.42, H + 0.06, cz + sz * 1.18 + pz * 0.42); chipFlights.current.push({ entity, from, to: entity.getLocalPosition().clone(), t: 0, delay: 0 }); entity.setLocalPosition(from); }
        pushed.current.set(seat.seat, bet);
        void top;
      } else pushed.current.set(seat.seat, 0);
    }
    const pot = (v.hand?.pots.reduce((s2, p) => s2 + p.amount, 0) ?? 0);
    { const yourAng = (you.seatedAt.seat / t.seats) * Math.PI * 2; const rx = Math.cos(yourAng), rz = -Math.sin(yourAng); if (pot > 0) ch.pile(pot, cx + rx * 1.05, H, cz + rz * 1.05, fresh, 0.08); }
    // a new hand clears what was pushed
    if (chipHand.current !== (v.hand?.handNo ?? -1)) { pushed.current.clear(); chipHand.current = v.hand?.handNo ?? -1; }
    chipRoot.current?.destroy(); chipRoot.current = fresh; chipSig.current = sig;
  }, [board, state.manifest, state.people, state.you]);

  // ── THE FELT: the seated table's cards, pot and turn, laid on its table from the view ──
  // The community cards run across the centre, turned to your chair; each seat's two cards lie on the felt in
  // front of it, turned to that seat, face down unless the view shows them (yours; a showdown). Cards are
  // GEOMETRY (cards3d.ts) — planes on the felt with a face from the deck's atlas — so they lie the way cards
  // lie from every chair; the pot and whose turn are HTML plates, because they are words.
  useEffect(() => {
    const a = app.current; const d = deck.current;
    const manifest = state.manifest; const you = state.you ? state.people.get(state.you) : undefined;
    const t = board && manifest ? manifest.tables.find((x) => x.tableId === board.tableId) : undefined; const an = t ? manifest!.anchors[t.anchor] : undefined;
    if (!a || !d || !board || !manifest || !you?.seatedAt || you.seatedAt.tableId !== board.tableId || !t || !an) {
      felt.current?.destroy(); felt.current = null; actingRef.current = null; flights.current = []; feltSig.current = '';
      return;
    }
    const v = board.view; const cx = an.x, cz = an.y; const yourAng = (you.seatedAt.seat / t.seats) * Math.PI * 2;
    // whose turn changes every message; the CARDS change a few times a hand — the felt is rebuilt only for those,
    // so a flight in progress is not cut short by a chat line or a clock tick
    actingRef.current = v.hand?.toAct != null ? (() => { const ang = (v.hand!.toAct! / t.seats) * Math.PI * 2; return new pc.Vec3(cx + Math.sin(ang) * CHAIR_R, 1.15, cz + Math.cos(ang) * CHAIR_R); })() : null;
    actingPlayer.current = v.hand?.toAct != null ? v.seats.find((s2) => s2.seat === v.hand!.toAct)?.playerId ?? null : null;
    for (const pl of plateRef.current.values()) if (pl.kind === 'name') pl.sub = pl.id === `name:${actingPlayer.current}` || pl.id.startsWith('bot:') && pl.id === botPlate.current.get(actingPlayer.current ?? '') ? 'to act' : pl.agentSub;
    const sig = JSON.stringify([v.hand?.handNo ?? -1, v.hand?.board ?? [], v.seats.map((s2) => [s2.seat, s2.inHand?.folded ?? null, s2.inHand?.holeCards ?? null]), you.seatedAt.seat]);
    if (sig === feltSig.current && felt.current) return;
    feltSig.current = sig;
    felt.current?.destroy(); felt.current = null; flights.current = [];
    const root = new pc.Entity('felt'); a.root.addChild(root); felt.current = root;
    // the row runs across your line of sight: perpendicular to the ray from the centre to your chair
    const rx = Math.cos(yourAng), rz = -Math.sin(yourAng);
    const H = 0.785; // the felt's top is 0.78
    // A NEW HAND deals everything again; within a hand only the cards that were not there yet are dealt.
    const handNo = v.hand?.handNo ?? -1;
    if (dealt.current.handNo !== handNo) dealt.current = { handNo, ids: new Set() };
    const dealer = dealers.current.get(board.tableId);
    let n = 0;
    // the community row is propped toward YOUR chair — this is your own felt; each seat sees its own
    const tiltToward = (e: pc.Entity, ang: number) => { e.setLocalEulerAngles(-22, (ang + Math.PI) * 180 / Math.PI, 0); };
    const lay = (id: string, code: string | null, x: number, z: number, yaw: number, lift: number): pc.Entity => {
      const e = d.card(code, x, H, z, yaw, root, lift);
      if (dealer && !dealt.current.ids.has(id)) {
        // it starts in the dealer's hand and arrives in order; the dealer reaches for the deck once per round of dealing
        const to = e.getPosition().clone(); e.setPosition(dealer.hand);
        const delay = n * 0.16;
        flights.current.push({ entity: e, from: dealer.hand.clone(), to, yawFrom: dealer.avatar.yaw, yawTo: yaw, t: 0, delay, tilt: id.startsWith('board:') ? -22 : 0 });
        // the dealing arm flicks as each card leaves — scheduled to match this card's delay
        window.setTimeout(() => dealer.avatar.dealFlick(), delay * 1000);
        n++;
      }
      dealt.current.ids.add(id);
      return e;
    };
    if (v.hand) {
      v.hand.board.forEach((c, i) => { const o = (i - 2) * 0.36; const e = lay(`board:${i}`, c, cx + rx * o, cz + rz * o, yourAng + Math.PI, 0.03 + i * 0.0005); e.setLocalScale(0.063 * 5.2, 1, 0.088 * 5.2); tiltToward(e, yourAng); });
    }
    for (const seat of v.seats) {
      if (!seat.inHand || seat.inHand.folded) continue;
      const ang = (seat.seat / t.seats) * Math.PI * 2; const sx = Math.sin(ang), sz = Math.cos(ang);
      const px = Math.cos(ang), pz = -Math.sin(ang); // across that seat's own line
      const cards = seat.inHand.holeCards ?? [null, null];
      cards.forEach((c, i) => { const o = (i - 0.5) * 0.19; lay(`hole:${seat.seat}:${i}`, c, cx + sx * 1.3 + px * o, cz + sz * 1.3 + pz * o, ang + Math.PI, i * 0.0005); });
    }
  }, [board, state.manifest, state.people, state.you]);

  // your own plate follows your own body (which moves locally, ahead of the server)
  useEffect(() => {
    const t = setInterval(() => { const m = me.current; const pl = state.you ? plateRef.current.get(`name:${state.you}`) : null; if (m && pl) pl.world = m.avatar.pos.clone().add(new pc.Vec3(0, m.avatar.seated ? 1.55 : 2.05, 0)); }, 50);
    return () => clearInterval(t);
  }, [state.you]);

  useImperativeHandle(ref, () => ({
    walkToSeat: (tableId, seat) => {
      const m = me.current; const ch = chairs.current.find((c) => c.tableId === tableId && c.seat === seat);
      if (!m || !ch || ch.taken || m.avatar.seated) return false;
      m.goal = ch.at.clone(); m.heading = { tableId, seat, yaw: ch.yaw };
      return true;
    },
  }), []);

  return (
    <div className="lounge" ref={host}>
      <canvas ref={canvas} />
      <div className="lounge-overlay" aria-hidden="true">
        {plates.filter((p) => p.visible).map((p) => (
          <div key={p.id} className={`lounge-plate lounge-plate-${p.kind}${p.you ? ' lounge-plate-you' : ''}`} style={{ left: p.x, top: p.y }}>
            {p.face ? <Portrait name={p.face} size="plate" /> : null}
            <span>{p.text}</span>{p.sub ? <small>{p.sub}</small> : null}
          </div>
        ))}
      </div>
      {!state.manifest ? <div className="lounge-loading-inline"><p className="hint">Walking in…</p></div> : null}
      <div className="lounge-help hint">Walk with W A S D or the arrow keys, or click the floor. Click a free chair to sit down.</div>
    </div>
  );
});

function keyOf(key: number): 'up' | 'down' | 'left' | 'right' | null {
  if (key === pc.KEY_W || key === pc.KEY_UP) return 'up';
  if (key === pc.KEY_S || key === pc.KEY_DOWN) return 'down';
  if (key === pc.KEY_A || key === pc.KEY_LEFT) return 'left';
  if (key === pc.KEY_D || key === pc.KEY_RIGHT) return 'right';
  return null;
}

export type { RoomPerson };
