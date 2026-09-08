/**
 * The house money layer.
 *
 * Reading is a plain `balanceOf`. Moving is the platform's canonical Smart Agent
 * sequence, because `AgentAccount.execute` is gated to EntryPoint / self /
 * DelegationManager — a custodian EOA CANNOT call it directly:
 *
 *   buildErc20Transfer -> buildExecuteCallData -> AgentAccountClient.buildCallUserOp
 *   -> custodian signs userOpHash -> AgentAccountClient.submitCallUserOp
 *
 * The custodian only ever signs; it never holds or touches the asset.
 */

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type PublicClient,
} from 'viem';
import {
  AgentAccountClient,
  readErc20Balance,
  type AgentAccountSpec,
} from '@agenticprimitives/agent-account';
import {
  buildTestAssetMintData,
  buildUsdcTransferCallData,
  TEST_ASSET_MINT_ABI,
} from './calls.js';
import {
  TreasuryError,
  type Address,
  type Hex,
  type TransferUsdcRequest,
  type TransferUsdcResult,
  type TreasuryClientOpts,
  type TreasuryDeployments,
} from './types.js';

/**
 * `UserOperationEvent` carries the `success` flag. An EntryPoint `handleOps` tx can
 * succeed while the inner op reverted, so a green receipt alone is not proof the
 * money moved — we read this event back.
 */
const USER_OPERATION_EVENT_ABI = [
  {
    type: 'event',
    name: 'UserOperationEvent',
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'paymaster', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'success', type: 'bool', indexed: false },
      { name: 'actualGasCost', type: 'uint256', indexed: false },
      { name: 'actualGasUsed', type: 'uint256', indexed: false },
    ],
  },
] as const;

export interface TreasuryClient {
  readonly deployments: TreasuryDeployments;
  readonly custodian: Address;

  /** Base units of the settlement asset held by any address (EOA or Smart Agent). */
  readUsdcBalance(address: Address): Promise<bigint>;

  /**
   * Move the asset OUT of a Smart Agent this client's signer custodies.
   * Throws `TreasuryError` if the account is not deployed, the signer is not a
   * custodian, or the UserOp lands but reverts.
   */
  transferUsdc(req: TransferUsdcRequest): Promise<TransferUsdcResult>;

  /** CREATE2 address for a spec — pure derivation, no deploy. */
  deriveAgentAccount(spec: AgentAccountSpec): Promise<Address>;
  /** Deploy if absent, otherwise return the existing address. Idempotent. */
  deployAgentAccount(spec: AgentAccountSpec, deployerAccount?: unknown): Promise<Address>;

  isDeployed(account: Address): Promise<boolean>;
  isCustodian(account: Address, address: Address): Promise<boolean>;

  /**
   * Mint the TEST asset (faithchain's MockUSDC has a permissionless
   * `mint(address,uint256)`). Sent as a plain EOA transaction by the relayer — no
   * Smart Agent is involved. Reverts on any asset without an open mint, which is
   * exactly what a real USDC deployment should do.
   */
  mintTestAsset(to: Address, amount: bigint, minterAccount?: unknown): Promise<Hex>;
}

