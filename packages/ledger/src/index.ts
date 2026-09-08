/**
 * @pokernight/ledger — chip accounting and settlement adapters.
 *
 * The engine deals in chips. The ledger records where chips came from and
 * where they go, and a SettlementAdapter moves the corresponding asset.
 *
 *   play-money        nothing leaves the table service; receipts are local.
 *   mandate-transfer  (phase 3) the house redeems the player's poker-buyin
 *                     delegation for an ERC-20 transfer, and pays cash-outs
 *                     from the house treasury. Receipts go on-chain.
 *   table-escrow      (phase 4) buy-ins deposit into a TableEscrow contract;
 *                     the house settles with a digest-bound net-result vector.
 *
 * This package must stay free of domains and vendor SDKs; adapters that talk
 * to a chain live in apps/* and implement the interface below.
 */

export type LedgerEntryKind = 'buy-in' | 'add-chips' | 'cash-out' | 'hand-result' | 'rake';

export interface LedgerEntry {
  id: string;
  tableId: string;
  seat: number;
  playerId: string;
  kind: LedgerEntryKind;
  /** Chips, signed from the player's point of view (+ credit to stack, − debit). */
  chips: number;
  handNo: number | null;
  at: number;
  /** Settlement receipt reference when the entry moved an asset. */
  receipt?: SettlementReceipt;
}

export interface SettlementReceipt {
  mode: 'play-money' | 'mandate-transfer' | 'table-escrow';
  /** Stable order id, e.g. hash(tableId, seatSession, index). */
  orderId: string;
  /** Asset base units moved (chips × chipValue). */
  amount: string;
  asset: string;
  /** Transaction hash or local reference. */
  ref: string;
  at: number;
}

export interface BuyInRequest {
  tableId: string;
  seat: number;
  playerId: string;
  /** Opaque player address (Smart Agent) for on-chain modes. */
  playerAddress?: string;
  chips: number;
  /** Serialized delegation carried by the join command (on-chain modes only). */
  delegation?: unknown;
  orderId: string;
}

export interface CashOutRequest {
  tableId: string;
  seat: number;
  playerId: string;
  playerAddress?: string;
  chips: number;
  /** Digest of the hand history this payout settles against. */
  historyDigest: string;
  orderId: string;
}

export interface SettlementAdapter {
  readonly mode: SettlementReceipt['mode'];
  /** Asset base units per chip. */
  readonly chipValue: bigint;
  readonly asset: string;
  /** Validate that a buy-in can proceed (delegation caveats etc.) before the seat is credited. */
  authorizeBuyIn(req: BuyInRequest): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Move the asset. May be slow; hosts run it from an outbox and credit on success. */
  settleBuyIn(req: BuyInRequest): Promise<SettlementReceipt>;
  settleCashOut(req: CashOutRequest): Promise<SettlementReceipt>;
}

export class PlayMoneyAdapter implements SettlementAdapter {
  readonly mode = 'play-money' as const;
  readonly chipValue = 0n;
  readonly asset = 'play';
  async authorizeBuyIn(): Promise<{ ok: true }> {
    return { ok: true };
  }
  async settleBuyIn(req: BuyInRequest): Promise<SettlementReceipt> {
    return { mode: this.mode, orderId: req.orderId, amount: '0', asset: this.asset, ref: `play:${req.orderId}`, at: Date.now() };
  }
  async settleCashOut(req: CashOutRequest): Promise<SettlementReceipt> {
    return { mode: this.mode, orderId: req.orderId, amount: '0', asset: this.asset, ref: `play:${req.orderId}`, at: Date.now() };
  }
}

/** chips × chipValue, as a decimal string of base units. */
export function chipsToAmount(chips: number, chipValue: bigint): string {
  return (BigInt(chips) * chipValue).toString();
}

/** Sum of entries per seat must equal the seat's stack; use in reconciliation tests. */
export function balanceOf(entries: readonly LedgerEntry[], seat: number): number {
  let total = 0;
  for (const e of entries) if (e.seat === seat) total += e.chips;
  return total;
}
