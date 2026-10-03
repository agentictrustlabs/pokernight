/**
 * REPAIR EXPIRED ORG SESSION LEAVES across the Field Operations realm — the season self-heal, run by hand.
 *
 * A DEL-001 session leaf was 12 h by default. A PERSON's self-heals every Home login; an ORG never logs in, so
 * its leaf expired overnight and every org vault read answered `auth failed — mcp: auth failed` (409) with nothing
 * to re-issue it. `field-charter.ts enableStorage(…, regrant=true)` re-signs the interactions grant AND a fresh,
 * now year-long, open-audience leaf — which is exactly what repairs it. This reuses that same ceremony, signed
 * through the Home for each org's demo custodian (no local keys), over every realm org:
 *   - the workspace and its accompanying organization, and the partner churches (the estate note), and
 *   - every team / circle / church the current season chartered (KV `fieldops-chartered`).
 *
 *   npx tsx scripts/repair-fieldops-leaves.mts [--dry] [--only 0x<org>] [--all-stagings]
 *     --dry           report each org's leaf state, re-issue nothing
 *     --only 0x…      repair just this one org (smoke test)
 *     --all-stagings  include chartered orgs from previous seasons too (default: current staging only)
 *
 * An org that is not `granted` is SKIPPED (it was never set up, or is not ours to enable) and named in the summary.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { enableStorage, signerFor, type EstateDoors } from '../apps/tables/src/field-charter.ts';

const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--all-stagings');
const ONLY = (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '')?.toLowerCase() ?? '';
const lower = (s: string) => String(s).toLowerCase();
const note = JSON.parse(readFileSync(new URL('../fieldops-estate.note.json', import.meta.url), 'utf8'));

const doors: EstateDoors = {
  home: note.home, clientId: note.clientId, chainId: Number(note.chainId),
  a2a: note.a2a, mcp: note.mcp, origin: note.origin,
  deliveryServiceSa: note.deliveryServiceSa, interactionsServiceSa: note.interactionsServiceSa,
};

/** Every realm org and who custodies it: the organization, the workspace, the partners (note) + chartered agents (KV). */
type Org = { sa: string; custodian: string; label: string };
const orgs = new Map<string, Org>();
const add = (sa: string, custodian: string, label: string) => { if (sa && custodian) orgs.set(lower(sa), { sa: lower(sa), custodian, label }); };
add(note.organization.sa, note.organization.custodian, note.organization.name ?? 'organization');
add(note.workspace.sa, note.workspace.custodian, note.workspace.name ?? 'workspace');
for (const p of Object.values<any>(note.partners ?? {})) add(p.sa, p.custodian, `partner ${p.name ?? ''}`.trim());

try {
  const TABLES = new URL('../apps/tables', import.meta.url).pathname;
  const led = JSON.parse(execSync(`cd ${TABLES} && pnpm exec wrangler kv key get --binding CLUB_WIRES --env faithnet --remote fieldops-chartered 2>/dev/null`, { encoding: 'utf8' }) || '[]') as any[];
  const latest = led.length ? led[led.length - 1].stagingId : null;
  const live = ALL ? led : led.filter((e) => e.stagingId === latest);
  // A restart re-founds the same name at a new address; the latest entry of a (kind,name) is the live one.
  const byName = new Map<string, any>(); for (const e of live) byName.set(`${e.kind}|${e.name}|${e.stagingId}`, e);
  for (const e of byName.values()) add(e.sa, e.custodian, `${e.kind} ${e.name}`);
  console.log(`realm: ${orgs.size} orgs (${led.length} ledger entries; ${ALL ? 'all stagings' : `current staging ${latest}`})`);
} catch (e) { console.log(`could not read the chartered ledger (${String(e).slice(0, 80)}); repairing the note's realm orgs only`); }

const jsonOf = async (r: Response) => (await r.json().catch(() => ({}))) as any;
const statusOf = (sa: string) => fetch(`${doors.a2a}/interactions/${lower(sa)}/status`).then(jsonOf);

let fixed = 0, healthy = 0, skipped = 0, failed = 0;
for (const o of orgs.values()) {
  if (ONLY && lower(o.sa) !== ONLY) continue;
  const st = await statusOf(o.sa);
  const tag = `${o.label} (${o.sa.slice(0, 10)}…, ${o.custodian})`;
  if (st.granted !== true) { skipped += 1; console.log(`  SKIP ${tag}: not granted (never set up / not ours) — granted=${st.granted}`); continue; }
  if (DRY) { if (st.leafLive === false) fixed += 1; else healthy += 1; console.log(`  ${st.leafLive === false ? 'WOULD REPAIR' : 're-issue (short→long)'} ${tag}: leafLive=${st.leafLive}`); continue; }
  try {
    const signer = await signerFor(doors, o.custodian);
    await enableStorage(doors, signer, o.sa, true); // regrant: a fresh year-long open-audience leaf
    const after = await statusOf(o.sa);
    if (after.leafLive === true) { fixed += 1; console.log(`  ✓ ${tag}: leafLive ${st.leafLive} → true`); }
    else { failed += 1; console.log(`  ! ${tag}: re-issued but leafLive=${after.leafLive}`); }
  } catch (e) { failed += 1; console.log(`  ! ${tag}: ${(e as Error).message.slice(0, 160)}`); }
}
console.log(`\n${DRY ? 'would re-issue' : 're-issued'} ${fixed}${skipped ? `, skipped ${skipped}` : ''}${failed ? `, ${failed} failed` : ''}; the realm's org leaves are year-long.`);
