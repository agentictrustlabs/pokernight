/**
 * THE POSTFLOP CHART — a solver's decisions, keyed on what the seat can compute about its spot.
 *
 * The preflop chart keys on four facts. Postflop there is no finite list of spots, so the key is a
 * FEATURE VECTOR every seat can derive from its own view and nothing else: the street, whether it acts
 * last, what it is facing and how big, whether it had the initiative on the previous street, what its
 * two cards have made and are drawing to, what the board looks like, and how deep the money behind is
 * against the pot. Each spot in PokerBench's 500k solver-labelled postflop set is reduced to that vector
 * (`bench/build-postflop-chart.mts`), and the majority action and the most common size are kept per vector.
 *
 * ONE FUNCTION FOR BOTH SIDES. `postflopKeys` is called by the builder over the benchmark and by `decide`
 * at a live table; if the two ever computed different keys for the same spot the chart would be
 * answering questions nobody asked. That is why it is here and not in the bench.
 *
 * FINE FIRST, THEN COARSER. The full vector is specific enough that a solver's bet and check separate —
 * top pair with a good kicker is not top pair with a bad one, and a third of the pot is not a pot-sized
 * bet — and specific enough that the benchmark has not seen every one. So the chart is built at four
 * levels, each dropping one feature (the money behind, then the board, then the draw), and a spot is
 * answered at the finest level with enough behind it. The first version of this chart had one coarse
 * level and answered "check" to a spot the solver bet in two spots out of three (34% on bets).
 *
 * MIXED SPOTS ARE KEPT MIXED. Where the solver splits — bet 55%, check 45% — the entry carries the
 * runner-up too, so a coach can say "the solver splits here" and an adviser that knows the player
 * across the table can pick the side its memory favours. The chart itself still answers the majority.
 *
 * Sizes are relative — a bet as a fraction of the pot, a raise as a multiple of the bet faced — so a
 * spot at 1/2 blinds and a spot at 50/100 read the same line.
 */

import type { Action, Card, LegalActions, Street, TableView } from '@pokernight/engine';
import chart from './postflop-chart.json' with { type: 'json' };
import { postflopStrength, type MadeHand } from './strength.js';
import { aggressorOnStreet, inPosition, myHoleCards, potTotal, raisesOnStreet } from './view.js';

type Verb = 'bet' | 'raise' | 'call' | 'check' | 'fold';
export const VERBS: readonly Verb[] = ['bet', 'raise', 'call', 'check', 'fold'];
/** One key's tally: solver decisions by verb, in `VERBS` order, then the most common bet fraction and raise multiple. */
type Row = [number, number, number, number, number, (number | null)?, (number | null)?];
interface Entry { c: [number, number, number, number, number]; f?: number; x?: number }
const ROWS = (chart as unknown as { keys: Record<string, Row> }).keys;
const entry = (k: string): Entry | undefined => { const r = ROWS[k]; if (!r) return undefined; const f = r[5]; const x = r[6]; return { c: [r[0], r[1], r[2], r[3], r[4]], ...(typeof f === 'number' ? { f } : {}), ...(typeof x === 'number' ? { x } : {}) }; };
/** Spots the finest level found must have behind it before the chart outranks the rules at all. Two: a
 *  single decision is pruned at build time, and the coarser levels weigh in on anything this thin. */
const MIN_SPOTS = 2;
/**
 * HOW MUCH THE COARSER LEVELS WEIGH. A fine key seen six times is noisy; its parent seen six hundred times
 * is not, but it is about a slightly different spot. The posterior for a spot is its own counts plus the
 * parent's DISTRIBUTION scaled to this many spots, level by level from coarse to fine — so six spots of
 * evidence outvote a prior worth three, and one spot does not. Measured on the held-out set: hard
 * back-off answered 77.6% of spots; this, 79.2%.
 */
const PRIOR_WEIGHT = 3;

const RANKS = '23456789TJQKA';
const rankOf = (c: Card): number => RANKS.indexOf(c[0]!);
const suitOf = (c: Card): string => c[1]!;

/** The bet sizes a solver actually uses, as fractions of the pot; a size is kept as the nearest of these. */
export const BET_FRACTIONS = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2, 3] as const;
/** Raise sizes as multiples of the bet faced. */
export const RAISE_MULTIPLES = [2, 2.5, 3, 3.5, 4, 5, 7, 10] as const;
export const nearest = (v: number, of: readonly number[]): number => of.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/**
 * What the two cards have made, finely: the buckets a solver's decision actually turns on. Top pair
 * with a strong kicker bets where top pair with a weak one checks; a set is not two pair; air with two
 * overcards bluffs where air with none gives up.
 */
