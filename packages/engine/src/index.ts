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
// The dealing primitives are `@pokernight/deal`'s and belong to no game; re-exported so poker's
// own public surface is unchanged by their moving out.
export { seededShuffle, seedCommit, randomSeed, bytesToHex, hexToBytes } from '@pokernight/deal';
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

// Poker as a game the table service can host — the adapter, never the rules (`game.ts`).
export { pokerGame, POKER_GAME_ID } from './game.js';
