import { useEffect, useRef, useState } from 'react';
import * as pc from 'playcanvas';
import type { RoomManifest, RoomPerson } from '@pokernight/protocol';
import type { RoomSocket, RoomState } from '../../lib/roomSocket';

/**
 * THE LOUNGE — the scene, on PlayCanvas (docs/SPATIAL-ROOM.md §3.1, phase 1 steps 1–2; PlayCanvas chosen
 * 2026-09-14 for its editor and asset pipeline — a lounge and its bodies will be authored there and loaded as
 * scenes, and this file is the runtime that stands the room up from the manifest).
 *
 * Built-in scenery for now: a felt-green floor, walls, tables under lamps on the manifest's anchors, the bar,
 * the fire, the guest's lectern. Bodies are capsules in a palette; name plates and speech bubbles are HTML
 * laid over the canvas at each body's projected screen position, so they are real text. Your body walks with
 * WASD / arrows or a click on the floor; the camera follows from behind and above; others ease toward their
 * last pose. The scene draws PRESENCE and nothing else — who is in which chair is the table's to say.
 */

const BODY_COLOURS: Record<string, [number, number, number]> = {
  oak: [0.66, 0.49, 0.18], slate: [0.31, 0.36, 0.41], brass: [0.85, 0.70, 0.42], rose: [0.65, 0.22, 0.18], moss: [0.18, 0.44, 0.32], ink: [0.11, 0.14, 0.13],
};
const WALK_SPEED = 3.2; // m/s

export interface LoungeProps {
  socket: RoomSocket;
  state: RoomState;
  onZone?: (zone: string | null) => void;
}

interface BodyHandle { figure: Figure; entity: pc.Entity; target: pc.Vec3; yaw: number; last: pc.Vec3; speed: number; seated: boolean }
interface Plate { id: string; kind: 'name' | 'table' | 'anchor' | 'bubble'; text: string; sub?: string; world: pc.Vec3; you?: boolean; x?: number; y?: number; visible?: boolean }

