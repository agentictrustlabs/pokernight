import { useEffect, useState } from 'react';
import { resume, setSoundEnabled, soundEnabled } from '../lib/sound';

/**
 * The mute switch, in the table's own topbar.
 *
 * ON BY DEFAULT, because a room with the sound off by default is one nobody knows has any —
 * and OFF in one press, in the place a person looks for it, because somebody playing at their desk
 * needs that press to be findable without reading anything.
 *
 * It also carries the audio unlock. Browsers refuse to start audio before a real gesture, so the
 * page listens once for the first click anywhere and starts the context then. Pressing this button
 * is itself such a gesture, which is why turning sound ON always works on the first press.
 */
export function SoundToggle() {
  const [on, setOn] = useState(() => soundEnabled());

  // The first touch anywhere on the page is what browsers accept as permission to make noise.
  useEffect(() => {
    if (!on) return;
    const unlock = () => void resume();
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    return () => {
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
  }, [on]);

  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={on}
      title={on ? 'Sound on — press to mute' : 'Sound off — press to unmute'}
      onClick={() => {
        const next = !on;
        setOn(next);
        setSoundEnabled(next);
      }}
    >
      <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
      <span className="sr-only">{on ? 'Mute' : 'Unmute'}</span>
    </button>
  );
}
