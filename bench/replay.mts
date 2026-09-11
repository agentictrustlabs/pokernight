/**
 * POKERBENCH SPOTS, REBUILT AS THE ENGINE'S OWN VIEWS — shared by the scorer and the chart builders.
 *
 * Each row of the benchmark becomes exactly what a table hands an adviser: a redacted `TableView` for
 * the hero's seat and its `LegalActions`, with the solver's decision beside it. One replay, two users,
 * so a chart is built from precisely the spots it is later scored on.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, Card, LegalActions, TableView } from '../packages/engine/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export interface Spot { view: TableView; legal: LegalActions; seat: number; want: string; wantSize: number | null; street: Street }

/** Data is in half-big-blinds of 0.5; the engine wants integers. ×2: SB 1, BB 2, stacks 200. */
const CHIPS = 2;
const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
const SEAT: Record<string, number> = { UTG: 0, HJ: 1, CO: 2, BTN: 3, SB: 4, BB: 5 };

/** "Kd" in the data is rank + lowercase suit already; the engine wants exactly that. */
const card = (s: string): Card => s as Card;

interface Seat { seat: number; stack: number; streetBet: number; totalBet: number; folded: boolean; allIn: boolean }

function freshSeats(): Seat[] {
  return POSITIONS.map((_, i) => ({ seat: i, stack: 100 * CHIPS, streetBet: 0, totalBet: 0, folded: false, allIn: false }));
}

/** Post the blinds: SB 0.5bb, BB 1bb. */
function postBlinds(seats: Seat[]): void {
  const sb = seats[SEAT.SB!]!; const bb = seats[SEAT.BB!]!;
  sb.stack -= 1; sb.streetBet = 1; sb.totalBet = 1;
  bb.stack -= 2; bb.streetBet = 2; bb.totalBet = 2;
}

/** Replay "UTG/2.0bb/BTN/call/SB/allin/…" — pairs of position and action — preflop. */
function replayPreflop(line: string, seats: Seat[]): { currentBet: number; actions: Array<{ seat: number; action: Action; amount: number }>; raises: number } {
  const parts = line.split('/').filter(Boolean);
  let currentBet = 2;
  let raises = 0;
  const actions: Array<{ seat: number; action: Action; amount: number }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const s = seats[SEAT[parts[i]!]!]!;
    const a = parts[i + 1]!;
    const put = (to: number) => { const add = Math.min(to - s.streetBet, s.stack); s.stack -= add; s.streetBet += add; s.totalBet += add; return add; };
    if (a === 'fold') { s.folded = true; actions.push({ seat: s.seat, action: { type: 'fold' }, amount: 0 }); }
    else if (a === 'call') { const add = put(currentBet); actions.push({ seat: s.seat, action: { type: 'call' }, amount: add }); }
    else if (a === 'check') { actions.push({ seat: s.seat, action: { type: 'check' }, amount: 0 }); }
    else if (a === 'allin') { const to = s.streetBet + s.stack; const add = put(to); s.allIn = true; if (to > currentBet) { currentBet = to; raises++; } actions.push({ seat: s.seat, action: { type: 'all-in' }, amount: add }); }
    else if (/^[\d.]+bb$/.test(a)) { const to = Math.round(parseFloat(a) * CHIPS); const add = put(to); if (to > currentBet) { currentBet = to; raises++; } actions.push({ seat: s.seat, action: raises === 1 && currentBet === to && actions.every((x) => x.action.type !== 'raise') ? { type: 'raise', amount: to } : { type: 'raise', amount: to }, amount: add }); }
  }
  return { currentBet, actions, raises };
}

/** The benchmark's legal moves → the engine's. Raise sizes in the data are "3.0bb" TO-amounts; allin is a shove. */
function legalFrom(avail: string[], hero: Seat, currentBet: number, pot: number): LegalActions {
  const toCall = Math.max(0, Math.min(currentBet - hero.streetBet, hero.stack));
  const canCheck = avail.includes('check') || avail.includes('Check');
  const raiseSizes = avail.filter((m) => /^[\d.]+bb$/.test(m)).map((m) => Math.round(parseFloat(m) * CHIPS));
  const canRaise = raiseSizes.length > 0 || avail.includes('allin');
  const min = raiseSizes.length ? Math.min(...raiseSizes) : Math.min(currentBet * 2, hero.streetBet + hero.stack);
  const max = hero.streetBet + hero.stack;
  return {
    fold: avail.includes('fold') || avail.includes('Fold'),
    check: canCheck,
    call: avail.includes('call') || avail.includes('Call') ? toCall : null,
    bet: currentBet === 0 && canRaise ? { min: Math.max(2, Math.round(pot * 0.33)), max } : null,
    raise: currentBet > 0 && canRaise ? { min: Math.min(min, max), max } : null,
    allIn: hero.stack,
  };
}

