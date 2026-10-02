/**
 * THE REALM'S PEOPLE JOIN IT THE HOME'S WAY — the same three records the seasons' charters write, for the workspace
 * and the partner churches the operator chartered: an invitation (the organization's steward, with the access grant and
 * the organization's signed half of the has-member credential), the person's OWN join (their consent, which the Home
 * writes to their link, the roster index and the organization's `org.membership:member:<sa>` record), and the
 * countersigned credential (one copy in each vault). The workspace's custodian gets a steward-of credential too; so does
 * each partner church's custodian for its agent. A link alone leaves the Home's members page saying "join this
 * community first"; this is what makes a person a member there.
 *
 *   set -a; . ~/engage/scripts/seed/faithnet.env; set +a
 *   node scripts/admit-fieldops-realm.mjs [--dry]
 *
 * Idempotent in effect: a repeated join updates the same row; a repeated credential is a second record, so a run that
 * finished is not repeated by hand. Signs through the Home for each demo custodian (`persona-sign`); holds no key.
 */
import { readFileSync } from 'node:fs';
import { bytesToHex, keccak256, recoverMessageAddress, stringToBytes } from 'viem';
import { canonicalizeJson, jcsCanonicalize } from '@agenticprimitives/types';
import { ROOT_AUTHORITY, buildCaveat, buildSessionDelegation, buildVaultRecordScopeCaveat, encodeAllowedMethodsTerms, encodeAllowedTargetsTerms, encodeTimestampTerms, encodeValueTerms, hashDelegation } from '@agenticprimitives/delegation';
import { skillSelector } from '@agenticprimitives/a2a';

const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const A2A = process.env.A2A_BASE || 'https://a2a.faithnet.io';
const ORIGIN = process.env.CSRF_ORIGIN || 'https://www.faithnet.me';
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const CHAIN = Number(process.env.CHAIN_ID || 34348);
const CONTRACTS = JSON.parse(readFileSync(process.env.FIELD_DEPLOYMENTS || `${process.env.HOME}/agenticprimitives/packages/contracts/deployments-faithchain.json`, 'utf8'));
const DRY = process.argv.includes('--dry');
const note = JSON.parse(readFileSync(new URL('../fieldops-estate.note.json', import.meta.url), 'utf8'));
const log = (s) => console.log(s);
const lower = (s) => String(s).toLowerCase();

