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

import { buyInShortfall, fmtAsset, fmtChipCount, type TableRate } from './money';

/** Mirrors `TreasuryCandidate` in apps/tables/src/routes-treasury.ts. */
export interface TreasuryCandidate {
  address: string;
  /** `<label>.treasury`, or '' — a treasury is allowed to be nameless. */
  name: string;
  label: string;
  balance: string | null;
  balanceUsdc: string | null;
  error?: string;
}

/** Mirrors `TreasuryCreationOffer`. Who makes the treasury, and where a real player goes to do it. */
export interface TreasuryCreationOffer {
  mode: 'server' | 'home-portal';
  portalUrl: string | null;
  canName: boolean;
}

/** Mirrors `MandateView`. What the player has authorised, or would be authorising. */
export interface MandateView {
  present: boolean;
  treasury: string | null;
  maxPerBuyIn: string;
  sessionTotal: string;
  maxBuyIns: number;
  validUntil: number;
  payee: string;
  asset: string;
  problem: string | null;
  unavailable: string | null;
}

/** Mirrors `TreasuryView` in apps/tables/src/routes-treasury.ts. */
export interface TreasuryView {
  chainId: number;
  asset: string;
  /**
   * The DEPLOYMENT DEFAULT rate, which is what a new table would be opened at and what a mandate is
   * sized against. It is NOT the rate any particular table settles at — that is pinned on the table
   * and arrives as `TableSummary.chipValue`. Never convert a stack with this.
   */
  chipValue: string;
  /** The player's PERSON agent — their identity. Never a candidate; shown so that is visible. */
  person: string | null;
  personName: string | null;
  chosen: string | null;
  chosenName: string | null;
  balance: string | null;
  balanceUsdc: string | null;
  candidates: TreasuryCandidate[];
  discoveryError: string | null;
  create: TreasuryCreationOffer;
  mandate: MandateView;
  faucet: { available: boolean; asset: string | null; reason: string | null };
  notice: string | null;
  unavailable: string | null;
}

export interface CreateTreasuryResult {
  treasury: string;
  name: string;
  txHash: string | null;
  chosen: boolean;
  note: string;
}

export interface MandateResult {
  treasury: string;
  source: 'home' | 'persona';
  validUntil: number;
  maxPerBuyIn: string;
  sessionTotal: string;
  maxBuyIns: number;
  payee: string;
  asset: string;
}

export interface SelectTreasuryResult {
  chosen: string;
  name: string;
  balance: string | null;
  balanceUsdc: string | null;
  note: string;
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
  /** The rate THIS table pinned at creation, in base units per chip. Null when it has none. */
  chipValue: string | null;
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
  const chips = `${fmtChipCount(Math.abs(entry.chips))} chips`;
  // Both units, from the receipt's own base-unit amount — which was computed at the TABLE's rate
  // when the row was written, so an old table's rows keep reading in the money they actually moved.
  const raw = entry.receipt?.amount ?? '';
  const amount = /^\d+$/.test(raw) && raw !== '0' ? `${chips} (${fmtAsset(BigInt(raw))} USDC)` : chips;
  if (status === null) return `${kindLabel(entry.kind)} of ${chips} — not settled`;
  if (status === 'pending') return `${kindLabel(entry.kind)} of ${amount} — waiting for the chain`;
  if (status === 'failed') return `${kindLabel(entry.kind)} of ${amount} — did not settle: ${entry.receipt?.error ?? 'no reason recorded'}`;
  if (entry.receipt?.mode === 'play-money') return `${kindLabel(entry.kind)} of ${chips} — play money`;
  return `${kindLabel(entry.kind)} of ${amount} — settled`;
}

/**
 * One money movement, in the words a player uses about money.
 *
 * `describeSettlement` above is the engineer's sentence — chips, base units, "waiting for the
 * chain". This is the one a default view shows: what happened, how much it was in dollars, and
 * whether it is done. The transaction and the chip count stay available; they are simply not the
 * headline, because a player reading their own money should not have to translate.
 */
export interface Movement {
  /** "Bought in", "Added chips", "Cashed out". */
  what: string;
  /** `"200.00 USDC"` — the asset amount from the receipt, or the chip count when there is none. */
  amount: string;
  status: SettlementStatus;
  /** "done" · "on its way" · "did not go through". Three words, no jargon. */
  statusText: string;
  /** Why it failed. Present only when it did — a failure without its reason is unactionable. */
  problem: string | null;
  /** The transaction, for the details disclosure. Empty when there is not one yet. */
  ref: string;
  chips: number;
}

