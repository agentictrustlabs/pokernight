/**
 * The Home's own HTTP surface, as this card room uses it.
 *
 * Sign-in (`home.ts`) is the OIDC ceremony; this is everything AFTER it — the calls that answer
 * "which treasuries does this person have?", "is this name free?", and, for one of the Home's own
 * demo identities, "please deploy this Smart Agent and sign for it".
 *
 * Everything is injected: `HomeApiConfig` carries the origin and the client id, so this file names no
 * host. It is deliberately free of Cloudflare and Env types, because `scripts/settle-persona.mts`
 * drives the same calls from Node against the same live Home — one implementation, one set of
 * refusals, whether the caller is a Worker or a terminal.
 */

export interface HomeApiConfig {
  /** e.g. the deployment's `HOME_ORIGIN`. No trailing slash. */
  origin: string;
  /** The OIDC `client_id` this deployment is registered under. */
  clientId: string;
}

/** A refusal from the Home, with the status and whatever it said, so a caller can quote it. */
export class HomeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly path: string,
  ) {
    super(`${path} → ${status}: ${reason}`);
    this.name = 'HomeApiError';
  }
}

type Hex = `0x${string}`;

function base(cfg: HomeApiConfig): string {
  return cfg.origin.replace(/\/+$/, '');
}

async function readJson(res: Response, path: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const reason =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? [(body as { error: string }).error, (body as { detail?: string }).detail].filter(Boolean).join(' — ')
        : text.slice(0, 200) || `${res.status} ${res.statusText}`;
    throw new HomeApiError(res.status, reason, path);
  }
  return (body ?? {}) as Record<string, unknown>;
}

async function get(cfg: HomeApiConfig, path: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  return readJson(await fetch(`${base(cfg)}${path}`, { headers }), path);
}

