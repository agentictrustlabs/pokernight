/**
 * PAIR THE REALM'S WORKSPACE WITH ITS EXISTING GOVERNING ORG — the hub (owner, 2026-10-03): one organization holds
 * the members and teams; the workspace REFERENCES that org (`aporg:governedBy`). `provision:fieldops` created both
 * the org and the workspace but never wrote the governor PAIRING, so the Home cannot resolve org→workspace and a
 * member sees no workspace / holds no org→workspace read. The Home's `workspace-governor.mts` would CHARTER A NEW
 * `<label>.org` (it keys on the workspace's name, not our org), so it does not fit a realm that already split — this
 * writes the pair against the EXISTING org instead:
 *   · `workspace.governor` in the workspace agent's vault = { governedBy: <org>, coordinatedBy: <ws> }
 *   · `workspace:<ws>` (aporg:Workspace) in the organization's vault
 * Both written as the custodian (nathan), who stewards both agents — the same `/a2a/mcp/vault/set` the Home uses.
 *
 *   node scripts/pair-fieldops-workspace.mjs [--dry]
 */
import { readFileSync } from 'node:fs';
const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const DRY = process.argv.includes('--dry');
const note = JSON.parse(readFileSync(new URL('../fieldops-estate.note.json', import.meta.url), 'utf8'));
const lower = (s) => String(s).toLowerCase();
const WS = lower(note.workspace.sa);
const ORG = lower(note.organization.sa);
const CUST = note.organization.custodian; // nathan stewards both the org and the workspace
const WS_NAME = note.workspace.name || 'Field workspace';

const si = await (await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle: CUST }) })).json();
if (!si.homeSession || !si.agent) throw new Error(`demo-signin ${CUST}: ${JSON.stringify(si).slice(0, 160)}`);
const me = { sa: lower(si.agent), session: si.homeSession, headers: { 'content-type': 'application/json', authorization: `Bearer ${si.homeSession}` } };

const rows = ((await (await fetch(`${HOME}/connect/related-orgs?surface=any`, { headers: me.headers })).json()).orgs ?? []);
const stewardWire = (sa) => { const r = rows.find((x) => lower(x.orgAgent) === lower(sa) && x.stewardshipDelegation && x.relationship !== 'member'); return r?.stewardshipDelegation ?? null; };
const wsWire = stewardWire(WS);
const orgWire = stewardWire(ORG);
console.log(`custodian ${CUST} (${me.sa}) — workspace ${WS.slice(0, 12)}… steward-wire ${wsWire ? 'yes' : 'NO'}, org ${ORG.slice(0, 12)}… steward-wire ${orgWire ? 'yes' : 'NO'}`);
if (!wsWire) throw new Error(`${CUST} holds no stewardship wire over the workspace ${WS}`);
if (!orgWire) throw new Error(`${CUST} holds no stewardship wire over the organization ${ORG}`);

const vaultSet = async (delegation, recordType, data) => {
  const r = await fetch(`${HOME}/a2a/mcp/vault/set`, { method: 'POST', headers: me.headers, body: JSON.stringify({ delegation, requester: me.sa, recordType, data }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.ok === false) throw new Error(`vault set ${recordType}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return b;
};
const vaultGet = async (delegation, recordType) => { const r = await fetch(`${HOME}/a2a/mcp/vault/get`, { method: 'POST', headers: me.headers, body: JSON.stringify({ delegation, requester: me.sa, recordType }) }); const b = await r.json().catch(() => ({})); return b.data ?? null; };

const already = await vaultGet(wsWire, 'workspace.governor').catch(() => null);
if (already?.governedBy) console.log(`  workspace.governor already names ${lower(already.governedBy) === ORG ? 'our org ✓' : `a DIFFERENT org ${already.governedBy}`}`);

if (DRY) { console.log(`\n--dry: would write workspace.governor → { governedBy: ${ORG.slice(0, 12)}…, coordinatedBy: ${WS.slice(0, 12)}… } and workspace:${WS.slice(0, 10)}… on the org.`); process.exit(0); }

await vaultSet(wsWire, 'workspace.governor', { governedBy: ORG, coordinatedBy: WS });
console.log('  ✓ workspace.governor written on the workspace');
await vaultSet(orgWire, `workspace:${WS}`, { type: 'aporg:Workspace', governedBy: ORG, coordinatedBy: WS, label: WS_NAME, purpose: 'workspace-governor', createdAt: new Date().toISOString() });
console.log('  ✓ workspace:<ws> (aporg:Workspace) written on the organization');
console.log('\npaired — the organization now governs the workspace; the Home can resolve org→workspace for a member.');
