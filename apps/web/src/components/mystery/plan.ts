/**
 * WHERE THE BELVEDERE'S THINGS STAND (docs/MYSTERY-NIGHT.md §9).
 *
 * The VENUE (in `@pokernight/mystery`) is authoritative about what exists — which rooms, which props, which
 * doors — and says nothing about where any of it is, because a place can be drawn a dozen ways and none of
 * them is a rule of the story. This is the drawing: a floor, a palette, a piece of furniture per prop, the
 * spots people stand in, and where each door is in the wall.
 *
 * A PROP THE PLAN FORGETS IS STILL IN THE ROOM. The venue's list is what is drawn; anything this file has no
 * place for gets a place anyway (along the back wall) and a warning, because a clue you cannot click is a
 * clue that does not exist.
 */
export interface Placed {
  /** A piece of Kenney's kit by node name, or a primitive when the kit has nothing like it. */
  piece?: string;
  prim?: { shape: 'box' | 'cylinder'; size: [number, number, number]; colour: string; glow?: number };
  x: number; z: number; yaw?: number; scale?: number;
  /** The prop this object IS, if it is one — what a click on it examines. */
  prop?: string;
  /** A label drawn over it, for a prop with no obvious shape. */
  label?: string;
}

export interface RoomPlan {
  /** Half-width and half-depth of the floor, in metres. */
  w: number; d: number;
  floor: string; wall: string; accent: string;
  /** Where a body stands when it is in this room, in the order characters arrive. */
  spots: Array<[number, number]>;
  /** Where each door out of this room sits in the wall, by the room it leads to. */
  doors: Record<string, [number, number]>;
  things: Placed[];
}

const FIRE = '#c9702a';

