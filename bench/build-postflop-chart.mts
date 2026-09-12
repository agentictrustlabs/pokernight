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
import { postflopKeys, BET_FRACTIONS, RAISE_MULTIPLES, VERBS, nearest } from '../packages/agent-kit/src/postflop-chart.ts';
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
  const keys = postflopKeys(spot.view, spot.legal);
  if (!keys) { unkeyed++; continue; }
  const label = spot.want.split(' ')[0]!.toLowerCase() as keyof Omit<Tally, 'f' | 'x'>;
  // EVERY LEVEL AT ONCE: the exact spot and its three coarser cousins each learn from this decision, so a
  // live spot the benchmark never saw exactly is answered from the ones most like it.
  for (const key of keys) {
    const t = tab.get(key) ?? { bet: 0, raise: 0, call: 0, check: 0, fold: 0, f: [], x: [] };
    if (!(label in t)) continue;
    t[label] += 1;
    if (spot.wantSize != null) {
      const pot = potTotal(spot.view);
      const cur = spot.view.hand!.currentBet;
      if (label === 'bet' && pot > 0) t.f.push(nearest(spot.wantSize / pot, BET_FRACTIONS));
      if (label === 'raise' && cur > 0) t.x.push(nearest(spot.wantSize / cur, RAISE_MULTIPLES));
    }
    tab.set(key, t);
  }
  if (n % 100000 === 0) console.error(`  ${n} spots · ${tab.size} keys`);
}
// THE MOST COMMON SIZE, not the median: a solver's sizes are bimodal (a third of the pot or the whole of it),
// and the median of a bimodal set is a size it never uses. Sizes were snapped to the solver's own menu above.
const mode = (a: number[]) => { if (!a.length) return undefined; const c = new Map<number, number>(); for (const v of a) c.set(v, (c.get(v) ?? 0) + 1); return [...c.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0]![0]; };
// THE COUNTS THEMSELVES, not a verdict: the chart combines a spot's own counts with its coarser cousins'
// at lookup (`postflopChartDecision`), and a verdict cannot be combined. Order is `VERBS`.
const keys: Record<string, unknown> = {};
let pruned = 0;
for (const [k, t] of tab) {
  const c = VERBS.map((v) => t[v]);
  // A single decision is not evidence anybody should lean on, and it is weight in every Worker that bundles it.
  if (c.reduce((a, b) => a + b, 0) < 2) { pruned++; continue; }
  const f = mode(t.f); const x = mode(t.x);
  // Compact: the five counts, then the bet fraction and raise multiple where known (null otherwise).
  keys[k] = x !== undefined ? [...c, f ?? null, x] : f !== undefined ? [...c, f] : c;
}
const out = {
  _source: 'RZ412/PokerBench postflop_500k_train_set (solver decisions); built by bench/build-postflop-chart.mts',
  _key: 'street|ip/oop|facing|pre.line|made|draw|texture|spr, with * where a level dropped a feature  (tokens shortened by postflop-chart.ts `short`)  →  [bet, raise, call, check, fold counts, most common bet as fraction of pot, most common raise-to as multiple of the bet faced]',
  keys,
};
const dest = resolve(HERE, '../packages/agent-kit/src/postflop-chart.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`${n} spots (${unkeyed} unkeyed) · ${tab.size} keys (${pruned} single-spot keys pruned) · ${(readFileSync(dest).length / 1024).toFixed(0)} KB → ${dest}`);
