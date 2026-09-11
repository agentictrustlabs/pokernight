/**
 * Canasta, as this client reads it.
 *
 * The wire carries a game's view opaquely; this is where one is narrowed to canasta's own shapes and
 * turned into the handful of answers a screen needs. Everything here is PURE and tested, for the
 * same reason the poker helpers are: what a card is worth, whether a meld is a canasta, and what a
 * hand should be sorted like are the parts that are easy to get quietly wrong.
 *
 * WHY THE CARD PREDICATES ARE COPIED RATHER THAN IMPORTED. `@pokernight/canasta` exports these as
 * VALUES, and a value import drags its whole engine — the table, the melds, the scoring — into this
 * bundle. The rule that made `pokerConfigOf` a local three-liner (`lib/lobby.ts`) applies here for
 * the same reason and at a larger size: types cross the boundary freely, functions do not. These
 * five are the deck's own definition, they have not changed since canasta was standardised, and
 * `canasta.test.ts` checks them against the values the engine scores with.
 */

import type { CanastaGameConfig, CanastaLegal, CanastaTableEvent, CanastaView } from '@pokernight/protocol';

export type { CanastaGameConfig, CanastaLegal, CanastaTableEvent, CanastaView };

/** A card is `${Rank}${Suit}` — `AS`, `TD`, `W*`. The same plain string the engine deals. */
export type CanastaCard = string;

/** One partnership's melds, as the view reports them. */
export type ViewMeld = CanastaView['melds'][0][number];

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2', 'W'] as const;

export function rankOf(card: CanastaCard): string {
  return card[0] ?? '';
}

export function suitOf(card: CanastaCard): string {
  return card[1] ?? '';
}

/** Jokers and twos. Nothing else, ever — a three is not wild however useful that would be. */
export function isWild(card: CanastaCard): boolean {
  return card[0] === 'W' || card[0] === '2';
}

export function isRed(card: CanastaCard): boolean {
  return card[1] === 'H' || card[1] === 'D';
}

/** A red three is a bonus, not a card you play. It lays itself down and draws you another. */
export function isRedThree(card: CanastaCard): boolean {
  return card[0] === '3' && isRed(card);
}

export function isBlackThree(card: CanastaCard): boolean {
  return card[0] === '3' && !isRed(card);
}

/** What a card is worth, in the hand and in a meld. A red three is worth nothing AS A CARD. */
export function cardValue(card: CanastaCard): number {
  const r = rankOf(card);
  if (r === 'W') return 50;
  if (r === '2' || r === 'A') return 20;
  if (r === '3') return isRed(card) ? 0 : 5;
  if (r === '4' || r === '5' || r === '6' || r === '7') return 5;
  return 10;
}

/** What a set of cards is worth together — the number a player counts to reach their minimum. */
export function valueOf(cards: readonly CanastaCard[]): number {
  return cards.reduce((a, c) => a + cardValue(c), 0);
}

/* ------------------------------------------------------------------ the hand */

const RANK_ORDER = new Map(RANKS.map((r, i) => [r as string, i]));

/**
 * A hand grouped the way a person holds one: wilds together, then each rank, then the black threes.
 *
 * GROUPED RATHER THAN MERELY SORTED, because canasta hands run to fifteen cards and a meld is a
 * whole rank. A player who wants their four sevens should be able to take all four in one press,
 * and a flat sorted list cannot offer that — it does not know where one rank ends.
 *
 * Grouped for READING and PICKING, not for play: the engine takes cards by value and does not care
 * what order they were in.
 */
export interface HandGroup {
  /** The rank, or `W` for the wilds, which are one group however many ranks they really are. */
  rank: string;
  cards: CanastaCard[];
  wild: boolean;
  /** True when every card in the group is a red three — a bonus, shown but never picked. */
  bonus: boolean;
}

