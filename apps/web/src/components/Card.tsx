import type { CSSProperties } from 'react';
import type { Card as CardCode } from '../lib/types';
import { SUIT_GLYPH, cardRank, cardSuit, isRedSuit } from '../lib/format';

export interface CardProps {
  card?: CardCode;
  size?: 'sm' | 'md' | 'lg';
  /** Part of a winning five-card hand: gets the gold emphasis. */
  win?: boolean;
  /** Dimmed, for cards that lost or belong to a folded seat. */
  muted?: boolean;
  /** Entrance: 'deal' flies in from the middle of the table, 'flip' turns face up. */
  enter?: 'deal' | 'flip' | null;
  /** Stagger, in ms, for dealing several cards. */
  delayMs?: number;
  title?: string;
  style?: CSSProperties;
}

/**
 * A playing card as inline SVG. 44×62 CSS px by default (viewBox 44×62), crisp
 * at any DPR. `card` undefined renders a face-down back.
 */
export function Card({ card, size = 'md', win, muted, enter, delayMs, title, style }: CardProps) {
  const cls = [
    'card',
    size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : '',
    card && isRedSuit(card) ? 'red' : '',
    win ? 'win' : '',
    muted ? 'muted' : '',
    enter === 'deal' ? 'deal' : enter === 'flip' ? 'flip' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const s: CSSProperties = delayMs ? { ...style, animationDelay: `${delayMs}ms` } : style ?? {};

  if (!card) {
    return (
      <svg className={cls} style={s} viewBox="0 0 44 62" role="img" aria-label={title ?? 'face-down card'}>
        <rect className="back" x="0.5" y="0.5" width="43" height="61" rx="4" />
        <rect className="back-panel" x="3.5" y="3.5" width="37" height="55" rx="2.5" fill="url(#card-back-hatch)" />
        <rect className="back-panel" x="3.5" y="3.5" width="37" height="55" rx="2.5" fill="none" />
      </svg>
    );
  }

  const rank = cardRank(card);
  const suit = SUIT_GLYPH[cardSuit(card)] ?? '?';
  const label = `${rank}${suit}`;
  const narrow = rank === '10';

  return (
    <svg className={cls} style={s} viewBox="0 0 44 62" role="img" aria-label={title ?? label}>
      {win ? <rect className="glow" x="0.5" y="0.5" width="43" height="61" rx="4" /> : null}
      <rect className="face" x="0.5" y="0.5" width="43" height="61" rx="4" />
      <g className="corner">
        <text
          className="ink rank"
          x="4.5"
          y="17"
          fontSize={narrow ? 13.5 : 16}
          letterSpacing={narrow ? '-1' : '0'}
        >
          {rank}
        </text>
        <text className="ink pip" x="5" y="28.5" fontSize="10.5">
          {suit}
        </text>
      </g>
      <text className="ink centre" x="29" y="49" fontSize="23" textAnchor="middle">
        {suit}
      </text>
    </svg>
  );
}

/** Shared SVG defs (card-back pattern). Render once near the root. */
export function CardDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <pattern id="card-back-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="hatch" x1="0" y1="0" x2="0" y2="6" strokeWidth="1.5" />
          <line className="hatch thin" x1="3" y1="0" x2="3" y2="6" strokeWidth="0.6" />
        </pattern>
      </defs>
    </svg>
  );
}

/** A card-sized empty slot, so the board keeps its shape before the flop. */
export function CardSlot({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card slot${size === 'lg' ? ' lg' : size === 'sm' ? ' sm' : ''}`} aria-hidden="true" />;
}
