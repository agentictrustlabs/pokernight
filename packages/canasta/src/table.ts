/**
 * The Classic Canasta state machine.
 *
 * PURE THROUGHOUT. Every function returns new state and never mutates its input, takes no clock and
 * no randomness beyond the seed it is handed, and does no I/O. A round is therefore a pure function
 * of (seed, action log), which is what lets the deal be committed before it happens and checked
 * afterwards — the same claim the poker engine makes, and it has to be the same claim at every
 * table or it is not a claim at all.
 *
 * A TURN IS: draw or take the pile, then meld as much as you like, then discard. The phase is
 * tracked because a player who has not drawn has not started their turn, and letting them meld first
 * would let them see a card they have not earned.
 */

import { seedCommit, seededShuffle, bytesToHex } from '@pokernight/deal';
import {
  fullDeck,
  handValue,
  isBlackThree,
  isRedThree,
  isWild,
  naturalsOfRank,
  rankOf,
  removeCards,
} from './cards.js';
import {
  applyMelds,
  canTakePile,
  findMeld,
  hasCanasta,
  initialMeldMinimum,
  isLegalMeld,
  openingValue,
} from './meld.js';
import { scoreRound, winnerAt } from './score.js';
import {
  CanastaError,
  SEATS,
  teamOf,
  type Card,
  type CanastaAction,
  type CanastaConfig,
  type CanastaResult,
  type CanastaLegal,
  type CanastaSeat,
  type CanastaState,
  type MeldSpec,
  type Rank,
  type RoundState,
  type TeamId,
} from './types.js';

/**
 * NINETY SECONDS A TURN, where poker gives forty-five.
 *
 * The same reasoning as `maxTimeouts`: a poker turn is a decision about two cards, a canasta turn is
 * a search through a dozen for melds that may not be there. Forty-five seconds was inherited from
 * poker rather than chosen for this game, and it timed out people who were simply reading their hand.
 */
export const DEFAULT_CONFIG: CanastaConfig = { seats: SEATS, target: 5000, turnMs: 90_000 };
/** Cards dealt to each player in the four-hand game. */
export const HAND_SIZE = 11;

/* ------------------------------------------------------------------ events */

export type CanastaEvent =
  | { type: 'round-started'; roundNo: number; seedCommit: string; dealer: number; stock: number }
  /** Private: only the seat that holds them ever sees this. */
  | { type: 'dealt'; seat: number; cards: Card[]; private: true }
  | { type: 'red-three'; seat: number; card: Card; team: TeamId }
  | { type: 'upcard'; card: Card; frozen: boolean }
  | { type: 'drew'; seat: number; stock: number }
  /** Private: the card drawn, to the seat that drew it. */
  | { type: 'drew-card'; seat: number; card: Card; private: true }
  | { type: 'took-pile'; seat: number; cards: number; top: Card }
  | { type: 'melded'; seat: number; team: TeamId; rank: Rank; cards: Card[]; size: number; canasta: boolean }
  | { type: 'opened'; seat: number; team: TeamId; value: number }
  | { type: 'discarded'; seat: number; card: Card; frozen: boolean }
  | { type: 'turn'; seat: number; phase: 'draw' | 'play' }
  | { type: 'round-ended'; result: CanastaResult; net: Record<number, number>; rake: 0 }
  | { type: 'game-ended'; winner: TeamId };

type Applied = { state: CanastaState; events: CanastaEvent[] };

/* ------------------------------------------------------------- the table */

function fail(code: string, message: string): never {
  throw new CanastaError(code, message);
}

export function createTable(patch: Partial<CanastaConfig> = {}): CanastaState {
  const config: CanastaConfig = { ...DEFAULT_CONFIG, ...patch };
  if (config.seats !== SEATS) {
    fail('seats', `canasta is a four-handed partnership game — ${config.seats} seats is a different game`);
  }
  if (!Number.isInteger(config.target) || config.target < 100) fail('target', 'the target score must be at least 100');
  if (!Number.isInteger(config.turnMs) || config.turnMs < 1000) fail('turn', 'a turn must be at least a second');
  return { config, seats: [], roundNo: 0, round: null, scores: { 0: 0, 1: 0 }, winner: null };
}

