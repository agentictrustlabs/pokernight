import { useEffect, useState } from 'react';
import type { Curtain } from '../lib/roundEnd';
import { celebrates } from '../lib/roundEnd';

/**
 * THE ROUND STOPS AND SOMEBODY SAYS SOMETHING ABOUT IT.
 *
 * A round of canasta takes twenty minutes and used to end in about a tenth of a second: the last card
 * goes, the numbers jump, the board clears, the next deal is already out. "Don't just end a round,
 * freeze it so user can review the board and then allow them to move on."
 *
 * Two jobs, and they are different. THE CURTAIN is this: what happened, how it scored, and whether it
 * went your way. THE FREEZE is the table's own pause, which the page holds while this is up — the
 * clock, the agents and the next deal all together, because holding only some of them is not a freeze.
 * That is why "Look at the board" and "Next round" are different buttons: the first puts this aside and
 * leaves the table held, the second lets it go.
 *
 * WINNING IS CELEBRATED AND LOSING IS CREDITED. The celebration is a real one — a burst of colour that
 * settles, not a line of text with an exclamation mark. The loss gets the largest true thing that side
 * earned, which is worth more to somebody learning than sympathy is: "your three canastas were worth a
 * thousand of that" is a reason to play the next round, and "bad luck" is not.
 *
 * `prefers-reduced-motion` turns the burst off and keeps everything it was carrying, because none of
 * the information is in the animation.
 */

/** How many pieces of colour. Enough to read as a burst, few enough to stay cheap on a phone. */
const PIECES = 28;

export function RoundCurtain({
  curtain,
  /** Whether the table is actually being held. Changes what this can honestly offer. */
  frozen,
  /** Put the curtain aside and keep the table held, to look at the board. */
  onReview,
  /** Let the table go — deal the next round. Absent when this person cannot start one. */
  onContinue,
  /** Start a whole new game. Offered at the end of one, to whoever's table it is. */
  onNewGame,
}: {
  curtain: Curtain;
  frozen: boolean;
  onReview: () => void;
  onContinue?: () => void;
  onNewGame?: () => void;
}) {
  const party = celebrates(curtain);
  // The burst is rendered once and then removed, so it cannot keep repainting behind a curtain
  // somebody is reading.
  const [burst, setBurst] = useState(party);
  useEffect(() => {
    if (!party) return;
    setBurst(true);
    const h = setTimeout(() => setBurst(false), 2600);
    return () => clearTimeout(h);
  }, [party, curtain.headline]);

  return (
    <div className={`curtain mood-${curtain.mood} scope-${curtain.scope}`} role="dialog" aria-label={curtain.headline}>
      {burst ? (
        <div className="curtain-burst" aria-hidden="true">
          {Array.from({ length: PIECES }, (_, i) => (
            // Each piece gets its own lane and delay off its index, so the burst is spread without a
            // random number that would differ between two renders of the same moment.
            <i key={i} style={{ left: `${(i * 97) % 100}%`, animationDelay: `${(i % 7) * 90}ms` }} />
          ))}
        </div>
      ) : null}

      <div className="curtain-box">
        <p className="curtain-scope">{curtain.scope === 'game' ? 'End of the game' : 'End of the round'}</p>
        <h2>{curtain.headline}</h2>
        <p className="curtain-detail">{curtain.detail}</p>
        {/* CREDIT, not consolation. Only ever on a loss, and only ever something that side actually did. */}
        {curtain.credit ? <p className="curtain-credit">{curtain.credit}</p> : null}

        {/* WHERE THE NUMBER CAME FROM. The same lines the coach reads out, because a person who had
            the voice off should not get less of the explanation than one who had it on. */}
        <ul className="curtain-lines">
          {curtain.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>

        <div className="curtain-actions">
          <button type="button" onClick={onReview}>
            Look at the board
          </button>
          {curtain.scope === 'round' && onContinue ? (
            <button type="button" className="primary" onClick={onContinue}>
              Deal the next round
            </button>
          ) : null}
          {curtain.scope === 'game' && onNewGame ? (
            <button type="button" className="primary" onClick={onNewGame}>
              Start a new game
            </button>
          ) : null}
        </div>
        <p className="hint">
          {frozen
            ? 'The table is held. Nothing moves — the clock, the other players and the next deal are all waiting.'
            : 'The table carries on in its own time; this is only here until you put it aside.'}
        </p>
      </div>
    </div>
  );
}
