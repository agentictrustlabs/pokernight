/**
 * The seam to `@pokernight/ledger`. The ledger owns the chip accounting and the
 * `SettlementAdapter` interface; this package owns the asset movement. A later
 * `MandateTransferAdapter` in `apps/*` implements the former on top of the latter —
 * these helpers are the shared vocabulary so it does not invent its own.
 */

import type {
  BuyInRequest,
  CashOutRequest,
  SettlementAdapter,
  SettlementReceipt,
} from '@pokernight/ledger';
import type { Address, Hex } from './types.js';

export type { BuyInRequest, CashOutRequest, SettlementAdapter, SettlementReceipt };

/** The settlement mode this package serves: a direct ERC-20 transfer by a Smart Agent. */
export const TREASURY_SETTLEMENT_MODE = 'mandate-transfer' as const satisfies SettlementReceipt['mode'];

/** Turn a completed transfer into the ledger's receipt shape. */
export function toSettlementReceipt(args: {
  orderId: string;
  amount: bigint;
  asset: Address;
  txHash: Hex;
  at?: number;
}): SettlementReceipt {
  return {
    mode: TREASURY_SETTLEMENT_MODE,
    orderId: args.orderId,
    amount: args.amount.toString(),
    asset: args.asset,
    ref: args.txHash,
    at: args.at ?? Date.now(),
  };
}
