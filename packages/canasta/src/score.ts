/**
 * Scoring a round.
 *
 * Five terms, and one of them can be negative twice over. A side is paid for the cards it has on the
 * table and for its canastas, paid or CHARGED for its red threes depending on whether it ever melded
 * at all, paid for going out, and charged for everything still in both partners' hands.
 *
 * The red-three rule is the one worth stating out loud, because it is the only place in the game
 * where a card turns on you: a hundred points each while you are playing, minus a hundred each if
 * your side never got a meld down. All four is worth two hundred apiece — and minus two hundred
 * apiece the other way, which is an eight-hundred point swing on cards nobody chose to hold.
 */

import { handValue } from './cards.js';
import { canastaBonus, meldedCardValue } from './meld.js';
import type { CanastaResult, RoundState, TeamId, TeamScore } from './types.js';
import { teamOf } from './types.js';

export const GOING_OUT = 100;
export const GOING_OUT_CONCEALED = 200;

/** 100 a red three, or 200 each when a side has all four. */
export function redThreeValue(count: number): number {
  if (count === 0) return 0;
  return count === 4 ? 800 : count * 100;
}

const TEAMS: readonly TeamId[] = [0, 1];

/** Negate, but keep zero positive. A score of `-0` is the same number and reads as a mistake. */
const negate = (n: number): number => (n === 0 ? 0 : -n);

/**
 * Score a finished round.
 *
 * `wentOut` is the seat that emptied its hand, or null when the stock ran out and nobody did — a
 * legitimate way for a round to end, and one where nobody is paid the going-out bonus but everybody
 * is still charged for what they are holding.
 */
export function scoreRound(
  round: RoundState,
  running: Record<TeamId, number>,
  outcome: { wentOut: number | null; concealed: boolean },
): CanastaResult {
  const { wentOut, concealed } = outcome;
  const seats = Object.keys(round.hands).map(Number);
  const scores = {} as Record<TeamId, TeamScore>;

  for (const team of TEAMS) {
    const melds = round.melds[team];
    const opened = melds.length > 0;
    const bonus = canastaBonus(melds);
    const reds = round.redThrees[team].length;

    // The sign is the whole rule: a side that never melded is CHARGED for the threes it was lucky
    // enough to draw. Reading it as a bonus and then subtracting elsewhere is how this gets wrong.
    const redThrees = opened ? redThreeValue(reds) : negate(redThreeValue(reds));

    const inHand = negate(
      seats.filter((seat) => teamOf(seat) === team).reduce((n, seat) => n + handValue(round.hands[seat] ?? []), 0),
    );

    const goingOut =
      wentOut !== null && teamOf(wentOut) === team ? (concealed ? GOING_OUT_CONCEALED : GOING_OUT) : 0;

    const meldValue = meldedCardValue(melds);
    scores[team] = {
      melds: meldValue,
      canastas: bonus.total,
      redThrees,
      goingOut,
      inHand,
      total: meldValue + bonus.total + redThrees + goingOut + inHand,
      naturalCanastas: bonus.natural,
      mixedCanastas: bonus.mixed,
    };
  }

  const totals = { 0: running[0] + scores[0].total, 1: running[1] + scores[1].total } as Record<TeamId, number>;
  return { wentOut, concealed, scores, totals };
}

/**
 * Which side, if either, has won.
 *
 * Only at the END of a round: a side that crosses the target mid-round keeps playing, because the
 * cards still in hand can take it back under. Both sides over means the higher total wins, and an
 * exact tie means nobody has won yet and another round is dealt — a game has to end with a winner.
 */
export function winnerAt(totals: Record<TeamId, number>, target: number): TeamId | null {
  const zero = totals[0] >= target;
  const one = totals[1] >= target;
  if (!zero && !one) return null;
  if (zero && !one) return 0;
  if (one && !zero) return 1;
  if (totals[0] === totals[1]) return null;
  return totals[0] > totals[1] ? 0 : 1;
}