const MOVEMENT_WHAT: Record<string, string> = {
  'buy-in': 'Bought in',
  'add-chips': 'Added chips',
  'cash-out': 'Cashed out',
};

export function describeMovement(entry: SettlementEntry): Movement {
  // A row with no receipt has not been handed to the adapter yet; that is "on its way", not a
  // failure and not a settlement. Only the three asset-moving kinds reach this view at all (the
  // Worker filters hand results out), so there is no case here for a row that never settles.
  const status = statusOf(entry.receipt) ?? 'pending';
  const raw = entry.receipt?.amount ?? '';
  const chips = Math.abs(entry.chips);
  const amount = /^\d+$/.test(raw) && raw !== '0' ? `${fmtAsset(BigInt(raw))} USDC` : `${fmtChipCount(chips)} chips`;
  return {
    what: MOVEMENT_WHAT[entry.kind] ?? kindLabel(entry.kind),
    amount,
    status,
    statusText: status === 'settled' ? 'done' : status === 'failed' ? 'did not go through' : 'on its way',
    problem: status === 'failed' ? (entry.receipt?.error ?? 'no reason was recorded') : null,
    ref: entry.receipt?.ref ?? '',
    chips,
  };
}

/** `0x1234…abcd`, for a tx hash or an address in a place with no room for forty characters. */
export function shortRef(ref: string, n = 6): string {
  const s = ref.trim();
  if (s.length <= 2 * n + 3) return s;
  return `${s.slice(0, n + 2)}…${s.slice(-n)}`;
}

/** What a player must still do before a settled seat, and which control does it. */
export type SeatAction = 'wait' | 'configure' | 'create-treasury' | 'choose-treasury' | 'fund-treasury' | 'sign-mandate';

export interface SeatBlock {
  reason: string;
  action: SeatAction;
}

/**
 * What stands between this player and a seat at a settled table, in the order the things have to
 * happen: a treasury exists, it is chosen, it holds the money, and the card room has been authorised
 * to take the buy-in out of it.
 *
 * The server refuses in the same order and with the same vocabulary (`authorizeBuyIn`). Saying it
 * here first is what turns a rejection into an instruction — and the `action` is what lets the panel
 * put the control that fixes it under the sentence that names it.
 */
export function seatBlock(
  settlement: string,
  treasury: TreasuryView | null,
  buyInChips?: number,
  /**
   * THIS TABLE's rate (`tableRate(summary.settlement, summary.chipValue)`). Omitted, the buy-in is
   * not priced at all: converting a stack at the deployment default would be a different number
   * from the one the table will actually charge, and a wrong price is worse than no price.
   */
  rate?: TableRate | null,
): SeatBlock | null {
  if (settlement === 'play-money') return null;
  if (!treasury) return { reason: 'Checking which treasury funds your play…', action: 'wait' };
  if (treasury.unavailable) return { reason: treasury.unavailable, action: 'configure' };

  if (!treasury.chosen) {
    if (treasury.candidates.length === 0) {
      return {
        reason: treasury.discoveryError
          ? treasury.discoveryError
          : 'You have no money account yet. A money table pays in and out of one of your own, kept apart from the identity you signed in with.',
        action: treasury.discoveryError ? 'wait' : 'create-treasury',
      };
    }
    return { reason: 'Pick which of your money accounts pays for this seat.', action: 'choose-treasury' };
  }

  // Priced at the TABLE's rate, and refused by name — with the shortfall in USDC — before the
  // button can be pressed. The server refuses again in the same words (`authorizeBuyIn`).
  if (buyInChips !== undefined && rate) {
    const short = buyInShortfall(buyInChips, treasury.balance, rate);
    if (short) return { reason: short.reason, action: 'fund-treasury' };
  }

  if (treasury.mandate.unavailable) return { reason: treasury.mandate.unavailable, action: 'configure' };
  if (treasury.mandate.problem) return { reason: treasury.mandate.problem, action: 'sign-mandate' };
  if (!treasury.mandate.present) {
    return {
      reason: 'You have not said what this table may take. Money leaves your account only under an authority you sign at your Home.',
      action: 'sign-mandate',
    };
  }
  return null;
}

/** The same answer as one sentence, for the places that only have room for one. */
export function seatBlocker(settlement: string, treasury: TreasuryView | null, buyInChips?: number, rate?: TableRate | null): string | null {
  return seatBlock(settlement, treasury, buyInChips, rate)?.reason ?? null;
}
