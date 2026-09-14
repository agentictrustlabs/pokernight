/**
 * THE MISSION REGISTRY OPERATOR — what the card room does with a registration once the steward's Home has run
 * the ceremony (`docs/MISSION-REGISTRY.md` §2.3).
 *
 * The chain is the anchor: an entry in `AgentRegistryBase` says WHICH card and WHICH claims the mission's own
 * account committed to. Everything the Home hands back on the return leg — the presence, the covenant, the
 * hashes — is checked against that anchor and against itself, line by line, and every line lands in a
 * receipt as verified, failed or not verified. The receipt is signed AS THE REGISTRY OPERATOR (the house's
 * session key under the operator's wire, `MISSIONS_REGISTRY_WIRE`) and appended to a hash-chained log in the
 * operator's own store, `MissionRegistryDO` — the public projection the map and the pickers read. Losing that
 * store is a rebuild from the chain's events and the missions' vaults; nothing here is anybody's record of
 * truth (ADR-0004's test).
 *
 * The confidential contact is kept here for the operators' desk and served on no public read.
 */
import { DurableObject } from 'cloudflare:workers';
import { createPublicClient, encodeAbiParameters, hashMessage, http, keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { verifySessionWrappedSignature, wrapSessionSignature, type DelegationWireV1 } from '@agenticprimitives/a2a';
import { hashDelegation } from '@agenticprimitives/delegation';
import type { CanonicalAgentId } from '@agenticprimitives/types';
import {
  deriveReceiptId, hashBindingProofBody, hashLifecycleEvent, hashReceiptBody, receiptDigest, sha256ToBytes32, signReceipt, urnToBytes32,
  type AdmissionCheck, type RegistrationReceiptBody, type RegistrationReceiptV1, type RegistryEntryId, type RegistryId, type RegistryLifecycleEventKind, type RegistryLifecycleEventV1, type Sha256 as KitSha256,
} from '@agenticprimitives/registry-kit';
import {
  CLAIM_SLOTS, MISSION_REGISTRY_ID, cardHash, checkPresence, covenantComplete, covenantHash, covenantMessage, displayPoint, entryIdFor,
  presenceHash, type MissionCovenantAttestationV1, type MissionEntryId, type MissionListing, type MissionPresenceV1, type MissionStatus, type Sha256,
} from '@pokernight/missions';
import type { Env } from './env.js';
import { nameOfAgent } from './naming.js';

/** What the Home's org-create hands back on `org.registry` (its `MissionRegistryOutcome`). */
export interface MissionEnrolmentPayload {
  registryId: string;
  entryId: string;
  org: string;
  steward: string;
  presence: unknown;
  covenant: unknown;
  cardHash: string;
  bindingProofHash: string;
  claimHashes: string[];
  issuedAt: string;
  expiresAt: number;
  txHash?: string;
  act: 'registered' | 'renewed';
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;

export function missionRegistryConfigured(env: Env): boolean {
  return !!(env.MISSIONS_REGISTRY_WIRE && env.HOUSE_A2A_SESSION_KEY && env.MISSIONS_REGISTRY_SA && env.AGENT_REGISTRY_BASE && env.RPC_URL);
}

/** `eip155:<chain>:<operator SA>` — how the receipt names its signer. */
export function operatorAgentId(env: Env): CanonicalAgentId {
  return `eip155:${Number(env.CHAIN_ID)}:${(env.MISSIONS_REGISTRY_SA ?? '').toLowerCase()}` as CanonicalAgentId;
}

const ENTRY_VIEW_ABI = [
  { type: 'function', name: 'getEntry', stateMutability: 'view', inputs: [{ name: 'registryId', type: 'bytes32' }, { name: 'entryId', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [{ name: 'subjectAgent', type: 'address' }, { name: 'cardHash', type: 'bytes32' }, { name: 'bindingProofHash', type: 'bytes32' }, { name: 'claimsRoot', type: 'bytes32' }, { name: 'status', type: 'uint8' }, { name: 'registeredAtBucket', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }] }] },
] as const;
const VALIDATOR_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;

export interface ChainEntry { subjectAgent: string; cardHash: Hex; bindingProofHash: Hex; claimsRoot: Hex; status: number; registeredAtBucket: bigint; expiresAt: bigint }

/** The entry as the chain holds it, or null when there is none. */
export async function readChainEntry(env: Env, entryId: string): Promise<ChainEntry | null> {
  const client = createPublicClient({ transport: http(env.RPC_URL) });
  try {
    const e = await client.readContract({ address: env.AGENT_REGISTRY_BASE as Address, abi: ENTRY_VIEW_ABI, functionName: 'getEntry', args: [urnToBytes32(MISSION_REGISTRY_ID as RegistryId), urnToBytes32(entryId as RegistryEntryId)] });
    if (Number(e.status) === 0) return null;
    return { subjectAgent: e.subjectAgent, cardHash: e.cardHash, bindingProofHash: e.bindingProofHash, claimsRoot: e.claimsRoot, status: Number(e.status), registeredAtBucket: e.registeredAtBucket, expiresAt: e.expiresAt };
  } catch {
    return null;
  }
}

export function chainStatus(e: ChainEntry, nowSec = Math.floor(Date.now() / 1000)): MissionStatus {
  if (e.status === 2) return 'suspended';
  if (e.status === 3) return 'revoked';
  if (e.expiresAt !== 0n && Number(e.expiresAt) <= nowSec) return 'expired';
  return 'active';
}

export interface Admission {
  ok: boolean;
  presence: MissionPresenceV1;
  covenant: MissionCovenantAttestationV1;
  orgName: string | null;
  verified: { check: AdmissionCheck; ref: string; at: string }[];
  failed: { check: AdmissionCheck; reason: string; at: string }[];
  notVerified: { check: AdmissionCheck; reason: 'not-attempted' | 'unavailable' | 'policy-skipped' }[];
  chain: ChainEntry | null;
}

/**
 * THE ADMISSION PIPELINE for one enrolment. Every check lands in exactly one list. `ok` is "every mandatory
 * check verified" — shape, the hashes against each other, the binding proof, the chain, the covenant's
 * signature. The derived type is recorded but not mandatory: the Home created the organization.
 */
export async function admitMission(env: Env, p: MissionEnrolmentPayload, steward: string): Promise<Admission | { ok: false; error: string }> {
  const at = new Date().toISOString();
  const verified: Admission['verified'] = [];
  const failed: Admission['failed'] = [];
  const notVerified: Admission['notVerified'] = [];
  const pass = (check: AdmissionCheck, ref: string) => verified.push({ check, ref, at });
  const failure = (check: AdmissionCheck, reason: string) => failed.push({ check, reason, at });

  // shape
  const presence = p.presence as MissionPresenceV1;
  const covenant = p.covenant as MissionCovenantAttestationV1;
  const problems = [
    ...checkPresence(presence),
    ...(p.registryId === MISSION_REGISTRY_ID ? [] : [`registry ${p.registryId} is not this one`]),
    ...(ADDR.test(p.org) ? [] : ['org is not an address']),
    ...(covenant?.type === 'MissionCovenantAttestationV1' && Array.isArray(covenant.clauseIds) && covenantComplete(covenant.clauseIds) ? [] : ['the covenant is not the whole covenant']),
    ...(covenant && typeof covenant.signature === 'string' && /^0x[0-9a-fA-F]+$/.test(covenant.signature) ? [] : ['the covenant carries no signature']),
    ...(SHA.test(p.cardHash) && SHA.test(p.bindingProofHash) && Array.isArray(p.claimHashes) && p.claimHashes.length === 2 && p.claimHashes.every((h) => SHA.test(h)) ? [] : ['the hashes are not sha256 hashes']),
  ];
  if (problems.length) return { ok: false, error: problems.join('; ') };
  const org = p.org.toLowerCase() as `0x${string}`;
  const entryId = entryIdFor(org);
  if (p.entryId !== entryId) return { ok: false, error: `entry ${p.entryId} is not this organization's entry` };
  if (presence.org !== org || covenant.org !== org) return { ok: false, error: 'the presence and the covenant must be about the registered organization' };
  if (covenant.steward !== steward.toLowerCase() || covenant.registryId !== MISSION_REGISTRY_ID) return { ok: false, error: 'the covenant was affirmed by somebody else, or for another registry' };
  pass('shape', entryId);

  // the hashes against each other: card, presence, covenant → what the Home says it committed to
  const wantCard = cardHash(presence);
  const wantPresence = presenceHash(presence);
  const wantCovenant = covenantHash(covenant);
  const hashesAgree = wantCard === p.cardHash && p.claimHashes[0] === wantCovenant && p.claimHashes[1] === wantPresence;
  if (hashesAgree) pass('claim-slot', `${CLAIM_SLOTS.covenant}=${wantCovenant} ${CLAIM_SLOTS.presence}=${wantPresence}`);
  else failure('claim-slot', 'the records do not hash to the claims the entry carries');

  // the binding proof — recomputed over what was said, compared to what was committed
  const registryAddress = env.AGENT_REGISTRY_BASE as Address;
  const proofHash = await hashBindingProofBody({ registryId: MISSION_REGISTRY_ID as RegistryId, entryId: entryId as RegistryEntryId, subjectAgent: org, cardHash: p.cardHash as KitSha256, claimHashes: p.claimHashes as KitSha256[], issuedAt: p.issuedAt, chainId: Number(env.CHAIN_ID), registryAddress });
  if (proofHash === p.bindingProofHash) pass('binding-proof', proofHash);
  else failure('binding-proof', 'the binding proof does not hash to what the entry carries');

  // the chain — the anchor
  const chain = await readChainEntry(env, entryId);
  if (!chain) failure('authority-proof', 'the chain holds no entry for this organization');
  else if (chain.subjectAgent.toLowerCase() !== org) failure('authority-proof', `the chain's entry belongs to ${chain.subjectAgent}`);
  else if (chainStatus(chain) !== 'active') failure('authority-proof', `the chain's entry is ${chainStatus(chain)}`);
  else if (chain.cardHash.toLowerCase() !== sha256ToBytes32(p.cardHash as KitSha256).toLowerCase() || chain.bindingProofHash.toLowerCase() !== sha256ToBytes32(p.bindingProofHash as KitSha256).toLowerCase()) failure('authority-proof', 'the chain committed to a different card or proof');
  else {
    const root = keccak256(encodeAbiParameters([{ type: 'bytes32[]' }], [p.claimHashes.map((h) => sha256ToBytes32(h as KitSha256))]));
    if (chain.claimsRoot.toLowerCase() !== root.toLowerCase()) failure('authority-proof', 'the chain committed to different claims');
    else pass('authority-proof', p.txHash ?? `registeredAtBucket=${chain.registeredAtBucket}`);
  }

  // the covenant's signature: the steward's Smart Agent answers for their credential (ERC-1271)
  const validator = (env.UNIVERSAL_SIGNATURE_VALIDATOR ?? '').trim();
  if (!ADDR.test(validator)) notVerified.push({ check: 'card-bundle', reason: 'unavailable' });
  else {
    const digest = hashMessage(covenantMessage(covenant));
    const client = createPublicClient({ transport: http(env.RPC_URL) });
    const ok = await client.readContract({ address: validator as Address, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [covenant.steward as Address, digest, covenant.signature as Hex] }).catch(() => false);
    if (ok === true) pass('card-bundle', wantCovenant);
    else failure('card-bundle', 'the steward\'s agent does not accept the covenant\'s signature');
  }

  // the derived type — recorded, not mandatory (the Home deployed it as an organization)
  const orgName = await nameOfAgent(env, org).catch(() => null);
  if (orgName?.endsWith('.org')) pass('derived-type', orgName);
  else notVerified.push({ check: 'derived-type', reason: 'unavailable' });
  notVerified.push({ check: 'delegation-live', reason: 'policy-skipped' }, { check: 'publication', reason: 'policy-skipped' }, { check: 'endpoint-control', reason: 'policy-skipped' }, { check: 'suffix-consistency', reason: 'policy-skipped' });

  return { ok: failed.length === 0, presence, covenant, orgName, verified, failed, notVerified, chain };
}

/** The operator signs the 32-byte receipt digest with the house session key, wrapped in the operator's wire —
 *  the same form a Home verifies for an A2A session, checked by the operator SA's own `isValidSignature`. */
function operatorSigner(env: Env) {
  const key = privateKeyToAccount(env.HOUSE_A2A_SESSION_KEY as Hex);
  const wire = JSON.parse(env.MISSIONS_REGISTRY_WIRE as string) as DelegationWireV1;
  return {
    signer: operatorAgentId(env),
    scheme: 'session-key' as const,
    sign: async (digest: Hex) => wrapSessionSignature(wire, await key.sign({ hash: digest })),
  };
}

export async function receiptFor(env: Env, a: Admission, p: MissionEnrolmentPayload): Promise<RegistrationReceiptV1> {
  const admittedAt = new Date().toISOString();
  const subjectAgent = `eip155:${Number(env.CHAIN_ID)}:${a.presence.org}` as CanonicalAgentId;
  const body: RegistrationReceiptBody = {
    type: 'RegistrationReceiptV1',
    receiptId: await deriveReceiptId({ registryId: MISSION_REGISTRY_ID as RegistryId, entryId: p.entryId as RegistryEntryId, subjectAgent, admittedAt }),
    registryId: MISSION_REGISTRY_ID as RegistryId,
    entryId: p.entryId as RegistryEntryId,
    subjectAgent,
    subjectType: 'org',
    ...(a.orgName ? { name: a.orgName } : {}),
    verified: a.verified,
    failed: a.failed,
    notVerified: a.notVerified,
    versions: { cardHash: p.cardHash as KitSha256, ontologyVersion: 'card-room', kitVersion: '0.0.0-alpha.12' },
    mappings: p.txHash ? [{ projection: 'faithchain:AgentRegistryBase', ref: p.txHash }] : [],
    admittedAt,
    expiresAt: new Date(p.expiresAt * 1000).toISOString(),
  };
  return signReceipt(body, operatorSigner(env));
}

// ─────────────────────────────────────────────────────────────────────────── the operator's store

interface EntryRow extends Record<string, SqlStorageValue> {
  entry_id: string; org: string; org_name: string | null; presence_json: string; covenant_json: string; contact: string | null;
  status: string; registered_at: string; expires_at: string | null; receipt_json: string | null; receipt_hash: string | null; updated_at: string;
}
interface LogRow extends Record<string, SqlStorageValue> { seq: number; event_json: string }

export function listingOf(row: EntryRow): MissionListing {
  const presence = JSON.parse(row.presence_json) as MissionPresenceV1;
  const { point, grain } = displayPoint(presence.place);
  return {
    entryId: row.entry_id as MissionEntryId,
    org: row.org as `0x${string}`,
    orgName: row.org_name,
    name: presence.name,
    blurb: presence.blurb,
    website: presence.website,
    languages: presence.languages,
    place: { label: presence.place.label, country: presence.place.country },
    point,
    grain,
    status: row.status as MissionStatus,
    registeredAt: row.registered_at,
    expiresAt: row.expires_at,
    registryId: MISSION_REGISTRY_ID,
    receiptHash: (row.receipt_hash as Sha256 | null) ?? null,
  };
}

/**
 * The registry operator's own store: the projection of every entry, the receipts, and the append-only
 * hash-chained lifecycle log (spec 346 §7.3). One object for the one registry.
 */
export class MissionRegistryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS entries (
          entry_id      TEXT PRIMARY KEY,
          org           TEXT NOT NULL,
          org_name      TEXT,
          presence_json TEXT NOT NULL,
          covenant_json TEXT NOT NULL,
          contact       TEXT,
          status        TEXT NOT NULL,
          registered_at TEXT NOT NULL,
          expires_at    TEXT,
          receipt_json  TEXT,
          receipt_hash  TEXT,
          updated_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS log (
          seq        INTEGER PRIMARY KEY,
          event_json TEXT NOT NULL
        );`);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/list') return json({ missions: this.list() });
    if (request.method === 'GET' && url.pathname === '/entry') {
      const row = this.row(url.searchParams.get('id') ?? '');
      if (!row) return json({ error: 'no such mission' }, 404);
      return json({ listing: listingOf(row), receipt: row.receipt_json ? JSON.parse(row.receipt_json) : null, events: this.eventsFor(row.entry_id).map(wireEvent), ...(url.searchParams.get('operator') === '1' ? { contact: row.contact } : {}) });
    }
    if (request.method === 'GET' && url.pathname === '/log') return json({ events: this.readLog(Number(url.searchParams.get('from') ?? 0), 500).map(wireEvent) });
    if (request.method === 'POST' && url.pathname === '/admit') {
      const b = (await request.json()) as { presence: MissionPresenceV1; covenant: MissionCovenantAttestationV1; orgName: string | null; contact: string | null; receipt: RegistrationReceiptV1; receiptHash: string; expiresAt: number; act: 'registered' | 'renewed'; txHash?: string };
      const at = new Date().toISOString();
      const entryId = entryIdFor(b.presence.org);
      const existed = !!this.row(entryId);
      this.ctx.storage.sql.exec(
        `INSERT INTO entries (entry_id, org, org_name, presence_json, covenant_json, contact, status, registered_at, expires_at, receipt_json, receipt_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET org_name = excluded.org_name, presence_json = excluded.presence_json, covenant_json = excluded.covenant_json,
           contact = excluded.contact, status = 'active', expires_at = excluded.expires_at, receipt_json = excluded.receipt_json, receipt_hash = excluded.receipt_hash, updated_at = excluded.updated_at`,
        entryId, b.presence.org, b.orgName, JSON.stringify(b.presence), JSON.stringify(b.covenant), b.contact, at, new Date(b.expiresAt * 1000).toISOString(), JSON.stringify(b.receipt), b.receiptHash, at,
      );
      await this.append(existed || b.act === 'renewed' ? 'ENTRY_RENEWED' : 'ENTRY_REGISTERED', entryId, b.presence.org, { receiptId: b.receipt.receiptId, cardHash: b.receipt.versions.cardHash, ...(b.txHash ? { txHash: b.txHash as Hex } : {}) });
      const row = this.row(entryId)!;
      return json({ listing: listingOf(row) }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/status') {
      const b = (await request.json()) as { entryId: string; status: MissionStatus; txHash?: string };
      const row = this.row(b.entryId);
      if (!row) return json({ error: 'no such mission' }, 404);
      this.ctx.storage.sql.exec(`UPDATE entries SET status = ?, updated_at = ? WHERE entry_id = ?`, b.status, new Date().toISOString(), b.entryId);
      const kind: RegistryLifecycleEventKind = b.status === 'suspended' ? 'ENTRY_SUSPENDED' : b.status === 'revoked' ? 'ENTRY_REVOKED' : b.status === 'expired' ? 'ENTRY_EXPIRED' : 'REVALIDATION_PASSED';
      await this.append(kind, b.entryId, row.org, b.txHash ? { txHash: b.txHash as Hex } : {});
      return json({ listing: listingOf(this.row(b.entryId)!) });
    }
    return json({ error: 'not found' }, 404);
  }

  private row(entryId: string): EntryRow | null {
    return (this.ctx.storage.sql.exec<EntryRow>(`SELECT * FROM entries WHERE entry_id = ?`, entryId).toArray()[0] as EntryRow | undefined) ?? null;
  }

  /** Every entry, the derived status applied — an expiry is a fact about the clock, never a row somebody flips. */
  private list(): MissionListing[] {
    const now = new Date().toISOString();
    return this.ctx.storage.sql.exec<EntryRow>(`SELECT * FROM entries ORDER BY registered_at DESC`).toArray().map((r) => {
      const l = listingOf(r as EntryRow);
      if (l.status === 'active' && l.expiresAt && l.expiresAt <= now) l.status = 'expired';
      return l;
    });
  }

  private eventsFor(entryId: string): RegistryLifecycleEventV1[] {
    return this.readLog(0, 10_000).filter((e) => e.entryId === entryId);
  }

  private readLog(from: number, limit: number): RegistryLifecycleEventV1[] {
    return this.ctx.storage.sql.exec<LogRow>(`SELECT seq, event_json FROM log WHERE seq >= ? ORDER BY seq ASC LIMIT ?`, from, limit).toArray()
      .map((r) => { const e = JSON.parse((r as LogRow).event_json) as Omit<RegistryLifecycleEventV1, 'sequence'> & { sequence: string }; return { ...e, sequence: BigInt(e.sequence) }; });
  }

  /** Append one event: sequence = head + 1, previousDigest = head's digest, digest over the canonical body. */
  private async append(kind: RegistryLifecycleEventKind, entryId: string, org: string, refs: RegistryLifecycleEventV1['refs']): Promise<void> {
    const head = this.ctx.storage.sql.exec<LogRow>(`SELECT seq, event_json FROM log ORDER BY seq DESC LIMIT 1`).toArray()[0] as LogRow | undefined;
    const previous = head ? (JSON.parse(head.event_json) as { digest: KitSha256 }) : null;
    const sequence = head ? BigInt(head.seq) + 1n : 0n;
    const body: Omit<RegistryLifecycleEventV1, 'digest'> = {
      type: 'RegistryLifecycleEventV1',
      eventId: crypto.randomUUID(),
      kind,
      registryId: MISSION_REGISTRY_ID as RegistryId,
      entryId: entryId as RegistryEntryId,
      subjectAgent: `eip155:${Number(this.env.CHAIN_ID)}:${org}` as CanonicalAgentId,
      refs,
      occurredAt: new Date().toISOString(),
      sequence,
      ...(previous ? { previousDigest: previous.digest } : {}),
    };
    const digest = await hashLifecycleEvent(body);
    this.ctx.storage.sql.exec(`INSERT INTO log (seq, event_json) VALUES (?, ?)`, Number(sequence), JSON.stringify({ ...body, sequence: sequence.toString(), digest }));
  }
}

/** JSON has no bigint: the sequence travels as a decimal string (the kit's own convention for publication sequences). */
function wireEvent(e: RegistryLifecycleEventV1): Omit<RegistryLifecycleEventV1, 'sequence'> & { sequence: string } {
  return { ...e, sequence: e.sequence.toString() };
}

export async function receiptHashOf(r: RegistrationReceiptV1): Promise<string> {
  return hashReceiptBody(r);
}

/**
 * VERIFY A RECEIPT the way the estate verifies any session-wrapped signature (`scheme: 'session-key'`): unwrap
 * the operator's wire from the signature, check the wire is the operator's (delegator = the registry operator
 * SA), that the operator's account accepts it (ERC-1271 over the delegation digest), that it is not revoked
 * on the DelegationManager, and that the inner ECDSA over the receipt digest is the wire's delegate. The
 * account's own `isValidSignature` does not route this form (only its custodians', passkeys and approved
 * hashes), which is why the kit's `verifyReceipt` is given THIS as its verifier.
 */
export async function verifyOperatorReceipt(env: Env, receipt: RegistrationReceiptV1): Promise<{ ok: boolean; reason?: string }> {
  const operator = (env.MISSIONS_REGISTRY_SA ?? '').toLowerCase();
  if (receipt.proof.signer.toLowerCase() !== `eip155:${Number(env.CHAIN_ID)}:${operator}`) return { ok: false, reason: 'signer is not this registry\'s operator' };
  const enforcers = { timestamp: (env.TIMESTAMP_ENFORCER ?? '').trim(), allowedMethods: (env.ALLOWED_METHODS_ENFORCER ?? '').trim() };
  const dm = (env.DELEGATION_MANAGER ?? '').trim() as Address;
  const validator = (env.UNIVERSAL_SIGNATURE_VALIDATOR ?? '').trim() as Address;
  if (!enforcers.timestamp || !enforcers.allowedMethods || !dm || !validator) return { ok: false, reason: 'the chain addresses a wire is checked against are not configured' };
  const client = createPublicClient({ transport: http(env.RPC_URL) });
  const chainId = Number(env.CHAIN_ID);
  const REVOKED_ABI = [{ type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] }] as const;
  const digest = receiptDigest(await hashReceiptBody(receipt));
  const ok = await verifySessionWrappedSignature({
    signer: operator as Address,
    digest,
    signature: receipt.proof.signature,
    enforcers,
    verifyDelegationSig: async (d) => (await client.readContract({ address: validator, abi: VALIDATOR_ABI, functionName: 'isValidSig', args: [d.delegator as Address, hashDelegation(d, chainId, dm) as Hex, d.signature as Hex] }).catch(() => false)) === true,
    isRevoked: async (d) => (await client.readContract({ address: dm, abi: REVOKED_ABI, functionName: 'isRevoked', args: [hashDelegation(d, chainId, dm) as Hex] }).catch(() => true)) === true,
  });
  return ok ? { ok: true } : { ok: false, reason: 'the operator\'s wire or its signature over this receipt did not verify' };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
