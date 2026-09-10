import { clubHeading, clubRail, yourRail, type NavItem } from '../lib/nav';
import { ABOUT_HASH, type Route } from '../lib/routes';
import type { ClubListing } from '../lib/api';

/**
 * The left rail: three verbs that are yours wherever you are, then the clubs you are in, by name.
 *
 * WHAT IT IS NOT is a context switcher. The reasoning lives in `lib/nav.ts`, which decides every row
 * this draws; the short version is that a switcher reframes an application, and switching club here
 * changes a roster and a calendar while your seat, your money and your identity do not move.
 *
 * A club row is a LINK to that club's page, at the same height and weight as Play and Tables, because
 * a club is not a lesser thing than a table list — and the person is not a lesser thing than a club
 * they happen to be in, which is why `You` needs no row of its own: it is the whole of the top group.
 *
 * There is no rail at a TABLE. A table is not a child of anything in here, and a person holding cards
 * has one thing to do.
 */
export function Rail({ r, clubs }: { r: Route; clubs: readonly ClubListing[] | null }) {
  const mine = yourRail(r);
  const club = clubRail(clubs, r);
  return (
    <nav className="sidenav" aria-label="Where to go">
      <ul className="sidenav-group">
        {mine.map((i) => (
          <li key={i.key}>
            <Row item={i} />
          </li>
        ))}
      </ul>

      <div className="sidenav-clubs">
        <h2 className="sidenav-heading">{clubHeading(club.clubs.length)}</h2>
        {club.kind === 'loading' ? (
          // Not "you are in none": we have not asked yet, and saying it would be saying something we
          // do not know to the one person most likely to have just been invited to one.
          <p className="sidenav-quiet">Reading&hellip;</p>
        ) : club.kind === 'none' ? (
          <>
            <ul className="sidenav-group">
              <li>
                <a className="sidenav-row" href="#/clubs/new">
                  <span className="sidenav-label">Start a club</span>
                  <span className="sidenav-sub">a group you play with</span>
                </a>
              </li>
            </ul>
            {/* An invitation is a link in somebody's mail. There is nothing to press here, and a
                button that led to "paste your invitation" would be a worse version of opening it. */}
            <p className="sidenav-quiet">Been invited to one? Open the link you were sent.</p>
          </>
        ) : (
          <>
            <ul className="sidenav-group">
              {club.clubs.map((i) => (
                <li key={i.key}>
                  <Row item={i} />
                </li>
              ))}
            </ul>
            <a className="sidenav-add" href="#/clubs/new">
              Start another
            </a>
          </>
        )}
      </div>

      {/* Last, quiet, and always there. The product explanation used to be unreachable the moment
          somebody signed in — the page existed and no route led to it. */}
      <a className={r.page === 'about' ? 'sidenav-about on' : 'sidenav-about'} href={ABOUT_HASH}>
        What this place is
      </a>
    </nav>
  );
}

function Row({ item }: { item: NavItem }) {
  return (
    <a className={item.here ? 'sidenav-row on' : 'sidenav-row'} href={item.hash} aria-current={item.here ? 'page' : undefined}>
      <span className="sidenav-label">{item.label}</span>
      {item.sub ? <span className="sidenav-sub">{item.sub}</span> : null}
    </a>
  );
}