const clone = (s: CanastaState): CanastaState => ({
  ...s,
  seats: s.seats.map((x) => ({ ...x })),
  scores: { ...s.scores },
  round: s.round ? cloneRound(s.round) : null,
});

function cloneRound(r: RoundState): RoundState {
  const hands: Record<number, Card[]> = {};
  for (const [k, v] of Object.entries(r.hands)) hands[Number(k)] = v.slice();
  return {
    ...r,
    stock: r.stock.slice(),
    discard: r.discard.slice(),
    hands,
    melds: { 0: r.melds[0].map((m) => ({ ...m, cards: m.cards.slice() })), 1: r.melds[1].map((m) => ({ ...m, cards: m.cards.slice() })) },
    redThrees: { 0: r.redThrees[0].slice(), 1: r.redThrees[1].slice() },
    opened: { ...r.opened },
    meldedBefore: { ...r.meldedBefore },
  };
}

/**
 * Is a round RUNNING — as opposed to merely being the last one, sitting there scored?
 *
 * The difference is the whole lifecycle of a table and it was conflated everywhere. `state.round`
 * holds the finished round after it ends, so its score can be read; reading that as "a round is in
 * progress" made a table that had played one round unable to seat anybody, unable to deal again,
 * and — worst of the three — willing to score the same round twice if somebody stood up.
 */
export function roundRunning(state: CanastaState): boolean {
  return state.round !== null && state.round.result === undefined;
}

export function sitDown(state: CanastaState, seat: number, playerId: string, _stake = 0): CanastaState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) fail('seat', `seat ${seat} is not one of this table's four`);
  if (state.seats.some((s) => s.seat === seat)) fail('seat-taken', `seat ${seat} is taken`);
  if (state.seats.some((s) => s.playerId === playerId)) fail('seated', 'you are already at this table');
  // Only while one is actually being played. Between rounds the seat is free, and the deal that
  // follows includes whoever took it — which is the ordinary way a fourth player joins a table.
  if (roundRunning(state)) fail('in-round', 'a round is in progress — the next seat is dealt in at the next deal');
  const next = clone(state);
  next.seats.push({ seat, playerId, status: 'active', timeouts: 0 });
  next.seats.sort((a, b) => a.seat - b.seat);
  return next;
}

export function standUp(state: CanastaState, seat: number): { state: CanastaState; refund: number; events: CanastaEvent[] } {
  const next = clone(state);
  const at = next.seats.findIndex((s) => s.seat === seat);
  if (at === -1) fail('not-seated', `nobody is in seat ${seat}`);
  next.seats.splice(at, 1);
  // A partnership game cannot continue three-handed. The round ends where it stands and is scored
  // as it stands, which is better than dealing on with a seat nobody is playing.
  const events: CanastaEvent[] = [];
  // Only a RUNNING round ends here. Ending an already-scored one would score it a second time and
  // add its total to the scoreboard twice.
  if (roundRunning(next)) {
    const ended = endRound(next, { wentOut: null, concealed: false });
    events.push(...ended.events);
    return { state: ended.state, refund: 0, events };
  }
  return { state: next, refund: 0, events };
}

export function sitOut(state: CanastaState, seat: number): CanastaState {
  const next = clone(state);
  const s = next.seats.find((x) => x.seat === seat);
  if (s) s.status = 'sitting-out';
  return next;
}

export function sitIn(state: CanastaState, seat: number): CanastaState {
  const next = clone(state);
  const s = next.seats.find((x) => x.seat === seat);
  if (s) {
    s.status = 'active';
    s.timeouts = 0;
  }
  return next;
}

export function canStartRound(state: CanastaState): boolean {
  // A finished round is not a reason not to deal — it is the reason TO deal. Reading it as one
  // meant a table played exactly one round and then sat there forever, at a game to five thousand
  // that a single round scores about a fifth of.
  if (roundRunning(state) || state.winner !== null) return false;
  return state.seats.filter((s) => s.status === 'active').length === SEATS;
}

/* -------------------------------------------------------------- the deal */

