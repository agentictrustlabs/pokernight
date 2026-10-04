/**
 * A CHARACTER CHARTERS A TEAM, A CIRCLE, A CHURCH — the field app's own ceremonies, run by the season as the
 * character's act (docs/FIELD-OPERATIONS.md §5).
 *
 * In the field app a person presses "Create team": ONE HOME APPROVAL, and a real team agent exists with its own
 * records and roster, the roster is invited and told, and the creator is its steward. A season does the same thing
 * when a part founds a team or a circle, and nothing is seeded for it: the agent is deployed, its vault bound, its
 * storage planes granted, it is linked at the Homes of the people who should see it, and its first records are
 * written — the steps engage's own seeds take, in the same order, against the same doors.
 *
 * WHO SIGNS. Every step needs the CUSTODIAN's signature — the EOA that custodies the character's persona at the
 * Home (Naomi is `naomi-elena.me`, custodied by Elena). The Worker holds no key: a DEMO person's Home signs for
 * them on request (`/connect/persona-sign`, the same door the field app's own ceremonies use for a demo account),
 * reached with the `homeSession` a demo sign-in hands out. That is a DEMO estate's property and is said here so
 * nobody mistakes it for the production path, where the custodian's own device signs the one approval.
 *
 * THE STEWARD IS THE CHARACTER, NOT THE CUSTODIAN. The team's stewardship delegation names the character's persona;
 * the custodian and the workspace's custodian are linked as MEMBERS so the field app shows them the team. A member
 * the steward invites gets a roster row at once (the steward's act) and, when they join, a membership wire the
 * custodian signs — exactly the two halves the field app's invite dialog describes.
 *
 * A charter is SLOW (deploy, custody visible on chain, four grants: a minute or two) and the Home 502s now and then,
 * so it runs as a CHECKPOINTED machine: `advance` takes one step and returns, the season object persists the
 * progress and calls again on its next wake; a step that fails is retried, and after enough failures the charter is
 * marked failed and the body stays a body with no agent — the season never waits on it.
 */
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/faithchain';
import {
  ROOT_AUTHORITY, buildCaveat, buildVaultKeyUseCaveat, buildVaultRecordScopeCaveat,
  encodeAllowedMethodsTerms, encodeAllowedTargetsTerms, encodeTimestampTerms, encodeValueTerms, hashDelegation,
} from '@agenticprimitives/delegation';
import { skillSelector } from '@agenticprimitives/a2a';
import { canonicalizeJson, jcsCanonicalize, type Address, type Hex } from '@agenticprimitives/types';
import { bytesToHex, encodeAbiParameters, keccak256, recoverMessageAddress, stringToBytes, toBytes } from 'viem';

/** Where the estate's doors are. In the estate note; defaults are faithnet's. */
export interface EstateDoors {
  home: string; clientId: string; chainId: number;
  a2a: string; mcp: string; origin: string;
  /** The Home's delivery and interactions service agents — the two planes an org's storage is granted to. */
  deliveryServiceSa: string; interactionsServiceSa: string;
}
export const DEFAULT_DOORS: Omit<EstateDoors, 'home' | 'clientId' | 'chainId'> = {
  a2a: 'https://a2a.faithnet.io', mcp: 'https://mcp.faithnet.io', origin: 'https://www.faithnet.me',
  deliveryServiceSa: '0x0AF2455e3f76594E81d9042aD5FE22A5A35dc57f', interactionsServiceSa: '0x39508624387fed3b9d6dd15ba86d3ace8a3f0a6a',
};
const MCP_SERVER_ID = 'demo-mcp';
/**
 * Spec 408 §2.1 session-audience sentinel — the DELEGATES a DEL-001 session leaf's key may present the
 * principal's delegations to. The estate's vault plane now REFUSES a leaf that carries no audience
 * (a no-audience leaf reads as stale), so an org leaf must name both service agents or every content
 * read answers "auth failed — mcp: auth failed". `@agenticprimitives/delegation` alpha.24 (this repo's
 * pin) predates the builder, so the sentinel is inlined here — `sentinelAddress('urn:smart-agent:session-
 * audience')` = the first 20 bytes of its keccak256 (off-chain only; judged in the vault, never redeemed
 * on chain), cross-checked against the live lib. Terms are `abi.encode(address[] delegates)`.
 */
const SESSION_AUDIENCE_ENFORCER = '0x8176cd7441055a9022ff24c5447d42be161673b4' as Address;

export type CharterKind = 'team' | 'circle' | 'church';
export interface CharterSpec {
  kind: CharterKind;
  name: string;
  purpose: string | null;
  /** The demo person whose Home custodies the founding character's persona — who signs. */
  custodian: string;
  /** The character's persona — the steward of a team, the facilitator of a body. */
  steward: { sa: string; name: string };
  /** People linked as MEMBERS so the field app shows them the agent (the custodian, the workspace's custodian). */
  viewers: string[];
  /**
   * WHERE IT HANGS IN THE TRUST GRAPH: the agent this one is held under in each person's tree — the GOVERNING ORG
   * for a team (the org is the hub, 2026-10-03: `org → { members, teams, workspace }`, never `org → workspace →
   * teams`), the team for a circle or church. The Home draws an organization's graph from exactly this (`parent` on
   * the link), so hanging a team under the org is what makes it one of the org's teams rather than the workspace's.
   */
  under: string;
}
export type CharterStep = 'deploy' | 'vault' | 'link' | 'storage' | 'membership' | 'done' | 'failed';
/** What the Home holds for one party of an org: the membership record's key and the two-sided credential's digest. */
export interface Standing { membership?: string; credential?: string; stewardship?: string; /** who, and the role the credential's terms name */ who?: string; role?: string; at: number }
export interface CharterProgress {
  step: CharterStep;
  sa?: string;
  salt?: string;
  custodianEoa?: string;
  linked?: string[];
  /** The custodian holds a stewardship link too (the library writes as them); older charters are repaired to this. */
  custodianSteward?: boolean;
  /** The people's links hang under `spec.under`; older charters are repaired to this. */
  parented?: boolean;
  /** The org's own `org.profile` was written into its vault (Settings → Profile); a charter that lacks it retries. */
  profiled?: boolean;
  /** Which scope list the interactions grant was minted with (`STORAGE_V`); an older one is re-granted. */
  storageV?: number;
  /** THE THREE RECORDS, per party (keyed by SA): the organization's own membership record, the countersigned has-member
   *  credential, and for the steward the steward-of credential. Written by the Home's own ceremonies, never by hand. */
  standing?: Record<string, Standing>;
  error?: string;
  tries: number;
  at: number;
}
export const MAX_TRIES = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lower = (s: string) => s.toLowerCase();

