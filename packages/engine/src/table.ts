import type {
  Action,
  ActionRecord,
  Card,
  EngineEvent,
  HandRank,
  HandResult,
  HandSeat,
  HandState,
  LegalActions,
  Pot,
  PotAward,
  Seat,
  SeatView,
  Street,
  TableConfig,
  TableState,
  TableView,
} from './types.js';
import { EngineError } from './types.js';
import { fullDeck } from './cards.js';
import { bytesToHex, seedCommit, seededShuffle } from './rng.js';
import { evaluateHand } from './evaluate.js';

export const DEFAULT_CONFIG: TableConfig = {
  seats: 6,
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  minBuyIn: 40,
  maxBuyIn: 200,
  actionTimeoutMs: 30_000,
};

const EMPTY_LEGAL: LegalActions = { fold: false, check: false, call: null, bet: null, raise: null, allIn: 0 };

type Result = { state: TableState; events: EngineEvent[] };

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Cheap deep copy of a state (all plain JSON). Immutable sub-objects (config, action records) are shared. */
function cloneState(s: TableState): TableState {
  return {
    config: s.config,
    seats: s.seats.map((x) => ({ ...x })),
    button: s.button,
    handNo: s.handNo,
    hand: s.hand ? cloneHand(s.hand) : null,
  };
}

function cloneHand(h: HandState): HandState {
  return {
    ...h,
    board: h.board.slice(),
    deck: h.deck.slice(),
    seats: h.seats.map((x) => ({ ...x, holeCards: x.holeCards.slice() })),
    pots: clonePots(h.pots),
    actions: h.actions.slice(),
  };
}

function clonePots(pots: readonly Pot[]): Pot[] {
  return pots.map((p) => ({ amount: p.amount, eligible: p.eligible.slice() }));
}

function handRunning(s: TableState): boolean {
  return s.hand !== null && s.hand.result === undefined;
}

function findSeat(s: TableState, seat: number): Seat | undefined {
  return s.seats.find((x) => x.seat === seat);
}

function requireSeat(s: TableState, seat: number): Seat {
  const found = findSeat(s, seat);
  if (!found) throw new EngineError('not-seated', `no player at seat ${seat}`);
  return found;
}

function validateSeatIndex(s: TableState, seat: number): void {
  if (!isInt(seat) || seat < 0 || seat >= s.config.seats) {
    throw new EngineError('seat-invalid', `seat ${seat} out of range 0..${s.config.seats - 1}`);
  }
}

function handSeat(hand: HandState, seat: number): HandSeat | undefined {
  return hand.seats.find((x) => x.seat === seat);
}

/**
 * Seats in clockwise order starting strictly after `from` (or at `from` when
 * `inclusive`). `seats` must be sorted ascending. `from` need not be a member.
 */
function clockwise(seats: readonly number[], from: number, inclusive = false): number[] {
  const after: number[] = [];
  const before: number[] = [];
  for (const s of seats) {
    if (s > from || (inclusive && s === from)) after.push(s);
    else before.push(s);
  }
  return after.concat(before);
}

/** Dealt-in candidates: active, with chips, not leaving. */
function candidates(s: TableState): Seat[] {
  return s.seats.filter((x) => x.status === 'active' && x.stack > 0 && !x.leaving);
}

/* ---------------------------------------------------------------------------
 * Table lifecycle (outside a hand)
 * ------------------------------------------------------------------------ */

/** Create an empty table. Partial config is merged over DEFAULT_CONFIG and validated. */
export function createTable(config: Partial<TableConfig> = {}): TableState {
  const c: TableConfig = { ...DEFAULT_CONFIG, ...config };
  if (!isInt(c.seats) || c.seats < 2 || c.seats > 9) throw new EngineError('seat-invalid', 'seats must be 2..9');
  if (!isInt(c.smallBlind) || !isInt(c.bigBlind) || c.smallBlind <= 0 || c.smallBlind >= c.bigBlind) {
    throw new EngineError('illegal-action', 'blinds must be integers with 0 < smallBlind < bigBlind');
  }
  if (!isInt(c.ante) || c.ante < 0) throw new EngineError('illegal-action', 'ante must be a non-negative integer');
  if (!isInt(c.minBuyIn) || !isInt(c.maxBuyIn) || c.minBuyIn > c.maxBuyIn || c.minBuyIn < c.bigBlind) {
    throw new EngineError('buy-in-range', 'need bigBlind <= minBuyIn <= maxBuyIn');
  }
  if (!isInt(c.actionTimeoutMs) || c.actionTimeoutMs < 0) {
    throw new EngineError('illegal-action', 'actionTimeoutMs must be a non-negative integer');
  }
  return { config: c, seats: [], button: null, handNo: 0, hand: null };
}

