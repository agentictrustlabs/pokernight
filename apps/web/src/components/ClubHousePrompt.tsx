import type { Night } from '../lib/types';
import { nightWhen } from '../lib/nights';

/** One club house on offer: its name, and the night of its that is near, if there is one. */
export interface ClubHouseChoice { clubId: string; name: string; night: Night | null }

/** The visit a night carries, however it was recorded — an invited guest reads as a visit with nobody named. */
function visitOfNight(night: Night | null) {
  return night?.visit ?? (night?.mission ? { mission: night.mission, representative: undefined } : null);
}

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
 *
 * MORE THAN ONE CLUB IS A CHOICE, NOT A GUESS (2026-09-15). It used to offer `clubs[0]` and name only that one,
 * so somebody in three clubs was asked about whichever the Home happened to list first and had no way from here
 * to the other two. Every club house is a row, and the ones meeting soon are at the top.
 */
export function ClubHousePrompt({
  clubs, onEnter, onDismiss,
}: { clubs: ClubHouseChoice[]; onEnter: (clubId: string) => void; onDismiss: () => void }) {
  if (clubs.length === 0) return null;
  // whoever is meeting soonest is asked about first
  const rows = [...clubs].sort((a, b) => (a.night?.startsAt ?? Infinity) - (b.night?.startsAt ?? Infinity));
  if (rows.length === 1) {
    const only = rows[0]!;
    const when = only.night ? nightWhen(only.night, Date.now()) : null;
    const visit = visitOfNight(only.night);
    return (
      <div className="prompt-veil" role="dialog" aria-modal="true" aria-label={`Go through to ${only.name}?`}>
        <div className="panel prompt-card">
          <span className="eyebrow">{only.name}</span>
          <h2>{when ? `${when.day} at ${when.time}` : 'Go through to the club house?'}</h2>
          {when ? (
            <p className="prompt-lede">
              {only.night?.title ? <strong>{only.night.title}</strong> : 'Your club is meeting'} — the tables are set and the
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
            <button type="button" className="primary big" onClick={() => onEnter(only.clubId)}>Go through to the club house</button>
            <button type="button" className="link-button" onClick={onDismiss}>Not just now</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="prompt-veil" role="dialog" aria-modal="true" aria-label="Go through to a club house?">
      <div className="panel prompt-card">
        <span className="eyebrow">Your club houses</span>
        <h2>Which one are you going through to?</h2>
        <p className="prompt-lede">
          You are in {rows.length} clubs. Each has its own room — walk in, see who is about, and sit down at a table.
        </p>
        <ul className="prompt-clubs">
          {rows.map((c) => {
            const when = c.night ? nightWhen(c.night, Date.now()) : null;
            const visit = visitOfNight(c.night);
            return (
              <li key={c.clubId}>
                <button type="button" className="prompt-club" onClick={() => onEnter(c.clubId)}>
                  <strong>{c.name}</strong>
                  <span className="hint">
                    {when ? `${c.night?.title ?? 'Club night'} · ${when.day} at ${when.time}` : 'Open whenever you are'}
                    {visit ? ` · ♦ ${visit.mission.name}${visit.representative ? ` with ${visit.representative.name}` : ''}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="prompt-actions">
          <button type="button" className="link-button" onClick={onDismiss}>Not just now</button>
        </div>
      </div>
    </div>
  );
}