/**
 * WHERE THE CARD YOU JUST DREW ENDED UP in the grouped hand.
 *
 * A draw adds one card to a dozen that are sorted by rank, so it does not arrive where you are looking
 * — it appears somewhere in the middle and the count goes up by one. Answering "which one is new?" by
 * counting is not something a game should ask of anybody.
 *
 * The FIRST matching card, deliberately and not the last: two decks means a hand can hold two of the
 * same card, either of them is the one that was drawn as far as anything on screen can tell, and
 * picking a fixed one keeps the highlight from jumping between renders of an unchanged hand.
 *
 * Returns -1 when there is nothing to point at — no draw yet, or a card that has since been played.
 */
export function drawnIndex(groups: readonly HandGroup[], drawn: CanastaCard | null): number {
  if (!drawn) return -1;
  let i = -1;
  for (const g of groups) {
    for (const c of g.cards) {
      i += 1;
      if (c === drawn) return i;
    }
  }
  return -1;
}

export function groupHand(cards: readonly CanastaCard[]): HandGroup[] {
  const by = new Map<string, CanastaCard[]>();
  for (const c of cards) {
    // Jokers and twos are ONE group. They are interchangeable in a meld, which is the only thing a
    // player ever does with them, so splitting them by rank would split what is really one pile.
    // Red and black threes are one group each, for the opposite reason: they are different cards.
    const key = isWild(c) ? 'W' : isRedThree(c) ? 'r3' : rankOf(c);
    by.set(key, [...(by.get(key) ?? []), c]);
  }
  const order = (k: string) => (k === 'W' ? -2 : k === 'r3' ? -1 : (RANK_ORDER.get(k) ?? 99));
  return [...by.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([key, cs]) => ({
      rank: key === 'r3' ? '3' : key,
      cards: cs.slice().sort((a, b) => a.localeCompare(b)),
      wild: key === 'W',
      bonus: key === 'r3',
    }));
}

/** The same hand as one flat list, in the grouped order — which is what a card index refers to. */
export function sortHand(cards: readonly CanastaCard[]): CanastaCard[] {
  return groupHand(cards).flatMap((g) => g.cards);
}

/**
 * Where each seat is DRAWN, from wherever the viewer is sitting.
 *
 * You at the bottom, your PARTNER across from you, the two opponents left and right — because in a
 * partnership game the first thing you need about anybody at the table is which side they are on,
 * and a row of four equal chips does not say it. Play runs to your left, so the seat that acts
 * after you is the one drawn on the left and the turn visibly travels round the table.
 *
 * A spectator is shown the table from seat 1, which is a view of the game rather than of nobody.
 */
export function seatRing(viewerSeat: number | null): { south: number; west: number; north: number; east: number } {
  const v = viewerSeat ?? 0;
  return { south: v, west: (v + 1) % 4, north: (v + 2) % 4, east: (v + 3) % 4 };
}

/* --------------------------------------------------------------- the selection */

export type MeldCheck = { ok: true; rank: string; value: number } | { ok: false; why: string };

/**
 * Whether the cards a player has picked up are a meld, said in the words the rule is in.
 *
 * The SAME four rules the engine enforces, checked here so a player is told before they press rather
 * than refused after. The engine is still the judge — this never lets anything through that it would
 * refuse, and if the two ever disagree the engine wins and the player sees its sentence.
 */
