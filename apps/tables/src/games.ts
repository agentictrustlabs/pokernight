/**
 * The games this deployment can host.
 *
 * ONE LINE PER GAME, and that is the whole point of the registry. A second game arrives as a package
 * with its own engine and its own adapter (`@pokernight/table-game`), gets added here, and nothing
 * in the table object, the lobby, the clubs or the settlement path knows it happened.
 *
 * POKER IS THE DEFAULT, and it has to be: every table created before games were named has no `game`
 * stamped on it, and every one of those is a poker table. `DEFAULT_GAME` is what they are read as,
 * exactly as `LEGACY_CHIP_VALUE` is what tables older than the rate pin settle at.
 */

import { decide, handRead, observeRound, readHand } from '@pokernight/agent-kit';
import { canastaGame, legalFor as canastaLegalFor, viewFor as canastaViewFor, type CanastaState } from '@pokernight/canasta';
import { chooseCanastaAction, explainMove } from '@pokernight/canasta-agent';
import {
  legalActions as pokerLegalFor,
  pokerGame,
  viewFor as pokerViewFor,
  POKER_GAME_ID,
  type TableState as PokerState,
} from '@pokernight/engine';
import { POKER_ACT_SKILL } from '@pokernight/protocol';
import { createGameRegistry, type Advice, type GameId, type HostedGame } from '@pokernight/table-game';

export const DEFAULT_GAME: GameId = POKER_GAME_ID;

/**
 * Canasta, with a COACH bolted on.
 *
 * The strategy lives in `@pokernight/canasta-agent`, which depends on the canasta engine — so the
 * engine cannot depend back on it, and `canastaGame` cannot carry its own coach without a cycle.
 * Composing the two HERE is the right place anyway: an app is what decides which of the things it
 * has installed get wired to each other, and a rules engine has no business knowing that somebody
 * wrote a strategy for it.
 *
 * The coach reads `viewFor(state, seat)` — the seat's own redacted view, the same pair a human or an
 * agent is given. A coach reasoning from the full state would explain moves using cards the learner
 * cannot see, which teaches them a way of playing they can never reproduce alone.
 */
const canastaWithCoach: HostedGame = {
  ...(canastaGame as unknown as HostedGame),
  advise(state: unknown, seat: number): Advice | null {
    const s = state as CanastaState;
    const round = s.round;
    if (!round || round.result || round.toAct !== seat) return null;
    const view = canastaViewFor(s, seat);
    const { action } = chooseCanastaAction(view, canastaLegalFor(s, seat), seat);
    const { say, because } = explainMove(view, seat, action);
    return { action, say, because };
  },
};

/**
 * HOLD'EM, with a COACH bolted on — the same composition as canasta's, for the same reason.
 *
 * The strategy and the words both live in `@pokernight/agent-kit`, which depends on the poker engine;
 * the engine cannot depend back on it, so `pokerGame` cannot carry its own coach without a cycle.
 * Composing them here is also just correct: deciding which installed things get wired to each other
 * is an app's job, and a rules engine has no business knowing somebody wrote a strategy for it.
 *
 * THE MOVE AND THE WORDS COME FROM DIFFERENT PLACES, on purpose. `decide` picks the line; `readHand`
 * says what is true about the spot — the price, the number of opponents, position, the stack behind.
 * A coach that explained itself by paraphrasing its own decision would teach the decision. What a
 * learner needs is the reading, which they can apply to a hand this coach never saw.
 *
 * NO RANDOMNESS: `rng: () => 1` takes every mixed line off the table, so the coach never semi-bluffs,
 * never slow-plays and never bluffs a river. Two reasons. Advice that changes when you ask again is
 * not advice. And the straightforward value line is the one a beginner should be able to reproduce —
 * a coach that shoved a bluff and could not say why would be teaching the wrong lesson twice.
 */
