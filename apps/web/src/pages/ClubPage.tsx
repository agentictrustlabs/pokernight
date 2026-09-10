import { useCallback, useEffect, useState } from 'react';
import type { AppSession, ClubView, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { Roster } from '../components/ClubDetail';
import { CreateTable, TableList } from './TablesPage';
import { canOpenTable, noTablesLine } from '../lib/clubs';
import { HOME_HASH, TABLES_HASH } from '../lib/routes';
import type { AuthConfig } from '../lib/home';

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
  }, [session.token, clubId]);

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
  return (
    <div className="stack club-page">
      {/* What a member came for. A roster is not it. */}
      <TableList
        tables={tables}
        err={err}
        title={`Tables at ${view.name}`}
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
      <Roster
        view={view}
        session={session}
        config={config}
        // How many of its tables closing it would close. Null (not read yet) counts as none rather than
        // as a guess: a sentence saying "its 3 tables close" has to be true when it is shown.
        tables={tables?.length ?? 0}
        onChanged={() => {
          void loadView();
          onChanged();
        }}
      />
      {host ? (
        <details className="panel lobby-create" open={tables !== null && tables.length === 0}>
          <summary>Open a table for {view.name}</summary>
          <CreateTable session={session} money={money} club={clubId} ready={ready} />
        </details>
      ) : null}
    </div>
  );
}
