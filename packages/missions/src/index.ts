/**
 * THE MISSION REGISTRY'S DOMAIN (`docs/MISSION-REGISTRY.md`).
 *
 * A mission is an ORGANIZATION — a Smart Agent with a `.org` name — that registered itself in the
 * registry the card room operates so that a game can invite it as its guest. This package says what a
 * registration IS: the presence a mission publishes, the covenant its steward affirms, the ceiling on
 * where it may be shown, the ids that name the registry and its entries, and the registry's own profile.
 * Everything here is pure; the chain, the vault and the operator's store are the apps' business.
 *
 * The shapes follow the substrate's registry kit (spec 279 / spec 346 §7): an entry is a FACET of the
 * mission's own agent, named by `urn:ap:registry-entry:…`, carrying hashes of a card and of claims; this
 * package produces those hashes the same way the kit does (sha256 over sorted-key canonical JSON), so a
 * consumer holding only the kit can check them.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { COUNTRY_CEILINGS, type CountryCeiling, type CountryCeilingRow } from './ceilings.js';

export { COUNTRY_CEILINGS, type CountryCeiling, type CountryCeilingRow };

// ─────────────────────────────────────────────────────────────────────────────── the registry, named

/** The registry id (spec 279 §3.1). One registry; other registries are read beside it, never into it. */
export const MISSION_REGISTRY_ID = 'urn:ap:registry:gamenight-missions' as const;
export type MissionRegistryId = typeof MISSION_REGISTRY_ID;

/** Entry ids are one per organization, ever — the org's address IS the entry's name. */
export type MissionEntryId = `urn:ap:registry-entry:gamenight-missions/0x${string}`;
export function entryIdFor(org: string): MissionEntryId {
  return `urn:ap:registry-entry:gamenight-missions/${org.toLowerCase() as `0x${string}`}`;
}
export function orgOfEntryId(entryId: string): `0x${string}` | null {
  const m = /^urn:ap:registry-entry:gamenight-missions\/(0x[0-9a-fA-F]{40})$/.exec(entryId);
  return m ? (m[1]!.toLowerCase() as `0x${string}`) : null;
}

/** The two claim slots (spec 279 §3.4). A registry defines its own; the kit only checks hashes fit. */
export const CLAIM_SLOTS = {
  covenant: 'urn:ap:registry-claim-slot:gamenight-missions/covenant',
  presence: 'urn:ap:registry-claim-slot:gamenight-missions/presence',
} as const;

/** The vault records a registration writes at the mission's OWN Home. Confidential ones never leave it. */
export const MISSION_RECORDS = {
  presence: 'cardroom.mission.presence',
  covenant: 'cardroom.mission.covenant',
  contact: 'cardroom.mission.contact',
} as const;

/** A year, then renew — the same ceremony again. */
export const ENTRY_TTL_SECONDS = 365 * 86_400;

// ─────────────────────────────────────────────────────────────────────────────── the presence

export interface MissionPlace {
  /** What the person picked, as the geocoder named it — "Fort Collins, Colorado, United States". */
  label: string;
  /** ISO 3166-1 alpha-2, from the geocoded pick; the ceiling's lookup key. */
  country: string;
  lat: number;
  lng: number;
  /** The mission's REQUEST to be shown exactly. The ceiling decides whether it is honoured. */
  precise: boolean;
}

/** What a mission says about itself. Public by design — this is what the map shows. */
export interface MissionPresenceV1 {
  type: 'MissionPresenceV1';
  /** The org's Smart Agent, lowercased. */
  org: `0x${string}`;
  name: string;
  blurb: string;
  website: string;
  /** BCP-47 tags, e.g. `en`, `es`. */
  languages: string[];
  place: MissionPlace;
  updatedAt: string;
}

export const PRESENCE_LIMITS = { name: 80, blurb: 600, website: 200, label: 160, languages: 8 } as const;