/** A tiny CSV reader: the data quotes only the moves column. */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split('\n').filter((l) => l.trim());
  const head = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    const cells: string[] = []; let cur = ''; let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h || 'idx', cells[i] ?? '']));
  });
}


export function* preflopSpots(file = 'pokerbench/preflop_1k_test_set_game_scenario_information.csv', limit = Infinity): Generator<Spot> {
  const rows = parseCsv(readFileSync(resolve(HERE, file), 'utf8'));
  let i = 0;
  for (const r of rows) {
    if (i++ >= limit) return;
    const seats = freshSeats();
    postBlinds(seats);
    const heroSeat = SEAT[r.hero_pos!]!;
    const { currentBet, actions } = replayPreflop(r.prev_line ?? '', seats);
    const hero = seats[heroSeat]!;
    const pot = seats.reduce((a, x) => a + x.totalBet, 0);
    const avail = JSON.parse((r.available_moves ?? '[]').replace(/'/g, '"')) as string[];
    const legal = legalFrom(avail, hero, currentBet, pot);
    const hole = [card(r.hero_holding!.slice(0, 2)), card(r.hero_holding!.slice(2, 4))];
    const view: TableView = {
      config: { seats: 6, smallBlind: 1, bigBlind: 2, ante: 0, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 30_000 },
      seats: seats.map((x) => ({ seat: x.seat, playerId: `p${x.seat}`, stack: x.stack, status: 'active', waitingForBigBlind: false, inHand: { streetBet: x.streetBet, totalBet: x.totalBet, folded: x.folded, allIn: x.allIn, ...(x.seat === heroSeat ? { holeCards: hole } : {}) } })),
      button: SEAT.BTN!, handNo: 1, viewerSeat: heroSeat,
      hand: { handNo: 1, seedCommit: 'bench', smallBlindSeat: SEAT.SB!, bigBlindSeat: SEAT.BB!, street: 'preflop', board: [], pots: [{ amount: pot, eligible: seats.filter((x) => !x.folded).map((x) => x.seat) }], toAct: heroSeat, currentBet, minRaise: 2, actions: actions.map((a) => ({ seat: a.seat, street: 'preflop' as const, action: a.action, amount: a.amount })), actionDeadline: null },
      legal,
    };
    const want = r.correct_decision!;
    const wantSize = /bb$/.test(want) ? Math.round(parseFloat(want) * CHIPS) : want === 'allin' ? hero.streetBet + hero.stack : null;
    yield { view, legal, seat: heroSeat, want: /bb$/.test(want) ? `raise ${want}` : want, wantSize, street: 'preflop' };
  }
}

const POSTFLOP_ORDER: Record<string, number> = { SB: 0, BB: 1, UTG: 2, HJ: 3, CO: 4, BTN: 5 };
export function* postflopSpots(file = 'pokerbench/postflop_10k_test_set_game_scenario_information.csv', limit = Infinity): Generator<Spot> {
  const rows = parseCsv(readFileSync(resolve(HERE, file), 'utf8'));
  let i = 0;
  for (const r of rows) {
    if (i++ >= limit) return;
    const pre = (r.preflop_action ?? '').split('/').filter(Boolean);
    const positions = [...new Set(pre.filter((_, j) => j % 2 === 0))];
    if (positions.length !== 2) continue;
    const [a, b] = positions as [string, string];
    const oopName = POSTFLOP_ORDER[a]! < POSTFLOP_ORDER[b]! ? a : b;
    const OOP = 0, IP = 1;
    const seats: Seat[] = [OOP, IP].map((seat) => ({ seat, stack: 100 * CHIPS, streetBet: 0, totalBet: 0, folded: false, allIn: false }));
    const bySeat = (name: string) => (name === oopName ? seats[OOP]! : seats[IP]!);
    let cur = 0;
    for (let j = 0; j + 1 < pre.length; j += 2) {
      const sd = bySeat(pre[j]!); const act = pre[j + 1]!;
      const put = (to: number) => { const add = Math.min(to - sd.streetBet, sd.stack); sd.stack -= add; sd.streetBet += add; sd.totalBet += add; };
      if (act === 'call') put(cur);
      else if (/^[\d.]+bb$/.test(act)) { const to = Math.round(parseFloat(act) * CHIPS); put(to); cur = Math.max(cur, to); }
      else if (act === 'allin') { put(sd.streetBet + sd.stack); sd.allIn = true; cur = Math.max(cur, sd.streetBet); }
    }
    for (const sd of seats) sd.streetBet = 0;
    const board: Card[] = [];
    const flop = r.board_flop ?? '';
    for (let j = 0; j + 1 < flop.length; j += 2) board.push(card(flop.slice(j, j + 2)));
    const actions: Array<{ seat: number; street: 'flop' | 'turn' | 'river'; action: Action; amount: number }> = [];
    let street: 'flop' | 'turn' | 'river' = 'flop';
    let currentBet = 0;
    const tokens = (r.postflop_action ?? '').split('/').filter(Boolean);
    for (let j = 0; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t === 'dealcards') { board.push(card(tokens[++j]!)); street = board.length === 4 ? 'turn' : 'river'; currentBet = 0; for (const sd of seats) sd.streetBet = 0; continue; }
      const m = /^(OOP|IP)_(CHECK|CALL|FOLD|BET|RAISE|ALLIN)(?:_([\d.]+))?$/.exec(t);
      if (!m) continue;
      const sd = m[1] === 'OOP' ? seats[OOP]! : seats[IP]!;
      const put = (to: number) => { const add = Math.min(to - sd.streetBet, sd.stack); sd.stack -= add; sd.streetBet += add; sd.totalBet += add; return add; };
      if (m[2] === 'CHECK') actions.push({ seat: sd.seat, street, action: { type: 'check' }, amount: 0 });
      else if (m[2] === 'CALL') actions.push({ seat: sd.seat, street, action: { type: 'call' }, amount: put(currentBet) });
      else if (m[2] === 'FOLD') { sd.folded = true; actions.push({ seat: sd.seat, street, action: { type: 'fold' }, amount: 0 }); }
      else if (m[2] === 'BET') { const to = Math.round(parseFloat(m[3]!) * CHIPS); const add = put(to); currentBet = to; actions.push({ seat: sd.seat, street, action: { type: 'bet', amount: to }, amount: add }); }
      else if (m[2] === 'RAISE') { const to = Math.round(parseFloat(m[3]!) * CHIPS); const add = put(to); currentBet = to; actions.push({ seat: sd.seat, street, action: { type: 'raise', amount: to }, amount: add }); }
      else if (m[2] === 'ALLIN') { const to = sd.streetBet + sd.stack; const add = put(to); sd.allIn = true; currentBet = Math.max(currentBet, to); actions.push({ seat: sd.seat, street, action: { type: 'all-in' }, amount: add }); }
    }
    const heroSeat = r.hero_position === 'IP' ? IP : OOP;
    const hero = seats[heroSeat]!;
    const pot = seats.reduce((x, sd) => x + sd.totalBet, 0);
    const avail = JSON.parse((r.available_moves ?? '[]').replace(/'/g, '"')) as string[];
    const toCall = Math.max(0, Math.min(currentBet - hero.streetBet, hero.stack));
    const betSize = avail.find((m) => /^Bet /.test(m)); const raiseSize = avail.find((m) => /^Raise /.test(m));
    const legal: LegalActions = {
      fold: avail.includes('Fold'), check: avail.includes('Check'), call: avail.includes('Call') ? toCall : null,
      bet: betSize ? { min: Math.max(CHIPS, Math.round(pot * 0.25)), max: hero.streetBet + hero.stack } : null,
      raise: raiseSize ? { min: Math.min(currentBet * 2, hero.streetBet + hero.stack), max: hero.streetBet + hero.stack } : null,
      allIn: hero.stack,
    };
    const hole = [card(r.holding!.slice(0, 2)), card(r.holding!.slice(2, 4))];
    const view: TableView = {
      config: { seats: 6, smallBlind: 1, bigBlind: 2, ante: 0, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 30_000 },
      seats: seats.map((x) => ({ seat: x.seat, playerId: `p${x.seat}`, stack: x.stack, status: 'active', waitingForBigBlind: false, inHand: { streetBet: x.streetBet, totalBet: x.totalBet, folded: x.folded, allIn: x.allIn, ...(x.seat === heroSeat ? { holeCards: hole } : {}) } })),
      button: IP, handNo: 1, viewerSeat: heroSeat,
      hand: { handNo: 1, seedCommit: 'bench', smallBlindSeat: IP, bigBlindSeat: OOP, street, board, pots: [{ amount: pot, eligible: [OOP, IP] }], toAct: heroSeat, currentBet, minRaise: 2, actions, actionDeadline: null },
      legal,
    };
    const want = r.correct_decision!;
    const wantSize = /^(Bet|Raise) /.test(want) ? Math.round(parseFloat(want.split(' ')[1]!) * CHIPS) : null;
    yield { view, legal, seat: heroSeat, want, wantSize, street };
  }
}
