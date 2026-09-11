/**
 * READING A HOLD'EM HAND FROM ONE SEAT — the numbers that actually decide, said in words.
 *
 * The twin of `@pokernight/canasta-agent`'s `explainMove`, and it lives in the AGENT rather than in
 * the card room for the same reason that one does: advice is the agent's business. The card room's
 * part is to ask and to say whose answer it is showing.
 *
 * WHAT IT REFUSES TO DO is invent. A seat sees its own two cards and the board, so anything said
 * about another player is a reading of what they DID — position, how much, how often — and is worth
 * saying that way. "They raised early and bet twice, so they are weighted strong" is evidence.
 * "They have ace-king" is a lie with a rule of thumb behind it.
 */

import type { Card, LegalActions, TableView } from '@pokernight/engine';
// `inPosition` is this package's own: it walks the real order from the button rather than
// re-deriving it. A second implementation of who acts last is a second chance to be wrong.
import { aggressorOnStreet, inPosition, raisesOnStreet } from './view.js';
import { classifyPreflop } from './preflop.js';
import { postflopStrength } from './strength.js';

export interface Read {
  /** One sentence, mid-hand, for somebody with a clock running. */
  say: string;
  /** The reason, which is the half that teaches and the half they can disagree with. */
  because: string;
}

/** What is in the pots right now, before this decision. */
export function potSize(view: TableView): number {
  return (view.hand?.pots ?? []).reduce((a, p) => a + p.amount, 0);
}

/**
 * The price a call is being offered, as the percentage of the time it has to be good.
 *
 * Calling `toCall` into a pot of `pot` risks `toCall` to win `pot + toCall`, so the break-even share
 * is `toCall / (pot + toCall)`. Said as a percentage on purpose: a ratio is a puzzle mid-hand, and
 * the number somebody needs is "how often does this have to be best".
 */
export function priceToCall(pot: number, toCall: number): number | null {
  if (toCall <= 0) return null;
  const total = pot + toCall;
  return total <= 0 ? null : Math.round((toCall / total) * 100);
}

/**
 * Roughly how often a draw arrives, from a count of outs.
 *
 * The two-and-four rule: about 2% per out with one card to come, 4% with two. It is a rule of thumb
 * and is said as one — a number presented as exact that is not is worse than a rough number labelled
 * rough.
 */
export function chanceFromOuts(outs: number, cardsToCome: number): number {
  if (outs <= 0 || cardsToCome <= 0) return 0;
  return Math.min(95, outs * (cardsToCome >= 2 ? 4 : 2));
}

/** How many cards are still to come after this street. */
export function cardsToCome(street: string): number {
  return street === 'preflop' ? 5 : street === 'flop' ? 2 : street === 'turn' ? 1 : 0;
}

/** How many opponents are still in the hand — the single biggest thing a hand's strength depends on. */
export function liveOpponents(view: TableView, seat: number): number {
  return (view.seats ?? []).filter((s) => s.seat !== seat && s.inHand && !s.inHand.folded).length;
}

/** "the flop", "the turn" — the street as a person names it. */
function streetName(street: string): string {
  return street === 'preflop' ? 'before the flop' : street === 'flop' ? 'on the flop' : street === 'turn' ? 'on the turn' : 'on the river';
}

/**
 * The read for one seat, right now.
 *
 * Deliberately built from what is CERTAIN — the price, the number of opponents, position, the stack
 * behind — rather than from a hand-strength model. A confident equity figure would be the most
 * impressive and least honest thing this could return: it would have to assume ranges nobody stated.
 */
