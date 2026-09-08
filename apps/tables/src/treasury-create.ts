/**
 * Making a player a treasury.
 *
 * A treasury is a `treasury`-kind Smart Agent chartered under the person, and it is NOT their person
 * agent (DESIGN.md §5.0). Who can make one depends on who is playing:
 *
 *   real player    their Home's own portal, because the Home's bootstrap endpoint requires a
 *                  custody-grade session minted by the Home's credential ceremony. A relying app's
 *                  id_token is not one and never can be, so this module does not pretend: it hands
 *                  back the URL to send them to.
 *   demo persona   the Home lends the identity AND holds its custodian key, so the whole ceremony
 *                  runs here: derive, deploy at the Home under the persona's own custodian, claim an
 *                  optional name, and record the result so DISCOVERY finds it — for every app, not
 *                  just this one.
 *
 * The card room never becomes a custodian of anything it creates. It asks the Home to build the
 * operation and the Home's own persona key signs it; every address is injected.
 */

import { encodeFunctionData } from 'viem';
import { buildExecuteBatchCallData, type ContractCall } from '@agenticprimitives/agent-account';
import {
  HomeApiError,
  checkTreasuryLabel,
  deployAgentAtHome,
  personaSignDigest,
  recordPersonTreasury,
  type DemoPersona,
  type HomeApiConfig,
  type NameCheck,
} from './home-api.js';

type Address = `0x${string}`;
type Hex = `0x${string}`;

/** Everything chain-shaped the ceremony needs. Read from `wrangler.toml`, never from this file. */
export interface TreasuryCreationConfig {
  home: HomeApiConfig;
  /** `AgentNameRegistry` — where an agent sets its own primary (reverse) name. */
  nameRegistry: Address;
  /** The `.treasury` PermissionlessSubregistry — where `<label>.treasury` is claimed. */
  treasurySubregistry: Address;
}

/** A refusal a player can act on, as opposed to an exception nobody can read. */
export class TreasuryCreationError extends Error {
  constructor(
    readonly reason: string,
    readonly code: 'label-taken' | 'label-unusable' | 'not-configured' | 'home-refused',
  ) {
    super(reason);
    this.name = 'TreasuryCreationError';
  }
}

export interface CreatedTreasury {
  address: string;
  /** `<label>.treasury`, or '' — a treasury is allowed to be nameless, and that is the default. */
  name: string;
  txHash: string | null;
  /** The deployment salt, as bytes32. Kept so the account is recoverable from the custodian alone. */
  salt: Hex;
}

const REGISTER_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'label', type: 'string' }, { name: 'newOwner', type: 'address' }], outputs: [] },
] as const;

const SET_PRIMARY_NAME_ABI = [
  { type: 'function', name: 'setPrimaryName', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [] },
] as const;

/** A random 64-bit salt, so one custodian can hold many agents at distinct addresses. */
function randomSalt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let salt = 0n;
  for (const b of bytes) salt = (salt << 8n) | BigInt(b);
  return salt;
}

function saltBytes32(salt: bigint): Hex {
  return `0x${salt.toString(16).padStart(64, '0')}` as Hex;
}

/**
 * Check a label before anything is deployed, so "that name is taken" arrives while the player is
 * still typing rather than after an on-chain revert.
 */
export async function checkLabel(cfg: TreasuryCreationConfig, label: string): Promise<NameCheck> {
  return checkTreasuryLabel(cfg.home, label);
}

export interface CreateForPersonaInput {
  persona: DemoPersona;
  /** The persona's Home session (`/connect/demo-signin`). Authorises the signature and the record. */
  homeSession: string;
  /** Optional. Nameless is the default: the Smart Agent address is the canonical id. */
  label?: string;
}

/**
 * Create a treasury for one of the Home's demo people, end to end.
 *
 * The name claim, when there is one, rides INSIDE the deploy operation: `register` gives the label to
 * the new account and `setPrimaryName` makes it the account's own reverse record, both as the account
 * itself, in the same batch that brings it into existence. One signature, one transaction, and no
 * window in which a deployed treasury has a half-claimed name.
 */
