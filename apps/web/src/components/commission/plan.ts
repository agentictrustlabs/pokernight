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
export const KETTLEWATER_HOUSE_PLAN: Record<string, RoomPlan> = KETTLEWATER_HOUSE_PLAN_FROM_ONTOLOGY;
