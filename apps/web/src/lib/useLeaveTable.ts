import { useEffect, useRef, useState } from 'react';
import { TABLES_HASH, goTo } from './routes';
import { forgetRoom, roomToReturnTo } from './fromRoom';

/**
 * Leaving a table, and going back where you came from.
 *
 * A seat taken in the 3D room goes BACK TO THAT ROOM (`fromRoom.ts`), because standing up there is
 * standing up here — the two are one place. A seat taken from a list goes back to the list.
 *
 * PRESSING LEAVE USED TO LEAVE YOU EXACTLY WHERE YOU WERE — standing at a table you were no longer
 * sitting at, with no way back but the browser's own controls. The seat went, the screen did not.
 *
 * It waits for the seat to actually go rather than navigating on the press, because at a money table
 * standing up moves money: the room cashes the seat out, and a page that had already navigated
 * would be telling somebody they had left before the table agreed. When the seat is gone, so is the
 * screen.
 *
 * The timeout is the honest half. A confirmation that never arrives — a dropped socket, a table that
 * did not hear — must not strand somebody on a table they meant to leave, so after a few seconds it
 * goes anyway. Their seat is the room's business and it is safe there either way.
 */
const GIVE_UP_MS = 4000;

export function useLeaveTable(seated: boolean, send: () => void): { leaving: boolean; leave: () => void } {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!leaving) return;
    // The seat is gone: that is the confirmation, and it is the moment to go.
    const back = () => { const room = roomToReturnTo(); forgetRoom(); goTo(room ?? TABLES_HASH); };
    if (!seated) {
      back();
      return;
    }
    timer.current = setTimeout(back, GIVE_UP_MS);
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
