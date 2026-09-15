import { useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';

/**
 * YOUR PRACTICE TABLE — hold it, deal again, set how fast the others play.
 *
 * ONE PANEL FOR BOTH GAMES, because none of this is about a game. A practice table is a fact about the
 * TABLE — one per person, derived, in no lobby, owned — and the three things its owner can do to it
 * are the same whichever game it deals. Canasta had this panel and hold'em did not, which is how "let
 * me pause the poker game" came to be a request: the room's pause always worked at a poker
 * practice table; nothing on the poker page offered it.
 *
 * THE HOLD IS THE PAGE'S. The pause state and the request to change it are passed in rather than
 * owned here, because a page may have other reasons to hold the table — canasta freezes a scored round
 * — and two owners of one pause race each other. This panel is a button; the page is the door.
 */
export function PracticePanel({
  tableId,
  session,
  game,
  paused,
  onHold,
  paceMs,
}: {
  tableId: string;
  session: AppSession;
  game: 'poker' | 'canasta';
  /** The table is held. */
  paused: boolean;
  /** Ask the page to hold the table, or let it go. */
  onHold: (next: boolean) => void;
  /**
   * The pace the TABLE reported, or null while unknown. Nothing is sent until it is known: a slider
   * that opens on a guess and posts on a debounce stamps the guess over the real value on arrival.
   */
  paceMs: number | null;
}) {
  const [pace, setPace] = useState<number | null>(null);
  const [paceErr, setPaceErr] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Adopt the table's pace once, when it is first known.
  useEffect(() => {
    if (paceMs != null && pace === null) setPace(paceMs);
  }, [paceMs, pace]);

  /**
   * SEND THE PACE ONCE THE DRAG SETTLES, and believe the answer. A range input fires on every step, so
   * one drag sent eleven requests that landed out of order, and the bar ended up showing a number the
   * table was not set to. One request when the dragging stops; the label takes the TABLE's answer.
   */
  useEffect(() => {
    if (pace === null || paceMs === null || pace === paceMs) return;
    const h = setTimeout(async () => {
      try {
        const r = await api.setPace(tableId, pace, session.token);
        setPaceErr(null);
        if (r.paceMs !== pace) setPace(r.paceMs);
      } catch {
        setPaceErr('not saved');
      }
    }, 350);
    return () => clearTimeout(h);
    // Only the value matters; re-running on identity changes would resend on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pace, tableId]);

  return (
    <section className={`panel practice-panel${paused ? ' held' : ''}`}>
      <h2>Your practice table</h2>
      {err ? <div className="form-error">{err}</div> : null}
      <p className="hint">This one is yours and nobody else can see it. Leave whenever you like — it is still here next time.</p>
      {/* PAUSE, and mean it: the clock, the other players and the next deal all stop together, and
          resuming gives back exactly the time the pause took. Holding only the narration would leave
          the agents playing, so somebody who stopped to read came back to a turn they had lost. */}
      <button type="button" className={paused ? 'primary' : ''} onClick={() => onHold(!paused)}>
        {paused ? '▶ Carry on' : '⏸ Pause'}
      </button>
      <button
        type="button"
        disabled={resetting}
        onClick={async () => {
          setResetting(true);
          setErr(null);
          try {
            await api.resetPractice(tableId, session.token);
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : 'The table could not be dealt again.');
          } finally {
            setResetting(false);
          }
        }}
      >
        {resetting ? 'Dealing…' : game === 'poker' ? 'Start over' : 'Start a new game'}
      </button>
      {/* HOW FAST THE OTHERS PLAY. An agent answers in a couple of hundred milliseconds, so the pace is
          entirely a choice about what a person can follow. The table's own setting, because only at a
          practice table does one person's preference slow nobody else. */}
      {pace !== null ? (
        <label className="pace">
          How fast the others play
          <input type="range" min={600} max={6000} step={200} value={pace} onChange={(e) => setPace(Number(e.target.value))} />
          <span className="hint">
            {(pace / 1000).toFixed(1)} s a move
            {paceErr ? <span className="form-error"> {paceErr}</span> : null}
          </span>
        </label>
      ) : null}
      {paused ? <p className="hint">Held. Nothing moves — the clock, the other players and the next deal are all waiting.</p> : null}
    </section>
  );
}
