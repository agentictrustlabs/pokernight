/**
 * A rules-based baseline strategy for Classic Canasta.
 *
 * `chooseCanastaAction` is a PURE function of (view, legal, seat): the same three arguments always
 * give the same move, there is no clock, no I/O and no randomness — every tie is broken by card code
 * — so a bot that misbehaves at a table can be reproduced from the seat's view alone.
 *
 * IT MUST ALWAYS RETURN SOMETHING THE ENGINE WILL ACCEPT. This is the last thing between a seat and
 * the host's timeout default, and an illegal move is worse than a weak one: the host would refuse
 * it, the clock would run out anyway, and the seat would be sat out for a bug in a strategy rather
 * than for walking away. So every plan here is checked against the engine's own pure helpers
 * (`applyMelds`, `openingValue`, `hasCanasta`) BEFORE it is returned, and anything that does not
 * verify is dropped in favour of the simplest legal move there is: draw, or throw a card.
 *
 * The two traps that make canasta bots hang are both about the hand getting too small, and both are
 * refusals the engine makes for the player's own good:
 *
 *  - MELDING DOWN TO ONE CARD without a canasta. The turn can only end with a discard, that discard
 *    would empty the hand, and emptying the hand without a canasta is illegal — so the player would
 *    have no legal move at all. The engine refuses the meld instead, and so does this file.
 *  - TAKING A ONE-CARD PILE. The pile gives nothing back, so paying two or three cards from hand for
 *    it lands in exactly the same place.
 *
 * Everything below therefore keeps two cards in hand unless it is deliberately going out.
 */

import {
  CANASTA_SIZE,
  MAX_WILDS_PER_MELD,
  RANKS,
  applyMelds,
  cardValue,
  handValue,
  hasCanasta,
  isBlackThree,
  isMeldableRank,
  isRedThree,
  isWild,
  naturalsOfRank,
  openingValue,
  rankOf,
  removeCards,
  teamOf,
  type CanastaAction,
  type CanastaLegal,
  type CanastaView,
  type Card,
  type Meld,
  type MeldSpec,
  type Rank,
  type TeamId,
} from '@pokernight/canasta';

export interface CanastaDecision {
  action: CanastaAction;
  note?: string;
}

/* ----------------------------------------------------------------- basics */

/** Every tie in this file breaks here, so a failing round replays from its seed alone. */
const byCode = (a: Card, b: Card): number => (a < b ? -1 : a > b ? 1 : 0);

const other = (team: TeamId): TeamId => ((1 - team) as TeamId);

/** Wilds cheapest first: a deuce is spent before a joker, so the better card stays in hand. */
function wildsAscending(hand: readonly Card[]): Card[] {
  return hand.filter(isWild).sort((a, b) => cardValue(a) - cardValue(b) || byCode(a, b));
}

/** A side's melds, keyed the way the strategy asks about them. */
function meldOf(melds: readonly Meld[], rank: Rank): Meld | undefined {
  return melds.find((m) => m.rank === rank);
}

/**
 * The naturals this hand holds of each meldable rank, with the meld (if any) they would join.
 *
 * Threes and wilds are deliberately absent: a red three is never in play, a black three is only ever
 * melded as part of going out, and a wild is not a rank you meld — it joins some other rank.
 */
interface RankGroup {
  rank: Rank;
  naturals: Card[];
  existing: Meld | undefined;
}

function groupsOf(hand: readonly Card[], existing: readonly Meld[]): RankGroup[] {
  const by = new Map<Rank, Card[]>();
  for (const card of hand) {
    const rank = rankOf(card);
    if (isWild(card) || !isMeldableRank(rank)) continue;
    const list = by.get(rank) ?? [];
    list.push(card);
    by.set(rank, list);
  }
  return [...by.entries()]
    .map(([rank, naturals]) => ({ rank, naturals: naturals.sort(byCode), existing: meldOf(existing, rank) }))
    .sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
}

/**
 * How many more wilds a meld of this rank could take.
 *
 * Two limits, and the tighter one wins: never more than three wilds however long the meld grows, and
 * never more wilds than naturals. `added` is the naturals this turn would put in alongside them,
 * because they count towards the second limit as soon as they are laid.
 */