async function post(
  cfg: HomeApiConfig,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  return readJson(
    await fetch(`${base(cfg)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    path,
  );
}

/* ------------------------------------------------------------------ discovery */

/** The kind of related agent that is a person's own treasury. The ONLY kind we will spend from. */
export const PERSON_TREASURY_KIND = 'person-treasury';

/** One agent the Home says is related to this person. Only the fields we actually read. */
export interface RelatedAgent {
  orgAgent: string;
  orgName: string;
  kind: string;
  parent: string | null;
  relationship: string | null;
  status: string | null;
  createdAt: number | null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function toRelatedAgent(raw: unknown): RelatedAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const address = typeof o.orgAgent === 'string' ? o.orgAgent.trim() : '';
  if (!ADDRESS_RE.test(address)) return null;
  return {
    orgAgent: address.toLowerCase(),
    orgName: typeof o.orgName === 'string' ? o.orgName.trim() : '',
    kind: typeof o.kind === 'string' ? o.kind.trim() : '',
    parent: typeof o.parent === 'string' && ADDRESS_RE.test(o.parent.trim()) ? o.parent.trim().toLowerCase() : null,
    relationship: typeof o.relationship === 'string' ? o.relationship : null,
    status: typeof o.status === 'string' ? o.status : null,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : null,
  };
}

/**
 * Every agent the person's Home associates with them, read with the person's OWN id_token.
 *
 * NOTE the missing `client_id`: with one, the Home answers only the links THIS app requested, which
 * for a card room that has never created anything is always empty. Without one it answers the
 * person's own view, and accepts a registered relying app's token for it. That is the only call that
 * can find a treasury the person made somewhere else, which is the whole point.
 */
export async function listRelatedAgents(cfg: HomeApiConfig, idToken: string): Promise<RelatedAgent[]> {
  const body = await get(cfg, '/connect/related-orgs', { authorization: `Bearer ${idToken}` });
  const orgs = Array.isArray(body.orgs) ? body.orgs : [];
  return orgs.map(toRelatedAgent).filter((a): a is RelatedAgent => a !== null);
}

/**
 * The person's treasuries, and nothing else.
 *
 * A person agent is an identity: it is never in this list, because the Home never labels it
 * `person-treasury`. That filter is the whole correction — spending from an identity conflates who
 * someone is with what they are willing to stake.
 */
export function personTreasuries(agents: readonly RelatedAgent[]): RelatedAgent[] {
  return agents.filter((a) => a.kind === PERSON_TREASURY_KIND && a.status !== 'deleted' && a.status !== 'inactive');
}

/* ----------------------------------------------------------------- naming */

export type NameCheck =
  | { status: 'free'; label: string; name: string; node: string }
  | { status: 'taken'; label: string; name: string }
  | { status: 'unusable'; label: string; reason: string };

/** Labels the treasury subregistry will accept. Mirrors the Home's own `sanitize`. */
export const TREASURY_LABEL_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;

/**
 * Is `<label>.treasury` free? Exact-or-fail (`exact=1`): a taken label is an answer, never a silent
 * `<label>2`, because the player typed the name they wanted.
 */
export async function checkTreasuryLabel(cfg: HomeApiConfig, labelRaw: string): Promise<NameCheck> {
  const label = labelRaw.trim().toLowerCase();
  if (!TREASURY_LABEL_RE.test(label)) {
    return {
      status: 'unusable',
      label,
      reason: `"${labelRaw}" is not a usable label — 2 to 24 characters of a–z, 0–9 and dashes, starting with a letter or digit`,
    };
  }
  const path = `/connect/name?exact=1&label=${encodeURIComponent(label)}&tld=treasury`;
  const res = await fetch(`${base(cfg)}${path}`);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  if (res.status === 409 || body.taken === true) {
    return { status: 'taken', label, name: typeof body.name === 'string' ? body.name : `${label}.treasury` };
  }
  if (!res.ok) throw new HomeApiError(res.status, typeof body.error === 'string' ? body.error : text.slice(0, 200), path);
  return {
    status: 'free',
    label,
    name: typeof body.name === 'string' ? body.name : `${label}.treasury`,
    node: typeof body.node === 'string' ? body.node : '',
  };
}

/* ------------------------------------------------------------ demo identities */

/** One of the Home's own demo people. `custodian` is the EOA the Home signs for them with. */
export interface DemoPersona {
  handle: string;
  sa: string;
  name: string;
  custodian: string;
}

/**
 * The roster changes when an operator redeploys the Home, which is to say hardly ever — and it is
 * consulted on every read of the treasury panel. Cached briefly so a player watching a table does not
 * turn one panel into a request per poll at somebody else's server.
 */
const ROSTER_TTL_MS = 5 * 60 * 1000;
let rosterCache: { origin: string; at: number; personas: DemoPersona[] } | null = null;

/** The Home's demo roster, or `[]` for a Home that lends none (or that we cannot reach). */
export async function listDemoPersonas(cfg: HomeApiConfig): Promise<DemoPersona[]> {
  const origin = base(cfg);
  const now = Date.now();
  if (rosterCache && rosterCache.origin === origin && now - rosterCache.at < ROSTER_TTL_MS) {
    return rosterCache.personas;
  }
  let body: Record<string, unknown>;
  try {
    body = await get(cfg, '/connect/demo-personas');
  } catch {
    return [];
  }
  const list = Array.isArray(body.personas) ? body.personas : [];
  const out: DemoPersona[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const handle = typeof p.handle === 'string' ? p.handle.trim() : '';
    const sa = typeof p.sa === 'string' ? p.sa.trim() : '';
    const custodian = typeof p.custodian === 'string' ? p.custodian.trim() : '';
    if (!handle || !ADDRESS_RE.test(sa) || !ADDRESS_RE.test(custodian)) continue;
    out.push({ handle, sa: sa.toLowerCase(), name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : handle, custodian });
  }
  rosterCache = { origin, at: now, personas: out };
  return out;
}

/** The demo persona whose person agent is `address`, or null when that address is a real person's. */
export async function demoPersonaFor(cfg: HomeApiConfig, address: string): Promise<DemoPersona | null> {
  const wanted = address.trim().toLowerCase();
  return (await listDemoPersonas(cfg)).find((p) => p.sa === wanted) ?? null;
}

export interface DemoSignIn {
  /** id_token with `aud` = our client id. Identity. */
  idToken: string;
  /** Home session (`aud` = the Home's own). What `/connect/persona-sign` and the agent-tree write need. */
  homeSession: string;
  /** The persona's person Smart Agent. */
  agent: string;
  handle: string;
}

/**
 * Sign in as one of the Home's demo people, server-side.
 *
 * This is the Home lending an identity it custodies to a registered app — the same thing the browser
 * does at the sign-in screen, asked for by the card room so it can run a ceremony on that person's
 * behalf. It is only ever done for an address the Home ITSELF lists as a demo persona.
 */
export async function demoSignIn(cfg: HomeApiConfig, handle: string): Promise<DemoSignIn> {
  const body = await post(cfg, '/connect/demo-signin', { handle, client_id: cfg.clientId });
  const idToken = typeof body.id_token === 'string' ? body.id_token : '';
  const homeSession = typeof body.homeSession === 'string' ? body.homeSession : '';
  const agent = typeof body.agent === 'string' ? body.agent : '';
  if (!idToken || !homeSession || !ADDRESS_RE.test(agent)) {
    throw new HomeApiError(200, 'the Home returned an incomplete demo sign-in (no homeSession)', '/connect/demo-signin');
  }
  return { idToken, homeSession, agent: agent.toLowerCase(), handle };
}

/**
 * Ask the Home to sign a digest AS the demo persona whose session this is.
 *
 * The request never names a subject: the Home signs for the SA in its own session's `sub` and no
 * other, which is why handing this token to the card room does not let the card room sign as anyone
 * else. The signature is EIP-191 over the 32 bytes — what `AgentAccount._validateSig` accepts.
 */
export async function personaSignDigest(cfg: HomeApiConfig, homeSession: string, digest: Hex): Promise<Hex> {
  const body = await post(cfg, '/connect/persona-sign', { digest }, { authorization: `Bearer ${homeSession}` });
  if (body.persona === false) {
    throw new HomeApiError(200, 'that Home session is not one of the Home’s demo identities, so it has no server-held custodian', '/connect/persona-sign');
  }
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) throw new HomeApiError(200, 'the Home returned no signature', '/connect/persona-sign');
  return signature as Hex;
}

/* ------------------------------------------------------- deploying at the Home */

/** The CSRF pair the Home's `/a2a/*` write endpoints require: a token and the cookie it came with. */
export interface HomeCsrf {
  token: string;
  cookie: string;
}

export async function homeCsrf(cfg: HomeApiConfig): Promise<HomeCsrf> {
  const origin = base(cfg);
  const res = await fetch(`${origin}/a2a/auth/csrf`, { headers: { origin } });
  const body = await readJson(res, '/a2a/auth/csrf');
  const token = typeof body.token === 'string' ? body.token : '';
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  if (!token || !cookie) throw new HomeApiError(res.status, 'the Home issued no CSRF token', '/a2a/auth/csrf');
  return { token, cookie };
}

export interface DeployedAgent {
  address: string;
  txHash: string | null;
}

/**
 * Deploy a Smart Agent AT THE HOME, custodied by `owner`, signed by whoever `sign` is.
 *
 * Three calls, and the middle one is the point: the Home builds the deploy UserOp, the OWNER signs
 * its hash, and the Home submits it with its own paymaster. The card room never signs, never pays,
 * and never becomes a custodian — it only asks.
 *
 * The address is `CREATE2(factory, owner, salt)` and is therefore identical to the one
 * `deriveAgentAccount({mode: 0, custodians: [owner], salt})` predicts, which is what makes falling
 * back to a direct on-chain deploy a fallback rather than a different account.
 */
export async function deployAgentAtHome(
  cfg: HomeApiConfig,
  spec: { owner: string; salt: bigint; callData?: Hex },
  sign: (digest: Hex) => Promise<Hex>,
): Promise<DeployedAgent> {
  const origin = base(cfg);
  const csrf = await homeCsrf(cfg);
  const headers = {
    'content-type': 'application/json',
    origin,
    cookie: csrf.cookie,
    'x-csrf-token': csrf.token,
  };
  const built = await post(
    cfg,
    '/a2a/session/deploy',
    { initMethod: 'eoa', owner: spec.owner, salt: spec.salt.toString(), ...(spec.callData ? { callData: spec.callData } : {}) },
    headers,
  );
  const userOpHash = typeof built.userOpHash === 'string' ? built.userOpHash : '';
  const userOp = built.userOp && typeof built.userOp === 'object' ? (built.userOp as Record<string, unknown>) : null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash) || !userOp) {
    throw new HomeApiError(200, 'the Home built no deploy operation', '/a2a/session/deploy');
  }
  const signature = await sign(userOpHash as Hex);
  const submitted = await post(cfg, '/a2a/session/deploy/submit', { userOp: { ...userOp, signature } }, headers);
  const address = typeof submitted.deployedAddress === 'string' ? submitted.deployedAddress : '';
  if (!ADDRESS_RE.test(address)) throw new HomeApiError(200, 'the Home submitted the deploy but returned no address', '/a2a/session/deploy/submit');
  return { address: address.toLowerCase(), txHash: typeof submitted.transactionHash === 'string' ? submitted.transactionHash : null };
}

/* ------------------------------------------------- recording it at the Home */

export interface RecordTreasuryInput {
  /** The person the treasury belongs to. Must equal the `sub` of `homeSession`. */
  person: string;
  treasury: string;
  /** `<label>.treasury`, or '' for a nameless treasury (the address is the canonical id). */
  name: string;
}

/**
 * Tell the person's Home that this treasury is theirs, so DISCOVERY finds it next time — from any
 * app, not just this one. Without this the account exists on chain and belongs to nobody's view of
 * their own agents, which is the same as not existing.
 *
 * Authorised by the person's own Home session, whose `sub` the Home checks against `person`.
 */
export async function recordPersonTreasury(cfg: HomeApiConfig, homeSession: string, input: RecordTreasuryInput): Promise<void> {
  await post(
    cfg,
    '/connect/related-orgs',
    {
      person: input.person,
      orgAgent: input.treasury,
      orgName: input.name,
      purpose: 'personal treasury',
      kind: PERSON_TREASURY_KIND,
      parent: input.person,
      relationship: 'steward',
    },
    { authorization: `Bearer ${homeSession}` },
  );
}

/**
 * Where to send a REAL player to make a treasury.
 *
 * The Home's bootstrap endpoint needs a custody-grade session minted by the Home's own credential
 * ceremony; a relying app's id_token can never be one, so there is nothing for this app to call. The
 * honest move is to hand the person to their Home's portal, which creates and CUSTODIES the account,
 * and to have them come back to a page that re-runs discovery.
 */
export function managedAgentsUrl(cfg: HomeApiConfig): string {
  return `${base(cfg)}/treasuries`;
}
