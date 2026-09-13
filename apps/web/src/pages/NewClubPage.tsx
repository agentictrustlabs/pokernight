import { StartClub } from '../components/ClubDetail';
import type { AuthConfig } from '../lib/home';

/**
 * STARTING A CLUB.
 *
 * A page rather than a form folded into the rail, for one reason: the rail is where somebody decides
 * where to go, and a text field in it is a decision they have not made yet. The club is chartered at
 * the host's Home — it IS an agent there — and the return leg lands on its page, the only place a new
 * host has anything to do.
 */
export function NewClubPage({ config }: { config: AuthConfig | null }) {
  return (
    <div className="stack">
      <section className="panel">
        <h2>Start a club</h2>
        <p className="hint">
          A club is the group you play with: its tables are private to its members, and only they can sit at them. You
          will be its host — nobody outside it can see it, or that it exists. It lives at your Home, as an agent of its own.
        </p>
        <StartClub config={config} />
      </section>
    </div>
  );
}