export function startRound(state: CanastaState, seed: Uint8Array): Applied {
  if (!canStartRound(state)) fail('cannot-start', 'this table cannot deal a round right now');
  const next = clone(state);
  const roundNo = next.roundNo + 1;
  const dealer = (roundNo - 1) % SEATS;
  const deck = seededShuffle(fullDeck(), seed);

  const hands: Record<number, Card[]> = {};
  for (let i = 0; i < SEATS; i++) hands[i] = [];
  let cursor = 0;
  // Round the table one card at a time, as it is actually dealt. The order is not observable from
  // the outside but it is the order the seed commits to, so it must be the order every replay uses.
  for (let n = 0; n < HAND_SIZE; n++) {
    for (let i = 0; i < SEATS; i++) {
      const seat = (dealer + 1 + i) % SEATS;
      (hands[seat] as Card[]).push(deck[cursor++] as Card);
    }
  }

  const round: RoundState = {
    roundNo,
    seedCommit: seedCommit(seed),
    seed: bytesToHex(seed),
    dealer,
    stock: deck.slice(cursor),
    discard: [],
    frozen: false,
    hands,
    melds: { 0: [], 1: [] },
    redThrees: { 0: [], 1: [] },
    toAct: (dealer + 1) % SEATS,
    phase: 'draw',
    actionDeadline: null,
    opened: { 0: false, 1: false },
    meldedBefore: { 0: false, 1: false, 2: false, 3: false },
    meldedThisTurn: false,
  };

  const events: CanastaEvent[] = [
    { type: 'round-started', roundNo, seedCommit: round.seedCommit, dealer, stock: round.stock.length },
  ];

  // Red threes dealt into a hand are laid down at once and replaced. Doing it here rather than on
  // the holder's first turn matters: the replacement comes off the top of the stock, so leaving it
  // until later would change every card that follows.
  for (let i = 0; i < SEATS; i++) {
    const seat = (dealer + 1 + i) % SEATS;
    events.push(...layRedThrees(round, seat).events);
  }
  for (let i = 0; i < SEATS; i++) {
    const seat = (dealer + 1 + i) % SEATS;
    events.push({ type: 'dealt', seat, cards: (round.hands[seat] as Card[]).slice(), private: true });
  }

  // The upcard. A wild or a red three freezes the pile from the first turn, and another card is
  // turned on top of it so nobody is looking at a pile they could never take.
  for (;;) {
    const card = round.stock.pop();
    if (card === undefined) break;
    round.discard.push(card);
    if (isWild(card) || isRedThree(card)) {
      round.frozen = true;
      continue;
    }
    break;
  }
  const top = round.discard[round.discard.length - 1];
  if (top) events.push({ type: 'upcard', card: top, frozen: round.frozen });

  next.round = round;
  next.roundNo = roundNo;
  events.push({ type: 'turn', seat: round.toAct as number, phase: 'draw' });
  return { state: next, events };
}

/**
 * Move every red three out of a seat's hand onto its side's table, drawing a replacement for each.
 *
 * `exhausted` is the case that matters and it is easy to miss: a red three drawn as the stock runs
 * out leaves the hand SHORT, because the three left and nothing came back. A player who ends up
 * holding one card with no canasta then has no legal move at all — they must discard to end the
 * turn, and that discard would be an illegal going-out. So the caller ends the round instead, which
 * is the same rule as any other player who cannot complete their draw.
 */
function layRedThrees(round: RoundState, seat: number): { events: CanastaEvent[]; exhausted: boolean } {
  const events: CanastaEvent[] = [];
  const team = teamOf(seat);
  for (;;) {
    const hand = round.hands[seat] as Card[];
    const at = hand.findIndex(isRedThree);
    if (at === -1) return { events, exhausted: false };
    const [card] = hand.splice(at, 1) as [Card];
    round.redThrees[team].push(card);
    events.push({ type: 'red-three', seat, card, team });
    const replacement = round.stock.pop();
    if (replacement === undefined) return { events, exhausted: true };
    hand.push(replacement);
  }
}

/* ------------------------------------------------------------- the turn */

