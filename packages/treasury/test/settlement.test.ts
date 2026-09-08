import type { Address, Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { TREASURY_SETTLEMENT_MODE, toSettlementReceipt } from '../src/index.js';
import { chipsToAmount, type SettlementReceipt } from '@pokernight/ledger';

const ASSET = '0x00000000000000000000000000000000000000a5' as Address;
const TX = ('0x' + '11'.repeat(32)) as Hex;

describe('toSettlementReceipt', () => {
  it('produces a ledger SettlementReceipt the ledger types accept', () => {
    const receipt: SettlementReceipt = toSettlementReceipt({
      orderId: 'table-1/seat-3/buyin-0',
      amount: 100_000_000n,
      asset: ASSET,
      txHash: TX,
      at: 1_700_000_000_000,
    });
    expect(receipt).toEqual({
      mode: 'mandate-transfer',
      orderId: 'table-1/seat-3/buyin-0',
      amount: '100000000',
      asset: ASSET,
      ref: TX,
      at: 1_700_000_000_000,
    });
  });

  it('agrees with the ledger on chips -> base units', () => {
    const chipValue = 10_000n;
    const receipt = toSettlementReceipt({
      orderId: 'o',
      amount: BigInt(chipsToAmount(10_000, chipValue)),
      asset: ASSET,
      txHash: TX,
    });
    expect(receipt.amount).toBe(chipsToAmount(10_000, chipValue));
    expect(receipt.mode).toBe(TREASURY_SETTLEMENT_MODE);
  });
});
