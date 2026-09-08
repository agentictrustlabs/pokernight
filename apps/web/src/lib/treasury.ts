/**
 * The money, as the client understands it — the PURE half.
 *
 * Two things are being shown, and they are different: what funds a player (their treasury and its
 * balance) and what has happened to a particular movement (pending, settled with a tx, or failed
 * with a reason). Both come off the wire as base units and receipts; everything here turns those
 * into sentences, and nothing here fetches, so it is all testable without a server.
 *
 * The client NEVER decides where money goes. It can suggest an address; the Worker checks custody
 * and records the choice server-side. So the shapes below are read models, not authority.
 */

/** Mirrors `TreasuryCandidate` in apps/tables/src/routes-treasury.ts. */
export interface TreasuryCandidate {
  address: string;
  label: string;
  source: 'home-agent' | 'chosen';
  balance: string | null;
  balanceUsdc: string | null;
  error?: string;
}

/** Mirrors `TreasuryView` in apps/tables/src/routes-treasury.ts. */
export interface TreasuryView {
  chainId: number;
  asset: string;
  chipValue: string;
  chosen: string | null;
  balance: string | null;
  balanceUsdc: string | null;
  candidates: TreasuryCandidate[];
  faucet: { available: boolean; asset: string | null; reason: string | null };
  unavailable: string | null;
}

export interface SelectTreasuryResult {
  chosen: string;
  balance: string | null;
  balanceUsdc: string | null;
}

export interface FundTreasuryResult {
  treasury: string;
  minted: string;
  mintedUsdc: string;
  txHash: string;
  balance: string | null;
  balanceUsdc: string | null;
  asset: string;
  note: string;
}

export type SettlementStatus = 'pending' | 'settled' | 'failed';

export interface SettlementReceiptView {
  mode: 'play-money' | 'mandate-transfer' | 'table-escrow';
  orderId: string;
  amount: string;
  asset: string;
  ref: string;
  at: number;
  status?: SettlementStatus;
  error?: string;
  attempts?: number;
}

export interface SettlementEntry {
  id: string;
  seat: number;
  kind: string;
  chips: number;
  handNo: number | null;
  at: number;
  receipt: SettlementReceiptView | null;
}

export interface TableSettlement {
  tableId: string;
  settlement: 'play-money' | 'mandate-transfer' | 'table-escrow';
  treasury: string | null;
  entries: SettlementEntry[];
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isTreasuryAddress(v: string): boolean {
  return ADDRESS_RE.test(v.trim());
}

/**
 * Base units → a decimal USDC string. Same arithmetic as `formatUsdc` in `@pokernight/treasury`,
 * repeated here rather than imported because the web bundle has no business pulling in viem to
 * divide by a million.
 */
export function fmtUsdc(baseUnits: string | bigint | null | undefined): string | null {
  if (baseUnits === null || baseUnits === undefined || baseUnits === '') return null;
  let v: bigint;
  try {
    v = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits);
  } catch {
    return null;
  }
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** What a stack of chips is worth, given the table's chip value. Null when either is unreadable. */
export function chipsToUsdcLabel(chips: number, chipValue: string | null | undefined): string | null {
  if (!chipValue || !Number.isFinite(chips)) return null;
  let cv: bigint;
  try {
    cv = BigInt(chipValue);
  } catch {
    return null;
  }
  if (cv <= 0n) return null;
  return fmtUsdc(BigInt(Math.trunc(chips)) * cv);
}

/** The state a receipt reports. A row with no `status` was written settled — see the ledger package. */
export function statusOf(receipt: SettlementReceiptView | null | undefined): SettlementStatus | null {
  if (!receipt) return null;
  return receipt.status ?? 'settled';
}

/** `buy-in` → "Buy-in". Ledger kinds are wire values; this is the only place they become English. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'buy-in':
      return 'Buy-in';
    case 'add-chips':
      return 'Rebuy';
    case 'cash-out':
      return 'Cash-out';
    case 'hand-result':
      return 'Hand';
    case 'rake':
      return 'Rake';
    default:
      return kind;
  }
}

/**
 * One line about where a movement stands, in the words a player needs. A failed movement always
 * carries its reason forward: "failed" on its own is the one thing nobody can act on.
 */
export function describeSettlement(entry: SettlementEntry): string {
  const status = statusOf(entry.receipt);
  const usdc = entry.receipt ? fmtUsdc(entry.receipt.amount) : null;
  const amount = usdc ? `${usdc} USDC` : `${Math.abs(entry.chips)} chips`;
  if (status === null) return `${kindLabel(entry.kind)} of ${Math.abs(entry.chips)} chips — not settled`;
  if (status === 'pending') return `${kindLabel(entry.kind)} of ${amount} — waiting for the chain`;
  if (status === 'failed') return `${kindLabel(entry.kind)} of ${amount} — did not settle: ${entry.receipt?.error ?? 'no reason recorded'}`;
  if (entry.receipt?.mode === 'play-money') return `${kindLabel(entry.kind)} of ${Math.abs(entry.chips)} chips — play money`;
  return `${kindLabel(entry.kind)} of ${amount} — settled`;
}

/** `0x1234…abcd`, for a tx hash or an address in a place with no room for forty characters. */
export function shortRef(ref: string, n = 6): string {
  const s = ref.trim();
  if (s.length <= 2 * n + 3) return s;
  return `${s.slice(0, n + 2)}…${s.slice(-n)}`;
}

/**
 * Whether this player can take a seat at a settled table yet, and what they still have to do.
 *
 * A settled table with no treasury chosen would refuse the join with a server-side reason; saying it
 * here first turns a rejection into an instruction.
 */
export function seatBlocker(settlement: string, treasury: TreasuryView | null): string | null {
  if (settlement === 'play-money') return null;
  if (!treasury) return 'Checking which treasury funds your play…';
  if (treasury.unavailable) return treasury.unavailable;
  if (!treasury.chosen) return 'Choose the treasury that funds your play before taking a seat at this table.';
  return null;
}