/**
 * Seat a player. Allowed during a hand (they join the next hand and are
 * flagged waitingForBigBlind). Throws seat-taken / seat-invalid /
 * player-seated / buy-in-range.
 */
export function sitDown(state: TableState, seat: number, playerId: string, buyIn: number): TableState {
  validateSeatIndex(state, seat);
  if (findSeat(state, seat)) throw new EngineError('seat-taken', `seat ${seat} is taken`);
  if (state.seats.some((x) => x.playerId === playerId)) {
    throw new EngineError('player-seated', `player ${playerId} is already seated`);
  }
  if (!isInt(buyIn) || buyIn < state.config.minBuyIn || buyIn > state.config.maxBuyIn) {
    throw new EngineError('buy-in-range', `buy-in must be ${state.config.minBuyIn}..${state.config.maxBuyIn}`);
  }
  const st = cloneState(state);
  st.seats.push({ seat, playerId, stack: buyIn, status: 'active', waitingForBigBlind: true, timeouts: 0 });
  st.seats.sort((a, b) => a.seat - b.seat);
  return st;
}

/**
 * Remove a player. If a hand is in progress and the seat is in it, the seat is
 * folded first (the chips already bet stay in the pot) and removed when the
 * hand ends; the returned state reflects the fold immediately. Returns the
 * stack that leaves with the player in `cashOut`.
 */
export function standUp(state: TableState, seat: number): { state: TableState; cashOut: number; events: EngineEvent[] } {
  const ps = requireSeat(state, seat);
  const cashOut = ps.stack + (ps.pendingAddChips ?? 0);
  const inHand = handRunning(state) ? handSeat(state.hand as HandState, seat) : undefined;

  if (!inHand) {
    const st = cloneState(state);
    st.seats = st.seats.filter((x) => x.seat !== seat);
    return { state: st, cashOut, events: [] };
  }

  // Flag the seat so it leaves at hand end, then fold it.
  let st = cloneState(state);
  const mine = requireSeat(st, seat);
  mine.leaving = true;
  delete mine.pendingAddChips;
  const events: EngineEvent[] = [];

  const hand = st.hand as HandState;
  const hs = handSeat(hand, seat) as HandSeat;
  if (hs.folded) return { state: st, cashOut, events };

  if (hand.toAct === seat) {
    const r = applyActionInternal(st, seat, { type: 'fold' }, false);
    st = r.state;
    events.push(...r.events);
    return { state: st, cashOut, events };
  }

  // Out-of-turn fold (e.g. the seat is all-in or waiting): fold in place.
  hs.folded = true;
  hs.acted = true;
  const record: ActionRecord = { seat, street: hand.street, action: { type: 'fold' }, amount: 0 };
  hand.actions.push(record);
  events.push({ type: 'action', record });
  const prevToAct = hand.toAct;
  if (prevToAct === null) return { state: st, cashOut, events };
  const before = events.length;
  advance(st, events, prevToAct, true);
  // Drop a duplicate `turn` for the unchanged actor.
  if (st.hand && st.hand.toAct === prevToAct && st.hand.result === undefined) {
    const idx = events.findIndex((e, i) => i >= before && e.type === 'turn');
    if (idx >= 0) events.splice(idx, 1);
  }
  return { state: st, cashOut, events };
}

