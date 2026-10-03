/**
 * Clean the GAME's accumulated organizations off the demo users' Homes.
 *
 * Seasons charter a team, circle and church per act, and every `--restart` leaves the last season's agents behind —
 * so over time each character persona and each custodian collects memberships in dozens of teams and circles nobody
 * plays any more, and the demo person's Home lists them all. This sweep reads every estate person's own links
 * (`/connect/related-orgs?for=<sa>`, as the custodian) and lets go of each one (`remove: true`, the exact stored
 * fields from the read so the write challenge matches) EXCEPT the realm it should keep: the organization, the
 * workspace, the partner churches, and — unless `--all` — the current season's chartered agents (the KV ledger).
 *
 *   node scripts/cleanup-fieldops-homes.mjs [--dry] [--all]
 *     --dry   list what would be let go, change nothing
 *     --all   also let go of the current season's teams/circles/churches (a full wipe; the realm still stands)
 *
 * The agents themselves live on chain and are not deleted — they are simply nobody's any more, and leave the lists.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { keccak256, encodeAbiParameters, toBytes, bytesToHex, recoverMessageAddress } from 'viem';

const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--all');
const lower = (s) => String(s).toLowerCase();
const log = (s) => console.log(s);
const note = JSON.parse(readFileSync(new URL('../fieldops-estate.note.json', import.meta.url), 'utf8'));
const TABLES = new URL('../apps/tables', import.meta.url).pathname;

const signers = new Map();
async function signerFor(handle) {
  if (!signers.has(handle)) {
    const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle }) });
    const j = await r.json().catch(() => ({}));
    if (!j.homeSession || !j.agent) throw new Error(`demo-signin ${handle}: ${JSON.stringify(j).slice(0, 160)}`);
    const sign = async (digest) => {
      const s = await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${j.homeSession}` }, body: JSON.stringify({ digest }) });
      const b = await s.json().catch(() => ({}));
      if (!b.ok || !b.signature) throw new Error(`persona-sign ${handle}: ${b.error ?? s.status}`);
      return b.signature;
    };
    const probe = `0x${'11'.repeat(32)}`;
    await recoverMessageAddress({ message: { raw: probe }, signature: await sign(probe) });
    signers.set(handle, { handle, sa: lower(j.agent), homeSession: j.homeSession, sign });
  }
  return signers.get(handle);
}
const contentHashOf = (f) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [f.orgAgent, keccak256(toBytes(f.orgName)), keccak256(toBytes(f.purpose)), keccak256(toBytes(f.requestedBy))]));
const writeChallenge = (a) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [keccak256(toBytes('related-agents:write:v2')), a.person, a.orgAgent, a.contentHash, a.nonce, BigInt(a.expiry)]));

/** Let go of one person's link to an org, using the EXACT fields the Home stored for it. */
async function removeLink(custodian, personSa, o) {
  const signer = await signerFor(custodian);
  const fields = { orgAgent: lower(o.orgAgent), orgName: o.orgName ?? lower(o.orgAgent), purpose: o.purpose ?? 'org membership', requestedBy: o.requestedBy ?? 'home-invite' };
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const sig = await signer.sign(writeChallenge({ person: lower(personSa), orgAgent: fields.orgAgent, contentHash: contentHashOf(fields), nonce, expiry }));
  const r = await fetch(`${HOME}/connect/related-orgs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: lower(personSa), ...fields, sig, nonce, expiry, relationship: 'member', parent: lower(personSa), remove: true }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 140)}`);
}

// The realm to KEEP: the organization, the workspace, the partner churches — and, unless --all, the current season.
const keep = new Set([lower(note.organization.sa), lower(note.workspace.sa), ...Object.values(note.partners).map((p) => lower(p.sa))]);
if (!ALL) {
  try {
    const led = JSON.parse(execSync(`cd ${TABLES} && pnpm exec wrangler kv key get --binding CLUB_WIRES --env faithnet --remote fieldops-chartered 2>/dev/null`, { encoding: 'utf8' }) || '[]');
    for (const e of led) keep.add(lower(e.sa));
    log(`keeping the realm and the current season (${led.length} chartered agents); use --all to clean those too`);
  } catch { log('could not read the season ledger; keeping only the realm'); }
} else log('--all: cleaning the current season too; only the realm (org, workspace, partners) stays');

// Everyone whose Home holds game links: every character persona, and every custodian person.
const people = [];
for (const [role, w] of Object.entries(note.workers)) people.push({ label: `${w.name} (${role})`, sa: lower(w.sa), custodian: w.custodian });
for (const h of [...new Set(Object.values(note.workers).map((w) => w.custodian)), note.organization.custodian]) {
  const s = await signerFor(h); people.push({ label: `${h}.me (person)`, sa: s.sa, custodian: h });
}

let removed = 0, kept = 0, failed = 0;
for (const p of people) {
  const signer = await signerFor(p.custodian);
  const ro = await (await fetch(`${HOME}/connect/related-orgs?for=${p.sa}`, { headers: { authorization: `Bearer ${signer.homeSession}` } })).json().catch(() => ({ orgs: [] }));
  const links = ro.orgs ?? [];
  const toGo = links.filter((o) => !keep.has(lower(o.orgAgent)));
  if (!toGo.length) { log(`  ${p.label}: ${links.length} links, all kept`); continue; }
  log(`  ${p.label}: ${links.length} links, letting go of ${toGo.length}`);
  for (const o of toGo) {
    const name = o.orgName && !/^0x/.test(o.orgName) ? o.orgName : lower(o.orgAgent).slice(0, 12) + '…';
    if (DRY) { log(`      · would let go: ${name} (${o.purpose ?? '?'})`); kept += 0; removed += 1; continue; }
    try { await removeLink(p.custodian, p.sa, o); removed += 1; log(`      · let go: ${name}`); }
    catch (e) { failed += 1; log(`      ! ${name}: ${e.message}`); }
  }
}
log(`\n${DRY ? 'would let go of' : 'let go of'} ${removed} links${failed ? `, ${failed} failed` : ''}; the realm stands.`);
