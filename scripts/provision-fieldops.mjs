/**
 * PROVISION THE FIELD OPERATIONS ESTATE — the real agents a season is played with, on faithnet (docs/FIELD-OPERATIONS.md §5).
 *
 *   set -a; . ~/engage/scripts/seed/faithnet.env; set +a          # the estate's hosts, chain and persona file
 *   node scripts/provision-fieldops.mjs [--dry] [--graph] [--relink]
 *
 * WHAT IT MAKES, every one a GAME agent and marked as one in its name and its description at the Home:
 *   1. the WORKSPACE "Northern Colorado Field — Game Night" (at:WorkspaceAgent), custodied by nathan — a realm of
 *      its own, so nothing a season writes lands in the real Northern Colorado Field; every demo person who custodies
 *      a part is on its roster, so the teams their characters found show up at their field app;
 *   2. one PARTNER-CHURCH agent per partner (Home kind `org`, purpose `field-partner`), named for the real
 *      congregation it represents and saying it is a game agent.
 *   NOT TEAMS, NOT CIRCLES, NOT CHURCHES (2026-10-02): a season founds those, and the season object charters each one
 *   as the founding character's act, the way the field app's own "Create team" / "Add a circle or church" do — one
 *   approval at the custodian's Home, signed for a demo person by the Home itself (`apps/tables/src/field-charter.ts`).
 *   Each: deploy the Smart Agent custodied by the person's EOA · bind its vault · link it in the custodian's Home ·
 *   enable its storage planes (engage's `enable-org-storage.mjs`) · write its records through the Home's library.
 *
 * It is the pattern of engage's `create-field-workspace.mjs` and `complete-faithnet-demo.mjs`, which is the only
 * headless road to a workspace agent there is; the production path is the Home's own ceremony, and this says so.
 *
 * IDEMPOTENT: every step checkpoints into `fieldops-estate.faithnet.json`; a second run skips what is done. The
 * ESTATE NOTE the Worker reads (`FIELDOPS_ESTATE`) is written to `fieldops-estate.note.json` at the end, with the
 * command that puts it in KV. Nothing here is a persona and nothing here is a key: keys are read from the persona
 * file the estate's seeds use (`FIELD_PERSONAS`), never printed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { ROOT_AUTHORITY, buildCaveat, buildVaultKeyUseCaveat, buildVaultRecordScopeCaveat, encodeAllowedTargetsTerms, encodeTimestampTerms, encodeValueTerms, hashDelegation } from '@agenticprimitives/delegation';
import { bytesToHex, encodeAbiParameters, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const A2A = process.env.A2A_BASE || 'https://a2a.faithnet.io';
const MCP = process.env.MCP_BASE || 'https://mcp.faithnet.io';
const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const ORIGIN = process.env.CSRF_ORIGIN || 'https://www.faithnet.me';
const CHAIN = Number(process.env.CHAIN_ID || 34348);
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const DEPLOYMENTS = process.env.FIELD_DEPLOYMENTS || `${process.env.HOME}/agenticprimitives/packages/contracts/deployments-faithchain.json`;
const PERSONAS = process.env.FIELD_PERSONAS || `${process.env.HOME}/engage/scripts/seed/personas.faithnet.json`;
const ENGAGE = process.env.ENGAGE_DIR || `${process.env.HOME}/engage`;
const CONTRACTS = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'));
const people = JSON.parse(readFileSync(PERSONAS, 'utf8'));
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const GRAPH = argv.includes('--graph');
const MARK = 'game';
const GAME_LINE = 'A GAME agent of Field Operations at gamenight.faithnet.io — not a real team, church or workspace. Every record it holds is a season’s, marked as such.';

// The world: teams, partners and communities as the engine knows them (compiled from the ontology and the registry).
const worldSrc = readFileSync(new URL('../packages/fieldops/src/worlds/northern-colorado.generated.ts', import.meta.url), 'utf8');
const regionJson = worldSrc.slice(worldSrc.indexOf('= {', worldSrc.indexOf('NORTHERN_COLORADO_FROM_ONTOLOGY')) + 2, worldSrc.indexOf('\nexport const NORTH_OF_DENVER'));
const seasonJson = worldSrc.slice(worldSrc.indexOf('= {', worldSrc.indexOf('NORTH_OF_DENVER_FROM_ONTOLOGY')) + 2);
/** The generated world is TypeScript object literals; `Function` reads them as data, which is what they are. */
const REGION = new Function(`return (${regionJson.replace(/;\s*$/, '')})`)();
const SEASON = new Function(`return (${seasonJson.replace(/;\s*$/, '')})`)();