/** Add chips to a seated player's stack; applied immediately if no hand, else at hand end. Enforces maxBuyIn on the resulting stack. */
export function addChips(state: TableState, seat: number, amount: number): TableState {
  const ps = requireSeat(state, seat);
  if (!isInt(amount) || amount <= 0) throw new EngineError('buy-in-range', 'amount must be a positive integer');
  if (ps.stack + (ps.pendingAddChips ?? 0) + amount > state.config.maxBuyIn) {
    throw new EngineError('buy-in-range', `stack would exceed maxBuyIn ${state.config.maxBuyIn}`);
  }
  const st = cloneState(state);
  const mine = requireSeat(st, seat);
  const inHand = handRunning(st) && handSeat(st.hand as HandState, seat) !== undefined;
  if (inHand) mine.pendingAddChips = (mine.pendingAddChips ?? 0) + amount;
  else mine.stack += amount;
  return st;
}

export function sitOut(state: TableState, seat: number): TableState {
  requireSeat(state, seat);
  const st = cloneState(state);
  requireSeat(st, seat).status = 'sitting-out';
  return st;
}

export function sitIn(state: TableState, seat: number): TableState {
  requireSeat(state, seat);
  const st = cloneState(state);
  requireSeat(st, seat).status = 'active';
  return st;
}

/** True when no hand is running and at least two active seats have chips. */
export function canStartHand(state: TableState): boolean {
  return !handRunning(state) && candidates(state).length >= 2;
}

/* ---------------------------------------------------------------------------
 * Pots
 * ------------------------------------------------------------------------ */

/** Rebuild main and side pots from totalBet. Folded seats contribute but are never eligible. */
function buildPots(seats: readonly HandSeat[]): Pot[] {
  const live = seats.filter((s) => !s.folded);
  const levels = Array.from(new Set(live.map((s) => s.totalBet).filter((t) => t > 0))).sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i] as number;
    // The top pot absorbs everything above it (dead money from folded seats).
    const cap = i === levels.length - 1 ? Infinity : level;
    let amount = 0;
    for (const s of seats) amount += Math.max(0, Math.min(s.totalBet, cap) - prev);
    const eligible = live.filter((s) => s.totalBet >= level).map((s) => s.seat);
    pots.push({ amount, eligible });
    prev = level;
  }
  return pots;
}

/** Return the uncalled portion of the largest live bet to its owner. */
function refundUncalled(st: TableState): void {
  const hand = st.hand as HandState;
  let top: HandSeat | null = null;
  for (const s of hand.seats) {
    if (s.folded) continue;
    if (!top || s.totalBet > top.totalBet) top = s;
  }
  if (!top) return;
  let maxOther = 0;
  for (const s of hand.seats) if (s !== top && s.totalBet > maxOther) maxOther = s.totalBet;
  const refund = top.totalBet - maxOther;
  if (refund <= 0) return;
  top.totalBet -= refund;
  top.streetBet -= refund;
  requireSeat(st, top.seat).stack += refund;
}

function settleStreet(st: TableState, events: EngineEvent[]): void {
  const hand = st.hand as HandState;
  refundUncalled(st);
  hand.pots = buildPots(hand.seats);
  events.push({ type: 'pots', pots: clonePots(hand.pots) });
}

/* ---------------------------------------------------------------------------
 * Legal actions
 * ------------------------------------------------------------------------ */

/** Legal actions for `seat` right now. Returns all-false/null if it is not that seat's turn. */
export function legalActions(state: TableState, seat: number): LegalActions {
  if (!handRunning(state)) return EMPTY_LEGAL;
  const hand = state.hand as HandState;
  if (hand.toAct !== seat) return EMPTY_LEGAL;
  const hs = handSeat(hand, seat);
  const ps = findSeat(state, seat);
  if (!hs || !ps || hs.folded || hs.allIn || ps.stack <= 0) return EMPTY_LEGAL;

  const stack = ps.stack;
  const toCall = Math.max(0, hand.currentBet - hs.streetBet);
  const allInTo = hs.streetBet + stack;

  let bet: LegalActions['bet'] = null;
  let raise: LegalActions['raise'] = null;
  if (hand.currentBet === 0) {
    bet = { min: Math.min(state.config.bigBlind, stack), max: stack };
  } else if (!hs.acted && stack > toCall) {
    raise = { min: Math.min(hand.currentBet + hand.minRaise, allInTo), max: allInTo };
  }

  return {
    fold: true,
    check: toCall === 0,
    call: toCall > 0 ? Math.min(toCall, stack) : null,
    bet,
    raise,
    allIn: stack,
  };
}