export function readHand(view: TableView, seat: number, legal: LegalActions | null): Read {
  const hand = view.hand;
  if (!hand) return { say: 'No hand is running.', because: 'The table is between hands.' };

  const me = (view.seats ?? []).find((s) => s.seat === seat);
  const pot = potSize(view);
  const toCall = legal?.call ?? 0;
  const price = priceToCall(pot, toCall);
  const others = liveOpponents(view, seat);
  const behind = me?.stack ?? 0;
  const where = streetName(hand.street);
  const position = inPosition(view) ? 'You act last' : 'You act before somebody';

  const parts: string[] = [];
  if (price !== null) {
    parts.push(
      `Calling ${toCall} into ${pot} needs this to be best about ${price}% of the time.`,
    );
  } else if (legal?.check) {
    parts.push('Checking is free — there is no price to pay to see another card.');
  }
  parts.push(`${position} ${where}, against ${others === 1 ? 'one player' : `${others} players`}.`);
  if (behind > 0 && pot > 0) {
    const spr = Math.round((behind / pot) * 10) / 10;
    parts.push(`You have ${behind} behind, ${spr} times the pot — that is what is actually at risk.`);
  }

  const say =
    price !== null
      ? `You are being asked ${toCall} into ${pot} — about ${price}%.`
      : legal?.check
        ? 'Nothing to call. You can see another card for free.'
        : 'Your turn.';

  return { say, because: parts.join(' ') };
}

/**
 * THE READ AS DATA — every number an adviser would otherwise have to work out from the view.
 *
 * `readHand` says the spot in sentences for a person. This says it in fields for an AGENT — a
 * language model at somebody's Home reasoning about their hand. The difference between the two
 * audiences is the whole reason this exists: a model reasons well over facts it is handed and badly
 * over facts it must compute, and "fold 8-2 from the big blind in a limped pot" (seen live) is what
 * computing the price wrong looks like. Handed `toCall: 0` and `checkIsFree: true`, it does not fold.
 *
 * Deterministic and complete: the price, the outs and their rough chance, position, who is still in,
 * the money behind as a multiple of the pot, what the two cards are before the flop and what they have
 * made after it. Nothing here is a decision — that is the adviser's — and nothing is inferred about
 * another player's cards: the seat sees its own two, the board, and what everybody DID.
 */
export interface HandRead {
  street: string;
  /** The two cards, as the seat holds them, and their preflop class ("AKs", Chen 20/20). */
  hole: { cards: readonly Card[]; label: string; shape: string; strength: number } | null;
  /** After the flop: what the cards have made, and what they are drawing to. */
  made?: { hand: string; draws: string[]; outs: number; chanceByRiver: number | null };
  pot: number;
  toCall: number;
  /** `toCall / (pot + toCall)` as a percentage — how often a call has to be best. Null when nothing to call. */
  priceToCall: number | null;
  /** Checking costs nothing. The single fact most beginners' worst folds ignore. */
  checkIsFree: boolean;
  /** Last to act on this street, or not. */
  inPosition: boolean;
  /** Opponents still in the hand. */
  opponents: number;
  /** Chips behind, and as a multiple of the pot — what is actually at risk. */
  behind: number;
  stackToPot: number | null;
  /** Big blinds behind, the unit short-stack decisions are made in. */
  bigBlindsBehind: number | null;
  /** How many raises have gone in on this street — pressure, as evidence. */
  raisesThisStreet: number;
  /**
   * WHAT THE PRICE IS FOR, in words: "the big blind; nobody has raised" or "a raise to 6 by seat 2".
   * A model handed `toCall: 2` before the flop called it "a raise" one time in three (seen live); the
   * blind is a price, not an opponent's decision, and the difference is the whole preflop read.
   */
  facing: string;
  /** The legal moves, verbatim — the action union the answer must use. */
  legal: LegalActions | null;
  /**
   * THE HAND SO FAR, one line per street, in words — who did what, from where, for how much.
   *
   * The turn is not a new hand. An adviser handed only the board and the pot reasons as if it were —
   * "I have a draw, so I should bet" — without what the flop action already said about both sides.
   * This carries the story forward so the strategy stays one strategy across streets.
   */
  story: string[];
}