function madeBucket(m: MadeHand, hole: readonly Card[], board: readonly Card[]): string {
  const h = hole.map(rankOf); const b = board.map(rankOf);
  const top = Math.max(...b);
  const second = [...new Set(b)].sort((a, c) => c - a)[1] ?? -1;
  switch (m) {
    case 'nothing': { const over = h.filter((r) => r > top).length; return `air${over}`; }
    case 'pair': {
      if (h[0] === h[1]) return 'up'; // pocket pair under the top card
      const paired = h.find((r) => b.includes(r))!; const kicker = h.find((r) => r !== paired) ?? 0;
      return paired === second ? 'mp' : kicker > top ? 'bpk' : 'bp';
    }
    case 'top-pair': { const kicker = h.find((r) => r !== top) ?? 0; return kicker >= RANKS.indexOf('T') ? 'tpk' : 'tpw'; }
    case 'overpair': return 'op';
    // THE NUTS OR NOT is the question a solver asks of every big hand: top two pair, top set, the nut
    // straight and the nut flush raise where the second-best versions call.
    case 'two-pair': return h.includes(top) && h.includes(second) ? 'twt' : 'twop';
    case 'set': return h[0] === top ? 'sett' : 'set';
    case 'straight': return Math.max(...h) > top ? 'strn' : 'str';
    case 'flush': {
      const suit = board.map(suitOf).find((su) => board.filter((c) => suitOf(c) === su).length >= 3 && hole.some((c) => suitOf(c) === su)) ?? suitOf(hole[0]!);
      const mine = Math.max(...hole.filter((c) => suitOf(c) === suit).map(rankOf));
      const out = board.filter((c) => suitOf(c) === suit).map(rankOf);
      const nut = ![...Array(13).keys()].some((r) => r > mine && !out.includes(r));
      return nut ? 'fln' : 'fl';
    }
    default: return 'fh';
  }
}

/** What the LATEST card did to the board: paired it, brought a third suit, or nothing a solver re-reads for. */
function lastCardDid(board: readonly Card[]): string {
  if (board.length <= 3) return '-';
  const before = board.slice(0, -1); const last = board[board.length - 1]!;
  if (before.map(rankOf).includes(rankOf(last))) return 'P';
  const suited = board.filter((c) => suitOf(c) === suitOf(last)).length;
  if (suited >= 3 && before.filter((c) => suitOf(c) === suitOf(last)).length === suited - 1 && suited - 1 >= 2) return 'F';
  return '-';
}

/** Paired, how flushy, how connected — the three things "board texture" means at a decision. */
export function boardTexture(board: readonly Card[]): string {
  const ranks = board.map(rankOf).sort((a, b) => a - b);
  const paired = new Set(ranks).size < ranks.length ? 'p' : 'u';
  const suits = new Map<string, number>();
  for (const c of board) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1);
  const most = Math.max(...suits.values());
  const flush = most >= 4 ? 'f4' : most >= 3 ? 'fl' : most === 2 ? '2t' : 'rb';
  let connected = 'dry';
  for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2]! - ranks[i]! <= 4) connected = 'wet';
  const high = Math.max(...ranks) >= RANKS.indexOf('T') ? 'hi' : 'lo';
  return `${paired}${flush}${connected}${high}`;
}

const streetOrder = (s: Street): number => ['preflop', 'flop', 'turn', 'river', 'showdown'].indexOf(s);
const prevStreet = (s: Street): Street | null => (s === 'turn' ? 'flop' : s === 'river' ? 'turn' : s === 'flop' ? 'preflop' : null);