const STATE_PATH = new URL('../fieldops-estate.faithnet.json', import.meta.url);
const m = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : { v: 2, note: 'Field Operations estate on faithnet — scripts/provision-fieldops.mjs (DEV estate; the production path is the Home’s ceremony).', chainId: CHAIN, workspace: {}, partners: {}, steps: {} };
m.teams ??= {}; m.pool ??= { circle: [], church: [] }; // what an older run chartered; retired by `reset:fieldops --retire-seeded`
// The cast's personas and who custodies each — every custodian is on the workspace roster.
const castNote = `${process.env.HOME}/agenticprimitives/demo/fieldops-cast.faithnet.json`;
const CAST = existsSync(castNote) ? (JSON.parse(readFileSync(castNote, 'utf8')).cast ?? []) : [];
const CUSTODIANS = [...new Set(CAST.map((c) => c.custodian))];
const save = () => writeFileSync(STATE_PATH, `${JSON.stringify(m, null, 2)}\n`);
const done = (k) => Boolean(m.steps[k]);
const mark = (k) => { m.steps[k] = true; save(); };
const log = (s) => console.log(s);

/** Who custodies what: nathan the workspace; a partner church's agent follows its corridor. */
const CUSTODY = { workspace: 'nathan', corridors: { weld: 'alice', larimer: 'bob', boulder: 'carol', plains: 'dave' } };
const WORKSPACE_NAME = 'Northern Colorado Field — Game Night';
/**
 * THE GOVERNING ORGANIZATION (2026-10-02, the owner's rule): a `.workspace` agent is a SERVICE and has no members — only
 * an organization can. So the workspace has an accompanying organization: it governs the workspace (the workspace is
 * CHARTERED UNDER it, readable as the `parent` on its link), it is what the characters are members of, and its custodian
 * stewards it. Custodied by the same person as the workspace; a game agent like everything else here.
 */
const ORGANIZATION_NAME = 'Northern Colorado Field — Game Night (organization)';

// ── plumbing (the estate seeds' own) ───────────────────────────────────────────────────────────────────
const accounts = new AgentAccountClient({ rpcUrl: process.env.RPC_URL || 'https://a2a.faithnet.io/rpc', chainId: CHAIN, entryPoint: CONTRACTS.entryPoint, factory: CONTRACTS.agentAccountFactory });
function randSalt() { const b = crypto.getRandomValues(new Uint8Array(16)); let s = 0n; for (const x of b) s = (s << 8n) | BigInt(x); return s; }
async function csrf(base) {
  const r = await fetch(`${base}/auth/csrf`, { headers: { origin: ORIGIN } });
  const setc = (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).filter(Boolean);
  const j = await r.json();
  return { token: j.token || j.csrfToken || j.csrf || '', cookie: setc.map((c) => c.split(';')[0]).join('; ') };
}
const H = (c) => ({ 'content-type': 'application/json', origin: ORIGIN, cookie: c.cookie, 'x-csrf-token': c.token });
const pkOf = (handle) => { const p = people[handle]; if (!p?.eoaPrivateKey || !p?.sa) throw new Error(`personas file lacks ${handle}`); return p.eoaPrivateKey; };

