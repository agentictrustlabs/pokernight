import { useEffect, useRef, useState } from 'react';
import * as pc from 'playcanvas';
import type { MysteryView } from '@pokernight/mystery';
import { AvatarLibrary, ParticipantAvatar, RoomKit, SKIN_WORDS } from '../room/embodiment';
import { BELVEDERE_PLAN, strandedAt, type Placed, type RoomPlan } from './plan';

/**
 * THE VENUE — the room you are in, drawn (docs/MYSTERY-NIGHT.md §9, phase 3).
 *
 * THE STAGING IS THE AUTHORITY, THE ROOM IS A VIEW. Who is here, what is in here and which doors are open
 * come from the view the staging sent; nothing in this file decides anything. Walking about is local
 * flavour — the only move that means anything is going through a door, and that is the engine's `move`.
 *
 * IT IS THE SAME MACHINERY AS THE CARD ROOM'S LOUNGE: one rigged body per person (`ParticipantAvatar`),
 * Kenney's CC0 furniture cloned per placement (`RoomKit`), names as HTML projected with `worldToScreen`.
 * What is new is that a ROOM IS DATA (`plan.ts`) — five rooms, and a sixth is a few lines rather than code.
 *
 * EVERYTHING YOU CAN DO IS IN THE PICTURE: a prop lights up and examines, a doorway walks you through, a
 * person can be spoken to. The controls under the scene do the same things in words, and both are the same
 * actions — the 2D page stays the one this is tested against, and a phone gets it.
 */
export interface VenueProps {
  view: MysteryView;
  /** The character talking right now, so their body says it. */
  speaking: string | null;
  act: (a: unknown) => void;
  onPerson?: (role: string) => void;
}

const BODIES = SKIN_WORDS;
const HEAD = 1.86;

