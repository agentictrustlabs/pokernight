#!/usr/bin/env node
/**
 * End-to-end smoke: start the tables Worker, create a table, seat two rules-based
 * bots, and wait for N hands to complete. Exit 0 on success, 1 on timeout/error.
 *
 *   node scripts/smoke.mjs [--hands 20] [--port 8787] [--no-server]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((x) => x.length),
);
const HANDS = Number(args.hands ?? 20);
const PORT = Number(args.port ?? 8787);
const BASE = `http://localhost:${PORT}`;
const children = [];
const kill = () => { for (const c of children) try { c.kill('SIGINT'); } catch {} };
process.on('exit', kill);
process.on('SIGINT', () => { kill(); process.exit(130); });

const run = (cmd, argv, opts = {}) => {
  const c = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  children.push(c);
  c.stdout.on('data', (d) => process.stdout.write(`[${opts.tag ?? cmd}] ${d}`));
  c.stderr.on('data', (d) => process.stderr.write(`[${opts.tag ?? cmd}] ${d}`));
  return c;
};

if (!args['no-server']) {
  run('pnpm', ['--filter', 'pokernight-tables', 'dev', '--', '--port', String(PORT)], { tag: 'tables' });
}
// wait for /health
const deadline = Date.now() + 60_000;
for (;;) {
  try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
  if (Date.now() > deadline) { console.error('server did not come up'); process.exit(1); }
  await sleep(500);
}
const created = await fetch(`${BASE}/tables`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'smoke', config: { seats: 6, smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs: 5000 } }),
}).then((r) => r.json());
const tableId = created.tableId;
console.log(`table ${tableId}`);

for (const [seat, name] of [[1, 'Ada'], [2, 'Bob']]) {
  run('node', ['--import', 'tsx', './src/bot.ts', '--server', BASE, '--table', tableId, '--seat', String(seat), '--buy-in', '200', '--name', name, '--think-ms', '50'], { tag: name, cwd: 'apps/agent' });
}

const start = Date.now();
for (;;) {
  const v = await fetch(`${BASE}/tables/${tableId}`).then((r) => r.json()).catch(() => null);
  const handNo = v?.view?.handNo ?? v?.handNo ?? 0;
  if (handNo >= HANDS) { console.log(`✔ ${handNo} hands played in ${((Date.now() - start) / 1000).toFixed(1)}s`); kill(); process.exit(0); }
  if (Date.now() - start > 180_000) { console.error(`✘ only ${handNo} hands after 180s`); kill(); process.exit(1); }
  await sleep(1000);
}