/** The feature vector for the viewer's spot, or null when this is not a postflop decision it can key. */
export function postflopFeatures(view: TableView, legal: LegalActions): string[] | null {
  const seat = view.viewerSeat;
  const hand = view.hand;
  if (seat === null || !hand || hand.street === 'preflop' || hand.street === 'showdown' || hand.board.length < 3) return null;
  const hole = myHoleCards(view);
  if (hole.length !== 2) return null;
  const me = view.seats.find((s) => s.seat === seat);
  if (!me) return null;
  const pot = potTotal(view);
  const toCall = legal.call ?? 0;
  const raises = raisesOnStreet(view, hand.street);
  const ratio = toCall / Math.max(1, pot - toCall);
  const facing = legal.check ? 'chk' : toCall >= me.stack ? 'ai' : raises >= 2 ? 'rz' : ratio <= 0.33 ? 'xs' : ratio <= 0.6 ? 'sm' : ratio <= 0.9 ? 'md' : ratio <= 1.3 ? 'lg' : 'ov';
  const prev = prevStreet(hand.street);
  // THE LINE SO FAR: who had the initiative on the previous street, and how many streets before this one
  // an opponent bet or raised. A river bet after two barrels is not a river bet after two checks, and the
  // solver's fold-or-call turns on that as much as on the cards.
  const initiative = prev && aggressorOnStreet(view, prev) === seat ? 'agg' : 'pas';
  const barrels = (['flop', 'turn'] as const).filter((st) => st !== hand.street && streetOrder(st) < streetOrder(hand.street) && hand.actions.some((a) => a.street === st && a.seat !== seat && (a.action.type === 'bet' || a.action.type === 'raise' || (a.action.type === 'all-in' && a.amount > 0)))).length;
  const line = `${initiative}${barrels}`;
  // THE PREFLOP POT: who raised last before the flop, and whether it was re-raised. The ranges both sides
  // reach the flop with are set there, and a solver's bet on a king-high flop is the raiser's far more
  // often than the caller's, whatever either actually holds.
  const preRaises = raisesOnStreet(view, 'preflop');
  const pre = `${aggressorOnStreet(view, 'preflop') === seat ? 'pr' : 'pc'}${preRaises >= 2 ? '3' : ''}`;
  const s = postflopStrength(hole, hand.board);
  const draw = s.draws.flush && (s.draws.openEnded || s.draws.gutshot) ? 'cb' : s.draws.flush ? 'fd' : s.draws.openEnded ? 'sd' : s.draws.gutshot ? 'gs' : 'nd';
  const spr = pot > 0 ? me.stack / pot : 99;
  const sprB = spr <= 1 ? 's1' : spr <= 2 ? 's2' : spr <= 4 ? 's4' : spr <= 8 ? 's8' : 's9';
  return [hand.street, inPosition(view) ? 'ip' : 'oop', facing, `${pre}.${line}`, madeBucket(s.made, hole, hand.board), draw, `${boardTexture(hand.board)}${lastCardDid(hand.board)}`, sprB];
}

/**
 * THE KEYS FOR A SPOT, finest first. Level 0 is every feature; each level after drops one — the
 * money behind, then the board, then the draw — so a spot the benchmark never saw exactly is still
 * answered from the spots most like it.
 */
export function postflopKeys(view: TableView, legal: LegalActions): string[] | null {
  const f = postflopFeatures(view, legal);
  if (!f) return null;
  const [street, pos, facing, line, made, draw, texture, spr] = f.map(short) as [string, string, string, string, string, string, string, string];
  return [
    [street, pos, facing, line, made, draw, texture, spr].join('|'),
    [street, pos, facing, line, made, draw, texture, '*'].join('|'),
    [street, pos, facing, line, made, draw, '*', '*'].join('|'),
    [street, pos, facing, line, made, '*', '*', '*'].join('|'),
  ];
}

/**
 * THE SHORT FORM OF A FEATURE. A hundred thousand keys ride in every Worker that bundles this chart, and
 * "river|oop|lg|pc.pas2|tpk|nd|ufldryhiP|s4" is three times the bytes of "r|O|4|Cp2|tk|n|u3dhP|4" for the
 * same fact. `postflopFeatures` stays readable; this is the spelling the chart is stored under.
 */
const SHORT: Record<string, string> = {
  flop: 'f', turn: 't', river: 'r', ip: 'I', oop: 'O',
  chk: 'k', ai: 'A', rz: 'R', xs: '1', sm: '2', md: '3', lg: '4', ov: '5',
  up: 'u', mp: 'm', bpk: 'bk', bp: 'b', tpk: 'tk', tpw: 'tw', op: 'o', twt: '2t', twop: '2', sett: 'st', set: 's', strn: 'Sn', str: 'S', fln: 'Fn', fl: 'F', fh: 'H',
  cb: 'c', fd: 'f', sd: 's', gs: 'g', nd: 'n',
  s1: '1', s2: '2', s4: '4', s8: '8', s9: '9',
};
export function short(token: string): string {
  if (SHORT[token]) return SHORT[token]!;
  const air = /^air(\d)$/.exec(token); if (air) return `a${air[1]}`;
  // pre.line: pr|pc, optional 3, agg|pas, barrels.
  const line = /^p([rc])(3?)\.(agg|pas)(\d)$/.exec(token); if (line) return `${line[1] === 'r' ? 'R' : 'C'}${line[2]}${line[3] === 'agg' ? 'a' : 'p'}${line[4]}`;
  // texture: paired, suits, connected, high, what the last card did.
  const tex = /^([pu])(f4|fl|2t|rb)(wet|dry)(hi|lo)([PF-])$/.exec(token);
  if (tex) return `${tex[1]}${{ f4: '4', fl: '3', '2t': '2', rb: '0' }[tex[2]!]}${tex[3] === 'wet' ? 'w' : 'd'}${tex[4] === 'hi' ? 'h' : 'l'}${tex[5] === '-' ? '' : tex[5]}`;
  return token;
}

