/**
 * Chip denomination arithmetic.
 *
 * Pure and node-testable: this module decides *how many discs of what colour*
 * an amount is worth; `components/ChipStack.tsx` does the drawing. The exact
 * amount is always printed in mono next to the drawing, so the drawing is
 * allowed to be an approximation when a number is very large.
 */

export type ChipTone = 'white' | 'red' | 'green' | 'slate' | 'purple';

export interface Denomination {
  value: number;
  tone: ChipTone;
}

export interface ChipColumn {
  /** Chip value of every disc in this column. */
  value: number;
  /** Discs drawn, bottom to top. */
  count: number;
  tone: ChipTone;
}

export interface ChipBreakdown {
  amount: number;
  columns: ChipColumn[];
  /** Chips actually drawn. Equals `amount` unless the drawing was clipped. */
  drawn: number;
  /** True when the drawing does not add up: the mono number carries the truth. */
  truncated: boolean;
}

/** Casino ladder. Scaled by the table's unit so the colours always mean the same shape. */
const LADDER: readonly { mult: number; tone: ChipTone }[] = [
  { mult: 1, tone: 'white' },
  { mult: 5, tone: 'red' },
  { mult: 25, tone: 'green' },
  { mult: 100, tone: 'slate' },
  { mult: 500, tone: 'purple' },
];

/** Most columns ever drawn, whatever the amount. */
export const MAX_COLUMNS = 5;
/** Most discs ever drawn in one column. */
export const MAX_PER_COLUMN = 8;
/** A stack should have visible height: prefer a denomination worth at least this many discs. */
const MIN_TOP_COUNT = 3;

/**
 * The chip unit for a table: the largest power of ten no bigger than half the
 * big blind, never below 1. At 1/2 blinds that is 1, so the ladder is the
 * familiar 1 / 5 / 25 / 100 / 500. At 50/100 it becomes 50 / 250 / 1250 / …
 */
export function chipUnit(bigBlind: number): number {
  if (!Number.isFinite(bigBlind) || bigBlind <= 0) return 1;
  const half = Math.max(1, bigBlind / 2);
  return Math.max(1, 10 ** Math.floor(Math.log10(half)));
}

/** The five denominations in play at a table, ascending. */
export function denominations(bigBlind: number): Denomination[] {
  const unit = chipUnit(bigBlind);
  return LADDER.map((d) => ({ value: d.mult * unit, tone: d.tone }));
}

export interface BreakdownOptions {
  maxColumns?: number;
  maxPerColumn?: number;
}

/**
 * Break `amount` into drawable columns.
 *
 * The top denomination is the largest one worth at least `MIN_TOP_COUNT` discs,
 * so 200 at 1/2 blinds is eight green 25s rather than two lonely 100s, and 88 is
 * three greens, two reds and three whites rather than a wall of fives. Below
 * that it is a plain greedy change-making pass. Columns are capped in both
 * directions; anything clipped sets `truncated`.
 */
export function chipBreakdown(amount: number, denoms: Denomination[], opts: BreakdownOptions = {}): ChipBreakdown {
  const maxColumns = Math.max(1, opts.maxColumns ?? MAX_COLUMNS);
  const maxPerColumn = Math.max(1, opts.maxPerColumn ?? MAX_PER_COLUMN);
  const n = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  const ladder = denoms.filter((d) => d.value > 0).sort((a, b) => a.value - b.value);
  if (n <= 0 || ladder.length === 0) return { amount: n, columns: [], drawn: 0, truncated: false };

  let start = 0;
  for (let i = ladder.length - 1; i >= 0; i--) {
    if (Math.floor(n / ladder[i]!.value) >= MIN_TOP_COUNT) {
      start = i;
      break;
    }
  }

  const columns: ChipColumn[] = [];
  let rem = n;
  outer: for (let i = start; i >= 0; i--) {
    const d = ladder[i]!;
    let count = Math.floor(rem / d.value);
    if (count <= 0) continue;
    rem -= count * d.value;
    while (count > 0) {
      if (columns.length >= maxColumns) break outer;
      const c = Math.min(count, maxPerColumn);
      columns.push({ value: d.value, count: c, tone: d.tone });
      count -= c;
    }
  }

  // Amounts smaller than the smallest chip still deserve one disc.
  if (columns.length === 0) {
    const d = ladder[0]!;
    columns.push({ value: d.value, count: 1, tone: d.tone });
  }

  const drawn = columns.reduce((a, c) => a + c.value * c.count, 0);
  return { amount: n, columns, drawn, truncated: drawn !== n };
}

/** Convenience: break an amount down using a table's big blind. */
export function chipsFor(amount: number, bigBlind: number, opts?: BreakdownOptions): ChipBreakdown {
  return chipBreakdown(amount, denominations(bigBlind), opts);
}

/** Total discs in a breakdown — used to size the drawing box. */
export function discCount(b: ChipBreakdown): number {
  return b.columns.reduce((a, c) => a + c.count, 0);
}
