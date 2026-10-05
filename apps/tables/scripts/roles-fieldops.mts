/**
 * THE LIVE SEASON'S PEOPLE GET THEIR ROLES — without another season.
 *
 *   pnpm roles:fieldops [--dry]
 *
 * A season now offers a role with every team membership and equips each character for it (`src/field-roles.ts`). The
 * season that is already there was chartered before that: every membership reads "member", and every character runs
 * its character sheet alone. This brings it level, with what the estate already holds and NO new run and no model:
 *
 *   1. ROLES. For each live team (the chartered ledger): whoever founded it is its TEAM LEAD, a worker on it a FIELD
 *      WORKER, a coach a COACH. In the governing organization: the researcher and the coordinator are COORDINATORS,
 *      the four pastors PARTNER LIAISONS. Each is set on the member's existing membership record by a steward of that
 *      organization — the team's custodian, with the stewardship wire their own link holds (`org.setMemberRole`).
 *   2. PLAYBOOKS. Each character's agent is equipped by its OWN session (its custodian signs in as it): its sheet
 *      (`field-operations/north-<part>`) composed with the pack of each role it now holds, written with `composedFrom`.
 *
 * Idempotent: a role already set is left alone, a character already equipped for exactly its roles is not rewritten.
 * A role is a word on a membership and authorizes nothing; the access each part has is what its charter signed.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NORTH_OF_DENVER as S } from '@pokernight/fieldops';
import { parseEstate } from '../src/field-estate.js';
import { personaSession, signerFor } from '../src/field-charter.js';
import { equipCharacter, fieldRoleOffer, organizationRoleFor, teamRoleFor, type FieldRoleSlug, type HeldPack, type RoleOffer } from '../src/field-roles.js';

const DRY = process.argv.includes('--dry');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const estate = parseEstate(readFileSync(resolve(root, 'fieldops-estate.note.json'), 'utf8'));
if (!estate?.organization?.sa) throw new Error('the estate note names no governing organization — `pnpm provision:fieldops` first');
const ORG = estate.organization.sa.toLowerCase();
const lower = (s: string) => s.toLowerCase();
const log = (s: string) => console.log(s);

// The chartered ledger says which teams are live and who founded each.
const raw = execSync(`cd ${resolve(here, '..')} && pnpm exec wrangler kv key get --binding CLUB_WIRES --env faithnet --remote fieldops-chartered 2>/dev/null`, { encoding: 'utf8' });
const at = raw.indexOf('[');
if (at < 0) throw new Error(`no ledger value in what wrangler printed: ${raw.trim().slice(0, 120) || '(nothing)'}`);
const ledger = JSON.parse(raw.slice(at)) as Array<{ sa: string; kind: string; name: string; custodian: string; steward?: { sa: string; name: string }; stagingId?: string }>;
const season = [...ledger].reverse().find((e) => e.kind === 'team')?.stagingId ?? '';
const teams = ledger.filter((e) => e.kind === 'team' && (e.stagingId ?? '') === season);
log(`season ${season || '(unstamped)'} — ${teams.length} team(s); governing organization ${ORG}${DRY ? '  [dry run]' : ''}`);

// Who each persona is: its part, its kind, its sheet.
const partBySa = new Map<string, { id: string; name: string; kind: (typeof S.roles)[number]['kind']; archetype: string; custodian: string }>();
for (const r of S.roles) { const w = estate.workers[r.id]; if (w) partBySa.set(lower(w.sa), { id: r.id, name: r.name, kind: r.kind, archetype: (r as { archetype?: string }).archetype ?? `north-${r.id}`, custodian: w.custodian }); }

const json = async (r: Response): Promise<Record<string, unknown>> => (await r.json().catch(() => ({}))) as Record<string, unknown>;
interface Row { orgAgent?: string; stewardshipDelegation?: unknown }
const wireCache = new Map<string, unknown>();
/** The stewardship wire a custodian's own link holds for an organization — what the organization's object verifies. */
async function stewardWire(handle: string, org: string): Promise<unknown | null> {
  const key = `${handle}|${org}`;
  if (!wireCache.has(key)) {
    const s = await signerFor(estate!, handle);
    const b = await json(await fetch(`${estate!.home}/connect/related-orgs?surface=any`, { headers: { authorization: `Bearer ${s.homeSession}` } }));
    for (const row of (b.orgs ?? []) as Row[]) if (row.orgAgent && row.stewardshipDelegation) wireCache.set(`${handle}|${lower(row.orgAgent)}`, row.stewardshipDelegation);
    if (!wireCache.has(key)) wireCache.set(key, null);
  }
  return wireCache.get(key) ?? null;
}
/** An organization's roster as its steward sees it: every listed member, with the role its record names. */
async function roster(handle: string, org: string): Promise<Array<{ sa: string; role: string | null }>> {
  const s = await signerFor(estate!, handle);
  const b = await json(await fetch(`${estate!.home}/connect/directory?communityId=${org}`, { headers: { authorization: `Bearer ${s.homeSession}` } }));
  return ((b.listings ?? []) as Array<{ listing?: { subject?: string }; role?: { assignedRole?: string } }>).map((l) => ({ sa: lower(String(l.listing?.subject ?? '').match(/0x[0-9a-fA-F]{40}$/)?.[0] ?? ''), role: l.role?.assignedRole ?? null })).filter((m) => m.sa);
}
let set = 0; let kept = 0; let failed = 0;
async function setRole(handle: string, org: string, orgName: string, member: string, who: string, slug: FieldRoleSlug, offer: RoleOffer, current: string | null): Promise<boolean> {
  if (current === slug) { kept += 1; log(`  = ${who} is already ${offer.name} at ${orgName}`); return true; }
  if (DRY) { log(`  + ${who} → ${offer.name} at ${orgName}${current ? ` (was ${current})` : ''}`); return true; }
  const s = await signerFor(estate!, handle);
  const stewardship = await stewardWire(handle, org);
  if (!stewardship) { failed += 1; log(`  ✗ ${who}: ${handle} holds no stewardship wire for ${orgName}`); return false; }
  const r = await fetch(`${estate!.a2a}/interactions/${org}/org.setMemberRole`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: s.homeSession, member, orgRole: offer, stewardship }) });
  const b = await json(r);
  if (r.status === 200 && b.ok === true) { set += 1; log(`  + ${who} → ${offer.name} at ${orgName} (was ${String(b.previous ?? 'member')})`); return true; }
  failed += 1; log(`  ✗ ${who} → ${offer.name} at ${orgName}: ${r.status} ${String(b.error ?? b.code ?? '')}`.slice(0, 220));
  return false;
}

