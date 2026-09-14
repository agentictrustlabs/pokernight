import { describe, expect, it } from 'vitest';
import {
  COUNTRY_CEILINGS, CLAIM_SLOTS, MISSION_COVENANT_CLAUSES, MISSION_REGISTRY_ID, canonicalJson, cardHash, checkPresence, countryCeiling,
  covenantComplete, covenantMessage, displayPoint, entryIdFor, orgOfEntryId, presenceHash, type MissionPresenceV1,
} from '../src/index.js';

const org = '0x00000000000000000000000000000000000000ab' as const;
const presence: MissionPresenceV1 = {
  type: 'MissionPresenceV1', org, name: 'Hope for the City', blurb: 'Meals and a listening ear, three nights a week.',
  website: 'https://hope.example', languages: ['en', 'es'],
  place: { label: 'Fort Collins, Colorado, United States', country: 'US', lat: 40.5853, lng: -105.0844, precise: true },
  updatedAt: '2026-09-14T00:00:00.000Z',
};

describe('the registry, named', () => {
  it('names an entry after its organization, once', () => {
    const id = entryIdFor('0x00000000000000000000000000000000000000AB');
    expect(id).toBe(`urn:ap:registry-entry:gamenight-missions/${org}`);
    expect(orgOfEntryId(id)).toBe(org);
    expect(orgOfEntryId('urn:ap:registry-entry:elsewhere/0xab')).toBeNull();
    expect(MISSION_REGISTRY_ID).toMatch(/^urn:ap:registry:/);
    expect(CLAIM_SLOTS.presence).toMatch(/^urn:ap:registry-claim-slot:/);
  });
});

describe('a presence', () => {
  it('is checked in words a form can show', () => {
    expect(checkPresence(presence)).toEqual([]);
    expect(checkPresence({ ...presence, website: 'hope.example' })).toContain('the website must be an https:// address');
    expect(checkPresence({ ...presence, place: { ...presence.place, country: 'usa' } })).toContain('the place needs a country code');
    expect(checkPresence({ ...presence, blurb: '' })).toContain('say what the mission does');
  });
  it('hashes the same whatever the key order', () => {
    const re = JSON.parse(JSON.stringify({ updatedAt: presence.updatedAt, place: { precise: true, lng: presence.place.lng, lat: presence.place.lat, country: 'US', label: presence.place.label }, languages: presence.languages, website: presence.website, blurb: presence.blurb, name: presence.name, org, type: 'MissionPresenceV1' })) as MissionPresenceV1;
    expect(presenceHash(re)).toBe(presenceHash(presence));
    expect(presenceHash(presence)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(cardHash(presence)).not.toBe(presenceHash(presence));
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe('{"a":{"d":2},"b":1}');
  });
});

describe('the ceiling', () => {
  it('serves the exact point only where the country allows it and the mission asked', () => {
    expect(displayPoint(presence.place)).toEqual({ point: { lat: 40.5853, lng: -105.0844 }, grain: 'exact' });
    const nearby = displayPoint({ ...presence.place, precise: false });
    expect(nearby.grain).toBe('nearby');
    expect(nearby.point!.lat).not.toBe(40.5853);
    expect(Math.abs(nearby.point!.lat - 40.5853)).toBeLessThan(0.02);
  });
  it('coarsens or hides by country, whatever was asked', () => {
    expect(countryCeiling('US')).toBe('precise');
    expect(countryCeiling('Afghanistan')).toBe('none');
    expect(displayPoint({ country: 'AF', lat: 34.5, lng: 69.2, precise: true })).toEqual({ point: null, grain: 'hidden' });
    const adm2 = COUNTRY_CEILINGS.find((r) => r.ceiling === 'adm2')!;
    const region = displayPoint({ country: adm2.iso, lat: 28.61, lng: 77.2, precise: true });
    expect(region).toEqual({ point: { lat: 29, lng: 77 }, grain: 'region' });
  });
});

describe('the covenant', () => {
  it('is three clauses, all of them', () => {
    expect(MISSION_COVENANT_CLAUSES).toHaveLength(3);
    expect(covenantComplete(['genuine', 'safety'])).toBe(false);
    expect(covenantComplete(MISSION_COVENANT_CLAUSES.map((c) => c.id))).toBe(true);
  });
  it('signs a message a person can read, with the binding facts in it', () => {
    const m = covenantMessage({ version: 'gamenight-missions-v1', registryId: MISSION_REGISTRY_ID, org, steward: '0x00000000000000000000000000000000000000cd', clauseIds: ['genuine', 'use-limitation', 'safety'], signedAt: '2026-09-14T00:00:00.000Z' });
    expect(m).toContain('1. This is a genuine mission organization');
    expect(m).toContain(`organization: ${org}`);
    expect(m).toContain(`registry: ${MISSION_REGISTRY_ID}`);
  });
});
