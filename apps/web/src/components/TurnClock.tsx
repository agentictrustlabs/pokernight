import { secondsLeft } from '../lib/format';

const R = 20;
const C = 2 * Math.PI * R;

/**
 * The turn clock: an arc that drains around the active seat's avatar, with the
 * seconds remaining in a badge. Brass while there is time, amber under ten
 * seconds, red under five.
 */
export function TurnClock({ deadline, totalMs, now }: { deadline: number | null; totalMs: number; now: number }) {
  if (deadline == null) {
    return (
      <svg className="clock-arc pending" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle className="track" cx="24" cy="24" r={R} />
      </svg>
    );
  }
  const secs = secondsLeft(deadline, now);
  const left = Math.max(0, deadline - now);
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, left / totalMs)) : 0;
  const tone = secs <= 5 ? 'red' : secs <= 10 ? 'amber' : 'brass';
  return (
    <>
      <svg className={`clock-arc ${tone}`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle className="track" cx="24" cy="24" r={R} />
        <circle
          className="sweep"
          cx="24"
          cy="24"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className={`clock-badge num ${tone}`}>{secs}</span>
    </>
  );
}
