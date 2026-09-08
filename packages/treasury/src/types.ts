/**
 * Shared shapes for the house money layer.
 *
 * Nothing here names a host, a chain, an address or a key: every one of those is
 * injected by the app that constructs the client (`apps/*` config, per CLAUDE.md).
 */

import type { Address, Hex, TransactionReceipt } from 'viem';

export type { Address, Hex, TransactionReceipt };

/** Stable error codes so callers can branch without string matching. */
export type TreasuryErrorCode =
  | 'not-configured'
  | 'not-deployed'
  | 'not-custodian'
  | 'bad-amount'
  | 'bad-chip-value'
  | 'chips-overflow'
  | 'transfer-reverted'
  /** The payer's treasury does not hold enough of the asset to cover the movement. */
  | 'insufficient-balance'
  /** No signed payment mandate for this payer, so there is no authority to move their money. */
  | 'no-mandate'
  /** A mandate exists but does not authorise this movement (wrong payee, asset, amount or window). */
  | 'bad-mandate';

export class TreasuryError extends Error {
  constructor(
    public readonly code: TreasuryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TreasuryError';
  }
}

/**
 * Contract addresses this layer needs. Supplied by the caller — typically read
 * straight out of `@agenticprimitives/contracts/deployments/<network>` in an app,
 * or out of `wrangler.toml` `[env.*.vars]`.
 */
export interface TreasuryDeployments {
  /** The settlement ERC-20 (6 decimals). MockUSDC on faithchain today. */
  asset: Address;
  /** ERC-4337 EntryPoint the AgentAccounts validate against. */
  entryPoint: Address;
  /** AgentAccount factory (CREATE2 address derivation + deploy). */
  agentAccountFactory: Address;
  /** Paymaster that sponsors the UserOp gas. */
  paymaster: Address;
  /**
   * DelegationManager — where a signed payment mandate is redeemed. Only the buy-in path needs it
   * (a cash-out is the house spending its own funds, which is a plain transfer), so it is optional
   * and its absence is reported as a named configuration failure rather than a crash.
   */
  delegationManager?: Address;
  /** PaymentEnforcer — the stateful caveat that caps a mandate's spend, frequency and nonce. */
  paymentEnforcer?: Address;
  /** TimestampEnforcer — the mandate's expiry caveat. */
  timestampEnforcer?: Address;
  /** AllowedTargetsEnforcer — pins the mandate to the asset contract. */
  allowedTargetsEnforcer?: Address;
  /** AllowedMethodsEnforcer — pins the mandate to `transfer`. */
  allowedMethodsEnforcer?: Address;
}

/**
 * The custodian authority. Structurally a viem `LocalAccount`, but typed as the
 * narrow surface we actually use so a KMS-backed account fits too.
 *
 * `signMessage({ message: { raw } })` must EIP-191-wrap the digest — that is what
 * `AgentAccount._validateSig` accepts (it tries the raw hash first, then the
 * eth-signed wrap, and both recover to a member of the custodian set).
 */
export interface TreasurySigner {
  readonly address: Address;
  signMessage(args: { message: { raw: Hex } }): Promise<Hex>;
}

export interface TreasuryClientOpts {
  rpcUrl: string;
  chainId: number;
  deployments: TreasuryDeployments;
  /**
   * Custodian of the Smart Agents this client moves money out of. OPTIONAL: reading balances and
   * custody needs no key, and a host that only reads should not have to hold one. Every method that
   * MOVES money refuses by name when it is absent.
   */
  signer?: TreasurySigner;
  /**
   * Account that broadcasts the EntryPoint `handleOps` transaction and receives the
   * bundler reward. Defaults to `signer`. On a zero-gas chain any funded-or-not EOA
   * works; on a paying chain this is the one that needs native balance.
   */
  relayer?: TreasurySigner;
  /** Gas limit for the inner `AgentAccount.execute` call. Default 200_000. */
  callGasLimit?: bigint;
}

export interface TransferUsdcRequest {
  /** Smart Agent the funds leave (must be deployed and custodied by `signer`). */
  from: Address;
  to: Address;
  /** Base units (6 decimals). */
  amount: bigint;
}

export interface TransferUsdcResult {
  txHash: Hex;
  receipt: TransactionReceipt;
}

/** A single call to make from a Smart Agent this client custodies. */
export interface ExecuteCallRequest {
  /** Smart Agent that makes the call (must be deployed and custodied by `signer`). */
  from: Address;
  to: Address;
  value?: bigint;
  data: Hex;
  /** Overrides the client's default gas for the inner call. A delegation redemption runs several
   *  enforcers plus an ERC-20 transfer, so it needs more than a bare transfer does. */
  callGasLimit?: bigint;
}
