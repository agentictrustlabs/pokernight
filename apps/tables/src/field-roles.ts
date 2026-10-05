/**
 * WHAT EACH CHARACTER DOES ON ITS TEAM — a ROLE on the membership, and the skill pack that role offers its agent
 * (the estate's spec 427).
 *
 * The season already wrote who belongs to which team. It did not say what anybody does there: every membership
 * read "member", and every character's playbook was its character sheet alone — pinned by a script, whatever the
 * season made of it. A role is the organization's statement about one of its members ("field worker", "team
 * lead"): it rides the invitation, the join records it on the organization's own membership record, and it OFFERS
 * a skill pack the member's agent may be equipped with. So a character's playbook becomes what a person's is in the
 * field app — the character sheet (the base) plus the pack of the role it holds — composed from its memberships.
 *
 * THREE THINGS THAT STAY APART, here as everywhere: the ROLE is a word and authorizes nothing; the ACCESS it needs
 * is the delegation the charter already signs; the PACK is behaviour, and only the agent's own session (or its
 * steward's) writes its playbook — the organization cannot. A character IS equipped by its own session here: its
 * custodian signs in "as" it, which is exactly who a game character's own session is.
 *
 * The five roles and their words are the field app's defaults (the governing organization's catalogue). They are
 * restated here, not imported: this repository links to no other checkout, and a definition travels as a snapshot.
 */
import type { PartKind } from '@pokernight/fieldops';

export type FieldRoleSlug = 'field-worker' | 'team-lead' | 'coach' | 'partner-liaison' | 'coordinator';

/** A snapshot of an organization's role definition (`ap.org.role-offer.v1`): ids and words only. */
export interface RoleOffer {
  type: 'ap.org.role-offer.v1';
  roleDefinitionId: string;
  name: string;
  description: string;
  scope: 'organization' | 'team';
  accessRole?: string;
  skillPackRefs: Array<{ context: string; archetype: string }>;
}

const PACK_CONTEXT = 'field-operations';
export const FIELD_ROLES: Record<FieldRoleSlug, { name: string; description: string; accessRole: string; pack: string }> = {
  'field-worker': { name: 'Field worker', description: 'Does the work among a people: shares, disciples, gathers a circle, and records what was done and what was seen.', accessRole: 'field-recorder', pack: 'role-field-worker' },
  'team-lead': { name: 'Team lead', description: 'Leads a team: takes up communities, invites workers, reviews what the team records and answers for its plan.', accessRole: 'community-steward', pack: 'role-team-lead' },
  coach: { name: 'Coach', description: 'Walks beside the workers: listens, asks what is in the way, and helps them take the next step. Reads; does not record for them.', accessRole: 'member', pack: 'role-coach' },
  'partner-liaison': { name: 'Partner liaison', description: 'Speaks for a partner church: what it can give, what it has committed, and what it needs to hear back.', accessRole: 'member', pack: 'role-partner-liaison' },
  coordinator: { name: 'Coordinator', description: 'Keeps the picture across the teams: reads what each records, reconciles phases and reports progress.', accessRole: 'progress-steward', pack: 'role-coordinator' },
};

/** The offer for one role, as the DEFINING organization's (`roledef:<org>:<slug>@1`) — a team offers its governor's. */
export function fieldRoleOffer(slug: FieldRoleSlug, definingOrg: string, scope: 'organization' | 'team'): RoleOffer {
  const def = FIELD_ROLES[slug];
  return {
    type: 'ap.org.role-offer.v1',
    roleDefinitionId: `roledef:${definingOrg.toLowerCase()}:${slug}@1`,
    name: def.name, description: def.description, scope, accessRole: def.accessRole,
    skillPackRefs: [{ context: PACK_CONTEXT, archetype: def.pack }],
  };
}

/**
 * The role a part holds ON A TEAM: whoever founded it leads it; a worker works; a coach coaches. The parts that sit
 * on no team (the researcher, the coordinator, the partners' pastors) hold no team role — see `organizationRoleFor`.
 */
export function teamRoleFor(kind: PartKind, founder: boolean): FieldRoleSlug | null {
  if (founder) return 'team-lead';
  if (kind === 'worker') return 'field-worker';
  if (kind === 'coach') return 'coach';
  return null;
}

/** The role a part holds in the ORGANIZATION that governs the field: the two who keep the picture, and the partners. */
export function organizationRoleFor(kind: PartKind): FieldRoleSlug | null {
  if (kind === 'coordinator' || kind === 'steward') return 'coordinator';
  if (kind === 'partner') return 'partner-liaison';
  return null;
}

// ── A CHARACTER'S PLAYBOOK: ITS SHEET PLUS THE PACK OF EACH ROLE IT HOLDS ───────────────────────────────────────────

export interface ComposedPack {
  context: string; archetype: string; version: string; digest: string;
  organization: string; organizationName?: string;
  roleDefinitionId: string; roleName: string;
  equippedAt: string; equippedBy: string; equippedAs: 'self' | 'steward';
}
export interface ComposedFrom { base: { context: string; archetype: string; version: string; digest: string }; packs: ComposedPack[] }
export interface AssignmentRecord {
  type: 'ap.archetype-assignment.v1';
  archetypeId: string; archetypeVersion: string; definitionDigest: string;
  definition: { archetypeId: string; archetypeVersion: string; instructions?: string; tools?: Array<{ id: string }>; applicableAgentTypes?: string[] } & Record<string, unknown>;
  composedFrom?: ComposedFrom;
}
export interface HeldPack { organization: string; organizationName: string; offer: RoleOffer }