/** Shape-check a presence. Returns the problems, in the words a form can show; empty means good. */
export function checkPresence(p: unknown): string[] {
  const out: string[] = [];
  const x = (p ?? {}) as Partial<MissionPresenceV1>;
  if (x.type !== 'MissionPresenceV1') out.push('not a MissionPresenceV1');
  if (typeof x.org !== 'string' || !/^0x[0-9a-f]{40}$/.test(x.org)) out.push('org must be a lowercase Smart Agent address');
  if (typeof x.name !== 'string' || !x.name.trim()) out.push('a name is needed');
  else if (x.name.length > PRESENCE_LIMITS.name) out.push(`the name is longer than ${PRESENCE_LIMITS.name} characters`);
  if (typeof x.blurb !== 'string' || !x.blurb.trim()) out.push('say what the mission does');
  else if (x.blurb.length > PRESENCE_LIMITS.blurb) out.push(`the blurb is longer than ${PRESENCE_LIMITS.blurb} characters`);
  if (typeof x.website !== 'string' || !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(x.website)) out.push('the website must be an https:// address');
  else if (x.website.length > PRESENCE_LIMITS.website) out.push('the website address is too long');
  if (!Array.isArray(x.languages) || x.languages.length > PRESENCE_LIMITS.languages || x.languages.some((l) => typeof l !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l))) out.push('languages must be a short list of language tags');
  const pl = x.place as Partial<MissionPlace> | undefined;
  if (!pl || typeof pl !== 'object') out.push('a place is needed');
  else {
    if (typeof pl.label !== 'string' || !pl.label.trim() || pl.label.length > PRESENCE_LIMITS.label) out.push('the place needs a name');
    if (typeof pl.country !== 'string' || !/^[A-Z]{2}$/.test(pl.country)) out.push('the place needs a country code');
    if (typeof pl.lat !== 'number' || !Number.isFinite(pl.lat) || Math.abs(pl.lat) > 90) out.push('the place needs a latitude');
    if (typeof pl.lng !== 'number' || !Number.isFinite(pl.lng) || Math.abs(pl.lng) > 180) out.push('the place needs a longitude');
    if (typeof pl.precise !== 'boolean') out.push('precise must be true or false');
  }
  if (typeof x.updatedAt !== 'string' || Number.isNaN(Date.parse(x.updatedAt))) out.push('updatedAt must be a date');
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────── the ceiling

export function countryCeiling(isoOrName: string): CountryCeiling {
  const key = isoOrName.trim().toUpperCase();
  if (!key) return 'precise';
  const row = COUNTRY_CEILINGS.find((r) => r.iso === key || r.name.toUpperCase() === key);
  return row?.ceiling ?? 'precise';
}

export interface GeoPoint { lat: number; lng: number }

/** How exactly a shown point relates to the real one — said on the map, so a coarse pin is never read as exact. */
export type PointGrain = 'exact' | 'nearby' | 'region' | 'hidden';

/** ~3 km: a neighbourhood, not a doorstep. */
const NEARBY_GRID = 0.03;
/** ~110 km: a region. The card room keeps no district boundaries (Gather27 resolves ADM2 units here). */
const REGION_GRID = 1;

function snap(p: GeoPoint, grid: number): GeoPoint {
  return { lat: Math.round(p.lat / grid) * grid, lng: Math.round(p.lng / grid) * grid };
}

/**
 * THE POINT THE CARD ROOM MAY SERVE — never the exact one unless the country's ceiling is `precise` AND
 * the mission asked to be shown exactly. Applied at read time as well as at write time, so a ceiling
 * change coarsens every registration on the next read.
 */
export function displayPoint(place: Pick<MissionPlace, 'country' | 'lat' | 'lng' | 'precise'>): { point: GeoPoint | null; grain: PointGrain } {
  const ceiling = countryCeiling(place.country);
  if (ceiling === 'none') return { point: null, grain: 'hidden' };
  if (ceiling === 'adm2') return { point: snap(place, REGION_GRID), grain: 'region' };
  if (place.precise) return { point: { lat: place.lat, lng: place.lng }, grain: 'exact' };
  return { point: snap(place, NEARBY_GRID), grain: 'nearby' };
}

// ─────────────────────────────────────────────────────────────────────────────── the covenant

/** Three clauses. Fewer than Gather27's four — the fourth (a community body, not a private home) is
 *  about where a gathering happens, and a mission is not a gathering. */
export const MISSION_COVENANT_VERSION = 'gamenight-missions-v1' as const;
export const MISSION_COVENANT_CLAUSES: readonly { id: string; text: string }[] = [
  { id: 'genuine', text: 'This is a genuine mission organization and I am authorised to act for it.' },
  { id: 'use-limitation', text: 'People who reach us through a game night are contacted only about that night and about what we told them we do — no list-building, no onward sharing, no marketing.' },
  { id: 'safety', text: 'Publishing where we are does not endanger anyone who works with us or comes to us.' },
];

/** The steward's signed affirmation — its hash is the `covenant` claim on the entry. */
export interface MissionCovenantAttestationV1 {
  type: 'MissionCovenantAttestationV1';
  version: typeof MISSION_COVENANT_VERSION;
  registryId: MissionRegistryId;
  /** The org the affirmation is about. */
  org: `0x${string}`;
  /** The steward who affirmed — a person's Smart Agent. */
  steward: `0x${string}`;
  clauseIds: string[];
  signedAt: string;
  /** Over `covenantMessage(...)`, by the steward's credential (their SA's ERC-1271 answers for it). */
  signature: `0x${string}`;
}

