import type { Card as CardCode } from '../lib/types';
import { SUIT_GLYPH, cardRank, cardSuit, isRedSuit } from '../lib/format';

/**
 * A playing card as inline SVG. 44×62 CSS px by default (viewBox 44×62), crisp
 * at any DPR. `card` undefined renders a face-down back.
 */
export function Card({ card, large, title }: { card?: CardCode; large?: boolean; title?: string }) {
  const cls = `card${large ? ' lg' : ''}${card && isRedSuit(card) ? ' red' : ''}`;
  if (!card) {
    return (
      <svg className={cls} viewBox="0 0 44 62" role="img" aria-label={title ?? 'face-down card'}>
        <rect className="back" x="0.5" y="0.5" width="43" height="61" rx="4" strokeWidth="1" />
        <rect x="4" y="4" width="36" height="54" rx="2" fill="url(#card-back-hatch)" />
      </svg>
    );
  }
  const rank = cardRank(card);
  const suit = SUIT_GLYPH[cardSuit(card)] ?? '?';
  const label = `${rank}${suit}`;
  return (
    <svg className={cls} viewBox="0 0 44 62" role="img" aria-label={title ?? label}>
      <rect className="face" x="0.5" y="0.5" width="43" height="61" rx="4" strokeWidth="1" />
      <text
        className="ink"
        x="5"
        y="18"
        fontSize={rank === '10' ? 14 : 16}
        fontWeight="700"
        fontFamily="'IBM Plex Mono', ui-monospace, monospace"
        letterSpacing={rank === '10' ? '-1' : '0'}
      >
        {rank}
      </text>
      <text className="ink" x="5.5" y="31" fontSize="12">
        {suit}
      </text>
      <text className="ink" x="30" y="53" fontSize="24" textAnchor="middle">
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
        </pattern>
      </defs>
    </svg>
  );
}