function wildCapacity(existing: Meld | undefined, added: number): number {
  const cards = existing?.cards ?? [];
  const naturals = cards.filter((c) => !isWild(c)).length + added;
  const wilds = cards.filter(isWild).length;
  return Math.max(0, Math.min(MAX_WILDS_PER_MELD, naturals) - wilds);
}

/* ------------------------------------------------------------- going out */

/**
 * Put EVERY card in `cards` into a meld, or say it cannot be done.
 *
 * Only used to go out, which is why it is all-or-nothing: a plan that leaves a card over is not a
 * way to empty the hand. Black threes are the awkward case — three or more of them are a legal meld,
 * but only in the move that empties the hand completely, so a plan that keeps a card back to discard
 * cannot use them at all.
 */
function meldEverything(cards: readonly Card[], existing: readonly Meld[], blackThreesAllowed: boolean): MeldSpec[] | null {
  if (cards.some(isRedThree)) return null; // never meldable and never discardable — it should not be here
  const blackThrees = cards.filter(isBlackThree).sort(byCode);
  if (blackThrees.length > 0 && (!blackThreesAllowed || blackThrees.length < 3)) return null;

  const spare = wildsAscending(cards);
  const plan: { rank: Rank; cards: Card[]; room: number }[] = [];

  for (const group of groupsOf(cards, existing)) {
    // A rank this side already has down takes any number. A NEW meld needs three cards, two of them
    // natural, so a lone natural can never be placed and a pair costs a wild.
    if (!group.existing && group.naturals.length < 2) return null;
    const short = group.existing ? 0 : Math.max(0, 3 - group.naturals.length);
    if (short > spare.length) return null;
    const used = spare.splice(0, short);
    plan.push({
      rank: group.rank,
      cards: [...group.naturals, ...used],
      room: wildCapacity(group.existing, group.naturals.length) - used.length,
    });
  }

  // Wilds left over have to go somewhere too — an unplaceable wild is a card that cannot leave the
  // hand, and a hand that cannot empty is not a go-out.
  for (const entry of plan) {
    while (spare.length > 0 && entry.room > 0) {
      entry.cards.push(spare.shift() as Card);
      entry.room -= 1;
    }
  }
  if (spare.length > 0) return null;

  if (blackThrees.length > 0) plan.push({ rank: '3', cards: blackThrees, room: 0 });
  if (plan.length === 0) return null;
  return plan.map((p) => ({ rank: p.rank, cards: p.cards }));
}

/**
 * Can this turn end the round? If so, how.
 *
 * Run even when `legal.canGoOut` is false, because that flag reports the canasta the side ALREADY
 * has: a meld that closes the seventh card and empties the hand in the same move is a legal go-out,
 * and refusing to look for it would leave the best move in the game on the table.
 *
 * Preference order is the score: melding the last card is worth its face value, discarding it is
 * worth nothing, so emptying the hand entirely comes first and otherwise the CHEAPEST card is the
 * one held back. Concealed go-outs are not chosen against — a seat cannot see `meldedBefore` from
 * its own view, but a side with nothing on the table has necessarily never melded, and since this
 * strategy goes out at the first opportunity it takes the concealed one whenever the round offers it.
 */
function planGoOut(hand: readonly Card[], existing: readonly Meld[], minimum: number): CanastaDecision | null {
  const holdBack: (Card | null)[] = [
    null,
    ...[...new Set(hand)].filter((c) => !isRedThree(c)).sort((a, b) => cardValue(a) - cardValue(b) || byCode(a, b)),
  ];

  for (const held of holdBack) {
    const rest = held === null ? hand.slice() : removeCards(hand, [held]);
    if (!rest) continue;

    // One card left and a canasta already down: the discard IS the going-out move, no meld needed.
    if (rest.length === 0) {
      if (held === null || !hasCanasta(existing)) continue;
      return { action: { type: 'discard', card: held }, note: 'go out on the last card' };
    }

    const specs = meldEverything(rest, existing, held === null);
    if (!specs) continue;
    const laid = applyMelds(existing, specs);
    if (!laid.ok) continue;
    if (!hasCanasta(laid.melds)) continue; // nothing goes out without one
    if (minimum > 0 && openingValue(laid.laid) < minimum) continue;

    const note = held === null ? 'go out, melding the whole hand' : `go out, keeping ${held} to discard`;
    return { action: { type: 'meld', melds: specs }, note };
  }
  return null;
}