/* ---------------------------------------------------------------------------
 * Hand lifecycle
 * ------------------------------------------------------------------------ */

function resolveButton(prev: number | null, seats: readonly number[]): number {
  if (prev === null) return seats[0] as number;
  if (seats.includes(prev)) return prev;
  return clockwise(seats, prev)[0] as number;
}

/**
 * Start a hand: move the button, post antes and blinds, shuffle with `seed`,
 * deal hole cards, and set `toAct`. Emits hand-started, blind-posted,
 * hole-cards (private, one per seat), pots, and turn. If every player but one
 * is all-in from the blinds, the hand runs out automatically (see applyAction).
 * Throws hand-in-progress / not-enough-players.
 */
export function startHand(state: TableState, seed: Uint8Array): Result {
  if (handRunning(state)) throw new EngineError('hand-in-progress', 'a hand is already running');
  const st = cloneState(state);
  const cands = candidates(st);
  if (cands.length < 2) throw new EngineError('not-enough-players', 'need two active seats with chips');

  // Who is dealt in, and where is the button.
  const base = cands.filter((s) => !s.waitingForBigBlind);
  let dealt: Seat[];
  let button: number;
  if (base.length < 2) {
    dealt = cands;
    button = resolveButton(st.button, dealt.map((s) => s.seat));
  } else {
    const baseSeats = base.map((s) => s.seat);
    const candSeats = cands.map((s) => s.seat);
    button = resolveButton(st.button, baseSeats);
    // The big blind walks clockwise over every candidate; a waiting player is
    // dealt in when it lands on them.
    let bbSeat: number;
    if (base.length === 2) {
      bbSeat = clockwise(candSeats, button)[0] as number;
    } else {
      const sb = clockwise(baseSeats, button)[0] as number;
      bbSeat = clockwise(candSeats, sb)[0] as number;
    }
    const joining = cands.find((s) => s.seat === bbSeat && s.waitingForBigBlind);
    dealt = joining ? base.concat(joining).sort((a, b) => a.seat - b.seat) : base;
  }
  for (const s of dealt) s.waitingForBigBlind = false;

  const dealtSeats = dealt.map((s) => s.seat);
  const n = dealtSeats.length;
  let sbSeat: number;
  let bbSeat: number;
  if (n === 2) {
    sbSeat = button;
    bbSeat = dealtSeats.find((s) => s !== button) as number;
  } else {
    sbSeat = clockwise(dealtSeats, button)[0] as number;
    bbSeat = clockwise(dealtSeats, sbSeat)[0] as number;
  }

  // Shuffle and deal, one card per seat per round, starting left of the button.
  const deck = seededShuffle(fullDeck(), seed);
  const dealOrder = clockwise(dealtSeats, button);
  const hole = new Map<number, Card[]>();
  for (const s of dealOrder) hole.set(s, []);
  let next = 0;
  for (let round = 0; round < 2; round++) {
    for (const s of dealOrder) (hole.get(s) as Card[]).push(deck[next++] as Card);
  }

  const handNo = st.handNo + 1;
  const hand: HandState = {
    handNo,
    seedCommit: seedCommit(seed),
    seed: bytesToHex(seed),
    button,
    smallBlindSeat: sbSeat,
    bigBlindSeat: bbSeat,
    street: 'preflop',
    board: [],
    deck: deck.slice(next),
    seats: dealtSeats.map((seat) => ({
      seat,
      holeCards: hole.get(seat) as Card[],
      streetBet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      acted: false,
    })),
    pots: [],
    toAct: null,
    currentBet: st.config.bigBlind,
    minRaise: st.config.bigBlind,
    lastAggressor: null,
    actions: [],
    actionDeadline: null,
  };
  st.hand = hand;
  st.handNo = handNo;
  st.button = button;

  const events: EngineEvent[] = [];
  events.push({ type: 'hand-started', handNo, seedCommit: hand.seedCommit, button, seats: dealtSeats.slice() });

  const post = (seat: number, amount: number, kind: 'small' | 'big' | 'ante'): void => {
    const ps = requireSeat(st, seat);
    const hs = handSeat(hand, seat) as HandSeat;
    const actual = Math.min(amount, ps.stack);
    ps.stack -= actual;
    hs.totalBet += actual;
    if (kind !== 'ante') hs.streetBet += actual;
    if (ps.stack === 0) hs.allIn = true;
    events.push({ type: 'blind-posted', seat, kind, amount: actual });
  };
  if (st.config.ante > 0) for (const s of dealOrder) post(s, st.config.ante, 'ante');
  post(sbSeat, st.config.smallBlind, 'small');
  post(bbSeat, st.config.bigBlind, 'big');

  for (const s of dealOrder) {
    events.push({ type: 'hole-cards', seat: s, cards: (hole.get(s) as Card[]).slice(), private: true });
  }

  hand.pots = buildPots(hand.seats);
  events.push({ type: 'pots', pots: clonePots(hand.pots) });

  advance(st, events, bbSeat, false);
  return { state: st, events };
}