const signers = new Map();
async function signerFor(handle) {
  if (!signers.has(handle)) {
    const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle }) });
    const j = await r.json().catch(() => ({}));
    if (!j.homeSession || !j.agent) throw new Error(`demo-signin ${handle}: ${JSON.stringify(j).slice(0, 160)}`);
    const sign = async (digest) => { const s = await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${j.homeSession}` }, body: JSON.stringify({ digest }) }); const b = await s.json().catch(() => ({})); if (!b.ok || !b.signature) throw new Error(`persona-sign ${handle}: ${b.error ?? s.status}`); return b.signature; };
    const probe = `0x${'11'.repeat(32)}`;
    signers.set(handle, { handle, sa: lower(j.agent), eoa: await recoverMessageAddress({ message: { raw: probe }, signature: await sign(probe) }), sign, homeSession: j.homeSession });
  }
  return signers.get(handle);
}
const randSalt = () => { const b = crypto.getRandomValues(new Uint8Array(16)); let s = 0n; for (const x of b) s = (s << 8n) | BigInt(x); return s; };
const wireOut = (d) => ({ ...d, salt: d.salt.toString() });
async function memberAccess(orgSigner, orgSa, memberSa) {
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const d = { delegator: lower(orgSa), delegate: lower(memberSa), authority: ROOT_AUTHORITY, caveats: [buildVaultRecordScopeCaveat([{ server: 'demo-mcp', resources: ['vault:content.*', 'vault:member.profile:*', 'vault:org.membership:*'], ops: ['read'] }]), buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n))], salt: randSalt(), signature: '0x' };
  d.signature = await orgSigner.sign(hashDelegation(d, CHAIN, CONTRACTS.delegationManager));
  return wireOut(d);
}
async function consent(memberSigner, memberSa, orgSa) {
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const d = { delegator: lower(memberSa), delegate: lower(orgSa), authority: ROOT_AUTHORITY, caveats: [buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)), buildVaultRecordScopeCaveat([{ server: 'demo-mcp', resources: ['vault:directory.data', 'vault:conversation.index'], ops: ['read'] }])], salt: randSalt(), signature: '0x' };
  d.signature = await memberSigner.sign(hashDelegation(d, CHAIN, CONTRACTS.delegationManager));
  return wireOut(d);
}
const digestOf = (v) => keccak256(stringToBytes(jcsCanonicalize(v)));
const ZERO = `0x${'00'.repeat(32)}`;
async function offer(orgSigner, kind, subject, object, terms) {
  const body = { type: 'ap.relationship-credential.v1', kind, subject: lower(subject), object: lower(object), chainId: CHAIN, issuedAt: new Date().toISOString(), termsDigest: Object.keys(terms).length ? digestOf(terms) : ZERO };
  const digest = digestOf({ type: body.type, kind, subject: body.subject, object: body.object, chainId: CHAIN, issuedAt: body.issuedAt, termsDigest: body.termsDigest });
  return { ...body, terms, digest, signatures: { object: await orgSigner.sign(digest) } };
}
async function csrf() {
  const r = await fetch(`${A2A}/auth/csrf`, { headers: { origin: ORIGIN } });
  const setc = (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).filter(Boolean);
  const j = await r.json();
  return { token: j.token || j.csrfToken || j.csrf || '', cookie: setc.map((c) => c.split(';')[0]).join('; ') };
}
async function accept(session, off, subjectSignature) {
  const c = await csrf();
  const r = await fetch(`${A2A}/relationships/credential/accept`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: c.cookie, 'x-csrf-token': c.token }, body: JSON.stringify({ session, offer: off, subjectSignature }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`credential ${off.kind}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j.digest;
}
/** The member's signed listing in the organization's directory — what a member's view of the roster is made of. */
async function publishListing(memberSigner, member, org, access, orgRole, session) {
  const now = Date.now(); const subject = `eip155:${CHAIN}:${lower(member.sa)}`;
  const draft = { type: 'ap.home.directory-listing.v1', subject, context: { kind: 'community', id: lower(org.sa), label: org.name }, displayName: member.name, visibility: 'community', orgRole, publishedAt: new Date(now).toISOString(), expiresAt: new Date(now + 180 * 86_400_000).toISOString() };
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalizeJson(draft)));
  const digest = `0x${Array.from(new Uint8Array(digestBytes)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const listing = { ...draft, proof: { signer: subject, scheme: 'erc1271', signature: await memberSigner.sign(digest) } };
  const r = await fetch(`${HOME}/connect/directory`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session ?? memberSigner.homeSession}` }, body: JSON.stringify({ action: 'publish', listing, memberAccess: access }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`listing ${member.name} in ${org.name}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
}
const LISTINGS_ONLY = process.argv.includes('--listings-only');
/** invite (as the org's steward) · listing · join (as the member) · countersign. */
const personaSessions = new Map();
async function personaSession(custodian, personaSa) {
  const key = `${custodian}|${lower(personaSa)}`;
  if (!personaSessions.has(key)) {
    const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle: custodian, as: lower(personaSa) }) });
    const j = await r.json().catch(() => ({}));
    if (!j.homeSession || lower(j.agent ?? '') !== lower(personaSa)) throw new Error(`demo-signin as ${personaSa.slice(0, 10)}… under ${custodian}: ${j.error ?? r.status}`);
    personaSessions.set(key, j.homeSession);
  }
  return personaSessions.get(key);
}
async function join(org, member, role) {
  const orgSigner = await signerFor(org.custodian); const memberSigner = await signerFor(member.custodian);
  // A CHARACTER ACTS WITH ITS OWN SESSION (its custodian signs in "as" it); a person with their own.
  const session = member.persona ? await personaSession(member.custodian, member.sa) : memberSigner.homeSession;
  const off = await offer(orgSigner, 'has-member', member.sa, org.sa, { role });
  const access = await memberAccess(orgSigner, org.sa, member.sa);
  const rosterRole = role === 'founder' || role === 'custodian' ? 'steward' : 'member';
  const inv = await (await fetch(`${HOME}/connect/org-invite/agent`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${orgSigner.homeSession}` }, body: JSON.stringify({ org: lower(org.sa), agent: lower(member.sa), memberAccessDelegation: access, role: rosterRole, relationshipOffer: off }) })).json().catch(() => ({}));
  if (!inv.ok) throw new Error(`invite ${member.name} → ${org.name}: ${JSON.stringify(inv).slice(0, 160)}`);
  await publishListing(memberSigner, member, org, access, rosterRole, session);
  if (LISTINGS_ONLY) return 'listing published';
  const joined = await (await fetch(`${HOME}/connect/org-membership`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ org: lower(org.sa), delegation: await consent(memberSigner, member.sa, org.sa), displayName: member.name, relationshipOffer: off }) })).json().catch(() => ({}));
  if (!joined.ok) throw new Error(`join ${member.name} → ${org.name}: ${JSON.stringify(joined).slice(0, 160)}`);
  const digest = await accept(session, off, await memberSigner.sign(off.digest));
  return `membership ${joined.membershipRecorded ? 'recorded' : 'NOT recorded'} · credential ${digest.slice(0, 10)}…`;
}
async function stewardOf(org, steward) {
  const orgSigner = await signerFor(org.custodian); const s = await signerFor(steward.custodian);
  const off = await offer(orgSigner, 'steward-of', steward.sa, org.sa, { since: new Date().toISOString() });
  return accept(s.homeSession, off, await s.sign(off.digest));
}

