/**
 * Saying WHY, in a sentence somebody learning the game can act on.
 *
 * The strategy's own `note` is a log label — "draw", "take the pile of 9 on 7C". That is the right
 * thing to write beside a move in a hand history and the wrong thing to say to a person: it reports
 * what happened and teaches nothing about why it was right.
 *
 * So this is a second pass over the same decision, and its job is different. Every sentence here
 * names the RULE the move turns on, because the rules are what a beginner is missing — not the
 * arithmetic. "Your side has not opened, and this is fifty" is a lesson. "Melding 3 cards" is not.
 *
 * TWO SENTENCES, and the split matters.
 *
 *   `say`     one clause, spoken aloud while the move happens. Short enough to finish before the
 *             next turn starts, and written to be HEARD — no card codes, no punctuation a voice
 *             would stumble on, ranks said the way a person says them.
 *   `because` the rule behind it, read on screen. Longer, and the part that is actually teaching.
 *
 * Pure, like everything else here: same view, same move, same words.
 */

import {
  CANASTA_SIZE,
  cardValue,
  hasCanasta,
  initialMeldMinimum,
  isWild,
  rankOf,
  teamOf,
  type CanastaAction,
  type CanastaView,
  type Card,
  type Rank,
} from '@pokernight/canasta';

export interface Explanation {
  /** One clause, meant to be spoken. */
  say: string;
  /** The rule behind it, meant to be read. */
  because: string;
}

/** Ranks as a person says them out loud. A voice reading "T" says "tee". */
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

export function spokenRank(rank: string, plural = false): string {
  const word = SPOKEN[rank] ?? rank;
  if (!plural) return word;
  // "sixes". The one irregular plural in a deck of cards, and the one a voice reading "sixs"
  // makes obvious immediately.
  return word.endsWith('x') ? `${word}es` : `${word}s`;
}

