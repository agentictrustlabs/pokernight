/**
 * @pokernight/fieldops — Field Operations, a season of field work played by real agents (docs/FIELD-OPERATIONS.md).
 *
 * The engine is pure; the region and the season are CONTENT compiled from the ontology and the public registry;
 * the host (`FieldOpsDO`) owns the clock, the sockets and the estate. A second season north of Denver is another
 * `fo:Season` in the A-box, not a fork.
 */
export * from './types.js';
export * from './engine.js';
export { floorCounts, phaseOf, generationsOf as churchGenerations, SOWING_CONVERSATIONS } from './phases.js';
export { chooseAction, type CastLines } from './cast.js';
export { CHARACTER_CRAFT, DIRECTOR_CRAFT } from './craft.js';
export { REGISTRY_COMMUNITIES, REGISTRY_READ_AT, type RegistryCommunity } from './worlds/registry.generated.js';

import type { Region, Scenario } from './types.js';
import { NORTHERN_COLORADO_FROM_ONTOLOGY, NORTH_OF_DENVER_FROM_ONTOLOGY } from './worlds/northern-colorado.generated.js';

export const NORTHERN_COLORADO = NORTHERN_COLORADO_FROM_ONTOLOGY;
export const NORTH_OF_DENVER = NORTH_OF_DENVER_FROM_ONTOLOGY;

export const REGIONS: Record<string, Region> = { [NORTHERN_COLORADO.id]: NORTHERN_COLORADO };
/** ORDER MATTERS: the front door's card opens on the first of these. */
export const SCENARIOS: Record<string, Scenario> = { [NORTH_OF_DENVER.id]: NORTH_OF_DENVER };
export const DEFAULT_SCENARIO = NORTH_OF_DENVER.id;

export function scenarioOf(id: string): Scenario | undefined { return SCENARIOS[id]; }
export function regionOf(id: string): Region | undefined { return REGIONS[id]; }
export function stagingOf(scenarioId: string): { scenario: Scenario; region: Region } | null {
  const scenario = SCENARIOS[scenarioId];
  const region = scenario ? REGIONS[scenario.region] : undefined;
  return scenario && region ? { scenario, region } : null;
}
