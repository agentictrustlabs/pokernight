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

interface BodyHandle { entity: pc.Entity; target: pc.Vec3; yaw: number }
interface Plate { id: string; kind: 'name' | 'table' | 'anchor' | 'bubble'; text: string; sub?: string; world: pc.Vec3; you?: boolean; x?: number; y?: number; visible?: boolean }

export function Lounge({ socket, state, onZone }: LoungeProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const bodies = useRef(new Map<string, BodyHandle>());
  const scenery = useRef<pc.Entity | null>(null);
  const me = useRef<{ entity: pc.Entity; pos: pc.Vec3; yaw: number; goal: pc.Vec3 | null } | null>(null);
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
      if (m) {
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
        m.pos.x = Math.max(-10, Math.min(10, m.pos.x)); m.pos.z = Math.max(-10, Math.min(10, m.pos.z));
        m.entity.setPosition(m.pos);
        const cur = m.entity.getEulerAngles().y * Math.PI / 180;
        m.entity.setEulerAngles(0, (cur + (m.yaw - cur) * Math.min(1, dt * 10)) * 180 / Math.PI, 0);
        if (moved) socket.pose(m.pos.x, m.pos.z, m.yaw);
        const behind = new pc.Vec3(m.pos.x - Math.sin(m.yaw) * 5.5, 4.2, m.pos.z - Math.cos(m.yaw) * 5.5);
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(m.pos.x, 1.2, m.pos.z);
      }
      // the others ease toward their last pose
      for (const b of bodies.current.values()) {
        const p = b.entity.getPosition();
        b.entity.setPosition(p.lerp(p, b.target, Math.min(1, dt * 8)));
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
    const a = app.current; if (!a || !state.you) return;
    const seen = new Set<string>();
    for (const p of state.people.values()) {
      seen.add(p.playerId);
      const isMe = p.playerId === state.you;
      if (isMe) {
        if (!me.current) {
          const e = capsule(a, p.body); e.setPosition(p.x, 0, p.y); e.setEulerAngles(0, p.yaw * 180 / Math.PI, 0); a.root.addChild(e);
          me.current = { entity: e, pos: new pc.Vec3(p.x, 0, p.y), yaw: p.yaw, goal: null };
        }
        plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: `${p.name} · you`, world: me.current.entity.getPosition().clone().add(new pc.Vec3(0, 2.05, 0)), you: true });
        continue;
      }
      let b = bodies.current.get(p.playerId);
      if (!b) { const e = capsule(a, p.body); e.setPosition(p.x, 0, p.y); a.root.addChild(e); b = { entity: e, target: new pc.Vec3(p.x, 0, p.y), yaw: p.yaw }; bodies.current.set(p.playerId, b); }
      b.target.set(p.x, 0, p.y); b.yaw = p.yaw;
      // The agent under the name only when it IS a name — an address says nothing to anyone.
      plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: p.name, ...(p.agent && p.agent.includes('.') ? { sub: p.agent } : {}), world: b.target.clone().add(new pc.Vec3(0, 2.05, 0)) });
      const said = p.said && Date.now() - p.said.at < 8000 ? p.said.text : null;
      if (said) plateRef.current.set(`bubble:${p.playerId}`, { id: `bubble:${p.playerId}`, kind: 'bubble', text: said, world: b.target.clone().add(new pc.Vec3(0, 2.5, 0)) }); else plateRef.current.delete(`bubble:${p.playerId}`);
    }
    for (const [id, b] of [...bodies.current]) if (!seen.has(id)) { b.entity.destroy(); bodies.current.delete(id); plateRef.current.delete(`name:${id}`); plateRef.current.delete(`bubble:${id}`); }
  }, [state.people, state.you]);

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

/** A body: a capsule in the palette, a head, two eyes — the stand-in for a VRM humanoid on the same pose. */
function capsule(a: pc.Application, body: string): pc.Entity {
  void a;
  const [r, g, b] = BODY_COLOURS[body] ?? [0.5, 0.5, 0.5];
  const m = new pc.StandardMaterial(); m.diffuse = new pc.Color(r, g, b); m.update();
  const skin = new pc.StandardMaterial(); skin.diffuse = new pc.Color(0.95, 0.90, 0.80); skin.update();
  const ink = new pc.StandardMaterial(); ink.diffuse = new pc.Color(0.11, 0.14, 0.13); ink.update();
  const e = new pc.Entity('body');
  const torso = new pc.Entity('torso'); torso.addComponent('render', { type: 'capsule', material: m, castShadows: true }); torso.setLocalPosition(0, 0.9, 0); torso.setLocalScale(0.64, 0.8, 0.64); e.addChild(torso);
  const head = new pc.Entity('head'); head.addComponent('render', { type: 'sphere', material: skin, castShadows: true }); head.setLocalPosition(0, 1.72, 0); head.setLocalScale(0.52, 0.52, 0.52); e.addChild(head);
  for (const x of [0.09, -0.09]) { const eye = new pc.Entity('eye'); eye.addComponent('render', { type: 'sphere', material: ink }); eye.setLocalPosition(x, 1.76, 0.22); eye.setLocalScale(0.07, 0.07, 0.07); e.addChild(eye); }
  return e;
}

export type { RoomPerson };
