/**
 * Cards and ranks in the words a person says.
 *
 * Split out from the coach's own explainer because BOTH sides of the table need them now: the
 * explanation of your own move, and the commentary on everybody else's. A voice reading `7C` says
 * "seven see", which is the difference between narration and noise.
 *
 * The same three lines exist in `@pokernight/canasta-agent`, and are copied here for the reason the
 * card predicates are: a value import from that package drags the canasta engine into this bundle.
 * `canasta.test.ts` holds the copies to the engine's own values; these are only spelling.
 */

const SPOKEN: Record<string, string> = {
  A: 'ace',
  K: 'king',
  Q: 'queen',
  J: 'jack',
  T: 'ten',
  '9': 'nine',
  '8': 'eight',
  '7': 'seven',
  '6': 'six',
  '5': 'five',
  '4': 'four',
  '3': 'three',
  '2': 'two',
  W: 'joker',
};

const SUITS: Record<string, string> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

export function spokenRank(rank: string, plural = false): string {
  const word = SPOKEN[rank] ?? rank;
  if (!plural) return word;
  // "sixes". The one irregular plural in a deck of cards, and the one a voice reading "sixs"
  // makes obvious immediately.
  return word.endsWith('x') ? `${word}es` : `${word}s`;
}

/** "the seven of clubs", "a joker". */
export function spokenCard(card: string): string {
  const r = card[0] ?? '';
  if (r === 'W') return 'a joker';
  const suit = SUITS[card[1] ?? ''];
  return suit ? `the ${spokenRank(r)} of ${suit}` : spokenRank(r);
}