export function legalFor(state: CanastaState, seat: number): CanastaLegal {
  const round = state.round;
  const idle: CanastaLegal = {
    phase: 'draw',
    canDraw: false,
    canTakePile: false,
    takePileReason: 'it is not your turn',
    pileTop: null,
    pileSize: 0,
    minimumMeld: 0,
    discardable: [],
    canGoOut: false,
  };
  if (!round || round.toAct !== seat || round.result) return idle;

  const team = teamOf(seat);
  const hand = round.hands[seat] ?? [];
  const top = round.discard[round.discard.length - 1] ?? null;
  const take = canTakePile({ top, frozen: round.frozen, hand, melds: round.melds[team] });
  return {
    phase: round.phase,
    canDraw: round.phase === 'draw' && round.stock.length > 0,
    canTakePile: round.phase === 'draw' && take.ok,
    takePileReason: take.ok ? null : take.reason,
    pileTop: top,
    pileSize: round.discard.length,
    minimumMeld: round.opened[team] ? 0 : initialMeldMinimum(state.scores[team]),
    discardable: round.phase === 'play' ? hand.slice() : [],
    canGoOut: hasCanasta(round.melds[team]),
  };
}

export function setActionDeadline(state: CanastaState, deadline: number | null): CanastaState {
  if (!state.round) return state;
  const next = clone(state);
  (next.round as RoundState).actionDeadline = deadline;
  return next;
}

export function applyAction(state: CanastaState, seat: number, action: CanastaAction): Applied {
  const round = state.round;
  if (!round || round.result) fail('no-round', 'there is no round running');
  if (round.toAct !== seat) fail('not-your-turn', 'it is not your turn');

  switch (action.type) {
    case 'draw':
      return doDraw(state, seat);
    case 'take-pile':
      return doTakePile(state, seat, action.meld, action.also ?? []);
    case 'meld':
      return doMeld(state, seat, action.melds);
    case 'discard':
      return doDiscard(state, seat, action.card);
    default:
      fail('unknown', 'that is not a move in this game');
  }
}

function doDraw(state: CanastaState, seat: number): Applied {
  const next = clone(state);
  const round = next.round as RoundState;
  if (round.phase !== 'draw') fail('already-drawn', 'you have already drawn this turn');
  const card = round.stock.pop();
  if (card === undefined) return endRound(next, { wentOut: null, concealed: false });

  (round.hands[seat] as Card[]).push(card);
  const events: CanastaEvent[] = [
    { type: 'drew-card', seat, card, private: true },
    { type: 'drew', seat, stock: round.stock.length },
  ];
  const reds = layRedThrees(round, seat);
  events.push(...reds.events);
  // A red three that could not be replaced leaves this seat a card short and with no legal way to
  // finish its turn. The round ends here, unscored by anybody going out, which is what happens at a
  // real table when the stock runs out mid-draw.
  if (reds.exhausted) {
    const ended = endRound(next, { wentOut: null, concealed: false });
    return { state: ended.state, events: [...events, ...ended.events] };
  }
  round.phase = 'play';
  events.push({ type: 'turn', seat, phase: 'play' });
  return { state: next, events };
}