/** The exact text the steward signs. One line per clause, the binding facts last — readable in a wallet. */
export function covenantMessage(a: Pick<MissionCovenantAttestationV1, 'version' | 'registryId' | 'org' | 'steward' | 'clauseIds' | 'signedAt'>): string {
  const clauses = MISSION_COVENANT_CLAUSES.filter((c) => a.clauseIds.includes(c.id)).map((c, i) => `${i + 1}. ${c.text}`);
  return [
    'Game Night mission covenant',
    ...clauses,
    '',
    `covenant: ${a.version}`,
    `registry: ${a.registryId}`,
    `organization: ${a.org}`,
    `affirmed by: ${a.steward}`,
    `at: ${a.signedAt}`,
  ].join('\n');
}

export function covenantComplete(clauseIds: readonly string[]): boolean {
  return MISSION_COVENANT_CLAUSES.every((c) => clauseIds.includes(c.id));
}

// ─────────────────────────────────────────────────────────────────────────────── hashes

/** Sorted-key canonical JSON — the kit's `canonicalizeJson`, restated so this package needs no viem. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { if (o[k] !== undefined) acc[k] = walk(o[k]); return acc; }, {});
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export type Sha256 = `sha256:${string}`;
export function sha256Of(text: string): Sha256 {
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(text)))}`;
}
/** The `presence` claim: sha256 over the canonical record. */
export function presenceHash(p: MissionPresenceV1): Sha256 {
  return sha256Of(canonicalJson(p));
}
/** The `covenant` claim: sha256 over the canonical attestation, signature included. */
export function covenantHash(a: MissionCovenantAttestationV1): Sha256 {
  return sha256Of(canonicalJson(a));
}
/** The card (agent-profile shape, spec 279 §3.2 — `type`, `displayName`, `description`, `url`). */
export interface MissionCard { type: 'organization'; displayName: string; description: string; url: string }
export function cardOf(p: MissionPresenceV1): MissionCard {
  return { type: 'organization', displayName: p.name, description: p.blurb, url: p.website };
}
export function cardHash(p: MissionPresenceV1): Sha256 {
  return sha256Of(canonicalJson(cardOf(p)));
}

// ─────────────────────────────────────────────────────────────────────────────── what a game sees

/** Enough to name a guest on a night or a table, and to look the rest up. */
export interface MissionRef {
  entryId: MissionEntryId;
  org: `0x${string}`;
  name: string;
}

export type MissionStatus = 'active' | 'suspended' | 'revoked' | 'expired';

/** The public projection of one registration — what the map, the list and the pickers read. No contact. */
export interface MissionListing {
  entryId: MissionEntryId;
  org: `0x${string}`;
  /** The org's typed name, when it has one (`hope-for-the-city.org`). */
  orgName: string | null;
  name: string;
  blurb: string;
  website: string;
  languages: string[];
  place: { label: string; country: string };
  /** What may be shown, per the ceiling — never the exact point unless it says `exact`. */
  point: GeoPoint | null;
  grain: PointGrain;
  status: MissionStatus;
  registeredAt: string;
  expiresAt: string | null;
  /** Which registry this came from — this one, unless §4 of the design is in play. */
  registryId: string;
  /** The hash of the operator's receipt, so a consumer can ask for it and verify it. */
  receiptHash: Sha256 | null;
}

export function refOf(l: Pick<MissionListing, 'entryId' | 'org' | 'name'>): MissionRef {
  return { entryId: l.entryId, org: l.org, name: l.name };
}

// ─────────────────────────────────────────────────────────────────────────────── the registry's profile

/** `RegistryKitProfile` (spec 279 §3.1), served at `GET /missions/registry` so anybody can read what this
 *  registry admits and how. `operatorAgent` is a CAIP-10 id: `eip155:<chain>:<registry SA>`. */
export function missionRegistryProfile(operatorAgent: string) {
  return {
    type: 'RegistryKitProfile' as const,
    registryId: MISSION_REGISTRY_ID,
    name: 'Game Night missions',
    description: 'Mission organizations that may be invited as the guest of a game night. Entries are facets of each organization’s own Smart Agent; the organization registers itself, its steward affirms the covenant, and the card room receipts and logs the admission.',
    membershipPolicy: { policyId: 'gamenight-missions/self-service-with-covenant' },
    claimSlots: [
      { id: CLAIM_SLOTS.covenant, label: 'Mission covenant, affirmed by the steward', valueType: 'attestation' as const, required: true },
      { id: CLAIM_SLOTS.presence, label: 'Presence — name, what it does, website, place', valueType: 'string' as const, required: true },
    ],
    lifecycle: { defaultTtlSeconds: ENTRY_TTL_SECONDS, renewable: true },
    operatorAgent,
  };
}