// ── the Home signs for a demo custodian ───────────────────────────────────────────────────────────────────
export interface Signer { handle: string; sa: Address; eoa: Address; sign: (digest: Hex) => Promise<Hex>; homeSession: string; idToken: string }
const signers = new Map<string, Promise<Signer>>();
/** A demo person's Home as their signer: who they are, which EOA signs for them, and a way to sign a digest. Cached per isolate. */
export function signerFor(doors: Pick<EstateDoors, 'home' | 'clientId'>, handle: string): Promise<Signer> {
  const key = `${doors.home}|${handle}`;
  if (!signers.has(key)) {
    signers.set(key, (async () => {
      const r = await fetch(`${doors.home}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, client_id: doors.clientId }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; sub?: string; agent?: string; id_token?: string; homeSession?: string; error?: string };
      if (!j.homeSession || !j.id_token || !j.agent) throw new Error(`demo-signin ${handle}: ${j.error ?? r.status}`);
      const sign = async (digest: Hex): Promise<Hex> => {
        const s = await fetch(`${doors.home}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${j.homeSession}` }, body: JSON.stringify({ digest }) });
        const b = (await s.json().catch(() => ({}))) as { ok?: boolean; persona?: boolean; signature?: Hex; error?: string };
        if (!b.ok || !b.signature) throw new Error(`persona-sign ${handle}: ${b.error ?? (b.persona === false ? 'not a demo account' : s.status)}`);
        return b.signature;
      };
      const probe = `0x${'11'.repeat(32)}` as Hex;
      const eoa = await recoverMessageAddress({ message: { raw: probe }, signature: await sign(probe) });
      return { handle, sa: lower(j.agent) as Address, eoa, sign, homeSession: j.homeSession, idToken: j.id_token };
    })().catch((e) => { signers.delete(key); throw e; }));
  }
  return signers.get(key)!;
}

/**
 * A PERSONA'S OWN SESSION — "sign in as another name of the same demo person": the Home mints a session whose subject IS
 * the persona, for a person-class agent the custodian's Home lists as a name of theirs. It is what lets a character
 * countersign its own credential and record its own membership, the way the Home's doors insist a member does. The
 * persona's custodian still signs (the same key custodies both); only the session changes hands.
 */
const personaSessions = new Map<string, Promise<{ sa: Address; homeSession: string; idToken: string }>>();
export function personaSession(doors: Pick<EstateDoors, 'home' | 'clientId'>, custodian: string, personaSa: string): Promise<{ sa: Address; homeSession: string; idToken: string }> {
  const key = `${doors.home}|${custodian}|${lower(personaSa)}`;
  if (!personaSessions.has(key)) {
    personaSessions.set(key, (async () => {
      const r = await fetch(`${doors.home}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: custodian, as: lower(personaSa), client_id: doors.clientId }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; agent?: string; id_token?: string; homeSession?: string; error?: string };
      if (!j.homeSession || !j.id_token || lower(j.agent ?? '') !== lower(personaSa)) throw new Error(`demo-signin as ${personaSa.slice(0, 10)}… under ${custodian}: ${j.error ?? r.status}`);
      return { sa: lower(personaSa) as Address, homeSession: j.homeSession, idToken: j.id_token };
    })().catch((e) => { personaSessions.delete(key); throw e; }));
  }
  return personaSessions.get(key)!;
}

// ── the doors ─────────────────────────────────────────────────────────────────────────────────────────────
async function csrf(a2a: string, origin: string): Promise<{ token: string; cookie: string }> {
  const r = await fetch(`${a2a}/auth/csrf`, { headers: { origin } });
  const setc = (typeof (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function' ? (r.headers as unknown as { getSetCookie: () => string[] }).getSetCookie() : [r.headers.get('set-cookie') ?? '']).filter(Boolean);
  const j = (await r.json().catch(() => ({}))) as { token?: string; csrfToken?: string; csrf?: string };
  return { token: j.token ?? j.csrfToken ?? j.csrf ?? '', cookie: setc.map((c) => c.split(';')[0]).join('; ') };
}
const randSalt = (): bigint => { const b = crypto.getRandomValues(new Uint8Array(16)); let s = 0n; for (const x of b) s = (s << 8n) | BigInt(x); return s; };
const jsonOf = async (r: Response): Promise<Record<string, unknown>> => (await r.json().catch(() => ({}))) as Record<string, unknown>;

/** 1 · DEPLOY the Smart Agent, custodied by the custodian's EOA. */
async function deploy(doors: EstateDoors, signer: Signer): Promise<{ sa: string; salt: string }> {
  const salt = randSalt();
  const c = await csrf(doors.a2a, doors.origin);
  const H = { 'content-type': 'application/json', origin: doors.origin, cookie: c.cookie, 'x-csrf-token': c.token };
  const built = await jsonOf(await fetch(`${doors.a2a}/session/deploy`, { method: 'POST', headers: H, body: JSON.stringify({ custodians: [signer.eoa], salt: salt.toString() }) }));
  if (!built.ok || !built.userOp || typeof built.userOpHash !== 'string') throw new Error(`deploy build: ${JSON.stringify(built).slice(0, 200)}`);
  const signature = await signer.sign(built.userOpHash as Hex);
  const sub = await jsonOf(await fetch(`${doors.a2a}/session/deploy/submit`, { method: 'POST', headers: H, body: JSON.stringify({ userOp: { ...(built.userOp as Record<string, unknown>), signature } }) }));
  if (!sub.ok || typeof sub.deployedAddress !== 'string') throw new Error(`deploy submit: ${JSON.stringify(sub).slice(0, 200)}`);
  return { sa: sub.deployedAddress, salt: salt.toString() };
}

/** 2 · BIND THE VAULT: provision a key for the agent (custody must be visible on chain), then authorize the server to use it. */
async function bindVault(doors: EstateDoors, signer: Signer, sa: string): Promise<void> {
  const owner = lower(sa);
  let pj: Record<string, unknown> = {};
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const challenge = keccak256(toBytes(['demo-mcp:vault-key-provision:v1', owner, String(issuedAt)].join('\n')));
    const proof = await signer.sign(challenge);
    const pr = await fetch(`${doors.mcp}/custody/vault-key/provision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, issuedAt, proof }) });
    pj = await jsonOf(pr);
    if (pj.ok && pj.kmsKeyRef) break;
    if (pr.status !== 401) throw new Error(`vault provision ${pr.status}: ${JSON.stringify(pj).slice(0, 200)}`);
    if (attempt === 8) throw new Error('vault provision still 401 — custody not yet visible on chain');
    await sleep(5000);
  }
  const si = await jsonOf(await fetch(`${doors.mcp}/custody/vault-key/server-info`));
  if (typeof si.serverKey !== 'string') throw new Error(`server-info: ${JSON.stringify(si).slice(0, 200)}`);
  const resources = (si.defaultResources as string[] | undefined) ?? ['person-pii', 'org-sensitive', 'profile'];
  const ceiling = (si.classificationCeiling as string | undefined) ?? 'regulated.high';
  const ops = (si.ops as string[] | undefined) ?? ['read', 'write'];
  const validUntil = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const d = { delegator: owner as Address, delegate: si.serverKey as Address, authority: ROOT_AUTHORITY, caveats: [buildVaultKeyUseCaveat({ vaultId: MCP_SERVER_ID, kmsKeyRef: pj.kmsKeyRef as string, resources, classificationCeiling: ceiling, ops, noSubdelegation: true } as never)], salt: randSalt(), signature: '0x' as Hex };
  d.signature = await signer.sign(hashDelegation(d, doors.chainId, CONTRACTS.delegationManager));
  const bj = await jsonOf(await fetch(`${doors.mcp}/custody/vault-key/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, vaultId: MCP_SERVER_ID, kmsKeyRef: pj.kmsKeyRef, allowedResources: resources, classificationCeiling: ceiling, ops, expiresAt: new Date(validUntil * 1000).toISOString(), authorization: { ...d, salt: d.salt.toString() } }) }));
  if (!bj.ok) throw new Error(`vault bind: ${JSON.stringify(bj).slice(0, 200)}`);
}

