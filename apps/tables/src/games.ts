/**
 * The games this deployment can host.
 *
 * ONE LINE PER GAME, and that is the whole point of the registry. A second game arrives as a package
 * with its own engine and its own adapter (`@pokernight/table-game`), gets added here, and nothing
 * in the table object, the lobby, the clubs or the settlement path knows it happened.
 *
 * POKER IS THE DEFAULT, and it has to be: every table created before games were named has no `game`
 * stamped on it, and every one of those is a poker table. `DEFAULT_GAME` is what they are read as,
 * exactly as `LEGACY_CHIP_VALUE` is what tables older than the rate pin settle at.
 */

import { decide, handRead, observeRound, readHand } from '@pokernight/agent-kit';
import { canastaGame, cardValue, isBlackThree, isRedThree, isWild, legalFor as canastaLegalFor, rankOf, viewFor as canastaViewFor, type CanastaState } from '@pokernight/canasta';
import { chooseCanastaAction, explainMove } from '@pokernight/canasta-agent';
import {
  legalActions as pokerLegalFor,
  pokerGame,
  viewFor as pokerViewFor,
  POKER_GAME_ID,
  type TableState as PokerState,
} from '@pokernight/engine';
import { POKER_ACT_SKILL } from '@pokernight/protocol';
import { createGameRegistry, type Advice, type GameId, type HostedGame } from '@pokernight/table-game';

export const DEFAULT_GAME: GameId = POKER_GAME_ID;

/**
 * Canasta, with a COACH bolted on.
 *
 * The strategy lives in `@pokernight/canasta-agent`, which depends on the canasta engine — so the
 * engine cannot depend back on it, and `canastaGame` cannot carry its own coach without a cycle.
 * Composing the two HERE is the right place anyway: an app is what decides which of the things it
 * has installed get wired to each other, and a rules engine has no business knowing that somebody
 * wrote a strategy for it.
 *
 * The coach reads `viewFor(state, seat)` — the seat's own redacted view, the same pair a human or an
 * agent is given. A coach reasoning from the full state would explain moves using cards the learner
 * cannot see, which teaches them a way of playing they can never reproduce alone.
 */
