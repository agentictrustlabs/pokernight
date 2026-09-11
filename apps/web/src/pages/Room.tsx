import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from '../App';
import type { AppSession, TableSummary } from '../lib/types';
import { ApiError, api, type ClubListing } from '../lib/api';
import { Rail } from '../components/Rail';
import type { Route } from '../lib/routes';
import type { TreasuryView } from '../lib/treasury';
import { stakeStage } from '../lib/stake';
import { ClubPage } from './ClubPage';
import { MoneyPage } from './MoneyPage';
import { NewClubPage } from './NewClubPage';
import { PlayPage } from './PlayPage';
import { SignInPage } from './SignInPage';
import { TablesPage } from './TablesPage';

const POLL_MS = 5000;

/**
 * THE ROOM: the rail on the left, one destination on the right.
 *
 * This replaced the lobby, which was a table list with a stack of panels beside it — clubs, practice,
 * money and a create form, all on one screen, with the club you were looking at held in the lobby's own
 * `useState`. That stack had no room left in it and no URL for anything in it. The shape now is a rail
 * of things that are yours (`lib/nav.ts` says why there is no context switcher above it) and pages that
 * can be linked, refreshed and landed on by an invitation.
 *
 * TWO READS LIVE HERE, and they live here for the same reason they lived in the lobby: the same treasury
 * answer decides what the set-up card offers and whether a table row can promise a seat, and the same
 * table list decides where "take a seat" goes. Two copies of either could disagree, and disagreeing
 * about money is the one thing not allowed. The club list is read here too, because the rail draws it on
 * every page.
 */
export function Room({
  r,
  session,
  auth,
  onLogin,
  moneyStamp = 0,
}: {
  r: Route;
  session: AppSession | null;
  auth: AuthState;
  onLogin: (s: AppSession) => void;
  /** Changes when a ceremony elsewhere moved this person's money. See `App.tsx`. */
  moneyStamp?: number;
}) {
  if (!session) return <SignInPage auth={auth} onLogin={onLogin} />;
  return <SignedIn r={r} session={session} auth={auth} moneyStamp={moneyStamp} />;
}

function SignedIn({ r, session, auth, moneyStamp }: { r: Route; session: AppSession; auth: AuthState; moneyStamp: number }) {
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
  const [clubs, setClubs] = useState<ClubListing[] | null>(null);
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [treasuryErr, setTreasuryErr] = useState<string | null>(null);

  /**
   * The money read, and whether it FAILED — which is not the same as not having answered yet.
   *
   * This used to swallow its own error, on the reasoning that the panel says its own piece. It cannot:
   * `stakeStage(null)` is 'loading', so a treasury that could not be reached left "Reading your money…"
   * on the screen for good, with nothing to press.
   */
  const loadTreasury = useCallback(async () => {
    try {
      setTreasury(await api.getTreasury(session.token));
      setTreasuryErr(null);
    } catch (e) {
      setTreasuryErr(e instanceof ApiError ? `Could not read your money — ${e.message}` : 'Could not reach the card room to read your money.');
    }
  }, [session.token]);
  useEffect(() => {
    void loadTreasury();
    // `moneyStamp` is the buy-in authorisation coming back from the person's Home. Without it the
    // room keeps the answer it read BEFORE they left to sign, and tells somebody who has just
    // authorised buy-ins that they still need to.
  }, [loadTreasury, moneyStamp]);

  const loadClubs = useCallback(async () => {
    try {
      setClubs((await api.listClubs(session.token)).clubs);
    } catch {
      // The rail shows "Reading…" rather than "you are in none", which is the honest answer to a
      // question we asked and did not get back.
    }
  }, [session.token]);
  useEffect(() => {
    void loadClubs();
  }, [loadClubs]);

  /**
   * Read the public list again NOW, rather than waiting for the next poll.
   *
   * Closing a table is a thing somebody just did; a list that still shows it for five seconds reads
   * as a button that did not work.
   */
  const [reloadAt, setReloadAt] = useState(0);
  const reload = useCallback(() => setReloadAt((n) => n + 1), []);

  // The PUBLIC tables. A club's own list is read on the club's page, against that club — this one is
  // never filtered, because it is the pickup list and it means the same thing on every page.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const t = await api.listTables(session.token);
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
  }, [session.token, reloadAt]);

  const money = (treasury?.assetSymbol ?? '').trim() || 'SHQ';
  // ONE READ of whether this person can sit at a money table, from the shell, so the create form and
  // the seat gate can never disagree about it.
  const ready = stakeStage(treasury) === 'ready';

  return (
    <div className="room">
      <Rail r={r} clubs={clubs} />
      <main className="room-main">
        {r.page === 'tables' ? (
          <TablesPage session={session} tables={tables} err={err} money={money} ready={ready} onChanged={reload} />
        ) : r.page === 'money' ? (
          <MoneyPage session={session} config={auth.config} treasury={treasury} treasuryErr={treasuryErr} tables={tables} onChanged={loadTreasury} />
        ) : r.page === 'newClub' ? (
          <NewClubPage session={session} onStarted={loadClubs} />
        ) : r.page === 'club' ? (
          <ClubPage clubId={r.clubId} session={session} config={auth.config} money={money} ready={ready} onChanged={loadClubs} />
        ) : (
          <PlayPage session={session} />
        )}
      </main>
    </div>
  );
}
