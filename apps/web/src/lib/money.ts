/**
 * Chips and what they are worth, in one place.
 *
 * A settled table has two units for the same thing and a player must never have to do the
 * multiplication themselves: 200 chips at this table IS 200.00 SHQ, and both numbers belong
 * wherever either one is shown. A play-money table has only chips, and saying "0.00 SHQ" there
 * would be a lie dressed as precision — so the rate is nullable and null means "chips only".
 *
 * Pure: no fetch, no React, no bigint leaking into props. The rate comes off the wire as the
 * TABLE's pinned `chipValue` (see `@pokernight/protocol`), never from a deployment default, because
 * a table settles at the rate it was created with whatever the deployment has since moved to.
 */

/**
 * What a table's money is called when the table does not say.
 *
 * The card room settles in one currency, Sheqel. The ticker still comes off the wire per table
 * (`TableSummary.assetSymbol`) rather than being assumed here — a table states the coin it pays in,
 * and that is the label that belongs next to a real amount of somebody's money. This is only the
 * answer for a table that names none.
 */
export const ASSET_TICKER = 'SHQ';
const ASSET_UNIT = 1_000_000n;
const ASSET_DECIMALS = 6;
/** Money reads as money: two decimal places minimum, even when the rest are zeros. */
const MIN_DECIMALS = 2;

/** What one chip is worth at a table that settles. */
export interface TableRate {
  /** Asset base units per chip. Always > 0. */
  chipValue: bigint;
  asset: string;
}

/**
 * The rate for a table, or null when there is no honest conversion to show: a play-money table, a
 * settled table whose summary has not been read yet, or a rate the server could not state.
 */
export function tableRate(
  settlement: string | null | undefined,
  chipValue: string | null | undefined,
  /** The table's own ticker (`TableSummary.assetSymbol`). Absent, see {@link ASSET_TICKER}. */
  assetSymbol?: string | null,
): TableRate | null {
  if (settlement === 'play-money' || !settlement) return null;
  if (!chipValue || !/^\d+$/.test(chipValue.trim())) return null;
  const v = BigInt(chipValue.trim());
  const asset = (assetSymbol ?? '').trim() || ASSET_TICKER;
  return v > 0n ? { chipValue: v, asset } : null;
}

