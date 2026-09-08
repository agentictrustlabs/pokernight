import { describeMode, describeRate, type TableRate } from '../lib/money';

/**
 * How this table settles, said where a player is about to act on it.
 *
 * It is a badge rather than a sentence because it has to survive being repeated: on the table
 * header, on every open seat, and above the buy-in box. A player must never be able to sit
 * expecting money to move on a table that does not settle, nor the reverse — and the one place
 * that used to say so was a panel below the fold.
 */
export function SettlementTag({
  settlement,
  rate,
  withRate = false,
}: {
  settlement: string;
  rate: TableRate | null;
  /** Also print the rate next to the badge, where there is room for it. */
  withRate?: boolean;
}) {
  const mode = describeMode(settlement, rate);
  const at = describeRate(rate);
  return (
    <span className={`settle-tag${mode.settles ? ' money' : ' play'}`} title={mode.line}>
      <span className="tag">{mode.label}</span>
      {withRate && at ? <span className="settle-rate num">{at}</span> : null}
    </span>
  );
}