const canastaWithCoach: HostedGame = {
  ...(canastaGame as unknown as HostedGame),
  advise(state: unknown, seat: number): Advice | null {
    const s = state as CanastaState;
    const round = s.round;
    if (!round || round.result || round.toAct !== seat) return null;
    const view = canastaViewFor(s, seat);
    const { action } = chooseCanastaAction(view, canastaLegalFor(s, seat), seat);
    const { say, because } = explainMove(view, seat, action);
    return { action, say, because };
  },
  // THE SPOT AS DATA (cn:TableRead), for an adviser that reasons rather than looks up. Everything a language
  // model would otherwise have to work out from the raw view — and got wrong: a coach read the seats list and
  // called an opponent's eleven cards "your partner's". Who the partner IS, by seat and (once the host labels
  // it) by name; each opponent's count; the phase, said as what the seat may still do; the pile and what the
  // hand holds of its top rank; the hand by rank with what is meldable; the safe and the dangerous discards.
  // From the seat's own view and legal moves only, so it discloses nothing the seat cannot see.
  readFor(state: unknown, seat: number): unknown {
    const s = state as CanastaState;
    if (!s.round) return null;
    const view = canastaViewFor(s, seat);
    const legal = canastaLegalFor(s, seat);
    const team = (seat % 2) as 0 | 1;
    const other = (1 - team) as 0 | 1;
    const partnerSeat = (seat + 2) % 4;
    const at = (n: number) => view.seats.find((x) => x.seat === n);
    const hand = view.hand ?? [];
    const byRank: Record<string, number> = {};
    for (const c of hand) { if (isWild(c) || isRedThree(c) || isBlackThree(c)) continue; byRank[rankOf(c)] = (byRank[rankOf(c)] ?? 0) + 1; }
    const wilds = hand.filter(isWild).length;
    const blackThrees = hand.filter(isBlackThree).length;
    const top = view.pileTop;
    const topRank = top && !isWild(top) && !isBlackThree(top) && !isRedThree(top) ? rankOf(top) : null;
    const ourMelds = view.melds[team].map((m) => ({ rank: m.rank, size: m.cards.length, canasta: m.canasta, natural: m.natural }));
    const theirMelds = view.melds[other].map((m) => ({ rank: m.rank, size: m.cards.length, canasta: m.canasta, natural: m.natural }));
    const ourRanks = new Set(ourMelds.map((m) => m.rank));
    const theirRanks = new Set(theirMelds.map((m) => m.rank));
    const opponents = view.seats.filter((x) => x.team !== team).map((x) => ({ seat: x.seat, cards: x.cards, sittingOut: x.status === 'sitting-out' }));
    const partner = at(partnerSeat);
    const meldable = Object.keys(byRank).filter((r) => ourRanks.has(r as never));
    const pairs = Object.entries(byRank).filter(([, n]) => n >= 2).map(([r]) => r);
    const unsafeDiscards = hand.filter((c) => !isWild(c) && !isBlackThree(c) && theirRanks.has(rankOf(c) as never));
    const safeDiscards = hand.filter((c) => !isWild(c) && !isBlackThree(c) && !isRedThree(c) && !theirRanks.has(rankOf(c) as never) && !ourRanks.has(rankOf(c) as never) && (byRank[rankOf(c)] ?? 0) === 1);
    return {
      phase: view.phase,
      whatYouMayDoNow: view.phase === 'draw'
        ? `You have NOT drawn yet: draw from the stock${legal.canTakePile ? ', or take the pile' : ' (the pile cannot be taken)'}. No meld or discard until you have.`
        : 'You HAVE drawn this turn: meld what you can, then discard ONE card to end the turn. Drawing or taking the pile is not available now.',
      you: { seat, side: team, cards: hand.length, handValue: hand.reduce((n, c) => n + cardValue(c), 0), wilds, blackThrees, byRank, meldableOntoOurMelds: meldable, pairsInHand: pairs },
      partner: partner ? { seat: partnerSeat, cards: partner.cards, sittingOut: partner.status === 'sitting-out' } : null,
      opponents,
      pile: { top, size: view.pileSize, frozen: view.frozen, blockedByBlackThree: !!top && isBlackThree(top), canTake: legal.canTakePile, whyNot: legal.takePileReason, naturalsOfTopInHand: topRank ? (byRank[topRank] ?? 0) : 0 },
      stock: view.stock,
      ourSide: { opened: ourMelds.length > 0, needToOpen: legal.minimumMeld, melds: ourMelds, canastas: ourMelds.filter((m) => m.canasta).length, redThrees: view.redThrees[team], score: view.scores[team] },
      theirSide: { opened: theirMelds.length > 0, melds: theirMelds, canastas: theirMelds.filter((m) => m.canasta).length, redThrees: view.redThrees[other], score: view.scores[other] },
      canGoOut: legal.canGoOut,
      discards: { safe: safeDiscards, feedTheirMelds: unsafeDiscards },
      target: view.target,
    };
  },
  // THE FINISHED ROUND AS COUNTS, for the person's own agent to remember — from the seat's own final view,
  // so nothing the seat could not see is counted. Canasta's counts are about SIDES as much as seats: two
  // partners share every canasta and every score, so each seat carries its side's outcome (the memory
  // skill says so). Keyed by the player id the view shows; the card room keeps none of it.
  observeFor(state: unknown, seat: number): unknown {
    const s = state as CanastaState;
    const round = s.round;
    if (!round?.result) return null;
    const view = canastaViewFor(s, seat);
    const r = round.result;
    const subjects: Record<string, { you?: boolean; counters: Record<string, number> }> = {};
    for (const st of view.seats) {
      if (!st.playerId) continue;
      const team = st.team;
      const score = r.scores[team];
      const other = r.scores[(1 - team) as 0 | 1];
      const melds = view.melds[team];
      subjects[st.playerId] = {
        ...(st.seat === seat ? { you: true } : {}),
        counters: {
          rounds: 1,
          roundsWon: score.total > other.total ? 1 : 0,
          canastas: melds.filter((m) => m.canasta).length,
          naturalCanastas: melds.filter((m) => m.canasta && m.natural).length,
          wentOut: r.wentOut === st.seat ? 1 : 0,
          concealed: r.wentOut === st.seat && r.concealed ? 1 : 0,
          redThrees: view.redThrees[team],
          inHandValue: -score.inHand,
          opened: melds.length > 0 ? 1 : 0,
          netScore: score.total,
        },
      };
    }
    return { game: 'canasta', round: view.roundNo, subjects };
  },
};

/**
 * HOLD'EM, with a COACH bolted on — the same composition as canasta's, for the same reason.
 *
 * The strategy and the words both live in `@pokernight/agent-kit`, which depends on the poker engine;
 * the engine cannot depend back on it, so `pokerGame` cannot carry its own coach without a cycle.
 * Composing them here is also just correct: deciding which installed things get wired to each other
 * is an app's job, and a rules engine has no business knowing somebody wrote a strategy for it.
 *
 * THE MOVE AND THE WORDS COME FROM DIFFERENT PLACES, on purpose. `decide` picks the line; `readHand`
 * says what is true about the spot — the price, the number of opponents, position, the stack behind.
 * A coach that explained itself by paraphrasing its own decision would teach the decision. What a
 * learner needs is the reading, which they can apply to a hand this coach never saw.
 *
 * NO RANDOMNESS: `rng: () => 1` takes every mixed line off the table, so the coach never semi-bluffs,
 * never slow-plays and never bluffs a river. Two reasons. Advice that changes when you ask again is
 * not advice. And the straightforward value line is the one a beginner should be able to reproduce —
 * a coach that shoved a bluff and could not say why would be teaching the wrong lesson twice.
 */
