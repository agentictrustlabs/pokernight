/**
 * Pure derivations over a `TableView` / `HandResult`.
 *
 * Everything the table board needs that the wire does not spell out lives here
 * so it can be tested in node: who won, which five cards did it, who posted the
 * blinds, what each seat did last.
 */
import type { ActionRecord, Card, HandResult, SeatView, Street, TableView } from './types';

/* ------------------------------------------------------------- the winner */

/** Seats that took at least one chip out of a pot, in award order. */
export function winningSeats(result: HandResult): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const a of result.awards) {
    if (!seen.has(a.seat)) {
      seen.add(a.seat);
      out.push(a.seat);
    }
  }
  return out;
}

/** True when the pot was decided by cards rather than by everyone else folding. */
export function hasShowdown(result: HandResult): boolean {
  return result.awards.some((a) => a.rank != null) || result.shown.length > 0;
}

/**
 * Every card that is part of a winning five-card hand.
 *
 * Card codes are unique in a deck, so one flat set is enough to light up both
 * the board and the winner's hole cards; a losing seat can never hold one of
 * these codes. Empty when nobody showed (fold to one).
 */
export function winningCards(result: HandResult | null | undefined): Set<Card> {
  const out = new Set<Card>();
  if (!result) return out;
  const winners = new Set(winningSeats(result));
  for (const a of result.awards) for (const c of a.rank?.cards ?? []) out.add(c);
  // A pot can be awarded without a rank on the award itself; fall back to what
  // the winning seat showed.
  for (const s of result.shown) if (winners.has(s.seat)) for (const c of s.rank.cards) out.add(c);
  return out;
}

/** Hole cards revealed at showdown, by seat. */
export function shownCards(result: HandResult | null | undefined): Map<number, Card[]> {
  const m = new Map<number, Card[]>();
  for (const s of result?.shown ?? []) m.set(s.seat, s.holeCards);
  return m;
}

/** Net chips for the hand, by seat. Zero entries are dropped. */
export function netBySeat(result: HandResult | null | undefined): Map<number, number> {
  const m = new Map<number, number>();
  for (const [k, v] of Object.entries(result?.net ?? {})) {
    const seat = Number(k);
    if (Number.isFinite(seat) && v !== 0) m.set(seat, v);
  }
  return m;
}

/** Total awarded to a seat across every pot. */
export function awardedTo(result: HandResult, seat: number): number {
  return result.awards.reduce((a, w) => (w.seat === seat ? a + w.amount : a), 0);
}

/* ------------------------------------------------------------- table shape */

/** Seats dealt into the current hand, ascending. */
export function dealtSeats(view: TableView): SeatView[] {
  return view.seats.filter((s) => s.inHand != null).sort((a, b) => a.seat - b.seat);
}

/** Seats still contesting the pot (dealt in and not folded). */
export function playersRemaining(view: TableView): number {
  return dealtSeats(view).filter((s) => !s.inHand?.folded).length;
}

/** Everything on the table: collected pots plus the chips still out in front. */
export function potTotal(view: TableView): number {
  const pots = view.hand?.pots.reduce((a, p) => a + p.amount, 0) ?? 0;
  const street = view.seats.reduce((a, s) => a + (s.inHand?.streetBet ?? 0), 0);
  return pots + street;
}

/**
 * Best-effort blind seats.
 *
 * The redacted view carries the button but not `smallBlindSeat` / `bigBlindSeat`
 * (they exist on the engine's `HandState` only), so they are derived by table
 * order: heads-up the button is the small blind, otherwise it is the next dealt
 * seat after the button.
 */
export function blindSeats(view: TableView): { small: number | null; big: number | null } {
  // The server states the blind positions for the hand; trust them. The derivation below is only a
  // fallback for a view from an older server, and it is wrong under dead blinds or an out-of-position post.
  if (view.hand && (view.hand.smallBlindSeat !== null || view.hand.bigBlindSeat !== null)) {
    return { small: view.hand.smallBlindSeat, big: view.hand.bigBlindSeat };
  }
  const order = dealtSeats(view).map((s) => s.seat);
  const button = view.button;
  if (view.hand == null || button == null || order.length < 2) return { small: null, big: null };
  const afterIdx = (() => {
    const i = order.findIndex((s) => s > button);
    return i === -1 ? 0 : i;
  })();
  const at = (i: number) => order[((i % order.length) + order.length) % order.length] ?? null;
  if (order.length === 2) {
    const small = order.includes(button) ? button : at(afterIdx);
    return { small, big: order.find((s) => s !== small) ?? null };
  }
  return { small: at(afterIdx), big: at(afterIdx + 1) };
}

/* ------------------------------------------------------------ last action */

/**
 * The last thing each seat did on `street`. Used for the per-seat action badge,
 * which resets when a new street lands — the same way a live table forgets.
 */
export function lastActions(actions: readonly ActionRecord[], street: Street): Map<number, ActionRecord> {
  const m = new Map<number, ActionRecord>();
  for (const a of actions) {
    if (a.street !== street) continue;
    m.set(a.seat, a);
  }
  return m;
}
