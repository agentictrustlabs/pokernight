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

export { FIRST_LIGHT, KETTLEWATER_MARCHES, SECOND_WINTER };

export const REGIONS: Record<string, Region> = { [KETTLEWATER_MARCHES.id]: KETTLEWATER_MARCHES };
export const SCENARIOS: Record<string, Scenario> = { [FIRST_LIGHT.id]: FIRST_LIGHT, [SECOND_WINTER.id]: SECOND_WINTER };
export const DEFAULT_SCENARIO = FIRST_LIGHT.id;

export function scenarioOf(id: string): Scenario | undefined { return SCENARIOS[id]; }
export function regionOf(id: string): Region | undefined { return REGIONS[id]; }
export function stagingOf(scenarioId: string): { scenario: Scenario; region: Region } | null {
  const scenario = SCENARIOS[scenarioId];
  const region = scenario ? REGIONS[scenario.region] : undefined;
  return scenario && region ? { scenario, region } : null;
}