const pokerWithCoach: HostedGame = {
  ...(pokerGame as unknown as HostedGame),
  advise(state: unknown, seat: number): Advice | null {
    const s = state as PokerState;
    const hand = s.hand;
    if (!hand || hand.result !== undefined || hand.toAct !== seat) return null;
    const view = pokerViewFor(s, seat);
    const legal = pokerLegalFor(s, seat);
    // The ENVELOPE is filler and is never read: `decide` reasons from `view` and `legal` alone. A
    // coach holds the state rather than a turn request, so there is no request to quote here.
    const { action, note, mix } = decide({
      skill: POKER_ACT_SKILL,
      tableId: '',
      handNo: hand.handNo,
      seat,
      view,
      legal,
      deadlineMs: 0,
    }, { rng: () => 1 });
    const { say, because } = readHand(view, seat, legal);
    // CERTAIN when the solver's chart saw this spot often and never disagreed: "chart fine BB|1|0|AKs:
    // 77 spots, 100% agree" is not a rule of thumb, and a person's own agent asked about it would spend
    // eight seconds and its tokens to say "raise" back. The bar is deliberately high — unanimous, and
    // dozens of spots — so anything with a real choice in it still goes to whoever they named.
    const m = /^chart \w+ (\S+): (\d+) spots, (\d+)% agree$/.exec(note ?? '');
    const certain = m && Number(m[3]) >= 100 && Number(m[2]) >= 50 ? { because: `the solver saw this spot ${m[2]} times and never disagreed` } : undefined;
    // THE OTHER LINE, said as well as carried: "the solver also bets here 38% of the time" is a true
    // thing about the spot that a fixed recommendation hides, and it is the opening a person's own
    // agent uses when it remembers how the player across the table plays.
    const other = mix ? { action: mix.action, share: mix.share, say: `The solver also ${verbOf(mix.action)} here ${mix.share}% of the time.` } : undefined;
    return { action, say, because: other ? `${because} ${other.say}` : because, ...(certain ? { certain } : {}), ...(other ? { mix: other } : {}) };
  },
  // The same facts as fields, for an adviser that reasons rather than looks up: the price, the outs,
  // position, the money behind, what the cards have made. Handed these, a model at somebody's Home
  // does not fold from the big blind when checking is free — which is what computing them wrong looked
  // like, live.
  readFor(state: unknown, seat: number): unknown {
    const s = state as PokerState;
    if (!s.hand || s.hand.toAct !== seat) return null;
    return handRead(pokerViewFor(s, seat), seat, pokerLegalFor(s, seat));
  },
  // The finished hand as counts, for the person's own adviser to remember: who put money in, who
  // raised, who folded to a bet, who showed down. From the seat's own view, so nothing the seat could
  // not see is counted; the card room keeps none of it.
  observeFor(state: unknown, seat: number): unknown {
    const s = state as PokerState;
    if (!s.hand?.result) return null;
    return observeRound(pokerViewFor(s, seat), seat);
  },
};

/** "bets", "checks", "raises to 24" — a move as a verb, for one sentence about the other line. */
function verbOf(action: unknown): string {
  const a = action as { type?: string; amount?: number };
  switch (a?.type) {
    case 'bet': return `bets ${a.amount}`;
    case 'raise': return `raises to ${a.amount}`;
    case 'call': return 'calls';
    case 'check': return 'checks';
    case 'fold': return 'folds';
    case 'all-in': return 'goes all in';
    default: return 'takes another line';
  }
}

// ONE LINE PER GAME. Each brings its own engine and its own adapter; neither knows the other.
const registry = createGameRegistry([pokerWithCoach, canastaWithCoach]);

/** Every game id this deployment will open a table for. */
export function gameIds(): GameId[] {
  return registry.ids();
}

/**
 * The game a table plays, refused BY NAME when this deployment does not have it.
 *
 * A table stamped with a game the code no longer ships is a real possibility — a deployment rolled
 * back, a package removed — and it must fail loudly here rather than silently becoming poker. The
 * table's own stamp is the truth about what it is; a wrong guess would deal the wrong game to
 * people whose money is already on it.
 */
export function gameFor(id: GameId | undefined): HostedGame {
  const wanted = (id ?? DEFAULT_GAME).trim() || DEFAULT_GAME;
  const game = registry.get(wanted);
  if (!game) throw new Error(`this card room does not deal "${wanted}" — it deals ${registry.ids().join(', ')}`);
  return game;
}

/**
 * WHAT A PRACTICE TABLE IS SET TO, per game — one place, read on creation AND on "start over".
 *
 * Poker's default 30 s turn is right for a money table and wrong for the one table that exists to
 * be learnt at: reading the advice, and the 15–20 s a person's own agent at their Home takes to write
 * it, do not fit inside it. Canasta already runs 90 s by default for the same reason. `reset` used to
 * rebuild from `{}`, so a practice table dealt again went back to the money clock — the setting was
 * true for exactly one game per table.
 */
export function practiceConfigFor(id: GameId | undefined): Record<string, unknown> {
  return (id ?? DEFAULT_GAME) === POKER_GAME_ID ? { actionTimeoutMs: 60_000 } : {};
}
