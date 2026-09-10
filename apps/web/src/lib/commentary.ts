/**
 * A running commentary on the table, so the silence between your turns is not a mystery.
 *
 * THE COMPLAINT THIS EXISTS FOR: "it sits for a while and then does something. I have no idea what
 * is going on." The pause is the other three players taking their turns, and the coach said nothing
 * about any of it — it only ever spoke about the learner's own move. So most of a round was silence
 * punctuated by something sudden.
 *
 * Watching the others play IS most of learning a card game. You find out what taking the pile looks
 * like by seeing somebody do it, not by being told the rule when your own turn comes round.
 *
 * TWO CHANNELS, and the split is what keeps it bearable.
 *
 *   `text`   everything, on screen. A short line per move, so the feed reads like a person at your
 *            shoulder saying what just happened.
 *   `speak`  only the moves worth interrupting for. Every draw and discard read aloud is constant
 *            chatter, and a table that talks over itself is one people mute — at which point they
 *            hear nothing at all, which is the failure this file is fixing.
 *
 * Pure, so what it says is testable without a browser or a voice.
 */

import { spokenCard, spokenRank } from './canastaWords';
import type { CanastaTableEvent } from './canasta';

/** A two-or-three word badge for the seat that just moved: "drew", "melded kings", "took the pile". */
export function seatBadge(ev: CanastaTableEvent): { seat: number; text: string } | null {
  switch (ev.type) {
    case 'drew':
      return { seat: ev.seat, text: 'drew' };
    case 'took-pile':
      return { seat: ev.seat, text: `took the pile (${ev.cards})` };
    case 'melded':
      return { seat: ev.seat, text: ev.canasta ? `canasta in ${spokenRank(ev.rank, true)}` : `melded ${spokenRank(ev.rank, true)}` };
    case 'discarded':
      return { seat: ev.seat, text: `discarded ${spokenCard(ev.card)}` };
    case 'red-three':
      return { seat: ev.seat, text: 'red three' };
    default:
      return null;
  }
}

export interface Line {
  /** What to show. Short: this is a feed, not a log. */
  text: string;
  /** Whether it is worth saying out loud. */
  speak: boolean;
  /**
   * Whether this was the VIEWER's own move.
   *
   * When the coach is playing their hand it has already announced the move and the reason before
   * making it, so saying it again as it lands is an echo — twice the words for one thing, in a
   * queue only three deep. On screen it reads as confirmation and stays.
   */
  mine?: boolean;
}

/**
 * One event as commentary, or null for the ones not worth a line.
 *
 * `you` is the viewer's seat, so the commentary can say "you" rather than reading your own name
 * back at you — a coach that narrates you in the third person sounds like it is talking to somebody
 * else about you.
 */
