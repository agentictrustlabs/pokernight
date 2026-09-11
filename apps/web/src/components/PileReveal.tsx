import { useEffect } from 'react';
import type { TookPile } from '../lib/canastaSocket';
import { cardValue } from '../lib/canasta';
import type { CanastaCard } from '../lib/canasta';
import { Card } from './Card';

/**
 * WHAT WAS IN THE PILE, AND WHERE EVERY CARD OF IT WENT.
 *
 * Taking the pile is the biggest move in canasta and, until this existed, the least legible one on the
 * screen: "it just pushes to the board and i cannot see what was in the pile and how it was used to
 * push to the board." A dozen cards left the middle of the table, three appeared on the board, the
 * rest appeared somewhere in a hand that had eleven cards a moment ago, and the board redrew before
 * anybody had looked at any of it.
 *
 * So the pile is laid out ONCE, in the order it was stacked, and each card is labelled with what
 * became of it. Two groups, because there are exactly two places a card can go: onto the board, or
 * into your hand. The top card gets its own mark, because it is the one card that came from the pile
 * rather than from your hand and the rule that lets you take a pile at all is about it.
 *
 * IT GOES AWAY ON ITS OWN. A modal that has to be dismissed in the middle of your own turn is a modal
 * that gets in the way of the move you took the pile to make, so it holds for a few seconds and then
 * leaves — and a press dismisses it early.
 */

/** Long enough to read a dozen cards, short enough not to sit over the turn it explains. */
const HOLD_MS = 7000;

export function PileReveal({ took, onDismiss }: { took: TookPile; onDismiss: () => void }) {
  // Keyed on `seq`, so taking a second pile restarts the clock rather than inheriting the first one's.
  useEffect(() => {
    const h = setTimeout(onDismiss, HOLD_MS);
    return () => clearTimeout(h);
  }, [took.seq, onDismiss]);

  const points = took.cards.reduce((a, c) => a + cardValue(c), 0);
  const meldedFromHand = took.toMeld.filter((c) => c !== took.top);

  return (
    <div className="pile-reveal" role="dialog" aria-label="What was in the pile">
      <div className="pile-reveal-box">
        <header>
          <h3>
            You took {took.cards.length} {took.cards.length === 1 ? 'card' : 'cards'}
          </h3>
          <p className="hint">{points} points of cards, in the order they were discarded.</p>
          <button type="button" className="link-button" onClick={onDismiss} aria-label="Close">
            ×
          </button>
        </header>

        {/* THE PILE ITSELF, bottom to top. Overlapped the way it sat, so the shape on screen is the
            shape it had in the middle of the table. */}
        <div className="pile-reveal-stack">
          {took.cards.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className={`pile-reveal-card${c === took.top && i === took.cards.length - 1 ? ' top' : ''}`}
            >
              <Card card={c} size="sm" />
            </span>
          ))}
        </div>

        <div className="pile-reveal-flow">
          {/* ONTO THE BOARD. Your own naturals are named apart from the pile's top card, because the
              two are why the move was legal and a beginner is still learning which was which. */}
          <section className="pile-reveal-group to-meld">
            <h4>Onto the board</h4>
            <div className="pile-reveal-cards">
              <span className="pile-reveal-card top" title="The card that was showing — this is the one the pile came with">
                <Card card={took.top} size="sm" />
              </span>
              {meldedFromHand.map((c, i) => (
                <span key={`m-${c}-${i}`} className="pile-reveal-card from-hand" title="From your hand">
                  <Card card={c} size="sm" />
                </span>
              ))}
            </div>
            <p className="hint">
              The showing card, plus {meldedFromHand.length} from your hand.
            </p>
          </section>

          {/* INTO YOUR HAND — the part that is the actual prize, and the part that is invisible
              otherwise because a hand is not somewhere you watch cards arrive. */}
          <section className="pile-reveal-group to-hand">
            <h4>Into your hand</h4>
            {took.toHand.length === 0 ? (
              <p className="hint">Nothing — the pile was one card.</p>
            ) : (
              <>
                <div className="pile-reveal-cards">
                  {took.toHand.map((c, i) => (
                    <span key={`h-${c}-${i}`} className="pile-reveal-card">
                      <Card card={c} size="sm" />
                    </span>
                  ))}
                </div>
                <p className="hint">
                  {took.toHand.length} {took.toHand.length === 1 ? 'card' : 'cards'}, worth{' '}
                  {took.toHand.reduce((a, c) => a + cardValue(c), 0)} if they stay there at the end.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Exported for the test: what the reveal claims about a pile, without rendering it. */
export function revealSummary(took: TookPile): { pile: number; board: number; hand: number; points: number } {
  return {
    pile: took.cards.length,
    board: took.toMeld.length,
    hand: took.toHand.length,
    points: took.cards.reduce((a, c) => a + cardValue(c as CanastaCard), 0),
  };
}