/** Whether a seat still has to act on this street. */
function needsAction(hs: HandSeat, hand: HandState, canActCount: number): boolean {
  if (hs.folded || hs.allIn) return false;
  if (hs.streetBet < hand.currentBet) return true;
  return !hs.acted && canActCount >= 2;
}

function dealStreet(hand: HandState, events: EngineEvent[], bigBlind: number): void {
  let count: number;
  if (hand.street === 'preflop') {
    hand.street = 'flop';
    count = 3;
  } else if (hand.street === 'flop') {
    hand.street = 'turn';
    count = 1;
  } else {
    hand.street = 'river';
    count = 1;
  }
  for (let i = 0; i < count; i++) hand.board.push(hand.deck.shift() as Card);
  for (const s of hand.seats) {
    s.streetBet = 0;
    s.acted = false;
  }
  hand.currentBet = 0;
  hand.minRaise = bigBlind;
  hand.lastAggressor = null;
  events.push({ type: 'street', street: hand.street as 'flop' | 'turn' | 'river', board: hand.board.slice() });
}

/**
 * Find the next seat to act after `from`, or close the street: settle pots,
 * deal the next street / run out the board, showdown, end the hand.
 */
function advance(st: TableState, events: EngineEvent[], from: number, inclusive: boolean): void {
  const hand = st.hand as HandState;
  const live = hand.seats.filter((s) => !s.folded);
  if (live.length <= 1) {
    endHand(st, events, false);
    return;
  }
  const canAct = live.filter((s) => !s.allIn).length;
  for (const seat of clockwise(hand.seats.map((s) => s.seat), from, inclusive)) {
    const hs = handSeat(hand, seat) as HandSeat;
    if (needsAction(hs, hand, canAct)) {
      hand.toAct = seat;
      events.push({ type: 'turn', seat, legal: legalActions(st, seat) });
      return;
    }
  }

  // Street closed.
  hand.toAct = null;
  settleStreet(st, events);
  if (hand.street === 'river') {
    endHand(st, events, true);
    return;
  }
  if (canAct <= 1) {
    while ((hand.street as Street) !== 'river') dealStreet(hand, events, st.config.bigBlind);
    endHand(st, events, true);
    return;
  }
  dealStreet(hand, events, st.config.bigBlind);
  advance(st, events, hand.button, false);
}