/** A card as a person says it: "the seven of clubs", "a joker". */
export function spokenCard(card: Card): string {
  const r = rankOf(card);
  if (r === 'W') return 'a joker';
  const suit = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' }[card[1] ?? ''] ?? '';
  return suit ? `the ${spokenRank(r)} of ${suit}` : spokenRank(r);
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Explain one move.
 *
 * `view` is the seat's OWN redacted view — the same thing the strategy saw. A coach that explained
 * from the full state would be teaching with cards the learner cannot see, which is worse than not
 * teaching: it produces reasoning they can never reproduce for themselves.
 */
export function explainMove(view: CanastaView, seat: number, action: CanastaAction): Explanation {
  const team = teamOf(seat);
  const hand = view.hand ?? [];
  const melds = view.melds[team];
  const opened = melds.length > 0;
  const minimum = initialMeldMinimum(view.scores[team]);

  switch (action.type) {
    case 'draw': {
      const why = pileRefusal(view, hand, team);
      return {
        say: 'Drawing from the stock.',
        because: why
          ? `Taking the discard pile is the bigger move when it is on — a dozen cards at once — but ${why} So the stock it is.`
          : 'Nothing in the pile is worth what it would cost from hand, so take the safe card. Most turns are this one.',
      };
    }

    case 'take-pile': {
      const top = view.pileTop ?? '';
      const rank = rankOf(top);
      const used = action.meld.cards.length;
      return {
        say: `Taking the whole pile, ${count(view.pileSize, 'card')}, on ${spokenCard(top)}.`,
        because: [
          `The pile is the biggest swing in canasta and this is what it costs: ${count(used, 'natural ' + spokenRank(rank))} out of hand to claim the top card.`,
          `Everything under it comes too — ${count(view.pileSize, 'card')} in one move — which is how a side goes from nothing down to a canasta in a turn.`,
          view.frozen
            ? 'The pile was frozen, so only two natural cards of the top rank could have taken it. Wild cards would not do.'
            : 'Watch for a wild card or a black three landing on top: either one stops the pile dead.',
        ].join(' '),
      };
    }

    case 'meld': {
      const laid = action.melds;
      const cards = laid.flatMap((m) => m.cards);
      const value = cards.reduce((a, c) => a + cardValue(c), 0);
      const ranks = laid.map((m) => spokenRank(m.rank as Rank, true)).join(' and ');
      const wilds = cards.filter(isWild).length;
      const nearCanasta = laid.some((m) => {
        const existing = melds.find((x) => x.rank === m.rank);
        return (existing?.cards.length ?? 0) + m.cards.length >= CANASTA_SIZE;
      });

      if (!opened) {
        return {
          say: `Opening with ${ranks}, worth ${value}.`,
          because: [
            `A side cannot put anything on the table until its FIRST meld reaches a minimum, and yours is ${minimum} because that is what your score requires.`,
            `This is ${value}, so it goes down.`,
            'The minimum rises as you win — fifty at the start, ninety past fifteen hundred, a hundred and twenty past three thousand — so the side that is ahead has to work harder to get started.',
          ].join(' '),
        };
      }
      if (nearCanasta) {
        return {
          say: `Melding ${ranks} — that is a canasta.`,
          because: `Seven of a rank is a canasta, and canastas are what the game is for: five hundred if every card is natural, three hundred if any wild is in it. You also cannot go out at all until your side has one.`,
        };
      }
      return {
        say: `Laying down ${ranks}.`,
        because: [
          `Melded cards are safe — they score for your side whatever happens to the hand you are still holding, and the cards left in your hand count AGAINST you when the round ends.`,
          wilds > 0
            ? `This spends ${count(wilds, 'wild card')}. Wilds are worth keeping back: a meld holds at most three, and one saved is one available when a canasta is within reach.`
            : 'No wilds spent, which is the right instinct — keep them for the meld that becomes a canasta.',
        ].join(' '),
      };
    }

    case 'discard': {
      const card = action.card;
      const rank = rankOf(card);
      const theirs = view.melds[((team + 1) % 2) as 0 | 1];
      const gift = theirs.some((m) => m.rank === rank) && !view.frozen;
      const canGoOut = hasCanasta(melds);
      if (hand.length === 1) {
        return {
          say: `Going out on ${spokenCard(card)}.`,
          because: 'The last card ends the round, and it can only be played with a canasta on your side. Everyone else is caught with whatever is still in their hand, and it counts against them.',
        };
      }
      const cost = cardValue(card);
      return {
        say: cost >= 20 ? `Discarding ${spokenCard(card)} — too dear to hold.` : `Discarding ${spokenCard(card)}.`,
        because: [
          'Every turn ends with a discard, so the question is only which card hurts least.',
          gift
            ? `This one is a small risk: they have ${spokenRank(rank, true)} on the table, so they can take the pile with it. Nothing safer was worth keeping.`
            : isWild(card)
              ? 'A wild card freezes the pile — against your own side as much as theirs — so this is a last resort.'
              : `Low cards cost least if you are caught holding them, and this rank gives the other side nothing to take the pile with.`,
          // THE COST OF BEING CAUGHT WITH IT. Everything left in hand counts AGAINST your side when
          // somebody goes out, and the expensive cards are the ones a beginner hoards: a joker is
          // fifty against you, a two or an ace twenty. Holding wilds for a canasta that never comes
          // is the single most expensive habit in the game.
          cost >= 20
            ? `And it is worth ${cost} against you if somebody goes out while it is still in your hand — the most expensive card here to be caught with.`
            : '',
          canGoOut ? 'Your side has a canasta, so you may go out whenever the hand can be emptied.' : '',
        ]
          .filter(Boolean)
          .join(' '),
      };
    }
  }
}

/** Why the pile is not being taken, in the words the rule is in. Empty when it simply was not worth it. */
function pileRefusal(view: CanastaView, hand: readonly Card[], team: 0 | 1): string {
  const top = view.pileTop;
  if (!top) return 'the pile is empty.';
  const rank = rankOf(top);
  if (isWild(top)) return 'there is a wild card on top, and a wild card stops the pile whatever you hold.';
  if (rank === '3') return 'there is a black three on top, which stops the pile for the next player.';
  const naturals = hand.filter((c) => !isWild(c) && rankOf(c) === rank).length;
  if (view.frozen && naturals < 2) {
    return `the pile is frozen, which means only two natural ${spokenRank(rank, true)} can take it, and there are ${naturals} in hand.`;
  }
  const haveMeld = view.melds[team].some((m) => m.rank === rank);
  if (naturals < 2 && !haveMeld) {
    return `taking it needs two natural ${spokenRank(rank, true)} in hand, or ${spokenRank(rank, true)} already on your table, and there are neither.`;
  }
  return '';
}
