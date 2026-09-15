import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pc from 'playcanvas';
import type { RoomManifest, RoomPerson } from '@pokernight/protocol';
import type { RoomSocket, RoomState } from '../../lib/roomSocket';
import { Portrait } from '../huddle/Portrait';
import { AvatarLibrary, ParticipantAvatar, type Seat } from './embodiment';
import { isSpeaking } from './speaking';

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
const BODY_URL = '/room/mannequin.glb';
const CHAIR_R = 2.35; // where a seated body's feet go, from the table's centre

export interface LoungeProps {
  socket: RoomSocket;
  state: RoomState;
  onZone?: (zone: string | null) => void;
  /** Your body has walked up to this chair and turned to it: the page takes the seat at the TABLE. */
  onSitRequest?: (tableId: string, seat: number) => void;
}
/** What the page can tell the lounge to do with your body. */
export interface LoungeHandle {
  /** Walk to this chair; `onSitRequest` fires on arrival. */
  walkToSeat: (tableId: string, seat: number) => boolean;
}

interface BodyHandle { avatar: ParticipantAvatar; name: string }
interface Plate { id: string; kind: 'name' | 'table' | 'anchor' | 'bubble'; text: string; sub?: string; world: pc.Vec3; you?: boolean; /** whose face hangs on the plate, when the huddle has one */ face?: string; x?: number; y?: number; visible?: boolean }

export const Lounge = forwardRef<LoungeHandle, LoungeProps>(function Lounge({ socket, state, onZone, onSitRequest }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const bodies = useRef(new Map<string, BodyHandle>());
  const scenery = useRef<pc.Entity | null>(null);
  const library = useRef<AvatarLibrary | null>(null);
  const me = useRef<{ avatar: ParticipantAvatar; name: string; goal: pc.Vec3 | null; heading: { tableId: string; seat: number; yaw: number } | null } | null>(null);
  const onSitRef = useRef(onSitRequest); onSitRef.current = onSitRequest;
  /** Every chair in the room, by table and seat, with whether somebody is in it — from the manifest. */
  const chairs = useRef<Array<{ tableId: string; seat: number; at: pc.Vec3; yaw: number; taken: boolean }>>([]);
  /** House bots in chairs — bodies for occupants no person in the room owns. */
  const bots = useRef(new Map<string, ParticipantAvatar>());
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
        const behind = new pc.Vec3(p.x - Math.sin(yaw) * 2.4 + Math.cos(yaw) * 0.9, 3.1, p.z - Math.cos(yaw) * 2.4 - Math.sin(yaw) * 0.9);
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(p.x + Math.sin(yaw) * 2.2, 0.85, p.z + Math.cos(yaw) * 2.2);
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
        av.moved(); av.update(dt);
        if (moved) socket.pose(pos.x, pos.z, av.yaw);
        const behind = new pc.Vec3(Math.max(-10.5, Math.min(10.5, pos.x - Math.sin(av.yaw) * 5.5)), 4.2, Math.max(-10.5, Math.min(10.5, pos.z - Math.cos(av.yaw) * 5.5)));
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(pos.x, 1.2, pos.z);
      }
      if (m) m.avatar.talking(isSpeaking(m.name));
      // the others ease toward their last pose; mouths move for whoever the huddle hears
      for (const bt of bots.current.values()) bt.update(dt);
      for (const b of bodies.current.values()) { b.avatar.talking(isSpeaking(b.name)); b.avatar.update(dt); }
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
    library.current = new AvatarLibrary(a, BODY_URL); library.current.load();
    // the walk scripts read the bodies' states through this; nothing in the app does
    (window as unknown as { __lounge?: unknown }).__lounge = { me, bodies, bots, library };
    a.start();
    app.current = a;
    return () => { ro.disconnect(); a.destroy(); app.current = null; library.current = null; bodies.current.clear(); bots.current.clear(); me.current = null; scenery.current = null; plateRef.current.clear(); };
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
      // A CHAIR is a seat pad and a back, a little outside where the body's feet go (CHAIR_R), turned to the felt.
      for (let i = 0; i < t.seats; i++) {
        const ang = (i / t.seats) * Math.PI * 2; const c = i < t.seated ? chairTaken : chairFree; const r = CHAIR_R + 0.28;
        add('box', c, [Math.sin(ang) * r, 0.42, Math.cos(ang) * r], [0.5, 0.08, 0.5], ang * 180 / Math.PI);
        add('box', c, [Math.sin(ang) * (r + 0.22), 0.7, Math.cos(ang) * (r + 0.22)], [0.5, 0.6, 0.06], ang * 180 / Math.PI);
      }
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
    const a = app.current; const manifest = state.manifest; const lib = library.current; if (!a || !state.you || !manifest || !lib) return;
    // WHERE A CHAIR IS: the table's anchor plus the seat's place around it, facing the felt. The seated anchor
    // is where the body's feet go; the sit clip puts the hips on the chair behind them.
    const chairOf = (tableId: string, seat: number): Seat | null => {
      const t = manifest.tables.find((x) => x.tableId === tableId); const an = t ? manifest.anchors[t.anchor] : undefined;
      if (!t || !an) return null;
      const ang = (seat / t.seats) * Math.PI * 2; // seats are 0-based, as the flat board's ring draws them
      return { at: new pc.Vec3(an.x + Math.sin(ang) * CHAIR_R, 0, an.y + Math.cos(ang) * CHAIR_R), yaw: ang + Math.PI };
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
        plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: `${p.name} · you`, face: p.name, world: me.current.avatar.pos.clone().add(new pc.Vec3(0, 2.05, 0)), you: true });
        continue;
      }
      let b = bodies.current.get(p.playerId);
      if (!b) { const av = new ParticipantAvatar(lib, p.body, 'follow'); av.place(p.x, p.y, p.yaw); a.root.addChild(av.entity); b = { avatar: av, name: p.name }; bodies.current.set(p.playerId, b); }
      if (chair) b.avatar.sitAt(chair); else { b.avatar.stand(); b.avatar.walkTo(p.x, p.y, p.yaw); }
      const head = (chair ? chair.at : new pc.Vec3(p.x, 0, p.y)).add(new pc.Vec3(0, chair ? 1.6 : 2.05, 0));
      // The agent under the name only when it IS a name — an address says nothing to anyone.
      plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: p.name, face: p.name, ...(p.agent && p.agent.includes('.') ? { sub: p.agent } : {}), world: head });
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
      plateRef.current.set(`bot:${key}`, { id: `bot:${key}`, kind: 'name', text: o.name ?? (o.kind === 'agent' ? 'house bot' : 'seated'), world: chair.at.clone().add(new pc.Vec3(0, 1.6, 0)) });
    }
    for (const [key, bt] of [...bots.current]) if (!seenBots.has(key)) { bt.destroy(); bots.current.delete(key); plateRef.current.delete(`bot:${key}`); }
  }, [state.people, state.you, state.manifest]);

  // your own plate follows your own body (which moves locally, ahead of the server)
  useEffect(() => {
    const t = setInterval(() => { const m = me.current; const pl = state.you ? plateRef.current.get(`name:${state.you}`) : null; if (m && pl) pl.world = m.avatar.pos.clone().add(new pc.Vec3(0, m.avatar.seated ? 1.6 : 2.05, 0)); }, 50);
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