function endHand(st: TableState, events: EngineEvent[], showdown: boolean): void {
  const hand = st.hand as HandState;
  if (!showdown) settleStreet(st, events);

  const awards: PotAward[] = [];
  let shown: HandResult['shown'] = [];
  if (showdown) {
    hand.street = 'showdown';
    const ranks = new Map<number, HandRank>();
    for (const hs of hand.seats) {
      if (hs.folded) continue;
      hs.shown = true;
      ranks.set(hs.seat, evaluateHand(hs.holeCards.concat(hand.board)));
    }
    shown = hand.seats
      .filter((hs) => !hs.folded)
      .map((hs) => ({ seat: hs.seat, holeCards: hs.holeCards.slice(), rank: ranks.get(hs.seat) as HandRank }));
    events.push({ type: 'showdown', shown: shown.map((s) => ({ ...s, holeCards: s.holeCards.slice() })) });

    hand.pots.forEach((pot, potIndex) => {
      let best = -1;
      let winners: number[] = [];
      for (const seat of pot.eligible) {
        const v = (ranks.get(seat) as HandRank).value;
        if (v > best) {
          best = v;
          winners = [seat];
        } else if (v === best) winners.push(seat);
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      // Odd chips go to the first winners clockwise from the button.
      for (const seat of clockwise(winners, hand.button)) {
        const amount = share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        awards.push({ potIndex, amount, seat, rank: ranks.get(seat) as HandRank });
      }
    });
  } else {
    hand.pots.forEach((pot, potIndex) => {
      awards.push({ potIndex, amount: pot.amount, seat: pot.eligible[0] as number });
    });
  }

  const net: Record<number, number> = {};
  for (const hs of hand.seats) net[hs.seat] = hs.totalBet === 0 ? 0 : -hs.totalBet; // avoid -0
  for (const a of awards) {
    net[a.seat] = (net[a.seat] ?? 0) + a.amount;
    requireSeat(st, a.seat).stack += a.amount;
  }
  const result: HandResult = { awards, net, shown, rake: 0 };
  hand.result = result;
  hand.seedReveal = hand.seed as string;
  delete hand.seed;
  hand.toAct = null;
  hand.actionDeadline = null;
  events.push({ type: 'hand-ended', handNo: hand.handNo, result, seedReveal: hand.seedReveal });

  // Between-hand bookkeeping.
  st.seats = st.seats.filter((s) => !s.leaving);
  for (const s of st.seats) {
    if (s.pendingAddChips) {
      s.stack += s.pendingAddChips;
      delete s.pendingAddChips;
    }
    if (s.stack === 0) s.status = 'sitting-out';
  }
  const nextCands = candidates(st).map((s) => s.seat);
  st.button = nextCands.length ? (clockwise(nextCands, hand.button)[0] as number) : hand.button;
}

function applyActionInternal(state: TableState, seat: number, action: Action, timedOut: boolean): Result {
  if (!handRunning(state)) throw new EngineError('no-hand', 'no hand in progress');
  if ((state.hand as HandState).toAct !== seat) throw new EngineError('not-your-turn', `seat ${seat} is not to act`);
  const legal = legalActions(state, seat);

  const st = cloneState(state);
  const hand = st.hand as HandState;
  const hs = handSeat(hand, seat) as HandSeat;
  const ps = requireSeat(st, seat);
  const illegal = (why: string): EngineError => new EngineError('illegal-action', why);

  let pay = 0;
  const commit = (): void => {
    ps.stack -= pay;
    hs.streetBet += pay;
    hs.totalBet += pay;
    if (ps.stack === 0) hs.allIn = true;
  };
  const aggressive = (to: number): void => {
    commit();
    const increment = to - hand.currentBet;
    if (increment >= hand.minRaise) {
      // A full raise reopens the action for everyone else.
      hand.minRaise = increment;
      for (const other of hand.seats) if (other.seat !== seat) other.acted = false;
    }
    hand.currentBet = to;
    hand.lastAggressor = seat;
    hs.acted = true;
  };

  switch (action.type) {
    case 'fold':
      if (!legal.fold) throw illegal('cannot fold');
      hs.folded = true;
      hs.acted = true;
      break;
    case 'check':
      if (!legal.check) throw illegal('cannot check facing a bet');
      hs.acted = true;
      break;
    case 'call':
      if (legal.call === null) throw illegal('nothing to call');
      pay = legal.call;
      commit();
      hs.acted = true;
      break;
    case 'bet': {
      if (!legal.bet) throw illegal('betting is not open');
      const { amount } = action;
      if (!isInt(amount) || amount < legal.bet.min || amount > legal.bet.max) throw illegal(`bet ${amount} out of range`);
      pay = amount - hs.streetBet;
      aggressive(amount);
      break;
    }
    case 'raise': {
      if (!legal.raise) throw illegal('raising is not open');
      const { amount } = action;
      if (!isInt(amount) || amount > legal.raise.max || amount <= hand.currentBet) throw illegal(`raise ${amount} out of range`);
      if (amount - hand.currentBet < hand.minRaise && amount !== legal.raise.max) {
        throw illegal(`raise to ${amount} is below the minimum ${hand.currentBet + hand.minRaise}`);
      }
      pay = amount - hs.streetBet;
      aggressive(amount);
      break;
    }
    case 'all-in': {
      if (legal.allIn <= 0) throw illegal('no chips');
      pay = ps.stack;
      const to = hs.streetBet + pay;
      if (to > hand.currentBet) aggressive(to);
      else {
        commit();
        hs.acted = true;
      }
      break;
    }
    default:
      throw illegal('unknown action');
  }

  const record: ActionRecord = { seat, street: hand.street, action, amount: pay };
  if (timedOut) record.timedOut = true;
  hand.actions.push(record);
  const events: EngineEvent[] = [{ type: 'action', record }];
  if (timedOut) ps.timeouts += 1;
  else ps.timeouts = 0;

  advance(st, events, seat, false);
  return { state: st, events };
}

/**
 * Apply an action for `seat`. Advances the street when betting is closed,
 * deals the board, runs the showdown, awards pots, and ends the hand, emitting
 * every step as events. When only one seat remains un-folded the hand ends
 * without a showdown. When all remaining seats are all-in, the board is run
 * out to the river in one call. Throws no-hand / not-your-turn / illegal-action.
 */
export function applyAction(state: TableState, seat: number, action: Action): Result {
  return applyActionInternal(state, seat, action, false);
}

/**
 * Host calls this when the clock runs out: applies check if legal else fold,
 * records `timedOut: true`, and increments the seat's timeout counter.
 */
export function timeoutAction(state: TableState, seat: number): Result {
  if (!handRunning(state)) throw new EngineError('no-hand', 'no hand in progress');
  if ((state.hand as HandState).toAct !== seat) throw new EngineError('not-your-turn', `seat ${seat} is not to act`);
  const legal = legalActions(state, seat);
  return applyActionInternal(state, seat, legal.check ? { type: 'check' } : { type: 'fold' }, true);
}

/** Record the absolute deadline for the seat to act (the engine never reads clocks itself). */
export function setActionDeadline(state: TableState, deadline: number | null): TableState {
  if (!handRunning(state)) throw new EngineError('no-hand', 'no hand in progress');
  const st = cloneState(state);
  (st.hand as HandState).actionDeadline = deadline;
  return st;
}

/* ---------------------------------------------------------------------------
 * Views
 * ------------------------------------------------------------------------ */

/**
 * Redacted view for a viewer. `viewerSeat` null = spectator. Never includes the
 * deck; hole cards only for the viewer's own seat and for seats shown at showdown.
 */
export function viewFor(state: TableState, viewerSeat: number | null): TableView {
  const hand = state.hand;
  const seats: SeatView[] = state.seats.map((s) => {
    const sv: SeatView = { seat: s.seat, playerId: s.playerId, stack: s.stack, status: s.status };
    const hs = hand ? handSeat(hand, s.seat) : undefined;
    if (hs) {
      sv.inHand = { streetBet: hs.streetBet, totalBet: hs.totalBet, folded: hs.folded, allIn: hs.allIn };
      if (s.seat === viewerSeat || hs.shown) sv.inHand.holeCards = hs.holeCards.slice();
    }
    return sv;
  });

  let handView: TableView['hand'] = null;
  if (hand) {
    handView = {
      handNo: hand.handNo,
      seedCommit: hand.seedCommit,
      street: hand.street,
      board: hand.board.slice(),
      pots: clonePots(hand.pots),
      toAct: hand.toAct,
      currentBet: hand.currentBet,
      minRaise: hand.minRaise,
      actions: hand.actions.slice(),
      actionDeadline: hand.actionDeadline,
    };
    if (hand.seedReveal !== undefined) handView.seedReveal = hand.seedReveal;
    if (hand.result !== undefined) handView.result = hand.result;
  }

  const legal =
    viewerSeat !== null && handRunning(state) && (hand as HandState).toAct === viewerSeat
      ? legalActions(state, viewerSeat)
      : null;

  return { config: state.config, seats, button: state.button, handNo: state.handNo, hand: handView, viewerSeat, legal };
}

/** Returns the event as the viewer may see it, or null if it is private to another seat. */
export function redactEvent(event: EngineEvent, viewerSeat: number | null): EngineEvent | null {
  if (event.type === 'hole-cards') return event.seat === viewerSeat ? event : null;
  if (event.type === 'turn') return event.seat === viewerSeat ? event : { ...event, legal: EMPTY_LEGAL };
  return event;
}