export function Lounge({ socket, state, onZone }: LoungeProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const bodies = useRef(new Map<string, BodyHandle>());
  const scenery = useRef<pc.Entity | null>(null);
  const me = useRef<{ figure: Figure; entity: pc.Entity; pos: pc.Vec3; yaw: number; goal: pc.Vec3 | null; seated: { at: pc.Vec3; yaw: number } | null } | null>(null);
  /** House bots in chairs — figures for occupants no person in the room owns. */
  const bots = useRef(new Map<string, { figure: Figure; entity: pc.Entity }>());
  const keys = useRef(new Set<string>());
  const [plates, setPlates] = useState<Plate[]>([]);
  const plateRef = useRef<Map<string, Plate>>(new Map());
  const manifestRef = useRef<RoomManifest | null>(null);
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
    sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.96, 0.88), intensity: 1.1, castShadows: true, shadowBias: 0.2, normalOffsetBias: 0.05, shadowResolution: 1024, shadowDistance: 30 });
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
      if (new pc.Plane(pc.Vec3.UP, 0).intersectsRay(ray, hit)) me.current.goal = new pc.Vec3(hit.x, 0, hit.z);
    });
    a.on('update', (dt: number) => {
      const m = me.current;
      if (m && m.seated) {
        m.pos.copy(m.seated.at); m.yaw = m.seated.yaw;
        m.figure.animate(dt, 0, true);
        m.entity.setPosition(m.pos); m.entity.setEulerAngles(0, m.yaw * 180 / Math.PI, 0);
        const behind = new pc.Vec3(m.pos.x - Math.sin(m.yaw) * 3.2, 2.6, m.pos.z - Math.cos(m.yaw) * 3.2);
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(m.pos.x + Math.sin(m.yaw) * 2, 0.9, m.pos.z + Math.cos(m.yaw) * 2);
      } else if (m) {
        let dx = 0, dz = 0;
        const k = keys.current;
        if (k.has('up')) dz += 1; if (k.has('down')) dz -= 1; if (k.has('left')) dx -= 1; if (k.has('right')) dx += 1;
        let moved = false;
        if (dx || dz) {
          const len = Math.hypot(dx, dz); dx /= len; dz /= len;
          const cp = camera.getPosition();
          const heading = Math.atan2(cp.x - m.pos.x, cp.z - m.pos.z) + Math.PI;
          const fx = Math.sin(heading) * dz + Math.cos(heading) * dx;
          const fz = Math.cos(heading) * dz - Math.sin(heading) * dx;
          m.pos.x += fx * WALK_SPEED * dt; m.pos.z += fz * WALK_SPEED * dt; m.yaw = Math.atan2(fx, fz); moved = true;
        } else if (m.goal) {
          const d = new pc.Vec3().sub2(m.goal, m.pos); d.y = 0;
          if (d.length() < 0.1) m.goal = null; else { d.normalize(); m.pos.x += d.x * WALK_SPEED * dt; m.pos.z += d.z * WALK_SPEED * dt; m.yaw = Math.atan2(d.x, d.z); moved = true; }
        }
        // The walls are at ±11; a body stops a step short, and the camera never leaves the room.
        m.pos.x = Math.max(-9.5, Math.min(9.5, m.pos.x)); m.pos.z = Math.max(-9.5, Math.min(9.5, m.pos.z));
        m.figure.animate(dt, moved ? WALK_SPEED : 0);
        m.entity.setPosition(m.pos);
        const cur = m.entity.getEulerAngles().y * Math.PI / 180;
        m.entity.setEulerAngles(0, (cur + (m.yaw - cur) * Math.min(1, dt * 10)) * 180 / Math.PI, 0);
        if (moved) socket.pose(m.pos.x, m.pos.z, m.yaw);
        const behind = new pc.Vec3(Math.max(-10.5, Math.min(10.5, m.pos.x - Math.sin(m.yaw) * 5.5)), 4.2, Math.max(-10.5, Math.min(10.5, m.pos.z - Math.cos(m.yaw) * 5.5)));
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(m.pos.x, 1.2, m.pos.z);
      }
      // the others ease toward their last pose
      for (const bt of bots.current.values()) bt.figure.animate(dt, 0, true);
      for (const b of bodies.current.values()) {
        const p = b.entity.getPosition();
        const before = b.last.copy(p);
        b.entity.setPosition(p.lerp(p, b.target, Math.min(1, dt * 8)));
        const stepped = b.entity.getPosition().distance(before) / Math.max(dt, 1e-3);
        b.speed += (stepped - b.speed) * Math.min(1, dt * 10);
        b.figure.animate(dt, b.seated ? 0 : b.speed, b.seated);
        const cur = b.entity.getEulerAngles().y * Math.PI / 180;
        b.entity.setEulerAngles(0, (cur + (b.yaw - cur) * Math.min(1, dt * 8)) * 180 / Math.PI, 0);
      }
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
          next.push({ ...pl, x: out.x, y: out.y, visible: out.z > 0 });
        }
        setPlates(next);
      }
    });
    a.start();
    app.current = a;
    return () => { ro.disconnect(); a.destroy(); app.current = null; bodies.current.clear(); me.current = null; scenery.current = null; plateRef.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── the scenery, from the manifest ──
  useEffect(() => {
    const a = app.current; const manifest = state.manifest;
    if (!a || !manifest || manifestRef.current === manifest) return;
    manifestRef.current = manifest;
    scenery.current?.destroy();
    for (const [id, pl] of [...plateRef.current]) if (pl.kind === 'table' || pl.kind === 'anchor') plateRef.current.delete(id);
    const root = new pc.Entity('scenery'); a.root.addChild(root); scenery.current = root;
    const mat = (r: number, g: number, b: number, extra: Partial<pc.StandardMaterial> = {}) => { const m = new pc.StandardMaterial(); m.diffuse = new pc.Color(r, g, b); Object.assign(m, extra); m.update(); return m; };
    const felt = mat(0.12, 0.42, 0.29), feltHi = mat(0.16, 0.49, 0.35), wall = mat(0.08, 0.25, 0.17), wood = mat(0.23, 0.16, 0.10), brass = mat(0.85, 0.70, 0.42, { metalness: 0.6, gloss: 0.7, useMetalness: true }), chairFree = mat(0.36, 0.29, 0.53), chairTaken = mat(0.54, 0.25, 0.20), shade = mat(0.11, 0.14, 0.13);
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
      add('cylinder', feltHi, [0, 0.78, 0], [3, 0.12, 3]);
      add('cylinder', wood, [0, 0.72, 0], [3.3, 0.06, 3.3]);
      add('cylinder', wood, [0, 0.36, 0], [0.6, 0.72, 0.6]);
      for (let i = 0; i < t.seats; i++) { const ang = (i / t.seats) * Math.PI * 2; add('box', i < t.seated ? chairTaken : chairFree, [Math.sin(ang) * 2.1, 0.25, Math.cos(ang) * 2.1], [0.5, 0.5, 0.5], -ang * 180 / Math.PI); }
      add('cone', shade, [0, 3.4, 0], [1.2, 0.5, 1.2]);
      const lamp = new pc.Entity('lamp'); lamp.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.94, 0.8), intensity: 2.2, range: 10, castShadows: false }); lamp.setLocalPosition(0, 3.1, 0); g.addChild(lamp);
      plateRef.current.set(`table:${t.tableId}`, { id: `table:${t.tableId}`, kind: 'table', text: t.name, sub: `${t.seated}/${t.seats} seated`, world: new pc.Vec3(p.x, 1.9, p.y) });
    }
    if (a2.bar) { prim('box', wood, [a2.bar.x, 0.55, a2.bar.y], [1, 1.1, 5]); prim('box', brass, [a2.bar.x, 1.12, a2.bar.y], [1.2, 0.06, 5.2]); plateRef.current.set('anchor:bar', { id: 'anchor:bar', kind: 'anchor', text: 'The bar', world: new pc.Vec3(a2.bar.x, 1.8, a2.bar.y) }); }
    if (a2.fire) {
      prim('box', mat(0.36, 0.29, 0.23), [a2.fire.x, 0.8, a2.fire.y], [0.6, 1.6, 2.2]);
      const fire = new pc.Entity('fire'); fire.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.6, 0.24), intensity: 1.6, range: 7 }); fire.setLocalPosition(a2.fire.x - 0.6, 0.5, a2.fire.y); root.addChild(fire);
      plateRef.current.set('anchor:fire', { id: 'anchor:fire', kind: 'anchor', text: 'The fire', world: new pc.Vec3(a2.fire.x, 1.9, a2.fire.y) });
    }
    if (a2.lectern) { prim('box', wood, [a2.lectern.x, 0.6, a2.lectern.y], [0.5, 1.2, 0.5]); plateRef.current.set('anchor:lectern', { id: 'anchor:lectern', kind: 'anchor', text: "♦ The guest's lectern", world: new pc.Vec3(a2.lectern.x, 1.7, a2.lectern.y) }); }
  }, [state.manifest]);

  // ── the people, from presence ──
  useEffect(() => {
    const a = app.current; const manifest = state.manifest; if (!a || !state.you || !manifest) return;
    // WHERE A CHAIR IS: the table's anchor plus the seat's place around it, facing the felt.
    const chairOf = (tableId: string, seat: number): { at: pc.Vec3; yaw: number } | null => {
      const t = manifest.tables.find((x) => x.tableId === tableId); const an = t ? manifest.anchors[t.anchor] : undefined;
      if (!t || !an) return null;
      const ang = (seat / t.seats) * Math.PI * 2; // seats are 0-based, as the flat board's ring draws them
      return { at: new pc.Vec3(an.x + Math.sin(ang) * 2.1, 0, an.y + Math.cos(ang) * 2.1), yaw: ang + Math.PI };
    };
    const seen = new Set<string>();
    for (const p of state.people.values()) {
      seen.add(p.playerId);
      const chair = p.seatedAt ? chairOf(p.seatedAt.tableId, p.seatedAt.seat) : null;
      const isMe = p.playerId === state.you;
      if (isMe) {
        if (!me.current) {
          const f = new Figure(p.body); const e = f.entity; e.setPosition(p.x, 0, p.y); e.setEulerAngles(0, p.yaw * 180 / Math.PI, 0); a.root.addChild(e);
          me.current = { figure: f, entity: e, pos: new pc.Vec3(p.x, 0, p.y), yaw: p.yaw, goal: null, seated: null };
        }
        me.current.seated = chair;
        plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: `${p.name} · you`, world: me.current.entity.getPosition().clone().add(new pc.Vec3(0, 2.05, 0)), you: true });
        continue;
      }
      let b = bodies.current.get(p.playerId);
      if (!b) { const f = new Figure(p.body); const e = f.entity; e.setPosition(p.x, 0, p.y); a.root.addChild(e); b = { figure: f, entity: e, target: new pc.Vec3(p.x, 0, p.y), yaw: p.yaw, last: new pc.Vec3(p.x, 0, p.y), speed: 0, seated: false }; bodies.current.set(p.playerId, b); }
      if (chair) { b.target.copy(chair.at); b.yaw = chair.yaw; b.seated = true; } else { b.target.set(p.x, 0, p.y); b.yaw = p.yaw; b.seated = false; }
      // The agent under the name only when it IS a name — an address says nothing to anyone.
      plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: p.name, ...(p.agent && p.agent.includes('.') ? { sub: p.agent } : {}), world: b.target.clone().add(new pc.Vec3(0, 2.05, 0)) });
      const said = p.said && Date.now() - p.said.at < 8000 ? p.said.text : null;
      if (said) plateRef.current.set(`bubble:${p.playerId}`, { id: `bubble:${p.playerId}`, kind: 'bubble', text: said, world: b.target.clone().add(new pc.Vec3(0, 2.5, 0)) }); else plateRef.current.delete(`bubble:${p.playerId}`);
    }
    for (const [id, b] of [...bodies.current]) if (!seen.has(id)) { b.entity.destroy(); bodies.current.delete(id); plateRef.current.delete(`name:${id}`); plateRef.current.delete(`bubble:${id}`); }
    // THE HOUSE'S BOTS AND ABSENT PLAYERS: an occupant no body in the room owns is drawn seated in its chair
    // as a quieter figure — a persona's body is decoration for a seat, not presence (spec §3.5).
    const seenBots = new Set<string>();
    for (const t of manifest.tables) for (const o of t.occupants ?? []) {
      if (state.people.has(o.playerId)) continue;
      const key = `${t.tableId}:${o.seat}`; seenBots.add(key);
      const chair = chairOf(t.tableId, o.seat); if (!chair) continue;
      let bt = bots.current.get(key);
      if (!bt) { const f = new Figure(o.kind === 'agent' ? 'slate' : 'ink'); a.root.addChild(f.entity); bt = { figure: f, entity: f.entity }; bots.current.set(key, bt); }
      bt.entity.setPosition(chair.at); bt.entity.setEulerAngles(0, chair.yaw * 180 / Math.PI, 0);
      plateRef.current.set(`bot:${key}`, { id: `bot:${key}`, kind: 'name', text: o.name ?? (o.kind === 'agent' ? 'house bot' : 'seated'), world: chair.at.clone().add(new pc.Vec3(0, 1.7, 0)) });
    }
    for (const [key, bt] of [...bots.current]) if (!seenBots.has(key)) { bt.entity.destroy(); bots.current.delete(key); plateRef.current.delete(`bot:${key}`); }
  }, [state.people, state.you, state.manifest]);

  // your own plate follows your own body (which moves locally, ahead of the server)
  useEffect(() => {
    const t = setInterval(() => { const m = me.current; const pl = state.you ? plateRef.current.get(`name:${state.you}`) : null; if (m && pl) pl.world = m.entity.getPosition().clone().add(new pc.Vec3(0, 2.05, 0)); }, 50);
    return () => clearInterval(t);
  }, [state.you]);

  return (
    <div className="lounge" ref={host}>
      <canvas ref={canvas} />
      <div className="lounge-overlay" aria-hidden="true">
        {plates.filter((p) => p.visible).map((p) => (
          <div key={p.id} className={`lounge-plate lounge-plate-${p.kind}${p.you ? ' lounge-plate-you' : ''}`} style={{ left: p.x, top: p.y }}>
            <span>{p.text}</span>{p.sub ? <small>{p.sub}</small> : null}
          </div>
        ))}
      </div>
      {!state.manifest ? <div className="lounge-loading-inline"><p className="hint">Walking in…</p></div> : null}
      <div className="lounge-help hint">Walk with W A S D or the arrow keys, or click the floor. Walk up to a table to look in.</div>
    </div>
  );
}

