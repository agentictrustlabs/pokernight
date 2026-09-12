/**
 * ONE FINISHED HAND, AS COUNTS — what a seat can honestly say it saw each player do.
 *
 * The twin of `handRead`, for the other end of a hand. `handRead` says the spot in fields so an
 * adviser reasons over facts rather than computing them; this says the FINISHED hand in counts so an
 * adviser can remember it. Not the hand itself — never cards, never a transcript — but what each seat
 * did: put money in before the flop or not, raised or called, folded to a bet or paid it, bet the flop
 * after raising before it, showed down, won. Twelve hands of these and "Sharkbot folds to a bet four
 * times in five" is a fact, where one hand of it is an anecdote.
 *
 * WHAT IT REFUSES TO DO is guess. Everything here is read from the action record and the result the
 * seat was shown. A player who folded before showdown is counted as having folded, and nothing is
 * said about what they held. The card room keeps none of this (`docs/DESIGN.md`: it has no profile
 * of how anybody plays and nowhere to put one); it hands the counts to the one agent the person named,
 * once, when the hand is over, and that agent's memory is that agent's business.
 *
 * THE COUNTERS ARE NAMED BY THIS FILE AND MEANT BY THE SKILLS. `xOpps` beside `x` is the convention
 * the agent's memory turns into a rate ("foldToBet 4 of foldToBetOpps 5"); a counter without an
 * `Opps` twin is per hand.
 */

import type { ActionRecord, Street, TableView } from '@pokernight/engine';

export interface SeatCounters {
  /** Hands dealt in. */
  hands: number;
  /** Put money in voluntarily before the flop (a call or a raise; posting a blind is not voluntary). */
  vpip: number;
  /** Raised before the flop. */
  pfr: number;
  /** Faced a raise before the flop, and re-raised it. */
  threeBetOpps: number;
  threeBet: number;
  /** Bets and raises, on every street. */
  aggressive: number;
  /** Calls, on every street. */
  passive: number;
  /** Faced a bet or raise and folded to it. */
  foldToBetOpps: number;
  foldToBet: number;
  /** Raised before the flop, then was first to act with the flop unbet: did they bet it? */
  cbetOpps: number;
  cbet: number;
  /** Still in when the flop was dealt. */
  sawFlop: number;
  /** Showed cards at showdown; won the pot at showdown. */
  showdowns: number;
  showdownWins: number;
  /** Checked, was bet into, and raised — the check-raise, per chance to. */
  checkRaiseOpps: number;
  checkRaise: number;
  /** First to act, led into the previous street's aggressor (the "donk" bet), per chance to. */
  donkOpps: number;
  donk: number;
  /** Bet the flop and then bet the turn too, per flop bet that saw a turn. */
  doubleBarrelOpps: number;
  doubleBarrel: number;
  /** Bet or raised on the river, per river decision taken. */
  riverAggOpps: number;
  riverAgg: number;
  /** Bets of three-quarters of the pot or more, per bet sized — how big they bet when they bet. */
  bigBetOpps: number;
  bigBet: number;
  /** Won chips this hand (by showdown or by everybody folding). */
  won: number;
  /** Net chips, this hand — the one counter that is a sum, not a count. */
  netChips: number;
}

export interface RoundObservation {
  game: 'poker';
  round: number;
  /** Keyed by the player id the view shows for the seat — the same id an adviser sees at the next hand. */
  subjects: Record<string, { you?: boolean; counters: SeatCounters }>;
}

const AGGRESSIVE = new Set(['bet', 'raise', 'all-in']);

function empty(): SeatCounters {
  return { hands: 1, vpip: 0, pfr: 0, threeBetOpps: 0, threeBet: 0, aggressive: 0, passive: 0, foldToBetOpps: 0, foldToBet: 0, cbetOpps: 0, cbet: 0, sawFlop: 0, checkRaiseOpps: 0, checkRaise: 0, donkOpps: 0, donk: 0, doubleBarrelOpps: 0, doubleBarrel: 0, riverAggOpps: 0, riverAgg: 0, bigBetOpps: 0, bigBet: 0, showdowns: 0, showdownWins: 0, won: 0, netChips: 0 };
}

/**
 * The hand's counts per seat, or null when there is no finished hand to count.
 *
 * Replays the action record street by street, tracking what each seat has put in on the street, so
 * "facing a bet" is a fact about the moment rather than a guess from the action's name: a call after
 * a raise faced a bet; a check did not; a bet into an unbet flop is an opportunity to continue, and a
 * bet from the preflop raiser there is the continuation itself.
 */