function doTakePile(state: CanastaState, seat: number, spec: MeldSpec, also: readonly MeldSpec[] = []): Applied {
  const next = clone(state);
  const round = next.round as RoundState;
  if (round.phase !== 'draw') fail('already-drawn', 'you have already drawn this turn');

  const team = teamOf(seat);
  const hand = round.hands[seat] as Card[];
  const top = round.discard[round.discard.length - 1] ?? null;
  const allowed = canTakePile({ top, frozen: round.frozen, hand, melds: round.melds[team] });
  if (!allowed.ok) fail('cannot-take', allowed.reason);
  const topCard = top as Card;

  if (spec.rank !== rankOf(topCard)) {
    fail('wrong-meld', `the top card is a ${rankOf(topCard)} — the meld that takes the pile has to be ${rankOf(topCard)}s`);
  }

  // `spec.cards` are the cards from HAND. The top card joins them; it is not in the hand and asking
  // the caller to list it would be asking them to name a card they do not hold.
  const fromHand = [...spec.cards, ...also.flatMap((m) => m.cards)];
  const rest = removeCards(hand, fromHand);
  if (!rest) fail('not-in-hand', 'you do not hold all of those cards');

  // THE TWO NATURALS ARE FROM THE HAND. A frozen pile, or a rank this side has not melded, can only
  // be entered that way — checking the combined meld instead would let the pile's own top card count
  // as one of the two, which is the whole thing the rule exists to prevent.
  const alreadyMelded = findMeld(round.melds[team], spec.rank);
  if (round.frozen || !alreadyMelded) {
    if (naturalsOfRank(spec.cards, spec.rank).length < 2) {
      fail('need-two', `you have to use two natural ${spec.rank}s from your hand to take the pile`);
    }
  }

  const laid = applyMelds(round.melds[team], [{ rank: spec.rank, cards: [...spec.cards, topCard] }, ...also]);
  if (!laid.ok) fail('illegal-meld', laid.reason);

  const events: CanastaEvent[] = [];
  let justOpened = false;
  if (!round.opened[team]) {
    const value = openingValue(laid.laid);
    const need = initialMeldMinimum(state.scores[team]);
    if (value < need) fail('too-small', `your side needs ${need} to open, and that is ${value}`);
    round.opened[team] = true;
    justOpened = true;
  }

  // THE SAME TRAP AS MELDING, reached a different way. A pile of exactly one card gives nothing
  // back, so spending two or three cards from hand to take it can leave a seat holding one card and
  // no canasta — and then the discard that must end the turn would be an illegal going-out.
  const wouldHold = rest.length + round.discard.length - 1;
  if (wouldHold <= 1 && !hasCanasta(laid.melds)) {
    fail('no-canasta', 'taking that pile would leave you with nothing to discard, and no canasta to go out on');
  }

  const taken = round.discard.length;
  round.melds[team] = laid.melds;
  // The rest of the pile goes into the hand, and only then. Melding out of it happens on later
  // moves this turn, which is exactly what a player takes the pile for.
  round.hands[seat] = [...rest, ...round.discard.slice(0, -1)];
  round.discard = [];
  round.frozen = false;
  round.phase = 'play';
  round.meldedThisTurn = true;

  events.push({ type: 'took-pile', seat, cards: taken, top: topCard });
  if (justOpened) events.push({ type: 'opened', seat, team, value: openingValue(laid.laid) });
  for (const m of [{ rank: spec.rank, cards: [...spec.cards, topCard] }, ...also]) {
    const done = findMeld(laid.melds, m.rank) as { rank: Rank; cards: Card[] };
    events.push({ type: 'melded', seat, team, rank: m.rank, cards: m.cards.slice(), size: done.cards.length, canasta: done.cards.length >= 7 });
  }
  events.push(...layRedThrees(round, seat).events);
  events.push({ type: 'turn', seat, phase: 'play' });
  return { state: next, events };
}

function doMeld(state: CanastaState, seat: number, specs: readonly MeldSpec[]): Applied {
  const next = clone(state);
  const round = next.round as RoundState;
  if (round.phase !== 'play') fail('draw-first', 'draw or take the pile before you meld');

  const team = teamOf(seat);
  const hand = round.hands[seat] as Card[];
  const all = specs.flatMap((m) => m.cards);
  const rest = removeCards(hand, all);
  if (!rest) fail('not-in-hand', 'you do not hold all of those cards');

  // Black threes are a going-out move and nothing else: melding them mid-turn would park a rank
  // nobody can add to on the table and let a side sit behind it.
  if (specs.some((m) => m.rank === '3') && rest.length !== 0) {
    fail('black-threes', 'black threes can only be melded as you go out');
  }

  const laid = applyMelds(round.melds[team], specs);
  if (!laid.ok) fail('illegal-meld', laid.reason);

  const events: CanastaEvent[] = [];
  if (!round.opened[team]) {
    const value = openingValue(laid.laid);
    const need = initialMeldMinimum(state.scores[team]);
    // THE MINIMUM IS MET IN ONE MOVE. A player opening lays everything they are opening with in a
    // single `meld`, because a rule that counted melds across a turn would have to let somebody lay
    // half of it and then refuse the rest, with the first half already on the table.
    if (value < need) fail('too-small', `your side needs ${need} to open, and that is ${value}`);
    round.opened[team] = true;
    events.push({ type: 'opened', seat, team, value });
  }

  // YOU MUST KEEP A CARD TO DISCARD, unless you are going out — and going out needs a canasta.
  //
  // Both halves matter, and the second one is the easy one to miss. Melding down to a single card
  // without a canasta is legal-looking and fatal: the turn can only end with a discard, that discard
  // would empty the hand, and emptying the hand without a canasta is refused. The player would be
  // stuck with no legal move at all. So the meld is what gets refused, while it can still be undone
  // by simply not making it.
  if (rest.length <= 1 && !hasCanasta(laid.melds)) {
    fail('no-canasta', 'you need a canasta before you can go out, and you have to keep a card to discard');
  }

  round.melds[team] = laid.melds;
  round.hands[seat] = rest;
  round.meldedThisTurn = true;
  for (const spec of specs) {
    const meld = findMeld(laid.melds, spec.rank) as { rank: Rank; cards: Card[] };
    events.push({ type: 'melded', seat, team, rank: spec.rank, cards: spec.cards.slice(), size: meld.cards.length, canasta: meld.cards.length >= 7 });
  }

  // Melding the last card IS going out, with no final discard. `meldedBefore` still holds what was
  // true when the turn began, which is exactly what decides whether this was concealed.
  if (rest.length === 0) {
    const ended = endRound(next, { wentOut: seat, concealed: !round.meldedBefore[seat] });
    return { state: ended.state, events: [...events, ...ended.events] };
  }
  return { state: next, events };
}

