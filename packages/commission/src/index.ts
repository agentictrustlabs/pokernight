/**
 * @pokernight/commission — Great Commission, a substrate test played as a game (docs/GREAT-COMMISSION.md).
 *
 * The engine is pure; the regions and scenarios are CONTENT; the host (`CommissionDO`) owns the clock and the
 * sockets. A second scenario in these marches is a new object in `worlds/`, not a fork.
 */
export * from './types.js';
export * from './engine.js';
export { chooseAction, type CastLines } from './cast.js';
export { CHARACTER_CRAFT, DIRECTOR_CRAFT } from './craft.js';

import type { Region, Scenario } from './types.js';
import { FIRST_LIGHT, KETTLEWATER_MARCHES, SECOND_WINTER } from './worlds/kettlewater.js';
// WELD COUNTY IS COMPILED, NOT HAND-WRITTEN. The marches keep a hand-written twin because the round-trip test
// is what proves the generator faithful; a second world does not need proving twice, and a real county's
// figures belong in one place — the A-box that cites them.
import { WELD_COUNTY_FROM_ONTOLOGY, THURSDAY_IN_GREELEY_FROM_ONTOLOGY } from './worlds/weld.generated.js';

export { FIRST_LIGHT, KETTLEWATER_MARCHES, SECOND_WINTER };
export const WELD_COUNTY = WELD_COUNTY_FROM_ONTOLOGY;
export const THURSDAY_IN_GREELEY = THURSDAY_IN_GREELEY_FROM_ONTOLOGY;

export const REGIONS: Record<string, Region> = { [KETTLEWATER_MARCHES.id]: KETTLEWATER_MARCHES, [WELD_COUNTY.id]: WELD_COUNTY };
export const SCENARIOS: Record<string, Scenario> = { [FIRST_LIGHT.id]: FIRST_LIGHT, [SECOND_WINTER.id]: SECOND_WINTER, [THURSDAY_IN_GREELEY.id]: THURSDAY_IN_GREELEY };
/** THE NIGHT A NEW STAGING OPENS ON: a real county, a picture that says one word about five peoples, and seven
 *  people who each hold a piece of it. The marches remain, as the invented twin. */
export const DEFAULT_SCENARIO = THURSDAY_IN_GREELEY.id;

export function scenarioOf(id: string): Scenario | undefined { return SCENARIOS[id]; }
export function regionOf(id: string): Region | undefined { return REGIONS[id]; }
export function stagingOf(scenarioId: string): { scenario: Scenario; region: Region } | null {
  const scenario = SCENARIOS[scenarioId];
  const region = scenario ? REGIONS[scenario.region] : undefined;
  return scenario && region ? { scenario, region } : null;
}
