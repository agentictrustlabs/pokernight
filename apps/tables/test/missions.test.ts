/**
 * THE MISSION REGISTRY'S OPERATOR STORE and its public reads (docs/MISSION-REGISTRY.md).
 *
 * The chain and the Home are not here: what is tested is the projection — an admitted registration is
 * listed with a point the ceiling allows and no contact; a second admission renews rather than duplicates;
 * the lifecycle log is a hash chain the kit verifies; the profile says what the registry admits.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { verifyEventChain } from '@agenticprimitives/registry-kit';
import { MISSION_REGISTRY_ID, entryIdFor, type MissionListing } from '@pokernight/missions';
import { createTableViaHttp, devSession } from './helpers.js';

const org = '0x00000000000000000000000000000000000000ab';
const presence = {
  type: 'MissionPresenceV1', org, name: 'Hope for the City', blurb: 'Meals and a listening ear.', website: 'https://hope.example', languages: ['en'],
  place: { label: 'Fort Collins, Colorado, United States', country: 'US', lat: 40.5853, lng: -105.0844, precise: false },
  updatedAt: '2026-09-14T00:00:00.000Z',
};
const covenant = { type: 'MissionCovenantAttestationV1', version: 'gamenight-missions-v1', registryId: MISSION_REGISTRY_ID, org, steward: '0x00000000000000000000000000000000000000cd', clauseIds: ['genuine', 'use-limitation', 'safety'], signedAt: '2026-09-14T00:00:00.000Z', signature: '0x00' };
const receipt = { type: 'RegistrationReceiptV1', receiptId: 'r1', registryId: MISSION_REGISTRY_ID, entryId: entryIdFor(org), subjectAgent: `eip155:34348:${org}`, subjectType: 'org', verified: [], failed: [], notVerified: [], versions: { cardHash: 'sha256:' + '0'.repeat(64), ontologyVersion: 'x', kitVersion: 'x' }, mappings: [], admittedAt: '2026-09-14T00:00:00.000Z', proof: { signer: 'eip155:34348:0x1cfd1174167f4e946d016e86e7d58c5e601c74c0', scheme: 'session-key', signature: '0x00' } };

const store = () => env.MISSIONS.get(env.MISSIONS.idFromName(MISSION_REGISTRY_ID));
const admit = (act: 'registered' | 'renewed', p = presence) => store().fetch('https://do/admit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presence: p, covenant, orgName: 'hope.org', contact: 'ops@hope.example', receipt, receiptHash: 'sha256:' + '1'.repeat(64), expiresAt: Math.floor(Date.now() / 1000) + 3600, act }) });

describe('the registry profile', () => {
  it('says what it admits, for anybody', async () => {
    const r = await SELF.fetch('http://tables.test/missions/registry');
    const b = (await r.json()) as { type: string; registryId: string; claimSlots: unknown[]; lifecycle: { renewable: boolean } };
    expect(b.type).toBe('RegistryKitProfile');
    expect(b.registryId).toBe(MISSION_REGISTRY_ID);
    expect(b.claimSlots).toHaveLength(2);
    expect(b.lifecycle.renewable).toBe(true);
  });
});

describe('the operator store', () => {
  it('lists an admitted mission with the point the ceiling allows, and never the contact', async () => {
    expect((await admit('registered')).status).toBe(201);
    const r = await SELF.fetch('http://tables.test/missions');
    const { missions } = (await r.json()) as { missions: MissionListing[] };
    const m = missions.find((x) => x.org === org)!;
    expect(m.name).toBe('Hope for the City');
    expect(m.grain).toBe('nearby');
    expect(m.point!.lat).not.toBe(40.5853);
    expect(m.status).toBe('active');
    expect(JSON.stringify(m)).not.toContain('ops@hope.example');
    expect(m.registryId).toBe(MISSION_REGISTRY_ID);
  });

  it('renews rather than duplicates, and keeps a hash-chained log the kit verifies', async () => {
    expect((await admit('renewed', { ...presence, blurb: 'Meals, and a listening ear, every week.' })).status).toBe(201);
    const list = (await (await SELF.fetch('http://tables.test/missions')).json()) as { missions: MissionListing[] };
    expect(list.missions.filter((x) => x.org === org)).toHaveLength(1);
    expect(list.missions.find((x) => x.org === org)!.blurb).toContain('every week');
    const one = (await (await SELF.fetch(`http://tables.test/missions/${encodeURIComponent(entryIdFor(org))}`)).json()) as { listing: MissionListing; receipt: unknown; events: Array<{ kind: string; sequence: string }> };
    expect(one.receipt).toBeTruthy();
    expect(one.events.map((e) => e.kind)).toEqual(['ENTRY_REGISTERED', 'ENTRY_RENEWED']);
    const log = (await (await store().fetch('https://do/log')).json()) as { events: Array<Record<string, unknown> & { sequence: string }> };
    const chain = await verifyEventChain(log.events.map((e) => ({ ...e, sequence: BigInt(e.sequence) })) as never);
    expect(chain.ok).toBe(true);
  });

  it('answers 404 for an entry id that is not one of ours', async () => {
    expect((await SELF.fetch('http://tables.test/missions/urn:ap:registry-entry:elsewhere/0xab')).status).toBe(404);
  });

  it('refuses the return leg without a session, and the geocoder too', async () => {
    expect((await SELF.fetch('http://tables.test/missions/enrol', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await SELF.fetch('http://tables.test/geo/search?q=fort')).status).toBe(401);
  });
});

describe('a mission as a table’s guest', () => {
  it('is resolved against the registry and stamped on the table', async () => {
    await admit('registered');
    const { token } = await devSession('host-with-a-guest');
    const res = await SELF.fetch('http://tables.test/tables', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'guest night', mission: entryIdFor(org) }) });
    expect(res.status).toBe(201);
    const t = (await res.json()) as { tableId: string; mission?: { name: string; org: string } };
    expect(t.mission).toEqual({ entryId: entryIdFor(org), org, name: 'Hope for the City' });
    const view = (await (await SELF.fetch(`http://tables.test/tables/${t.tableId}`, { headers: { authorization: `Bearer ${token}` } })).json()) as { mission?: { name: string } };
    expect(view.mission?.name).toBe('Hope for the City');
  });
  it('refuses a guest the registry does not list', async () => {
    const { token } = await devSession('host-with-no-guest');
    const res = await SELF.fetch('http://tables.test/tables', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'no guest', mission: entryIdFor('0x00000000000000000000000000000000000000ff') }) });
    expect(res.status).toBe(400);
    void createTableViaHttp;
  });
});