function doDiscard(state: CanastaState, seat: number, card: Card): Applied {
  const next = clone(state);
  const round = next.round as RoundState;
  if (round.phase !== 'play') fail('draw-first', 'draw or take the pile before you discard');

  const team = teamOf(seat);
  const hand = round.hands[seat] as Card[];
  const rest = removeCards(hand, [card]);
  if (!rest) fail('not-in-hand', 'you are not holding that card');
  if (isRedThree(card)) fail('red-three', 'a red three is never discarded — it goes on the table');

  const goingOut = rest.length === 0;
  if (goingOut && !hasCanasta(round.melds[team])) fail('no-canasta', 'you need a canasta before you can go out');

  round.hands[seat] = rest;
  round.discard.push(card);
  if (isWild(card)) round.frozen = true;

  const events: CanastaEvent[] = [{ type: 'discarded', seat, card, frozen: round.frozen }];
  if (goingOut) {
    // Concealed reads `meldedBefore`, which is only ever written at the END of a turn — so a player
    // who opened and went out in this same turn still counts as concealed, which is the rule.
    const ended = endRound(next, { wentOut: seat, concealed: !round.meldedBefore[seat] });
    return { state: ended.state, events: [...events, ...ended.events] };
  }

  // The turn is over. Fold what was laid this turn into what this seat has ever laid, and pass on.
  if (round.meldedThisTurn) round.meldedBefore[seat] = true;
  round.meldedThisTurn = false;
  round.toAct = nextActive(next, seat);
  round.phase = 'draw';
  events.push({ type: 'turn', seat: round.toAct as number, phase: 'draw' });
  return { state: next, events };
}

function nextActive(state: CanastaState, from: number): number {
  for (let i = 1; i <= SEATS; i++) {
    const seat = (from + i) % SEATS;
    if (state.seats.some((s) => s.seat === seat && s.status === 'active')) return seat;
  }
  return from;
}

/**
 * The clock ran out.
 *
 * Every game must have an answer to this that is not "nothing", because a table with a seat that has
 * walked away has to keep dealing. Canasta's is the smallest legal turn there is: draw if you have
 * not, then throw the least valuable card you are holding. It never goes out and never melds, so it
 * cannot spend a canasta on somebody's behalf.
 */
export function timeoutAction(state: CanastaState, seat: number): Applied {
  const round = state.round;
  if (!round || round.result || round.toAct !== seat) return { state, events: [] };

  let current = state;
  const events: CanastaEvent[] = [];
  if ((current.round as RoundState).phase === 'draw') {
    const drawn = doDraw(current, seat);
    current = drawn.state;
    events.push(...drawn.events);
    if ((current.round as RoundState | null)?.result || current.round === null) return { state: current, events };
  }

  const hand = ((current.round as RoundState).hands[seat] ?? []).slice();
  if (hand.length === 0) return { state: current, events };
  // The cheapest card, and never a red three — which cannot be discarded at all.
  const cheapest = hand
    .filter((c) => !isRedThree(c))
    .sort((a, b) => handValue([a]) - handValue([b]) || a.localeCompare(b))[0];
  if (cheapest === undefined) return { state: current, events };

  const seatRec = current.seats.find((s) => s.seat === seat);
  const bumped = clone(current);
  const rec = bumped.seats.find((s) => s.seat === seat);
  if (rec && seatRec) rec.timeouts = seatRec.timeouts + 1;

  const out = doDiscard(bumped, seat, cheapest);
  return { state: out.state, events: [...events, ...out.events] };
}

