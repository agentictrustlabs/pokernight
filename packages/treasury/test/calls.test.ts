import { decodeFunctionData, encodeFunctionData, type Address } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  TreasuryError,
  buildTestAssetMintData,
  buildUsdcTransferCallData,
  buildUsdcTransferPlan,
} from '../src/index.js';

// Fixture addresses only — this package must never carry a real deployment address.
const ASSET = '0x00000000000000000000000000000000000000a5' as Address;
const TO = '0x00000000000000000000000000000000000000b0' as Address;

const EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

describe('buildUsdcTransferPlan', () => {
  it('targets the asset with zero value and transfer(to, amount) calldata', () => {
    const plan = buildUsdcTransferPlan(ASSET, TO, 250_000n);
    expect(plan.to).toBe(ASSET);
    expect(plan.value).toBe(0n);
    expect(plan.data).toBe(
      encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transfer', args: [TO, 250_000n] }),
    );
  });

  it('rejects a zero or negative amount', () => {
    expect(() => buildUsdcTransferPlan(ASSET, TO, 0n)).toThrow(TreasuryError);
    expect(() => buildUsdcTransferPlan(ASSET, TO, -1n)).toThrow(/amount must be > 0/);
  });
});

describe('buildUsdcTransferCallData', () => {
  it('wraps the transfer in AgentAccount.execute(asset, 0, transfer(...))', () => {
    const callData = buildUsdcTransferCallData(ASSET, TO, 1_000_000n);
    const outer = decodeFunctionData({ abi: EXECUTE_ABI, data: callData });
    expect(outer.functionName).toBe('execute');
    const [target, value, inner] = outer.args;
    expect(target.toLowerCase()).toBe(ASSET);
    expect(value).toBe(0n);

    const decodedInner = decodeFunctionData({ abi: TRANSFER_ABI, data: inner });
    expect(decodedInner.functionName).toBe('transfer');
    expect(decodedInner.args[0].toLowerCase()).toBe(TO);
    expect(decodedInner.args[1]).toBe(1_000_000n);
  });

  it('is deterministic — the same inputs sign to the same bytes', () => {
    expect(buildUsdcTransferCallData(ASSET, TO, 7n)).toBe(buildUsdcTransferCallData(ASSET, TO, 7n));
    expect(buildUsdcTransferCallData(ASSET, TO, 7n)).not.toBe(buildUsdcTransferCallData(ASSET, TO, 8n));
  });

  it('starts with the execute(address,uint256,bytes) selector', () => {
    // 0xb61d27f6 — the ERC-4337 account execute selector every AgentAccount exposes.
    expect(buildUsdcTransferCallData(ASSET, TO, 1n).slice(0, 10)).toBe('0xb61d27f6');
  });
});

describe('buildTestAssetMintData', () => {
  it('encodes mint(to, amount)', () => {
    const data = buildTestAssetMintData(TO, 1_000_000_000_000n);
    const decoded = decodeFunctionData({
      abi: [
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
      ] as const,
      data,
    });
    expect(decoded.args[0].toLowerCase()).toBe(TO);
    expect(decoded.args[1]).toBe(1_000_000_000_000n);
  });

  it('rejects a zero amount', () => {
    expect(() => buildTestAssetMintData(TO, 0n)).toThrow(TreasuryError);
  });
});
