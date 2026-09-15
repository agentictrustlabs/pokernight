import { StartClub } from '../components/ClubDetail';
import type { AuthConfig } from '../lib/home';
import type { AppSession } from '../lib/types';

/**
 * STARTING A CLUB — A HOST'S OWN ONBOARDING, not a player's (2026-09-15).
 *
 * A page rather than a form folded into the rail, for one reason: the rail is where somebody decides
 * where to go, and a text field in it is a decision they have not made yet. The club is chartered at
 * the host's Home — it IS an agent there — and the return leg lands on its page, the only place a new
 * host has anything to do.
 *
 * AND IT IS OPEN TO A VISITOR, exactly as registering a mission is. Somebody starting a club is not
 * here to be dealt a hand: sending them through the room's sign-in first — play money, a buy-in
 * ceiling, a seat, a coach — asks them to become a player before they can become a host. The road is
 * the same shape as the mission steward's: say what the club is called, take ONE trip to your Home
 * (sign in there or make one on the way), and come back with the club chartered in your custody.
 */
export function NewClubPage({ config, session }: { config: AuthConfig | null; session: AppSession | null }) {
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Clubs</span>
          <h1>Start a club</h1>
        </div>
        <p className="lede">
          A club is the group you play with. Its nights and its tables are private to its members, and only they can
          sit at them — nobody outside it can see it, or that it exists.
        </p>
      </header>

      {!session ? (
        <section className="panel mission-onboarding">
          <h2 className="eyebrow-h">How starting a club works</h2>
          <ol>
            <li><strong>Name it</strong> — below. That is what its members will see, and the name its agent takes.</li>
            <li><strong>Go to your Home.</strong> Your Home is your own account on the faithnet estate — sign in there, or make one on the way (a phone number, an email address or a social account; nothing to install). The club is created there as an agent of its own, in your custody.</li>
            <li><strong>Two signatures.</strong> The club itself, as you; then its authorisation for this room to act as it. Then you are back here, on the club's own page, ready to invite people.</li>
          </ol>
          <p className="hint">
            You keep the keys: the club lives at your Home and this room only acts as it under the authorisation you sign
            there, which you can withdraw whenever you like. Starting one makes you no player — you can still come in and
            play, but nothing here sets up money, a seat or a coach for you.
          </p>
        </section>
      ) : null}

      <section className="panel">
        <h2 className="eyebrow-h">{session ? 'Call it' : 'Name the club'}</h2>
        <StartClub config={config} />
      </section>
    </div>
  );
}
