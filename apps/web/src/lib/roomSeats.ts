/**
 * WHERE THE FIRESIDE AND BAR SEATS ARE — one answer, used by both views.
 *
 * The 3D room draws these chairs and the 2D page stands a body at one of them, and the two have to agree or a
 * person who sat down by the fire turns up somewhere else entirely for everyone still walking about. The poker
 * table's convention throughout: a seat at angle `a` is at `(sin a, cos a) · r` from the anchor, and the body
 * sitting in it faces `a + π` — back toward the middle.
 */
export const FIRE_SEATS = 6;
export const FIRE_R = 2.6;
export const FIRE_SPREAD = Math.PI * 0.9;
/** −X from the hearth, which is where the room is. */
export const FIRE_CENTRE = -Math.PI / 2;
/**
 * How far in front of the chair the body's feet go.
 *
 * The armchairs by the fire are DEEP — a metre from front edge to back — so the 0.32 m that seats somebody
 * properly in a dining chair at a table perched them on the front edge of these. The hips end up `SEAT_BACK`
 * (0.30 m) further out than the feet, so a smaller step here sits them further back in the chair.
 */
export const SEAT_STEP = 0.05;

export interface RoomAnchorLike { x: number; y: number }
export interface SeatSpot { key: string; x: number; z: number; yaw: number; chairYawDeg: number }

/** The i-th chair of the horseshoe around a hearth. */
export function firesideSeat(anchor: RoomAnchorLike, i: number): SeatSpot {
  const a = FIRE_CENTRE - FIRE_SPREAD / 2 + (i / (FIRE_SEATS - 1)) * FIRE_SPREAD;
  return {
    key: `fire:${i}`,
    x: anchor.x + Math.sin(a) * (FIRE_R - SEAT_STEP),
    z: anchor.y + Math.cos(a) * (FIRE_R - SEAT_STEP),
    yaw: a + Math.PI,
    chairYawDeg: (a * 180) / Math.PI,
  };
}

export const BAR_SEATS = 3;
/** The i-th stool along a counter. The bar runs in z and the room is to its +X side. */
export function barSeat(anchor: RoomAnchorLike, i: number): SeatSpot {
  const z = anchor.y + (i - 1) * 1.2;
  return { key: `bar:${i}`, x: anchor.x + 1.35, z, yaw: -Math.PI / 2, chairYawDeg: 90 };
}

/**
 * HOW NEAR COUNTS AS "AT" THE FIRE OR THE BAR.
 *
 * Not the room's own zone: the fire anchor's radius is 2.5 m and its chairs stand at 2.55, so a body sitting
 * in one was never inside the zone and a fireside with people in it reported nobody. Distance to the anchor,
 * measured here, is the same answer for both views and cannot drift out from under them.
 */
export const AT_PLACE = 3.4;
export function isAtPlace(anchor: RoomAnchorLike | undefined, x: number, z: number): boolean {
  return !!anchor && Math.hypot(anchor.x - x, anchor.y - z) <= AT_PLACE;
}

/** Which of a place's seats is nearest a point — how a body's pose is read back as "sitting in that one". */
export function nearestSeatOf(seats: SeatSpot[], x: number, z: number): SeatSpot | null {
  let best: SeatSpot | null = null; let bd = 2.2;
  for (const s of seats) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
  return best;
}