export function handRead(view: TableView, seat: number, legal: LegalActions | null): HandRead | null {
  const hand = view.hand;
  if (!hand) return null;
  const me = (view.seats ?? []).find((s) => s.seat === seat);
  const cards = me?.inHand?.holeCards ?? [];
  const pot = potSize(view);
  const toCall = legal?.call ?? 0;
  const behind = me?.stack ?? 0;
  const bb = view.config?.bigBlind || 0;
  const pre = cards.length === 2 ? classifyPreflop(cards) : null;
  const read: HandRead = {
    street: hand.street,
    hole: pre ? { cards, label: pre.label, shape: pre.shape, strength: pre.strength } : null,
    pot,
    toCall,
    priceToCall: priceToCall(pot, toCall),
    checkIsFree: !!legal?.check,
    inPosition: inPosition(view),
    opponents: liveOpponents(view, seat),
    behind,
    stackToPot: pot > 0 ? Math.round((behind / pot) * 10) / 10 : null,
    bigBlindsBehind: bb > 0 ? Math.floor(behind / bb) : null,
    raisesThisStreet: raisesOnStreet(view, hand.street),
    facing: facingWhat(view, seat, toCall),
    legal,
    story: handStory(view, seat),
  };
  if (cards.length === 2 && hand.board.length >= 3) {
    const s = postflopStrength(cards, hand.board);
    const draws = [s.draws.flush ? 'flush draw' : '', s.draws.openEnded ? 'open-ended straight draw' : '', s.draws.gutshot ? 'gutshot' : ''].filter(Boolean);
    const toCome = cardsToCome(hand.street);
    read.made = { hand: s.made, draws, outs: s.outs, chanceByRiver: s.outs > 0 && toCome > 0 ? chanceFromOuts(s.outs, toCome) : null };
  }
  return read;
}

/** What the amount to call IS: a blind nobody has raised, or somebody's bet or raise, named. */
export function facingWhat(view: TableView, seat: number, toCall: number): string {
  const hand = view.hand;
  if (!hand) return 'nothing';
  if (toCall <= 0) return hand.street === 'preflop' && raisesOnStreet(view, 'preflop') === 0 ? 'nothing; the pot is limped or you posted the big blind' : 'nothing; checking is free';
  const who = aggressorOnStreet(view, hand.street);
  if (who === null || raisesOnStreet(view, hand.street) === 0) return `the big blind (${toCall} to call); nobody has bet or raised`;
  const name = who === seat ? 'you' : `seat ${who + 1}`;
  const last = [...hand.actions].reverse().find((a) => a.seat === who && a.street === hand.street && (a.action.type === 'bet' || a.action.type === 'raise' || a.action.type === 'all-in'));
  const verb = last?.action.type === 'bet' ? `a bet of ${(last.action as { amount: number }).amount}` : last?.action.type === 'raise' ? `a raise to ${(last.action as { amount: number }).amount}` : 'an all-in';
  return `${verb} by ${name}`;
}

/** "preflop: you raised to 6 from the big blind, seat 2 called" — the record, street by street. */
export function handStory(view: TableView, seat: number): string[] {
  const hand = view.hand;
  if (!hand) return [];
  const name = (s: number) => (s === seat ? 'you' : `seat ${s + 1}`);
  const byStreet = new Map<string, string[]>();
  for (const a of hand.actions) {
    const who = name(a.seat);
    const verb =
      a.action.type === 'fold' ? `${who} folded`
      : a.action.type === 'check' ? `${who} checked`
      : a.action.type === 'call' ? `${who} called${a.amount ? ` ${a.amount}` : ''}`
      : a.action.type === 'bet' ? `${who} bet ${a.action.amount}`
      : a.action.type === 'raise' ? `${who} raised to ${a.action.amount}`
      : `${who} went all in`;
    byStreet.set(a.street, [...(byStreet.get(a.street) ?? []), verb]);
  }
  const out: string[] = [];
  for (const st of ['preflop', 'flop', 'turn', 'river'] as const) {
    const lines = byStreet.get(st);
    if (!lines?.length) continue;
    const board = st === 'flop' ? hand.board.slice(0, 3) : st === 'turn' ? hand.board.slice(3, 4) : st === 'river' ? hand.board.slice(4, 5) : [];
    out.push(`${st}${board.length ? ` (${board.join(' ')})` : ''}: ${lines.join(', ')}`);
  }
  return out;
}
