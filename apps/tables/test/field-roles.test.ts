// What each character does on its team, and the playbook that follows: its sheet plus the pack of each role it holds.
import { describe, it, expect } from 'vitest';
import { equipCharacter, fieldRoleOffer, FIELD_ROLES, organizationRoleFor, packsAfter, teamRoleFor, type AssignmentRecord, type HeldPack } from '../src/field-roles.js';

const ORG = '0x8E32C713f44c7747D97a589522806a8e1Dd810fB';
const WELD = '0x7769e189f349301bdc2d6520a4026af34a7fb91f';
const PLAINS = '0xd832925437b82f4354e23eff78164caf022a03b9';
const NAOMI = '0x8482b1963f8435c111ffc57aa3b4754addb1a2a5';
const NOW = '2026-10-05T12:00:00.000Z';
const held = (org: string, slug: Parameters<typeof fieldRoleOffer>[0], name = 'Weld Corridor Team (game)'): HeldPack => ({ organization: org, organizationName: name, offer: fieldRoleOffer(slug, ORG, 'team') });

describe('which part holds which role', () => {
  it('whoever founds a team leads it; a worker works; a coach coaches', () => {
    expect(teamRoleFor('worker', true)).toBe('team-lead');
    expect(teamRoleFor('worker', false)).toBe('field-worker');
    expect(teamRoleFor('coach', false)).toBe('coach');
    expect(teamRoleFor('partner', false)).toBeNull();
    expect(teamRoleFor('coordinator', false)).toBeNull();
  });
  it('the parts on no team hold their role in the organization', () => {
    expect(organizationRoleFor('coordinator')).toBe('coordinator');
    expect(organizationRoleFor('steward')).toBe('coordinator');
    expect(organizationRoleFor('partner')).toBe('partner-liaison');
    expect(organizationRoleFor('worker')).toBeNull();
  });
  it('an offer is the DEFINING organization\'s definition, ids and words only', () => {
    const o = fieldRoleOffer('team-lead', ORG, 'team');
    expect(o).toEqual({ type: 'ap.org.role-offer.v1', roleDefinitionId: `roledef:${ORG.toLowerCase()}:team-lead@1`, name: 'Team lead', description: FIELD_ROLES['team-lead'].description, scope: 'team', accessRole: 'community-steward', skillPackRefs: [{ context: 'field-operations', archetype: 'role-team-lead' }] });
    expect(Object.keys(o).sort()).toEqual(['accessRole', 'description', 'name', 'roleDefinitionId', 'scope', 'skillPackRefs', 'type']);
    for (const d of Object.values(FIELD_ROLES)) expect(d.description.length).toBeLessThanOrEqual(400);
  });
});

describe('packsAfter', () => {
  it('adds the pack of a role, against the team it is held on', () => {
    const p = packsAfter(undefined, [held(WELD, 'team-lead')], NAOMI, NOW);
    expect(p).toEqual([{ context: 'field-operations', archetype: 'role-team-lead', organization: WELD, organizationName: 'Weld Corridor Team (game)', roleDefinitionId: `roledef:${ORG.toLowerCase()}:team-lead@1`, roleName: 'Team lead', equippedAt: NOW, equippedBy: NAOMI, equippedAs: 'self' }]);
  });
  it('keeps what is held elsewhere, and keeps when a pack was first equipped', () => {
    const first = packsAfter(undefined, [held(WELD, 'team-lead')], NAOMI, '2026-10-01T00:00:00.000Z').map((x) => ({ ...x, version: '1.0.0', digest: '0xa' }));
    const base = { context: 'field-operations', archetype: 'north-naomi', version: '1.0.0', digest: '0xb' };
    const again = packsAfter({ base, packs: first }, [held(WELD, 'team-lead'), held(PLAINS, 'coach', 'Plains Team (game)')], NAOMI, NOW);
    expect(again.map((x) => [x.organization, x.archetype, x.equippedAt])).toEqual([[WELD, 'role-team-lead', '2026-10-01T00:00:00.000Z'], [PLAINS, 'role-coach', NOW]]);
    // An organization this call does not mention is left alone.
    const only = packsAfter({ base, packs: first }, [held(PLAINS, 'coach')], NAOMI, NOW);
    expect(only.map((x) => x.archetype)).toEqual(['role-team-lead', 'role-coach']);
  });
  it('a role CHANGED on a team replaces that team\'s pack', () => {
    const first = packsAfter(undefined, [held(WELD, 'field-worker')], NAOMI, NOW).map((x) => ({ ...x, version: '1.0.0', digest: '0xa' }));
    const next = packsAfter({ base: { context: 'field-operations', archetype: 'north-naomi', version: '1.0.0', digest: '0xb' }, packs: first }, [held(WELD, 'team-lead')], NAOMI, NOW);
    expect(next.map((x) => x.archetype)).toEqual(['role-team-lead']);
  });
});