/**
 * THE STORAGE GRANT MUST CARRY THE HOME'S OWN SCOPE LIST or the credential's second copy — in the organization's vault —
 * answers `record_scope_denied`. The realm was granted through engage's older list; re-grant it with the canonical one
 * (`INTERACTIONS_GRANT_CORE_SCOPES` + the estate's app scopes, as `apps/tables/src/field-charter.ts` carries them).
 */
const CORE_RW = ['vault:conversation.index', 'vault:conversation.topic:*', 'vault:message.body:topic:*', 'vault:inbox.data', 'vault:directory.data', 'vault:relationships.data', 'vault:member.profile:*', 'vault:org.membership:*', 'vault:org.applications', 'vault:impact-profile', 'vault:capabilities.data', 'vault:skills.data', 'vault:home.manifest', 'vault:control-events.data', 'vault:coordination.requests', 'vault:coordination.index', 'vault:coordination.endeavor:*', 'vault:content.*', 'vault:resolution.requests', 'vault:resolution.grants', 'vault:archetype.assignment', 'vault:payment.receipt:*', 'vault:household.data', 'vault:conversation.recent', 'vault:run.provenance:*', 'vault:run.artifact:*', 'vault:run.anchor:*', 'vault:run.measures:*', 'vault:relationships.credential:*', 'vault:relationships.revocation:*', 'vault:delegation.lineage:*', 'vault:interaction.dispute:*', 'vault:run.dispute:*', 'vault:build.run:*', 'vault:build.promotion:*', 'vault:agent.budget', 'vault:connector.mcp:*', 'vault:confirmation.preferences', 'vault:standing.instructions', 'vault:security.credentials', 'vault:security.channels', 'vault:memory.facts', 'vault:routines.data', 'vault:person.preferences', 'vault:playbook.memory:*'];
const SCOPES = [
  { server: 'demo-mcp', resources: CORE_RW, ops: ['read', 'write'] },
  { server: 'demo-mcp', resources: ['vault:archetype.assignment'], ops: ['read', 'write', 'delete'] },
  { server: 'demo-mcp', resources: ['vault:message.body:dm:*'], ops: ['read'] },
  { server: 'demo-mcp', resources: ['vault:org.invite:*'], ops: ['read'] },
  { server: 'demo-mcp', resources: ['vault:contact:*'], ops: ['read', 'write'] },
  { server: 'demo-mcp', resources: ['vault:uupg:attestation', 'vault:uupg:attestations', 'vault:uupg:assessed', 'vault:uupg:coalition', 'vault:uupg:segment-def', 'vault:uupg:org-profile', 'vault:uupg:strategy', 'vault:newcity:*', 'vault:family:*', 'vault:field:*'], ops: ['read'] },
  { server: 'demo-mcp', resources: ['vault:family:*', 'vault:field:*', 'vault:cardroom.*'], ops: ['read', 'write'] },
];
const INTERACTIONS_SA = note.interactionsServiceSa || '0x39508624387fed3b9d6dd15ba86d3ace8a3f0a6a';
async function regrant(org) {
  const signer = await signerFor(org.custodian);
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const d = { delegator: lower(org.sa), delegate: lower(INTERACTIONS_SA), authority: ROOT_AUTHORITY, caveats: [buildVaultRecordScopeCaveat(SCOPES), buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n))], salt: randSalt(), signature: '0x' };
  d.signature = await signer.sign(hashDelegation(d, CHAIN, CONTRACTS.delegationManager));
  const sk = await (await fetch(`${A2A}/agent/interactions-session-key`)).json();
  if (!sk?.ok || !sk.address) throw new Error(`no interactions-session key: ${JSON.stringify(sk).slice(0, 120)}`);
  const { leaf, digest } = buildSessionDelegation({ delegator: lower(org.sa), sessionKeyAddress: sk.address, validUntil: Math.floor(Date.now() / 1000) + 12 * 3600, enforcers: { timestamp: CONTRACTS.timestampEnforcer, value: CONTRACTS.valueEnforcer }, chainId: CHAIN, delegationManager: CONTRACTS.delegationManager });
  leaf.signature = await signer.sign(digest);
  const r = await (await fetch(`${A2A}/interactions/${lower(org.sa)}/grant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delegation: wireOut(d), sessionLeaf: { ...leaf, salt: leaf.salt.toString() } }) })).json().catch(() => ({}));
  if (r.ok !== true) throw new Error(`re-grant ${org.name}: ${JSON.stringify(r).slice(0, 160)}`);
}

/** The field app's roster rows on the workspace are a PROJECTION of the organization's members; rewritten after the joins. */
async function projectRoster(rows) {
  const nathan = await signerFor(note.workspace.custodian);
  const r = await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle: note.workspace.custodian }) });
  const { id_token } = await r.json();
  const artifactId = (folder, name) => { let h = 0x811c9dc5; const key = `${folder}/${name}`; for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return `${folder.replace(/\W+/g, '-').slice(0, 32) || 'x'}-none-${h.toString(36)}`; };
  const artifacts = rows.map((record) => ({ id: artifactId('field/workspace-members', `${record.id}.json`), folder: 'field/workspace-members', name: `${record.id}.json`, kind: 'json-ld', bytesB64: Buffer.from(JSON.stringify(record, null, 2), 'utf8').toString('base64') }));
  const w = await fetch(`${HOME}/connect/library`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${id_token}` }, body: JSON.stringify({ org: note.workspace.sa, action: 'save-batch', artifacts }) });
  if (!w.ok) throw new Error(`roster projection: ${w.status} ${(await w.text()).slice(0, 160)}`);
  void nathan;
}
const envelope = (sensitivity, purpose) => ({ sensitivity, precision: null, recurringPattern: false, purpose: `${purpose} — Field Operations (game)` });

