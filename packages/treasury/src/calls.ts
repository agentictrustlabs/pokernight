/**
 * Call encoding. Pure — every function here is a deterministic bytes builder, so
 * the unit tests cover the money path without touching a network.
 *
 * The canonical "move the asset out of a Smart Agent" shape is the platform's:
 *   buildErc20Transfer(asset, to, amount)   -> { to, value, data }   (@agenticprimitives/payments)
 *   buildExecuteCallData(call)              -> AgentAccount.execute calldata
 *   ...which becomes the `callData` of a paymaster-sponsored UserOp.
 */

import { encodeFunctionData } from 'viem';
import { buildErc20Transfer, type TransferPlan } from '@agenticprimitives/payments';
import { buildExecuteCallData, type ContractCall } from '@agenticprimitives/agent-account';
import { TreasuryError, type Address, type Hex } from './types.js';

export type { TransferPlan, ContractCall };

export const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * `mint(address,uint256)` — present on the faithchain test asset (MockUSDC) and
 * permissionless there. Not part of ERC-20; only `mintTestAsset` uses it and only a
 * test asset will answer to it.
 */
export const TEST_ASSET_MINT_ABI = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

function assertAmount(amount: bigint): void {
  if (amount <= 0n) throw new TreasuryError('bad-amount', `amount must be > 0, got ${amount}`);
}

/** The inner ERC-20 transfer the Smart Agent performs: `asset.transfer(to, amount)`. */
export function buildUsdcTransferPlan(asset: Address, to: Address, amount: bigint): TransferPlan {
  assertAmount(amount);
  return buildErc20Transfer(asset, to, amount);
}

/**
 * The `callData` field of the UserOp: `AgentAccount.execute(asset, 0, transfer(to, amount))`.
 * This is the exact payload the custodian's signature over the userOpHash authorises.
 */
export function buildUsdcTransferCallData(asset: Address, to: Address, amount: bigint): Hex {
  const plan = buildUsdcTransferPlan(asset, to, amount);
  return buildExecuteCallData({ to: plan.to, value: plan.value, data: plan.data });
}

/** `mint(to, amount)` calldata for the faithchain test asset. */
export function buildTestAssetMintData(to: Address, amount: bigint): Hex {
  assertAmount(amount);
  return encodeFunctionData({ abi: TEST_ASSET_MINT_ABI, functionName: 'mint', args: [to, amount] });
}
