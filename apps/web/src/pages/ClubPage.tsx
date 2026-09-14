import { useCallback, useEffect, useState } from 'react';
import type { AppSession, ClubView, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { Roster } from '../components/ClubDetail';
import { Nights } from '../components/Nights';
import { TableList } from './TablesPage';
import { canOpenTable, noTablesLine } from '../lib/clubs';
import { newTableHash, HOME_HASH, TABLES_HASH } from '../lib/routes';
import type { AuthConfig } from '../lib/home';
import { clubScope } from '../lib/huddle';
import { HuddleAffordance } from '../components/huddle/ClubHuddleDock';

/** The club's own tables refresh on the same cadence as the public list. */
const POLL_MS = 5000;

/**
 * ONE CLUB, as a destination.
 *
 * This is the change the whole navigation redesign turns on. The club you were looking at used to be
 * `useState` in the lobby — so it could not be linked, did not survive a refresh, and was not
 * somewhere an invitation could put you. Now it is a URL, and what stands on it is, in this order:
 *
 *   its live tables, because that is what a club is FOR and it is what a member came to find;
 *   who is in it, and whether it has an agent of its own;
 *   for a host, how to add somebody and how to open a table.
 *
 * TABLES FIRST is deliberate and it is a fix, not a preference: a member arriving at a club and being
 * shown a roster has been shown the one thing they cannot act on.
 *
 * A CLUB NOBODY HAS STANDING IN ANSWERS 404. The card room refuses that way on purpose — a 403 would
 * confirm the club exists, which is a fact about other people's arrangements — so this page cannot and
 * must not tell the two apart. It says the one thing that is true either way.
 */
export function ClubPage({
  clubId,
  session,
  config,
  money,
  ready = true,
  onChanged,
}: {
  clubId: string;
  session: AppSession;
  config: AuthConfig | null;
  money: string;
  /** Whether this person could sit at a money table. Same read as the seat gate uses. */
  ready?: boolean;
  /** Re-read the rail's club list, when this page changes what is in it. */
  onChanged: () => void;
}) {
  const [view, setView] = useState<ClubView | null>(null);
  const [missing, setMissing] = useState(false);
  /**
   * What happened, when this person has just closed this club.
   *
   * It is checked BEFORE `missing`, and that order is the whole point: closing a club makes it answer
   * 404 to everybody including the host who closed it, so the honest-but-useless "this is not a club
   * you are in" is exactly what a successful close would otherwise show.
   */
  const [retired, setRetired] = useState<string | null>(null);
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadView = useCallback(async () => {
    try {
      setView(await api.getClub(clubId, session.token));
      setMissing(false);
    } catch {
      setView(null);
      setMissing(true);
    }
  }, [clubId, session.token]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  /** Read the club's tables again now, rather than waiting out the poll after closing one. */
  const [reloadAt, setReloadAt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const t = await api.listTables(session.token, clubId);
        if (alive) {
          setTables(t);
          setErr(null);
        }
      } catch (ex) {
        if (alive) setErr(ex instanceof ApiError ? `${ex.status}: ${ex.message}` : 'Could not reach the table service');
      }
    };
    void load();
    const h = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [session.token, clubId, reloadAt]);

  if (retired) {
    return (
      <section className="panel">
        <h2>Closed</h2>
        <p>{retired}</p>
        <a className="small" href={TABLES_HASH}>
          See what is running →
        </a>
      </section>
    );
  }

  if (missing) {
    return (
      <section className="panel">
        <h2>Not a club you are in</h2>
        {/* Deliberately one sentence for two different situations. The card room answers 404 for a
            club that does not exist AND for one you have no standing in, because distinguishing them
            would tell a stranger which clubs are real. */}
        <p>
          This link is not a club you are in. If somebody invited you, open the link they sent — that is what puts you on
          the roster.
        </p>
        <a className="small" href={TABLES_HASH}>
          See what is running →
        </a>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="panel">
        <p className="hint">Reading the club…</p>
      </section>
    );
  }

  const host = canOpenTable(view.you.standing);
  const scope = clubScope(view);
  return (
    <div className="stack club-page">
      {/* THE HUDDLE: the club's voice-and-faces call at the top of its page — start it, or join the one running.
          Anybody on the roster may be in it, playing or watching; it stays up while you walk to a table. A club
          with no chartered agent yet has no scope for one, and nothing is shown. */}
      {scope ? (
        <div className="club-huddle-row">
          <HuddleAffordance scope={scope} scopeName={view.name} />
          <span className="hint">Talk and see each other while the game runs — the club's members, whether or not they are at a table.</span>
        </div>
      ) : null}
      {/* What a member came for. A roster is not it. */}
      <TableList
        tables={tables}
        err={err}
        title={`Tables at ${view.name}`}
        playerId={session.playerId}
        hostOf={host ? [clubId] : []}
        session={session}
        onChanged={() => setReloadAt((n) => n + 1)}
        empty={
          host ? (
            noTablesLine(view.you.standing, view.name)
          ) : (
            <>
              {noTablesLine(view.you.standing, view.name)} In the meantime you can{' '}
              <a href={HOME_HASH}>deal yourself a hand</a> against the house.
            </>
          )
        }
      />
      {/* WHEN, before WHO. A member arriving at a club wants to know if there is a game and when it is;
          the roster is the thing they cannot act on. */}
      <Nights clubId={clubId} session={session} host={host} schedule={view.schedule} nights={view.nights} tables={tables} onChanged={() => void loadView()} />
      <Roster
        view={view}
        session={session}
        config={config}
        // How many of its tables closing it would close. Null (not read yet) counts as none rather than
        // as a guess: a sentence saying "its 3 tables close" has to be true when it is shown.
        tables={tables?.length ?? 0}
        onRetired={(line) => {
          setRetired(line);
          // AND TELL THE RAIL. Moving the receipt up here dropped this, and the club stayed in the
          // navigation after it was closed — a row that 404s the moment anybody presses it, which is
          // the exact failure the awaited index write was added to prevent.
          onChanged();
        }}
        onChanged={() => {
          void loadView();
          onChanged();
        }}
      />
      {host ? (
        <p className="lobby-create-link"><a className="button" href={newTableHash(clubId)}>+ Open a table for {view.name}</a></p>
      ) : null}
    </div>
  );
}
