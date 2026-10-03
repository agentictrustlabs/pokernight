/**
 * CLEAN VAULTS FOR ANOTHER SEASON — retire what the seasons chartered and wipe what they wrote; keep the realm.
 *
 *   set -a; . ~/engage/scripts/seed/faithnet.env; set +a
 *   node scripts/reset-fieldops-estate.mjs [--dry] [--keep-graph] [--retire-seeded]
 *
 * A season CHARTERS its teams, circles and churches as its characters' acts (`apps/tables/src/field-charter.ts`) and
 * writes each one to KV `fieldops-chartered`. A chartered agent is an agent on chain and cannot be deleted; what a
 * reset does is RETIRE it from everybody's field app — let go of every Home link the season made for it (the steward
 * persona's, its custodian's, the workspace custodian's, each member's) — and wipe the workspace's rows that point at
 * it. The same door the season used to link it (`/connect/related-orgs`, signed by the Home for a demo custodian)
 * unlinks it with `remove: true`.
 *
 * WHAT GOES:
 *   · every chartered team and body: unlinked at every Home it was linked at; its ledger entry
 *   · the workspace vault: `field/workspace-teams`, `field/workspace-communities`, `field/workspace-bodies`,
 *     `field/phase-results`, and the `field/workspace-agents` rows that are teams
 *   · with `--retire-seeded`: the teams and pool bodies an OLDER provisioning chartered (`fieldops-estate.faithnet.json`
 *     `teams` / `pool`), unlinked the same way, and the old pool ledger
 *   · the seasons' triples in the game's graph (founded bodies, defined communities, readings) — the estate's own stay
 * WHAT STAYS: the workspace agent, its profile and roster, the partners' agents and profiles, the cast.
 *
 * The seasons at gamenight keep their own state in their objects; "Another season" there opens a fresh one. Sequential
 * on purpose: the Home rewrites a catalog whole on each delete. Idempotent — a run cut short is finished by the next.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { bytesToHex, encodeAbiParameters, keccak256, recoverMessageAddress, toBytes } from 'viem';

const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const DRY = process.argv.includes('--dry');
const KEEP_GRAPH = process.argv.includes('--keep-graph');
const RETIRE_SEEDED = process.argv.includes('--retire-seeded');
const note = JSON.parse(readFileSync(new URL('../fieldops-estate.note.json', import.meta.url), 'utf8'));
const log = (s) => console.log(s);
const TABLES = new URL('../apps/tables', import.meta.url).pathname;

// ── the Home signs for a demo custodian ──────────────────────────────────────────────────────────────────
const signers = new Map();
async function signerFor(handle) {
  if (!signers.has(handle)) {
    const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle }) });
    const j = await r.json().catch(() => ({}));
    if (!j.homeSession || !j.id_token || !j.agent) throw new Error(`demo-signin ${handle}: ${JSON.stringify(j).slice(0, 160)}`);
    const sign = async (digest) => {
      const s = await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${j.homeSession}` }, body: JSON.stringify({ digest }) });
      const b = await s.json().catch(() => ({}));
      if (!b.ok || !b.signature) throw new Error(`persona-sign ${handle}: ${b.error ?? s.status}`);
      return b.signature;
    };
    const probe = `0x${'11'.repeat(32)}`;
    const eoa = await recoverMessageAddress({ message: { raw: probe }, signature: await sign(probe) });
    signers.set(handle, { handle, sa: j.agent.toLowerCase(), eoa, sign, idToken: j.id_token });
  }
  return signers.get(handle);
}
const contentHashOf = (f) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [f.orgAgent, keccak256(toBytes(f.orgName)), keccak256(toBytes(f.purpose)), keccak256(toBytes(f.requestedBy))]));
const writeChallenge = (a) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [keccak256(toBytes('related-agents:write:v2')), a.person, a.orgAgent, a.contentHash, a.nonce, BigInt(a.expiry)]));
const purposeOf = (kind) => (kind === 'team' ? 'field-team' : kind === 'circle' ? 'field-circle' : kind === 'church' ? 'field-church' : 'field-partner');
/** Let go of one person's (or persona's) link to an org — signed by whoever custodies them. */
async function unlink(org, who) {
  const signer = await signerFor(who.custodian);
  const fields = { orgAgent: org.sa, orgName: org.name, purpose: purposeOf(org.kind), requestedBy: CLIENT_ID };
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const person = (who.sa ?? signer.sa).toLowerCase();
  const sig = await signer.sign(writeChallenge({ person, orgAgent: org.sa, contentHash: contentHashOf(fields), nonce, expiry }));
  const r = await fetch(`${HOME}/connect/related-orgs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person, ...fields, sig, nonce, expiry, kind: org.kind, parent: person, relationship: 'member', displayName: who.name ?? who.custodian, remove: true }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`unlink ${who.name ?? who.custodian} ← ${org.name}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
}

// ── the library ──────────────────────────────────────────────────────────────────────────────────────────
async function index(token, org, folder) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`${HOME}/connect/library?org=${org}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
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
const kv = (...args) => spawnSync('pnpm', ['exec', 'wrangler', 'kv', 'key', ...args, '--env', 'faithnet', '--binding', 'CLUB_WIRES', '--remote'], { cwd: TABLES, encoding: 'utf8' });
// READ LOUDLY, NEVER SILENTLY EMPTY. A transient `wrangler kv get` failure used to return null → `?? []` →
// "0 agents in the ledger" → retire nothing → "the realm stands", a reset that reported success having done
// NOTHING (seen live 2026-10-03: one blip left every duplicate team standing). A genuinely-absent key is the
// only empty we accept; any other failure is retried and then THROWN so the reset aborts instead of no-opping.
function kvGet(key) {
  let last;
  for (let i = 0; i < 3; i++) {
    const r = kv('get', key); last = r;
    if (r.status === 0) { try { return JSON.parse(r.stdout.trim()); } catch (e) { throw new Error(`KV ${key}: value present but unparseable — ${String(e).slice(0, 100)}`); } }
    if (/not found|does not exist|no value|key .* not/i.test((r.stderr || r.stdout || ''))) return null; // legitimately absent ⇒ empty
    if (i < 2) spawnSync('sleep', ['2']);
  }
  throw new Error(`KV ${key}: read failed after 3 tries (refusing to treat a read error as an empty ledger) — ${(last.stderr || last.stdout || '').trim().split('\n').pop()}`);
}

let retired = 0; let removed = 0;
// ── 1. what the seasons chartered ────────────────────────────────────────────────────────────────────────
log(`═══ what the seasons chartered ═══`);
const chartered = kvGet('fieldops-chartered') ?? [];
log(`  ${chartered.length} agents in the ledger`);
for (const c of chartered) {
  const who = [{ sa: c.steward?.sa, name: c.steward?.name, custodian: c.custodian }, ...[...new Set(c.viewers ?? [])].map((h) => ({ custodian: h }))];
  log(`  ${c.name} (${c.kind}, ${String(c.sa).slice(0, 10)}…): unlink ${who.map((w) => w.name ?? w.custodian).join(', ')}`);
  if (DRY) continue;
  for (const w of who) { try { await unlink({ sa: c.sa, name: c.name, kind: c.kind }, w); } catch (e) { log(`    ! ${e.message}`); } }
  retired += 1;
}
// ── 2. with --retire-seeded: the older provisioning's teams and pool ─────────────────────────────────────
if (RETIRE_SEEDED) {
  log(`\n═══ the seeded teams and pool (older provisioning) ═══`);
  const statePath = new URL('../fieldops-estate.faithnet.json', import.meta.url);
  const m = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const seeded = [
    ...Object.values(m.teams ?? {}).filter((t) => t?.sa).map((t) => ({ sa: t.sa, name: t.name, kind: 'team', custodian: t.custodian })),
    ...[...(m.pool?.circle ?? []), ...(m.pool?.church ?? [])].map((b) => ({ sa: b.sa, name: b.label, kind: b.label?.startsWith('Circle') ? 'circle' : 'church', custodian: b.custodian })),
  ];
  for (const a of seeded) {
    const who = [...new Set([a.custodian, note.workspace.custodian])].map((h) => ({ custodian: h }));
    log(`  ${a.name} (${String(a.sa).slice(0, 10)}…): unlink ${who.map((w) => w.custodian).join(', ')}`);
    if (DRY) continue;
    for (const w of who) { try { await unlink({ sa: a.sa, name: a.name, kind: a.kind }, w); } catch (e) { log(`    ! ${e.message}`); } }
    retired += 1;
  }
  if (!DRY) kv('delete', 'fieldops-pool-adopted');
}
// ── 3. the workspace's rows that point at any of them ───────────────────────────────────────────────────
log(`\n═══ the workspace ═══`);
{
  const signer = await signerFor(note.workspace.custodian);
  const all = await index(signer.idToken, note.workspace.sa);
  const gone = all.filter((a) => ['field/workspace-teams', 'field/workspace-communities', 'field/workspace-bodies', 'field/phase-results'].includes(a.folder));
  const agents = await index(signer.idToken, note.workspace.sa, 'field/workspace-agents');
  const teamRows = agents.filter((a) => { try { return a.bytesB64 && JSON.parse(Buffer.from(a.bytesB64, 'base64').toString('utf8')).agentKind === 'team'; } catch { return false; } });
  log(`  ${gone.length + teamRows.length} of ${all.length} artifacts (${[...new Set([...gone.map((a) => a.folder), ...(teamRows.length ? ['field/workspace-agents (teams)'] : [])])].join(', ')})`);
  if (!DRY) for (const a of [...gone, ...teamRows]) { await del(signer.idToken, note.workspace.sa, a.id); removed += 1; }
}
// ── 4. the ledger ────────────────────────────────────────────────────────────────────────────────────────
log(`\n═══ the chartered ledger ═══`);
if (!DRY) { const r = kv('delete', 'fieldops-chartered'); log(`  ${r.status === 0 ? 'cleared' : `not cleared: ${(r.stderr || r.stdout).trim().split('\n').pop()}`}`); } else log('  would clear');
// ── 5. the graph ─────────────────────────────────────────────────────────────────────────────────────────
if (!KEEP_GRAPH) {
  log(`\n═══ the game graph ═══`);
  const envFile = new URL('../.graphdb.env', import.meta.url);
  if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split('\n')) { const mm = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2]; }
  const url = process.env.GRAPHDB_URL ?? 'https://graphdb.agentkg.io'; const basic = process.env.GRAPHDB_BASIC;
  if (!basic) log('  no credential; the seasons stay in the graph');
  else if (DRY) log('  would remove every season’s subjects (bodies, defined communities, readings), keeping the estate’s');
  else {
    const G = 'https://graph.global.church/g/gamenight/field-operations';
    const update = `DELETE { GRAPH <${G}> { ?s ?p ?o } } WHERE { GRAPH <${G}> { ?s ?p ?o . FILTER(STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/") && !STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/estate/") && !STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/church/") && !STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/community/")) } }`;
    const r = await fetch(`${url}/repositories/gc-public/statements`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(basic).toString('base64')}`, 'content-type': 'application/sparql-update' }, body: update });
    log(`  ${r.ok ? 'seasons removed from the graph' : `graph ${r.status}: ${(await r.text()).slice(0, 160)}`}`);
  }
}
log(`\n${DRY ? 'would retire' : 'retired'} ${retired} agents and ${DRY ? 'would remove' : 'removed'} ${removed} workspace rows; the realm stands.`);
