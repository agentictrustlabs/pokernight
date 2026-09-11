/**
 * POKERBENCH — the measuring stick for anything that advises at hold'em.
 *
 * PokerBench (Zhuang et al., 2025; `RZ412/PokerBench`) is ~1k preflop and ~10k postflop spots with a
 * SOLVER'S decision for each, and its own finding is that a higher score correlates with a higher win
 * rate between agents. So it is the difference between "the advice seems ok" and a number that moves
 * when a skill is edited. This scores the DETERMINISTIC half of the card room's advice — `decide`, the
 * rules coach that is also the prior a person's own agent starts from — for free and in seconds.
 *
 * Scoring follows the benchmark: the ACTION class must match, and a bet or raise additionally within
 * ±25% of the solver's size — reported separately, because the class is the decision and the size is
 * the craft. Spots are rebuilt by `bench/replay.mts`, the same replay the chart builders use.
 *
 *   npx tsx bench/pokerbench.mts [--set preflop|postflop] [--limit N] [--json]
 */
import type { Action } from '../packages/engine/src/index.ts';
import { decide } from '../packages/agent-kit/src/index.ts';
import { postflopSpots, preflopSpots, type Spot } from './replay.mts';

const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d; };
const SET = flag('set', 'preflop');
const LIMIT = Number(flag('limit', '0')) || Infinity;
const JSON_OUT = args.includes('--json');

interface Scored { n: number; classHit: number; sizeHit: number; raisesScored: number; byLabel: Record<string, { n: number; hit: number }>; byStreet: Record<string, { n: number; hit: number }>; confusions: Record<string, number> }
const scored = (): Scored => ({ n: 0, classHit: 0, sizeHit: 0, raisesScored: 0, byLabel: {}, byStreet: {}, confusions: {} });
// Preflop, the data says "raise" for any aggression; postflop it says Bet or Raise and so does the engine.
const cls = (a: string) => a.split(' ')[0]!.toLowerCase().replace(/^allin$/, 'raise');
function record(s: Scored, spot: Spot, got: Action) {
  const street = spot.street;
  const w = street === 'preflop' ? cls(spot.want).replace(/^bet$/, 'raise') : cls(spot.want);
  const g = got.type === 'all-in' ? (w === 'bet' ? 'bet' : 'raise') : street === 'preflop' && got.type === 'bet' ? 'raise' : got.type;
  s.n++;
  s.byStreet[street] = s.byStreet[street] ?? { n: 0, hit: 0 };
  s.byStreet[street]!.n++;
  if (w === g) s.byStreet[street]!.hit++;
  s.byLabel[w] = s.byLabel[w] ?? { n: 0, hit: 0 };
  s.byLabel[w]!.n++;
  if (w === g) { s.classHit++; s.byLabel[w]!.hit++; } else s.confusions[`${w}→${g}`] = (s.confusions[`${w}→${g}`] ?? 0) + 1;
  if ((w === 'raise' || w === 'bet') && spot.wantSize != null) {
    s.raisesScored++;
    const gotSize = got.type === 'raise' || got.type === 'bet' ? got.amount : got.type === 'all-in' ? Infinity : 0;
    if (w === g && Math.abs(gotSize - spot.wantSize) <= 0.25 * spot.wantSize) s.sizeHit++;
  }
}

const s = scored();
for (const spot of SET === 'preflop' ? preflopSpots(undefined, LIMIT) : postflopSpots(undefined, LIMIT)) {
  const got = decide({ skill: 'poker.act', tableId: 'bench', handNo: 1, seat: spot.seat, view: spot.view, legal: spot.legal, deadlineMs: 0 }, { rng: () => 1 }).action;
  record(s, spot, got);
}
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
if (JSON_OUT) console.log(JSON.stringify({ set: SET, n: s.n, action: s.classHit / s.n, size: s.raisesScored ? s.sizeHit / s.raisesScored : null, byLabel: s.byLabel, byStreet: s.byStreet, confusions: s.confusions }));
else {
  console.log(`PokerBench ${SET} · ${s.n} spots · house coach (decide, rng=1)`);
  console.log(`  action class: ${pct(s.classHit, s.n)}   bet/raise size within 25%: ${pct(s.sizeHit, s.raisesScored)} of ${s.raisesScored}`);
  for (const [k, v] of Object.entries(s.byLabel)) console.log(`  ${k.padEnd(6)} ${pct(v.hit, v.n).padStart(6)}  (${v.n})`);
  if (Object.keys(s.byStreet).length > 1) for (const [k, v] of Object.entries(s.byStreet)) console.log(`  by street ${k.padEnd(6)} ${pct(v.hit, v.n).padStart(6)}  (${v.n})`);
  console.log('  worst confusions:', Object.entries(s.confusions).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', '));
}
