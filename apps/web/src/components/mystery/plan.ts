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
  /**
   * OFF THE FLOOR, AND LEANING. A primitive sits on the floor unless it is given a height, and stands upright
   * unless it is given a tilt — which is what a ledger open on a desk and a pair of skis against a rack need.
   * `y` is the CENTRE of the shape; `tilt` is degrees about the piece's own X, `lean` about its Z.
   */
  y?: number; tilt?: number; lean?: number;
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
  /**
   * WHERE A BODY LIES IN THIS ROOM, if one does. A death happens IN a room and the story says where — at the
   * foot of the racks, by the hearth, at the bottom of the service stair — so the drawing says where too,
   * rather than leaving a victim in the middle of the floor like a dropped parcel. `yaw` is which way they
   * fell. The room's own narration and this should agree; when they do, walking in on it tells the story.
   */
  deathAt?: { x: number; z: number; yaw?: number };
  things: Placed[];
}

const FIRE = '#c9702a';

/**
 * THE BELVEDERE'S ROOMS — GENERATED FROM THE PLACE ONTOLOGY (2026-09-16).
 *
 * This used to be two hundred lines of hand-written coordinates, and it was the second copy: the same hotel
 * was also described, in prose, in the venue the engine plays and in whatever a director was told. Two
 * descriptions of one building drift, and when they do the thing a player is told to look at is not the
 * thing on the screen — which is exactly how "the guest register" ended up being a bare side table.
 *
 * There is now ONE description. `~/skills/ontology/belvedere.ttl` is the Hôtel Belvedere as an A-box over
 * the place upper ontology: its rooms and their sizes, the palette each is drawn in, every door and where
 * it sits in the wall, where people stand, where a body lies, and every thing in every room with the
 * numbers to draw it and a line about what there is to see in it. `node scripts/place-to-plan.mjs` compiles
 * that into `plan.generated.ts`, and this is where the room a player walks through comes from.
 *
 * It is compiled rather than loaded because the scene is built in a browser on a lazy canvas at the moment
 * somebody walks into a room; parsing a thousand triples there to find out how wide the lobby is would be a
 * download and a delay in exchange for nothing. The ontology is authoring-time truth; this is the build.
 */
import { BELVEDERE_PLAN_FROM_ONTOLOGY } from './plan.generated';
export const BELVEDERE_PLAN = BELVEDERE_PLAN_FROM_ONTOLOGY;

export function spotIn(roomId: string, i: number): [number, number] {
  const plan = BELVEDERE_PLAN[roomId];
  if (!plan) return [0, 0];
  return plan.spots[i % plan.spots.length] ?? [0, 0];
}

/** Somewhere to put a prop the plan forgot: along the back wall, spaced out, so it can still be clicked. */
export function strandedAt(i: number, plan: RoomPlan): [number, number] {
  return [-plan.w + 1.5 + i * 1.6, -plan.d + 1.2];
}
