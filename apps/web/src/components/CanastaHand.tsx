import type React from 'react';
import type { CanastaCard, HandGroup } from '../lib/canasta';
import { cardValue } from '../lib/canasta';
import { Card } from './Card';

/**
 * The cards in your hand, grouped by rank and pickable.
 *
 * CANASTA IS PLAYED BY PICKING CARDS UP. Every move but a draw is "these cards, that way", so
 * selection is the whole interaction and the controls below are only what to do with what is
 * already picked.
 *
 * GROUPED, AND EACH GROUP PICKABLE AS ONE. A canasta hand runs to fifteen cards and a meld is a
 * whole rank, so taking four sevens one click at a time is four clicks of work the game should not
 * ask for. The header over each group takes the lot.
 *
 * A red three is shown but never selectable: it is a bonus that lays itself down, and offering it
 * as a card to play is offering a move that does not exist.
 */
export function CanastaHand({
  groups,
  selected,
  onToggle,
  onPickRank,
  onCardDown,
  disabled,
}: {
  groups: readonly HandGroup[];
  /** Indices into the FLAT grouped hand — the same order this renders in. */
  selected: readonly number[];
  onToggle: (index: number) => void;
  onPickRank: (rank: string) => void;
  /**
   * A card has been pressed. The table decides whether that becomes a click or a drag.
   *
   * POINTER EVENTS, not HTML5 drag-and-drop. HTML5 dragging does not exist on a touchscreen at all,
   * and cannot be driven by an ordinary mouse press even in a browser that has it — so a card game
   * built on it works for some people and silently does nothing for others.
   */
  onCardDown: (index: number, e: React.PointerEvent) => void;
  disabled: boolean;
}) {
  const picked = new Set(selected);
  let i = -1;
  const total = groups.reduce((a, g) => a + g.cards.length, 0);

  return (
    <div className="can-hand" role="group" aria-label="Your hand">
      {groups.map((g) => {
        const start = i + 1;
        const idx = g.cards.map(() => ++i);
        const all = idx.length > 0 && idx.every((n) => picked.has(n));
        return (
          <div key={`${g.rank}-${start}`} className={`can-group${g.wild ? ' wild' : ''}${g.bonus ? ' bonus' : ''}`}>
            <button
              type="button"
              className={`can-group-head${all ? ' on' : ''}`}
              disabled={disabled || g.bonus}
              aria-pressed={all}
              title={g.bonus ? 'A red three is a bonus — it lays itself down' : `Pick all ${g.cards.length}`}
              onClick={() => onPickRank(g.rank)}
            >
              {g.wild ? 'wild' : g.rank === 'T' ? '10' : g.rank}
              <span className="n">{g.cards.length}</span>
            </button>
            <div className="can-group-cards">
              {g.cards.map((c, k) => {
                const n = idx[k] as number;
                return (
                  <button
                    key={`${c}-${n}`}
                    type="button"
                    className={`can-card${picked.has(n) ? ' picked' : ''}${g.bonus ? ' bonus' : ''}`}
                    disabled={disabled || g.bonus}
                    aria-pressed={picked.has(n)}
                    title={g.bonus ? 'A red three is a bonus — it lays itself down' : `${c} · ${cardValue(c as CanastaCard)} points`}
                    onPointerDown={(e) => onCardDown(n, e)}
                    onClick={() => onToggle(n)}
                  >
                    <Card card={c} size="md" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {total === 0 ? <p className="hint">No cards.</p> : null}
    </div>
  );
}
