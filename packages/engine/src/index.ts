/**
 * @pokernight/engine — public API.
 *
 * All functions are pure: they take a state and return a new state (never
 * mutating the input). Errors are thrown as `EngineError` with a stable code.
 *
 * Implementation lives in ./cards, ./evaluate, ./rng, ./table. This file is the
 * contract that the table service, the web client, and agents compile against.
 */

export * from './types.js';

export { parseCard, cardToString, fullDeck, RANKS, SUITS, rankValue } from './cards.js';
export { evaluateHand, compareHands } from './evaluate.js';
export { seededShuffle, seedCommit, randomSeed, bytesToHex, hexToBytes } from './rng.js';
export {
  createTable,
  sitDown,
  standUp,
  addChips,
  sitOut,
  sitIn,
  canStartHand,
  startHand,
  legalActions,
  applyAction,
  timeoutAction,
  setActionDeadline,
  viewFor,
  redactEvent,
  DEFAULT_CONFIG,
} from './table.js';
