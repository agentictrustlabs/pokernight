import { useCallback, useEffect, useState } from 'react';
import type { AppSession, ClubView, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { About, People } from '../components/ClubDetail';
import { Nights } from '../components/Nights';
import { TableList } from './TablesPage';
import { canOpenTable, noTablesLine } from '../lib/clubs';
import { newTableHash, roomHash, HOME_HASH, TABLES_HASH } from '../lib/routes';
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
 * A CLUB NOBODY HAS STANDING IN ANSWERS 404. The room refuses that way on purpose — a 403 would
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
  const [tab, setTab] = useState<'nights' | 'tables' | 'people' | 'about'>('nights');
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
        {/* Deliberately one sentence for two different situations. The room answers 404 for a
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
  const openTables = (tables ?? []).length;
  // THE PAGE IS A HEAD AND FOUR AREAS (2026-09-14). It used to be five panels one under another — the huddle,
  // the tables, the nights, the roster, the form — "a single flow of content down the page". Each area is its
  // own tab now, the head carries the club's name and its three actions, and a night's detail is a flyout.
  return (
    <div className="stack club-page">
      <header className="club-head">
        <div>
          <span className="eyebrow">Your club · {standingWord(view.you.standing)}</span>
          <h1>{view.name}</h1>
        </div>
        <div className="club-actions">
          {scope ? <HuddleAffordance scope={scope} scopeName={view.name} /> : null}
          {host ? <a className="button" href={newTableHash(clubId)}>+ Open a table</a> : null}
          <a className="button quiet" href={roomHash(clubId)} title="Walk into the club's lounge — the tables in a room, the people in it">Enter the room</a>
        </div>
      </header>
      <nav className="side-tabs club-tabs" role="tablist" aria-label="The club">
        {(['nights', 'tables', 'people', 'about'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`side-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t === 'nights' ? `Nights${view.nights.length ? ` · ${view.nights.length}` : ''}` : t === 'tables' ? `Tables${openTables ? ` · ${openTables}` : ''}` : t === 'people' ? `People · ${view.roster.length}` : 'About'}
          </button>
        ))}
      </nav>
      {tab === 'nights' ? (
        // WHEN, before WHO. A member arriving at a club wants to know if there is a game and when it is.
        <Nights clubId={clubId} session={session} host={host} schedule={view.schedule} nights={view.nights} tables={tables} onChanged={() => void loadView()} />
      ) : tab === 'tables' ? (
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
      ) : tab === 'people' ? (
        <People view={view} session={session} config={config} onChanged={() => { void loadView(); onChanged(); }} />
      ) : (
        <About
          view={view}
          session={session}
          // How many of its tables closing it would close. Null (not read yet) counts as none rather than
          // as a guess: a sentence saying "its 3 tables close" has to be true when it is shown.
          tables={tables?.length ?? 0}
          onRetired={(line) => {
            setRetired(line);
            // AND TELL THE RAIL: the club must leave the navigation the moment it is closed.
            onChanged();
          }}
          onChanged={() => { void loadView(); onChanged(); }}
        />
      )}
    </div>
  );
}

function standingWord(standing: string): string {
  return standing === 'host' ? 'you host it' : 'you are a member';
}