export function Venue({ view, speaking, act, onPerson }: VenueProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const library = useRef<AvatarLibrary | null>(null);
  const kit = useRef<RoomKit | null>(null);
  const shell = useRef<pc.Entity | null>(null);
  const bodies = useRef(new Map<string, ParticipantAvatar>());
  const props = useRef(new Map<string, { at: pc.Vec3; lit: boolean; restore: Array<[pc.MeshInstance, pc.Material]> }>());
  const doors = useRef(new Map<string, pc.Vec3>());
  const camCtl = useRef({ yaw: 0, pitch: 0.22, zoom: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const actRef = useRef(act); actRef.current = act;
  const onPersonRef = useRef(onPerson); onPersonRef.current = onPerson;
  const speakingRef = useRef(speaking); speakingRef.current = speaking;
  const [plates, setPlates] = useState<Array<{ id: string; text: string; sub?: string; x: number; y: number; kind: string }>>([]);
  const hover = useRef<string | null>(null);

  // ── the application, once ──
  useEffect(() => {
    const c = canvas.current;
    if (!c || app.current) return;
    const a = new pc.Application(c, { mouse: new pc.Mouse(c), touch: new pc.TouchDevice(c), graphicsDeviceOptions: { antialias: true } });
    app.current = a;
    a.setCanvasFillMode(pc.FILLMODE_NONE);
    a.graphicsDevice.maxPixelRatio = Math.min(2, window.devicePixelRatio || 1);
    a.setCanvasResolution(pc.RESOLUTION_AUTO);
    const size = () => { const r = host.current?.getBoundingClientRect(); if (r) a.resizeCanvas(Math.floor(r.width), Math.floor(r.height)); };
    size();
    const ro = new ResizeObserver(size); if (host.current) ro.observe(host.current);
    // A HOTEL AT NIGHT IS DARK; A ROOM YOU CANNOT SEE IS A BUG. Lift the ambient and add a warm fill so the
    // walls read as walls and a face across the room is a face.
    a.scene.ambientLight = new pc.Color(0.42, 0.42, 0.46);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.04, 0.05, 0.06), fov: 52, nearClip: 0.1, farClip: 90 });
    a.root.addChild(camera);
    const sun = new pc.Entity('sun');
    sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.95, 0.86), intensity: 1.05, castShadows: true, shadowType: pc.SHADOW_PCF5_32F, shadowBias: 0.3, normalOffsetBias: 0.08, shadowResolution: 2048, shadowDistance: 24 });
    sun.setEulerAngles(58, 25, 0);
    a.root.addChild(sun);
    const lamp = new pc.Entity('fill');
    lamp.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.86, 0.66), intensity: 2.4, range: 18 });
    lamp.setPosition(0, 3.4, 0);
    a.root.addChild(lamp);

    library.current = new AvatarLibrary(a, '/room');
    library.current.load();
    kit.current = new RoomKit(a, '/room/lounge-kit.glb');
    kit.current.load();

    /** LOOKING AROUND is a captured pointer — a drag that leaves the canvas keeps the camera, not the browser menu. */
    const noMenu = (e: Event) => e.preventDefault();
    c.addEventListener('contextmenu', noMenu);
    let dragging = false; let lastX = 0; let lastY = 0;
    const down = (e: PointerEvent) => { if (e.button !== 2 && e.button !== 1) return; e.preventDefault(); dragging = true; lastX = e.clientX; lastY = e.clientY; c.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (dragging) {
        if (e.buttons === 0) { dragging = false; return; }
        camCtl.current.yaw += (e.clientX - lastX) * 0.006;
        camCtl.current.pitch = Math.max(-0.05, Math.min(0.75, camCtl.current.pitch + (e.clientY - lastY) * 0.004));
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      // WHAT IS UNDER THE POINTER lights up, so a thing you can look at looks like one.
      const r = c.getBoundingClientRect();
      hover.current = pick(e.clientX - r.left, e.clientY - r.top, camera)?.id ?? null;
    };
    const up = (e: PointerEvent) => { if (dragging) { dragging = false; try { c.releasePointerCapture(e.pointerId); } catch { /* gone */ } } };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    window.addEventListener('pointerup', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); camCtl.current.zoom = Math.max(0.55, Math.min(2.2, camCtl.current.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); }, { passive: false });

    /** What is at this screen point: the nearest prop, person or door within reach of the cursor. */
    const pick = (sx: number, sy: number, cam: pc.Entity): { kind: 'prop' | 'person' | 'door'; id: string } | null => {
      const out = new pc.Vec3();
      interface Near { kind: 'prop' | 'person' | 'door'; id: string; d: number }
      // A holder rather than a local: assigning from inside a callback is invisible to the narrowing.
      const found: { best: Near | null } = { best: null };
      const consider = (kind: Near['kind'], id: string, at: pc.Vec3, y: number) => {
        cam.camera!.worldToScreen(new pc.Vec3(at.x, y, at.z), out);
        if (out.z <= 0) return;
        const d = Math.hypot(out.x - sx, out.y - sy);
        if (d < 90 && (!found.best || d < found.best.d)) found.best = { kind, id, d };
      };
      for (const [id, p] of props.current) consider('prop', id, p.at, 0.9);
      for (const [id, b] of bodies.current) consider('person', id, b.pos, 1.2);
      for (const [id, at] of doors.current) consider('door', id, at, 1.1);
      return found.best ? { kind: found.best.kind, id: found.best.id } : null;
    };

    a.mouse!.on(pc.EVENT_MOUSEDOWN, (e: pc.MouseEvent) => {
      if (e.button !== pc.MOUSEBUTTON_LEFT) return;
      const hit = pick(e.x, e.y, camera);
      if (!hit) return;
      if (hit.kind === 'prop') actRef.current({ type: 'examine', prop: hit.id });
      else if (hit.kind === 'door') actRef.current({ type: 'move', room: hit.id });
      else onPersonRef.current?.(hit.id);
    });

    // the camera sits behind and above your own body, looking across the room
    a.on('update', (dt: number) => {
      // LOOKING INTO THE ROOM, NOT AT THE FLOOR: back from the near wall and well above head height, aimed at
      // the middle of it — the arrival view the card room's lounge had to learn too.
      const cc = camCtl.current;
      const dist = 8.6 * cc.zoom;
      const x = Math.sin(cc.yaw) * dist;
      const z = -Math.cos(cc.yaw) * dist;
      camera.setPosition(x, 3.9 + cc.pitch * 6, z - 2.6);
      camera.lookAt(0, 1.25, 1.8);
      for (const [role, b] of bodies.current) { b.talking(speakingRef.current === role); b.update(dt); }
    });

    // names, projected — the same trick the lounge uses, at 25 Hz
    let clock = 0;
    a.on('framerender', () => {
      clock += 1;
      if (clock % 2) return;
      const out = new pc.Vec3();
      const next: Array<{ id: string; text: string; sub?: string; x: number; y: number; kind: string }> = [];
      const v = viewRef.current;
      for (const [role, b] of bodies.current) {
        camera.camera!.worldToScreen(new pc.Vec3(b.pos.x, HEAD, b.pos.z), out);
        if (out.z <= 0) continue;
        const who = v.cast.find((c) => c.role === role);
        next.push({ id: `p:${role}`, text: who?.name ?? role, sub: who?.playedBy ?? (who?.operator === 'agent' ? 'an agent' : undefined), x: out.x, y: out.y, kind: speakingRef.current === role ? 'name speaking' : 'name' });
      }
      for (const [id, p] of props.current) {
        camera.camera!.worldToScreen(new pc.Vec3(p.at.x, 1.15, p.at.z), out);
        if (out.z <= 0) continue;
        const prop = v.room?.props.find((x) => x.id === id);
        if (hover.current === id || !prop?.examined) next.push({ id: `t:${id}`, text: prop?.name ?? id, x: out.x, y: out.y, kind: hover.current === id ? 'thing lit' : 'thing' });
      }
      for (const [id, at] of doors.current) {
        camera.camera!.worldToScreen(new pc.Vec3(at.x, 1.5, at.z), out);
        if (out.z <= 0) continue;
        const door = v.room?.doors.find((d) => d.id === id);
        next.push({ id: `d:${id}`, text: door?.open ? `→ ${door.name}` : `${door?.name ?? id} · shut`, x: out.x, y: out.y, kind: door?.open ? 'door' : 'door shut' });
      }
      setPlates(next);
    });

    a.start();
    return () => {
      ro.disconnect();
      c.removeEventListener('contextmenu', noMenu);
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up);
      window.removeEventListener('pointerup', up);
      for (const b of bodies.current.values()) b.destroy();
      bodies.current.clear(); props.current.clear(); doors.current.clear();
      a.destroy();
      app.current = null; library.current = null; kit.current = null; shell.current = null;
    };
  }, []);

  // ── the room: rebuilt when you walk into a different one ──
  const roomId = view.room?.id ?? '';
  useEffect(() => {
    const a = app.current;
    const k = kit.current;
    if (!a || !k || !roomId) return;
    const plan = BELVEDERE_PLAN[roomId];
    if (!plan) return;
    let cancelled = false;
    // The kit loads once; a room built before it arrives would be an empty box, so wait for it.
    k.ready(() => {
      if (cancelled || !app.current) return;
      shell.current?.destroy();
      props.current.clear();
      doors.current.clear();
      const root = new pc.Entity(`room:${roomId}`);
      a.root.addChild(root);
      shell.current = root;
      buildRoom(a, k, root, plan, roomId, props.current, doors.current, viewRef.current);
    });
    return () => { cancelled = true; };
  }, [roomId]);

  // ── the people in it ──
  useEffect(() => {
    const a = app.current;
    const lib = library.current;
    const plan = BELVEDERE_PLAN[roomId];
    if (!a || !lib || !plan) return;
    const here = [...(view.room?.people ?? []).map((p) => p.role), ...(view.you ? [view.you.role] : [])];
    const seen = new Set(here);
    here.forEach((role, i) => {
      const spot = plan.spots[i % plan.spots.length]!;
      let b = bodies.current.get(role);
      if (!b) {
        b = new ParticipantAvatar(lib, BODIES[Math.abs(hash(role)) % BODIES.length]!, role === view.you?.role ? 'direct' : 'follow');
        a.root.addChild(b.entity);
        // YOU STAND NEAREST THE CAMERA, so the room is seen over your own shoulder.
        b.place(role === view.you?.role ? 0 : spot[0], role === view.you?.role ? -2.2 : spot[1], role === view.you?.role ? 0 : Math.atan2(-spot[0], -spot[1]));
        bodies.current.set(role, b);
      } else if (role !== view.you?.role) {
        b.stand();
        b.walkTo(spot[0], spot[1], Math.atan2(-spot[0], -spot[1]));
      }
    });
    for (const [role, b] of [...bodies.current]) if (!seen.has(role)) { b.destroy(); bodies.current.delete(role); }
  }, [roomId, view.room?.people.map((p) => p.role).join(','), view.you?.role]);

  return (
    <div className="venue" ref={host}>
      <canvas ref={canvas} />
      <div className="venue-plates" aria-hidden="true">
        {plates.map((p) => (
          <div key={p.id} className={`venue-plate venue-${p.kind.split(' ')[0]}${p.kind.includes('lit') ? ' lit' : ''}${p.kind.includes('speaking') ? ' speaking' : ''}${p.kind.includes('shut') ? ' shut' : ''}`} style={{ left: p.x, top: p.y }}>
            <span>{p.text}</span>
            {p.sub ? <small>{p.sub}</small> : null}
          </div>
        ))}
      </div>
      <p className="venue-help hint">Click a thing to look at it, a doorway to go through, somebody to speak to. Right-drag to look around; scroll to zoom.</p>
    </div>
  );
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h | 0;
}