// ── links at the Home ─────────────────────────────────────────────────────────────────────────────────────
const contentHashOf = (f: { orgAgent: string; orgName: string; purpose: string; requestedBy: string }): Hex =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [f.orgAgent as Address, keccak256(toBytes(f.orgName)), keccak256(toBytes(f.purpose)), keccak256(toBytes(f.requestedBy))]));
const writeChallenge = (a: { person: string; orgAgent: string; contentHash: Hex; nonce: Hex; expiry: number }): Hex =>
  keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [keccak256(toBytes('related-agents:write:v2')), a.person as Address, a.orgAgent as Address, a.contentHash, a.nonce, BigInt(a.expiry)]));
const siteCaveats = (validUntil: number) => [
  buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
  buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
  buildCaveat(CONTRACTS.allowedTargetsEnforcer, encodeAllowedTargetsTerms([CONTRACTS.agentRelationship, CONTRACTS.agentNameRegistry, CONTRACTS.permissionlessSubregistry])),
];
/** STEWARDSHIP: org → steward, the shape the Home reads as "speaks for it" — governance targets, no record scope. */
async function stewardshipWire(doors: EstateDoors, orgSigner: Signer, orgSa: string, stewardSa: string) {
  const d = { delegator: lower(orgSa) as Address, delegate: lower(stewardSa) as Address, authority: ROOT_AUTHORITY, caveats: siteCaveats(Math.floor(Date.now() / 1000) + 365 * 24 * 3600), salt: randSalt(), signature: '0x' as Hex };
  d.signature = await orgSigner.sign(hashDelegation(d, doors.chainId, CONTRACTS.delegationManager));
  return { ...d, salt: d.salt.toString() };
}
/** MEMBER ACCESS: org → member, a record-scope wire with NO targets — member access, never mistakable for stewardship. */
async function memberAccessWire(doors: EstateDoors, orgSigner: Signer, orgSa: string, memberSa: string) {
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const d = { delegator: lower(orgSa) as Address, delegate: lower(memberSa) as Address, authority: ROOT_AUTHORITY, caveats: [
    buildVaultRecordScopeCaveat([{ server: MCP_SERVER_ID, resources: ['vault:content.*', 'vault:member.profile:*', 'vault:org.membership:*'], ops: ['read'] }] as never),
    buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
    buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
  ], salt: randSalt(), signature: '0x' as Hex };
  d.signature = await orgSigner.sign(hashDelegation(d, doors.chainId, CONTRACTS.delegationManager));
  return { ...d, salt: d.salt.toString() };
}
/**
 * THE ORG'S OWN IDENTITY, in its OWN vault (`org.profile`, spec 322 W3) — what Settings → Profile reads and writes.
 * Without it the name a person sees (the Settings header, the trust-graph node) is only the LABEL stamped on the
 * relationship link (`related-orgs` displayName), and the Profile form is empty: the game authored a name nowhere
 * the org itself records it. The ORG signs a one-shot write of its own profile (its custodian key — the same one
 * `orgSigner` holds), delegate = that key, exactly as a steward's browser would `vaultWriteWithDelegation` it.
 * Best-effort: a cosmetic identity write never blocks a charter (tracked by `profiled` so a later wake retries it).
 */
