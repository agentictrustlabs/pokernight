/**
 * GENERATED FROM THE PLACE ONTOLOGY — do not edit by hand.
 *
 * Source: `~/skills/ontology/kettlewater-house.ttl` (an A-box over `place.ttl`).
 * Rebuild: `node scripts/place-to-plan.mjs > apps/web/src/components/mystery/plan.generated.ts`
 *
 * Every number below is stated in the ontology, in metres, against the bearing the building declares:
 * the origin at the middle of each room's floor, +X to the right, +Z away from the way you come in,
 * and a yaw of zero facing +Z. Changing the building is editing that file and running this one.
 */
import type { RoomPlan } from './plan';

export const KETTLEWATER_HOUSE_PLAN_FROM_ONTOLOGY: Record<string, RoomPlan> = {
  commons: {
    w: 8, d: 6,
    floor: "#5a4a38", wall: "#4a4a44", accent: "#8fd0a2",
    spots: [[-4, 1], [-2, 2.2], [0, 1], [2, 2.2], [4, 1], [-2.5, -1.5], [2.5, -1.5]],
    doors: { "agency-office": [-7.4, 2], household: [-7.4, -2], "research-desk": [7.4, 2], "funders-table": [7.4, -2], "the-road": [0, -5.4] },
    things: [
      { prim: { shape: "box", size: [5.2, 0.06, 1.1], colour: "#6a5138" }, x: 0, z: 0.2, y: 0.74 },
      { prim: { shape: "box", size: [0.12, 0.72, 0.9], colour: "#4a3626" }, x: -2.3, z: 0.2, y: 0.36 },
      { prim: { shape: "box", size: [0.12, 0.72, 0.9], colour: "#4a3626" }, x: 2.3, z: 0.2, y: 0.36 },
      { prim: { shape: "box", size: [3.2, 2, 0.05], colour: "#d8cfb8" }, x: 0, z: 5.8, y: 1.7, prop: "map", label: "the map" },
      { prim: { shape: "box", size: [1.8, 0.06, 0.02], colour: "#5a7fa8" }, x: -0.6, z: 5.76, y: 1.9 },
      { prim: { shape: "box", size: [1.6, 0.06, 0.02], colour: "#5a7fa8" }, x: 0.7, z: 5.76, y: 1.3, yaw: 35 },
      { prim: { shape: "box", size: [2.4, 1.6, 0.04], colour: "#3a3a36" }, x: -5.6, z: -5.8, y: 1.5, prop: "wall", label: "the wall" },
      { prim: { shape: "box", size: [0.3, 0.3, 0.01], colour: "#f2e26a" }, x: -6.3, z: -5.76, y: 1.9, yaw: 4 },
      { prim: { shape: "box", size: [0.3, 0.3, 0.01], colour: "#8fd0a2" }, x: -5.7, z: -5.76, y: 1.75, yaw: -6 },
      { prim: { shape: "box", size: [0.3, 0.3, 0.01], colour: "#f2a76a" }, x: -5, z: -5.76, y: 1.35, yaw: 3 },
    ],
  },
  "agency-office": {
    w: 4.5, d: 4,
    floor: "#4a4038", wall: "#3a4652", accent: "#c0c8d0",
    spots: [[-1.5, 0.5], [1.5, 0.5], [0, -1.5]],
    doors: { commons: [3.9, 0] },
    things: [
      { prim: { shape: "box", size: [1.8, 0.06, 0.8], colour: "#5a4230" }, x: 0, z: 2.6, y: 0.74 },
      { prim: { shape: "box", size: [0.4, 0.06, 0.3], colour: "#2a2420" }, x: 0.3, z: 2.6, y: 0.8, yaw: -8, prop: "ledger", label: "the ledger" },
      { prim: { shape: "box", size: [1.4, 1, 0.04], colour: "#e8e2d2" }, x: -3.2, z: 3.8, y: 1.6, prop: "roster", label: "the roster" },
    ],
  },
  household: {
    w: 3.5, d: 3.5,
    floor: "#5a3f2e", wall: "#4a3a30", accent: "#c9702a",
    spots: [[-1.4, 0.6], [0, -0.2], [1.4, 0.6]],
    doors: { commons: [2.9, 0] },
    things: [
      { prim: { shape: "box", size: [1.6, 1.2, 0.5], colour: "#3a3230" }, x: 0, z: 3.1, y: 0.6, prop: "hearth", label: "the hearth" },
      { prim: { shape: "box", size: [0.7, 0.5, 0.3], colour: "#e07a2a", glow: 0.6 }, x: 0, z: 3, y: 0.35 },
      { prim: { shape: "box", size: [0.5, 0.5, 0.5], colour: "#6a4a34" }, x: -1.4, z: 1.4, y: 0.25, yaw: 30 },
      { prim: { shape: "box", size: [0.5, 0.5, 0.5], colour: "#6a4a34" }, x: 0, z: 1.8, y: 0.25 },
      { prim: { shape: "box", size: [0.5, 0.5, 0.5], colour: "#6a4a34" }, x: 1.4, z: 1.4, y: 0.25, yaw: -30 },
    ],
  },
  "research-desk": {
    w: 4.5, d: 4,
    floor: "#4a4650", wall: "#3a3a46", accent: "#d8c8e8",
    spots: [[-1.2, 0.5], [1.2, 0.5], [0, -1.6]],
    doors: { commons: [-3.9, 0] },
    things: [
      { prim: { shape: "box", size: [2.6, 1.5, 0.04], colour: "#2a3230" }, x: 0, z: 3.8, y: 1.7, prop: "slate", label: "the slate" },
      { prim: { shape: "box", size: [1.8, 0.06, 0.8], colour: "#4a3a5a" }, x: 0, z: 2.4, y: 0.74 },
    ],
  },
  "funders-table": {
    w: 4, d: 4,
    floor: "#3a3a3a", wall: "#2b333a", accent: "#b8973f",
    spots: [[0, 1.9], [1.9, 0], [0, -1.9], [-1.9, 0]],
    doors: { commons: [-3.4, 0] },
    things: [
      { prim: { shape: "cylinder", size: [1.4, 0.06, 1.4], colour: "#5a4230" }, x: 0, z: 0, y: 0.74, prop: "table", label: "the table" },
      { prim: { shape: "cylinder", size: [0.16, 0.72, 0.16], colour: "#3a2418" }, x: 0, z: 0, y: 0.36 },
    ],
  },
  "the-road": {
    w: 6, d: 5,
    floor: "#5a5a50", wall: "#7a8a92", accent: "#c9a227",
    spots: [[0, 0]],
    doors: { commons: [0, 4.4] },
    things: [
      { prim: { shape: "box", size: [0.35, 0.9, 0.25], colour: "#8a8a80" }, x: 2.5, z: -1.5, y: 0.45, prop: "milestone", label: "the milestone" },
    ],
  },
};

