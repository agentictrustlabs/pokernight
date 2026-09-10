/**
 * The few moments in a round worth interrupting for.
 *
 * A commentary that says what everybody did is a record. What a person learning actually needs is
 * the handful of moments where something is ABOUT to matter and they cannot yet see it: the pile
 * has grown into the biggest swing on the table, somebody is two cards from going out, the stock is
 * nearly gone. Those are the things an experienced player at your shoulder would lean over and say.
 *
 * EACH ONE FIRES ONCE. A warning repeated every turn is noise, and noise is what gets a coach turned
 * off — so each alert has a key, and `newAlerts` returns only the ones not already seen.
 *
 * Pure: given a view and what has already been said, it says what is left.
 */

import type { CanastaView } from './canasta';

export interface Alert {
  /** Fires once per key. Includes the round, so the same warning returns in a new round. */
  key: string;
  text: string;
}

/** A pile big enough to change the game. Seven is a canasta's worth of cards in one move. */
const BIG_PILE = 7;
/** Close enough to going out that everyone else should be dumping high cards. */
const NEARLY_OUT = 3;
/** The stock running dry ends the round with everybody caught holding whatever is left. */
const STOCK_LOW = 8;

export function alertsFor(
  view: CanastaView,
  viewerSeat: number | null,
  nameOf: (seat: number) => string,
): Alert[] {
  const out: Alert[] = [];
  if (view.result) return out;
  const r = view.roundNo;
  const team = viewerSeat == null ? null : ((viewerSeat % 2) as 0 | 1);

  // THE PILE. The biggest swing in canasta, and the one a beginner walks past because it looks
  // like a discard heap rather than a dozen cards.
  if (view.pileSize >= BIG_PILE) {
    out.push({
      key: `pile:${r}:${Math.floor(view.pileSize / BIG_PILE)}`,
      text: `The pile is up to ${view.pileSize} cards. Taking it is the biggest move on the table.`,
    });
  }

  // SOMEBODY IS ABOUT TO GO OUT. Everyone else is about to be caught holding whatever is in their
  // hand, and the answer is to get rid of the expensive cards now.
  for (const s of view.seats) {
    if (s.cards > NEARLY_OUT || s.cards === 0) continue;
    const theirs = team != null && s.team === team;
    out.push({
      key: `out:${r}:${s.seat}:${s.cards}`,
      text:
        s.seat === viewerSeat
          ? `You are down to ${s.cards} cards.`
          : `${nameOf(s.seat)} has ${s.cards} left${theirs ? '' : ' — get rid of your expensive cards'}.`,
    });
  }

  // THE STOCK. When it runs out the round simply stops, and everybody is charged for their hand.
  if (view.stock > 0 && view.stock <= STOCK_LOW) {
    out.push({
      key: `stock:${r}:${view.stock <= 3 ? 'gone' : 'low'}`,
      text: `Only ${view.stock} left in the stock. When it runs out the round ends where it stands.`,
    });
  }

  // YOUR SIDE CAN GO OUT. The rule people miss is that you cannot go out at all without a canasta;
  // once you have one, ending the round is a move you own.
  if (team != null && view.melds[team].some((m) => m.canasta)) {
    out.push({
      key: `canasta:${r}:${team}`,
      text: 'Your side has a canasta, so you can go out whenever you can empty your hand.',
    });
  }

  // A FROZEN PILE changes what everybody can do, and nothing on the cards says so.
  if (view.frozen && view.pileSize >= 4) {
    out.push({
      key: `frozen:${r}`,
      text: 'The pile is frozen. Only two natural cards of the top rank will take it now.',
    });
  }

  return out;
}

/** The ones not said yet. `seen` is updated in place by the caller after they are spoken. */
export function newAlerts(all: readonly Alert[], seen: ReadonlySet<string>): Alert[] {
  return all.filter((a) => !seen.has(a.key));
}