export async function createTreasuryForPersona(cfg: TreasuryCreationConfig, input: CreateForPersonaInput): Promise<CreatedTreasury> {
  const wanted = (input.label ?? '').trim();
  const sign = (digest: Hex): Promise<Hex> => personaSignDigest(cfg.home, input.homeSession, digest);
  const salt = randomSalt();

  // Nameless is the default and the simple case: the deploy IS the whole operation.
  if (!wanted) {
    const out = await home(() => deployAgentAtHome(cfg.home, { owner: input.persona.custodian, salt }, sign));
    await home(() => recordPersonTreasury(cfg.home, input.homeSession, { person: input.persona.sa, treasury: out.address, name: '' }));
    return { address: out.address, name: '', txHash: out.txHash, salt: saltBytes32(salt) };
  }

  // A named treasury needs its own address before it can claim anything, because `register` names the
  // owner and `setPrimaryName` runs AS the account. So: check the label, ask the Home to derive the
  // address (a build with no callData submits nothing), then batch the two calls into the deploy.
  const check = await checkLabel(cfg, wanted);
  if (check.status === 'taken') {
    throw new TreasuryCreationError(`${check.name} is already taken — choose another label, or leave it nameless`, 'label-taken');
  }
  if (check.status === 'unusable') throw new TreasuryCreationError(check.reason, 'label-unusable');

  const predicted = await home(() => deriveAtHome(cfg.home, input.persona.custodian, salt));
  const calls: ContractCall[] = [
    {
      to: cfg.treasurySubregistry,
      value: 0n,
      data: encodeFunctionData({ abi: REGISTER_ABI, functionName: 'register', args: [check.label, predicted] }),
    },
    {
      to: cfg.nameRegistry,
      value: 0n,
      data: encodeFunctionData({ abi: SET_PRIMARY_NAME_ABI, functionName: 'setPrimaryName', args: [check.node as Hex] }),
    },
  ];

  const out = await home(() =>
    deployAgentAtHome(cfg.home, { owner: input.persona.custodian, salt, callData: buildExecuteBatchCallData(calls) }, sign),
  );
  if (out.address.toLowerCase() !== predicted.toLowerCase()) {
    throw new TreasuryCreationError(
      `the Home deployed ${out.address} but the name was claimed for ${predicted} — nothing was recorded`,
      'home-refused',
    );
  }
  await home(() => recordPersonTreasury(cfg.home, input.homeSession, { person: input.persona.sa, treasury: out.address, name: check.name }));
  return { address: out.address, name: check.name, txHash: out.txHash, salt: saltBytes32(salt) };
}

async function deriveAtHome(cfg: HomeApiConfig, owner: string, salt: bigint): Promise<Address> {
  const origin = cfg.origin.replace(/\/+$/, '');
  const res = await fetch(`${origin}/a2a/session/deploy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-csrf-token': await csrfToken(cfg) },
    body: JSON.stringify({ initMethod: 'eoa', owner, salt: salt.toString() }),
  });
  const body = (await res.json().catch(() => ({}))) as { sender?: string; error?: string };
  if (!res.ok || !body.sender) {
    throw new HomeApiError(res.status, body.error ?? 'the Home would not derive the account', '/a2a/session/deploy');
  }
  return body.sender as Address;
}

async function csrfToken(cfg: HomeApiConfig): Promise<string> {
  const origin = cfg.origin.replace(/\/+$/, '');
  const res = await fetch(`${origin}/a2a/auth/csrf`, { headers: { origin } });
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!body.token) throw new HomeApiError(res.status, 'the Home issued no CSRF token', '/a2a/auth/csrf');
  return body.token;
}

/** Turn a Home refusal into one this app's callers can show, without losing what the Home said. */
async function home<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HomeApiError) throw new TreasuryCreationError(`the Home refused: ${e.reason}`, 'home-refused');
    throw e;
  }
}
