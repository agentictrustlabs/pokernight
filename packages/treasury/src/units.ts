/**
 * Chip <-> asset conversion. Pure, no I/O.
 *
 * The engine deals in chips (integers). `chipValue` is the number of asset base
 * units one chip is worth; it is configuration (`CHIP_VALUE` in `apps/*`), never a
 * constant here. At 6 decimals, `chipValue = 1_000_000` means 1 chip = 1 whole unit.
 *
 * Nothing here names a currency. The card room settles in exactly one — Sheqel — and its
 * address, ticker and decimals are all `apps/*` configuration; this file only ever divides.
 */

import { TreasuryError } from './types.js';

/** Decimal places in the settlement asset. Sheqel has six, like every other amount here. */
export const ASSET_DECIMALS = 6;

/** Base units in one whole unit of the asset. */
export const ASSET_UNIT = 1_000_000n;

function assertChipValue(chipValue: bigint): void {
  if (chipValue <= 0n) {
    throw new TreasuryError('bad-chip-value', `chipValue must be > 0, got ${chipValue}`);
  }
}

/** chips → asset base units. Exact: chips are integers and chipValue is a bigint. */
export function chipsToAsset(chips: number, chipValue: bigint): bigint {
  assertChipValue(chipValue);
  if (!Number.isSafeInteger(chips) || chips < 0) {
    throw new TreasuryError('bad-amount', `chips must be a non-negative safe integer, got ${chips}`);
  }
  return BigInt(chips) * chipValue;
}

/**
 * asset base units → chips, rounded DOWN. Rounding down is deliberate: a buy-in must
 * never credit more chips than the asset that actually arrived. Use
 * {@link assetRemainder} to find the dust the conversion left behind.
 */
export function assetToChips(amount: bigint, chipValue: bigint): number {
  assertChipValue(chipValue);
  if (amount < 0n) {
    throw new TreasuryError('bad-amount', `amount must be non-negative, got ${amount}`);
  }
  const chips = amount / chipValue;
  if (chips > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TreasuryError('chips-overflow', `${amount} base units is ${chips} chips, past Number.MAX_SAFE_INTEGER`);
  }
  return Number(chips);
}

/** Base units left over after `assetToChips` — the part that buys no whole chip. */
export function assetRemainder(amount: bigint, chipValue: bigint): bigint {
  assertChipValue(chipValue);
  if (amount < 0n) {
    throw new TreasuryError('bad-amount', `amount must be non-negative, got ${amount}`);
  }
  return amount % chipValue;
}

/** Base units → a human decimal string, e.g. `1000000n` → `"1.000000"`. Display only. */
export function formatAmount(amount: bigint): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const whole = abs / ASSET_UNIT;
  const frac = (abs % ASSET_UNIT).toString().padStart(ASSET_DECIMALS, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/**
 * The same amount, written the way money is written: grouped thousands, and never more decimal
 * places than a price has — two, unless the amount genuinely carries more.
 *
 * `formatAmount` is the exact form and stays the one for receipts and comparisons, where every one
 * of the six decimals matters. This is the one for a sentence a person reads: "200.00 a time" is a
 * cap someone can hold in their head and "200.000000 a time" is a number they have to count.
 */
export function formatMoney(amount: bigint): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const whole = (abs / ASSET_UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = (abs % ASSET_UNIT).toString().padStart(ASSET_DECIMALS, '0').replace(/0+$/, '');
  while (frac.length < 2) frac += '0';
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** A decimal amount string → base units. Rejects more than 6 decimal places. */
export function parseAmount(value: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new TreasuryError('bad-amount', `not a decimal amount: ${value}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > ASSET_DECIMALS) {
    throw new TreasuryError('bad-amount', `${value} has more than ${ASSET_DECIMALS} decimal places`);
  }
  const units = BigInt(whole!) * ASSET_UNIT + BigInt(frac.padEnd(ASSET_DECIMALS, '0') || '0');
  return sign === '-' ? -units : units;
}
