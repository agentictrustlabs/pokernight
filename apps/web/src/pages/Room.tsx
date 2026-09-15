import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthState } from '../App';
import type { AppSession, TableSummary } from '../lib/types';
import { ApiError, api, type ClubInvitation, type ClubListing } from '../lib/api';
import { Rail } from '../components/Rail';
import type { Route } from '../lib/routes';
import type { TreasuryView } from '../lib/treasury';
import { stakeStage } from '../lib/stake';
import { ClubPage } from './ClubPage';
import { MoneyPage } from './MoneyPage';
import { MissionPage } from './MissionPage';
import { MissionRegisterPage } from './MissionRegisterPage';
import { MissionsPage } from './MissionsPage';
import { NewClubPage } from './NewClubPage';
import { TableNewPage } from './TableNewPage';
import { RoomPage } from './RoomPage';
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
/** The page's name, the way the landing says its own: an eyebrow in brass, a title, one line under it. */
function PageHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <header className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {lede ? <p className="lede">{lede}</p> : null}
    </header>
  );
}

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
      setTreasuryErr(e instanceof ApiError ? `Could not read your money — ${e.message}` : 'Could not reach the room to read your money.');
    }
  }, [session.token]);
  useEffect(() => {
    void loadTreasury();
    // `moneyStamp` is the buy-in authorisation coming back from the person's Home. Without it the
    // room keeps the answer it read BEFORE they left to sign, and tells somebody who has just
    // authorised buy-ins that they still need to.
  }, [loadTreasury, moneyStamp]);

  const [invitations, setInvitations] = useState<ClubInvitation[]>([]);
  const loadClubs = useCallback(async () => {
    // The two reads are INDEPENDENT and fire together: a club list that is slow or never comes back must not
    // hide an invitation. `await`-ing the clubs first held the invitations behind a Home round trip, so somebody
    // just invited — who is in no clubs yet and whose clubs read is the slowest there is — saw nothing.
    void api.listClubs(session.token).then((r) => setClubs(r.clubs)).catch(() => undefined);
    void api.listInvitations(session.token).then((r) => setInvitations(r.invitations)).catch(() => undefined);
  }, [session.token]);
  useEffect(() => {
    void loadClubs();
  }, [loadClubs]);
  // A CLUB JUST FOUNDED lands on its page before the rail has heard of it: the rail read its list on mount,
  // and the club came to exist after. One re-read per unknown club id, so the rail catches up without a loop.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (r.page !== 'club' || !clubs || clubs.some((c) => c.clubId === r.clubId) || askedFor.current === r.clubId) return;
    askedFor.current = r.clubId;
    void loadClubs();
  }, [r, clubs, loadClubs]);

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
      <Rail r={r} clubs={clubs} invitations={invitations} />
      <main className="room-main">
        {r.page === 'tables' ? (
          <>
            <PageHead eyebrow="Tables" title="What is running" lede="Open tables anyone can join. A club's own tables are on the club's page." />
            <TablesPage session={session} tables={tables} err={err} money={money} ready={ready} onChanged={reload} />
          </>
        ) : r.page === 'money' ? (
          <>
            <PageHead eyebrow="Your money" title="Buy-ins and cash-outs" lede="In Sheqels — the room's own coin, held in your money account at your Home. A practice table needs none of it." />
            <MoneyPage session={session} config={auth.config} treasury={treasury} treasuryErr={treasuryErr} tables={tables} onChanged={loadTreasury} />
          </>
        ) : r.page === 'newClub' ? (
          <NewClubPage config={auth.config} session={session} />
        ) : r.page === 'room' ? (
          <RoomPage session={session} clubId={r.clubId ?? null} />
        ) : r.page === 'newTable' ? (
          <TableNewPage session={session} money={money} club={r.clubId ?? null} night={r.night ?? null} ready={ready} />
        ) : r.page === 'missions' ? (
          <MissionsPage />
        ) : r.page === 'newMission' ? (
          <MissionRegisterPage session={session} config={auth.config} />
        ) : r.page === 'mission' ? (
          <MissionPage entryId={r.entryId} />
        ) : r.page === 'club' ? (
          <ClubPage clubId={r.clubId} session={session} config={auth.config} money={money} ready={ready} onChanged={loadClubs} />
        ) : (
          <PlayPage session={session} />
        )}
      </main>
    </div>
  );
}
