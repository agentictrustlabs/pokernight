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
  | 'transfer-reverted';

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
  /** Custodian of the Smart Agents this client moves money out of. */
  signer: TreasurySigner;
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
