/**
 * WHAT TO SAY AT A HOLD'EM TABLE — the coach's half of the words, on the client.
 *
 * The card room sends one sentence and a reason (`GET /tables/:id/advice`, answered by the seat's own
 * adviser or the house coach). This file is everything the SCREEN needs around it: the name of the
 * move on the button, the short line worth speaking as somebody else acts, and the handful of moments
 * worth interrupting for.
 *
 * The twin of `canastaWords.ts` + `alerts.ts` + `commentary.ts`, and separate from them on purpose:
 * one set of words per game, and neither knows the other exists. Canasta's barrier is the RULES, so
 * its coach explains which moves exist; hold'em's barrier is the PRICE, so this one keeps saying what
 * a call costs and how often it has to be good.
 *
 * Pure. Given a view and an action, it says words.
 */

import type { Action, LegalActions, TableView } from '@pokernight/protocol';
// The POKER binding of the wire's events and results, which is what this client narrates. `types.ts`
// is where the client narrows the generic envelope to one game, once.
import type { HandResult, TableEvent } from './types';
import { fmtChips, formatEvent, streetLabel, summarizeResult, type FormatContext } from './format';
import { potTotal } from './hand';
import type { Alert } from './alerts';

/**
 * The move, as a person would say it.
 *
 * "Raise TO" rather than "raise by", because the engine's amount is the new total street bet and a
 * button that said "raise 24" would be read as "raise by 24" by every player who has ever sat at a
 * real table. Getting this wrong costs somebody a pot, not a moment's confusion.
 */
export function actionWords(action: unknown, legal?: LegalActions | null): string {
  const a = action as Action | null;
  if (!a || typeof a !== 'object') return 'act';
  switch (a.type) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return legal?.call ? `Call ${fmtChips(legal.call)}` : 'Call';
    case 'bet':
      return `Bet ${fmtChips(a.amount)}`;
    case 'raise':
      return `Raise to ${fmtChips(a.amount)}`;
    case 'all-in':
      return 'All in';
    default:
      return 'Act';
  }
}

/** The same, lower case and without an amount — short enough for a voice mid-hand. */
export function spokenAction(action: unknown): string {
  const a = action as Action | null;
  if (!a || typeof a !== 'object') return 'act';
  if (a.type === 'all-in') return 'all in';
  if (a.type === 'raise') return `raise to ${a.amount}`;
  if (a.type === 'bet') return `bet ${a.amount}`;
  return a.type;
}

/**
 * ONE SHORT LINE PER EVENT, for the voice.
 *
 * Same arithmetic as canasta's: a lap of a table is a dozen events, each spoken line takes two or
 * three seconds, and the speech queue drops the oldest — so a long line per event means a player
 * hears only whatever arrived last. A name and a verb, and the rest stays on screen where reading is
 * not rate-limited.
 *
 * Returns null for the events that are not worth a word out loud: a player's own hole cards (they can
 * see them), a seat joining, chat.
 */
export function spokenPokerLine(ev: TableEvent, ctx: FormatContext): string | null {
  const n = ctx.seatName;
  switch (ev.type) {
    case 'action': {
      const a = ev.record.action;
      const who = n(ev.record.seat);
      if (a.type === 'fold') return `${who} folds.`;
      if (a.type === 'check') return `${who} checks.`;
      if (a.type === 'call') return `${who} calls.`;
      if (a.type === 'bet') return `${who} bets ${a.amount}.`;
      if (a.type === 'raise') return `${who} raises to ${a.amount}.`;
      return `${who} is all in.`;
    }
    case 'street':
      // The cards themselves are on screen and take too long to read out one by one; what a player
      // needs to hear is that the street changed, which is when the whole hand is re-evaluated.
      return `${streetLabel(ev.street)}.`;
    case 'hand-started':
      return `Hand ${ev.handNo}.`;
    default:
      return null;
  }
}

