import { useEffect, useRef, useState } from 'react';
import { TABLES_HASH, goTo } from './routes';

/**
 * Leaving a table, and going back to the room.
 *
 * PRESSING LEAVE USED TO LEAVE YOU EXACTLY WHERE YOU WERE — standing at a table you were no longer
 * sitting at, with no way back but the browser's own controls. The seat went, the screen did not.
 *
 * It waits for the seat to actually go rather than navigating on the press, because at a money table
 * standing up moves money: the card room cashes the seat out, and a page that had already navigated
 * would be telling somebody they had left before the table agreed. When the seat is gone, so is the
 * screen.
 *
 * The timeout is the honest half. A confirmation that never arrives — a dropped socket, a table that
 * did not hear — must not strand somebody on a table they meant to leave, so after a few seconds it
 * goes anyway. Their seat is the card room's business and it is safe there either way.
 */
const GIVE_UP_MS = 4000;

export function useLeaveTable(seated: boolean, send: () => void): { leaving: boolean; leave: () => void } {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!leaving) return;
    // The seat is gone: that is the confirmation, and it is the moment to go.
    if (!seated) {
      goTo(TABLES_HASH);
      return;
    }
    timer.current = setTimeout(() => goTo(TABLES_HASH), GIVE_UP_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [leaving, seated]);

  return {
    leaving,
    leave: () => {
      if (leaving) return;
      setLeaving(true);
      send();
    },
  };
}