/** Floor, walls, furniture, props and doorways — everything the plan says, and everything the venue has. */
function buildRoom(
  a: pc.Application, kit: RoomKit, root: pc.Entity, plan: RoomPlan, roomId: string,
  propMap: Map<string, { at: pc.Vec3; lit: boolean; restore: Array<[pc.MeshInstance, pc.Material]> }>,
  doorMap: Map<string, pc.Vec3>, view: MysteryView,
): void {
  const mat = (hex: string, glow = 0): pc.StandardMaterial => {
    const m = new pc.StandardMaterial();
    const c = new pc.Color().fromString(hex.length === 7 ? `${hex}ff` : hex);
    m.diffuse = c;
    if (glow) { m.emissive = c; m.emissiveIntensity = glow; }
    m.update();
    return m;
  };
  const prim = (shape: 'box' | 'cylinder' | 'plane', m: pc.StandardMaterial, pos: [number, number, number], scale: [number, number, number], yaw = 0): pc.Entity => {
    const e = new pc.Entity(shape);
    e.addComponent('render', { type: shape, material: m, castShadows: shape !== 'plane', receiveShadows: true });
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    e.setLocalScale(scale[0], scale[1], scale[2]);
    e.setLocalEulerAngles(0, yaw, 0);
    root.addChild(e);
    return e;
  };
  const floor = mat(plan.floor);
  const wall = mat(plan.wall);
  prim('plane', floor, [0, 0, 0], [plan.w * 2, 1, plan.d * 2]);
  prim('box', wall, [0, 1.6, plan.d + 0.2], [plan.w * 2 + 0.4, 3.2, 0.4]);
  prim('box', wall, [0, 1.6, -plan.d - 0.2], [plan.w * 2 + 0.4, 3.2, 0.4]);
  prim('box', wall, [-plan.w - 0.2, 1.6, 0], [0.4, 3.2, plan.d * 2 + 0.4]);
  prim('box', wall, [plan.w + 0.2, 1.6, 0], [0.4, 3.2, plan.d * 2 + 0.4]);

  const placed = new Set<string>();
  for (const t of plan.things) place(t);
  // A PROP THE PLAN FORGOT IS STILL IN THE ROOM — put it against the wall rather than let it vanish.
  const missing = (view.room?.id === roomId ? view.room.props : []).filter((p) => !placed.has(p.id));
  missing.forEach((p, i) => {
    const [x, z] = strandedAt(i, plan);
    place({ prim: { shape: 'box', size: [0.6, 0.6, 0.6], colour: plan.accent }, x, z, prop: p.id });
  });

  function place(t: Placed): void {
    let at: pc.Vec3 | null = null;
    if (t.piece) {
      const e = kit.place(t.piece, root, t.x, t.z, t.yaw ?? 0, t.scale ?? 1);
      if (e) at = new pc.Vec3(t.x, 0, t.z);
    }
    if (!at && t.prim) {
      const m = mat(t.prim.colour, t.prim.glow ?? 0);
      prim('box', m, [t.x, t.prim.size[1] / 2, t.z], t.prim.size, t.yaw ?? 0);
      at = new pc.Vec3(t.x, 0, t.z);
    }
    if (!at) at = new pc.Vec3(t.x, 0, t.z);
    if (t.prop) { propMap.set(t.prop, { at, lit: false, restore: [] }); placed.add(t.prop); }
  }

  // the doorways: a piece in the wall, and a place to click
  for (const [to, [x, z]] of Object.entries(plan.doors)) {
    kit.place('doorway', root, x, z, Math.abs(x) > Math.abs(z) ? (x > 0 ? 90 : 270) : (z > 0 ? 180 : 0), 1.1);
    doorMap.set(to, new pc.Vec3(x * 0.92, 0, z * 0.92));
  }
}