/** `1234567n` → `"1.234567"`, `1000000n` → `"1.00"`, `10000n` → `"0.01"`. Grouped, sign-preserving. */
export function fmtAsset(baseUnits: bigint): string {
  const neg = baseUnits < 0n;
  const abs = neg ? -baseUnits : baseUnits;
  const whole = (abs / ASSET_UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = (abs % ASSET_UNIT).toString().padStart(ASSET_DECIMALS, '0');
  // Trim trailing zeros, but never below two places: money has cents.
  frac = frac.replace(/0+$/, '');
  while (frac.length < MIN_DECIMALS) frac += '0';
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Thousands-separated chip count. The primary figure at every table, settled or not. */
export function fmtChipCount(chips: number): string {
  const n = Number.isFinite(chips) ? Math.trunc(chips) : 0;
  return n.toLocaleString('en-US');
}

/** A chip amount and, where the table settles, the money it stands for. */
export interface DualAmount {
  chips: number;
  /** `"1,200"` — always present; chips are the table's own unit. */
  chipsText: string;
  /** `"1,200.00"`, or null on a table with no rate. */
  assetText: string | null;
  /** `"1,200.00 SHQ"`, or null. What the secondary line renders. */
  assetLabel: string | null;
  /** `"1,200 chips · 1,200.00 SHQ"` — the whole thing on one line, for titles and aria-labels. */
  label: string;
}

/**
 * The one conversion. `chips` is trusted to be an integer count from the engine; a non-finite one
 * reads as zero rather than as `NaN chips`, because a broken number on a money surface must not be
 * shown at all.
 */
export function dualAmount(chips: number, rate: TableRate | null | undefined): DualAmount {
  const n = Number.isFinite(chips) ? Math.trunc(chips) : 0;
  const chipsText = fmtChipCount(n);
  if (!rate) return { chips: n, chipsText, assetText: null, assetLabel: null, label: `${chipsText} chips` };
  const assetText = fmtAsset(BigInt(n) * rate.chipValue);
  const assetLabel = `${assetText} ${rate.asset}`;
  return { chips: n, chipsText, assetText, assetLabel, label: `${chipsText} chips · ${assetLabel}` };
}

/** `"1 chip = 1.00 SHQ"` — the rate itself, for the places that state the terms of the table. */
export function describeRate(rate: TableRate | null | undefined): string | null {
  if (!rate) return null;
  return `1 chip = ${fmtAsset(rate.chipValue)} ${rate.asset}`;
}

/** `"40–200 chips · 40.00–200.00 SHQ"` — a buy-in range, both units, one line. */
export function describeRange(min: number, max: number, rate: TableRate | null | undefined): string {
  const lo = dualAmount(min, rate);
  const hi = dualAmount(max, rate);
  const chips = `${lo.chipsText}–${hi.chipsText} chips`;
  return lo.assetText && hi.assetText ? `${chips} · ${lo.assetText}–${hi.assetText} ${(rate as TableRate).asset}` : chips;
}

/**
 * Whether a buy-in is affordable, and by how much it is not.
 *
 * The seat picker refuses BEFORE the button is pressed and the server refuses again on the way in
 * (`authorizeBuyIn`); both name the shortfall in the asset, because "not enough" without a number
 * is not something a player can act on.
 */
export interface Shortfall {
  /** Base units the buy-in costs. */
  cost: bigint;
  held: bigint;
  /** cost − held, always > 0 when this object exists. */
  short: bigint;
  /** "Your treasury holds 1.00 SHQ and this buy-in costs 200.00 SHQ — 199.00 SHQ short." */
  reason: string;
}

export function buyInShortfall(chips: number, balance: string | null | undefined, rate: TableRate | null | undefined): Shortfall | null {
  if (!rate || balance === null || balance === undefined || !/^-?\d+$/.test(String(balance).trim())) return null;
  const n = Number.isFinite(chips) ? Math.trunc(chips) : 0;
  if (n <= 0) return null;
  const cost = BigInt(n) * rate.chipValue;
  const held = BigInt(String(balance).trim());
  if (held >= cost) return null;
  const short = cost - held;
  return {
    cost,
    held,
    short,
    reason:
      `Your treasury holds ${fmtAsset(held)} ${rate.asset} and this ${fmtChipCount(n)}-chip buy-in costs ` +
      `${fmtAsset(cost)} ${rate.asset} — ${fmtAsset(short)} ${rate.asset} short. Fund it, or buy in for less.`,
  };
}

/** The most chips a balance can pay for at this rate. Floor: a part-chip buys no chip. */
export function affordableChips(balance: string | null | undefined, rate: TableRate | null | undefined): number | null {
  if (!rate || balance === null || balance === undefined || !/^-?\d+$/.test(String(balance).trim())) return null;
  const held = BigInt(String(balance).trim());
  if (held <= 0n) return 0;
  const chips = held / rate.chipValue;
  return chips > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(chips);
}

/** How a table settles, in the words a player needs before they sit — not after. */
export interface ModeDescription {
  settles: boolean;
  /** Two words for a badge: this table's ticker ("SHQ") or "Play money". */
  label: string;
  /** One sentence saying what pressing "Sit down" will actually do. */
  line: string;
}

export function describeMode(settlement: string | null | undefined, rate: TableRate | null | undefined): ModeDescription {
  if (settlement === 'play-money' || !settlement) {
    return {
      settles: false,
      label: 'Play money',
      line: 'Play money. Nothing moves on chain, and these chips are only good at this table.',
    };
  }
  // The badge names THIS table's currency, from the table's own record rather than from anything
  // the client assumes about the deployment.
  const ticker = rate?.asset ?? ASSET_TICKER;
  const at = describeRate(rate);
  return {
    settles: true,
    label: ticker,
    line: `Settles in ${ticker}. Buying in moves real money out of your treasury${at ? `, at ${at}` : ''}.`,
  };
}
