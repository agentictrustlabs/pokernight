import type { Night } from '../lib/types';
import { nightWhen } from '../lib/nights';

/**
 * "GO THROUGH TO THE CLUB HOUSE?" — asked once, on arrival (2026-09-15).
 *
 * Somebody who belongs to a club almost always came for that club, and the room is where it happens. The rail
 * had the club on it, which is a place to navigate FROM rather than an invitation to go: this asks, plainly,
 * once a session, and takes no for an answer.
 *
 * WHEN A NIGHT IS CLOSE the question stops being generic and says what is on — which night, who is the guest,
 * and who is coming for them. That is the difference between "there is a room" and "your people are meeting
 * tonight and the mission's representative will be there".
 */
export function ClubHousePrompt({
  clubName, night, onEnter, onDismiss,
}: { clubName: string; night: Night | null; onEnter: () => void; onDismiss: () => void }) {
  const when = night ? nightWhen(night, Date.now()) : null;
  const visit = night?.visit ?? (night?.mission ? { mission: night.mission, representative: undefined } : null);
  return (
    <div className="prompt-veil" role="dialog" aria-modal="true" aria-label={`Go through to ${clubName}?`}>
      <div className="panel prompt-card">
        <span className="eyebrow">{clubName}</span>
        <h2>{when ? `${when.day} at ${when.time}` : 'Go through to the club house?'}</h2>
        {when ? (
          <p className="prompt-lede">
            {night?.title ? <strong>{night.title}</strong> : 'Your club is meeting'} — the tables are set and the
            room is open.
          </p>
        ) : (
          <p className="prompt-lede">
            The club house is open whenever you are: walk in, see who is about, and sit down at a table.
          </p>
        )}
        {visit ? (
          <p className="prompt-guest">
            <span className="tag">guest</span> <strong>{visit.mission.name}</strong>
            {visit.representative ? <> — <strong>{visit.representative.name}</strong> is coming for them</> : <> — nobody named for the visit yet</>}
          </p>
        ) : null}
        <div className="prompt-actions">
          <button type="button" className="primary big" onClick={onEnter}>Go through to the club house</button>
          <button type="button" className="link-button" onClick={onDismiss}>Not just now</button>
        </div>
      </div>
    </div>
  );
}