export function checkSelection(cards: readonly CanastaCard[], existingRanks: readonly string[] = []): MeldCheck {
  if (cards.length === 0) return { ok: false, why: 'Pick the cards you want to lay down.' };
  if (cards.some(isRedThree)) return { ok: false, why: 'A red three is a bonus, not a card you lay down.' };
  const naturals = cards.filter((c) => !isWild(c));
  const wilds = cards.filter(isWild);
  const ranks = new Set(naturals.map(rankOf));
  if (ranks.size > 1) return { ok: false, why: 'A meld is one rank. Pick cards that match.' };
  if (naturals.length === 0) return { ok: false, why: 'Wild cards cannot make a meld on their own.' };
  const rank = [...ranks][0] as string;
  if (rank === '3') return { ok: false, why: 'Black threes can only be melded as you go out.' };
  const adding = existingRanks.includes(rank);
  // An ADDITION is judged on what the meld becomes, so two cards is fine when three are already down.
  if (!adding && cards.length < 3) return { ok: false, why: 'A meld is three cards or more.' };
  if (!adding && naturals.length < 2) return { ok: false, why: 'A meld needs two natural cards.' };
  if (wilds.length > 3) return { ok: false, why: 'A meld holds at most three wild cards.' };
  if (!adding && wilds.length > naturals.length) return { ok: false, why: 'A meld never holds more wilds than natural cards.' };
  return { ok: true, rank, value: valueOf(cards) };
}

/* ------------------------------------------------------------------- the table */

/** Seats 0 and 2 are one side, 1 and 3 the other. */
export function teamOf(seat: number): 0 | 1 {
  return (seat % 2) as 0 | 1;
}

/** "Your side" / "The other side", from wherever the viewer is sitting. A spectator gets neutral names. */
export function teamName(team: 0 | 1, viewerSeat: number | null): string {
  if (viewerSeat == null) return team === 0 ? 'Seats 1 & 3' : 'Seats 2 & 4';
  return teamOf(viewerSeat) === team ? 'Your side' : 'The other side';
}

/**
 * What a side must lay to open, and whether they have.
 *
 * The minimum RISES with the score, which is the rule most likely to surprise somebody: a side that
 * has been winning has to lay more to get started than a side that has been losing.
 */
export function openingMinimum(score: number): number {
  if (score < 0) return 15;
  if (score < 1500) return 50;
  if (score < 3000) return 90;
  return 120;
}

/** Whether this side has a canasta, and so may go out. */
export function hasCanasta(melds: readonly ViewMeld[]): boolean {
  return melds.some((m) => m.canasta);
}

/**
 * The one sentence at the top of the board: whose turn it is and what they have to do.
 *
 * Canasta's turn has TWO halves and a player who does not know that is stuck: you must draw or take
 * the pile before you may meld or discard, and the controls for the second half are dead until you
 * have done the first. Saying which half it is turns a dead button into a step.
 */
export function turnLine(view: CanastaView, viewerSeat: number | null, nameOf: (seat: number) => string): string {
  if (view.result) return 'The round is over.';
  if (view.toAct == null) return 'Waiting for the next round.';
  const mine = view.toAct === viewerSeat;
  const who = mine ? 'You' : nameOf(view.toAct);
  if (view.phase === 'draw') {
    return mine ? 'Your turn — draw a card, or take the discard pile.' : `${who} to draw.`;
  }
  return mine ? 'Your turn — lay melds if you can, then discard one card to finish.' : `${who} to play.`;
}

/* ------------------------------------------------------- why the pile will not come */

/**
 * WHY "TAKE THE PILE" IS DEAD, in words, or null when it is not.
 *
 * Taking the pile has TWO gates and they fail for different reasons, which is how this came to be a
 * button that did nothing and said nothing:
 *
 *   THE ENGINE'S gate — do you hold what the rules require for this top card, given whether the pile
 *   is frozen and what your side has down. It reports its own refusal, and when it is satisfied that
 *   reason is `null`.
 *
 *   THE TABLE'S gate — the cards you have SELECTED, plus the top card, have to make a legal meld,
 *   because taking the pile means using its top card immediately. Select nothing and the check runs
 *   on one card and fails with "a meld is three cards or more" — a sentence about laying down, for a
 *   button you pressed to pick up.
 *
 * The screen showed the first reason and never the second. So the ordinary case — the pile is takeable
 * and you simply have not chosen your cards yet — disabled the button with no explanation at all, and
 * the guidance underneath cheerfully said "take the pile with those".
 */
