/**
 * @pokernight/agent-kit — helpers and a rules-based baseline for poker agents.
 *
 *   view      read a redacted TableView: hole cards, pot, odds, position, street
 *   preflop   Chen-style hand classification and a position chart
 *   strength  postflop made-hand class and draws (evaluator injectable)
 *   strategy  `decide(PokerActInput) -> PokerActOutput`, always legal
 */

export * from './view.js';
export * from './preflop.js';
export * from './strength.js';
export * from './strategy.js';
export * from './explain.js';
