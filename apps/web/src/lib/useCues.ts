import { useEffect, useRef } from 'react';
import { play, type SoundName } from './sound';

/**
 * Play the cue for each event as it ARRIVES, once each.
 *
 * The log is a growing list, so "what is new" is "what is past the high-water mark" — not a diff, and
 * not the last element, because two events can land in one message. The mark resets when the log is
 * cleared (a reconnect seeds a fresh one), which is what stops a reconnect replaying a round's worth
 * of sound at somebody.
 *
 * Deliberately a hook over the LOG rather than a call inside the socket handler: the reducer stays
 * pure, and sound is a thing the screen does, not a thing the state machine does.
 */
export function useCues<E>(log: readonly E[], cue: (ev: E) => SoundName | null): void {
  const seen = useRef(0);
  useEffect(() => {
    if (log.length < seen.current) seen.current = 0;
    for (let i = seen.current; i < log.length; i++) {
      const name = cue(log[i] as E);
      if (name) play(name);
    }
    seen.current = log.length;
    // `cue` is rebuilt on every render by design (it closes over the viewer's seat); depending on it
    // would replay the log each time. The log's length is the only thing that means "something new".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);
}