export function commentaryFor(
  ev: CanastaTableEvent,
  you: number | null,
  nameOf: (seat: number) => string,
): Line | null {
  const who = (seat: number): string => (seat === you ? 'You' : nameOf(seat));
  const does = (seat: number, verb: string, third: string): string => `${who(seat)} ${seat === you ? verb : third}`;
  const mine = (seat: number): { mine?: boolean } => (seat === you ? { mine: true } : {});

  switch (ev.type) {
    case 'round-started':
      return { text: `Round ${ev.roundNo} — ${does(ev.dealer, 'deal', 'deals')}. ${ev.stock} in the stock.`, speak: true };
    case 'upcard':
      return ev.frozen
        ? { text: `Turned up ${spokenCard(ev.card)} — the pile starts frozen.`, speak: true }
        : { text: `Turned up ${spokenCard(ev.card)}.`, speak: true };
    case 'red-three':
      return { text: `${does(ev.seat, 'lay', 'lays')} down a red three and ${ev.seat === you ? 'draw' : 'draws'} again.`, speak: true };
    case 'drew':
      // Said aloud too. This is most of what happens at a canasta table, and leaving it silent is
      // what made three of every four turns sound like nothing at all.
      return { text: `${does(ev.seat, 'draw', 'draws')}. ${ev.stock} left.`, speak: true, ...mine(ev.seat) };
    case 'took-pile':
      // The biggest move in the game. Always worth interrupting for, whoever made it.
      return { text: `${does(ev.seat, 'take', 'takes')} the pile — ${ev.cards} cards.`, speak: true, ...mine(ev.seat) };
    case 'melded':
      return ev.canasta
        ? { text: `${does(ev.seat, 'make', 'makes')} a canasta in ${spokenRank(ev.rank, true)}.`, speak: true, ...mine(ev.seat) }
        : { text: `${does(ev.seat, 'meld', 'melds')} ${ev.size} ${spokenRank(ev.rank, true)}.`, speak: true, ...mine(ev.seat) };
    case 'opened':
      // "Your side", not "You's side". A possessive is a different word, not a name with an s.
      return { text: `${ev.seat === you ? 'Your' : `${nameOf(ev.seat)}'s`} side opens with ${ev.value}.`, speak: true };
    case 'discarded':
      return {
        text: `${does(ev.seat, 'discard', 'discards')} ${spokenCard(ev.card)}${isWildCard(ev.card) ? ', freezing the pile' : ''}.`,
        speak: true,
        ...mine(ev.seat),
      };
    case 'round-ended':
      return {
        text:
          ev.result.wentOut === null
            ? 'The stock ran out. The round is scored.'
            : `${who(ev.result.wentOut)} ${ev.result.wentOut === you ? 'go' : 'goes'} out${ev.result.concealed ? ', concealed' : ''}. The round is scored.`,
        speak: true,
      };
    case 'game-ended':
      return { text: 'That is the game.', speak: true };
    case 'chat':
      return { text: `${ev.name}: ${ev.text}`, speak: false };
    case 'seat-joined':
      return { text: `${ev.name ?? nameOf(ev.seat)} sits down.`, speak: true };
    case 'seat-left':
      return { text: `${ev.name ?? nameOf(ev.seat)} leaves.`, speak: true };
    // A player's own dealt cards and drawn card are private and already in their hand. Narrating
    // them would put somebody's cards into a feed they might read out.
    default:
      return null;
  }
}

function isWildCard(card: string): boolean {
  return card[0] === 'W' || card[0] === '2';
}

/** A black three: it stops the pile for the next player and can never be melded except to go out. */
function isBlackThree(card: string): boolean {
  return card[0] === '3' && (card[1] === 'C' || card[1] === 'S');
}

/**
 * A card that COSTS YOU if you are caught holding it when the round ends, worth warning about.
 *
 * Everything left in hand counts against your side, and the expensive ones are the ones nobody
 * expects: a joker is fifty, a two or an ace is twenty. A player learning the game hoards wild
 * cards for a canasta that never comes and is charged for all of them.
 */
export function costlyToHold(card: string): number {
  const r = card[0] ?? '';
  if (r === 'W') return 50;
  if (r === '2' || r === 'A') return 20;
  return 0;
}

/* ------------------------------------------------- one sentence per TURN */

/**
 * A WHOLE TURN AS ONE SENTENCE.
 *
 * Narrating each event separately produced more speech than a voice could deliver: a lap of the
 * table is a dozen events, each line takes two or three seconds to say, and the lap itself takes
 * about ten. The queue filled, the oldest lines were dropped to make room for newer ones, and what
 * survived was whatever arrived last — which is why a player heard their own moves and almost none
 * of anybody else's. The queue was working; there was simply too much to say.
 *
 * A TURN is the unit a person thinks in anyway. "Melder drew, melded four eights, and discarded the
 * five of diamonds" is one sentence, one utterance, and one per turn — which fits comfortably in the
 * time a turn takes, so nothing has to be thrown away.
 *
 * The screen still gets every event as its own line: reading is not rate-limited.
 */
export function turnSentence(events: readonly CanastaTableEvent[], who: string, subject: boolean): string | null {
  const clauses: string[] = [];
  const melds: string[] = [];
  let opened = 0;
  // Red threes come one event each, and a turn can lay several. Counted rather than repeated:
  // "lay down a red three, and lay down a red three" is a sentence nobody would say.
  let reds = 0;

  for (const ev of events) {
    switch (ev.type) {
      case 'drew':
        clauses.push(subject ? 'draw' : 'draws');
        break;
      case 'took-pile':
        clauses.push(`${subject ? 'take' : 'takes'} the pile, ${ev.cards} cards`);
        break;
      case 'red-three':
        reds++;
        break;
      case 'melded':
        melds.push(ev.canasta ? `${spokenRank(ev.rank, true)} for a canasta` : `${ev.size} ${spokenRank(ev.rank, true)}`);
        break;
      case 'opened':
        opened = ev.value;
        break;
      case 'discarded':
        clauses.push(`${subject ? 'discard' : 'discards'} ${spokenCard(ev.card)}`);
        break;
      default:
        break;
    }
  }
  if (reds > 0) {
    const verb = subject ? 'lay' : 'lays';
    clauses.unshift(reds === 1 ? `${verb} down a red three` : `${verb} down ${reds} red threes`);
  }
  if (melds.length > 0) {
    // Melds go in the middle, where they happen, rather than tacked on the end.
    const word = subject ? 'meld' : 'melds';
    const list = melds.length === 1 ? melds[0] : `${melds.slice(0, -1).join(', ')} and ${melds.at(-1)}`;
    const at = clauses.length > 0 ? 1 : 0;
    clauses.splice(at, 0, `${word} ${list}`);
  }
  if (clauses.length === 0) return null;
  const body = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`;
  return `${who} ${body}.${opened > 0 ? ` That opens their side, with ${opened}.` : ''}`;
}

/** Whether this event ENDS a turn. Discarding is the only way one finishes. */
export function endsTurn(ev: CanastaTableEvent): boolean {
  return ev.type === 'discarded' || ev.type === 'round-ended' || ev.type === 'game-ended';
}

/** Which seat an event belongs to, or null for one that belongs to the table rather than a player. */
export function seatOfEvent(ev: CanastaTableEvent): number | null {
  return 'seat' in ev && typeof (ev as { seat?: unknown }).seat === 'number' ? (ev as { seat: number }).seat : null;
}

/* ------------------------------------------- short, spoken as it happens */

/**
 * ONE SHORT LINE PER EVENT, SPOKEN AS IT HAPPENS.
 *
 * Two versions of this have been wrong in opposite directions. Per-event lines that were too long
 * ("Melder draws. 55 left.") outran the voice, so the queue dropped the oldest and a player heard
 * only whatever arrived last. Then one sentence per TURN, flushed on the discard, fixed the drops —
 * and put the voice ten seconds behind the table, describing a turn that had visibly ended while
 * the next player was already moving.
 *
 * The constraint is simply arithmetic. Agents are paced at about three seconds a move, so a line
 * has to be said in less than that. These are: a name, a verb, and the card or the rank. No stock
 * counts, no asides — those stay on screen, where reading is not rate-limited.
 *
 * `you` gets "You", so the person is narrated in the same rhythm as everybody else.
 */
export function spokenLine(ev: CanastaTableEvent, you: number | null, nameOf: (seat: number) => string): string | null {
  const seat = seatOfEvent(ev);
  const mine = seat != null && seat === you;
  const who = seat == null ? '' : mine ? 'You' : nameOf(seat);
  const v = (second: string, third: string) => (mine ? second : third);
  switch (ev.type) {
    case 'round-started':
      return `Round ${ev.roundNo}.`;
    case 'upcard':
      return ev.frozen ? 'The pile starts frozen.' : null;
    case 'drew':
      return `${who} ${v('draw', 'draws')}.`;
    case 'took-pile':
      return `${who} ${v('take', 'takes')} the pile, ${ev.cards} cards.`;
    case 'red-three':
      return `${who} ${v('lay', 'lays')} down a red three.`;
    case 'melded':
      return ev.canasta
        ? `${who} ${v('make', 'makes')} a canasta in ${spokenRank(ev.rank, true)}.`
        : `${who} ${v('meld', 'melds')} ${ev.size} ${spokenRank(ev.rank, true)}.`;
    case 'opened':
      return `${mine ? 'Your' : `${nameOf(ev.seat)}'s`} side is open.`;
    case 'discarded': {
      // A wild's suit is nothing to anybody; what matters is that the pile is now frozen. Saying
      // "a wild" instead of "the two of clubs" is what keeps this line inside three seconds.
      if (isWildCard(ev.card)) return `${who} ${v('discard', 'discards')} a wild, freezing the pile.`;
      // A BLACK THREE STOPS THE PILE for the next player, and is the one card whose consequence a
      // beginner cannot see: nothing about it looks different from any other three.
      if (isBlackThree(ev.card)) return `${who} ${v('discard', 'discards')} a black three, stopping the pile.`;
      return `${who} ${v('discard', 'discards')} ${spokenCard(ev.card)}.`;
    }
    case 'round-ended':
      return ev.result.wentOut === null ? 'The stock is out.' : `${ev.result.wentOut === you ? 'You go' : `${nameOf(ev.result.wentOut)} goes`} out.`;
    case 'game-ended':
      return 'That is the game.';
    default:
      return null;
  }
}
