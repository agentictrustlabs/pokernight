import { useEffect, useState } from 'react';

/** How long without a touch before a person is taken to have walked away from an open tab. The table's own
 *  attention window is the same ten minutes (`ATTENTION_MS`), so both ends go quiet together. */
export const IDLE_MS = 10 * 60 * 1000;

/**
 * HAS ANYBODY TOUCHED THIS PAGE LATELY. True after `ms` without a pointer, key, wheel or touch on the window.
 *
 * The hidden-tab gate stops a coach asking while the page is not shown; this stops it for a tab left OPEN
 * — on a second monitor, behind a lunch — where the coach in play-for-me mode would otherwise act every
 * turn, keep the seat active, and ask a language model at somebody's Home all afternoon. A person who is
 * there moves the mouse; a person who is not does not.
 */
export function useUserIdle(ms = IDLE_MS): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let last = Date.now();
    const touch = () => { last = Date.now(); setIdle(false); };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const t = setInterval(() => { if (Date.now() - last >= ms) setIdle(true); }, 15_000);
    return () => { for (const e of events) window.removeEventListener(e, touch); clearInterval(t); };
  }, [ms]);
  return idle;
}