/**
 * THE CHARACTER'S MESSAGING RAIL — the Home's own messaging ceremony, for a character: a wire from the character to this
 * deployment's interactions session key naming the messaging skills and every counterparty it may write to (the other
 * characters, the demo people, the organization), and a transport grant beside it; both signed by the custodian and
 * installed by the character's own session. Without it a character's whisper is refused `wire_absent`.
 */
const MESSAGING_SKILLS = ['messaging.deliver', 'interactions.respond', 'interactions.deliverCredential', 'org.apply'];
async function enableMessaging(party, recipients) {
  const signer = await signerFor(party.custodian);
  const session = party.persona ? await personaSession(party.custodian, party.sa) : signer.homeSession;
  const sk = await (await fetch(`${A2A}/agent/interactions-session-key`)).json();
  if (!sk?.ok || !sk.address) throw new Error('no interactions-session key');
  const to = [...new Set(recipients.map(lower).filter((a) => a !== lower(party.sa)))];
  const validUntil = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const caveats = () => [buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)), buildCaveat(CONTRACTS.allowedTargetsEnforcer, encodeAllowedTargetsTerms(to)), buildCaveat(CONTRACTS.allowedMethodsEnforcer, encodeAllowedMethodsTerms(MESSAGING_SKILLS.map((x) => skillSelector(x))))];
  const wire = { delegator: lower(party.sa), delegate: lower(sk.address), authority: ROOT_AUTHORITY, caveats: caveats(), salt: randSalt(), signature: '0x' };
  wire.signature = await signer.sign(hashDelegation(wire, CHAIN, CONTRACTS.delegationManager));
  const transport = { delegator: lower(party.sa), delegate: lower(party.sa), authority: ROOT_AUTHORITY, caveats: caveats(), salt: randSalt(), signature: '0x' };
  transport.signature = await signer.sign(hashDelegation(transport, CHAIN, CONTRACTS.delegationManager));
  const c = await csrf();
  const r = await fetch(`${A2A}/interactions/${lower(party.sa)}/messaging.wireEnable`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: c.cookie, 'x-csrf-token': c.token }, body: JSON.stringify({ session, delegation: wireOut(wire), transport: wireOut(transport) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`messaging wire: ${r.status} ${JSON.stringify(j).slice(0, 140)}`);
  return to.length;
}
const WIRES_ONLY = process.argv.includes('--wires-only');

