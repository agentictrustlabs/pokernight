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

import { canastaGame, legalFor as canastaLegalFor, viewFor as canastaViewFor, type CanastaState } from '@pokernight/canasta';
import { chooseCanastaAction, explainMove } from '@pokernight/canasta-agent';
import { pokerGame, POKER_GAME_ID } from '@pokernight/engine';
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

// ONE LINE PER GAME. Each brings its own engine and its own adapter; neither knows the other.
const registry = createGameRegistry([pokerGame, canastaWithCoach]);

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