/* --------------------------------------------------------------- opening */

/**
 * Pick melds worth at least `needed`, cheapest commitment first.
 *
 * THE MINIMUM IS MET IN ONE MOVE — the engine will not let a side lay half of it and then find the
 * rest — so this combines ranks until it gets there. Melds of three or more naturals go first
 * because they cost nothing but the cards; only when they fall short does a wild get spent, and
 * opening is the one time that is right. A side that never opens scores nothing at all and is
 * CHARGED for the red threes it drew, which is a bigger loss than any wild.
 */
function selectOpening(hand: readonly Card[], existing: readonly Meld[], needed: number): MeldSpec[] | null {
  const groups = groupsOf(hand, existing);
  const spare = wildsAscending(hand);
  const picks: MeldSpec[] = [];
  let value = 0;

  const free = groups
    .filter((g) => g.existing !== undefined || g.naturals.length >= 3)
    .sort((a, b) => handValue(b.naturals) - handValue(a.naturals) || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
  for (const group of free) {
    if (value >= needed) break;
    picks.push({ rank: group.rank, cards: group.naturals.slice() });
    value += handValue(group.naturals);
  }

  if (value < needed) {
    const pairs = groups
      .filter((g) => g.existing === undefined && g.naturals.length === 2)
      .sort((a, b) => handValue(b.naturals) - handValue(a.naturals) || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
    for (const group of pairs) {
      if (value >= needed) break;
      const wild = spare.shift();
      if (!wild) break;
      picks.push({ rank: group.rank, cards: [...group.naturals, wild] });
      value += handValue(group.naturals) + cardValue(wild);
    }
  }

  if (picks.length === 0 || value < needed) return null;
  return picks;
}

/* --------------------------------------------------------------- melding */

/**
 * What to lay down once the side is open.
 *
 * A CANASTA IS THE ONLY THING WORTH A WILD. Seven cards pay three hundred, five hundred if they are
 * clean; a wild spent on a fresh meld of three is a wild that is not there when a canasta is one
 * card short, and it cannot be taken back. So wilds are held in hand unless they close one.
 *
 * Everything else goes down: naturals onto a rank already on the table, and new melds of three or
 * more. Cards in hand are a liability at the end of a round and cards on the table are not, and a
 * rank the side has melded is a rank whose discard the side can pick the pile up on.
 */
function planMelds(hand: readonly Card[], existing: readonly Meld[]): MeldSpec[] | null {
  const groups = groupsOf(hand, existing);
  const spare = wildsAscending(hand);
  const closers: MeldSpec[] = [];
  const closed = new Set<Rank>();

  // Walk the MELDS, not the hand: a meld six cards long is closed by a wild alone, and a pass that
  // only looked at ranks the hand holds naturals of would never see it.
  for (const meld of existing) {
    if (meld.rank === '3' || meld.cards.length >= CANASTA_SIZE) continue;
    const naturals = groups.find((g) => g.rank === meld.rank)?.naturals ?? [];
    const short = CANASTA_SIZE - meld.cards.length - naturals.length;
    if (short <= 0) continue; // naturals alone finish it; the ordinary pass lays them
    const room = wildCapacity(meld, naturals.length);
    if (short > Math.min(room, spare.length)) continue; // not reachable this turn — keep the wilds
    closers.push({ rank: meld.rank, cards: [...naturals, ...spare.splice(0, short)] });
    closed.add(meld.rank);
  }

  const rest = groups
    .filter((g) => !closed.has(g.rank) && (g.existing !== undefined || g.naturals.length >= 3))
    .map((g) => ({ rank: g.rank, cards: g.naturals.slice() }))
    // Most valuable first, so the trim below drops the cheapest meld when the hand is nearly empty.
    .sort((a, b) => handValue(b.cards) - handValue(a.cards) || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));

  const specs = [...closers, ...rest];
  return specs.length > 0 ? specs : null;
}

/**
 * Trim a meld plan until the hand still holds two cards, and check it against the engine's rules.
 *
 * Two cards, not one: one card means the turn's discard would empty the hand, which is a going-out
 * move and needs a canasta. Going out is decided deliberately, one function above; nothing should
 * ever stumble into it.
 */
function verifyMelds(
  hand: readonly Card[],
  existing: readonly Meld[],
  specs: readonly MeldSpec[],
  minimum: number,
): MeldSpec[] | null {
  const kept = specs.slice();
  while (kept.length > 0) {
    const spent = kept.flatMap((m) => m.cards);
    const rest = removeCards(hand, spent);
    const laid = applyMelds(existing, kept);
    if (rest && rest.length >= 2 && laid.ok && (minimum <= 0 || openingValue(laid.laid) >= minimum)) return kept;
    // Dropping the last spec is dropping the least valuable one: both passes are sorted that way.
    kept.pop();
  }
  return null;
}

/* ------------------------------------------------------------ the discard */

/**
 * How unwelcome this card is to keep — lowest wins, and the score is the whole discard policy.
 *
 * Face value first, because what is in hand at the end of a round is subtracted from the side's
 * score. Then the two things a discard gives away: a WILD unfreezes nothing and freezes the pile
 * against your own partner, and a card of a rank the opponents have on the table hands them the
 * whole pile for one card. A black three does the opposite and is the safest card in the deck — it
 * stops the pile dead for the seat after you, and costs five points to hold.
 *
 * The last term is the one that is about your own hand rather than theirs: throwing the second of a
 * pair is throwing half a meld, and a meld is what a canasta is built from.
 */
function discardScore(card: Card, hand: readonly Card[], view: CanastaView, team: TeamId): number {
  if (isRedThree(card)) return 10_000; // the engine refuses it outright; it goes on the table, never on the pile
  let score = cardValue(card);
  if (isWild(card)) score += 200;
  if (isBlackThree(card)) score -= 8;

  const rank = rankOf(card);
  if (isMeldableRank(rank)) {
    if (!view.frozen && view.melds[other(team)].some((m) => m.rank === rank)) score += 60;
    score += 12 * Math.max(0, naturalsOfRank(hand, rank).length - 1);
  }
  return score;
}

function chooseDiscard(view: CanastaView, legal: CanastaLegal, team: TeamId): Card {
  const hand = legal.discardable.length > 0 ? legal.discardable : (view.hand ?? []);
  const usable = hand.filter((c) => !isRedThree(c));
  const pool = usable.length > 0 ? usable : hand;
  const sorted = pool
    .slice()
    .sort((a, b) => discardScore(a, hand, view, team) - discardScore(b, hand, view, team) || byCode(a, b));
  return sorted[0] as Card;
}

/* ------------------------------------------------------------- the pile */

/**
 * Take the discard pile, or say why it is not worth it.
 *
 * A pile is taken for what is UNDER the top card, so a pile worth taking is either a big one — three
 * cards or more — or one whose top card walks straight onto a meld the side already has. Anything
 * else costs naturals out of the hand for a card or two back, and the hand is where a canasta is
 * built.
 *
 * The meld that takes the pile is built from the hand's naturals of the top rank. When the side has
 * not opened yet, the whole minimum has to be met in this one move, so further melds ride along in
 * `also` — without them, taking a pile to open would be impossible at anything above the lowest
 * minimum.
 */
function planTakePile(view: CanastaView, legal: CanastaLegal, team: TeamId): CanastaDecision | null {
  const top = legal.pileTop;
  if (!legal.canTakePile || top === null) return null;

  const hand = view.hand ?? [];
  const existing = view.melds[team];
  const rank = rankOf(top);
  const mine = meldOf(existing, rank);
  if (legal.pileSize < 3 && !mine) return null; // a short pile that starts nothing is a pile of nothing

  const naturals = naturalsOfRank(hand, rank).sort(byCode);
  // Frozen, or a rank this side has not melded: the only door in is two naturals FROM THE HAND.
  const needsTwo = view.frozen || mine === undefined;
  if (needsTwo && naturals.length < 2) return null;

  const opening = legal.minimumMeld > 0;
  // Open the pile as cheaply as it can be opened. Naturals kept in hand are naturals that can take
  // the pile again later — except when the side is opening, where every point has to be on the table
  // in this one move.
  const cards = opening ? naturals.slice() : needsTwo ? naturals.slice(0, 2) : [];
  const spent = removeCards(hand, cards);
  if (!spent) return null;

  // `also` is drawn from what is left, and never from the top rank: those naturals are already spoken
  // for, and a second meld of one rank is not a thing a side can hold.
  let also: MeldSpec[] = [];
  if (opening) {
    const laidSoFar = openingValue([...cards, top]);
    if (laidSoFar < legal.minimumMeld) {
      also = selectOpening(spent, existing, legal.minimumMeld - laidSoFar) ?? [];
      if (also.length === 0) return null;
    }
  }

  const fromHand = [...cards, ...also.flatMap((m) => m.cards)];
  const rest = removeCards(hand, fromHand);
  if (!rest) return null;
  const laid = applyMelds(existing, [{ rank, cards: [...cards, top] }, ...also]);
  if (!laid.ok) return null;
  if (opening && openingValue(laid.laid) < legal.minimumMeld) return null;

  // The pile hands back everything under the top card. If that still leaves one card or none, the
  // turn cannot be finished with a discard — the same trap as melding too much, reached backwards.
  const wouldHold = rest.length + legal.pileSize - 1;
  if (wouldHold <= 1 && !hasCanasta(laid.melds)) return null;

  return {
    action: { type: 'take-pile', meld: { rank, cards }, ...(also.length > 0 ? { also } : {}) },
    note: `take the pile of ${legal.pileSize} on ${top}`,
  };
}

/* ---------------------------------------------------------------- decide */

/** Draw, or throw the cheapest thing in hand. Both are legal in their phase whatever else is true. */
function fallback(view: CanastaView, legal: CanastaLegal, team: TeamId): CanastaDecision {
  if (legal.phase === 'draw') return { action: { type: 'draw' }, note: 'default: draw' };
  return { action: { type: 'discard', card: chooseDiscard(view, legal, team) }, note: 'default: discard' };
}

function decide(view: CanastaView, legal: CanastaLegal, seat: number): CanastaDecision {
  const team = teamOf(seat);
  const hand = view.hand ?? [];
  const existing = view.melds[team];

  if (legal.phase === 'draw') {
    return planTakePile(view, legal, team) ?? { action: { type: 'draw' }, note: 'draw' };
  }

  const out = planGoOut(hand, existing, legal.minimumMeld);
  if (out) return out;

  const wanted = legal.minimumMeld > 0 ? selectOpening(hand, existing, legal.minimumMeld) : planMelds(hand, existing);
  if (wanted) {
    const specs = verifyMelds(hand, existing, wanted, legal.minimumMeld);
    if (specs) {
      const note = legal.minimumMeld > 0 ? `open for ${legal.minimumMeld}` : `meld ${specs.map((s) => s.rank).join(',')}`;
      return { action: { type: 'meld', melds: specs }, note };
    }
  }

  return { action: { type: 'discard', card: chooseDiscard(view, legal, team) }, note: 'discard' };
}

/**
 * Pick a move. `view` is the seat's own redacted view; `legal` is what the engine says it may do.
 *
 * Wrapped, because the promise this function makes is that it returns a LEGAL move, and a strategy
 * that throws on a shape it did not expect breaks that promise for a reason the seat did not cause.
 */
export function chooseCanastaAction(view: CanastaView, legal: CanastaLegal, seat: number): CanastaDecision {
  const team = teamOf(seat);
  try {
    return decide(view, legal, seat);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    const back = fallback(view, legal, team);
    return { action: back.action, note: `error (${why}), ${back.note ?? 'default'}`.slice(0, 280) };
  }
}

export { explainMove, spokenCard, spokenRank, type Explanation } from './explain.js';