// ── THE ORGANIZATION that governs the workspace: the only thing with members. The characters are its members; its
// custodian is its founder and steward. A `.workspace` is a service and nobody joins it. ─────────────────────────────
if (!note.organization?.sa) throw new Error('the estate note names no organization — run provision:fieldops first');
const org = { sa: note.organization.sa, name: note.organization.name, custodian: note.organization.custodian };
log(`═══ the organization: ${org.name} ═══`);
const rows = [];
const t = new Date().toISOString();
if (!DRY) {
  await regrant(org); log('  storage re-granted under the Home\'s scope list');
  const nathan = await signerFor(org.custodian);
  log(`  ${org.custodian}: ${await join(org, { sa: nathan.sa, name: org.custodian, custodian: org.custodian }, 'founder')} · steward-of ${(await stewardOf(org, { sa: nathan.sa, custodian: org.custodian })).slice(0, 10)}…`);
  for (const [role, w] of Object.entries(note.workers)) {
    try {
      const out = await join(org, { sa: w.sa, name: w.name, custodian: w.custodian, persona: true }, 'member');
      log(`  ${role} (${w.name}, custodied by ${w.custodian}): ${out}`);
      rows.push({ kind: 'ws-membership', id: `mem-${lower(w.sa)}`, title: w.name, updatedAt: t, envelope: envelope('L2', 'workspace roster'), workspace: note.workspace.sa, person: lower(w.sa), role: 'member', status: LISTINGS_ONLY ? 'active' : 'active', joinedAt: t, organization: org.sa, membershipRecord: `org.membership:member:${lower(w.sa)}` });
    } catch (e) { log(`  ! ${role}: ${e.message}`); }
  }
  if (rows.length) { await projectRoster(rows); log(`  ${rows.length} roster rows projected onto the workspace`); }
} else log(`  would admit ${org.custodian} as founder and steward, and the ${Object.keys(note.workers).length} characters as members`);