/* ------------------------------------------------------------ ending it */

function endRound(state: CanastaState, outcome: { wentOut: number | null; concealed: boolean }): Applied {
  const next = clone(state);
  const round = next.round as RoundState;
  const result = scoreRound(round, next.scores, outcome);

  round.result = result;
  round.seedReveal = round.seed;
  delete round.seed;
  round.toAct = null;
  round.actionDeadline = null;
  next.scores = { ...result.totals };

  // The host writes one row per SEAT, so each partner is credited with what their side scored. It
  // does not sum to zero and is not meant to: canasta is played for score, not for stakes.
  const net: Record<number, number> = {};
  for (const s of next.seats) net[s.seat] = result.scores[teamOf(s.seat)].total;

  const events: CanastaEvent[] = [{ type: 'round-ended', result, net, rake: 0 }];
  const winner = winnerAt(result.totals, next.config.target);
  if (winner !== null) {
    next.winner = winner;
    events.push({ type: 'game-ended', winner });
  }
  return { state: next, events };
}

/* ----------------------------------------------------------- what you see */

export interface CanastaView {
  roundNo: number;
  seedCommit: string | null;
  seedReveal: string | null;
  dealer: number | null;
  toAct: number | null;
  phase: 'draw' | 'play';
  actionDeadline: number | null;
  stock: number;
  /** The pile's top card and its size. What is underneath is not public. */
  pileTop: Card | null;
  pileSize: number;
  frozen: boolean;
  target: number;
  scores: Record<TeamId, number>;
  winner: TeamId | null;
  melds: Record<TeamId, { rank: Rank; cards: Card[]; canasta: boolean; natural: boolean }[]>;
  redThrees: Record<TeamId, number>;
  seats: { seat: number; playerId: string; status: string; cards: number; team: TeamId }[];
  /** The viewer's own hand, and nobody else's. Null for a spectator. */
  hand: Card[] | null;
  result: RoundState['result'] | null;
}

/**
 * The table as one seat sees it.
 *
 * THE ONLY THING BETWEEN A PLAYER AND SOMEBODY ELSE'S HAND. Every other seat is reported as a card
 * COUNT, the stock as a count, and the discard pile as its top card and a size — because the cards
 * buried in the pile are exactly what a player is trying to work out, and handing them over would
 * be handing over the game.
 */
export function viewFor(state: CanastaState, seat: number | null): CanastaView {
  const round = state.round;
  const decorate = (team: TeamId) =>
    (round?.melds[team] ?? []).map((m) => ({
      rank: m.rank,
      cards: m.cards.slice(),
      canasta: m.cards.length >= 7,
      natural: m.cards.length >= 7 && !m.cards.some(isWild),
    }));

  return {
    roundNo: round?.roundNo ?? state.roundNo,
    seedCommit: round?.seedCommit ?? null,
    seedReveal: round?.seedReveal ?? null,
    dealer: round?.dealer ?? null,
    toAct: round?.toAct ?? null,
    phase: round?.phase ?? 'draw',
    actionDeadline: round?.actionDeadline ?? null,
    stock: round?.stock.length ?? 0,
    pileTop: round ? (round.discard[round.discard.length - 1] ?? null) : null,
    pileSize: round?.discard.length ?? 0,
    frozen: round?.frozen ?? false,
    target: state.config.target,
    scores: { ...state.scores },
    winner: state.winner,
    melds: { 0: decorate(0), 1: decorate(1) },
    redThrees: { 0: round?.redThrees[0].length ?? 0, 1: round?.redThrees[1].length ?? 0 },
    seats: state.seats.map((s) => ({
      seat: s.seat,
      playerId: s.playerId,
      status: s.status,
      cards: round?.hands[s.seat]?.length ?? 0,
      team: teamOf(s.seat),
    })),
    hand: seat === null ? null : (round?.hands[seat]?.slice() ?? null),
    result: round?.result ?? null,
  };
}

/** The same event as one seat may see it, or null if they may not see it at all. */
export function redactEvent(event: CanastaEvent, seat: number | null): CanastaEvent | null {
  if (!('private' in event) || !event.private) return event;
  return event.seat === seat ? event : null;
}

export { CanastaError };