const pokerWithCoach: HostedGame = {
  ...(pokerGame as unknown as HostedGame),
  advise(state: unknown, seat: number): Advice | null {
    const s = state as PokerState;
    const hand = s.hand;
    if (!hand || hand.result !== undefined || hand.toAct !== seat) return null;
    const view = pokerViewFor(s, seat);
    const legal = pokerLegalFor(s, seat);
    // The ENVELOPE is filler and is never read: `decide` reasons from `view` and `legal` alone. A
    // coach holds the state rather than a turn request, so there is no request to quote here.
    const { action, note } = decide({
      skill: POKER_ACT_SKILL,
      tableId: '',
      handNo: hand.handNo,
      seat,
      view,
      legal,
      deadlineMs: 0,
    }, { rng: () => 1 });
    const { say, because } = readHand(view, seat, legal);
    // CERTAIN when the solver's chart saw this spot often and never disagreed: "chart fine BB|1|0|AKs:
    // 77 spots, 100% agree" is not a rule of thumb, and a person's own agent asked about it would spend
    // eight seconds and its tokens to say "raise" back. The bar is deliberately high — unanimous, and
    // dozens of spots — so anything with a real choice in it still goes to whoever they named.
    const m = /^chart \w+ (\S+): (\d+) spots, (\d+)% agree$/.exec(note ?? '');
    const certain = m && Number(m[3]) >= 100 && Number(m[2]) >= 50 ? { because: `the solver saw this spot ${m[2]} times and never disagreed` } : undefined;
    return { action, say, because, ...(certain ? { certain } : {}) };
  },
  // The same facts as fields, for an adviser that reasons rather than looks up: the price, the outs,
  // position, the money behind, what the cards have made. Handed these, a model at somebody's Home
  // does not fold from the big blind when checking is free — which is what computing them wrong looked
  // like, live.
  readFor(state: unknown, seat: number): unknown {
    const s = state as PokerState;
    if (!s.hand || s.hand.toAct !== seat) return null;
    return handRead(pokerViewFor(s, seat), seat, pokerLegalFor(s, seat));
  },
  // The finished hand as counts, for the person's own adviser to remember: who put money in, who
  // raised, who folded to a bet, who showed down. From the seat's own view, so nothing the seat could
  // not see is counted; the card room keeps none of it.
  observeFor(state: unknown, seat: number): unknown {
    const s = state as PokerState;
    if (!s.hand?.result) return null;
    return observeRound(pokerViewFor(s, seat), seat);
  },
};

// ONE LINE PER GAME. Each brings its own engine and its own adapter; neither knows the other.
const registry = createGameRegistry([pokerWithCoach, canastaWithCoach]);

/** Every game id this deployment will open a table for. */
export function gameIds(): GameId[] {
  return registry.ids();
}

/**
 * The game a table plays, refused BY NAME when this deployment does not have it.
 *
 * A table stamped with a game the code no longer ships is a real possibility — a deployment rolled
 * back, a package removed — and it must fail loudly here rather than silently becoming poker. The
 * table's own stamp is the truth about what it is; a wrong guess would deal the wrong game to
 * people whose money is already on it.
 */
export function gameFor(id: GameId | undefined): HostedGame {
  const wanted = (id ?? DEFAULT_GAME).trim() || DEFAULT_GAME;
  const game = registry.get(wanted);
  if (!game) throw new Error(`this card room does not deal "${wanted}" — it deals ${registry.ids().join(', ')}`);
  return game;
}

/**
 * WHAT A PRACTICE TABLE IS SET TO, per game — one place, read on creation AND on "start over".
 *
 * Poker's default 30 s turn is right for a money table and wrong for the one table that exists to
 * be learnt at: reading the advice, and the 15–20 s a person's own agent at their Home takes to write
 * it, do not fit inside it. Canasta already runs 90 s by default for the same reason. `reset` used to
 * rebuild from `{}`, so a practice table dealt again went back to the money clock — the setting was
 * true for exactly one game per table.
 */
export function practiceConfigFor(id: GameId | undefined): Record<string, unknown> {
  return (id ?? DEFAULT_GAME) === POKER_GAME_ID ? { actionTimeoutMs: 60_000 } : {};
}
