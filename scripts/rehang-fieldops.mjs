/**
 * RE-HANG what the seasons chartered to the HUB shape in every person's tree — the Home draws an organization's trust
 * graph from the `parent` on each link, and the org is the hub (2026-10-03): a team hangs under the GOVERNING ORG,
 * never the workspace (`org → { members, teams, workspace }`, not `org → workspace → teams`). Reads KV
 * `fieldops-chartered` (every agent any season chartered) and re-links each one: the custodian as steward, the
 * workspace's custodian and the viewers as members, all `under` the org (a team) or its team (a body; the org too
 * when the ledger does not name that team). Idempotent: a link is replaced, never doubled.
 *
 *   set -a; . ~/engage/scripts/seed/faithnet.env; set +a
 *   node scripts/rehang-fieldops.mjs [--dry]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { bytesToHex, encodeAbiParameters, keccak256, recoverMessageAddress, toBytes } from 'viem';
import { ROOT_AUTHORITY, buildCaveat, buildVaultRecordScopeCaveat, encodeAllowedTargetsTerms, encodeTimestampTerms, encodeValueTerms, hashDelegation } from '@agenticprimitives/delegation';

const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const CHAIN = Number(process.env.CHAIN_ID || 34348);
const CONTRACTS = JSON.parse(readFileSync(process.env.FIELD_DEPLOYMENTS || `${process.env.HOME}/agenticprimitives/packages/contracts/deployments-faithchain.json`, 'utf8'));
const DRY = process.argv.includes('--dry');
const note = JSON.parse(readFileSync(new URL('../fieldops-estate.note.json', import.meta.url), 'utf8'));
const TABLES = new URL('../apps/tables', import.meta.url).pathname;
const log = (s) => console.log(s);

const signers = new Map();
async function signerFor(handle) {
  if (!signers.has(handle)) {
    const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle }) });
    const j = await r.json().catch(() => ({}));
    if (!j.homeSession || !j.agent) throw new Error(`demo-signin ${handle}: ${JSON.stringify(j).slice(0, 160)}`);
    const sign = async (digest) => { const s = await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${j.homeSession}` }, body: JSON.stringify({ digest }) }); const b = await s.json().catch(() => ({})); if (!b.ok || !b.signature) throw new Error(`persona-sign ${handle}: ${b.error ?? s.status}`); return b.signature; };
    const probe = `0x${'11'.repeat(32)}`;
    signers.set(handle, { handle, sa: j.agent.toLowerCase(), eoa: await recoverMessageAddress({ message: { raw: probe }, signature: await sign(probe) }), sign });
  }
  return signers.get(handle);
}
const randSalt = () => { const b = crypto.getRandomValues(new Uint8Array(16)); let s = 0n; for (const x of b) s = (s << 8n) | BigInt(x); return s; };
const contentHashOf = (f) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [f.orgAgent, keccak256(toBytes(f.orgName)), keccak256(toBytes(f.purpose)), keccak256(toBytes(f.requestedBy))]));
const writeChallenge = (a) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [keccak256(toBytes('related-agents:write:v2')), a.person, a.orgAgent, a.contentHash, a.nonce, BigInt(a.expiry)]));
const purposeOf = (kind) => (kind === 'team' ? 'field-team' : kind === 'circle' ? 'field-circle' : 'field-church');
const siteCaveats = (validUntil) => [buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)), buildCaveat(CONTRACTS.allowedTargetsEnforcer, encodeAllowedTargetsTerms([CONTRACTS.agentRelationship, CONTRACTS.agentNameRegistry, CONTRACTS.permissionlessSubregistry]))];
async function wire(orgSigner, orgSa, toSa, relationship) {
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const d = relationship === 'steward'
    ? { delegator: orgSa.toLowerCase(), delegate: toSa.toLowerCase(), authority: ROOT_AUTHORITY, caveats: siteCaveats(validUntil), salt: randSalt(), signature: '0x' }
    : { delegator: orgSa.toLowerCase(), delegate: toSa.toLowerCase(), authority: ROOT_AUTHORITY, caveats: [buildVaultRecordScopeCaveat([{ server: 'demo-mcp', resources: ['vault:content.*', 'vault:member.profile:*', 'vault:org.membership:*'], ops: ['read'] }]), buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n))], salt: randSalt(), signature: '0x' };
  d.signature = await orgSigner.sign(hashDelegation(d, CHAIN, CONTRACTS.delegationManager));
  return { ...d, salt: d.salt.toString() };
}
async function linkAt(orgSigner, org, who, under) {
  const fields = { orgAgent: org.sa, orgName: org.name, purpose: purposeOf(org.kind), requestedBy: CLIENT_ID };
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32))); const expiry = Math.floor(Date.now() / 1000) + 600;
  const person = who.sa.toLowerCase();
  const sig = await who.signer.sign(writeChallenge({ person, orgAgent: org.sa, contentHash: contentHashOf(fields), nonce, expiry }));
  const w = who.relationship === 'steward' ? { stewardshipDelegation: await wire(orgSigner, org.sa, person, 'steward') } : { membershipDelegation: await wire(orgSigner, org.sa, person, 'member') };
  const r = await fetch(`${HOME}/connect/related-orgs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person, ...fields, sig, nonce, expiry, kind: org.kind, parent: (under ?? person).toLowerCase(), relationship: who.relationship, displayName: who.name, ...w }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${who.name} → ${org.name}: ${r.status} ${JSON.stringify(j).slice(0, 140)}`);
}
const kv = spawnSync('pnpm', ['exec', 'wrangler', 'kv', 'key', 'get', 'fieldops-chartered', '--env', 'faithnet', '--binding', 'CLUB_WIRES', '--remote'], { cwd: TABLES, encoding: 'utf8' });
const chartered = kv.status === 0 ? JSON.parse(kv.stdout.trim() || '[]') : [];
log(`${chartered.length} chartered agents in the ledger`);
const teams = chartered.filter((c) => c.kind === 'team');
for (const c of chartered) {
  // THE ORG IS THE HUB (2026-10-03): a team hangs under the GOVERNING ORG, not the workspace; a body under its team.
  const hub = note.organization?.sa ?? note.workspace.sa;
  const under = c.kind === 'team' ? hub : (teams.find((t) => t.stagingId === c.stagingId && t.custodian === c.custodian)?.sa ?? hub);
  const who = [{ handle: c.custodian, relationship: 'steward' }, ...[...new Set([note.workspace.custodian, ...(c.viewers ?? [])])].filter((h) => h !== c.custodian).map((h) => ({ handle: h, relationship: 'member' }))];
  log(`${c.name} (${c.kind}, ${String(c.sa).slice(0, 10)}…) under ${under === (note.organization?.sa ?? note.workspace.sa) ? 'the organization' : `team ${under.slice(0, 10)}…`}: ${who.map((w) => `${w.handle} ${w.relationship}`).join(', ')}`);
  if (DRY) continue;
  const orgSigner = await signerFor(c.custodian);
  for (const w of who) { try { const s = await signerFor(w.handle); await linkAt(orgSigner, { sa: c.sa, name: c.name, kind: c.kind }, { sa: s.sa, name: w.handle, signer: s, relationship: w.relationship }, under); } catch (e) { log(`  ! ${e.message}`); } }
}
log('done');
