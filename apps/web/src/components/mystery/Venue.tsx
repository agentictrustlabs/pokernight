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
  /** Turn the camera on this character, wherever they are standing — or lying — in this room. */
  lookAt: (role: string) => boolean;
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
/** Metres a second, the same amble the card room's lounge walks at. */
const WALK_SPEED = 3.4;

export const Venue = forwardRef<VenueHandle, VenueProps>(function Venue({ view, speaking, act, onPerson }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const library = useRef<AvatarLibrary | null>(null);
  const kit = useRef<RoomKit | null>(null);
  const shell = useRef<pc.Entity | null>(null);
  const bodies = useRef(new Map<string, ParticipantAvatar>());
  const props = useRef(new Map<string, { at: pc.Vec3; entity: pc.Entity | null }>());
  const doors = useRef(new Map<string, { at: pc.Vec3; frame: pc.Entity | null; leaf: pc.Entity | null; swing: number }>());
  /** What is lit under the pointer right now, and the materials to put back when it is not. */
  const litNow = useRef<{ key: string; restore: Array<[pc.MeshInstance, pc.Material]> } | null>(null);
  /** A walk in progress to a door, and which room it leads to. */
  const goingTo = useRef<{ room: string; at: number } | null>(null);
  /** Which room we came from, so we enter the next one through its door rather than appearing in it. */
  const cameFrom = useRef<string | null>(null);
  /**
   * THE NIGHT OPENS ON THE WHOLE ROOM, FROM ABOVE (2026-09-15).
   *
   * It used to open at eye height across the floor, which put the room in a thin band across the middle of
   * the picture with every name plate piled on top of every other and half the cast behind somebody else.
   * The first thing a player needs is WHO IS HERE AND WHERE — so the camera starts high and looking down, a
   * doll's-house view of the room with everybody separated on the floor, and drops toward eye level as you
   * pitch it down or zoom in. Nothing is locked: right-drag still goes anywhere.
   */
  const camCtl = useRef({ yaw: 0, pitch: 0.62, zoom: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const actRef = useRef(act); actRef.current = act;
  const onPersonRef = useRef(onPerson); onPersonRef.current = onPerson;
  const speakingRef = useRef(speaking); speakingRef.current = speaking;
  const [plates, setPlates] = useState<Array<{ id: string; text: string; sub?: string; x: number; y: number; kind: string }>>([]);
  /** A walk to a thing, and what to do when we get there. */
  const errand = useRef<{ prop: string; at: number; to: pc.Vec3 } | null>(null);
  /** Set by the scene so the handle can reach the same two walks the picture uses. */
  const walkers = useRef<{ toProp: (prop: string) => boolean; toDoor: (room: string) => boolean } | null>(null);
  const hover = useRef<string | null>(null);
  /** How big the room being drawn is, so the camera stands back by its size rather than by a guess. */
  const roomSize = useRef(8);
  /** The room this body has already been placed in, so entering one is done once. */
  const arrived = useRef<string | null>(null);
  /** Where your own body is walking to. YOUR body is moved by this controller, not eased by the avatar. */
  const goal = useRef<pc.Vec3 | null>(null);
  const keys = useRef(new Set<'up' | 'down' | 'left' | 'right'>());
  /**
   * WHAT YOU ARE LOOKING AT CLOSELY (2026-09-15).
   *
   * Walking up to the register and reading a line of text about it is a page, not a place. When the body
   * arrives at a thing the camera comes in over its shoulder and frames the thing itself — the ledger on the
   * desk, the skis on the rack — and stays there while the clue is read, then eases back out to the room.
   * Any click, any key, or the next act lets go of it, so it is never somewhere you are stuck.
   */
  const focus = useRef<{ at: pc.Vec3; until: number; tight?: boolean } | null>(null);
  const lookAtRef = useRef<((role: string) => boolean) | null>(null);

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
      // stand a step short of it, facing it, so the body is beside the thing rather than inside it
      const d = Math.hypot(p.at.x, p.at.z) || 1;
      const to = new pc.Vec3(p.at.x - (p.at.x / d) * 1.1, 0, p.at.z - (p.at.z / d) * 1.1);
      // ARRIVAL IS MEASURED AGAINST WHERE YOU WERE WALKING, not against the thing: the body stops a step
      // short of it on purpose, so testing the prop's own position meant arriving never happened.
      errand.current = { prop, at: Date.now(), to };
      goal.current = to;
      void me;
      light(`prop:${prop}`);
      return true;
    };
    const toDoor = (room: string): boolean => {
      const door = doors.current.get(room);
      const me = viewRef.current.you ? bodies.current.get(viewRef.current.you.role) : null;
      if (!door || !me || goingTo.current) return false;
      goingTo.current = { room, at: Date.now() };
      goal.current = new pc.Vec3(door.at.x * 0.86, 0, door.at.z * 0.86);
      void me;
      light(`door:${room}`);
      return true;
    };
    /**
     * GO AND LOOK AT SOMEBODY (2026-09-15). Pressing a name in "everyone here tonight" turns the camera on
     * that person where they stand, and on a victim where they FELL — which is the one view in a murder
     * mystery worth having, because how a body is lying is half of what a detective has to go on. Somebody in
     * another room cannot be shown from this one; the page says so rather than the camera swinging at nothing.
     */
    const lookAtPerson = (role: string): boolean => {
      const b = bodies.current.get(role);
      if (!b) return false;
      const head = b.bone('head');
      const at = head ? head.getPosition().clone() : new pc.Vec3(b.pos.x, 1.3, b.pos.z);
      focus.current = { at, until: Date.now() + 9000, tight: true };
      return true;
    };
    lookAtRef.current = lookAtPerson;
    walkers.current = { toProp, toDoor };
    // the walk scripts read the venue through this, the way they read the lounge; nothing in the app does
    (window as unknown as { __venue?: unknown }).__venue = { bodies, doors, props, camera, goal, goingTo, pc };

    a.mouse!.on(pc.EVENT_MOUSEDOWN, (e: pc.MouseEvent) => {
      focus.current = null; // looking at something else is letting go of this one
      if (e.button !== pc.MOUSEBUTTON_LEFT) return;
      const hit = pick(e.x, e.y, camera);
      if (!hit) {
        // A CLICK ON THE FLOOR IS A PLACE TO GO, exactly as in the card room's lounge.
        const from = camera.camera!.screenToWorld(e.x, e.y, camera.camera!.nearClip);
        const to = camera.camera!.screenToWorld(e.x, e.y, camera.camera!.farClip);
        const floor = new pc.Vec3();
        if (new pc.Plane(pc.Vec3.UP, 0).intersectsRay(new pc.Ray(from, to.sub(from).normalize()), floor)) {
          const plan = BELVEDERE_PLAN[viewRef.current.room?.id ?? ''];
          if (plan && Math.abs(floor.x) < plan.w && Math.abs(floor.z) < plan.d) { errand.current = null; goingTo.current = null; goal.current = new pc.Vec3(floor.x, 0, floor.z); }
        }
        return;
      }
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
    /**
     * YOUR OWN BODY IS WALKED, NOT EASED. `ParticipantAvatar` in `direct` mode expects its controller to move
     * it — that is how the card room's lounge walks — and the venue was setting a target nothing read, so
     * pressing "examine the register" moved the STATE and left the body standing. Everybody else's body is
     * `follow` and eases to where the staging says they are.
     */
    const stride = (dt: number): void => {
      const v = viewRef.current;
      const me = v.you ? bodies.current.get(v.you.role) : null;
      if (!me) return;
      const plan = BELVEDERE_PLAN[v.room?.id ?? ''];
      const k = keys.current;
      let dx = 0; let dz = 0;
      if (k.has('up')) dz += 1; if (k.has('down')) dz -= 1; if (k.has('left')) dx -= 1; if (k.has('right')) dx += 1;
      if (dx || dz) {
        goal.current = null; focus.current = null; // walking is looking up from what you were reading
        const len = Math.hypot(dx, dz); dx /= len; dz /= len;
        const cp = camera.getPosition();
        const heading = Math.atan2(cp.x - me.pos.x, cp.z - me.pos.z) + Math.PI;
        const fx = Math.sin(heading) * dz + Math.cos(heading) * dx;
        const fz = Math.cos(heading) * dz - Math.sin(heading) * dx;
        me.pos.x += fx * WALK_SPEED * dt; me.pos.z += fz * WALK_SPEED * dt;
        me.face(Math.atan2(fx, fz));
      } else if (goal.current) {
        const d = new pc.Vec3().sub2(goal.current, me.pos); d.y = 0;
        if (d.length() < 0.12) goal.current = null;
        else { d.normalize(); me.pos.x += d.x * WALK_SPEED * dt; me.pos.z += d.z * WALK_SPEED * dt; me.face(Math.atan2(d.x, d.z)); }
      } else return;
      // inside the walls, whatever was asked
      if (plan) { me.pos.x = Math.max(-plan.w + 0.6, Math.min(plan.w - 0.6, me.pos.x)); me.pos.z = Math.max(-plan.d + 0.6, Math.min(plan.d - 0.6, me.pos.z)); }
      me.moved();
    };

    a.on('update', (dt: number) => {
      // LOOKING INTO THE ROOM, NOT AT THE FLOOR: back from the near wall and well above head height, aimed at
      // the middle of it — the arrival view the card room's lounge had to learn too.
      // A BIG ROOM NEEDS MORE ROOM: the lobby is sixteen metres across and a guest floor is twelve, and one
      // fixed distance puts the camera inside the furniture of the small one and across the hall from the big.
      const cc = camCtl.current;
      const size = roomSize.current;
      const dist = (size * 0.62 + 2.2) * cc.zoom;
      const f = focus.current && focus.current.until > Date.now() ? focus.current : (focus.current = null);
      if (f) {
        // OVER YOUR SHOULDER AT THE THING: stand the camera behind where your body is, low, and frame the
        // object rather than the room. The eased move is what makes it read as leaning in to look.
        // OVER YOUR SHOULDER AND A STEP TO THE SIDE, so your own back is not the thing in frame, and above the
        // object looking slightly down at it — which is how a person actually leans over a desk to read it.
        const meNow = viewRef.current.you ? bodies.current.get(viewRef.current.you.role) : null;
        const from = meNow ? meNow.pos : new pc.Vec3(0, 0, -2.2);
        const bx = f.at.x - from.x, bz = f.at.z - from.z;
        const len = Math.max(0.3, Math.hypot(bx, bz));
        const ux = bx / len, uz = bz / len;
        const back = f.tight ? 2.1 : 1.35, side = f.tight ? 1.35 : 0.85, up = f.tight ? 0.5 : 0.72;
        const want = new pc.Vec3(f.at.x - ux * back - uz * side, f.at.y + up, f.at.z - uz * back + ux * side);
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), want, Math.min(1, dt * 2.6)));
        camera.lookAt(f.at.x, f.at.y, f.at.z);
      } else {
        // HEIGHT RIDES THE PITCH: all the way up is over the room looking down, all the way down is at the
        // height of the people in it. The distance shortens as it climbs, or a high camera drifts out of the
        // room entirely and looks at the roof of it from the next valley.
        const climb = cc.pitch / 0.75;
        const high = 1.9 + size * (0.35 + climb * 1.25);
        const back = dist * (1 - climb * 0.42);
        const x = Math.sin(cc.yaw) * back;
        const z = -Math.cos(cc.yaw) * back;
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), new pc.Vec3(x, high, z - size * 0.1), Math.min(1, dt * 3)));
        camera.lookAt(0, 0.6, 0);
      }
      stride(dt);
      for (const [role, b] of bodies.current) { b.talking(speakingRef.current === role); b.update(dt); }
      /**
       * A WALK ENDS WHEN THE BODY ARRIVES, not when a stopwatch says so. Timing it meant the act fired while
       * the body was still crossing the room — which looks exactly like the teleport this was built to
       * replace. The deadline stays as a backstop, because a body that cannot reach its goal must not strand
       * the player in a room they asked to leave.
       */
      const me = viewRef.current.you ? bodies.current.get(viewRef.current.you.role) : null;
      const near = (t: pc.Vec3): boolean => !!me && Math.hypot(me.pos.x - t.x, me.pos.z - t.z) < 0.9;
      const err = errand.current;
      if (err && (near(err.to) || Date.now() - err.at > 6000)) {
        errand.current = null;
        const p = props.current.get(err.prop);
        // AIM AT THE OBJECT, NOT AT ITS SPOT ON THE FLOOR. The register sits on a desk and the skis stand on a
        // rack; framing the floor beneath them put the camera under the desk looking at its underside.
        if (p) {
          const eye = new pc.Vec3(p.at.x, 0.8, p.at.z);
          if (p.entity) {
            const box = new pc.BoundingBox(); let first = true;
            for (const r of p.entity.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) { if (first) { box.copy(mi.aabb); first = false; } else box.add(mi.aabb); }
            if (!first) eye.copy(box.center);
          }
          focus.current = { at: eye, until: Date.now() + 7000 };
        }
        actRef.current({ type: 'examine', prop: err.prop });
      }
      const going = goingTo.current;
      // THE DOOR YOU ARE WALKING TO OPENS AS YOU REACH IT, and every other door closes. It starts swinging a
      // couple of metres out so it is open by the time you are in the frame, rather than snapping at the last step.
      for (const [id, d] of doors.current) {
        if (!d.leaf) continue;
        const want = going?.room === id && me && Math.hypot(me.pos.x - d.at.x, me.pos.z - d.at.z) < 2.4 ? 1 : 0;
        if (Math.abs(want - d.swing) < 0.002 && d.swing === want) continue;
        d.swing += (want - d.swing) * Math.min(1, dt * 4.5);
        if (Math.abs(want - d.swing) < 0.01) d.swing = want;
        d.leaf.setLocalEulerAngles(0, -80 * d.swing, 0);
      }
      if (going) {
        const d = doors.current.get(going.room);
        // …and you go through it once it IS open. The backstop still fires for a body that cannot get there.
        if (!d || (near(d.at) && d.swing > 0.8) || Date.now() - going.at > 6000) {
          goingTo.current = null;
          cameFrom.current = viewRef.current.room?.id ?? null;
          actRef.current({ type: 'move', room: going.room });
        }
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
      /**
       * WALKING IN HAPPENS HERE, with the doors, because the doors have only just been built. Putting it in
       * the people effect raced the scene: that effect can run before the room exists, and a door you cannot
       * look up is a door you cannot come through.
       */
      const mine = viewRef.current.you ? bodies.current.get(viewRef.current.you.role) : null;
      if (mine && arrived.current !== roomId) {
        const back = cameFrom.current ? doors.current.get(cameFrom.current) : null;
        mine.stand();
        if (back) { mine.place(back.at.x * 0.85, back.at.z * 0.85, Math.atan2(-back.at.x, -back.at.z)); goal.current = new pc.Vec3(0, 0, -2.2); }
        else mine.place(0, -2.2, 0);
      }
      arrived.current = roomId;
    });
    return () => { cancelled = true; };
  }, [roomId]);

  // ── the people in it ──
  useEffect(() => {
    const a = app.current;
    const lib = library.current;
    const plan = BELVEDERE_PLAN[roomId];
    if (!a || !lib || !plan) return;
    /**
     * THE VICTIM IS IN THE ROOM THEY DIED IN (2026-09-15).
     *
     * `room.death` says a death happened here and whose it was; the dead are not in `room.people`, so without
     * this the ski room was a room with a line of text about a body in it. The body is drawn where the PLAN
     * says a body lies in this room — the foot of the racks, the turn of the corridor — in the pose its own
     * death clip ends in, and it is never walked or turned again.
     */
    const victim = view.room?.death?.victim ?? null;
    const here = [...(view.room?.people ?? []).map((p) => p.role), ...(view.you ? [view.you.role] : [])];
    if (victim && !here.includes(victim)) here.push(victim);
    const seen = new Set(here);
    here.forEach((role, i) => {
      const gone = role === victim;
      const lies = plan.deathAt ?? { x: 0, z: 0, yaw: 0 };
      const spot: [number, number] = gone ? [lies.x, lies.z] : plan.spots[i % plan.spots.length]!;
      const mine = role === view.you?.role && !gone;
      let b = bodies.current.get(role);
      if (!b) {
        // WHAT THE PART WEARS is the title's choice; a hash of the name is what it was before, and it dressed
        // the chef in the heiress's plum.
        /**
         * A CAST OF MANY AGES, TONES AND BUILDS OUT OF TWO BODIES (2026-09-15).
         *
         * The title already authors four colours per part for the portraits — skin, hair, what they wear and
         * an accent — and the bodies the room ships name their materials by what they are. So the same four
         * colours dress the body: the doctor's grey hair makes him the age the part says, the cast's skin
         * tones are the ones the title chose rather than one borrowed from a single model, and a chef is not
         * in the heiress's plum. `figure` says which body plays them, and the title says it — nothing is
         * inferred from a name. The outfit WORD stays as the fallback for a part that names no colours.
         */
        const look = view.cast.find((c) => c.role === role)?.look;
        const wears = look?.body && BODIES.includes(look.body) ? look.body : BODIES[Math.abs(hash(role)) % BODIES.length]!;
        b = new ParticipantAvatar(lib, wears, mine ? 'direct' : 'follow', look?.figure === 'f' ? 'f' : 'm',
          look ? { skin: look.skin, hair: look.hair, wear: look.wear, accent: look.accent } : undefined);
        a.root.addChild(b.entity);
        /**
         * YOU COME IN THROUGH THE DOOR YOU CAME THROUGH. Standing somebody in the middle of a room they have
         * just walked into is the teleport this was built to stop: your body is PLACED at the door back to
         * the room you left, and walks from there to where it stands. Arriving at the start of the night, or
         * from nowhere in particular, you are simply by the camera.
         */
        const back = mine && cameFrom.current ? doors.current.get(cameFrom.current) : null;
        if (back) { b.place(back.at.x * 0.85, back.at.z * 0.85, Math.atan2(-back.at.x, -back.at.z)); goal.current = new pc.Vec3(0, 0, -2.2); }
        else if (gone) b.place(spot[0], spot[1], ((lies.yaw ?? 0) * Math.PI) / 180);
        else b.place(mine ? 0 : spot[0], mine ? -2.2 : spot[1], mine ? 0 : Math.atan2(-spot[0], -spot[1]));
        bodies.current.set(role, b);
      } else if (gone) {
        b.place(spot[0], spot[1], ((lies.yaw ?? 0) * Math.PI) / 180);
      } else if (!mine) {
        b.stand();
        b.walkTo(spot[0], spot[1], Math.atan2(-spot[0], -spot[1]));
      }
      b.dead(gone);
      // YOUR OWN BODY SURVIVES THE ROOM CHANGE and is walked in by the room's own effect, where the doors are.
    });
    for (const [role, b] of [...bodies.current]) if (!seen.has(role)) { b.destroy(); bodies.current.delete(role); }
  }, [roomId, view.room?.people.map((p) => p.role).join(','), view.you?.role, view.room?.death?.victim]);

  // The page's own controls walk the same walk the picture does.
  useImperativeHandle(ref, () => ({
    approach: (prop: string) => walkers.current?.toProp(prop) ?? false,
    goThrough: (room: string) => walkers.current?.toDoor(room) ?? false,
    lookAt: (role: string) => lookAtRef.current?.(role) ?? false,
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
  doorMap: Map<string, { at: pc.Vec3; frame: pc.Entity | null; leaf: pc.Entity | null; swing: number }>, view: MysteryView,
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
      // THE SHAPE THE PLAN ASKED FOR, at the height it asked for, at the angle it asked for. Every primitive
      // used to be a box standing on the floor, whatever the plan said — which is why a ledger could not lie
      // open on a desk and a ski could not lean on a rack.
      entity = prim(t.prim.shape ?? 'box', m, [t.x, t.y ?? t.prim.size[1] / 2, t.z], t.prim.size, t.yaw ?? 0);
      if (t.tilt || t.lean) entity.setLocalEulerAngles(t.tilt ?? 0, t.yaw ?? 0, t.lean ?? 0);
      at = new pc.Vec3(t.x, 0, t.z);
    }
    if (!at) at = new pc.Vec3(t.x, 0, t.z);
    if (t.prop) { propMap.set(t.prop, { at, entity }); placed.add(t.prop); }
  }

  // the doorways: a piece in the wall, and a place to click
  for (const [to, [x, z]] of Object.entries(plan.doors)) {
    const yaw = Math.abs(x) > Math.abs(z) ? (x > 0 ? 90 : 270) : (z > 0 ? 180 : 0);
    const frame = kit.place('doorway', root, x, z, yaw, 1.1);
    /**
     * A DOOR THAT ACTUALLY OPENS (2026-09-15).
     *
     * The kit's own door panel is a separate node with its own pivot and hangs nowhere near the frame when
     * placed beside it — a two-metre door floating in the corner of the room — so for a while the doorway
     * merely LIT as you walked to it. A leaf built from a box costs nothing and is honest: it is hung on a
     * hinge at one edge of the opening, it swings as you reach it, and the staging is not asked to move you
     * until it is open. The opening is MEASURED from the frame that is actually there rather than guessed,
     * so a different kit or an authored frame still gets a leaf that fits it.
     */
    let w = 0.86, h = 1.98;
    if (frame) {
      const box = new pc.BoundingBox(); let first = true;
      for (const r of frame.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) { if (first) { box.copy(mi.aabb); first = false; } else box.add(mi.aabb); }
      if (!first) {
        const across = Math.abs(Math.sin((yaw * Math.PI) / 180)) > 0.5 ? box.halfExtents.z : box.halfExtents.x;
        w = Math.min(1.1, Math.max(0.62, across * 2 * 0.8));
        h = Math.min(2.2, Math.max(1.7, (box.center.y + box.halfExtents.y) * 0.92));
      }
    }
    const hinge = new pc.Entity(`door:${to}`);
    hinge.setLocalPosition(x, 0, z); hinge.setLocalEulerAngles(0, yaw, 0);
    const pivot = new pc.Entity('hinge');       // at one edge of the opening; THIS is what turns
    pivot.setLocalPosition(-w / 2, 0, 0);
    const leaf = prim('box', mat('#6b4a32'), [w / 2, h / 2, 0], [w, h, 0.055]);
    const knob = prim('cylinder', mat('#b99a4a'), [w - 0.1, h * 0.47, 0.055], [0.055, 0.03, 0.055]);
    knob.setLocalEulerAngles(90, 0, 0);
    pivot.addChild(leaf); pivot.addChild(knob);
    hinge.addChild(pivot); root.addChild(hinge);
    doorMap.set(to, { at: new pc.Vec3(x * 0.92, 0, z * 0.92), frame, leaf: pivot, swing: 0 });
  }
}