/** Every role each character ends up holding — what its playbook is composed from. */
const heldBy = new Map<string, HeldPack[]>();
const hold = (sa: string, h: HeldPack) => heldBy.set(sa, [...(heldBy.get(sa) ?? []), h]);

for (const t of teams) {
  const team = lower(t.sa);
  log(`\n${t.name} — ${team} (custodian ${t.custodian})`);
  const members = await roster(t.custodian, team);
  if (!members.length) { log('  (no roster could be read)'); continue; }
  for (const m of members) {
    const part = partBySa.get(m.sa);
    if (!part) continue; // a person, not a character of the season
    const slug = teamRoleFor(part.kind, lower(t.steward?.sa ?? '') === m.sa);
    if (!slug) continue;
    const offer = fieldRoleOffer(slug, ORG, 'team');
    if (await setRole(t.custodian, team, t.name, m.sa, part.name, slug, offer, m.role)) hold(m.sa, { organization: team, organizationName: t.name, offer });
  }
}

log(`\n${estate.organization.name ?? 'the governing organization'} — ${ORG} (custodian ${estate.organization.custodian})`);
const orgMembers = await roster(estate.organization.custodian, ORG);
for (const m of orgMembers) {
  const part = partBySa.get(m.sa);
  const slug = part ? organizationRoleFor(part.kind) : null;
  if (!part || !slug) continue;
  const offer = fieldRoleOffer(slug, ORG, 'organization');
  if (await setRole(estate.organization.custodian, ORG, estate.organization.name ?? 'the organization', m.sa, part.name, slug, offer, m.role)) hold(m.sa, { organization: ORG, organizationName: estate.organization.name ?? 'the organization', offer });
}

log('\nplaybooks — each character\'s sheet plus the pack of each role it holds');
let equipped = 0; let same = 0; let unequipped = 0;
for (const [sa, held] of heldBy) {
  const part = partBySa.get(sa)!;
  const words = held.map((h) => `${h.offer.name} at ${h.organizationName}`).join(' · ');
  if (DRY) { log(`  ~ ${part.name}: ${part.archetype} + ${words}`); continue; }
  const session = await personaSession(estate, part.custodian, sa);
  const r = await equipCharacter({ home: estate.home, registry: estate.registry }, { sa, session: session.homeSession }, { context: 'field-operations', archetype: part.archetype }, held);
  if (!r.ok) { unequipped += 1; log(`  ✗ ${part.name}: ${r.reason}`); continue; }
  if (r.unchanged) same += 1; else equipped += 1;
  log(`  ${r.unchanged ? '=' : '+'} ${part.name}: ${part.archetype} + ${words} — ${r.tools} tools, ${String(r.digest).slice(0, 12)}…`);
}
log(`\nroles: ${set} set, ${kept} already right, ${failed} failed · playbooks: ${equipped} equipped, ${same} already right, ${unequipped} failed`);
if (failed || unequipped) process.exit(1);
