import { useMemo } from 'react';
import { chipsFor, type ChipBreakdown } from '../lib/chips';
import { fmtChips } from '../lib/format';

/* Disc geometry, in the SVG's own units. */
const RX = 11;
const RY = 3.4;
/** Vertical rise per disc — the visible edge of one chip. */
const SIDE = 4;
const GAP = 4;
const COL_W = RX * 2 + GAP;

/** CSS pixels per SVG unit, by size. The drawing keeps its aspect ratio at every size. */
const SCALE: Record<'xs' | 'sm' | 'md', number> = { xs: 0.55, sm: 0.72, md: 1 };

function Column({ x, count, tone }: { x: number; count: number; tone: string; }) {
  const discs = [];
  for (let i = 0; i < count; i++) discs.push(i);
  return (
    <g className={`chip-col tone-${tone}`} transform={`translate(${x} 0)`}>
      {discs.map((i) => (
        <Disc key={i} cy={-i * SIDE} />
      ))}
    </g>
  );
}

/** One chip: a squat cylinder with three edge stripes. `cy` is relative to the column baseline. */
function Disc({ cy }: { cy: number }) {
  return (
    <g transform={`translate(0 ${cy})`}>
      <ellipse className="chip-side" cx={RX} cy={SIDE} rx={RX} ry={RY} />
      <rect className="chip-side" x={0} y={0} width={RX * 2} height={SIDE} />
      <rect className="chip-stripe" x={2.5} y={0} width={2} height={SIDE} />
      <rect className="chip-stripe" x={RX - 1} y={0} width={2} height={SIDE} />
      <rect className="chip-stripe" x={RX * 2 - 4.5} y={0} width={2} height={SIDE} />
      <ellipse className="chip-top" cx={RX} cy={0} rx={RX} ry={RY} />
      <ellipse className="chip-pip" cx={RX} cy={0} rx={RX - 3.5} ry={RY - 1.3} />
    </g>
  );
}

export interface ChipStackProps {
  amount: number;
  /** Table big blind: sets the denomination ladder. */
  bigBlind: number;
  /** Caption under the discs, and the prefix of the screen-reader label. */
  label?: string;
  /** Screen-reader prefix when no visible caption is wanted (chips on the felt). */
  ariaLabel?: string;
  size?: 'xs' | 'sm' | 'md';
  /** Render the mono amount under the discs. On by default — it carries the precision. */
  showAmount?: boolean;
  /** Draw nothing (but keep the number) when the amount is zero. */
  showZero?: boolean;
  className?: string;
  /** Cap the drawing harder than the default, for tight spots. */
  maxColumns?: number;
  maxPerColumn?: number;
}

/**
 * An amount of chips drawn as real stacked discs: one column per denomination
 * (white 1s, red 5s, green 25s, slate 100s, purple 500s at 1/2 blinds), height
 * standing in for the count. The drawing is capped; the mono number below it is
 * always exact.
 */
export function ChipStack({
  amount,
  bigBlind,
  label,
  ariaLabel,
  size = 'sm',
  showAmount = true,
  showZero = false,
  className,
  maxColumns,
  maxPerColumn,
}: ChipStackProps) {
  const b: ChipBreakdown = useMemo(
    () => chipsFor(amount, bigBlind, { maxColumns, maxPerColumn }),
    [amount, bigBlind, maxColumns, maxPerColumn],
  );
  const draw = amount > 0 || showZero;
  const cols = draw ? b.columns : [];
  const tallest = cols.reduce((a, c) => Math.max(a, c.count), 0);
  const w = Math.max(1, cols.length * COL_W - GAP);
  const h = 2 * RY + Math.max(1, tallest) * SIDE + 1;
  const baseline = h - RY - SIDE;
  const k = SCALE[size];
  const text = fmtChips(amount);
  const prefix = ariaLabel ?? label;
  const aria = `${prefix ? `${prefix}: ` : ''}${text} chips`;

  return (
    <span className={`chips chips-${size}${className ? ` ${className}` : ''}`} role="img" aria-label={aria}>
      {cols.length > 0 ? (
        <svg
          className="chip-art"
          viewBox={`0 0 ${w} ${h}`}
          width={Math.round(w * k * 10) / 10}
          height={Math.round(h * k * 10) / 10}
          preserveAspectRatio="xMidYMax meet"
          aria-hidden="true"
          focusable="false"
        >
          <g transform={`translate(0 ${baseline})`}>
            {cols.map((c, i) => (
              <Column key={`${c.value}-${i}`} x={i * COL_W} count={c.count} tone={c.tone} />
            ))}
          </g>
        </svg>
      ) : null}
      {showAmount ? (
        <span className="chip-amount num" title={b.truncated ? `${text} chips (drawing simplified)` : `${text} chips`}>
          {label ? <span className="chip-label">{label}</span> : null}
          {text}
        </span>
      ) : null}
    </span>
  );
}
