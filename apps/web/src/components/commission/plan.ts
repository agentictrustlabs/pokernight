/**
 * WHERE THE MEETING HOUSE'S THINGS STAND (docs/GREAT-COMMISSION.md §10).
 *
 * The same drawing vocabulary as the Belvedere's — a floor, a palette, the spots people stand in, where each
 * door sits in the wall, and every thing with the numbers to draw it — compiled from
 * `~/skills/ontology/kettlewater-house.ttl` by `scripts/place-to-plan.mjs --name KETTLEWATER_HOUSE`. The room
 * ids are the WORKSPACE ids the engine enforces disclosure rules on, joined on one string apiece, so the room
 * a player walks into and the room whose grain binds what they may say are the same room by construction.
 */
export type { Placed, RoomPlan } from '../mystery/plan';
import type { RoomPlan } from '../mystery/plan';
import { KETTLEWATER_HOUSE_PLAN_FROM_ONTOLOGY } from './plan.generated';
import { GREELEY_CHURCH_PLAN_FROM_ONTOLOGY } from './plan.greeley.generated';
export const KETTLEWATER_HOUSE_PLAN: Record<string, RoomPlan> = KETTLEWATER_HOUSE_PLAN_FROM_ONTOLOGY;
export const GREELEY_CHURCH_PLAN: Record<string, RoomPlan> = GREELEY_CHURCH_PLAN_FROM_ONTOLOGY;

/** THE PLAN A NIGHT IS DRAWN IN, chosen by the room it opens in — one string joins the place to the game. */
export function planFor(regionId: string): Record<string, RoomPlan> {
  return regionId === 'weld-county' ? GREELEY_CHURCH_PLAN : KETTLEWATER_HOUSE_PLAN;
}
