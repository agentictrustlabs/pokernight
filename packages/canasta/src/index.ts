/**
 * Classic Canasta — the four-handed partnership game.
 *
 * A pure engine and the adapter that makes it hostable. It shares nothing with poker except the
 * dealing primitives (`@pokernight/deal`) and the port it implements (`@pokernight/table-game`),
 * which is the point: games are not variants of each other, and each keeps its own rules.
 */

export * from './types.js';
export {
  RANKS,
  SUITS,
  JOKER,
  cardValue,
  fullDeck,
  handValue,
  isBlackThree,
  isMeldableRank,
  isRedThree,
  isWild,
  naturalsOfRank,
  rankOf,
  removeCards,
  suitOf,
} from './cards.js';
export {
  CANASTA_SIZE,
  MAX_WILDS_PER_MELD,
  MIN_MELD,
  applyMelds,
  canTakePile,
  canastaBonus,
  findMeld,
  hasCanasta,
  initialMeldMinimum,
  isCanasta,
  isLegalMeld,
  isNaturalCanasta,
  meldedCardValue,
  openingValue,
} from './meld.js';
export { GOING_OUT, GOING_OUT_CONCEALED, redThreeValue, scoreRound, winnerAt } from './score.js';
export {
  DEFAULT_CONFIG,
  HAND_SIZE,
  applyAction,
  canStartRound,
  createTable,
  legalFor,
  redactEvent,
  roundRunning,
  setActionDeadline,
  sitDown,
  sitIn,
  sitOut,
  standUp,
  startRound,
  timeoutAction,
  viewFor,
  type CanastaEvent,
  type CanastaView,
} from './table.js';
export { canastaGame, CANASTA_GAME_ID } from './game.js';