describe('equipCharacter', () => {
  const base = { context: 'field-operations', archetype: 'north-naomi' };
  const definition = { archetypeId: 'skill:archetypes/north-naomi+role-team-lead', archetypeVersion: '1.0.0', instructions: 'x', tools: [{ id: 'a' }, { id: 'b' }], applicableAgentTypes: ['person'] };
  function world(current: AssignmentRecord | null, compose: { status: number; body: unknown } = { status: 200, body: { definition, digest: '0xcomposed', parts: [{ ref: 'field-operations/north-naomi', digest: '0xsheet', version: '1.0.0' }, { ref: 'field-operations/role-team-lead', digest: '0xlead', version: '1.0.0' }] } }) {
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null });
      if (url.endsWith('/connect/channels')) return new Response(JSON.stringify(body.action === 'archetypeAssignmentGet' ? { ok: true, record: current } : { ok: true }), { status: 200 });
      return new Response(JSON.stringify(compose.body), { status: compose.status });
    }) as unknown as typeof fetch;
    return { calls, f };
  }
  const doors = { home: 'https://home.example', registry: 'https://registry.example' };

  it('composes the sheet with the pack and writes ONE record, as the character', async () => {
    const w = world(null);
    const r = await equipCharacter(doors, { sa: NAOMI, session: 'naomi-session' }, base, [held(WELD, 'team-lead')], { fetch: w.f, now: () => NOW });
    expect(r).toMatchObject({ ok: true, digest: '0xcomposed', tools: 2, packs: ['field-operations/role-team-lead'] });
    const compose = w.calls.find((c) => c.url.endsWith('/context/compose'))!;
    expect(compose.body).toEqual({ base, packs: [{ context: 'field-operations', archetype: 'role-team-lead', as: 'Team lead at Weld Corridor Team (game)' }] });
    const put = w.calls.find((c) => c.body.action === 'archetypeAssignmentPut')!;
    expect(put.auth).toBe('Bearer naomi-session');
    expect(put.body.communityId).toBe(NAOMI);
    const rec = put.body.record as AssignmentRecord;
    expect(rec.definitionDigest).toBe('0xcomposed');
    expect(rec.composedFrom?.base).toEqual({ ...base, version: '1.0.0', digest: '0xsheet' });
    expect(rec.composedFrom?.packs[0]).toMatchObject({ organization: WELD, roleName: 'Team lead', digest: '0xlead', equippedBy: NAOMI, equippedAs: 'self' });
  });

  it('already equipped for exactly these roles → nothing is composed or written', async () => {
    const packs = packsAfter(undefined, [held(WELD, 'team-lead')], NAOMI, NOW).map((x) => ({ ...x, version: '1.0.0', digest: '0xlead' }));
    const w = world({ type: 'ap.archetype-assignment.v1', archetypeId: definition.archetypeId, archetypeVersion: '1.0.0', definitionDigest: '0xcomposed', definition, composedFrom: { base: { ...base, version: '1.0.0', digest: '0xsheet' }, packs } });
    const r = await equipCharacter(doors, { sa: NAOMI, session: 's' }, base, [held(WELD, 'team-lead')], { fetch: w.f });
    expect(r).toMatchObject({ ok: true, unchanged: true });
    expect(w.calls.map((c) => c.body.action ?? 'compose')).toEqual(['archetypeAssignmentGet']);
  });

  it('a registry that cannot compose leaves the playbook alone and SAYS why', async () => {
    const w = world(null, { status: 422, body: { error: 'field-operations/role-team-lead: not compiled (404)' } });
    const r = await equipCharacter(doors, { sa: NAOMI, session: 's' }, base, [held(WELD, 'team-lead')], { fetch: w.f });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not compiled/);
    expect(w.calls.some((c) => c.body.action === 'archetypeAssignmentPut')).toBe(false);
  });

  it('a composition that does not report every part is not written', async () => {
    const w = world(null, { status: 200, body: { definition, digest: '0xcomposed', parts: [{ ref: 'field-operations/north-naomi', digest: '0xsheet', version: '1.0.0' }] } });
    const r = await equipCharacter(doors, { sa: NAOMI, session: 's' }, base, [held(WELD, 'team-lead')], { fetch: w.f });
    expect(r.ok).toBe(false);
    expect(w.calls.some((c) => c.body.action === 'archetypeAssignmentPut')).toBe(false);
  });
});