/** The finest key alone — what the first chart called the key; kept for anything that names a spot. */
export function postflopKey(view: TableView, legal: LegalActions): string | null {
  return postflopKeys(view, legal)?.[0] ?? null;
}

export interface PostflopHit {
  action: Action;
  spots: number;
  agree: number;
  key: string;
  /** How many features were dropped to find an entry: 0 is the exact spot, 3 the coarsest. */
  level: number;
  /** THE SOLVER'S OTHER LINE, when it has one worth naming: the runner-up and its share. */
  mix?: { action: Action; share: number };
}

/** The chart's answer for a postflop spot, legalised, or null when it has none it can stand on. */
export function postflopChartDecision(view: TableView, legal: LegalActions): PostflopHit | null {
  const keys = postflopKeys(view, legal);
  if (!keys) return null;
  const found = keys.map(entry);
  const finest = found.findIndex((e) => !!e && e.c.reduce((a, b) => a + b, 0) >= MIN_SPOTS);
  if (finest < 0) return null;
  // Coarse to fine: each level's counts, plus the level below it as a prior worth PRIOR_WEIGHT spots.
  let post: number[] | null = null;
  for (let i = found.length - 1; i >= finest; i--) {
    const e = found[i];
    if (!e) continue;
    if (!post) { post = [...e.c]; continue; }
    const prior: number[] = post;
    const n: number = prior.reduce((a, b) => a + b, 0);
    post = e.c.map((v, j) => v + PRIOR_WEIGHT * (prior[j]! / n));
  }
  if (!post) return null;
  const total = post.reduce((a, b) => a + b, 0);
  const order = VERBS.map((_, j) => j).sort((a, b) => post![b]! - post![a]!);
  const best = order[0]!; const second = order[1]!;
  const own = found[finest]!;
  const ownN = own.c.reduce((a, b) => a + b, 0);
  const size = (verb: Verb) => ({ ...(verb === 'bet' ? { f: found.find((e, i) => i >= finest && e?.f !== undefined)?.f } : {}), ...(verb === 'raise' ? { x: found.find((e, i) => i >= finest && e?.x !== undefined)?.x } : {}) });
  const action = legalise({ a: VERBS[best]!, ...size(VERBS[best]!) }, view, legal);
  const share = Math.round((100 * post[second]!) / total);
  const mix = share >= 25 ? { action: legalise({ a: VERBS[second]!, ...size(VERBS[second]!) }, view, legal), share } : undefined;
  // `agree` is the FINEST level's own agreement — the number "the solver saw this exact spot N times and
  // never disagreed" is about, which is what a coach calls certain.
  return { action, spots: ownN, agree: Math.round((100 * own.c[best]!) / ownN), key: keys[finest]!, level: finest, ...(mix && mix.action.type !== action.type ? { mix } : {}) };
}

function legalise(e: { a: Verb; f?: number; x?: number }, view: TableView, legal: LegalActions): Action {
  const seat = view.viewerSeat as number;
  const me = view.seats.find((s) => s.seat === seat)!;
  const pot = potTotal(view);
  const all = (me.inHand?.streetBet ?? 0) + me.stack;
  const cur = view.hand!.currentBet;
  let action: Action;
  switch (e.a) {
    case 'check': action = legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' }; break;
    case 'call': action = legal.call !== null ? { type: 'call' } : legal.check ? { type: 'check' } : { type: 'fold' }; break;
    case 'fold': action = legal.fold ? { type: 'fold' } : legal.check ? { type: 'check' } : { type: 'fold' }; break;
    case 'bet': {
      if (legal.bet) { const to = Math.max(legal.bet.min, Math.min(legal.bet.max, Math.round(pot * (e.f ?? 0.5)))); action = to >= all ? { type: 'all-in' } : { type: 'bet', amount: to }; }
      else if (legal.raise) { const to = Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(cur * (e.x ?? 2.5)))); action = to >= all ? { type: 'all-in' } : { type: 'raise', amount: to }; }
      else action = legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' };
      break;
    }
    case 'raise': {
      if (legal.raise) { const to = Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(cur * (e.x ?? 2.5)))); action = to >= all ? { type: 'all-in' } : { type: 'raise', amount: to }; }
      else if (legal.bet) { const to = Math.max(legal.bet.min, Math.min(legal.bet.max, Math.round(pot * (e.f ?? 0.66)))); action = to >= all ? { type: 'all-in' } : { type: 'bet', amount: to }; }
      else action = legal.call !== null ? { type: 'call' } : legal.check ? { type: 'check' } : { type: 'fold' };
      break;
    }
  }
  return action;
}
