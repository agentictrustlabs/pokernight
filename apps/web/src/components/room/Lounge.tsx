import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pc from 'playcanvas';
import type { RoomManifest, RoomPerson } from '@pokernight/protocol';
import type { TableView } from '../../lib/types';
import type { RoomSocket, RoomState } from '../../lib/roomSocket';
import { Portrait } from '../huddle/Portrait';
import { AvatarLibrary, ParticipantAvatar, RoomKit, type Seat } from './embodiment';
import { isSpeaking } from './speaking';
import { BAR_SEATS, FIRE_SEATS as FIRE_SEAT_COUNT, barSeat, firesideSeat, isAtPlace, nearestSeatOf, type SeatSpot } from '../../lib/roomSeats';
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
const HOLE_R = 1.05; // a seat's own cards, from the centre — far enough in that a big card never laps the rail
/** The table id the room uses to mean "a stool at the bar" rather than a seat at a table. */
export const BAR = 'bar';
/** …and "a chair by the fire", where the guest is met. */
export const FIRE = 'fire';
const FIRE_SEATS = 6;
const FIRE_R = 2.6; // how far the ring of chairs sits from the hearth
const SEAT_PICK_PX = 110; // how near the POINTER must be, on screen, for a seat to be the one you mean
const CHAIR_PICK = 1.5; // how near a click or the pointer must be to a chair to mean that chair
/** Inside the walls, which stand at ±11: a click beyond this is the wall, not a destination. */
const WALKABLE = 9.6;
const TABLE_SOLID = 1.72; // a walking body cannot come nearer the centre than this (just inside CHAIR_R)
const CHAIR_BACK = 0.32; // the seated hips sit this far behind the feet (measured on the seated clip), so the chair does too
const deckSide = new pc.StandardMaterial();
const chairLit = new pc.StandardMaterial();
const hatFelt = new pc.StandardMaterial();
const hatBand = new pc.StandardMaterial();
const shirtLinen = new pc.StandardMaterial();
/**
 * WHICH FIGURE A BODY IS, in a room where nobody has chosen one yet.
 *
 * A person's own avatar record (`cardroom.avatar`, spec §3.5) is the real answer and is not built; until it
 * is, the estate's OWN demo people are known by name — they are this deployment's fixtures, not strangers —
 * and everybody else gets a figure from the same hash that gives them an outfit, so a room has a mix rather
 * than eight copies of one build. Nothing here infers anything about a person from their name in general:
 * the list is a fixture table, and a chosen avatar will supersede it the day there is one.
 */
const wordHash = (s: string): number => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const ESTATE_FIGURES: Record<string, 'm' | 'f'> = { alice: 'f', carol: 'f', elena: 'f', bob: 'm', dave: 'm', david: 'm', nathan: 'm' };
function figureOf(name: string, playerId: string): 'm' | 'f' {
  // "bob", "Bob Demo" and "bob.me" are one person as far as the fixture is concerned: the first run of letters.
  const first = (name ?? '').trim().toLowerCase().match(/^[a-z]+/)?.[0] ?? '';
  const known = ESTATE_FIGURES[first];
  if (known) return known;
  return wordHash(`${playerId}:figure`) % 2 === 0 ? 'f' : 'm';
}

const CHAIR_PIECE = 'loungeChair'; // the fireside's armchairs — deep, and right for a hearth
const chairWood = new pc.StandardMaterial();
const chairHide = new pc.StandardMaterial();
const chairStud = new pc.StandardMaterial();

/**
 * THE CHAIR AT A POKER TABLE, BUILT RATHER THAN BOUGHT.
 *
 * The furniture kit's armchair is a good sofa-side chair and a poor card-room one: at the felt it reads as a
 * beige block the size of the player in it, and eight of them swallow the table. A card table takes a slim
 * upholstered dining chair — four turned legs, a padded seat, a tall buttoned back tipped a couple of degrees
 * — and at this scale a dozen primitives with the right PROPORTIONS look better than a bought mesh with the
 * wrong ones. It costs nothing to download and every dimension is ours to tune.
 */
function pokerChair(parent: pc.Entity, x: number, z: number, yawDeg: number): pc.Entity {
  const pivot = new pc.Entity('chair');
  pivot.setLocalPosition(x, 0, z);
  pivot.setLocalEulerAngles(0, yawDeg, 0);
  parent.addChild(pivot);
  const part = (name: string, material: pc.StandardMaterial, pos: [number, number, number], scale: [number, number, number], pitch = 0): void => {
    const e = new pc.Entity(name);
    e.addComponent('render', { type: 'box', material, castShadows: true, receiveShadows: true });
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    e.setLocalScale(scale[0], scale[1], scale[2]);
    if (pitch) e.setLocalEulerAngles(pitch, 0, 0);
    pivot.addChild(e);
  };
  const LEG = 0.055;
  for (const [lx, lz] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]] as const) part('leg', chairWood, [lx, 0.22, lz], [LEG, 0.44, LEG]);
  part('rail', chairWood, [0, 0.4, 0], [0.44, 0.045, 0.40]);
  part('seat', chairHide, [0, 0.455, 0], [0.42, 0.075, 0.38]);      // the cushion
  part('welt', chairWood, [0, 0.495, 0], [0.435, 0.018, 0.395]);    // the piping round it
  // the back: two posts, a padded panel between them, tipped back a little
  part('post', chairWood, [-0.2, 0.72, -0.18], [LEG, 0.62, LEG], -4);
  part('post', chairWood, [0.2, 0.72, -0.18], [LEG, 0.62, LEG], -4);
  part('panel', chairHide, [0, 0.74, -0.165], [0.37, 0.5, 0.06], -4);
  part('cap', chairWood, [0, 1.01, -0.187], [0.45, 0.05, 0.08], -4);
  for (const by of [0.63, 0.78, 0.93]) part('button', chairStud, [0, by, -0.132], [0.03, 0.03, 0.02], -4);
  return pivot;
}
const CHAIR_SCALE = 0.85; // the kit's chairs are 1.15 m with the pad at ~0.55; at 0.85 the pad meets the seated hips (~0.47)

export interface LoungeProps {
  socket: RoomSocket;
  state: RoomState;
  onZone?: (zone: string | null) => void;
  /** Your body has walked up to this chair and turned to it: the page takes the seat at the TABLE. */
  onSitRequest?: (tableId: string, seat: number) => void;
  /** A click on a TABLE or the FIRE or the BAR itself — "that place" — so the page can offer its seats. */
  onPick?: (place: { tableId: string; name: string } | null) => void;
  /** THE FELT (spec §3.4, step 5): the seated table's view, drawn on its table — cards, pot, whose turn. */
  board?: { tableId: string; view: TableView; names: Record<string, string>; lastHand?: { handNo: number; result?: { awards: Array<{ seat: number; amount: number }> } } | null } | null;
}
/** What the page can tell the lounge to do with your body. */
export interface LoungeHandle {
  /** Walk to this chair; `onSitRequest` fires on arrival. */
  walkToSeat: (tableId: string, seat: number) => boolean;
  /** Stand the body beside this chair, facing the table — where somebody who just stood up should be. */
  standBeside: (tableId: string, seat: number) => boolean;
}

interface BodyHandle { avatar: ParticipantAvatar; name: string }
interface Plate {
  id: string; kind: 'name' | 'table' | 'anchor' | 'bubble' | 'pot'; text: string; sub?: string; world: pc.Vec3; you?: boolean;
  /** whose face hangs on the plate, when the huddle has one */ face?: string;
  /** a name plate's own second line (the agent), kept so "to act" can come and go over it */ agentSub?: string;
  x?: number; y?: number; z?: number; visible?: boolean;
}

