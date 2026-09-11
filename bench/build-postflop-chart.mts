/**
 * THE POSTFLOP CHART, DERIVED FROM A SOLVER — `packages/agent-kit/src/postflop-chart.json`.
 *
 * Every one of PokerBench's 500k postflop spots is rebuilt as the engine's own view (`replay.mts`),
 * reduced to the feature key `postflopKey` computes at a live table, and tallied: the solver's majority
 * action per key, how many spots stood behind it and what share agreed, and the median size — a bet as
 * a fraction of the pot, a raise as a multiple of the bet faced. The same function builds and reads, so
 * the chart is asked exactly the questions it was built from.
 *
 *   npx tsx bench/build-postflop-chart.mts [--limit N]
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postflopKey } from '../packages/agent-kit/src/postflop-chart.ts';
import { potTotal } from '../packages/agent-kit/src/view.ts';
import { postflopSpots } from './replay.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d; };
const LIMIT = Number(flag('limit', '0')) || Infinity;

type Tally = { bet: number; raise: number; call: number; check: number; fold: number; f: number[]; x: number[] };
const tab = new Map<string, Tally>();
let n = 0; let unkeyed = 0;
for (const spot of postflopSpots('pokerbench/postflop_500k_train_set_game_scenario_information.csv', LIMIT)) {
  n++;
  const key = postflopKey(spot.view, spot.legal);
  if (!key) { unkeyed++; continue; }
  const label = spot.want.split(' ')[0]!.toLowerCase() as keyof Omit<Tally, 'f' | 'x'>;
  const t = tab.get(key) ?? { bet: 0, raise: 0, call: 0, check: 0, fold: 0, f: [], x: [] };
  if (!(label in t)) continue;
  t[label] += 1;
  if (spot.wantSize != null) {
    const pot = potTotal(spot.view);
    const cur = spot.view.hand!.currentBet;
    if (label === 'bet' && pot > 0) t.f.push(spot.wantSize / pot);
    if (label === 'raise' && cur > 0) t.x.push(spot.wantSize / cur);
  }
  tab.set(key, t);
  if (n % 100000 === 0) console.error(`  ${n} spots · ${tab.size} keys`);
}
const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s.length ? Math.round(s[Math.floor(s.length / 2)]! * 100) / 100 : undefined; };
const keys: Record<string, unknown> = {};
for (const [k, t] of tab) {
  const best = (['bet', 'raise', 'call', 'check', 'fold'] as const).reduce((a, b) => (t[b] > t[a] ? b : a));
  const total = t.bet + t.raise + t.call + t.check + t.fold;
  const f = median(t.f); const x = median(t.x);
  keys[k] = { a: best, n: total, p: Math.round((100 * t[best]) / total), ...(f !== undefined ? { f } : {}), ...(x !== undefined ? { x } : {}) };
}
const out = {
  _source: 'RZ412/PokerBench postflop_500k_train_set (solver decisions); built by bench/build-postflop-chart.mts',
  _key: 'street|ip/oop|facing|initiative|made|draw|texture|spr  →  a: majority action, n: spots, p: % agreeing, f: median bet as fraction of pot, x: median raise-to as multiple of the bet faced',
  keys,
};
const dest = resolve(HERE, '../packages/agent-kit/src/postflop-chart.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`${n} spots (${unkeyed} unkeyed) · ${tab.size} keys · ${(readFileSync(dest).length / 1024).toFixed(0)} KB → ${dest}`);