export const BELVEDERE_PLAN: Record<string, RoomPlan> = {
  lobby: {
    w: 8, d: 7, floor: '#5b4a3a', wall: '#3a4a52', accent: '#c9a14a',
    spots: [[-3, 1], [-1.5, 2.2], [0, 1], [1.5, 2.2], [3, 1], [-2, -1.5], [2, -1.5], [0, -2.6]],
    doors: { lounge: [7.4, 0], 'ski-room': [-7.4, 0], 'guest-room': [0, -6.4] },
    things: [
      { piece: 'sideTable', x: 0, z: 4.6, yaw: 180, scale: 1.6, prop: 'register', label: 'the register' },
      { piece: 'bookcaseOpen', x: -3.2, z: 5.2, yaw: 180, prop: 'keyboard', label: 'the keys' },
      { piece: 'chairRounded', x: 3.6, z: 4.4, yaw: 200, prop: 'coat-stand', label: 'the coats' },
      { piece: 'rugRound', x: 0, z: 0, scale: 2.4 },
      { piece: 'pottedPlant', x: -6.4, z: -4.6 },
      { piece: 'pottedPlant', x: 6.4, z: -4.6 },
      { piece: 'loungeSofa', x: -5.4, z: 1.4, yaw: 90 },
      { piece: 'lampRoundFloor', x: 5.6, z: 2.6 },
      // the snowed-in front doors
      { prim: { shape: 'box', size: [3.2, 2.4, 0.3], colour: '#26333a' }, x: 0, z: 6.9 },
      { prim: { shape: 'box', size: [3.4, 0.9, 0.5], colour: '#e8eef2' }, x: 0, z: 6.6 },
    ],
  },
  lounge: {
    w: 7.5, d: 7, floor: '#4b3b2e', wall: '#42352f', accent: '#c9702a',
    spots: [[-2.6, 0.6], [-1, 1.8], [0.6, 0.6], [2.2, 1.8], [3.4, 0], [-3.6, -1.4], [1.4, -2.2], [-1, -2.6]],
    doors: { lobby: [-7.1, 0], kitchen: [7.1, 0] },
    things: [
      // the hearth, which actually burns
      { prim: { shape: 'box', size: [3.4, 2.2, 0.8], colour: '#6b6560' }, x: 0, z: 6.2 },
      { prim: { shape: 'box', size: [2.2, 1.2, 0.5], colour: '#1a1614' }, x: 0, z: 5.9 },
      { prim: { shape: 'box', size: [1.6, 0.7, 0.4], colour: FIRE, glow: 2.4 }, x: 0, z: 5.85, prop: 'hearth', label: 'the fire' },
      { piece: 'loungeSofa', x: 0, z: 2.6, yaw: 180 },
      { piece: 'loungeChair', x: -2.8, z: 3.4, yaw: 135 },
      { piece: 'loungeChair', x: 2.8, z: 3.4, yaw: 225 },
      { piece: 'tableCoffee', x: 0, z: 1.2, prop: 'drinks-tray', label: 'the drinks' },
      { piece: 'bookcaseOpen', x: -6.2, z: -3.4, yaw: 90, prop: 'piano', label: 'the piano' },
      { piece: 'rugRound', x: 0, z: 2, scale: 2.6 },
      { piece: 'lampRoundFloor', x: 5.4, z: 4 },
    ],
  },
  kitchen: {
    w: 7, d: 6, floor: '#4a4a4a', wall: '#37423f', accent: '#8fa7a0',
    spots: [[-2.4, 0.4], [-0.8, 1.6], [0.8, 0.4], [2.4, 1.6], [3.4, -0.6], [-3.4, -1.6], [1.2, -2.4], [-1.4, -2.6]],
    doors: { lounge: [-6.6, 0], 'guest-room': [6.6, 0] },
    things: [
      { piece: 'kitchenBar', x: -1.2, z: 3.8 },
      { piece: 'kitchenBar', x: 1.2, z: 3.8 },
      { piece: 'kitchenBarEnd', x: 3.2, z: 3.8 },
      { piece: 'sideTable', x: -4.4, z: 3.6, prop: 'larder', label: 'the larder' },
      { prim: { shape: 'box', size: [0.5, 0.35, 0.3], colour: '#c9c2b4' }, x: 0.6, z: 3.3, prop: 'knife-block', label: 'the knives' },
      { prim: { shape: 'box', size: [1.6, 2.6, 0.4], colour: '#2c3330' }, x: 5.6, z: -3.4, yaw: 90, prop: 'service-stairs', label: 'the service stairs' },
      { piece: 'stoolBar', x: -1.2, z: 2.2 },
      { piece: 'stoolBar', x: 0.8, z: 2.2 },
      { piece: 'lampSquareCeiling', x: 0, z: 0 },
    ],
  },
  'guest-room': {
    w: 6.5, d: 6, floor: '#5a4636', wall: '#4a4048', accent: '#8a6f8c',
    spots: [[-2.2, 0.4], [-0.6, 1.6], [1, 0.4], [2.4, 1.4], [3, -0.8], [-3, -1.6], [0.8, -2.4], [-1.2, -2.6]],
    doors: { lobby: [0, -5.4], kitchen: [-6.1, 0] },
    things: [
      // a bed, which the kit has not got
      { prim: { shape: 'box', size: [2.2, 0.5, 3.2], colour: '#4c3f38' }, x: -3.4, z: 2.6 },
      { prim: { shape: 'box', size: [2, 0.25, 2.6], colour: '#cdbfae' }, x: -3.4, z: 2.4 },
      { prim: { shape: 'box', size: [1.4, 0.2, 0.6], colour: '#e8e2d6' }, x: -3.4, z: 3.9 },
      { piece: 'sideTable', x: 2.6, z: 3.6, prop: 'writing-desk', label: 'the desk' },
      { piece: 'chairCushion', x: 2.6, z: 2.4, yaw: 180 },
      { prim: { shape: 'box', size: [1.1, 0.7, 0.6], colour: '#6b4a3a' }, x: 0.2, z: 2, prop: 'suitcase', label: 'the suitcase' },
      { prim: { shape: 'box', size: [1.6, 2.2, 0.2], colour: '#8fa7b8', glow: 0.35 }, x: 5.9, z: 2, yaw: 90, prop: 'balcony', label: 'the balcony' },
      { piece: 'rugRound', x: 0, z: 0, scale: 2 },
      { piece: 'lampRoundFloor', x: 4.4, z: 4.2 },
    ],
  },
  'ski-room': {
    w: 6.5, d: 6, floor: '#3f4a4e', wall: '#2f3a3e', accent: '#7fb0c4',
    spots: [[-2.2, 0.6], [-0.6, 1.8], [1, 0.6], [2.4, 1.6], [3, -0.6], [-3, -1.6], [0.8, -2.4], [-1.2, -2.8]],
    doors: { lobby: [6.1, 0] },
    things: [
      { piece: 'bookcaseOpen', x: -4.2, z: 3.4, prop: 'racks', label: 'the racks' },
      { piece: 'bookcaseOpen', x: -1.6, z: 3.4 },
      { piece: 'sideTable', x: 2.4, z: 3.4, prop: 'wax-bench', label: 'the wax bench' },
      { prim: { shape: 'box', size: [1.2, 1, 0.8], colour: '#45525a' }, x: 4.4, z: 2.2, prop: 'boot-dryer', label: 'the boot dryer' },
      // the piste door, letting the weather in
      { prim: { shape: 'box', size: [2.4, 2.4, 0.2], colour: '#1b2428' }, x: 0, z: 5.9 },
      { prim: { shape: 'box', size: [2.6, 0.7, 0.6], colour: '#dbe6ec' }, x: 0, z: 5.5 },
      { piece: 'lampSquareCeiling', x: 0, z: 0 },
    ],
  },
};

/**
 * WHERE THE i-TH PERSON IN A ROOM STANDS — the one answer the drawing and the VOICE both use.
 *
 * The venue places a body here and the room's audio pans a voice to the same point, so somebody talking by
 * the hearth sounds like somebody talking by the hearth. Two answers would drift apart the first time either
 * was tuned.
 */
export function spotIn(roomId: string, i: number): [number, number] {
  const plan = BELVEDERE_PLAN[roomId];
  if (!plan) return [0, 0];
  return plan.spots[i % plan.spots.length] ?? [0, 0];
}

/** Somewhere to put a prop the plan forgot: along the back wall, spaced out, so it can still be clicked. */
export function strandedAt(i: number, plan: RoomPlan): [number, number] {
  return [-plan.w + 1.5 + i * 1.6, -plan.d + 1.2];
}