const packKey = (p: { context: string; archetype: string }): string => `${p.context}/${p.archetype}`;

/**
 * PURE: the packs a character's playbook should hold after it is equipped for `held` — one per (organization, pack).
 * What it already holds is kept (with when it was first equipped); a role CHANGED at an organization replaces that
 * organization's pack; nothing is dropped for an organization this call does not mention.
 */
export function packsAfter(current: ComposedFrom | undefined, held: readonly HeldPack[], who: string, now: string): Array<Omit<ComposedPack, 'version' | 'digest'>> {
  const mentioned = new Set(held.map((h) => h.organization.toLowerCase()));
  const kept = (current?.packs ?? []).filter((p) => !mentioned.has(p.organization.toLowerCase()) || held.some((h) => h.organization.toLowerCase() === p.organization.toLowerCase() && h.offer.skillPackRefs.some((r) => packKey(r) === packKey(p))));
  const out: Array<Omit<ComposedPack, 'version' | 'digest'>> = kept.map(({ version: _v, digest: _d, ...rest }) => rest);
  for (const h of held) {
    for (const ref of h.offer.skillPackRefs) {
      if (out.some((p) => p.organization.toLowerCase() === h.organization.toLowerCase() && packKey(p) === packKey(ref))) continue;
      out.push({ context: ref.context, archetype: ref.archetype, organization: h.organization.toLowerCase(), organizationName: h.organizationName, roleDefinitionId: h.offer.roleDefinitionId, roleName: h.offer.name, equippedAt: now, equippedBy: who.toLowerCase(), equippedAs: 'self' });
    }
  }
  return out;
}

export interface EquipDoors { home: string; registry: string }
export interface EquipResult { ok: boolean; reason?: string; archetypeId?: string; digest?: string; tools?: number; packs?: string[]; unchanged?: boolean }

/**
 * EQUIP A CHARACTER for the roles it holds: read its playbook (its own session), compose its character sheet with
 * the packs (the skills registry's compiler — the one place a definition is made), and write the one record its
 * agent runs, with `composedFrom` saying which pack came from which team. Best-effort and SAID: a registry that
 * cannot compose leaves the character on the sheet it had, and the caller logs why. Never throws.
 */
export async function equipCharacter(doors: EquipDoors, character: { sa: string; session: string }, base: { context: string; archetype: string }, held: readonly HeldPack[], opts: { fetch?: typeof fetch; now?: () => string } = {}): Promise<EquipResult> {
  const f = opts.fetch ?? fetch;
  const now = (opts.now ?? (() => new Date().toISOString()))();
  const me = character.sa.toLowerCase();
  const channels = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const r = await f(`${doors.home}/connect/channels`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${character.session}` }, body: JSON.stringify({ ...body, communityId: me }) });
    return { status: r.status, ...((await r.json().catch(() => ({}))) as Record<string, unknown>) };
  };
  try {
    const got = await channels({ action: 'archetypeAssignmentGet' });
    if (got.ok !== true) return { ok: false, reason: `could not read the playbook: ${String(got.error ?? got.status)}` };
    const current = (got.record ?? null) as AssignmentRecord | null;
    const next = packsAfter(current?.composedFrom, held, me, now);
    const same = !!current?.composedFrom && current.composedFrom.base.archetype === base.archetype && current.composedFrom.packs.length === next.length
      && next.every((p) => current.composedFrom!.packs.some((q) => q.organization === p.organization && packKey(q) === packKey(p)));
    if (same) return { ok: true, unchanged: true, archetypeId: current!.archetypeId, digest: current!.definitionDigest, tools: current!.definition.tools?.length ?? 0, packs: next.map(packKey) };
    const res = await f(`${doors.registry.replace(/\/$/, '')}/context/compose`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base, packs: next.map((p) => ({ context: p.context, archetype: p.archetype, as: `${p.roleName} at ${p.organizationName ?? p.organization}` })) }),
    });
    const composed = (await res.json().catch(() => ({}))) as { definition?: AssignmentRecord['definition']; digest?: string; parts?: Array<{ ref: string; digest: string; version: string }>; error?: string };
    if (!res.ok || !composed.definition || !composed.digest) return { ok: false, reason: `the registry could not compose ${packKey(base)}: ${composed.error ?? res.status}` };
    const part = (ref: { context: string; archetype: string }) => composed.parts?.find((x) => x.ref === packKey(ref));
    const basePart = part(base);
    if (!basePart || next.some((p) => !part(p))) return { ok: false, reason: 'the registry did not report every part of the composition — not written' };
    const record: AssignmentRecord = {
      type: 'ap.archetype-assignment.v1',
      archetypeId: composed.definition.archetypeId, archetypeVersion: composed.definition.archetypeVersion,
      definitionDigest: composed.digest, definition: composed.definition,
      composedFrom: { base: { ...base, version: basePart.version, digest: basePart.digest }, packs: next.map((p) => ({ ...p, version: part(p)!.version, digest: part(p)!.digest })) },
    };
    const put = await channels({ action: 'archetypeAssignmentPut', record });
    if (put.ok !== true) return { ok: false, reason: `the playbook was not written: ${String(put.error ?? put.status)}` };
    return { ok: true, archetypeId: record.archetypeId, digest: record.definitionDigest, tools: record.definition.tools?.length ?? 0, packs: next.map(packKey) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