/** Everything worth putting on screen about an event — the log's own words, reused rather than rewritten. */
export function pokerFeedLines(ev: TableEvent, ctx: FormatContext): string[] {
  return formatEvent(ev, ctx);
}

/** How a finished hand is announced: the result in the words the winner banner uses. */
export function handEndLines(result: HandResult, ctx: FormatContext): string[] {
  const s = summarizeResult(result, ctx);
  const lines = [s.headline];
  if (s.detail) lines.push(s.detail);
  return lines;
}

/* ------------------------------------------------------------------ alerts */

/** A pot this many times the blind is worth mentioning at all. */
const POT_IN_BLINDS = 12;
/** Below this many big blinds a stack is short enough that the next hand is a shove-or-fold decision. */
const SHORT_BB = 15;
/** A call needing to be best less often than this is a price worth saying out loud. */
const GOOD_PRICE = 25;

/**
 * THE FEW MOMENTS WORTH INTERRUPTING FOR at a hold'em table.
 *
 * Not a commentary — the log is the commentary. These are the things an experienced player at your
 * shoulder would lean over and say, and every one of them is about something a beginner cannot yet
 * SEE: the price they are being offered, how short they are, that the hand has become heads-up, that
 * the pot is now worth more than the rest of their stack.
 *
 * EACH FIRES ONCE, keyed by hand and street, because a warning repeated every turn is noise and noise
 * is what gets a coach switched off.
 */
export function pokerAlerts(view: TableView | null, seat: number | null, nameOf: (seat: number) => string): Alert[] {
  const out: Alert[] = [];
  const hand = view?.hand;
  if (!view || !hand || hand.result || seat === null) return out;
  const h = hand.handNo;
  const st = hand.street;
  const bb = view.config.bigBlind || 1;
  const me = view.seats.find((s) => s.seat === seat);
  const pot = potTotal(view);
  const live = view.seats.filter((s) => s.seat !== seat && s.inHand && !s.inHand.folded);

  // THE PRICE. The single most useful number in hold'em and the one nowhere on the screen: what a
  // call costs relative to what it can win. Only while it is actually your decision.
  const toCall = hand.toAct === seat ? (view.legal?.call ?? 0) : 0;
  if (toCall > 0 && pot > 0) {
    const share = Math.round((toCall / (pot + toCall)) * 100);
    out.push({
      key: `price:${h}:${st}:${toCall}`,
      text:
        share <= GOOD_PRICE
          ? `${fmtChips(toCall)} to win ${fmtChips(pot + toCall)} — this only has to be best about ${share}% of the time.`
          : `${fmtChips(toCall)} to win ${fmtChips(pot + toCall)} — it has to be best about ${share}% of the time, which is a lot.`,
    });
  }

  // HEADS-UP. One opponent changes which hands are worth playing more than any other single fact, and
  // nothing on the felt announces it.
  if (live.length === 1) {
    out.push({
      key: `heads:${h}:${st}`,
      text: `Just you and ${nameOf((live[0] as { seat: number }).seat)} left in the hand — a weaker hand is worth more now.`,
    });
  }

  // SHORT. Below about fifteen blinds the decisions stop being about pot odds and start being about
  // when to commit, and a beginner discovers that by being blinded away.
  if (me && me.stack > 0 && me.stack <= SHORT_BB * bb) {
    out.push({
      key: `short:${h}`,
      text: `You are down to ${fmtChips(me.stack)}, about ${Math.floor(me.stack / bb)} big blinds. This is commit-or-fold territory.`,
    });
  }

  // THE POT IS NOW THE BIG DECISION. When what is in the middle rivals what is behind, every street
  // after this one is for the whole stack whether anybody says so or not.
  if (me && pot >= POT_IN_BLINDS * bb && me.stack > 0 && pot >= me.stack) {
    out.push({
      key: `committed:${h}:${st}`,
      text: `There is ${fmtChips(pot)} in the middle and ${fmtChips(me.stack)} behind. From here the hand is for your stack.`,
    });
  }

  return out;
}
