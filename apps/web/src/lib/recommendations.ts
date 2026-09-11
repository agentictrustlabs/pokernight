/**
 * A ROLLING LIST OF RECOMMENDATIONS, and what it is allowed to forget.
 *
 * One line at a time is right for a voice and wrong for a screen: advice arrives per turn, a person
 * looks up between turns, and the thing they want is not the latest sentence but the last few — "what
 * did my partner say about the pile again?". So the panel keeps a short history.
 *
 * THREE RULES, all about not becoming noise:
 *
 *   THE SAME ADVICE TWICE IS ONE ENTRY. A coach asked again mid-turn answers the same thing, and a
 *   list that grew every time would bury the turn before under four copies of this one.
 *
 *   IT IS SHORT AND IT DROPS THE OLDEST. A scrolling wall is a wall nobody reads.
 *
 *   WHOSE ADVICE IT WAS TRAVELS WITH IT. The house coach and the person's own agent both land here
 *   and they are not the same voice. An entry that lost its source would be the app quietly passing
 *   one off as the other.
 *
 * Pure, because "what is on the list" is a decision worth reading as a table of cases.
 */

import type { CoachAdvice } from './api';

export interface Recommendation {
  /** Monotonic, so React keys are stable as the list is trimmed. */
  id: number;
  say: string;
  because?: string;
  /** The house's coach, or the agent this person named. Never dropped. */
  from: 'house' | { agent: string; displayName: string };
  /** Which round it was about, so a list read later is not mistaken for now. */
  round: number;
  at: number;
}

/** How many to keep. Enough to answer "what did it say last turn", short of being a transcript. */
export const KEEP = 6;

/** Who said it, in the words a screen shows. */
export function whoSaid(from: Recommendation['from']): string {
  return from === 'house' ? 'the house coach' : from.displayName;
}

/**
 * Add one piece of advice to the list, or recognise it as one already there.
 *
 * Identity is the SENTENCE plus the round plus the source: the same words from the same adviser about
 * the same round is the same advice, however many times it was asked for. The same words in a new
 * round is genuinely new — "take the pile" means something different on a different deal.
 */
export function remember(
  list: readonly Recommendation[],
  advice: CoachAdvice | null,
  round: number,
  now = Date.now(),
  nextId = (list[0]?.id ?? 0) + 1,
): Recommendation[] {
  const say = (advice?.say ?? '').trim();
  if (!say) return [...list];
  const from = advice?.source ?? 'house';
  const same = list.find((r) => r.say === say && r.round === round && whoSaid(r.from) === whoSaid(from));
  if (same) return [...list];
  const entry: Recommendation = {
    id: nextId,
    say,
    ...(advice?.because?.trim() ? { because: advice.because.trim() } : {}),
    from,
    round,
    at: now,
  };
  // Newest first: a person looking up mid-hand reads from the top and stops when they have what they
  // came for.
  return [entry, ...list].slice(0, KEEP);
}

/** Everything about the round being played, for a list that should not carry a finished one. */
export function forRound(list: readonly Recommendation[], round: number): Recommendation[] {
  return list.filter((r) => r.round === round);
}