function keyOf(key: number): 'up' | 'down' | 'left' | 'right' | null {
  if (key === pc.KEY_W || key === pc.KEY_UP) return 'up';
  if (key === pc.KEY_S || key === pc.KEY_DOWN) return 'down';
  if (key === pc.KEY_A || key === pc.KEY_LEFT) return 'left';
  if (key === pc.KEY_D || key === pc.KEY_RIGHT) return 'right';
  return null;
}

/**
 * A FIGURE — an articulated body built from primitives: hips, torso, head, two arms hinged at the shoulder,
 * two legs hinged at the hip. `Figure.animate(dt, speed)` swings the limbs in a walk cycle scaled by how fast
 * the body is moving, and settles into an idle — a breath, a slow look about — when it stands. A glTF body
 * from the PlayCanvas editor takes the same place with the same interface; this is the stand-in that moves.
 */
export class Figure {
  readonly entity: pc.Entity;
  private readonly hips: pc.Entity;
  private readonly torso: pc.Entity;
  private readonly head: pc.Entity;
  private readonly arms: [pc.Entity, pc.Entity];
  private readonly legs: [pc.Entity, pc.Entity];
  private phase = 0;
  private gait = 0; // 0 standing … 1 walking, eased
  private idle = Math.random() * 6;
  constructor(body: string) {
    const [r, g, b] = BODY_COLOURS[body] ?? [0.5, 0.5, 0.5];
    const cloth = mat(r, g, b); const dark = mat(r * 0.55, g * 0.55, b * 0.55); const skin = mat(0.95, 0.90, 0.80); const ink = mat(0.11, 0.14, 0.13); const hair = mat(0.2, 0.14, 0.1);
    const e = new pc.Entity('figure'); this.entity = e;
    const hips = new pc.Entity('hips'); hips.setLocalPosition(0, 0.98, 0); e.addChild(hips); this.hips = hips;
    const torso = part('box', cloth, [0, 0.36, 0], [0.46, 0.62, 0.26]); hips.addChild(torso); this.torso = torso;
    const neck = part('cylinder', skin, [0, 0.72, 0], [0.16, 0.12, 0.16]); hips.addChild(neck);
    const head = new pc.Entity('head'); head.setLocalPosition(0, 0.9, 0); hips.addChild(head); this.head = head;
    head.addChild(part('sphere', skin, [0, 0, 0], [0.34, 0.36, 0.34]));
    head.addChild(part('sphere', hair, [0, 0.08, -0.03], [0.35, 0.28, 0.35]));
    for (const x of [0.07, -0.07]) head.addChild(part('sphere', ink, [x, 0.03, 0.155], [0.05, 0.05, 0.04]));
    const arm = (side: 1 | -1) => { const pivot = new pc.Entity('arm'); pivot.setLocalPosition(side * 0.31, 0.62, 0); hips.addChild(pivot); pivot.addChild(part('capsule', cloth, [0, -0.28, 0], [0.13, 0.30, 0.13])); pivot.addChild(part('sphere', skin, [0, -0.6, 0], [0.12, 0.12, 0.12])); return pivot; };
    const leg = (side: 1 | -1) => { const pivot = new pc.Entity('leg'); pivot.setLocalPosition(side * 0.12, 0.02, 0); hips.addChild(pivot); pivot.addChild(part('capsule', dark, [0, -0.45, 0], [0.16, 0.46, 0.16])); pivot.addChild(part('box', ink, [0, -0.93, 0.05], [0.16, 0.08, 0.28])); return pivot; };
    this.arms = [arm(1), arm(-1)]; this.legs = [leg(1), leg(-1)];
  }
  private seat = 0; // 0 standing … 1 seated, eased
  /** `speed` in m/s this frame; `seated` puts the figure in a chair: hips down, thighs forward, hands on the felt. */
  animate(dt: number, speed: number, seated = false): void {
    this.seat += ((seated ? 1 : 0) - this.seat) * Math.min(1, dt * 6);
    if (this.seat > 0.5) {
      this.idle += dt;
      const s = this.seat;
      this.hips.setLocalPosition(0, 0.98 - 0.42 * s + Math.sin(this.idle * 1.6) * 0.006, 0.05 * s);
      this.legs[0].setLocalEulerAngles(-85 * s, 0, 4); this.legs[1].setLocalEulerAngles(-85 * s, 0, -4);
      this.arms[0].setLocalEulerAngles(-45 * s, 0, 14); this.arms[1].setLocalEulerAngles(-45 * s, 0, -14);
      this.torso.setLocalEulerAngles(6 * s, 0, 0);
      this.head.setLocalEulerAngles(8 * s, Math.sin(this.idle * 0.4) * 22, 0);
      return;
    }
    const walking = Math.min(1, speed / 2.2);
    this.gait += (walking - this.gait) * Math.min(1, dt * 8);
    this.idle += dt;
    if (this.gait > 0.02) this.phase += dt * (6 + 4 * this.gait);
    else this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 6); // settle the stride
    const swing = Math.sin(this.phase) * 32 * this.gait;
    this.legs[0].setLocalEulerAngles(swing, 0, 0); this.legs[1].setLocalEulerAngles(-swing, 0, 0);
    this.arms[0].setLocalEulerAngles(-swing * 0.8, 0, 8); this.arms[1].setLocalEulerAngles(swing * 0.8, 0, -8);
    // the bob of a step, the breath of standing, a slow look around
    const bob = Math.abs(Math.sin(this.phase)) * 0.045 * this.gait + Math.sin(this.idle * 1.6) * 0.008 * (1 - this.gait);
    this.hips.setLocalPosition(0, 0.98 + bob, 0);
    this.torso.setLocalEulerAngles(3 * this.gait, 0, 0);
    this.head.setLocalEulerAngles(0, Math.sin(this.idle * 0.5) * 18 * (1 - this.gait), 0);
  }
}
function mat(r: number, g: number, b: number): pc.StandardMaterial { const m = new pc.StandardMaterial(); m.diffuse = new pc.Color(r, g, b); m.update(); return m; }
function part(type: string, material: pc.StandardMaterial, pos: [number, number, number], scale: [number, number, number]): pc.Entity {
  const e = new pc.Entity(type); e.addComponent('render', { type, material, castShadows: true, receiveShadows: false }); e.setLocalPosition(...pos); e.setLocalScale(...scale); return e;
}

export type { RoomPerson };