export const Lounge = forwardRef<LoungeHandle, LoungeProps>(function Lounge({ socket, state, onZone, onSitRequest, onPick, board }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const app = useRef<pc.Application | null>(null);
  const bodies = useRef(new Map<string, BodyHandle>());
  const scenery = useRef<pc.Entity | null>(null);
  const library = useRef<AvatarLibrary | null>(null);
  const kit = useRef<RoomKit | null>(null);
  /** The scenery's textures — one asset per URL for the life of the app, however often the scenery is rebuilt. */
  const textures = useRef(new Map<string, pc.Asset>());
  const deck = useRef<Deck3D | null>(null);
  const chips = useRef<Chips3D | null>(null);
  const felt = useRef<pc.Entity | null>(null);
  /** the count of chips each seat has already pushed toward the pot this street, so raising THROWS the new chips */
  const pushed = useRef<Map<number, number>>(new Map());
  /** THE DEALER at each table — a body standing at the ring's gap, whose hands the cards come from. */
  const dealers = useRef(new Map<string, { avatar: ParticipantAvatar; hand: pc.Vec3; deck: pc.Entity; hat: pc.Entity; dress: pc.Entity }>());
  /** cards in the air: from the dealer's hand to their place on the felt, one after another */
  const flights = useRef<Array<{ entity: pc.Entity; from: pc.Vec3; to: pc.Vec3; yawFrom: number; yawTo: number; t: number; delay: number; tilt?: number }>>([]);
  /** which cards were already on the felt last time, so only the NEW ones are dealt (keyed by hand) */
  const dealt = useRef<{ handNo: number; ids: Set<string> }>({ handNo: -1, ids: new Set() });
  const feltSig = useRef('');
  const chipRoot = useRef<pc.Entity | null>(null);
  const chipSig = useRef('');
  const chipHand = useRef(-1);
  const sweptHand = useRef(-1);
  const sweepRoot = useRef<pc.Entity | null>(null);
  const chipFlights = useRef<Array<{ entity: pc.Entity; from: pc.Vec3; to: pc.Vec3; t: number; delay: number }>>([]);
  /** the camera is placed, not flown, the first time it has a body to follow */
  const camSettled = useRef(false);
  /** YOUR OWN LOOK: scroll zooms, right-drag orbits — offsets laid over the follow camera, seated or walking */
  const camCtl = useRef({ zoom: 1, yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0 });
  const [kitReady, setKitReady] = useState(false);
  const me = useRef<{ avatar: ParticipantAvatar; name: string; goal: pc.Vec3 | null; heading: { tableId: string; seat: number; yaw: number } | null } | null>(null);
  const onSitRef = useRef(onSitRequest); onSitRef.current = onSitRequest;
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  /** Who the pointer is over, if anybody — their name, what they are doing, and where to draw the card. */
  const [over, setOver] = useState<{ name: string; agent?: string; doing: string; said?: string; x: number; y: number } | null>(null);
  const nodded = useRef<string | null>(null);
  /** where the acting player sits at your table (a head height point), for every seated body to look at */
  const actingRef = useRef<pc.Vec3 | null>(null);
  const actingPlayer = useRef<string | null>(null);
  /** a house bot's plate id by the player id its seat carries */
  const botPlate = useRef(new Map<string, string>());
  /** Every chair in the room, by table and seat, with whether somebody is in it — from the manifest. */
  const chairs = useRef<Array<{ tableId: string; seat: number; at: pc.Vec3; yaw: number; taken: boolean }>>([]);
  /** every chair's own entity, so the one somebody is walking to can change colour */
  const chairEntities = useRef(new Map<string, pc.Entity>());
  /** The bar's stools — seats too, but they lead to the guest rather than to a hand. */
  const barStoolEntities = useRef(new Map<string, pc.Entity>());
  const barSeats = useRef<Array<{ key: string; at: pc.Vec3; yaw: number }>>([]);
  /** The fireside's chairs — where the night's guest is met. */
  const fireChairEntities = useRef(new Map<string, pc.Entity>());
  const fireSeats = useRef<Array<{ key: string; at: pc.Vec3; yaw: number }>>([]);
  /** who each body is looking at, and since when — a gaze that is re-picked every frame is a twitch */
  const gazeAt = useRef(new WeakMap<ParticipantAvatar, { at: ParticipantAvatar | null; since: number }>());
  /** the chair currently lit, and the materials it had before */
  const litChair = useRef<{ key: string; restore: Array<[pc.MeshInstance, pc.Material]> } | null>(null);
  /** House bots in chairs — bodies for occupants no person in the room owns. */
  const bots = useRef(new Map<string, ParticipantAvatar>());
  const keys = useRef(new Set<string>());
  const [plates, setPlates] = useState<Plate[]>([]);
  const plateRef = useRef<Map<string, Plate>>(new Map());
  const manifestRef = useRef<RoomManifest | null>(null);
  /** WHO IS HERE, read from a handler that was built once. The scene's effect closes over the FIRST `state`
      it ever saw, so anything asking it about people got the room as it was the moment the canvas appeared. */
  const peopleRef = useRef(state.people); peopleRef.current = state.people;
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
    /**
     * LIGHT LIKE A ROOM, NOT A VOID (2026-09-15).
     *
     * A flat ambient colour lights every surface the same from every side, which is what made the kit's chairs
     * and the bodies read as toys however many polygons they had: nothing in the picture said where the light
     * came from. The ambient now comes from an IMAGE — a real billiard hall (Poly Haven, CC0), 256×128 of
     * RGBE at 131 KB, prefiltered on the GPU into the engine's environment atlas at load — so a body's shoulder
     * is warmer from the lamp side and the felt reflects a dim ceiling, and the camera tone-maps (ACES) so the
     * lamps can be bright without the felt clipping to white. The image is never SEEN as a sky: the room has a
     * ceiling, and the clear colour is only ever behind the walls. A flat ambient stays as a floor under it.
     */
    a.scene.ambientLight = new pc.Color(0.06, 0.065, 0.06);
    a.scene.fog.type = pc.FOG_LINEAR; a.scene.fog.color = new pc.Color(0.045, 0.04, 0.035); a.scene.fog.start = 22; a.scene.fog.end = 44;
    a.assets.loadFromUrl('/room/env.hdr', 'texture', (err, asset) => {
      if (err || !asset || !app.current) { if (err) console.warn('[room] no environment light:', err); return; }
      const source = asset.resource as pc.Texture;
      const lighting = pc.EnvLighting.generateLightingSource(source);
      a.scene.envAtlas = pc.EnvLighting.generateAtlas(lighting);
      lighting.destroy();
      a.scene.skyboxIntensity = 0.85;
    });

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.045, 0.04, 0.035), fov: 50, nearClip: 0.1, farClip: 80, toneMapping: pc.TONEMAP_ACES });
    camera.setPosition(0, 6, -14);
    a.root.addChild(camera);

    const sun = new pc.Entity('sun');
    // SHADOWS THAT DO NOT SPECKLE THE FELT: the table and the cards are flat receivers, and a 1024 map over 30 m
    // (~3 cm a texel, hard-filtered) put a grain of shadow acne over every flat thing while the curved bodies looked
    // fine. A 2048 map over 22 m with 5-tap PCF and a little more bias is smooth on both; the cards receive none.
    sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.96, 0.88), intensity: 0.95, castShadows: true, shadowType: pc.SHADOW_PCF5_32F, shadowBias: 0.3, normalOffsetBias: 0.08, shadowResolution: 2048, shadowDistance: 22 });
    sun.setEulerAngles(55, 30, 0);
    a.root.addChild(sun);
    /**
     * WHAT FLATTERS A LOW-POLY BODY IS LIGHT, not polygons.
     *
     * One overhead key leaves a figure flat-shaded and reads as a toy: the silhouette is all you see.
     * A cool fill from the opposite side puts a second value on every surface, and a rim from behind lifts
     * the head and shoulders off the felt — the two cheapest things in rendering, and the ones that make a
     * four-thousand-triangle person look like a person. (A higher-fidelity BODY is an asset swap, not code:
     * `scripts/check-body.mjs` says whether the room will take one.)
     */
    const fill = new pc.Entity('fill');
    fill.addComponent('light', { type: 'directional', color: new pc.Color(0.62, 0.74, 0.86), intensity: 0.5, castShadows: false });
    fill.setEulerAngles(28, -140, 0);
    a.root.addChild(fill);
    const rim = new pc.Entity('rim');
    rim.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.93, 0.8), intensity: 0.75, castShadows: false });
    rim.setEulerAngles(12, 195, 0);
    a.root.addChild(rim);

    let plateClock = 0;
    // `framerender` carries no dt; the main update loop hands it over (see the layering note below)
    let lastDt = 1 / 60;
    // walking, clicking, the follow camera — every frame
    a.keyboard!.on(pc.EVENT_KEYDOWN, (e: pc.KeyboardEvent) => { const k = keyOf(e.key ?? -1); if (k) { keys.current.add(k); if (me.current) me.current.goal = null; e.event?.preventDefault(); } });
    a.keyboard!.on(pc.EVENT_KEYUP, (e: pc.KeyboardEvent) => { const k = keyOf(e.key ?? -1); if (k) keys.current.delete(k); });
    /**
     * THE ORBIT DRAG IS A CAPTURED POINTER, not a stream of mouse events.
     *
     * Right-dragging past the edge of the canvas used to let go of the drag and hand the browser its own
     * context menu, in the middle of looking around. Capturing the pointer keeps every move and the release
     * with the canvas wherever the cursor goes, and the menu is suppressed at the WINDOW while a drag is live —
     * suppressing it on the canvas alone never sees the press that happened outside it.
     */
    const noMenu = (e: Event) => { if (camCtl.current.dragging) e.preventDefault(); };
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', noMenu);
    const onDown = (e: PointerEvent) => {
      if (e.button !== 2 && e.button !== 1) return;
      e.preventDefault();
      camCtl.current.dragging = true;
      try { c.setPointerCapture(e.pointerId); } catch { /* the window listener still holds the menu off */ }
    };
    const onMove = (e: PointerEvent) => {
      const k = camCtl.current;
      // SELF-HEALING: a drag that ended outside the window never sends a pointerup, so the flag stuck true and
      // every hover after it was swallowed — "at some point I cannot hover over seats any more". No buttons
      // held means no drag, whatever we last believed.
      if (k.dragging && e.buttons === 0) { k.dragging = false; return; }
      if (!k.dragging) return;
      k.yaw -= e.movementX * 0.006;
      k.pitch = Math.max(-0.22, Math.min(0.6, k.pitch + e.movementY * 0.004));
    };
    const onUp = (e: PointerEvent) => {
      if (!camCtl.current.dragging) return;
      camCtl.current.dragging = false;
      try { c.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };
    const dropDrag = () => { camCtl.current.dragging = false; };
    window.addEventListener('blur', dropDrag);
    c.addEventListener('pointerleave', (e) => { if ((e as PointerEvent).buttons === 0) dropDrag(); });
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    window.addEventListener('pointerup', onUp);
    // ZOOM AND TILT ARE BOUNDED. Wound all the way in and down, the camera ended up inside the body at floor
    // level: you could not see the room, could not tell where you were pointing, and could not walk anywhere.
    c.addEventListener('wheel', (e) => { e.preventDefault(); const k = camCtl.current; k.zoom = Math.max(0.7, Math.min(2.2, k.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); }, { passive: false });
    a.mouse!.on(pc.EVENT_MOUSEMOVE, (e: pc.MouseEvent) => {
      if (camCtl.current.dragging) return;
      // THE CHAIR UNDER THE POINTER LIGHTS UP, so picking one is aiming at a thing rather than guessing at a spot.
      if (!me.current || me.current.avatar.seated) return;
      if (me.current.heading && me.current.goal) return; // mid-walk to a chosen chair: leave that one lit
      const hit = floorAt(camera, e.x, e.y);
      const seat = pickSeat(e.x, e.y, hit);
      lightChair(seat ? seat.key : null);
      // AND WHO IS UNDER THE POINTER. Names hang over heads at a distance and vanish in a crowd; looking at
      // somebody should tell you who they are, and they should look back.
      const out2 = new pc.Vec3();
      let near: { id: string; b: BodyHandle; d: number } | null = null;
      for (const [id, b] of bodies.current) {
        camera.camera!.worldToScreen(new pc.Vec3(b.avatar.pos.x, 1.2, b.avatar.pos.z), out2);
        if (out2.z <= 0) continue;
        const d = Math.hypot(out2.x - e.x, out2.y - e.y);
        if (d < 70 && (!near || d < near.d)) near = { id, b, d };
      }
      if (!near) { setOver(null); nodded.current = null; return; }
      const p2 = peopleRef.current.get(near.id);
      const manifest2 = manifestRef.current;
      const table2 = p2?.seatedAt ? manifest2?.tables.find((t2) => t2.tableId === p2.seatedAt!.tableId) : null;
      const doing = table2 ? `sitting at ${table2.name}` : p2 && isAtPlace(manifest2?.anchors.fire, p2.x, p2.y) ? 'by the fire' : p2 && isAtPlace(manifest2?.anchors.bar, p2.x, p2.y) ? 'at the bar' : 'in the room';
      camera.camera!.worldToScreen(new pc.Vec3(near.b.avatar.pos.x, 1.25, near.b.avatar.pos.z), out2);
      setOver({ name: near.b.name, ...(p2?.agent && p2.agent.includes('.') ? { agent: p2.agent } : {}), doing, ...(p2?.said && Date.now() - p2.said.at < 20000 ? { said: p2.said.text } : {}), x: out2.x, y: out2.y });
      // they nod back, once per approach
      if (nodded.current !== near.id) { nodded.current = near.id; near.b.avatar.nod(); }
    });
    /** Where on the floor a screen point lands, or null when it points at the sky. */
    const floorAt = (cam: pc.Entity, sx: number, sy: number): pc.Vec3 | null => {
      const from = cam.camera!.screenToWorld(sx, sy, cam.camera!.nearClip);
      const to = cam.camera!.screenToWorld(sx, sy, cam.camera!.farClip);
      const ray = new pc.Ray(from, to.sub(from).normalize());
      const hit = new pc.Vec3();
      return new pc.Plane(pc.Vec3.UP, 0).intersectsRay(ray, hit) ? hit : null;
    };
    /**
     * THE SEAT UNDER THE POINTER — picked ON SCREEN, not on the floor.
     *
     * Floor distance was the first attempt and it fails exactly where people use it: standing back from a
     * table, the point under the cursor is metres from any chair even though the chair is plainly what the
     * cursor is over, so nothing lit and nothing could be picked. Screen distance is what a person actually
     * means by "that one", and it works at any range. The floor is still the fallback, for a cursor over bare
     * carpet near a seat.
     */
    const pickSeat = (sx: number, sy: number, hit: pc.Vec3 | null): { key: string; at: pc.Vec3; yaw: number; tableId: string; seat: number } | null => {
      const out = new pc.Vec3();
      let best: { key: string; at: pc.Vec3; yaw: number; tableId: string; seat: number } | null = null;
      let bestPx = SEAT_PICK_PX;
      const consider = (key: string, at: pc.Vec3, yaw: number, tableId: string, seat: number) => {
        camera.camera!.worldToScreen(new pc.Vec3(at.x, 0.55, at.z), out);
        if (out.z <= 0) return; // behind the camera
        const d = Math.hypot(out.x - sx, out.y - sy);
        if (d < bestPx) { bestPx = d; best = { key, at, yaw, tableId, seat }; }
      };
      for (const ch of chairs.current) if (!ch.taken) consider(`${ch.tableId}:${ch.seat}`, ch.at, ch.yaw, ch.tableId, ch.seat);
      for (const st of barSeats.current) consider(st.key, st.at, st.yaw, BAR, Number(st.key.slice(4)));
      for (const st of fireSeats.current) consider(st.key, st.at, st.yaw, FIRE, Number(st.key.slice(5)));
      if (best || !hit) return best;
      let fd = CHAIR_PICK;
      for (const ch of chairs.current) { if (ch.taken) continue; const d = Math.hypot(ch.at.x - hit.x, ch.at.z - hit.z); if (d < fd) { fd = d; best = { key: `${ch.tableId}:${ch.seat}`, at: ch.at, yaw: ch.yaw, tableId: ch.tableId, seat: ch.seat }; } }
      for (const st of barSeats.current) { const d = Math.hypot(st.at.x - hit.x, st.at.z - hit.z); if (d < fd) { fd = d; best = { key: st.key, at: st.at, yaw: st.yaw, tableId: BAR, seat: Number(st.key.slice(4)) }; } }
      for (const st of fireSeats.current) { const d = Math.hypot(st.at.x - hit.x, st.at.z - hit.z); if (d < fd) { fd = d; best = { key: st.key, at: st.at, yaw: st.yaw, tableId: FIRE, seat: Number(st.key.slice(5)) }; } }
      return best;
    };
    /** The PLACE under a click on the floor: a table's top, the hearth, the bar — each is picked by the area it owns. */
    const pickPlace = (hit: pc.Vec3 | null): { tableId: string; name: string } | null => {
      const mf = manifestRef.current;
      if (!hit || !mf) return null;
      for (const t of mf.tables) {
        const an = mf.anchors[t.anchor]; if (!an) continue;
        if (Math.hypot(hit.x - an.x, hit.z - an.y) < TABLE_SOLID) return { tableId: t.tableId, name: t.name };
      }
      const f = mf.anchors.fire;
      if (f && Math.hypot(hit.x - f.x, hit.z - f.y) < 1.6) return { tableId: FIRE, name: 'the fireside' };
      const bp = mf.anchors.bar;
      if (bp && Math.hypot(hit.x - bp.x, hit.z - bp.y) < 1.6) return { tableId: BAR, name: 'the bar' };
      return null;
    };
    a.mouse!.on(pc.EVENT_MOUSEDOWN, (e: pc.MouseEvent) => {
      if (e.button === pc.MOUSEBUTTON_RIGHT || e.button === pc.MOUSEBUTTON_MIDDLE) return; // the captured pointer drag owns these
      if (!me.current || e.button !== pc.MOUSEBUTTON_LEFT) return;
      const from = camera.camera!.screenToWorld(e.x, e.y, camera.camera!.nearClip);
      const to = camera.camera!.screenToWorld(e.x, e.y, camera.camera!.farClip);
      const ray = new pc.Ray(from, to.sub(from).normalize());
      const hit = new pc.Vec3();
      if (!new pc.Plane(pc.Vec3.UP, 0).intersectsRay(ray, hit)) return;
      // A CLICK NEAR A FREE CHAIR is "sit there": walk to it and, on arrival, ask the table for the seat.
      // THE FURNITURE WINS INSIDE ITS OWN FOOTPRINT. A click on a TABLE, THE FIRE or THE BAR is "that place" —
      // the page puts its free seats along the bottom of the screen — and a chair is only picked out on the
      // floor around it. Screen-space seat picking reaches 110 px, which from across the room covers the whole
      // table top, so without this a click on the felt walked you to whichever chair happened to be nearest.
      const place = pickPlace(hit);
      const seat = place ? null : pickSeat(e.x, e.y, hit);
      if (place) { onPickRef.current?.(place); me.current.heading = null; me.current.goal = null; lightChair(null); }
      else if (seat && !me.current.avatar.seated) { me.current.goal = seat.at.clone(); me.current.heading = { tableId: seat.tableId, seat: seat.seat, yaw: seat.yaw }; lightChair(seat.key); onPickRef.current?.(null); }
      // A CLICK ON THE WALL IS NOT A PLACE TO GO. The floor plane runs on past the walls forever, so a click
      // anywhere above the skirting landed metres outside the room and the body set off to stand in it.
      else if (Math.abs(hit.x) > WALKABLE || Math.abs(hit.z) > WALKABLE) { me.current.heading = null; lightChair(null); }
      else { me.current.goal = new pc.Vec3(hit.x, 0, hit.z); me.current.heading = null; lightChair(null); }
    });
    a.on('update', (dt: number) => {
      lastDt = dt;
      const m = me.current;
      if (m && m.avatar.seated) {
        // in the chair: the body is where the seat is; the camera looks over its right shoulder, above the chair
        // back, down at the felt — the table is what a seated person looks at
        m.avatar.update(dt);
        const p = m.avatar.pos; const cc = camCtl.current; const yaw = m.avatar.yaw + cc.yaw;
        const dist = 2.6 * cc.zoom, up = (3.9 + cc.pitch * 3) * cc.zoom;
        const behind = new pc.Vec3(p.x - Math.sin(yaw) * dist + Math.cos(yaw) * 0.3, Math.max(1.2, up), p.z - Math.cos(yaw) * dist - Math.sin(yaw) * 0.3);
        // arriving already in the chair, the camera is simply there — no swoop down from the door over the felt
        if (!camSettled.current) { camera.setPosition(behind); camSettled.current = true; }
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        // at the far rail, so the people across the felt and their names sit in the upper third of the frame
        camera.lookAt(p.x + Math.sin(m.avatar.yaw) * 2.4, 0.9, p.z + Math.cos(m.avatar.yaw) * 2.4);
      } else if (m) {
        const av = m.avatar; const pos = av.pos;
        let dx = 0, dz = 0;
        const k = keys.current;
        if (k.has('up')) dz += 1; if (k.has('down')) dz -= 1; if (k.has('left')) dx -= 1; if (k.has('right')) dx += 1;
        let moved = false;
        if (dx || dz) {
          if (m.heading) lightChair(null);
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
        // A PERSON'S OWN VIEW OF THE ROOM. The camera used to sit 4.2 m up and stare at the body, so walking in
        // meant looking down at the floor: you could not see the room you had just entered, or who was in it.
        // Just over the shoulder at head height, aimed ACROSS the room, shows the place instead of the carpet.
        // LOOKING AT THE ROOM, slightly down: high enough to see the floor, the tables and who is at them, low
        // enough that it is still a person's view and not a map. Bounded below so a wound-in zoom cannot put the
        // camera at table level, where you lose the room and cannot tell where you are pointing.
        const cc = camCtl.current; const cy = av.yaw + cc.yaw; const dist = 4.2 * cc.zoom, up = Math.max(2.4, (3.3 + cc.pitch * 3.5) * cc.zoom);
        const behind = new pc.Vec3(Math.max(-10.5, Math.min(10.5, pos.x - Math.sin(cy) * dist)), up, Math.max(-10.5, Math.min(10.5, pos.z - Math.cos(cy) * dist)));
        if (!camSettled.current) { camera.setPosition(behind); camSettled.current = true; }
        camera.setPosition(camera.getPosition().lerp(camera.getPosition(), behind, Math.min(1, dt * 2.5)));
        camera.lookAt(pos.x + Math.sin(cy) * 3.8, 1.05, pos.z + Math.cos(cy) * 3.8);
      }
      if (m) m.avatar.talking(isSpeaking(m.name));
      // the others ease toward their last pose; mouths move for whoever the huddle hears
      for (const bt of bots.current.values()) bt.update(dt);
      for (const dl of dealers.current.values()) dl.avatar.update(dt);
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
      for (const f of chipFlights.current) { if (f.delay > 0) { f.delay -= dt; continue; } f.t = Math.min(1, f.t + dt / 0.55); const e = 1 - (1 - f.t) * (1 - f.t); const p = new pc.Vec3().lerp(f.from, f.to, e); p.y += Math.sin(e * Math.PI) * 0.28; f.entity.setLocalPosition(p); }
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
    chairLit.diffuse = new pc.Color(0.85, 0.66, 0.26); chairLit.emissive = new pc.Color(0.30, 0.22, 0.05); chairLit.update();
    // RED, not felt-black: a dark hat on a dark body is another player from across the room. The dealer is the
    // one person you must be able to find at a glance, so the hat is the loudest thing in the scene.
    hatFelt.diffuse = new pc.Color(0.78, 0.11, 0.11); hatFelt.emissive = new pc.Color(0.16, 0.01, 0.01); hatFelt.gloss = 0.35; hatFelt.update();
    hatBand.diffuse = new pc.Color(0.07, 0.08, 0.09); hatBand.update();
    // A CARD ROOM'S CHAIRS: dark walnut, oxblood hide, a brass stud. The felt is green; the chairs are not.
    chairWood.diffuse = new pc.Color(0.21, 0.13, 0.09); chairWood.gloss = 0.45; chairWood.metalness = 0; chairWood.update();
    chairHide.diffuse = new pc.Color(0.36, 0.13, 0.13); chairHide.gloss = 0.3; chairHide.update();
    chairStud.diffuse = new pc.Color(0.72, 0.58, 0.28); chairStud.gloss = 0.7; chairStud.update();
    shirtLinen.diffuse = new pc.Color(0.94, 0.94, 0.92); shirtLinen.gloss = 0.25; shirtLinen.update();
    // the walk scripts read the bodies' states through this; nothing in the app does
    (window as unknown as { __lounge?: unknown }).__lounge = { me, bodies, bots, library, kit, scenery, felt, dealers, flights, chipRoot, litChair, chairEntities, barSeats, fireSeats, plates: plateRef, manifest: manifestRef, camera, pc };
    /**
     * LAYERED ON TOP OF THE CLIPS — the gaze and the dealing reach — on `framerender`.
     *
     * THE HOOK MATTERS AND THERE IS NO `postupdate` IN THIS ENGINE. A frame runs `frameupdate` → `update` (where
     * the anim system poses every skeleton) → `framerender` → `render`. A handler on a name the app never fires
     * is simply never called and nothing says so: `postupdate` cost the heads their look and the dealer their
     * reach, silently, until the dealer's pulse was seen never to decay.
     *
     * A seated body looks at whoever is acting at its table (or the felt); a standing body looks at the nearest
     * person within a few steps, the one talking first. Cheap — a dozen bodies, a dozen distances.
     */
    a.on('framerender', () => {
      const dt = lastDt;
      const all: Array<{ avatar: ParticipantAvatar; name: string }> = [];
      if (me.current) all.push(me.current);
      for (const b of bodies.current.values()) all.push(b);
      for (const bt of bots.current.values()) all.push({ avatar: bt, name: '' });
      for (const dl of dealers.current.values()) {
        dl.avatar.applySeat(dt); dl.avatar.applyGaze(dt); dl.avatar.applyDeal(dt);
        // THE DECK IS PLACED HERE, NOT IN `update`: `applySeat` drops the whole body by the height of a seat
        // after the update loop has run, so a deck placed from the hand earlier is left floating exactly that
        // far above it — a white slab hanging over the felt with nothing holding it.
        const l = dl.avatar.bone('handL');
        if (l) { const hp = l.getPosition(); dl.deck.setPosition(hp.x, hp.y + 0.03, hp.z); dl.deck.setEulerAngles(0, dl.avatar.yaw * 180 / Math.PI, 0); }
        const r = dl.avatar.dealHand; if (r) dl.hand.copy(r);
        /**
         * A HAT WITH NO HEAD YET IS NOT A HAT ON THE FLOOR.
         *
         * The body is a GLB that loads after the dealer is made, so `bone('head')` is null for the first
         * frames — and the hat, created at the origin, sat in the middle of the room until it resolved.
         * Worse, a body whose head alias never resolves left it there all night, which is why the red hat
         * "does not show up all the time". It is hidden until it has somewhere to be, and if the head never
         * arrives it rides at the body's own seated head height instead of nowhere.
         */
        const hd = dl.avatar.bone('head');
        const seatedHead = 1.42;
        const on = hd ? hd.getPosition() : new pc.Vec3(dl.avatar.pos.x, dl.avatar.pos.y + seatedHead, dl.avatar.pos.z);
        dl.hat.enabled = true;
        dl.hat.setPosition(on.x, on.y + (hd ? 0.055 : -0.04), on.z);
        dl.hat.setEulerAngles(0, dl.avatar.yaw * 180 / Math.PI, 0);
        // the shirt front rides on the chest, a little proud of it so it is never inside the body
        const sp = dl.avatar.bone('spine');
        if (sp) {
          const c = sp.getPosition();
          const f = 0.085;
          dl.dress.enabled = true;
          dl.dress.setPosition(c.x + Math.sin(dl.avatar.yaw) * f, c.y + 0.12, c.z + Math.cos(dl.avatar.yaw) * f);
          dl.dress.setEulerAngles(0, dl.avatar.yaw * 180 / Math.PI, 0);
        }
      }
      const acting = actingRef.current;
      for (const b of all) {
        const av = b.avatar;
        if (av.seated) { av.lookHead(acting && acting.distance(av.pos) > 0.5 ? acting : (av.seatCentre ?? null)); }
        else {
          /**
           * A HEAD THAT KEEPS MOVING IS A HEAD WITH NO OPINION.
           *
           * Picking the nearest body every frame means two people at similar distances swap the gaze back and
           * forth, and anybody walking past takes it — the head never settles and it reads as a twitch. So a
           * body HOLDS whoever it is looking at: for a couple of seconds at least, until they walk out of
           * range, or until somebody actually starts talking, which is the one thing worth turning for.
           */
          let best: ParticipantAvatar | null = null; let bd = 3.5; let bestTalks = false;
          for (const o of all) { if (o === b) continue; const d = o.avatar.pos.distance(av.pos); const talks = o.name ? isSpeaking(o.name) : false; if (d < bd && (talks || !bestTalks)) { bd = d; best = o.avatar; bestTalks = talks; } }
          const held = gazeAt.current.get(av);
          const now = Date.now();
          const stale = !held || now - held.since > 2600;
          const gone = !held?.at || held.at.pos.distance(av.pos) > 4.5;
          let target = held?.at ?? null;
          if (!target || gone || stale || (bestTalks && best !== target)) { target = best; gazeAt.current.set(av, { at: best, since: now }); }
          av.lookHead(target ? new pc.Vec3(target.pos.x, target.seated ? 1.1 : 1.55, target.pos.z) : null);
        }
        // EVERY body gets the whole layer, not just its gaze: the seat pose, the dealing/pushing reach and the
        // winner's cheer. These were the dealers' alone for a while — which is why a seated player's own reach
        // and celebration never showed, while the dealer's did.
        av.applySeat(dt); av.applyGaze(dt); av.applyNod(dt); av.applyDeal(dt); av.applyCheer(dt);
      }
    });
    a.start();
    app.current = a;
    return () => {
      window.removeEventListener('contextmenu', noMenu); window.removeEventListener('pointerup', onUp); window.removeEventListener('blur', dropDrag);
      c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp); c.removeEventListener('pointercancel', onUp);
      ro.disconnect(); a.destroy(); app.current = null; library.current = null; kit.current = null; deck.current = null; felt.current = null; bodies.current.clear(); bots.current.clear(); dealers.current.clear(); flights.current = []; chipFlights.current = []; chipRoot.current = null; sweepRoot.current = null; me.current = null; scenery.current = null; plateRef.current.clear(); };
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
    scenery.current?.destroy(); chairEntities.current.clear(); barStoolEntities.current.clear(); barSeats.current = [];
    fireChairEntities.current.clear(); fireSeats.current = []; litChair.current = null;
    for (const [id, pl] of [...plateRef.current]) if (pl.kind === 'table' || pl.kind === 'anchor') plateRef.current.delete(id);
    const root = new pc.Entity('scenery'); a.root.addChild(root); scenery.current = root;
    const mat = (r: number, g: number, b: number, extra: Partial<pc.StandardMaterial> = {}) => { const m = new pc.StandardMaterial(); m.diffuse = new pc.Color(r, g, b); Object.assign(m, extra); m.update(); return m; };
    /**
     * SURFACES ARE PHOTOGRAPHED, NOT COLOURED (2026-09-15). The floor is a herringbone parquet, the walls a
     * painted plaster tinted the club's green, the tables a dark wood — Poly Haven's CC0 scans at 512 px, about
     * 170 KB the lot — each with its normal map so the light above actually rakes across grain and trowel marks.
     * A texture is loaded ONCE per app and shared by every rebuild of the scenery; a material is made now and
     * gets its maps the moment they land, so nothing waits on a download to draw.
     */
    const texture = (url: string, anisotropy = 8): pc.Asset => {
      let asset = textures.current.get(url);
      if (!asset) { asset = new pc.Asset(url, 'texture', { url }); a.assets.add(asset); a.assets.load(asset); asset.ready((t) => { const tex = t.resource as pc.Texture; tex.anisotropy = anisotropy; }); textures.current.set(url, asset); }
      return asset;
    };
    const surfaced = (m: pc.StandardMaterial, base: string, maps: { normal?: string; rough?: string }, tile: [number, number], bumpiness = 0.7): pc.StandardMaterial => {
      const tiling = new pc.Vec2(tile[0], tile[1]);
      texture(base).ready((t) => { m.diffuseMap = t.resource as pc.Texture; m.diffuseMapTiling = tiling; m.update(); });
      if (maps.normal) texture(maps.normal).ready((t) => { m.normalMap = t.resource as pc.Texture; m.normalMapTiling = tiling; m.bumpiness = bumpiness; m.update(); });
      if (maps.rough) texture(maps.rough).ready((t) => { m.glossMap = t.resource as pc.Texture; m.glossMapTiling = tiling; m.glossInvert = true; m.gloss = 1; m.update(); });
      return m;
    };
    const floor = surfaced(mat(0.50, 0.44, 0.37, { gloss: 0.45 }), '/room/floor-parquet.jpg', { normal: '/room/floor-parquet-n.jpg', rough: '/room/floor-parquet-r.jpg' }, [9, 9], 0.8);
    const plaster = surfaced(mat(0.16, 0.36, 0.25, { gloss: 0.2 }), '/room/wall-plaster.jpg', { normal: '/room/wall-plaster-n.jpg' }, [5, 1], 0.5);
    const ceiling = surfaced(mat(0.30, 0.28, 0.25, { gloss: 0.1 }), '/room/wall-plaster.jpg', { normal: '/room/wall-plaster-n.jpg' }, [6, 6], 0.3);
    const wood = surfaced(mat(0.62, 0.52, 0.42, { gloss: 0.55 }), '/room/wood-dark.jpg', { normal: '/room/wood-dark-n.jpg' }, [1, 1], 0.4);
    const felt = mat(0.09, 0.32, 0.22), feltHi = mat(0.11, 0.37, 0.26), brass = mat(0.85, 0.70, 0.42, { metalness: 0.6, gloss: 0.7, useMetalness: true }), chairFree = mat(0.36, 0.29, 0.53), chairTaken = mat(0.54, 0.25, 0.20), shade = mat(0.11, 0.14, 0.13), rail = mat(0.24, 0.13, 0.09, { gloss: 0.5 });
    const prim = (type: string, material: pc.StandardMaterial, pos: [number, number, number], scale: [number, number, number], rotY = 0) => {
      const e = new pc.Entity(type); e.addComponent('render', { type, material, castShadows: type !== 'plane', receiveShadows: true }); e.setLocalPosition(...pos); e.setLocalScale(...scale); e.setLocalEulerAngles(0, rotY, 0); root.addChild(e); return e;
    };
    prim('plane', floor, [0, 0, 0], [22, 1, 22]);
    prim('box', plaster, [0, 2, 11], [22, 4, 0.3]); prim('box', plaster, [0, 2, -11], [22, 4, 0.3]); prim('box', plaster, [11, 2, 0], [0.3, 4, 22]); prim('box', plaster, [-11, 2, 0], [0.3, 4, 22]);
    // A CEILING closes the room: without one the walls stood in a void the colour of the fog. It casts no
    // shadow — the sun is the key light and comes through it — and is a plane turned to face down.
    { const e = new pc.Entity('ceiling'); e.addComponent('render', { type: 'plane', material: ceiling, castShadows: false, receiveShadows: false }); e.setLocalPosition(0, 4, 0); e.setLocalScale(22, 1, 22); e.setLocalEulerAngles(180, 0, 0); root.addChild(e); }
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
      // THE DEALER'S STOOL at the gap between the last seat and the first — furniture, so it is there before the dealer
      { const ang = ((t.seats - 0.5) / t.seats) * Math.PI * 2; const r = CHAIR_R + CHAIR_BACK; pokerChair(g, Math.sin(ang) * r, Math.cos(ang) * r, (ang * 180 / Math.PI) + 180); }
      // A CHAIR is the kit's, a little outside where the body's feet go (CHAIR_R), turned to the felt; a seat pad
      // and a back stand in until the kit has loaded.
      for (let i = 0; i < t.seats; i++) {
        const ang = (i / t.seats) * Math.PI * 2; const c = i < t.seated ? chairTaken : chairFree; const r = CHAIR_R + CHAIR_BACK;
        { const e = pokerChair(g, Math.sin(ang) * r, Math.cos(ang) * r, (ang * 180 / Math.PI) + 180); chairEntities.current.set(`${t.tableId}:${i}`, e); continue; }
        add('box', c, [Math.sin(ang) * r, 0.42, Math.cos(ang) * r], [0.5, 0.08, 0.5], ang * 180 / Math.PI);
        add('box', c, [Math.sin(ang) * (r + 0.22), 0.7, Math.cos(ang) * (r + 0.22)], [0.5, 0.6, 0.06], ang * 180 / Math.PI);
      }
      // NO FIXTURE, JUST THE LIGHT: a shade hanging over the felt sat between the camera and the table from
      // every seated view, and a room reads better lit than furnished with lamps.
      const lamp = new pc.Entity('lamp'); lamp.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.94, 0.8), intensity: 2.2, range: 10, castShadows: false }); lamp.setLocalPosition(0, 3.1, 0); g.addChild(lamp);
      plateRef.current.set(`table:${t.tableId}`, { id: `table:${t.tableId}`, kind: 'table', text: t.name, sub: `${t.seated}/${t.seats} seated`, world: new pc.Vec3(p.x, 1.9, p.y) });
    }
    if (a2.bar) {
      // THE BAR: the kit's counter in four lengths with its two ends, stools along the room side, a lamp behind
      const bx = a2.bar.x, bz = a2.bar.y; const yaw = a2.bar.yaw * 180 / Math.PI;
      if (furnished) {
        for (let i = -2; i < 2; i++) k!.place('kitchenBar', root, bx, bz + i * 1.08 + 0.54, yaw + 90);
        k!.place('kitchenBarEnd', root, bx, bz - 2.16 - 0.125, yaw + 90); k!.place('kitchenBarEnd', root, bx, bz + 2.16 + 0.125, yaw + 90);
        for (let i = -1; i <= 1; i++) { const e = k!.place('stoolBar', root, bx + 0.9, bz + i * 1.2, yaw + 90); if (e) barStoolEntities.current.set(`bar:${i + 1}`, e); }

      } else { prim('box', wood, [bx, 0.55, bz], [1, 1.1, 5]); prim('box', brass, [bx, 1.12, bz], [1.2, 0.06, 5.2]); }
      // The stools are SEATS: a body's feet go a step out from the counter, turned to it.
      barSeats.current = Array.from({ length: BAR_SEATS }, (_, i) => { const sp = barSeat(a2.bar!, i); return { key: sp.key, at: new pc.Vec3(sp.x, 0, sp.z), yaw: sp.yaw }; });
      plateRef.current.set('anchor:bar', { id: 'anchor:bar', kind: 'anchor', text: 'The bar · meet the guest', world: new pc.Vec3(bx, 1.8, bz) });
    }
    if (a2.fire) {
      /**
       * THE FIRESIDE — where the night's guest is met, so it is a circle of chairs and not a decoration.
       *
       * The hearth is against the wall and the room is to its −X side, so everything faces BACK toward it:
       * the seats used to be dropped at fixed angles and half of them looked at the wall. Six chairs now sit on
       * an arc centred on the hearth, each turned to face it, with the fire itself burning in the opening.
       */
      const fx = a2.fire.x, fz = a2.fire.y;
      // the hearth: a surround, a back wall, and a mantel over the opening
      prim('box', mat(0.30, 0.24, 0.20), [fx + 0.1, 0.9, fz], [0.5, 1.8, 2.6]);
      prim('box', mat(0.22, 0.17, 0.14), [fx - 0.12, 0.55, fz], [0.22, 1.1, 1.7]);
      prim('box', mat(0.36, 0.29, 0.23), [fx - 0.05, 1.5, fz], [0.7, 0.14, 2.9]);
      // THE FIRE ITSELF, burning in the opening rather than implied by a stray light
      const embers = mat(0.95, 0.35, 0.08); embers.emissive = new pc.Color(1.0, 0.45, 0.12); embers.update();
      const flame = mat(1.0, 0.72, 0.25); flame.emissive = new pc.Color(1.0, 0.66, 0.22); flame.update();
      prim('box', embers, [fx - 0.18, 0.16, fz], [0.3, 0.3, 1.5]);
      prim('cone', flame, [fx - 0.18, 0.62, fz - 0.4], [0.42, 0.85, 0.42]);
      prim('cone', flame, [fx - 0.18, 0.78, fz], [0.5, 1.15, 0.5]);
      prim('cone', flame, [fx - 0.18, 0.58, fz + 0.4], [0.38, 0.78, 0.38]);
      if (furnished) {
        k!.place('rugRound', root, fx - 2.6, fz, 0);
        k!.place('pottedPlant', root, fx - 0.5, fz + 2.6, 0);
      }
      // SIX COMFORTABLE SEATS ON AN ARC, every one of them looking at the fire.
      // THE SAME CONVENTION THE TABLE'S CHAIRS USE, because that one demonstrably faces inward: a seat at angle
      // `a` sits at (sin a, cos a) · r, the chair piece is turned `a`, and the body's own yaw is `a + π`.
      // Deriving it afresh with cos/sin and an atan2 is what had them all looking at the wall.
      // THE SHARED GEOMETRY (lib/roomSeats.ts), so the 2D page stands a body in the very chair this draws.
      fireSeats.current = [];
      for (let i = 0; i < FIRE_SEAT_COUNT; i++) {
        const sp = firesideSeat(a2.fire, i);
        if (furnished) { const e = k!.place(CHAIR_PIECE, root, fx + Math.sin((sp.chairYawDeg * Math.PI) / 180) * FIRE_R, fz + Math.cos((sp.chairYawDeg * Math.PI) / 180) * FIRE_R, sp.chairYawDeg, CHAIR_SCALE); if (e) fireChairEntities.current.set(sp.key, e); }
        fireSeats.current.push({ key: sp.key, at: new pc.Vec3(sp.x, 0, sp.z), yaw: sp.yaw });
      }
      const fire = new pc.Entity('fire'); fire.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.62, 0.26), intensity: 2.6, range: 9 }); fire.setLocalPosition(fx - 0.35, 0.7, fz); root.addChild(fire);
      plateRef.current.set('anchor:fire', { id: 'anchor:fire', kind: 'anchor', text: 'The fire · meet the guest', world: new pc.Vec3(fx, 2.1, fz) });
    }
    if (furnished) {
      // the room's dressing: a doorway where you come in, bookcases and plants along the walls, lamps in the corners
      if (a2.door) k!.place('doorway', root, a2.door.x, -10.85, 0);
      k!.place('bookcaseOpen', root, -4, -10.6, 0); k!.place('bookcaseOpen', root, 4, -10.6, 0);
      k!.place('bookcaseOpen', root, -10.6, -6, 90); k!.place('bookcaseOpen', root, 10.6, -7, -90);
      for (const [x, z] of [[-10.3, 10.3], [10.3, 10.3], [-10.3, -10.3], [10.3, -10.3]] as const) k!.place('pottedPlant', root, x, z, 0);

    }
    if (a2.lectern) { prim('box', wood, [a2.lectern.x, 0.6, a2.lectern.y], [0.5, 1.2, 0.5]); plateRef.current.set('anchor:lectern', { id: 'anchor:lectern', kind: 'anchor', text: "♦ The guest's lectern", world: new pc.Vec3(a2.lectern.x, 1.7, a2.lectern.y) }); }
  }, [state.manifest, kitReady]);

  // ── the people, from presence ──
  useEffect(() => {
    const a = app.current; const manifest = state.manifest; const lib = library.current; if (!a || !state.you || !manifest || !lib) return;
    // WHERE A CHAIR IS: the table's anchor plus the seat's place around it, facing the felt. The seated anchor
    // is where the body's feet go; the sit clip puts the hips on the chair behind them.
    const fireSpots = (m: RoomManifest): SeatSpot[] => (m.anchors.fire ? Array.from({ length: FIRE_SEAT_COUNT }, (_, i) => firesideSeat(m.anchors.fire!, i)) : []);
    const barSpots = (m: RoomManifest): SeatSpot[] => (m.anchors.bar ? Array.from({ length: BAR_SEATS }, (_, i) => barSeat(m.anchors.bar!, i)) : []);
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
          const av = new ParticipantAvatar(lib, p.body, 'direct', figureOf(p.name, p.playerId)); av.place(p.x, p.y, p.yaw); a.root.addChild(av.entity);
          me.current = { avatar: av, name: p.name, goal: null, heading: null };
        }
        if (chair) me.current.avatar.sitAt(chair); else me.current.avatar.stand();
        // your own name hangs over your body while you walk; seated, the camera is over your shoulder and the plate
        // would sit on the felt — you know who you are, and the HUD is yours
        if (chair) plateRef.current.delete(`name:${p.playerId}`);
        else plateRef.current.set(`name:${p.playerId}`, { id: `name:${p.playerId}`, kind: 'name', text: `${p.name} · you`, face: p.name, world: me.current.avatar.pos.clone().add(new pc.Vec3(0, 1.86, 0)), you: true });
        continue;
      }
      let b = bodies.current.get(p.playerId);
      if (!b) { const av = new ParticipantAvatar(lib, p.body, 'follow', figureOf(p.name, p.playerId)); av.place(p.x, p.y, p.yaw); a.root.addChild(av.entity); b = { avatar: av, name: p.name }; bodies.current.set(p.playerId, b); }
      // SOMEBODY AT THE FIRE OR THE BAR IS SITTING THERE. They have left for the 2D page and the room still
      // holds their pose; drawn standing, a fireside of people reads as a fireside of nobody. The nearest seat
      // to where they stand is the one they are in.
      const atFire = !chair && isAtPlace(manifest.anchors.fire, p.x, p.y);
      const atBar = !chair && !atFire && isAtPlace(manifest.anchors.bar, p.x, p.y);
      const lounging = atFire ? nearestSeatOf(fireSpots(manifest), p.x, p.y) : atBar ? nearestSeatOf(barSpots(manifest), p.x, p.y) : null;
      const loungeAnchor = atFire ? manifest.anchors.fire : atBar ? manifest.anchors.bar : undefined;
      if (chair) b.avatar.sitAt(chair);
      else if (lounging && loungeAnchor) b.avatar.sitAt({ at: new pc.Vec3(lounging.x, 0, lounging.z), yaw: lounging.yaw, centre: new pc.Vec3(loungeAnchor.x, 0, loungeAnchor.y) });
      else { b.avatar.stand(); b.avatar.walkTo(p.x, p.y, p.yaw); }
      const head = (chair ? chair.at : new pc.Vec3(p.x, 0, p.y)).add(new pc.Vec3(0, chair ? 1.40 : 1.86, 0));
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
      // A SEAT KEEPS THE PERSON'S FIGURE: the body drawn in a chair for somebody whose tab is the flat board is
      // the same choice the room makes when they stand in it, or Alice turned into a man the moment she sat down.
      if (!bt) { bt = new ParticipantAvatar(lib, o.kind === 'agent' ? 'slate' : 'ink', 'follow', o.kind === 'agent' ? 'm' : figureOf(o.name ?? '', o.playerId)); bt.place(chair.at.x, chair.at.z, chair.yaw); bt.sitAt(chair); a.root.addChild(bt.entity); bots.current.set(key, bt); }
      botPlate.current.set(o.playerId, `bot:${key}`);
      // A PERSON PLAYING AT THE TABLE IS AT THE TABLE, even though their tab is the flat board: if they are in
      // the club's huddle, their camera hangs at their seat here, the same chip the boards and the dock show.
      // That is what tells the room a chair holds a person you can talk to rather than a name (2026-09-15).
      plateRef.current.set(`bot:${key}`, { id: `bot:${key}`, kind: 'name', text: o.name ?? (o.kind === 'agent' ? 'house bot' : 'seated'), ...(o.name && o.kind !== 'agent' ? { face: o.name } : {}), sub: actingPlayer.current === o.playerId ? 'to act' : undefined, world: chair.at.clone().add(new pc.Vec3(0, 1.40, 0)) });
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
      // EVENING BLACKS: the dealer's own outfit (`skin-tux.png`), which is in no random draw — a costume
      // belongs to the job, and a guest who turned up dressed as the dealer would be reading as one.
      const av = new ParticipantAvatar(lib, 'tux', 'follow'); av.place(at.x, at.z, yaw); a.root.addChild(av.entity);
      // seated, like every dealer — on a stool of their own at the gap
      av.sitAt({ at, yaw, centre: new pc.Vec3(an.x, 0, an.y) });
      av.lookHead(new pc.Vec3(an.x, 0.9, an.y));
      // THE DECK in the dealer's left hand: a stack of cards (the back on top) that follows the hand bone each frame
      const deck3 = new pc.Entity('deck');
      const stack = new pc.Entity('stack'); stack.addComponent('render', { type: 'box', material: deckSide, castShadows: true }); stack.setLocalScale(0.063 * 1.4, 0.022, 0.088 * 1.4); deck3.addChild(stack);
      const top = deck.current!.card(null, 0, 0.0115, 0, 0, deck3); top.setLocalScale(0.063 * 1.4, 1, 0.088 * 1.4);
      a.root.addChild(deck3);
      // THE HAT SAYS WHO DEALS. Everybody in the room wears the same body, so the one person whose job is
      // different needs to be readable at a glance from across the felt: a dealer's green visor.
      // A WHOLE HAT, not a visor: a brim all the way round, a crown standing on it, and a band where the two
      // meet. A brim pushed forward on its own reads as a sun visor stuck to a forehead.
      const hat = new pc.Entity('hat');
      // WIDE ENOUGH TO SIT OVER A HEAD OF HAIR, not in it: the crown was narrower than the skull and the hair
      // came through it from behind. (The dealer's hair is the hat's own red as well, so what does come
      // through reads as hat — `skin-tux.png`.)
      /**
       * A DOME, NOT A TUBE. A cylindrical crown covers the top of a head and nothing else, so hair came
       * through it from behind at every angle but straight on — and no amount of widening fixes a shape that
       * is open at the back. A hemisphere over the skull, sunk slightly into it, swallows whatever the head
       * has on it; the brim and band are what make it read as a hat rather than a helmet.
       */
      const brim = new pc.Entity('brim'); brim.addComponent('render', { type: 'cylinder', material: hatFelt, castShadows: true }); brim.setLocalScale(0.40, 0.022, 0.40); brim.setLocalPosition(0, 0, 0); hat.addChild(brim);
      const band = new pc.Entity('band'); band.addComponent('render', { type: 'cylinder', material: hatBand, castShadows: true }); band.setLocalScale(0.315, 0.05, 0.315); band.setLocalPosition(0, 0.03, 0); hat.addChild(band);
      const crown = new pc.Entity('crown'); crown.addComponent('render', { type: 'sphere', material: hatFelt, castShadows: true }); crown.setLocalScale(0.325, 0.33, 0.325); crown.setLocalPosition(0, 0.03, 0); hat.addChild(crown);
      hat.enabled = false;   // …until the frame loop has a head (or a body) to put it on
      a.root.addChild(hat);
      /**
       * THE SHIRT AND THE BOW. The body's outfit is five flat bands of colour, and one of them is "the top" —
       * so evening blacks can be black but cannot have a white front. The shirt is therefore a thing WORN:
       * a white panel and a red bow at the chest, carried on the spine the way the hat is carried on the head.
       */
      const dress = new pc.Entity('dress');
      const shirt = new pc.Entity('shirt'); shirt.addComponent('render', { type: 'box', material: shirtLinen, castShadows: false }); shirt.setLocalScale(0.13, 0.26, 0.055); shirt.setLocalPosition(0, 0, 0); dress.addChild(shirt);
      const bow = new pc.Entity('bow'); bow.addComponent('render', { type: 'box', material: hatFelt, castShadows: false }); bow.setLocalScale(0.09, 0.035, 0.05); bow.setLocalPosition(0, 0.135, 0.01); dress.addChild(bow);
      dress.enabled = false;
      a.root.addChild(dress);
      dealers.current.set(t.tableId, { avatar: av, hand: new pc.Vec3(at.x + Math.sin(yaw) * 0.45, 0.98, at.z + Math.cos(yaw) * 0.45), deck: deck3, hat, dress });
    }
    for (const [id, dl] of [...dealers.current]) if (!seenDealers.has(id)) { dl.avatar.destroy(); dl.deck.destroy(); dl.hat.destroy(); dl.dress.destroy(); dealers.current.delete(id); plateRef.current.delete(`dealer:${id}`); }
  }, [state.people, state.you, state.manifest]);

  // ── CHIPS: each seat's street bet pushed toward the pot, and the pot pile — rebuilt when any bet changes ──
  useEffect(() => {
    const a = app.current; const ch = chips.current;
    const manifest = state.manifest; const you = state.you ? state.people.get(state.you) : undefined;
    const t = board && manifest ? manifest.tables.find((x) => x.tableId === board.tableId) : undefined; const an = t ? manifest!.anchors[t.anchor] : undefined;
    if (!a || !ch || !board || !manifest || !you?.seatedAt || you.seatedAt.tableId !== board.tableId || !t || !an) { chipRoot.current?.destroy(); chipRoot.current = null; return; }
    const v = board.view; const cx = an.x, cz = an.y;
    if (chipHand.current !== (v.hand?.handNo ?? -1)) { pushed.current.clear(); chipHand.current = v.hand?.handNo ?? -1; }
    let collected = false;
    const rxOf = (p2: RoomPerson, tt: typeof t) => Math.cos((p2.seatedAt!.seat / tt.seats) * Math.PI * 2);
    const rzOf = (p2: RoomPerson, tt: typeof t) => -Math.sin((p2.seatedAt!.seat / tt.seats) * Math.PI * 2);
    const sig = JSON.stringify([v.hand?.handNo ?? -1, v.seats.map((s2) => [s2.seat, s2.stack, s2.inHand?.streetBet ?? 0]), v.hand?.pots.map((p) => p.amount) ?? []]);
    if (sig === chipSig.current && chipRoot.current) return;
    const fresh = new pc.Entity('chips-root'); a.root.addChild(fresh);
    const H = 0.79;
    // each seat's own stack sits just in front of its cards; its street bet is pushed a third of the way to the middle
    for (const seat of v.seats) {
      const ang = (seat.seat / t.seats) * Math.PI * 2; const sx = Math.sin(ang), sz = Math.cos(ang);
      { const px = Math.cos(ang), pz = -Math.sin(ang); if (seat.stack > 0) ch.pile(seat.stack, cx + sx * 1.14 + px * 0.34, H, cz + sz * 1.14 + pz * 0.34, fresh, 0.08); }
      const bet = seat.inHand?.streetBet ?? 0;
      if (bet > 0) {
        const px = Math.cos(ang), pz = -Math.sin(ang); const bx = cx + sx * 0.72 + px * 0.34, bz = cz + sz * 0.72 + pz * 0.34;
        const { entity, top } = ch.pile(bet, bx, H, bz, fresh);
        // NEW chips this street fly in from where the seat sits — "throwing out chips"
        const was = pushed.current.get(seat.seat) ?? 0;
        if (bet > was) {
          const from = new pc.Vec3(cx + sx * 1.18 + px * 0.42, H + 0.06, cz + sz * 1.18 + pz * 0.42);
          chipFlights.current.push({ entity, from, to: entity.getLocalPosition().clone(), t: 0, delay: 0.15 }); entity.setLocalPosition(from);
          // the person pushes them: the seat's body reaches with its right arm as the chips leave
          const who = seat.playerId === state.you ? me.current?.avatar : bodies.current.get(seat.playerId)?.avatar ?? bots.current.get(`${t.tableId}:${seat.seat}`);
          who?.dealFlick();
        }
        pushed.current.set(seat.seat, bet);
        void top;
      } else {
        // THE STREET ENDED AND THE DEALER COLLECTS. A bet that was there last time and is gone now went into the
        // pot, so it is flown from where it sat to the middle rather than simply vanishing — which is the part of
        // a dealer's job that makes a pot look like it was built out of the bets.
        const was = pushed.current.get(seat.seat) ?? 0;
        if (was > 0) {
          const bx = cx + sx * 0.72 + Math.cos(ang) * 0.34, bz = cz + sz * 0.72 - Math.sin(ang) * 0.34;
          const { entity } = ch.pile(was, bx, H, bz, fresh);
          const to = new pc.Vec3(cx + rxOf(you, t) * 1.05, H, cz + rzOf(you, t) * 1.05);
          chipFlights.current.push({ entity, from: entity.getLocalPosition().clone(), to, t: 0, delay: 0.1 });
          collected = true;
        }
        pushed.current.set(seat.seat, 0);
      }
    }
    const pot = (v.hand?.pots.reduce((s2, p) => s2 + p.amount, 0) ?? 0);
    { const yourAng = (you.seatedAt.seat / t.seats) * Math.PI * 2; const rx = Math.cos(yourAng), rz = -Math.sin(yourAng); if (pot > 0) ch.pile(pot, cx + rx * 1.05, H, cz + rz * 1.05, fresh, 0.08); }
    // the dealer reaches across for what they have just gathered in
    if (collected) dealers.current.get(board.tableId)?.avatar.dealFlick();
    chipRoot.current?.destroy(); chipRoot.current = fresh; chipSig.current = sig;
  }, [board, state.manifest, state.people, state.you]);

  // ── THE END OF A HAND: the pot swept to the winner, stacked in front of them, and a word of celebration ──
  // The table says who won and how much (`lastHand.result.awards`). The chips already on the felt are not
  // re-simulated: a pile is flown from the middle to the winner's own place and left there until the next deal
  // clears the felt, which is what a dealer pushing a pot across actually looks like.
  useEffect(() => {
    const a = app.current; const ch = chips.current; const manifest = state.manifest;
    const you = state.you ? state.people.get(state.you) : undefined;
    const t = board && manifest ? manifest.tables.find((x) => x.tableId === board.tableId) : undefined;
    const an = t ? manifest!.anchors[t.anchor] : undefined;
    const res = board?.lastHand?.result; const handNo = board?.lastHand?.handNo ?? -1;
    if (!a || !ch || !board || !t || !an || !res || !you?.seatedAt || sweptHand.current === handNo) return;
    sweptHand.current = handNo;
    sweepRoot.current?.destroy();
    const root = new pc.Entity('sweep'); a.root.addChild(root); sweepRoot.current = root;
    const cx = an.x, cz = an.y; const H = 0.79;
    for (const award of res.awards) {
      if (!(award.amount > 0)) continue;
      const ang = (award.seat / t.seats) * Math.PI * 2; const sx = Math.sin(ang), sz = Math.cos(ang);
      const px = Math.cos(ang), pz = -Math.sin(ang);
      const { entity } = ch.pile(award.amount, cx + sx * 1.14 + px * 0.34, H, cz + sz * 1.14 + pz * 0.34, root, 0.08);
      const from = new pc.Vec3(cx, H + 0.04, cz - 0.2);
      chipFlights.current.push({ entity, from, to: entity.getLocalPosition().clone(), t: 0, delay: 0.25 });
      entity.setLocalPosition(from);
      // the dealer pushes it across, as a dealer does
      dealers.current.get(board.tableId)?.avatar.dealFlick();
      // the winner says so: a body that is in the room celebrates, a seat that is only an occupant does not
      const winner = board.view.seats.find((s2) => s2.seat === award.seat)?.playerId;
      const av = winner === state.you ? me.current?.avatar : winner ? bodies.current.get(winner)?.avatar : undefined;
      window.setTimeout(() => av?.celebrate(), 700);
      if (winner) {
        const nm = board.names[winner] ?? 'the winner';
        plateRef.current.set('felt:won', { id: 'felt:won', kind: 'pot', text: `${nm} wins ${award.amount}`, world: new pc.Vec3(cx, 1.35, cz) });
        window.setTimeout(() => plateRef.current.delete('felt:won'), 5000);
      }
    }
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
    // A WATCHER SEES THE HAND TOO (2026-09-15). The felt used to be drawn only for whoever was SEATED at this
    // table — and sitting down takes you to the flat board — so from the room every table was bare wood with
    // people round it. Standing at a table you get what a spectator gets: the board, the pot, face-down cards.
    if (!a || !d || !board || !manifest || !you || !t || !an) {
      felt.current?.destroy(); felt.current = null; actingRef.current = null; flights.current = [];
    if (sweepRoot.current && feltSig.current) { sweepRoot.current.destroy(); sweepRoot.current = null; } feltSig.current = '';
      return;
    }
    const v = board.view; const cx = an.x, cz = an.y;
    // WHICH WAY THE CARDS FACE: your chair when you are in one, and otherwise wherever you are standing — a
    // table's convention throughout is that the seat at angle `a` is at `(sin a, cos a)` from the centre.
    const seatedHere = you.seatedAt && you.seatedAt.tableId === board.tableId ? you.seatedAt : null;
    const yourAng = seatedHere ? (seatedHere.seat / t.seats) * Math.PI * 2 : Math.atan2(you.x - cx, you.y - cz);
    // whose turn changes every message; the CARDS change a few times a hand — the felt is rebuilt only for those,
    // so a flight in progress is not cut short by a chat line or a clock tick
    actingRef.current = v.hand?.toAct != null ? (() => { const ang = (v.hand!.toAct! / t.seats) * Math.PI * 2; return new pc.Vec3(cx + Math.sin(ang) * CHAIR_R, 1.15, cz + Math.cos(ang) * CHAIR_R); })() : null;
    actingPlayer.current = v.hand?.toAct != null ? v.seats.find((s2) => s2.seat === v.hand!.toAct)?.playerId ?? null : null;
    const out = new Set(v.seats.filter((s2) => s2.status === 'sitting-out').map((s2) => s2.playerId));
    for (const pl of plateRef.current.values()) {
      if (pl.kind !== 'name') continue;
      const who = pl.id.startsWith('name:') ? pl.id.slice(5) : null;
      const acting = pl.id === `name:${actingPlayer.current}` || (pl.id.startsWith('bot:') && pl.id === botPlate.current.get(actingPlayer.current ?? ''));
      pl.sub = acting ? 'to act' : who && out.has(who) ? 'sitting out' : pl.agentSub;
    }
    const sig = JSON.stringify([v.hand?.handNo ?? -1, v.hand?.board ?? [], v.seats.map((s2) => [s2.seat, s2.inHand?.folded ?? null, s2.inHand?.holeCards ?? null]), seatedHere ? seatedHere.seat : Math.round(yourAng * 8)]);
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
    const tiltToward = (e: pc.Entity, ang: number) => { e.setLocalEulerAngles(-7, (ang + Math.PI) * 180 / Math.PI, 0); };
    const lay = (id: string, code: string | null, x: number, z: number, yaw: number, lift: number): pc.Entity => {
      const e = d.card(code, x, H, z, yaw, root, lift);
      if (dealer && !dealt.current.ids.has(id)) {
        // it starts in the dealer's hand and arrives in order; the dealer reaches for the deck once per round of dealing
        const to = e.getPosition().clone(); e.setPosition(dealer.hand);
        const delay = n * 0.16;
        flights.current.push({ entity: e, from: dealer.hand.clone(), to, yawFrom: dealer.avatar.yaw, yawTo: yaw, t: 0, delay, tilt: id.startsWith('board:') ? -7 : 0 });
        // the dealing arm flicks as each card leaves — scheduled to match this card's delay
        window.setTimeout(() => dealer.avatar.dealFlick(), delay * 1000);
        n++;
      }
      dealt.current.ids.add(id);
      return e;
    };
    if (v.hand) {
      v.hand.board.forEach((c, i) => { const o = (i - 2) * 0.33; const e = lay(`board:${i}`, c, cx + rx * o, cz + rz * o, yourAng + Math.PI, 0.045 + i * 0.0005); e.setLocalScale(0.063 * 4.6, 1, 0.088 * 4.6); tiltToward(e, yourAng); });
    }
    for (const seat of v.seats) {
      if (!seat.inHand || seat.inHand.folded) continue;
      const ang = (seat.seat / t.seats) * Math.PI * 2; const sx = Math.sin(ang), sz = Math.cos(ang);
      const px = Math.cos(ang), pz = -Math.sin(ang); // across that seat's own line
      const cards = seat.inHand.holeCards ?? [null, null];
      cards.forEach((c, i) => { const o = (i - 0.5) * 0.17; lay(`hole:${seat.seat}:${i}`, c, cx + sx * HOLE_R + px * o, cz + sz * HOLE_R + pz * o, ang + Math.PI, i * 0.0005); });
    }
  }, [board, state.manifest, state.people, state.you]);

  // your own plate follows your own body (which moves locally, ahead of the server)
  useEffect(() => {
    const t = setInterval(() => { const m = me.current; const pl = state.you ? plateRef.current.get(`name:${state.you}`) : null; if (m && pl) pl.world = m.avatar.pos.clone().add(new pc.Vec3(0, m.avatar.seated ? 1.40 : 1.86, 0)); }, 50);
    return () => clearInterval(t);
  }, [state.you]);

  /**
   * THE CHAIR YOU ARE TAKING CHANGES COLOUR, and stays that way until you are in it.
   *
   * Walking across a room and then waiting a second for the board to open gave no sign that the click had
   * registered at all — so people clicked again, or thought it had not worked. The chair itself is the thing
   * they aimed at, so the chair is the thing that answers.
   */
  const lightChair = (key: string | null) => {
    const cur = litChair.current;
    if (cur && cur.key === key) return;
    if (cur) { for (const [mi, m] of cur.restore) mi.material = m; litChair.current = null; }
    if (!key) return;
    const e = chairEntities.current.get(key) ?? barStoolEntities.current.get(key) ?? fireChairEntities.current.get(key); if (!e) return;
    const restore: Array<[pc.MeshInstance, pc.Material]> = [];
    for (const r of e.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) {
      const was = mi.material as pc.StandardMaterial;
      restore.push([mi, was]);
      // its OWN material, glowing — never a foreign one, which is how a chair could vanish under the pointer
      const lit = was.clone();
      lit.emissive = new pc.Color(0.55, 0.40, 0.08);
      lit.emissiveIntensity = 1;
      lit.update();
      mi.material = lit;
    }
    litChair.current = { key, restore };
  };

  useImperativeHandle(ref, () => ({
    walkToSeat: (tableId, seat) => {
      const m = me.current;
      // A STOOL AND A FIRESIDE ARMCHAIR ARE WALKED TO LIKE ANY OTHER CHAIR — the button at the bottom of the
      // screen and a click on the chair itself are the same act, and neither teleports anybody.
      const lounge = tableId === BAR ? barSeats.current.find((x) => x.key === `bar:${seat}`)
        : tableId === FIRE ? fireSeats.current.find((x) => x.key === `fire:${seat}`) : null;
      const ch = lounge ? { at: lounge.at, yaw: lounge.yaw, taken: false, key: lounge.key }
        : (() => { const c = chairs.current.find((c2) => c2.tableId === tableId && c2.seat === seat); return c ? { at: c.at, yaw: c.yaw, taken: c.taken, key: `${tableId}:${seat}` } : null; })();
      if (!m || !ch || ch.taken || m.avatar.seated) return false;
      m.goal = ch.at.clone(); m.heading = { tableId, seat, yaw: ch.yaw };
      lightChair(ch.key);
      return true;
    },
    standBeside: (tableId, seat) => {
      const m = me.current; if (!m) return false;
      // THE FIRESIDE AND THE BAR are seats too: leaving one is standing up from it, so you come back to it.
      if (tableId === FIRE || tableId === BAR) {
        const list = tableId === FIRE ? fireSeats.current : barSeats.current;
        const st = list.find((x) => Number(x.key.slice(x.key.indexOf(':') + 1)) === seat) ?? list[0];
        if (!st) return false;
        const back = 0.9;
        const x = st.at.x - Math.sin(st.yaw) * back, z = st.at.z - Math.cos(st.yaw) * back;
        m.avatar.stand(); m.avatar.place(x, z, st.yaw); m.goal = null; m.heading = null;
        lightChair(null); socket.pose(x, z, st.yaw);
        return true;
      }
      const manifest = manifestRef.current;
      const t = manifest?.tables.find((x) => x.tableId === tableId); const an = t ? manifest!.anchors[t.anchor] : undefined;
      if (!t || !an) return false;
      // a step outside the chair, turned to the felt: you stood up from here, so this is where you are
      const ang = (seat / t.seats) * Math.PI * 2;
      const r = CHAIR_R + 0.95;
      const x = an.x + Math.sin(ang) * r, z = an.y + Math.cos(ang) * r;
      m.avatar.stand(); m.avatar.place(x, z, ang + Math.PI); m.goal = null; m.heading = null;
      lightChair(null);
      socket.pose(x, z, ang + Math.PI);
      return true;
    },
  }), [socket]);

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
      {over ? (
        <div className="lounge-who" style={{ left: over.x, top: over.y }} aria-hidden="true">
          <strong>{over.name}</strong>
          {over.agent ? <span className="lounge-who-agent">{over.agent}</span> : null}
          <span className="lounge-who-doing">{over.doing}</span>
          {over.said ? <span className="lounge-who-said">“{over.said}”</span> : null}
        </div>
      ) : null}
      <div className="lounge-help hint">Walk with W A S D or the arrow keys, or click the floor. Click a free chair to sit down. Scroll to zoom; right-drag to look around.</div>
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