async function writeOrgProfile(doors: EstateDoors, orgSigner: Signer, orgSa: string, spec: CharterSpec): Promise<void> {
  // The org, over a stewardship wire to its custodian — the same shape the Home's Settings → Profile writes with:
  // the custodian's authenticated session, `requester` the steward SA, the wire proving the stewardship. (Proven live:
  // both a fetched and an inline-minted wire are accepted; the record-scope caveat is for a MEMBER's read, not this.)
  const wire = await stewardshipWire(doors, orgSigner, orgSa, orgSigner.sa);
  const kind = spec.kind === 'team' ? 'team' : spec.kind;
  const data = {
    displayName: spec.name,
    description: `A Field Operations GAME ${kind}, founded in play by ${spec.steward.name}.${spec.purpose ? ` ${spec.purpose}` : ''} Not a real field organization.`,
  };
  const r = await fetch(`${doors.home}/a2a/mcp/vault/set`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${orgSigner.homeSession}` }, body: JSON.stringify({ delegation: wire, requester: lower(orgSigner.sa), recordType: 'org.profile', data }) });
  const j = await jsonOf(r);
  if (!j.ok) throw new Error(`org.profile ${spec.name}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
}

/** THE MEMBER'S OWN CONSENT: member → org, the shape the Home's join records (spec 321) — signed by the member's custodian. */
async function membershipConsent(doors: EstateDoors, memberSigner: Signer, memberSa: string, orgSa: string) {
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const d = { delegator: lower(memberSa) as Address, delegate: lower(orgSa) as Address, authority: ROOT_AUTHORITY, caveats: [
    buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
    buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
    buildVaultRecordScopeCaveat([{ server: MCP_SERVER_ID, resources: ['vault:directory.data', 'vault:conversation.index'], ops: ['read'] }] as never),
  ], salt: randSalt(), signature: '0x' as Hex };
  d.signature = await memberSigner.sign(hashDelegation(d, doors.chainId, CONTRACTS.delegationManager));
  return { ...d, salt: d.salt.toString() };
}

// ── the two-sided credential (spec 410 §8, `@agenticprimitives/agent-relationships`'s digest, carried locally) ──
type CredentialKind = 'has-member' | 'steward-of' | 'chartered-under';
interface CredentialBody { type: 'ap.relationship-credential.v1'; kind: CredentialKind; subject: Address; object: Address; chainId: number; issuedAt: string; termsDigest: Hex }
const digestOf = (v: unknown): Hex => keccak256(stringToBytes(jcsCanonicalize(v)));
const ZERO_DIGEST = `0x${'00'.repeat(32)}` as Hex;
const termsDigestOf = (terms: Record<string, unknown> | undefined): Hex => (terms && Object.keys(terms).length ? digestOf(terms) : ZERO_DIGEST);
function credentialDigest(b: CredentialBody): Hex {
  return digestOf({ type: b.type, kind: b.kind, subject: lower(b.subject), object: lower(b.object), chainId: b.chainId, issuedAt: b.issuedAt, termsDigest: lower(b.termsDigest) });
}
/** THE ORGANIZATION'S OFFER: the body and the organization's signature over its digest (its custodian's, through its account). */
async function offerCredential(doors: EstateDoors, orgSigner: Signer, kind: CredentialKind, subject: string, object: string, terms: Record<string, unknown>) {
  const body: CredentialBody = { type: 'ap.relationship-credential.v1', kind, subject: lower(subject) as Address, object: lower(object) as Address, chainId: doors.chainId, issuedAt: new Date().toISOString(), termsDigest: termsDigestOf(terms) };
  const digest = credentialDigest(body);
  return { ...body, terms, digest, signatures: { object: await orgSigner.sign(digest) } };
}
/** THE SUBJECT'S COUNTERSIGNATURE, through the estate's door: both signatures are verified on chain and one copy is written into each vault. */
async function acceptCredential(doors: EstateDoors, subjectHomeSession: string, offer: Awaited<ReturnType<typeof offerCredential>>, subjectSignature: Hex): Promise<Hex> {
  const c = await csrf(doors.a2a, doors.origin);
  const r = await fetch(`${doors.a2a}/relationships/credential/accept`, { method: 'POST', headers: { 'content-type': 'application/json', origin: doors.origin, cookie: c.cookie, 'x-csrf-token': c.token }, body: JSON.stringify({ session: subjectHomeSession, offer, subjectSignature }) });
  const j = await jsonOf(r);
  if (!j.ok || typeof j.digest !== 'string') throw new Error(`credential ${offer.kind} ${offer.subject.slice(0, 10)}… → ${offer.object.slice(0, 10)}…: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j.digest as Hex;
}

/**
 * THE MEMBER'S LISTING in the organization's directory — what a MEMBER's view of the roster is made of (the Home's own join
 * publishes it first; a steward sees the roster index, a member sees the listings). Signed by the member over the
 * listing's digest (sorted-key JSON, sha-256), presented with the org's member-access grant from the invitation.
 */
async function publishListing(doors: EstateDoors, homeSession: string, memberSigner: Signer, member: Party, org: { sa: string; name: string }, memberAccess: unknown, orgRole: string): Promise<void> {
  const now = Date.now();
  const subject = `eip155:${doors.chainId}:${lower(member.sa)}`;
  const draft = { type: 'ap.home.directory-listing.v1', subject, context: { kind: 'community', id: lower(org.sa), label: org.name }, displayName: member.name, visibility: 'community', orgRole, publishedAt: new Date(now).toISOString(), expiresAt: new Date(now + 180 * 86_400_000).toISOString() };
  const bytes = new TextEncoder().encode(canonicalizeJson(draft));
  const digest = `0x${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
  const listing = { ...draft, proof: { signer: subject, scheme: 'erc1271', signature: await memberSigner.sign(digest) } };
  const r = await fetch(`${doors.home}/connect/directory`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${homeSession}` }, body: JSON.stringify({ action: 'publish', listing, memberAccess }) });
  const j = await jsonOf(r);
  if (!r.ok || !j.ok) throw new Error(`listing ${member.name} in ${org.name}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
}

/** One party of an organization, as the ceremonies need them: who they are, whose Home signs, and whose session acts. */
export interface Party { sa: string; name: string; custodian: string; /** a persona: the session is minted "as" them under their custodian */ persona?: boolean }
async function sessionOf(doors: EstateDoors, p: Party): Promise<{ homeSession: string; idToken: string }> {
  if (p.persona) return personaSession(doors, p.custodian, p.sa);
  const s = await signerFor(doors, p.custodian);
  return { homeSession: s.homeSession, idToken: s.idToken };
}

/**
 * MEMBERSHIP, the Home's own way (spec 321 + 325 + 410 §8), as the field app's "Invite someone" and the invitee's join:
 *   1. the organization INVITES — its steward's session stores the org→member access grant and the organization's
 *      signed half of the has-member credential in the organization's vault (`org.invite:agent:<sa>`);
 *   2. the member JOINS — their own session records their consent (member→org), which the Home writes to their private
 *      index, to the organization's roster index, and as the organization's OWN membership record
 *      (`org.membership:member:<sa>`, aporg:OrganizationMembership with a role assignment naming the delegation);
 *   3. the member COUNTERSIGNS the credential — one copy in each vault, both signatures checked on chain.
 * Being a member authorizes nothing; the delegations do. The role is a word on the record.
 */
export async function join(doors: EstateDoors, org: { sa: string; name: string; custodian: string }, member: Party, role: string): Promise<Standing> {
  const orgSigner = await signerFor(doors, org.custodian);
  const memberSigner = await signerFor(doors, member.custodian);
  const session = await sessionOf(doors, member);
  const offer = await offerCredential(doors, orgSigner, 'has-member', member.sa, org.sa, { role });
  // The invitation carries the ROLE WORD the roster shows (declarative; the Home's roster and trust graph read it —
  // a founder or custodian is drawn as the organization's steward there, which is the standing the steward-of
  // credential records). It authorizes nothing: the member-access wire beside it is the access.
  const rosterRole = role === 'founder' || role === 'custodian' ? 'steward' : 'member';
  const access = await memberAccessWire(doors, orgSigner, org.sa, member.sa);
  const inv = await jsonOf(await fetch(`${doors.home}/connect/org-invite/agent`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${orgSigner.homeSession}` }, body: JSON.stringify({ org: lower(org.sa), agent: lower(member.sa), memberAccessDelegation: access, role: rosterRole, relationshipOffer: offer }) }));
  if (!inv.ok) throw new Error(`invite ${member.name} → ${org.name}: ${JSON.stringify(inv).slice(0, 160)}`);
  // The listing first, as the Home's own join does — a member's roster is made of these.
  await publishListing(doors, session.homeSession, memberSigner, member, org, access, rosterRole);
  const joined = await jsonOf(await fetch(`${doors.home}/connect/org-membership`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.homeSession}` }, body: JSON.stringify({ org: lower(org.sa), delegation: await membershipConsent(doors, memberSigner, member.sa, org.sa), displayName: member.name, relationshipOffer: offer }) }));
  if (!joined.ok) throw new Error(`join ${member.name} → ${org.name}: ${JSON.stringify(joined).slice(0, 160)}`);
  if (joined.membershipRecorded !== true) console.warn(`[fieldops] ${member.name}'s membership of ${org.name} was not recorded in the organization's vault: ${String(joined.membershipError ?? 'unsaid')}`);
  const digest = await acceptCredential(doors, session.homeSession, offer, await memberSigner.sign(offer.digest));
  return { membership: joined.membershipRecorded === true ? `org.membership:member:${lower(member.sa)}` : undefined, credential: digest, who: member.name, role, at: Date.now() };
}

/**
 * STEWARDSHIP (ap:Stewardship): the oversight delegation the organization signed to its steward is already on the
 * steward's link (`stewardshipWire`); this is the two-sided steward-of credential of it — the organization's offer, the
 * steward's countersignature, a copy in each vault. Not custody, not membership: a steward need not be a member.
 */
export async function stewardOf(doors: EstateDoors, org: { sa: string; name: string; custodian: string }, steward: Party): Promise<Hex> {
  const orgSigner = await signerFor(doors, org.custodian);
  const stewardSigner = await signerFor(doors, steward.custodian);
  const session = await sessionOf(doors, steward);
  const offer = await offerCredential(doors, orgSigner, 'steward-of', steward.sa, org.sa, { since: new Date().toISOString() });
  return acceptCredential(doors, session.homeSession, offer, await stewardSigner.sign(offer.digest));
}

export interface LinkWho { sa: string; name: string; signer: Signer; relationship: 'steward' | 'member'; /** The agent this org hangs under in their tree; themselves when omitted. */ under?: string }
/**
 * 3 · LINK the agent at a Home: a person's (or a persona's) own related-org link, signed by whoever custodies THEM,
 * carrying the org-signed stewardship or membership wire. A persona's custodian is the same EOA as its person's, so
 * the character's link is signed by the character's custodian — Naomi's by Elena's Home.
 */
export async function linkAt(doors: EstateDoors, orgSigner: Signer, org: { sa: string; name: string; purpose: string; kind: string }, who: LinkWho, remove = false): Promise<void> {
  const fields = { orgAgent: org.sa, orgName: org.name, purpose: org.purpose, requestedBy: doors.clientId };
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const sig = await who.signer.sign(writeChallenge({ person: who.sa, orgAgent: org.sa, contentHash: contentHashOf(fields), nonce, expiry }));
  const wire = remove ? {} : who.relationship === 'steward' ? { stewardshipDelegation: await stewardshipWire(doors, orgSigner, org.sa, who.sa) } : { membershipDelegation: await memberAccessWire(doors, orgSigner, org.sa, who.sa) };
  const r = await fetch(`${doors.home}/connect/related-orgs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: lower(who.sa), ...fields, sig, nonce, expiry, kind: org.kind, parent: lower(who.under ?? who.sa), relationship: who.relationship, displayName: who.name, ...wire, ...(remove ? { remove: true } : {}) }) });
  const j = await jsonOf(r);
  if (!j.ok) throw new Error(`related-orgs ${who.name} → ${org.name}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
}

/**
 * THE INTERACTIONS GRANT'S SCOPES — the Home's own list, verbatim: `INTERACTIONS_GRANT_CORE_SCOPES` from
 * `@agenticprimitives/fabric` (packages/fabric/src/interactions/grant-scopes.ts) plus the estate's `INTERACTIONS_APP_SCOPES`
 * (packages/home-shared). Inlined because the fabric package drags the whole platform into a Worker that needs forty
 * strings; `STORAGE_V` is bumped when this list changes, and an organization granted under an older one is re-granted.
 * An org whose grant lacks a resource answers `record_scope_denied` to the Home's own ceremonies — the countersigned
 * credential's second copy, in the organization's vault, is what found this out.
 */
export const STORAGE_V = 3;
const CORE_RW = [
  'vault:conversation.index', 'vault:conversation.topic:*', 'vault:message.body:topic:*',
  'vault:inbox.data', 'vault:directory.data', 'vault:relationships.data', 'vault:member.profile:*',
  'vault:org.membership:*', 'vault:org.applications', 'vault:impact-profile', 'vault:capabilities.data',
  'vault:skills.data', 'vault:home.manifest', 'vault:control-events.data', 'vault:coordination.requests',
  'vault:coordination.index', 'vault:coordination.endeavor:*', 'vault:content.*',
  'vault:resolution.requests', 'vault:resolution.grants', 'vault:archetype.assignment', 'vault:payment.receipt:*',
  'vault:household.data', 'vault:conversation.recent', 'vault:run.provenance:*', 'vault:run.artifact:*', 'vault:run.anchor:*', 'vault:run.measures:*',
  'vault:relationships.credential:*', 'vault:relationships.revocation:*', 'vault:delegation.lineage:*',
  'vault:interaction.dispute:*', 'vault:run.dispute:*', 'vault:build.run:*', 'vault:build.promotion:*',
  'vault:agent.budget', 'vault:connector.mcp:*', 'vault:confirmation.preferences', 'vault:standing.instructions',
  'vault:security.credentials', 'vault:security.channels', 'vault:memory.facts', 'vault:routines.data', 'vault:person.preferences', 'vault:playbook.memory:*',
];
const APP_READ = ['vault:uupg:attestation', 'vault:uupg:attestations', 'vault:uupg:assessed', 'vault:uupg:coalition', 'vault:uupg:segment-def', 'vault:uupg:org-profile', 'vault:uupg:strategy', 'vault:newcity:*', 'vault:family:*', 'vault:field:*'];
const APP_SEED = ['vault:family:*', 'vault:field:*', 'vault:cardroom.*'];
const interactionsScopes = () => [
  { server: MCP_SERVER_ID, resources: CORE_RW, ops: ['read', 'write'] },
  { server: MCP_SERVER_ID, resources: ['vault:archetype.assignment'], ops: ['read', 'write', 'delete'] },
  { server: MCP_SERVER_ID, resources: ['vault:message.body:dm:*'], ops: ['read'] },
  { server: MCP_SERVER_ID, resources: ['vault:org.invite:*'], ops: ['read'] },
  // The WORKSPACE'S OWN POINTER to the organization that governs it, READ ONLY (fabric's list, 2026-10-04). The
  // board gate admits a governing organization's members by reading it; a grant without this scope is denied the
  // read and the workspace reads as "no governor" — members can read it and never open a topic on its board.
  { server: MCP_SERVER_ID, resources: ['vault:workspace.governor'], ops: ['read'] },
  { server: MCP_SERVER_ID, resources: ['vault:contact:*'], ops: ['read', 'write'] },
  { server: MCP_SERVER_ID, resources: APP_READ, ops: ['read'] },
  { server: MCP_SERVER_ID, resources: APP_SEED, ops: ['read', 'write'] },
];

/** 4 · STORAGE: the two planes a library write needs — the delivery wire and the interactions grant with its session leaf. `regrant` re-issues the interactions grant under the current scope list. Exported so a maintenance pass can re-issue an expired org leaf (`repair-fieldops-leaves`, the season self-heal) without re-running a whole charter. */
export async function enableStorage(doors: EstateDoors, signer: Signer, sa: string, regrant = false): Promise<void> {
  const org = lower(sa) as Address;
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const status = await jsonOf(await fetch(`${doors.a2a}/interactions/${org}/status`));
  if (!status.deliveryGranted) {
    const d = { delegator: org, delegate: lower(doors.deliveryServiceSa) as Address, authority: ROOT_AUTHORITY, caveats: [
      buildVaultRecordScopeCaveat([
        { server: MCP_SERVER_ID, resources: ['vault:message.body:dm:*', 'vault:inbox.data'], ops: ['write'] },
        { server: MCP_SERVER_ID, resources: ['vault:org.invite:*'], ops: ['read', 'write'] },
        { server: MCP_SERVER_ID, resources: ['vault:content.*'], ops: ['read', 'write'] },
      ] as never),
      buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
      buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
    ], salt: randSalt(), signature: '0x' as Hex };
    d.signature = await signer.sign(hashDelegation(d, doors.chainId, CONTRACTS.delegationManager));
    const r = await jsonOf(await fetch(`${doors.a2a}/interactions/${org}/grant.delivery.put`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delegation: { ...d, salt: d.salt.toString() } }) }));
    if (r.ok !== true) throw new Error(`delivery grant: ${JSON.stringify(r).slice(0, 200)}`);
  }
  if (!status.granted || regrant) {
    const d = { delegator: org, delegate: lower(doors.interactionsServiceSa) as Address, authority: ROOT_AUTHORITY, caveats: [
      buildVaultRecordScopeCaveat(interactionsScopes() as never),
      buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
      buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
    ], salt: randSalt(), signature: '0x' as Hex };
    d.signature = await signer.sign(hashDelegation(d, doors.chainId, CONTRACTS.delegationManager));
    const sk = await jsonOf(await fetch(`${doors.a2a}/agent/interactions-session-key`));
    if (!sk.ok || typeof sk.address !== 'string') throw new Error(`no interactions-session key: ${JSON.stringify(sk).slice(0, 160)}`);
    // THE ORG LEAF LIVES A YEAR AND NAMES BOTH SERVICE AGENTS (2026-10-03). A DEL-001 session leaf was 12 h by
    // default and carried no audience; a PERSON's self-heals every Home login, but an ORG never logs in, so its
    // leaf expired overnight and every org vault read answered "auth failed — mcp: auth failed" (409). The two-tier
    // rule (the Home's `activateInteractionsIfNeeded`): short only for the connected person, long for an org — so
    // `validUntil` (365 d), like everything else here. AND the audience is EXPLICIT: an org holds two grants (the
    // interactions grant, delegate = the interactions SA, and the write-only delivery grant where `content.*`
    // lives, delegate = the delivery SA), and the session key must be allowed to present BOTH, or content reads
    // fail while interactions reads pass. Hand-built because alpha.24's `buildSessionDelegation` carries no
    // audience caveat; the shape (timestamp · value · audience) matches the live lib's.
    const leaf = { delegator: org, delegate: lower(sk.address) as Address, authority: ROOT_AUTHORITY, caveats: [
      buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
      buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
      buildCaveat(SESSION_AUDIENCE_ENFORCER, encodeAbiParameters([{ type: 'address[]' }], [[lower(doors.interactionsServiceSa), lower(doors.deliveryServiceSa)] as Address[]])),
    ], salt: randSalt(), signature: '0x' as Hex };
    const digest = hashDelegation(leaf, doors.chainId, CONTRACTS.delegationManager);
    leaf.signature = await signer.sign(digest);
    const r = await jsonOf(await fetch(`${doors.a2a}/interactions/${org}/grant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delegation: { ...d, salt: d.salt.toString() }, sessionLeaf: { ...leaf, salt: leaf.salt.toString() } }) }));
    if (r.ok !== true) throw new Error(`interactions grant: ${JSON.stringify(r).slice(0, 200)}`);
  }
}

export const purposeOf = (kind: CharterKind): string => (kind === 'team' ? 'field-team' : kind === 'circle' ? 'field-circle' : 'field-church');

/** One chartered agent as the ledger (KV `fieldops-chartered`) and `noteChartered` record it. */
export interface CharteredEntry { sa: string; kind: CharterKind; name: string; custodian: string; steward?: { sa: string; name: string }; viewers?: string[] }
/**
 * RETIRE what a previous season chartered, so a NEW GAME does not leave the last season's teams standing and the
 * workspace does not accumulate duplicate "Weld Corridor Team (game)" rows. The inverse of the charter's `link` step:
 * unlink each agent at EVERY Home it was linked at (the steward persona — signed by its custodian — and every viewer,
 * signed by themselves), exactly as `reset:fieldops` does, via `linkAt(…, remove=true)`. Best-effort: the agents stay
 * on chain (nobody can delete them), they simply leave every list; what could not be unlinked is returned, never thrown.
 */
export async function retireChartered(doors: EstateDoors, entries: readonly CharteredEntry[]): Promise<{ retired: number; failures: string[] }> {
  const failures: string[] = [];
  let retired = 0;
  for (const e of entries) {
    const org = { sa: lower(e.sa), name: e.name, purpose: purposeOf(e.kind), kind: e.kind };
    const who: { sa?: string; name: string; custodian: string }[] = [
      ...(e.steward?.sa ? [{ sa: e.steward.sa, name: e.steward.name, custodian: e.custodian }] : []),
      ...[...new Set(e.viewers ?? [])].map((h) => ({ name: h, custodian: h })),
    ];
    let ok = true;
    for (const w of who) {
      try {
        const signer = await signerFor(doors, w.custodian);
        await linkAt(doors, signer, org, { sa: lower(w.sa ?? signer.sa), name: w.name, signer, relationship: 'member' }, true);
      } catch (err) { ok = false; failures.push(`${e.name} ← ${w.name}: ${(err as Error).message.slice(0, 140)}`); }
    }
    if (ok) retired += 1;
  }
  return { retired, failures };
}

/**
 * ONE STEP of a charter. Returns the progress to persist; the caller calls again until `done` or `failed`. A step's
 * failure is counted and retried; the steps already taken are kept (an agent deployed is not deployed twice).
 */
export async function advance(doors: EstateDoors, spec: CharterSpec, p: CharterProgress, workspaceCustodian: string): Promise<CharterProgress> {
  const now = Date.now();
  try {
    const signer = await signerFor(doors, spec.custodian);
    if (p.step === 'deploy') {
      const r = await deploy(doors, signer);
      return { ...p, step: 'vault', sa: r.sa, salt: r.salt, custodianEoa: signer.eoa, tries: 0, at: now, error: undefined };
    }
    if (p.step === 'vault' && p.sa) {
      await bindVault(doors, signer, p.sa);
      // The org's own identity in its own vault — the one write a flaky vault must not block the charter on.
      let profiled = p.profiled;
      try { await writeOrgProfile(doors, signer, p.sa, spec); profiled = true; } catch (e) { console.warn(`[fieldops] ${spec.name}: org.profile not written yet: ${String(e)}`); }
      return { ...p, step: 'link', profiled, tries: 0, at: now, error: undefined };
    }
    if (p.step === 'link' && p.sa) {
      const org = { sa: p.sa, name: spec.name, purpose: purposeOf(spec.kind), kind: spec.kind };
      const linked = new Set(p.linked ?? []);
      // The character stewards it (signed by the character's custodian — the same Home). THE CUSTODIAN IS A STEWARD TOO:
      // the field app's own "Create team" leaves its creator both, and the library takes a write only from a steward's
      // session, which is the custodian's demo session here. Everybody else who should see it is a member.
      // The persona's own link hangs under itself (it belongs to no workspace); every person's hangs under `spec.under`.
      // NOBODY ELSE IS LINKED: a person is not a member of a team because they custody a character on it (the owner's
      // rule, 2026-10-02) — they see the team as their character. The custodian's stewardship link is custody, not membership.
      if (!linked.has(spec.steward.sa)) { await linkAt(doors, signer, org, { sa: spec.steward.sa, name: spec.steward.name, signer, relationship: 'steward' }); linked.add(spec.steward.sa); }
      if (!linked.has(signer.sa)) { await linkAt(doors, signer, org, { sa: signer.sa, name: spec.custodian, signer, relationship: 'steward', under: spec.under }); linked.add(signer.sa); }
      void workspaceCustodian;
      return { ...p, step: 'storage', linked: [...linked], custodianSteward: true, parented: true, tries: 0, at: now, error: undefined };
    }
    if (p.step === 'storage' && p.sa) {
      await enableStorage(doors, signer, p.sa, (p.storageV ?? 0) !== STORAGE_V);
      // Second shot at the identity write, since the first (in `vault`) is best-effort and the vault may have 502'd.
      let profiled = p.profiled;
      if (!profiled) { try { await writeOrgProfile(doors, signer, p.sa, spec); profiled = true; } catch (e) { console.warn(`[fieldops] ${spec.name}: org.profile still not written: ${String(e)}`); } }
      return { ...p, step: 'membership', storageV: STORAGE_V, profiled, tries: 0, at: now, error: undefined };
    }
    if (p.step === 'membership' && p.sa) {
      const standing = { ...(p.standing ?? {}) };
      const org = { sa: p.sa, name: spec.name, custodian: spec.custodian };
      // The character stewards it (steward-of) and belongs to it (has-member, as its founder). Nobody else: a team's
      // members are the characters on it, and a custodian is not one. Idempotent by SA.
      const steward: Party = { sa: spec.steward.sa, name: spec.steward.name, custodian: spec.custodian, persona: true };
      if (!standing[lower(steward.sa)]?.stewardship) { const d = await stewardOf(doors, org, steward); standing[lower(steward.sa)] = { ...(standing[lower(steward.sa)] ?? { at: now }), stewardship: d, at: now }; }
      if (!standing[lower(steward.sa)]?.credential) standing[lower(steward.sa)] = { ...standing[lower(steward.sa)]!, ...(await join(doors, org, steward, 'founder')) };
      return { ...p, step: 'done', standing, tries: 0, at: now, error: undefined };
    }
    return p;
  } catch (e) {
    const tries = p.tries + 1;
    const error = e instanceof Error ? e.message : String(e);
    return tries >= MAX_TRIES ? { ...p, step: 'failed', tries, at: now, error } : { ...p, tries, at: now, error };
  }
}

/** REPAIR an older charter whose custodian was linked as a member only: re-link them as steward (the link is replaced). */
export async function stewardCustodian(doors: EstateDoors, spec: CharterSpec, sa: string): Promise<void> {
  const signer = await signerFor(doors, spec.custodian);
  await linkAt(doors, signer, { sa, name: spec.name, purpose: purposeOf(spec.kind), kind: spec.kind }, { sa: signer.sa, name: spec.custodian, signer, relationship: 'steward', under: spec.under });
}
/** REPAIR a charter that landed before org.profile was written: give the org its own identity in its own vault. */
export async function reprofile(doors: EstateDoors, spec: CharterSpec, sa: string): Promise<void> {
  const signer = await signerFor(doors, spec.custodian);
  await writeOrgProfile(doors, signer, sa, spec);
}
/** REPAIR an older charter whose people's links hang under themselves: re-link each under `spec.under` (the link is replaced). */
export async function reparent(doors: EstateDoors, spec: CharterSpec, sa: string, workspaceCustodian: string): Promise<string[]> {
  const orgSigner = await signerFor(doors, spec.custodian);
  const org = { sa, name: spec.name, purpose: purposeOf(spec.kind), kind: spec.kind };
  const failures: string[] = [];
  await linkAt(doors, orgSigner, org, { sa: orgSigner.sa, name: spec.custodian, signer: orgSigner, relationship: 'steward', under: spec.under }).catch((e) => failures.push(`${spec.custodian}: ${String(e)}`));
  void workspaceCustodian;
  return failures;
}

/**
 * A MEMBER JOINS: the membership wire the custodian signs, recorded on the member persona's own link and on the
 * member's custodian's — the second half of the field app's invite, which the roster row never waited for.
 */
export async function admit(doors: EstateDoors, teamCustodian: string, team: { sa: string; name: string; under: string }, member: { sa: string; name: string; custodian: string }, workspaceCustodian: string, already: Record<string, Standing> = {}): Promise<Record<string, Standing>> {
  const orgSigner = await signerFor(doors, teamCustodian);
  const memberSigner = await signerFor(doors, member.custodian);
  const org = { sa: team.sa, name: team.name, purpose: purposeOf('team'), kind: 'team' };
  const out: Record<string, Standing> = {};
  // The CHARACTER joins, the Home's own way: invited, consenting, countersigned. Their custodian does not: a person is
  // not a member of a team because they custody somebody on it — they look at it as their character.
  out[lower(member.sa)] = await join(doors, { sa: team.sa, name: team.name, custodian: teamCustodian }, { sa: member.sa, name: member.name, custodian: member.custodian, persona: true }, 'member');
  void orgSigner; void memberSigner; void org; void workspaceCustodian; void already;
  return out;
}

/** RETIRE: let go of every link a season made for an agent, so a reset leaves no team or body in anybody's field app. */
export async function unlink(doors: EstateDoors, custodian: string, org: { sa: string; name: string; kind: CharterKind }, who: Array<{ sa: string; name: string; custodian: string }>): Promise<string[]> {
  const orgSigner = await signerFor(doors, custodian);
  const failures: string[] = [];
  for (const w of who) {
    try { const s = await signerFor(doors, w.custodian); await linkAt(doors, orgSigner, { sa: org.sa, name: org.name, purpose: purposeOf(org.kind), kind: org.kind }, { sa: w.sa, name: w.name, signer: s, relationship: 'member' }, true); }
    catch (e) { failures.push(`${w.name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return failures;
}


// ── TALK: a team's discussion, and a character's direct message — the Home's own doors, as the character ──────────
//
// A team is an organization, so it has a BOARD, and the field app's team conversation is the open topic `general` on
// it: every member of the team is in it, nothing is invited per conversation. The game does the same thing with the
// same records: the founding character's session opens `general` on the team it founded, and what a character SAYS
// in the field is posted there as that character (a member's act, with the character's own session); a character on
// no team yet speaks on the organization's `general`. A WHISPER is a direct message from the character's own agent
// (`messaging.send` as the character), which needs the character's MESSAGING WIRE — a delegation from the character
// to this deployment's interactions session key naming the messaging skills and the counterparties, with a transport
// grant beside it, both signed by the character's custodian and installed by the character's own session
// (`messaging.wireEnable`) — the one prompt the Home's own messaging ceremony is.

const MESSAGING_WIRE_SKILLS = ['messaging.deliver', 'interactions.respond', 'interactions.deliverCredential', 'org.apply'];
/** The character's messaging rail: the wire and the transport grant, over the counterparties named. Re-minting unions. */
export async function enableMessagingFor(doors: EstateDoors, party: Party, recipients: string[]): Promise<void> {
  const signer = await signerFor(doors, party.custodian);
  const session = await sessionOf(doors, party);
  const sk = await jsonOf(await fetch(`${doors.a2a}/agent/interactions-session-key`));
  if (!sk.ok || typeof sk.address !== 'string') throw new Error(`no interactions-session key: ${JSON.stringify(sk).slice(0, 120)}`);
  const to = [...new Set(recipients.map(lower).filter((a) => a !== lower(party.sa)))] as Address[];
  if (!to.length) return;
  const validUntil = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const caveats = () => [
    buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
    buildCaveat(CONTRACTS.allowedTargetsEnforcer, encodeAllowedTargetsTerms(to)),
    buildCaveat(CONTRACTS.allowedMethodsEnforcer, encodeAllowedMethodsTerms(MESSAGING_WIRE_SKILLS.map((x) => skillSelector(x)))),
  ];
  const wire = { delegator: lower(party.sa) as Address, delegate: lower(sk.address as string) as Address, authority: ROOT_AUTHORITY, caveats: caveats(), salt: randSalt(), signature: '0x' as Hex };
  wire.signature = await signer.sign(hashDelegation(wire, doors.chainId, CONTRACTS.delegationManager));
  const transport = { delegator: lower(party.sa) as Address, delegate: lower(party.sa) as Address, authority: ROOT_AUTHORITY, caveats: caveats(), salt: randSalt(), signature: '0x' as Hex };
  transport.signature = await signer.sign(hashDelegation(transport, doors.chainId, CONTRACTS.delegationManager));
  const c = await csrf(doors.a2a, doors.origin);
  const r = await fetch(`${doors.a2a}/interactions/${lower(party.sa)}/messaging.wireEnable`, { method: 'POST', headers: { 'content-type': 'application/json', origin: doors.origin, cookie: c.cookie, 'x-csrf-token': c.token }, body: JSON.stringify({ session: session.homeSession, delegation: { ...wire, salt: wire.salt.toString() }, transport: { ...transport, salt: transport.salt.toString() } }) });
  const j = await jsonOf(r);
  if (!r.ok || j.ok === false) throw new Error(`messaging wire for ${party.name}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
}

/** A direct message FROM the character, as the character: its own session, its own rail. */
export async function directMessage(doors: EstateDoors, from: Party, toSa: string, subject: string, bodyText: string): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const session = await sessionOf(doors, from);
  const c = await csrf(doors.a2a, doors.origin);
  const r = await fetch(`${doors.a2a}/interactions/${lower(from.sa)}/messaging.send`, { method: 'POST', headers: { 'content-type': 'application/json', origin: doors.origin, cookie: c.cookie, 'x-csrf-token': c.token }, body: JSON.stringify({ session: session.homeSession, recipient: lower(toSa), subject, bodyText }) });
  const j = await jsonOf(r);
  if (!r.ok || j.ok === false) return { ok: false, error: `${j.code ?? r.status}: ${String(j.error ?? '').slice(0, 140)}` };
  return { ok: true, conversationId: String(j.conversationId ?? '') };
}

/** The open topic `general` on an organization's board — the field app's default conversation — opened by this session when missing. */
export async function ensureGeneral(doors: EstateDoors, homeSession: string, orgSa: string): Promise<string | null> {
  const list = await jsonOf(await fetch(`${doors.home}/connect/channels?communityId=${lower(orgSa)}`, { headers: { authorization: `Bearer ${homeSession}` } }));
  const hit = ((list.channels as Array<{ descriptor?: { id?: string }; title?: string }> | undefined) ?? []).find((ch) => (ch.title ?? '').trim().toLowerCase() === 'general');
  if (hit?.descriptor?.id) return hit.descriptor.id;
  const made = await jsonOf(await fetch(`${doors.home}/connect/channels`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${homeSession}` }, body: JSON.stringify({ action: 'create', communityId: lower(orgSa), title: 'general', participationPolicy: 'open' }) }));
  return typeof made.channelId === 'string' ? made.channelId : null;
}
/** A line on an organization's board, posted as the member whose session this is. */
export async function postLine(doors: EstateDoors, homeSession: string, orgSa: string, channelId: string, bodyText: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`${doors.home}/connect/channels`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${homeSession}` }, body: JSON.stringify({ action: 'post', communityId: lower(orgSa), channelId, bodyText }) });
  const j = await jsonOf(r);
  return r.ok && j.ok !== false ? { ok: true } : { ok: false, error: `${r.status} ${String(j.error ?? '').slice(0, 120)}` };
}
export { sessionOf };
