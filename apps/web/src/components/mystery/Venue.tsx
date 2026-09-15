import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
/**
 * WHAT THE PAGE CAN ASK THE ROOM TO DO.
 *
 * The controls under the scene and the things in the picture are the SAME acts, so pressing "look again at
 * the drinks tray" should walk you to the drinks tray exactly as clicking it does — otherwise half the game
 * moves your body and half teleports your attention. The page routes those two acts through here and the
 * room answers whether it took them.
 */
export interface VenueHandle {
  /** Walk to a prop, light it, and examine it on arrival. False when there is no such thing to walk to. */
  approach: (prop: string) => boolean;
  /** Walk to a door and go through it. False when this room has no such door. */
  goThrough: (room: string) => boolean;
}

export interface VenueProps {
  view: MysteryView;
  /** The character talking right now, so their body says it. */
  speaking: string | null;
  act: (a: unknown) => void;
  onPerson?: (role: string) => void;
}

const BODIES = SKIN_WORDS;
const HEAD = 1.86;

export const Venue = forwardRef<VenueHandle, VenueProps>(function Venue({ view, speaking, act, onPerson }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const library = useRef<AvatarLibrary | null>(null);
  const kit = useRef<RoomKit | null>(null);
  const shell = useRef<pc.Entity | null>(null);
  const bodies = useRef(new Map<string, ParticipantAvatar>());
  const props = useRef(new Map<string, { at: pc.Vec3; entity: pc.Entity | null }>());
  const doors = useRef(new Map<string, { at: pc.Vec3; frame: pc.Entity | null; leaf: pc.Entity | null }>());
  /** What is lit under the pointer right now, and the materials to put back when it is not. */
  const litNow = useRef<{ key: string; restore: Array<[pc.MeshInstance, pc.Material]> } | null>(null);
  /** A walk in progress to a door, and which room it leads to. */
  const goingTo = useRef<{ room: string; at: number } | null>(null);
  /** Which room we came from, so we enter the next one through its door rather than appearing in it. */
  const cameFrom = useRef<string | null>(null);
  const camCtl = useRef({ yaw: 0, pitch: 0.22, zoom: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const actRef = useRef(act); actRef.current = act;
  const onPersonRef = useRef(onPerson); onPersonRef.current = onPerson;
  const speakingRef = useRef(speaking); speakingRef.current = speaking;
  const [plates, setPlates] = useState<Array<{ id: string; text: string; sub?: string; x: number; y: number; kind: string }>>([]);
  /** A walk to a thing, and what to do when we get there. */
  const errand = useRef<{ prop: string; at: number } | null>(null);
  /** Set by the scene so the handle can reach the same two walks the picture uses. */
  const walkers = useRef<{ toProp: (prop: string) => boolean; toDoor: (room: string) => boolean } | null>(null);
  const hover = useRef<string | null>(null);
  /** How big the room being drawn is, so the camera stands back by its size rather than by a guess. */
  const roomSize = useRef(8);

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
    a.scene.ambientLight = new pc.Color(0.5, 0.49, 0.52);

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.04, 0.05, 0.06), fov: 52, nearClip: 0.1, farClip: 90 });
    a.root.addChild(camera);
    const sun = new pc.Entity('sun');
    sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.95, 0.86), intensity: 1.05, castShadows: true, shadowType: pc.SHADOW_PCF5_32F, shadowBias: 0.3, normalOffsetBias: 0.08, shadowResolution: 2048, shadowDistance: 24 });
    sun.setEulerAngles(58, 25, 0);
    a.root.addChild(sun);
    const lamp = new pc.Entity('fill');
    lamp.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.88, 0.7), intensity: 0.85, range: 13 });
    lamp.setPosition(0, 3.2, 1);
    a.root.addChild(lamp);

    library.current = new AvatarLibrary(a, '/room');
    library.current.load();
    kit.current = new RoomKit(a, '/room/lounge-kit.glb');
    kit.current.load();

    /**
     * LOOKING AROUND IS A CAPTURED POINTER, and the menu is suppressed at the WINDOW.
     *
     * Right-dragging past the edge of the canvas let go of the drag and handed the browser its own context
     * menu in the middle of looking around — the same bug the card room's lounge had, with the same fix:
     * capture the pointer so every move and the release stay with the canvas wherever the cursor goes, and
     * suppress the menu on the WINDOW while a drag is live, because suppressing it on the canvas alone never
     * sees the press that happened outside it.
     */
    let dragging = false; let lastX = 0; let lastY = 0;
    const noMenu = (e: Event) => e.preventDefault();
    const noMenuWhileDragging = (e: Event) => { if (dragging) e.preventDefault(); };
    c.addEventListener('contextmenu', noMenu);
    window.addEventListener('contextmenu', noMenuWhileDragging);
    const dropDrag = () => { dragging = false; };
    window.addEventListener('blur', dropDrag);
    const down = (e: PointerEvent) => { if (e.button !== 2 && e.button !== 1) return; e.preventDefault(); dragging = true; lastX = e.clientX; lastY = e.clientY; c.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (dragging) {
        if (e.buttons === 0) { dragging = false; return; }
        camCtl.current.yaw += (e.clientX - lastX) * 0.006;
        camCtl.current.pitch = Math.max(-0.05, Math.min(0.75, camCtl.current.pitch + (e.clientY - lastY) * 0.004));
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      // WHAT IS UNDER THE POINTER LIGHTS UP, so a thing you can click looks like one.
      const r = c.getBoundingClientRect();
      const over = pick(e.clientX - r.left, e.clientY - r.top, camera);
      hover.current = over?.id ?? null;
      light(over ? `${over.kind}:${over.id}` : null);
      c.style.cursor = over ? 'pointer' : 'default';
    };
    const up = (e: PointerEvent) => { if (dragging) { dragging = false; try { c.releasePointerCapture(e.pointerId); } catch { /* gone */ } } };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    window.addEventListener('pointerup', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); camCtl.current.zoom = Math.max(0.55, Math.min(2.2, camCtl.current.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); }, { passive: false });

    /**
     * A THING YOU CAN CLICK LOOKS LIKE ONE: its own material, cloned and made to glow, put back when the
     * pointer leaves. Never a foreign material — that is what once made the lounge's chairs VANISH under
     * the pointer instead of lighting up.
     */
    const light = (key: string | null): void => {
      if (litNow.current?.key === key) return;
      if (litNow.current) { for (const [mi, was] of litNow.current.restore) mi.material = was; litNow.current = null; }
      if (!key) return;
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const e = kind === 'prop' ? props.current.get(id)?.entity : kind === 'door' ? doors.current.get(id)?.frame : null;
      if (!e) return;
      const restore: Array<[pc.MeshInstance, pc.Material]> = [];
      for (const r of e.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) {
        const was = mi.material as pc.StandardMaterial;
        restore.push([mi, was]);
        const glow = was.clone();
        glow.emissive = new pc.Color(0.55, 0.42, 0.12);
        glow.emissiveIntensity = 1;
        glow.update();
        mi.material = glow;
      }
      litNow.current = { key, restore };
    };

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
      for (const [id, d] of doors.current) consider('door', id, d.at, 1.1);
      return found.best ? { kind: found.best.kind, id: found.best.id } : null;
    };

    /** Walk your body to a thing in this room and light it; the errand finishes in the update loop. */
    const toProp = (prop: string): boolean => {
      const p = props.current.get(prop);
      const me = viewRef.current.you ? bodies.current.get(viewRef.current.you.role) : null;
      if (!p || !me || errand.current) return false;
      errand.current = { prop, at: Date.now() };
      // stand a step short of it, facing it, so the body is beside the thing rather than inside it
      const d = Math.hypot(p.at.x, p.at.z) || 1;
      me.walkTo(p.at.x - (p.at.x / d) * 1.1, p.at.z - (p.at.z / d) * 1.1, Math.atan2(p.at.x, p.at.z));
      light(`prop:${prop}`);
      return true;
    };
    const toDoor = (room: string): boolean => {
      const door = doors.current.get(room);
      const me = viewRef.current.you ? bodies.current.get(viewRef.current.you.role) : null;
      if (!door || !me || goingTo.current) return false;
      goingTo.current = { room, at: Date.now() };
      me.walkTo(door.at.x * 0.8, door.at.z * 0.8, Math.atan2(door.at.x, door.at.z));
      light(`door:${room}`);
      return true;
    };
    walkers.current = { toProp, toDoor };

    a.mouse!.on(pc.EVENT_MOUSEDOWN, (e: pc.MouseEvent) => {
      if (e.button !== pc.MOUSEBUTTON_LEFT) return;
      const hit = pick(e.x, e.y, camera);
      if (!hit) return;
      if (hit.kind === 'prop') { if (!toProp(hit.id)) actRef.current({ type: 'examine', prop: hit.id }); }
      else if (hit.kind === 'door') {
        /**
         * A DOOR IS WALKED THROUGH, NOT TELEPORTED PAST. Clicking one sends your body to it, swings it open,
         * and only then asks the staging to move you — and the next room places you at the door you came
         * through rather than standing you in the middle of it. The engine still decides whether you may go.
         */
        if (!toDoor(hit.id) && !goingTo.current) actRef.current({ type: 'move', room: hit.id });
      }
      else onPersonRef.current?.(hit.id);
    });

    // the camera sits behind and above your own body, looking across the room
    a.on('update', (dt: number) => {
      // LOOKING INTO THE ROOM, NOT AT THE FLOOR: back from the near wall and well above head height, aimed at
      // the middle of it — the arrival view the card room's lounge had to learn too.
      // A BIG ROOM NEEDS MORE ROOM: the lobby is sixteen metres across and a guest floor is twelve, and one
      // fixed distance puts the camera inside the furniture of the small one and across the hall from the big.
      const cc = camCtl.current;
      const size = roomSize.current;
      const dist = (size * 0.8 + 2.6) * cc.zoom;
      const x = Math.sin(cc.yaw) * dist;
      const z = -Math.cos(cc.yaw) * dist;
      camera.setPosition(x, 2.6 + size * 0.16 + cc.pitch * 5, z - size * 0.28);
      camera.lookAt(0, 0.95, size * 0.04);
      for (const [role, b] of bodies.current) { b.talking(speakingRef.current === role); b.update(dt); }
      // …and when the walk to a thing is done, look at it.
      const err = errand.current;
      if (err && Date.now() - err.at > 950) { errand.current = null; actRef.current({ type: 'examine', prop: err.prop }); }
      // …and when the walk to the door is done, go through it.
      const going = goingTo.current;
      if (going && Date.now() - going.at > 1100) {
        goingTo.current = null;
        cameFrom.current = viewRef.current.room?.id ?? null;
        actRef.current({ type: 'move', room: going.room });
      }
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
      for (const [id, d] of doors.current) {
        camera.camera!.worldToScreen(new pc.Vec3(d.at.x, 1.5, d.at.z), out);
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
      window.removeEventListener('contextmenu', noMenuWhileDragging);
      window.removeEventListener('blur', dropDrag);
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
      roomSize.current = Math.max(plan.w, plan.d);
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
      const mine = role === view.you?.role;
      let b = bodies.current.get(role);
      if (!b) {
        b = new ParticipantAvatar(lib, BODIES[Math.abs(hash(role)) % BODIES.length]!, mine ? 'direct' : 'follow');
        a.root.addChild(b.entity);
        /**
         * YOU COME IN THROUGH THE DOOR YOU CAME THROUGH. Standing somebody in the middle of a room they have
         * just walked into is the teleport this was built to stop: your body is PLACED at the door back to
         * the room you left, and walks from there to where it stands. Arriving at the start of the night, or
         * from nowhere in particular, you are simply by the camera.
         */
        const back = cameFrom.current ? doors.current.get(cameFrom.current) : null;
        if (mine && back) { b.place(back.at.x * 0.85, back.at.z * 0.85, Math.atan2(-back.at.x, -back.at.z)); b.walkTo(0, -2.2, 0); }
        else b.place(mine ? 0 : spot[0], mine ? -2.2 : spot[1], mine ? 0 : Math.atan2(-spot[0], -spot[1]));
        bodies.current.set(role, b);
      } else if (!mine) {
        b.stand();
        b.walkTo(spot[0], spot[1], Math.atan2(-spot[0], -spot[1]));
      }
    });
    // Whatever room this is, it is now the one to come back from.
    if (view.room?.id) cameFrom.current = cameFrom.current && doors.current.has(cameFrom.current) ? cameFrom.current : null;
    for (const [role, b] of [...bodies.current]) if (!seen.has(role)) { b.destroy(); bodies.current.delete(role); }
  }, [roomId, view.room?.people.map((p) => p.role).join(','), view.you?.role]);

  // The page's own controls walk the same walk the picture does.
  useImperativeHandle(ref, () => ({
    approach: (prop: string) => walkers.current?.toProp(prop) ?? false,
    goThrough: (room: string) => walkers.current?.toDoor(room) ?? false,
  }), []);

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
});

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h | 0;
}

