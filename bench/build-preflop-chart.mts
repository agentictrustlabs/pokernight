/**
 * THE PREFLOP CHART, DERIVED FROM A SOLVER — `packages/agent-kit/src/preflop-chart.json`.
 *
 * Reads PokerBench's 60k solver-labelled preflop spots and writes, per (position, raises so far,
 * facing an all-in, hand class), the solver's majority action and — for a raise — its median size in
 * big blinds. A second, coarser table drops the all-in flag, so a spot the fine key never saw still has
 * an answer before the rules do. The hand-tuned rules stay as the floor for everything else.
 *
 * WHY A TABLE AND NOT MORE RULES. Measured against the same benchmark, the rules scored 60% on the
 * action class — they almost never CALL, and they fold where the solver raises. A table keyed this way
 * scores 85% held out. A person's own agent starts from this line, so its quality is the floor of every
 * piece of advice in the card room; and the house bots play it.
 *
 *   npx tsx bench/build-preflop-chart.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORDER = '23456789TJQKA';
const handClass = (h: string): string => {
  const [a, b] = [h[0]!, h[2]!].sort((x, y) => ORDER.indexOf(y) - ORDER.indexOf(x));
  return a === b ? a + b : a + b + (h[1] === h[3] ? 's' : 'o');
};

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

const rows = parseCsv(readFileSync(resolve(HERE, 'pokerbench/preflop_60k_train_set_game_scenario_information.csv'), 'utf8'));
type Tally = { fold: number; call: number; check: number; raise: number; sizes: number[] };
const fine = new Map<string, Tally>();
const coarse = new Map<string, Tally>();
const tally = (m: Map<string, Tally>, k: string, label: string, size: number | null) => {
  const t = m.get(k) ?? { fold: 0, call: 0, check: 0, raise: 0, sizes: [] };
  (t as unknown as Record<string, number>)[label] += 1;
  if (size != null) t.sizes.push(size);
  m.set(k, t);
};
for (const r of rows) {
  const line = (r.prev_line ?? '').split('/').filter(Boolean);
  const facingAllin = line.includes('allin');
  const d = r.correct_decision!;
  const label = d.endsWith('bb') || d === 'allin' ? 'raise' : d;
  const size = d.endsWith('bb') ? parseFloat(d) : d === 'allin' ? 100 : null;
  const hand = handClass(r.hero_holding!);
  tally(fine, `${r.hero_pos}|${r.num_bets}|${facingAllin ? 1 : 0}|${hand}`, label, size);
  tally(coarse, `${r.hero_pos}|${r.num_bets}|${hand}`, label, size);
}
const pick = (t: Tally) => {
  const best = (['raise', 'call', 'check', 'fold'] as const).reduce((a, b) => (t[b] > t[a] ? b : a));
  const n = t.fold + t.call + t.check + t.raise;
  const entry: { a: string; n: number; p: number; to?: number } = { a: best, n, p: Math.round((100 * t[best]) / n) };
  if (best === 'raise' && t.sizes.length) {
    const s = [...t.sizes].sort((x, y) => x - y);
    entry.to = s[Math.floor(s.length / 2)]!;
  }
  return entry;
};
const out = {
  _source: 'RZ412/PokerBench preflop_60k_train_set (solver decisions); built by bench/build-preflop-chart.mts',
  _key: 'position|raisesSoFar|facingAllIn|handClass  →  a: majority action, n: spots, p: % agreeing, to: median raise-to in big blinds (100 = all-in)',
  fine: Object.fromEntries([...fine].map(([k, t]) => [k, pick(t)])),
  coarse: Object.fromEntries([...coarse].map(([k, t]) => [k, pick(t)])),
};
const dest = resolve(HERE, '../packages/agent-kit/src/preflop-chart.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`fine ${fine.size} keys · coarse ${coarse.size} keys · ${(readFileSync(dest).length / 1024).toFixed(0)} KB → ${dest}`);