export function observeRound(view: TableView, seat: number): RoundObservation | null {
  const hand = view.hand;
  if (!hand || !hand.result) return null;
  const dealt = (view.seats ?? []).filter((s) => s.inHand);
  if (dealt.length === 0) return null;
  const counters = new Map<number, SeatCounters>();
  for (const s of dealt) counters.set(s.seat, empty());
  const at = (n: number): SeatCounters => counters.get(n) ?? (counters.set(n, empty()), counters.get(n)!);

  const bb = view.config?.bigBlind ?? 0;
  // What each seat has put in on the current street, and the street's high mark. Blinds are not in the
  // record, so the preflop street starts with them posted.
  let street: Street | null = null;
  let streetBet = new Map<number, number>();
  let high = 0;
  let raisesPre = 0;
  let lastPreRaiser: number | null = null;
  let flopBetSeen = false;
  const foldedBeforeFlop = new Set<number>();
  // Per street: who has checked, who was the last aggressor, whether anybody has bet yet, and the pot
  // as the street opened — the facts a check-raise, a donk bet and a bet's size are read against.
  let checked = new Set<number>();
  let streetAggressor: number | null = null;
  let prevAggressor: number | null = null;
  let streetBetSeen = false;
  const flopBettors = new Set<number>();
  const totalIn = new Map<number, number>();
  const potNow = () => [...totalIn.values()].reduce((a, b) => a + b, 0);

  const enter = (st: Street) => {
    street = st;
    streetBet = new Map();
    high = 0;
    checked = new Set();
    prevAggressor = streetAggressor;
    streetAggressor = null;
    streetBetSeen = false;
    if (st === 'preflop') {
      if (hand.smallBlindSeat !== null) { streetBet.set(hand.smallBlindSeat, Math.floor(bb / 2)); totalIn.set(hand.smallBlindSeat, Math.floor(bb / 2)); }
      if (hand.bigBlindSeat !== null) { streetBet.set(hand.bigBlindSeat, bb); totalIn.set(hand.bigBlindSeat, bb); }
      high = bb;
    }
  };

  for (const a of hand.actions as ActionRecord[]) {
    if (a.street !== street) enter(a.street);
    const c = at(a.seat);
    const mine = streetBet.get(a.seat) ?? 0;
    // Facing a BET means somebody bet: the big blind is a price, not an opponent's aggression, so an
    // open-raise or a fold to the blind is not "folding to a bet".
    const facing = high > mine && (street !== 'preflop' || raisesPre >= 1);
    const type = a.action.type;

    if (street === 'flop' && !flopBetSeen && (type === 'bet' || type === 'check' || (type === 'all-in' && !facing))) {
      // First chance to bet the flop. The preflop raiser's is a continuation-bet opportunity.
      if (a.seat === lastPreRaiser) { c.cbetOpps += 1; if (type !== 'check') c.cbet += 1; }
    }
    if (street === 'preflop' && facing && raisesPre >= 1 && (type === 'call' || type === 'raise' || type === 'fold' || type === 'all-in')) {
      c.threeBetOpps += 1;
      if (type === 'raise' || (type === 'all-in' && a.amount + mine > high)) c.threeBet += 1;
    }
    if (facing && (type === 'fold' || type === 'call' || type === 'raise' || type === 'all-in')) {
      c.foldToBetOpps += 1;
      if (type === 'fold') c.foldToBet += 1;
    }
    // A CHECK-RAISE: checked this street, now facing a bet. A DONK: out of position, first to act with the
    // street unbet, against somebody who had the initiative last street. A RIVER: any decision there.
    if (facing && checked.has(a.seat) && street !== 'preflop') { c.checkRaiseOpps += 1; if (type === 'raise' || (type === 'all-in' && mine + a.amount > high)) c.checkRaise += 1; }
    if (street !== 'preflop' && !streetBetSeen && !facing && checked.size === 0 && prevAggressor !== null && prevAggressor !== a.seat && (type === 'bet' || type === 'check' || type === 'all-in')) { c.donkOpps += 1; if (type !== 'check') c.donk += 1; }
    if (street === 'river' && (type === 'bet' || type === 'raise' || type === 'check' || type === 'call' || type === 'fold' || type === 'all-in')) { c.riverAggOpps += 1; if (type === 'bet' || type === 'raise' || (type === 'all-in' && mine + a.amount > high)) c.riverAgg += 1; }
    if (street === 'turn' && !streetBetSeen && flopBettors.has(a.seat) && (type === 'bet' || type === 'check' || type === 'all-in')) { c.doubleBarrelOpps += 1; if (type !== 'check') c.doubleBarrel += 1; }
    if (type === 'fold') {
      if (street === 'preflop') foldedBeforeFlop.add(a.seat);
      continue;
    }
    if (type === 'check') { checked.add(a.seat); continue; }
    if (type === 'call') {
      c.passive += 1;
      if (street === 'preflop') c.vpip = 1;
    } else if (AGGRESSIVE.has(type)) {
      const total = mine + a.amount;
      const isRaise = total > high;
      if (isRaise) c.aggressive += 1; else c.passive += 1; // an all-in for less than the bet is a call
      if (street === 'preflop') {
        c.vpip = 1;
        if (isRaise) { c.pfr = 1; raisesPre += 1; lastPreRaiser = a.seat; }
      }
      if (street === 'flop' && isRaise) flopBetSeen = true;
      if (isRaise) {
        streetAggressor = a.seat;
        // How big, when it is a bet into an unbet street: the size as a share of the pot it was bet into.
        if (street !== 'preflop' && !streetBetSeen) { const pot = potNow(); if (pot > 0) { c.bigBetOpps += 1; if (a.amount / pot >= 0.75) c.bigBet += 1; } if (street === 'flop') flopBettors.add(a.seat); }
        if (street !== 'preflop') streetBetSeen = true;
      }
    }
    streetBet.set(a.seat, mine + a.amount);
    totalIn.set(a.seat, (totalIn.get(a.seat) ?? 0) + a.amount);
    if (mine + a.amount > high) high = mine + a.amount;
  }

  const reachedFlop = hand.board.length >= 3;
  const shown = new Set(hand.result.shown.map((s) => s.seat));
  for (const s of dealt) {
    const c = at(s.seat);
    if (reachedFlop && !foldedBeforeFlop.has(s.seat)) c.sawFlop = 1;
    const net = hand.result.net[s.seat] ?? 0;
    c.netChips = net;
    if (net > 0) c.won = 1;
    if (shown.has(s.seat)) { c.showdowns = 1; if (net > 0) c.showdownWins = 1; }
  }

  const subjects: RoundObservation['subjects'] = {};
  for (const s of dealt) {
    const id = s.playerId;
    if (!id) continue;
    subjects[id] = { ...(s.seat === seat ? { you: true } : {}), counters: at(s.seat) };
  }
  return { game: 'poker', round: hand.handNo, subjects };
}
