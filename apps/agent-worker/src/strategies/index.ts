import type { StrategyName } from '../personas.js';
import { claudeStrategy } from './claude.js';
import { rulesStrategy } from './rules.js';
import type { Strategy } from './types.js';

export * from './types.js';
export { rulesStrategy, decideWithStyle, STYLES } from './rules.js';
export { claudeStrategy, ACTION_JSON_SCHEMA } from './claude.js';

const STRATEGIES: Record<StrategyName, Strategy> = { rules: rulesStrategy, claude: claudeStrategy };

/** True when this build actually has a strategy by that name. */
export function isKnownStrategy(name: string | undefined): name is StrategyName {
  return name !== undefined && name in STRATEGIES;
}

/** Resolve a strategy by name, falling back to the rules baseline for anything unrecognised. */
export function strategyFor(name: string | undefined): Strategy {
  return STRATEGIES[(name ?? '') as StrategyName] ?? rulesStrategy;
}