// ── THE CHARACTERS' MESSAGING RAILS: each may write to every other character, every demo person and the organization ──
log(`\n═══ the characters' messaging rails ═══`);
if (!DRY) {
  const custodiansAll = [...new Set(Object.values(note.workers).map((w) => w.custodian))];
  const people = []; for (const h of custodiansAll) people.push((await signerFor(h)).sa);
  const everyone = [...Object.values(note.workers).map((w) => w.sa), ...people, org.sa];
  for (const [role, w] of Object.entries(note.workers)) {
    try { log(`  ${role}: wire over ${await enableMessaging({ sa: w.sa, name: w.name, custodian: w.custodian, persona: true }, everyone)} counterparties`); } catch (e) { log(`  ! ${role}: ${e.message}`); }
  }
  // The organization's own `general`, opened by its custodian — where a character on no team speaks.
  const nathanS = await signerFor(org.custodian);
  const list = await (await fetch(`${HOME}/connect/channels?communityId=${lower(org.sa)}`, { headers: { authorization: `Bearer ${nathanS.homeSession}` } })).json().catch(() => ({}));
  const has = (list.channels ?? []).some((ch) => (ch.title ?? '').trim().toLowerCase() === 'general');
  if (!has) { const mk = await (await fetch(`${HOME}/connect/channels`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${nathanS.homeSession}` }, body: JSON.stringify({ action: 'create', communityId: lower(org.sa), title: 'general', participationPolicy: 'open' }) })).json().catch(() => ({})); log(`  organization general: ${mk.ok ? 'opened' : JSON.stringify(mk).slice(0, 120)}`); } else log('  organization general: already open');
}

// ── THE PARTNER CHURCHES' agents: each stewarded by its custodian; its representative character is its member. ───────
const REPRESENTS = { dan: 'christ-community-greeley', kim: 'timberline-fort-collins', jenna: 'lifebridge-longmont', walt: 'trinity-fort-morgan' };
log(`\n═══ the partner churches' agents ═══`);
for (const [id, p] of Object.entries(note.partners)) {
  if (WIRES_ONLY) break;
  const church = { sa: p.sa, name: p.name, custodian: p.custodian };
  const rep = Object.entries(REPRESENTS).find(([, pid]) => pid === id)?.[0];
  if (DRY) { log(`  ${p.name}: would admit ${p.custodian} as custodian+steward and ${rep ?? 'nobody'} as member`); continue; }
  try { await regrant(church); } catch (e) { log(`  ! ${p.name}: ${e.message}`); continue; }
  const c = await signerFor(p.custodian);
  try { log(`  ${p.name}: ${p.custodian} ${await join(church, { sa: c.sa, name: p.custodian, custodian: p.custodian }, 'custodian')} · steward-of ${(await stewardOf(church, { sa: c.sa, custodian: p.custodian })).slice(0, 10)}…`); } catch (e) { log(`  ! ${p.name} ${p.custodian}: ${e.message}`); }
  const w = rep ? note.workers[rep] : null;
  if (w) { try { log(`  ${p.name}: ${w.name} ${await join(church, { sa: w.sa, name: w.name, custodian: w.custodian, persona: true }, 'member')}`); } catch (e) { log(`  ! ${p.name} ${w.name}: ${e.message}`); } }
}
log('\ndone');
