/**
 * ONE RECORD, ONE ARTIFACT — after the season's writer changed how it names them.
 *
 *   node scripts/prune-field-records.mjs [--dry]
 *
 * A record in a vault's library is an ARTIFACT, and its artifact id is derived from its folder, its name and (the field
 * app's rule) the community it is about. The season used to derive it without the community, so a season re-written
 * under the new rule leaves two artifacts for one record — and every list in the field app that does not dedupe shows
 * the circle twice. This looks at every vault the seasons write to (the workspace, and every team, circle and church in
 * the chartered ledger), and deletes ONLY: an artifact whose folder+name another artifact also holds, keeping the one
 * named by the field app's rule; and the older phase results (`fo-<season>-phase-<community>.json`, no day), whose
 * shape the field app refuses. Nothing that is the only copy of a record is touched. `--dry` lists.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const DRY = process.argv.includes('--dry');
const note = JSON.parse(readFileSync(new URL('../fieldops-estate.note.json', import.meta.url), 'utf8'));
const TABLES = new URL('../apps/tables', import.meta.url).pathname;
const log = (s) => console.log(s);

const tokens = new Map();
async function tokenFor(handle) {
  if (!tokens.has(handle)) {
    const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle }) });
    const j = await r.json().catch(() => ({}));
    if (!j.id_token) throw new Error(`demo-signin ${handle}: ${JSON.stringify(j).slice(0, 160)}`);
    tokens.set(handle, j.id_token);
  }
  return tokens.get(handle);
}
async function index(token, org) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`${HOME}/connect/library?org=${org}`, { headers: { authorization: `Bearer ${token}` } });
    if (r.ok) return ((await r.json()).artifacts ?? []).filter((a) => !a.isFolder);
    if (attempt === 4) throw new Error(`library ${org.slice(0, 10)} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    await new Promise((x) => setTimeout(x, 2500 * attempt));
  }
  return [];
}
async function del(token, org, id) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`${HOME}/connect/library`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ org, action: 'delete', id }) });
    if (r.ok) return;
    if (attempt === 4) throw new Error(`delete ${id} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    await new Promise((x) => setTimeout(x, 2500 * attempt));
  }
}
// READ LOUDLY: a ledger that cannot be read is not an empty one.
const kv = spawnSync('pnpm', ['exec', 'wrangler', 'kv', 'key', 'get', 'fieldops-chartered', '--env', 'faithnet', '--binding', 'CLUB_WIRES', '--remote'], { cwd: TABLES, encoding: 'utf8' });
if (kv.status !== 0) throw new Error(`the chartered ledger could not be read: ${(kv.stderr || kv.stdout).trim().split('\n').pop()}`);
const chartered = JSON.parse(kv.stdout.trim());

const vaults = [{ sa: note.workspace.sa, name: note.workspace.name, custodian: note.workspace.custodian }, ...chartered.map((c) => ({ sa: c.sa, name: c.name, custodian: c.custodian }))];
let removed = 0;
for (const v of vaults) {
  let all;
  try { all = await index(await tokenFor(v.custodian), v.sa); } catch (e) { log(`${v.name}: ! ${e.message}`); continue; }
  const field = all.filter((a) => String(a.folder ?? '').startsWith('field/'));
  const byRecord = new Map();
  for (const a of field) { const k = `${a.folder}/${a.name}`; byRecord.set(k, [...(byRecord.get(k) ?? []), a]); }
  const doomed = [];
  for (const [k, twins] of byRecord) {
    if (twins.length > 1) {
      // Keep the artifact the field app would name; every `-none-` twin beside it goes. Never the last copy.
      const keep = twins.find((a) => !/-none-[a-z0-9]+$/.test(a.id)) ?? twins[0];
      for (const a of twins) if (a !== keep) doomed.push({ a, why: `a second copy of ${k}` });
    } else if (/^field\/phase-results\/fo-[0-9a-f]{8}-phase-.*\.json$/.test(k) && !/-d\d+\.json$/.test(k)) doomed.push({ a: twins[0], why: 'an older phase result the field app refuses' });
  }
  log(`${v.name} (${String(v.sa).slice(0, 10)}…): ${field.length} field artifacts, ${doomed.length} to remove`);
  for (const { a, why } of doomed) {
    log(`    ${DRY ? 'would remove' : 'remove'} ${a.id} — ${why}`);
    if (!DRY) { try { await del(await tokenFor(v.custodian), v.sa, a.id); removed += 1; } catch (e) { log(`      ! ${e.message}`); } }
  }
}
log(`\n${DRY ? 'dry run' : `${removed} artifacts removed`}`);
