/**
 * POKERBENCH — the measuring stick for anything that advises at hold'em.
 *
 * PokerBench (Zhuang et al., 2025; `RZ412/PokerBench`) is ~1k preflop and ~10k postflop spots with a
 * SOLVER'S decision for each, and its own finding is that a higher score correlates with a higher win
 * rate between agents. So it is the difference between "the advice seems ok" and a number that moves
 * when a skill is edited. This scores the DETERMINISTIC half of the card room's advice — `decide`, the
 * rules coach that is also the prior a person's own agent starts from — for free and in seconds.
 *
 * Each scenario is rebuilt as the engine's own `TableView` + `LegalActions`, replaying the action line
 * seat by seat, so what is scored is exactly what a table would hand an adviser. 6-max, blinds 0.5/1
 * and 100-chip stacks in the data; scaled ×2 here because the engine deals in integer chips.
 *
 * Scoring follows the benchmark: the ACTION class must match (fold/check/call/raise), and a raise
 * additionally within ±25% of the solver's size — reported separately, because the class is the
 * decision and the size is the craft.
 *
 *   npx tsx bench/pokerbench.mts [--set preflop|postflop] [--limit N] [--json]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, Card, LegalActions, TableView } from '../packages/engine/src/index.ts';
import { decide } from '../packages/agent-kit/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d; };
const SET = flag('set', 'preflop');
const LIMIT = Number(flag('limit', '0')) || Infinity;
const JSON_OUT = args.includes('--json');

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

interface Scored { n: number; classHit: number; sizeHit: number; raisesScored: number; byLabel: Record<string, { n: number; hit: number }>; confusions: Record<string, number> }
const scored = (): Scored => ({ n: 0, classHit: 0, sizeHit: 0, raisesScored: 0, byLabel: {}, confusions: {} });
const cls = (a: string) => a.split(' ')[0]!.toLowerCase().replace(/^bet$/, 'raise').replace(/^allin$/, 'raise');
const record = (s: Scored, want: string, wantSize: number | null, got: Action) => {
  const w = cls(want);
  const g = got.type === 'all-in' || got.type === 'bet' ? 'raise' : got.type;
  s.n++;
  s.byLabel[w] = s.byLabel[w] ?? { n: 0, hit: 0 };
  s.byLabel[w]!.n++;
  if (w === g) { s.classHit++; s.byLabel[w]!.hit++; } else s.confusions[`${w}→${g}`] = (s.confusions[`${w}→${g}`] ?? 0) + 1;
  if (w === 'raise' && wantSize != null) {
    s.raisesScored++;
    const gotSize = got.type === 'raise' || got.type === 'bet' ? got.amount : got.type === 'all-in' ? Infinity : 0;
    if (w === g && Math.abs(gotSize - wantSize) <= 0.25 * wantSize) s.sizeHit++;
  }
};

function preflop(): Scored {
  const rows = parseCsv(readFileSync(resolve(HERE, 'pokerbench/preflop_1k_test_set_game_scenario_information.csv'), 'utf8'));
  const s = scored();
  for (const r of rows.slice(0, LIMIT)) {
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
    const got = decide({ skill: 'poker.act', tableId: 'bench', handNo: 1, seat: heroSeat, view, legal, deadlineMs: 0 }, { rng: () => 1 }).action;
    record(s, /bb$/.test(want) ? `raise ${want}` : want, wantSize, got);
  }
  return s;
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

const s = SET === 'preflop' ? preflop() : (() => { throw new Error('postflop: next'); })();
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
if (JSON_OUT) console.log(JSON.stringify({ set: SET, n: s.n, action: s.classHit / s.n, size: s.raisesScored ? s.sizeHit / s.raisesScored : null, byLabel: s.byLabel, confusions: s.confusions }));
else {
  console.log(`PokerBench ${SET} · ${s.n} spots · house coach (decide, rng=1)`);
  console.log(`  action class: ${pct(s.classHit, s.n)}   raise size within 25%: ${pct(s.sizeHit, s.raisesScored)} of ${s.raisesScored} raises`);
  for (const [k, v] of Object.entries(s.byLabel)) console.log(`  ${k.padEnd(6)} ${pct(v.hit, v.n).padStart(6)}  (${v.n})`);
  console.log('  worst confusions:', Object.entries(s.confusions).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', '));
}