async function signIn(handle) {
  const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle }) });
  const j = await r.json().catch(() => ({}));
  if (!j.id_token) throw new Error(`demo-signin ${handle}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.id_token;
}
async function deployAgent(pk) {
  const salt = randSalt();
  const custodianEoa = privateKeyToAccount(pk).address;
  const sa = await accounts.getAddressForAgentAccount({ mode: 0, custodians: [custodianEoa], salt });
  const c = await csrf(A2A);
  const b = await fetch(`${A2A}/session/deploy`, { method: 'POST', headers: H(c), body: JSON.stringify({ custodians: [custodianEoa], salt: salt.toString() }) });
  const built = await b.json().catch(() => ({}));
  if (!built.ok || !built.userOp) throw new Error(`deploy build ${b.status}: ${JSON.stringify(built).slice(0, 240)}`);
  const signature = await privateKeyToAccount(pk).signMessage({ message: { raw: built.userOpHash } });
  const s = await fetch(`${A2A}/session/deploy/submit`, { method: 'POST', headers: H(c), body: JSON.stringify({ userOp: { ...built.userOp, signature } }) });
  const sub = await s.json().catch(() => ({}));
  if (!sub.ok || !sub.deployedAddress) throw new Error(`deploy submit ${s.status}: ${JSON.stringify(sub).slice(0, 240)}`);
  if (sub.deployedAddress.toLowerCase() !== sa.toLowerCase()) throw new Error(`address mismatch: derived ${sa}, deployed ${sub.deployedAddress}`);
  return { sa: sub.deployedAddress, salt: salt.toString(), custodianEoa };
}
async function activateVault(owner, pk) {
  let pj = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const challenge = keccak256(toBytes(['demo-mcp:vault-key-provision:v1', owner.toLowerCase(), String(issuedAt)].join('\n')));
    const proof = await privateKeyToAccount(pk).signMessage({ message: { raw: challenge } });
    const pr = await fetch(`${MCP}/custody/vault-key/provision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: owner.toLowerCase(), issuedAt, proof }) });
    pj = await pr.json().catch(() => ({}));
    if (pj.ok && pj.kmsKeyRef) break;
    if (pr.status !== 401) throw new Error(`vault provision ${pr.status}: ${JSON.stringify(pj).slice(0, 240)}`);
    if (attempt === 10) throw new Error('vault provision still 401 — custody not visible on chain');
    log(`     custody not yet visible (attempt ${attempt}) — retrying`);
    await new Promise((r) => setTimeout(r, 6000));
  }
  const si = await (await fetch(`${MCP}/custody/vault-key/server-info`)).json().catch(() => ({}));
  if (!si.serverKey) throw new Error(`server-info: ${JSON.stringify(si).slice(0, 240)}`);
  const resources = si.defaultResources ?? ['person-pii', 'org-sensitive', 'profile'];
  const ceiling = si.classificationCeiling ?? 'regulated.high';
  const ops = si.ops ?? ['read', 'write'];
  const validUntil = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const d = { delegator: owner.toLowerCase(), delegate: si.serverKey, authority: ROOT_AUTHORITY, caveats: [buildVaultKeyUseCaveat({ vaultId: 'demo-mcp', kmsKeyRef: pj.kmsKeyRef, resources, classificationCeiling: ceiling, ops, noSubdelegation: true })], salt: randSalt(), signature: '0x' };
  d.signature = await privateKeyToAccount(pk).signMessage({ message: { raw: hashDelegation(d, CHAIN, CONTRACTS.delegationManager) } });
  const br = await fetch(`${MCP}/custody/vault-key/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: owner.toLowerCase(), vaultId: 'demo-mcp', kmsKeyRef: pj.kmsKeyRef, allowedResources: resources, classificationCeiling: ceiling, ops, expiresAt: new Date(validUntil * 1000).toISOString(), authorization: { ...d, salt: d.salt.toString() } }) });
  const bj = await br.json().catch(() => ({}));
  if (!bj.ok) throw new Error(`vault bind ${br.status}: ${JSON.stringify(bj).slice(0, 240)}`);
}
const contentHashOf = (f) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [f.orgAgent, keccak256(toBytes(f.orgName)), keccak256(toBytes(f.purpose)), keccak256(toBytes(f.requestedBy))]));
const writeChallenge = (a) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [keccak256(toBytes('related-agents:write:v2')), a.person, a.orgAgent, a.contentHash, a.nonce, BigInt(a.expiry)]));
const siteCaveats = (validUntil) => [buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)), buildCaveat(CONTRACTS.allowedTargetsEnforcer, encodeAllowedTargetsTerms([CONTRACTS.agentRelationship, CONTRACTS.agentNameRegistry, CONTRACTS.permissionlessSubregistry]))];
/** MEMBERSHIP: org → member, a record-scope wire with NO targets — member access, never mistakable for stewardship. It is
 *  what the Home's roster and trust graph read a member from; a member link carrying a stewardship wire shows nobody. */
function signMembershipBy(pk, orgSa, delegateSa) {
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const d = { delegator: orgSa.toLowerCase(), delegate: delegateSa.toLowerCase(), authority: ROOT_AUTHORITY, caveats: [
    buildVaultRecordScopeCaveat([{ server: 'demo-mcp', resources: ['vault:content.*', 'vault:member.profile:*', 'vault:org.membership:*'], ops: ['read'] }]),
    buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
  ], salt: randSalt(), signature: '0x' };
  return privateKeyToAccount(pk).signMessage({ message: { raw: hashDelegation(d, CHAIN, CONTRACTS.delegationManager) } }).then((signature) => ({ ...d, signature, salt: d.salt.toString() }));
}
function signStewardshipBy(pk, orgSa, delegateSa) {
  const d = { delegator: orgSa, delegate: delegateSa, authority: ROOT_AUTHORITY, caveats: siteCaveats(Math.floor(Date.now() / 1000) + 365 * 24 * 3600), salt: randSalt(), signature: '0x' };
  return privateKeyToAccount(pk).signMessage({ message: { raw: hashDelegation(d, CHAIN, CONTRACTS.delegationManager) } }).then((signature) => ({ ...d, signature, salt: d.salt.toString() }));
}
/** The ACCESS half: a person-signed link in their Home, carrying the custodian-signed stewardship stash. */
async function linkAt(handle, org) {
  const person = people[handle];
  const fields = { orgAgent: org.sa, orgName: org.orgName, purpose: org.purpose, requestedBy: CLIENT_ID };
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const sig = await privateKeyToAccount(person.eoaPrivateKey).signMessage({ message: { raw: writeChallenge({ person: person.sa, orgAgent: org.sa, contentHash: contentHashOf(fields), nonce, expiry }) } });
  const wire = org.relationship === 'member' ? { membershipDelegation: await signMembershipBy(org.custodianPk, org.sa, person.sa) } : { stewardshipDelegation: await signStewardshipBy(org.custodianPk, org.sa, person.sa) };
  // WHERE IT HANGS in the person's tree: a partner church under the workspace, so the workspace's trust graph holds it.
  const r = await fetch(`${HOME}/connect/related-orgs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: person.sa, ...fields, sig, nonce, expiry, kind: org.kind, parent: org.under ?? person.sa, relationship: org.relationship, displayName: person.name, ...wire }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`related-orgs ${handle} → ${org.orgName} ${r.status}: ${JSON.stringify(j).slice(0, 240)}`);
}
/** The delivery + interactions planes, through engage's own script, in engage's own environment. */
function enableStorage(sa, handle) {
  const env = { ...process.env };
  const secrets = `${process.env.HOME}/.faithnet-worker-secrets.env`;
  if (existsSync(secrets)) for (const line of readFileSync(secrets, 'utf8').split('\n')) { const mm = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (mm && !env[mm[1]]) env[mm[1]] = mm[2].replace(/^"|"$/g, ''); }
  const r = spawnSync(process.execPath, [`${ENGAGE}/scripts/seed/enable-org-storage.mjs`, '--org', sa, '--custodian', handle], { stdio: 'inherit', cwd: ENGAGE, env });
  if (r.status !== 0) throw new Error('enable-org-storage failed — the library stays 503 until both grants land');
}
function artifactId(folder, name) { let h = 0x811c9dc5; const key = `${folder}/${name}`; for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return `${folder.replace(/\W+/g, '-').slice(0, 32) || 'x'}-none-${h.toString(36)}`; }
async function saveRecords(handle, org, records) {
  const token = await signIn(handle);
  const artifacts = records.map(({ folder, record }) => ({ id: artifactId(folder, `${record.id}.json`), folder, name: `${record.id}.json`, kind: 'json-ld', bytesB64: Buffer.from(JSON.stringify(record, null, 2), 'utf8').toString('base64') }));
  const r = await fetch(`${HOME}/connect/library`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ org, action: 'save-batch', artifacts }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`library ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
}
const now = () => new Date().toISOString();
const envelope = (sensitivity, purpose) => ({ sensitivity, precision: null, recurringPattern: false, purpose: `${purpose} — Field Operations (${MARK})` });

/** One agent, end to end: deploy · vault · links · storage. Checkpointed per step under `key`. */
async function charter(key, { name, custodian, kind, purpose, members = [], under = null }) {
  const rec = m[key.split(':')[0]] ?? null;
  const slot = key.includes(':') ? (m[key.split(':')[0]][key.split(':')[1]] ??= {}) : (m[key] ??= {});
  const pk = pkOf(custodian);
  if (!done(`${key}:deploy`)) {
    if (DRY) { log(`  · would deploy "${name}" custodied by ${custodian}`); return slot; }
    const r = await deployAgent(pk);
    Object.assign(slot, { name, kind, purpose, custodian, ...r });
    mark(`${key}:deploy`); log(`  ✓ ${name} → ${r.sa}`);
  } else log(`  skip ${key}:deploy (${slot.sa})`);
  if (DRY) return slot;
  if (!done(`${key}:vault`)) { await activateVault(slot.sa, pk); mark(`${key}:vault`); log('     vault bound'); }
  for (const h of [custodian, ...members]) {
    // `--relink` redoes every link (a member seeded with a stewardship wire gets a membership one; the roster reads it).
    if (done(`${key}:link:${h}`) && !argv.includes('--relink')) continue;
    await linkAt(h, { sa: slot.sa, orgName: name, purpose, kind, relationship: h === custodian ? 'steward' : 'member', custodianPk: pk, under });
    mark(`${key}:link:${h}`); log(`     Home link ${h}${h === custodian ? ' (steward)' : ''}`);
  }
  if (!done(`${key}:storage`)) { enableStorage(slot.sa, custodian); mark(`${key}:storage`); log('     storage enabled'); }
  void rec;
  return slot;
}

// ── 0. the organization that governs the workspace ──────────────────────────────────────────────────────
log(`\n═══ the organization ═══`);
const org = await charter('organization', { name: ORGANIZATION_NAME, custodian: CUSTODY.workspace, kind: 'org', purpose: 'field-organization', members: [] });

// ── 1. the workspace, chartered under it ────────────────────────────────────────────────────────────────
// Nobody is a MEMBER of the workspace (it is a service); the custodians are not linked to it either — they see the
// field as their characters, who are members of the organization. Its link hangs under the organization.
log(`\n═══ the workspace ═══`);
const ws = await charter('workspace', { name: WORKSPACE_NAME, custodian: CUSTODY.workspace, kind: 'workspace', purpose: 'field-workspace', members: [], under: org.sa });

// ── 2. the partner-church agents ───────────────────────────────────────────────────────────────────────
log(`\n═══ the partner churches’ agents ═══`);
for (const p of REGION.partners) {
  const custodian = CUSTODY.corridors[p.corridor] ?? 'alice';
  await charter(`partners:${p.id}`, { name: `${p.name} (${MARK} agent)`, custodian, kind: 'org', purpose: 'field-partner', members: [CUSTODY.workspace].filter((h) => h !== custodian), under: ws.sa });
}

// ── 5. the records: what the field app reads ───────────────────────────────────────────────────────────
if (!DRY) {
  log(`\n═══ the records ═══`);
  const t = now();
  const wsSa = m.workspace.sa;
  const wsRecords = [
    { folder: 'field/workspace', record: { kind: 'ws-profile', id: 'profile', title: WORKSPACE_NAME, updatedAt: t, envelope: envelope('L1', 'workspace profile'), workspace: wsSa, focus: `GAME WORKSPACE for Field Operations at gamenight.faithnet.io. Seasons of field work among the public registry’s people communities north of Denver, played by real agents: the characters found the teams, take the communities up and begin the circles and churches, each a real agent chartered as their act. Every team, body and record here is a game’s; nothing in it is a real team, church or assessment. ${GAME_LINE}` } },
    { folder: 'field/workspace-members', record: { kind: 'ws-membership', id: `mem-${people[CUSTODY.workspace].sa.toLowerCase()}`, title: 'custodian', updatedAt: t, envelope: envelope('L2', 'workspace roster'), workspace: wsSa, person: people[CUSTODY.workspace].sa.toLowerCase(), role: 'custodian', status: 'active', joinedAt: t } },
    // THE ROSTER IS THE ORGANIZATION'S, PROJECTED: the field app reads `ws-membership` rows from the workspace, but a
    // workspace has no members — these rows say who belongs to the organization that governs it: the CHARACTERS.
    // `invited` until each one's own join lands at the organization (`admit:fieldops` says which did).
    ...CAST.map((c) => ({ folder: 'field/workspace-members', record: { kind: 'ws-membership', id: `mem-${c.sa.toLowerCase()}`, title: c.name, updatedAt: t, envelope: envelope('L2', 'workspace roster'), workspace: wsSa, person: c.sa.toLowerCase(), role: 'member', status: 'invited', joinedAt: t, organization: m.organization?.sa ?? null } })),
    ...REGION.partners.map((p) => ({ folder: 'field/workspace-agents', record: { kind: 'ws-agent', id: `agent-${m.partners[p.id].sa.toLowerCase()}`, title: `${p.name} (${MARK} agent)`, updatedAt: t, envelope: envelope('L1', 'workspace directory'), workspace: wsSa, agent: m.partners[p.id].sa.toLowerCase(), agentKind: 'org', name: null, displayName: `${p.name} (${MARK} agent)`, description: `GAME agent representing ${p.name}, ${REGION.towns.find((x) => x.id === p.town)?.name ?? p.town}${p.website ? ` (${p.website})` : ''}, as a partner church in Field Operations. The congregation is real and cited to the church directory; this agent is a game’s and holds none of its authority.`, avatar: null, source: 'steward', entitlement: null, refreshedAt: t } })),
  ];
  // Always rewritten: deterministic ids make a re-run an update, and the rows change when the world does.
  await saveRecords(CUSTODY.workspace, wsSa, wsRecords); mark('records:workspace'); log(`  ✓ workspace: ${wsRecords.length} records`);
  for (const p of REGION.partners) {
    if (done(`records:partner:${p.id}`)) continue;
    const custodian = CUSTODY.corridors[p.corridor] ?? 'alice';
    await saveRecords(custodian, m.partners[p.id].sa, [{ folder: 'field/body', record: { kind: 'body-profile', id: 'profile', title: `${p.name} (${MARK} agent)`, updatedAt: t, envelope: envelope('L1', 'partner profile'), body: m.partners[p.id].sa, bodyType: 'church', description: `GAME agent representing ${p.name} in Field Operations. ${GAME_LINE}` } }]);
    mark(`records:partner:${p.id}`); log(`  ✓ ${p.name}: profile`);
  }
}

// ── 6. the estate note the Worker reads ────────────────────────────────────────────────────────────────
const note = {
  home: HOME, clientId: CLIENT_ID, chainId: CHAIN, mark: MARK,
  // THE DOORS the season's charters knock on, as the character's act: where agents deploy, where vaults bind, which
  // service agents an org's storage is granted to (engage's own values, read from its environment).
  a2a: A2A, mcp: MCP, origin: ORIGIN,
  deliveryServiceSa: process.env.DELIVERY_SERVICE_SA || '0x0AF2455e3f76594E81d9042aD5FE22A5A35dc57f',
  interactionsServiceSa: process.env.INTERACTIONS_SERVICE_SA || '0x39508624387fed3b9d6dd15ba86d3ace8a3f0a6a',
  organization: { sa: m.organization?.sa, custodian: CUSTODY.workspace, name: ORGANIZATION_NAME },
  workspace: { sa: m.workspace.sa, custodian: CUSTODY.workspace, name: WORKSPACE_NAME },
  partners: Object.fromEntries(REGION.partners.map((p) => [p.id, { sa: m.partners[p.id]?.sa, custodian: CUSTODY.corridors[p.corridor] ?? 'alice', name: `${p.name} (${MARK} agent)` }])),
  workers: Object.fromEntries(CAST.map((c) => [c.role, { sa: c.sa, custodian: c.custodian, name: c.name }])),
};
writeFileSync(new URL('../fieldops-estate.note.json', import.meta.url), `${JSON.stringify(note, null, 2)}\n`);
log(`\nestate note written to fieldops-estate.note.json${DRY ? ' (dry: addresses missing)' : ''}`);
log(`put it where the Worker reads it (KV, REMOTE — never the local simulator):`);
log(`  cd apps/tables && pnpm exec wrangler kv key put --env faithnet --binding CLUB_WIRES --remote fieldops-estate "$(cat ../../fieldops-estate.note.json)"`);

// ── SPEC 424: THE WORKSPACE REFERENCES ITS ORG, AND A MEMBER READS IT THROUGH THE GOVERNOR ──────────────────
// Set these relationships AT PROVISION, so a fresh/cleared realm comes up fully wired — not a retrofit. The org
// is already created and stewards the workspace; this writes the governor PAIRING (workspace.governor +
// workspace:<ws>), then mints the content-only ws→org READ grant and the serving-plane projection every member's
// /connect/related-orgs synthesises from (the Home's own canonical builder — buildApprovedOrgReadDelegation over
// WORKSPACE_CONTENT_SCOPE, approved on chain as the workspace). After this a member of the org sees and reads the
// governed workspace (spec 424 W1); the field runtime (W2) chains their org membership onto the grant.
if (!DRY && m.organization?.sa && m.workspace?.sa && !m.steps['pair-424']) {
  const AP_HOME = process.env.AP_HOME_DIR || `${process.env.HOME}/agenticprimitives`;
  const ROOT = new URL('..', import.meta.url).pathname;
  const envp = { ...process.env, HOME_ORIGIN: HOME, HOME_URL: HOME };
  log('\n── spec 424: pairing the workspace with its org, and minting the member read grant ──');
  const p1 = spawnSync(process.execPath, ['scripts/pair-fieldops-workspace.mjs'], { stdio: 'inherit', cwd: ROOT, env: envp });
  if (p1.status !== 0) throw new Error('424: the governor pairing failed');
  const p2 = spawnSync('npx', ['tsx', `${AP_HOME}/scripts/backfill-424-governed-workspace.mts`, CUSTODY.workspace, m.organization.sa, m.workspace.sa, WORKSPACE_NAME], { stdio: 'inherit', cwd: AP_HOME, env: envp });
  if (p2.status !== 0) throw new Error(`424: the ws→org read grant / projection failed (is ${AP_HOME} present?)`);
  mark('pair-424');
  log('  ✓ paired + member read grant minted — a member of the org now sees and reads the governed workspace');
} else if (!DRY && m.steps['pair-424']) log('spec 424: workspace already paired + member read grant minted (skipping)');

// ── 7. the game's graph: the static part ──────────────────────────────────────────────────────────────
if (GRAPH && !DRY) {
  const envFile = new URL('../.graphdb.env', import.meta.url);
  if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split('\n')) { const mm = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2]; }
  const url = process.env.GRAPHDB_URL ?? 'https://graphdb.agentkg.io'; const basic = process.env.GRAPHDB_BASIC;
  if (!basic) throw new Error('GRAPHDB_BASIC is needed for --graph');
  const FO = 'https://skills.demo/fieldops#'; const G = 'https://graph.global.church/g/gamenight/field-operations';
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const L = [];
  L.push(`<https://gamenight.faithnet.io/fieldops/estate/workspace> a <${FO}FieldWorkspace> , <${FO}GameAgent> ; <${FO}isGame> true ; <http://www.w3.org/2000/01/rdf-schema#label> "${esc(WORKSPACE_NAME)}" ; <https://agentictrustlabs.dev/ns/agentic-trust#agentAddress> "${m.workspace.sa}" .`);
  for (const p of REGION.partners) {
    L.push(`<https://gamenight.faithnet.io/fieldops/estate/partner/${p.id}> a <${FO}PartnerChurchAgent> , <${FO}GameAgent> ; <${FO}isGame> true ; <http://www.w3.org/2000/01/rdf-schema#label> "${esc(p.name)} (game agent)" ; <https://agentictrustlabs.dev/ns/agentic-trust#agentAddress> "${m.partners[p.id].sa}" ; <${FO}representsChurch> <https://gamenight.faithnet.io/fieldops/church/${p.id}> .`);
    L.push(`<https://gamenight.faithnet.io/fieldops/church/${p.id}> a <${FO}PartnerChurch> , <https://ontology.global.church/core#EkklesiaCommunity> ; <http://www.w3.org/2000/01/rdf-schema#label> "${esc(p.name)}" ${p.website ? `; <${FO}website> <${p.website}> ` : ''}${p.directoryId ? `; <${FO}directoryId> "${p.directoryId}" ` : ''}${p.address ? `; <${FO}address> "${esc(p.address)}" ` : ''}; <${FO}lat> ${p.lat} ; <${FO}lng> ${p.lng} .`);
  }
  for (const c of REGION.communities) L.push(`<https://gamenight.faithnet.io/fieldops/community/${c.id}> a <${FO}FieldCommunity> ; <${FO}registryCommunity> <${c.iri}> ; <http://www.w3.org/2000/01/rdf-schema#label> "${esc(c.name)} (game copy)" ; <${FO}isSimulated> true .`);
  const update = `DELETE { GRAPH <${G}> { ?s ?p ?o } } WHERE { GRAPH <${G}> { ?s ?p ?o . FILTER(STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/estate/") || STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/church/") || STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/community/")) } };\nINSERT DATA { GRAPH <${G}> {\n${L.join('\n')}\n} }`;
  const r = await fetch(`${url}/repositories/gc-public/statements`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(basic).toString('base64')}`, 'content-type': 'application/sparql-update' }, body: update });
  if (!r.ok) throw new Error(`graph ${r.status}: ${(await r.text()).slice(0, 300)}`);
  log(`✓ the estate is in <${G}>: workspace, ${REGION.partners.length} partner churches and their agents, ${REGION.communities.length} community copies`);
}
log('\ndone');