/** Floor, walls, furniture, props and doorways — everything the plan says, and everything the venue has. */
function buildRoom(
  a: pc.Application, kit: RoomKit, root: pc.Entity, plan: RoomPlan, roomId: string,
  propMap: Map<string, { at: pc.Vec3; entity: pc.Entity | null }>,
  doorMap: Map<string, { at: pc.Vec3; frame: pc.Entity | null; leaf: pc.Entity | null }>, view: MysteryView,
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
    let entity: pc.Entity | null = null;
    if (t.piece) {
      entity = kit.place(t.piece, root, t.x, t.z, t.yaw ?? 0, t.scale ?? 1);
      if (entity) at = new pc.Vec3(t.x, 0, t.z);
    }
    if (!at && t.prim) {
      const m = mat(t.prim.colour, t.prim.glow ?? 0);
      entity = prim('box', m, [t.x, t.prim.size[1] / 2, t.z], t.prim.size, t.yaw ?? 0);
      at = new pc.Vec3(t.x, 0, t.z);
    }
    if (!at) at = new pc.Vec3(t.x, 0, t.z);
    if (t.prop) { propMap.set(t.prop, { at, entity }); placed.add(t.prop); }
  }

  // the doorways: a piece in the wall, and a place to click
  for (const [to, [x, z]] of Object.entries(plan.doors)) {
    const yaw = Math.abs(x) > Math.abs(z) ? (x > 0 ? 90 : 270) : (z > 0 ? 180 : 0);
    // NO SEPARATE LEAF. The kit's door panel is its own node with its own pivot and hangs nowhere near the
    // frame when placed beside it — a two-metre door floating in the corner of the room. The doorway itself
    // lights as you walk to it, which says "this one is opening" without lying about geometry.
    const frame = kit.place('doorway', root, x, z, yaw, 1.1);
    doorMap.set(to, { at: new pc.Vec3(x * 0.92, 0, z * 0.92), frame, leaf: null });
  }
}
