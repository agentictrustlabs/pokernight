/**
 * WHAT A SEASON WOULD WRITE TO THE FIELD APP, WITHOUT WRITING IT — and without a model.
 *
 *   pnpm check:field-records [--out <file.json>] [--days 40]
 *
 * Plays a season by the house's own policy (the control: no agent is asked, nothing is charged), gives every team and
 * body it founds a made-up agent address, has a steward DEFINE a community so that path is covered, and runs the same
 * `recordsFor` the season object runs. Prints the count per record kind and per vault, checks the invariants this
 * repository can check on its own (ids, envelopes, links that must resolve), and with `--out` leaves the records as
 * JSON — which is what the field app's own validator is run over (`~/engage`, `validateFieldRecord`): this repository
 * links to no private checkout, so that half is a test over there reading this file.
 */
import { writeFileSync } from 'node:fs';
import { NORTH_OF_DENVER as S, NORTHERN_COLORADO as R, apply, attachAgent, chooseAction, openStaging, tick, viewFor, type Casting, type FieldOpsState } from '@pokernight/fieldops';
import { recordsFor, type FieldEstate, type FieldRecordOut } from '../src/field-estate.js';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d; };
const OUT = arg('--out', ''); const DAYS = Number(arg('--days', '0'));
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const cast: Casting[] = S.roles.map((r) => ({ role: r.id, agent: `${r.id}.me`, name: r.name, custodian: 'house', operator: 'agent', mind: 'rules' }));
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

let s: FieldOpsState = openStaging({ scenario: S, region: R, cast, seedHex: SEED, seedCommit: 'c', now: Date.UTC(2026, 8, 1), pace: 1 });
let now = s.startedAt; let tickN = 0; let nAgent = 0x1000; let defined = false;
const charter = () => {
  for (const t of s.teams) if (!t.agent) s = attachAgent(s, { team: t.id }, addr(nAgent++), 'elena');
  for (const b of s.bodies) if (!b.agent && (b.foundedDay > 0 || b.recognizedFrom)) s = attachAgent(s, { body: b.id }, addr(nAgent++), 'elena');
};
for (let guard = 0; guard < 4000 && s.phase !== 'revealed' && (!DAYS || s.day <= DAYS); guard++) {
  if (s.phase === 'day') {
    for (const c of s.cast) {
      const lines = S.roles.find((r) => r.id === c.role)!.lines;
      // One steward invents a people community once its team exists — the defined-in-play path.
      const mine = s.teams.find((t) => t.steward === c.role);
      if (!defined && mine && s.day >= 3) {
        const r = apply(s, S, R, c.role, { type: 'define-community', name: 'Night-shift packers — Fort Morgan', people: 'Night-shift packers', town: s.where[c.role] ?? mine.home, definition: 'Workers on the plant\'s night shift, of several peoples, who share a schedule more than a language.', language: 'spanish' }, now, 'agent');
        if (r.ok) { s = r.state; defined = true; continue; }
      }
      const move = chooseAction(viewFor(s, S, R, c.role), lines, tickN++);
      if (!move) continue;
      const r = apply(s, S, R, c.role, move.action, now, 'agent');
      if (r.ok) s = r.state;
      if (['move', 'adopt', 'join', 'invite', 'decline'].includes(move.action.type)) {
        const m2 = chooseAction(viewFor(s, S, R, c.role), lines, tickN++);
        if (m2 && m2.action.type !== 'move') { const r2 = apply(s, S, R, c.role, m2.action, now, 'agent'); if (r2.ok) s = r2.state; }
      }
    }
    charter();
  }
  now = s.deadline! + 1;
  s = tick(s, S, R, now).state;
}
charter();

const estate: FieldEstate = {
  home: 'https://home.example', clientId: 'field-app', chainId: 34348, a2a: 'https://a2a.example', mcp: 'https://mcp.example', origin: 'https://games.example', deliveryServiceSa: addr(1), interactionsServiceSa: addr(2),
  workspace: { sa: addr(0x10), custodian: 'nathan', name: 'Northern Colorado Field — Game Night' }, organization: { sa: addr(0x11), custodian: 'nathan', name: 'Northern Colorado Field — Game Night (organization)' },
  partners: {}, workers: Object.fromEntries(S.roles.map((r, i) => [r.id, { sa: addr(0x100 + i), custodian: 'elena' }])),
};
const out = recordsFor(estate, s, S, R, 'c0ffee00-0000-4000-8000-000000000000', 0, new Date(now).toISOString());

// ── what this repository can check on its own ────────────────────────────────────────────────────────────
const ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const problems: string[] = [];
const vaults: Array<{ vault: string; records: FieldRecordOut[] }> = [
  ...Object.entries(out.team).map(([k, records]) => ({ vault: `team:${k}`, records })),
  ...Object.entries(out.body).map(([k, records]) => ({ vault: `body:${k}`, records })),
  { vault: 'workspace', records: out.workspace },
];
const kinds: Record<string, number> = {};
for (const { vault, records } of vaults) {
  const seen = new Set<string>();
  const ids = new Set(records.map((r) => r.record.id));
  for (const { folder, record } of records) {
    kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
    const at = `${vault} ${record.kind} ${record.id}`;
    if (!ID.test(record.id)) problems.push(`${at}: id is not lowercase, digits and hyphens`);
    if (seen.has(`${folder}/${record.id}`)) problems.push(`${at}: written twice into ${folder}`);
    seen.add(`${folder}/${record.id}`);
    const env = record.envelope as { sensitivity?: string; purpose?: string } | undefined;
    if (!env?.sensitivity || !env.purpose) problems.push(`${at}: no disclosure envelope`);
    if (!String(record.title ?? '').trim()) problems.push(`${at}: no title`);
    for (const link of ['parentId', 'recognizedFromId', 'fromAssessmentId', 'producedResultId', 'supersedes'] as const) {
      const v = record[link];
      if (typeof v === 'string' && v && !ids.has(v)) problems.push(`${at}: ${link} → ${v} is not a record in the same vault`);
    }
    if (record.kind === 'activity' && typeof record.contextRef === 'string' && record.contextRef && !ids.has(record.contextRef)) problems.push(`${at}: contextRef → ${record.contextRef} is not a body in the same vault`);
  }
}
console.log(`season: day ${s.day}, ${s.teams.length} teams, ${s.bodies.length} bodies (${s.bodies.filter((b) => b.kind === 'church').length} churches), ${Object.keys(s.worked).length} communities worked, ${s.defined.length} defined in play`);
console.log('records by kind:', Object.entries(kinds).sort().map(([k, n]) => `${k} ${n}`).join(' · '));
for (const v of vaults) console.log(`  ${v.vault}: ${v.records.length}`);
if (OUT) { writeFileSync(OUT, JSON.stringify({ vaults, phases: out.phases }, null, 1)); console.log(`written to ${OUT}`); }
if (problems.length) { console.error(`\n${problems.length} problems:\n  - ${problems.slice(0, 40).join('\n  - ')}`); process.exit(1); }
console.log('no problems this repository can see');