export function whyNotTakePile(a: {
  /** The engine's answer, which owns the rules. */
  canTakePile: boolean;
  takePileReason: string | null;
  pileTop: CanastaCard | null;
  selection: readonly CanastaCard[];
  existingRanks: readonly string[];
}): string | null {
  if (!a.pileTop) return 'The pile is empty.';
  // The engine owns the rules; when it refuses, its words are the answer and nothing here improves them.
  if (!a.canTakePile) return a.takePileReason ?? 'The pile cannot be taken right now.';

  const rank = rankOf(a.pileTop);
  const withTop = checkSelection([...a.selection, a.pileTop], a.existingRanks);
  if (withTop.ok) return null;

  if (a.selection.length === 0) {
    return a.existingRanks.includes(rank)
      ? `Pick the ${rank}s you want to add, or take the pile onto your ${rank} meld.`
      : `Pick the cards from your hand that go with the ${rank} on top, then take the pile.`;
  }
  // The selection IS wrong, and the meld checker already says why in the right words — it is only
  // the frame that has to change, because this is about picking the pile up rather than laying down.
  return `Those and the ${rank} on top do not make a meld: ${withTop.why[0]?.toLowerCase()}${withTop.why.slice(1)}`;
}

/* ------------------------------------------------------------- which button is green */

/** The four things a canasta turn offers. */
export type CanastaAction = 'draw' | 'take' | 'meld' | 'discard';

/**
 * WHICH ONE BUTTON IS GREEN — and it is never more than one.
 *
 * `Draw` and `Discard` were both permanently primary, and green reads as "this is what you do next".
 * So a player who picked up three matching cards still saw the green on DISCARD, pressed it, and
 * never noticed `Lay down` beside it — the melding half of the game hidden by a colour.
 *
 * The rule is that green follows the SELECTION: it marks the act the cards in your hand currently
 * afford, so choosing cards visibly changes what the table is offering you.
 *
 *   nothing picked      the step's own default — draw, or nothing at all in the second half
 *   one card            DISCARD. One card is the shape of ending a turn.
 *   a legal meld        LAY DOWN.
 *   anything else       nothing is green, because nothing is ready.
 *
 * ONE CARD IS DISCARD EVEN WHEN IT WOULD EXTEND A MELD, and that is deliberate. A single card that
 * happens to match a meld already down can be laid off — but the common reason to pick one card is to
 * throw it, and putting the green on `Lay down` there would turn a routine discard into an
 * irreversible meld on a mis-click. The safer of two plausible readings wins.
 */
export function primaryAction(a: {
  drawing: boolean;
  selectionCount: number;
  canDraw: boolean;
  canTake: boolean;
  canMeld: boolean;
  canDiscard: boolean;
}): CanastaAction | null {
  if (a.drawing) {
    // Taking the pile is only ever possible once the cards are chosen, so it IS the selection's act.
    if (a.canTake) return 'take';
    return a.canDraw ? 'draw' : null;
  }
  if (a.selectionCount === 1 && a.canDiscard) return 'discard';
  if (a.canMeld) return 'meld';
  return null;
}

/* --------------------------------------------------------- how close to opening */

/**
 * HOW FAR SHORT OF OPENING the cards in your hand currently are.
 *
 * A side that has not laid anything down yet must open with a meld worth at least a minimum, and that
 * minimum climbs with the score — 50, then 90, then 120. So the number that matters while somebody is
 * picking cards is not the total, it is the GAP: "60 points" answers a question nobody asked, and
 * "30 short of 90" is the one that tells them whether to keep looking.
 *
 * Null once the side has opened, because then there is no minimum and a running total is just noise.
 */
export function openingProgress(a: { opened: boolean; value: number; minimum: number }): { short: number; line: string } | null {
  if (a.opened || a.minimum <= 0) return null;
  const short = a.minimum - a.value;
  return {
    short: Math.max(0, short),
    line: short > 0 ? `${short} short of ${a.minimum}` : `enough to open (${a.minimum})`,
  };
}
