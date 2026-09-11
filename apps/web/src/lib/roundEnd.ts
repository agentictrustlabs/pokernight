/**
 * THE END OF A ROUND IS A MOMENT, and this is what to make of it.
 *
 * A round of canasta takes twenty minutes and ends in about a tenth of a second: somebody discards
 * their last card, the scores jump, the board clears, and the next deal is already on the table. Two
 * things are lost in that tenth of a second. The FEELING — four canastas and a concealed going-out
 * deserve more than a number changing — and the EVIDENCE, because the board that explains where the
 * number came from is gone before anybody has looked at it.
 *
 * So the round ends behind a curtain: what happened, how it scored, and the board still underneath it
 * to look at. Winning gets a celebration. Losing gets CREDIT for the best thing that side actually
 * did, which is a different thing from consolation — "you were unlucky" is a lie a beginner can hear
 * as often as they like and learn nothing from, and "your three canastas were worth a thousand of
 * that" is true and is the reason to play the next one.
 *
 * Pure: given a result and which side you are, it says what to show.
 */

import { scoreLines, scoreParts, type RoundResult, type TeamScore } from './scoreWords';

/** How it went for the person reading it. A spectator gets neither — there is no side to be on. */
export type Mood = 'won' | 'lost' | 'level' | 'watching';

export interface Curtain {
  /**
   * A ROUND OR THE WHOLE GAME. The difference is not decoration: a round ending is an interval and a
   * game ending is the end, and offering "next round" at the end of a game is offering a move that
   * does not exist.
   */
  scope: 'round' | 'game';
  mood: Mood;
  /** Three or four words, big. */
  headline: string;
  /** One sentence under it — the fact, not a feeling. */
  detail: string;
  /** CREDIT, on a loss: the largest true thing that side earned. Null when there is nothing to name. */
  credit: string | null;
  /** The round's arithmetic, the same lines the coach reads out. */
  lines: string[];
}

/** Which side a seat plays for. Seats 0 and 2 are one side, 1 and 3 the other. */
export function teamOfSeat(seat: number | null): 0 | 1 | null {
  return seat == null ? null : ((seat % 2) as 0 | 1);
}

/**
 * The biggest thing one side genuinely earned this round, in words.
 *
 * `scoreParts` already lists every non-zero part, longest first — and the first entry is the melds,
 * which is nearly always the biggest and nearly always the least interesting. So this reaches for the
 * parts somebody can be pleased about: canastas first, then going out, then red threes. Cards on the
 * table is the fallback, and a side that scored nothing at all gets no sentence rather than a limp one.
 */
export function creditFor(s: TeamScore | undefined): string | null {
  if (!s) return null;
  if (s.canastas > 0) {
    const bits: string[] = [];
    if (s.naturalCanastas > 0) bits.push(`${s.naturalCanastas} natural`);
    if (s.mixedCanastas > 0) bits.push(`${s.mixedCanastas} mixed`);
    const n = s.naturalCanastas + s.mixedCanastas;
    return `${n === 1 ? 'A canasta' : `${n} canastas`}${bits.length ? `, ${bits.join(' and ')}` : ''} — ${s.canastas} of your ${s.total}.`;
  }
  if (s.goingOut > 0) return `You went out, which is ${s.goingOut} nobody can take back.`;
  if (s.redThrees > 0) return `Your red threes were worth ${s.redThrees}.`;
  if (s.melds > 0) return `You had ${s.melds} on the table when it ended.`;
  return null;
}

/**
 * What to put on the curtain.
 *
 * `winner` is the GAME's winner and is null while the game is still running — which is the only way
 * to tell a round ending from a game ending, because the last round of a game ends exactly like every
 * other one and the score is what makes it the last.
 */
export function curtainFor(
  result: RoundResult | null | undefined,
  mySeat: number | null,
  winner: 0 | 1 | null | undefined,
  nameOf?: (seat: number) => string,
): Curtain | null {
  if (!result) return null;
  const myTeam = teamOfSeat(mySeat);
  const scope: 'round' | 'game' = winner === 0 || winner === 1 ? 'game' : 'round';
  const mine = myTeam ?? 0;
  const theirs = ((mine + 1) % 2) as 0 | 1;
  const us = result.scores[mine] as TeamScore | undefined;
  const them = result.scores[theirs] as TeamScore | undefined;
  const lines = scoreLines(result, myTeam, nameOf, mySeat);

  if (myTeam === null) {
    // A SPECTATOR HAS NO SIDE, so there is nothing to celebrate on their behalf. Saying "you win" to
    // somebody who was not playing is the app inventing a stake they never had.
    return {
      scope,
      mood: 'watching',
      headline: scope === 'game' ? 'That is the game' : `Round over`,
      detail:
        scope === 'game'
          ? `Side ${(winner as 0 | 1) + 1} takes it, ${result.totals[winner as 0 | 1]} to ${result.totals[(((winner as 0 | 1) + 1) % 2) as 0 | 1]}.`
          : `${result.totals[0]} against ${result.totals[1]}.`,
      credit: null,
      lines,
    };
  }

  if (scope === 'game') {
    const won = winner === myTeam;
    return {
      scope,
      mood: won ? 'won' : 'lost',
      headline: won ? 'You win the game' : 'They take the game',
      detail: won
        ? `${result.totals[mine]} to ${result.totals[theirs]}. That is the whole thing.`
        : `${result.totals[theirs]} to your ${result.totals[mine]}.`,
      // Credit on the way out, never on the way to a win — a winner does not need the consolation and
      // reading one would take the shine off.
      credit: won ? null : creditFor(us),
      lines,
    };
  }

  const usTotal = us?.total ?? 0;
  const themTotal = them?.total ?? 0;
  const mood: Mood = usTotal > themTotal ? 'won' : usTotal < themTotal ? 'lost' : 'level';
  const ahead = (result.totals[mine] ?? 0) - (result.totals[theirs] ?? 0);
  return {
    scope,
    mood,
    headline: mood === 'won' ? 'Your round' : mood === 'lost' ? 'Their round' : 'Level round',
    detail:
      `${usTotal} to ${themTotal} this round. ` +
      (ahead > 0 ? `You are ${ahead} ahead.` : ahead < 0 ? `You are ${Math.abs(ahead)} behind.` : 'The game is level.'),
    credit: mood === 'lost' ? creditFor(us) : null,
    lines,
  };
}

/** Whether the curtain should be noisy. Losing a round you scored well in is not a party. */
export function celebrates(c: Curtain | null): boolean {
  return c?.mood === 'won';
}

/** The parts of the OTHER side's round, for the scoresheet under the curtain. */
export function theirParts(result: RoundResult | null | undefined, mySeat: number | null): string[] {
  if (!result) return [];
  const mine = teamOfSeat(mySeat) ?? 0;
  const theirs = ((mine + 1) % 2) as 0 | 1;
  return scoreParts(result.scores[theirs] as TeamScore);
}