export function createTreasuryClient(opts: TreasuryClientOpts): TreasuryClient {
  const { rpcUrl, chainId, deployments, signer } = opts;
  if (!rpcUrl) throw new TreasuryError('not-configured', 'rpcUrl is required');
  if (!deployments?.asset) throw new TreasuryError('not-configured', 'deployments.asset is required');
  if (!deployments.entryPoint) throw new TreasuryError('not-configured', 'deployments.entryPoint is required');
  if (!deployments.agentAccountFactory) {
    throw new TreasuryError('not-configured', 'deployments.agentAccountFactory is required');
  }
  if (!deployments.paymaster) throw new TreasuryError('not-configured', 'deployments.paymaster is required');

  const relayer = opts.relayer ?? signer;
  const callGasLimit = opts.callGasLimit ?? 200_000n;

  const publicClient: PublicClient = createPublicClient({ transport: http(rpcUrl) });
  const accounts = new AgentAccountClient({
    rpcUrl,
    chainId,
    entryPoint: deployments.entryPoint,
    factory: deployments.agentAccountFactory,
  });

  async function readUsdcBalance(address: Address): Promise<bigint> {
    return readErc20Balance(
      (args) => publicClient.readContract(args),
      deployments.asset,
      address,
    );
  }

  async function transferUsdc(req: TransferUsdcRequest): Promise<TransferUsdcResult> {
    if (req.amount <= 0n) {
      throw new TreasuryError('bad-amount', `amount must be > 0, got ${req.amount}`);
    }
    if (!(await accounts.isDeployed(req.from))) {
      throw new TreasuryError('not-deployed', `${req.from} has no code — deploy the Smart Agent first`);
    }
    if (!(await accounts.isCustodian(req.from, signer.address))) {
      throw new TreasuryError('not-custodian', `${signer.address} is not a custodian of ${req.from}`);
    }

    const callData = buildUsdcTransferCallData(deployments.asset, req.to, req.amount);
    const { userOp, userOpHash } = await accounts.buildCallUserOp({
      sender: req.from,
      callData,
      paymaster: deployments.paymaster,
      callGasLimit,
    });

    const signature = await signer.signMessage({ message: { raw: userOpHash } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { receipt } = await accounts.submitCallUserOp({ ...userOp, signature }, relayer as any);

    if (receipt.status !== 'success') {
      throw new TreasuryError('transfer-reverted', `handleOps reverted in ${receipt.transactionHash}`);
    }
    assertUserOpSucceeded(receipt.logs, userOpHash, receipt.transactionHash);
    return { txHash: receipt.transactionHash, receipt };
  }

  async function mintTestAsset(to: Address, amount: bigint, minterAccount?: unknown): Promise<Hex> {
    if (amount <= 0n) throw new TreasuryError('bad-amount', `amount must be > 0, got ${amount}`);
    const account = (minterAccount ?? relayer) as never;
    const wallet = createWalletClient({ account, transport: http(rpcUrl) });
    const hash = await wallet.writeContract({
      address: deployments.asset,
      abi: TEST_ASSET_MINT_ABI,
      functionName: 'mint',
      args: [to, amount],
      account,
      chain: null,
      // Explicit: faithchain (Besu, free gas) intermittently 200s an empty body for
      // eth_estimateGas, which viem surfaces as "Method eth_estimateGas is not supported".
      gas: 120_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
    // Encoded here too so the calldata builder stays exercised by the unit tests.
    void buildTestAssetMintData(to, amount);
    return hash;
  }

  return {
    deployments,
    custodian: signer.address,
    readUsdcBalance,
    transferUsdc,
    deriveAgentAccount: (spec) => accounts.getAddressForAgentAccount(spec),
    deployAgentAccount: (spec, deployerAccount) =>
      accounts.createAgentAccountFromAccount(spec, deployerAccount ?? relayer),
    isDeployed: (account) => accounts.isDeployed(account),
    isCustodian: (account, address) => accounts.isCustodian(account, address),
    mintTestAsset,
  };
}

/** Throw unless the EntryPoint reported `success = true` for this userOpHash. */
function assertUserOpSucceeded(
  logs: readonly { topics: readonly Hex[]; data: Hex }[],
  userOpHash: Hex,
  txHash: Hex,
): void {
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: USER_OPERATION_EVENT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== 'UserOperationEvent') continue;
    if (decoded.args.userOpHash.toLowerCase() !== userOpHash.toLowerCase()) continue;
    if (!decoded.args.success) {
      throw new TreasuryError('transfer-reverted', `userOp ${userOpHash} was included in ${txHash} but reverted`);
    }
    return;
  }
  throw new TreasuryError('transfer-reverted', `no UserOperationEvent for ${userOpHash} in ${txHash}`);
}
