import type { AppSession } from '../lib/types';
import { StartClub } from '../components/ClubDetail';
import { clubHash } from '../lib/routes';

/**
 * STARTING A CLUB.
 *
 * A page rather than a form folded into the rail, for one reason: the rail is where somebody decides
 * where to go, and a text field in it is a decision they have not made yet. It lands them on the club
 * they just started, which is the only place a new host has anything to do.
 */
export function NewClubPage({ session, onStarted }: { session: AppSession; onStarted: () => void }) {
  return (
    <div className="stack">
      <section className="panel">
        <h2>Start a club</h2>
        <p className="hint">
          A club is the group you play with: its tables are private to its members, and only they can sit at them. You
          will be its host — nobody outside it can see it, or that it exists.
        </p>
        <StartClub
          session={session}
          onStarted={(c) => {
            onStarted();
            location.hash = clubHash(c.clubId);
          }}
        />
      </section>
    </div>
  );
}
