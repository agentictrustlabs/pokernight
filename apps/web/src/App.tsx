import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSession } from './lib/types';
import { ApiError, api, loadSession, saveSession, setUnauthorizedHandler } from './lib/api';
import { SESSION_KEY } from './lib/ssoLogout';
import {
  forgetHomeSession,
  startHomeSignIn,
  takeCharterCallback,
  takeCoachCallback,
  takeCoachName,
  takeCharterClub,
  takeHomeCallback,
  takeMandateCallback,
  takeProfileName,
  type AuthConfig,
} from './lib/home';
import { describeDemoError, type DemoPersona } from './lib/demo';
import { connectAsDemoUser, fetchDemoPersonas } from './lib/quickConnect';
import { HOME_HASH, goTo, route, takeReturn } from './lib/routes';
import { describeSignOut, signOutTo, type SignOutReason } from './lib/session';
import { PRODUCT_NAME } from './lib/brand';
import { useHash } from './lib/hooks';
import { CardDefs } from './components/Card';
import { NewBuild } from './components/NewBuild';
import { CoachQuestion } from './components/CoachQuestion';
import { ClubHuddleProvider } from './components/huddle/ClubHuddleProvider';
import { ClubHuddleDock } from './components/huddle/ClubHuddleDock';
import { Identity } from './components/Identity';
import { JoinPage } from './pages/JoinPage';
import { TableRoute } from './pages/TableRoute';
import { Landing } from './pages/Landing';
import { Room } from './pages/Room';
import { SignInPage } from './pages/SignInPage';

/** Everything sign-in related, in one bag, so every surface can render every state of it. */
export interface AuthState {
  config: AuthConfig | null;
  /** Could not reach `GET /auth/config` — we do not know which doors are open. */
  configError: string | null;
  /** A sign-in is in flight (redirecting out, or finishing the return leg). */
  busy: boolean;
  /** Something went wrong and the person needs to see it and be able to try again. */
  error: string | null;
  /** Start a Home sign-in. `name` is the PROFILE name the person asked to be called — a display name
   *  this card room keeps, never a Faithnet handle. Blank is a perfectly good way to be signed in. */
  signInWithHome: (name?: string) => void;
  dismissError: () => void;
  /** Demo users the Home offers. Empty when it offers none, or cannot be reached. */
  personas: DemoPersona[];
  /** Handle of the demo user currently connecting, or null. */
  demoBusy: string | null;
  /** Why the last demo connect failed, said plainly. */
  demoError: string | null;
  connectAsDemo: (handle: string) => void;
  /** Why the person is looking at a sign-in screen, when there is a reason worth stating. */
  notice: string | null;
}

export function App() {
  const hash = useHash();
  const [session, setSession] = useState<AppSession | null>(() => loadSession());
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [personas, setPersonas] = useState<DemoPersona[]>([]);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  /**
   * Bumped whenever something OUTSIDE the money screen changes the money.
   *
   * The buy-in authorisation is a ceremony at the person's own Home: they leave, sign, and come back
   * to a page whose treasury was read before they went. It said "one thing left: authorise buy-ins"
   * to somebody who had just authorised buy-ins, until they happened to reload — so the ceremony
   * looked like it had failed every single time it succeeded.
   */
  const [moneyStamp, setMoneyStamp] = useState(0);

  // The 401 handler needs the CURRENT session without re-registering on every change.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const login = useCallback((s: AppSession) => {
    saveSession(s);
    setSession(s);
    setError(null);
    setDemoError(null);
    setNotice(null);
  }, []);

  /**
   * End the session and land on the sign-in page. `signOutTo` decides what that means (see
   * session.ts): a person who clicked "sign out" is owed nothing, a person whose token was refused
   * mid-hand is owed a sentence. Either way they land somewhere they can act, never on a dead table.
   *
   * The two endings differ in one more way now, and it is the important one. An explicit sign-out
   * GIVES UP the person's seats: the Worker stands them up everywhere and, on a settled table, cashes
   * them out, so nobody's money is left committed to a seat they have walked away from. An EXPIRED
   * session does no such thing — it lets the socket close and be treated as a disconnect, which keeps
   * the seat and the chips exactly where they are. An expired token is not consent to move money.
   *
   * The navigation does not wait on the network: the person leaves the table now, and what happened
   * to their seats replaces the notice on the sign-in page when the answer arrives. Whatever it says
   * is what the server actually did — a queued cash-out is reported as queued, never as paid.
   */
  const endSession = useCallback((reason: SignOutReason) => {
    const outcome = signOutTo(reason);
    const current = sessionRef.current;
    // Tell the Worker to give up the seats and drop the server-side record, so the token dies now
    // rather than at exp. Pointless when the API has already refused the token.
    if (outcome.standUp && current) {
      void api.signOut(current.token).then((result) => {
        const said = describeSignOut(result);
        if (said) setNotice(said);
      });
    }
    saveSession(outcome.session);
    // Their HOME session goes with their card-room session. It is a bearer token for somebody's own
    // Home, held only to hand ceremonies off, and keeping it past a sign-out would be keeping the
    // more powerful of the two credentials after being told to let go of the lesser one.
    forgetHomeSession();
    setSession(outcome.session);
    setNotice(outcome.notice);
    setError(null);
    setDemoError(null);
    goTo(outcome.hash);
  }, []);

  const signOut = useCallback(() => endSession('user'), [endSession]);

  /**
   * Another tab — or the `/sso-logout` page the person's Home sent them through — has ended the
   * session. `localStorage` fires this event in every OTHER tab of this origin, which is the only
   * signal a tab that is not the one being redirected ever gets.
   *
   * Nothing is repeated here: whoever cleared the key has already stood the player up and revoked the
   * token. This tab only has to stop showing a table it can no longer play at.
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_KEY && e.key !== null) return;
      if (e.newValue) return; // a sign-IN elsewhere; this tab keeps what it has
      if (sessionRef.current) endSession('elsewhere');
    };
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  }, [endSession]);

  // THE STAKE, SET UP ON ARRIVAL. A person who signed in through their Home has a money account made in
  // the connect ceremony; the rest of "getting ready" — finding it, seeding it with the play coin — needs
  // no signature and no screen, so it runs once here rather than waiting for the first money table to say
  // "Set up your stake". What is left after this is the one thing that IS theirs to sign: the buy-in
  // mandate, and the table asks for that by name. Best-effort and silent: the panel remains the recovery path.
  useEffect(() => {
    if (!session || session.via === 'dev') return;
    const key = `pokernight.stake.ran:${session.token.slice(-16)}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* run anyway */ }
    void api.quickStart(session.token).catch(() => {});
  }, [session]);

  // Any route refusing a token we sent means this session is over, wherever we were standing.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (sessionRef.current) endSession('expired');
    });
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  // Which sign-in doors this deployment has open. Read from the API, not a build flag, so localhost
  // shows the dev box and production shows Home sign-in from the same bundle.
  useEffect(() => {
    let alive = true;
    api
      .authConfig()
      .then((c) => alive && (setConfig(c), setConfigError(null)))
      .catch((e: unknown) => alive && setConfigError(e instanceof ApiError ? `${e.status}: ${e.message}` : 'Could not reach the table service.'));
    return () => {
      alive = false;
    };
  }, []);

  // Whether this Home lends out demo users is the HOME's decision: an empty roster (or an unreachable
  // Home) means the affordance simply does not appear. Never fetched for a signed-in visitor.
  useEffect(() => {
    if (!config || session) return;
    let alive = true;
    void fetchDemoPersonas(config).then((ps) => {
      if (alive) setPersonas(ps);
    });
    return () => {
      alive = false;
    };
  }, [config, session]);

  /**
   * The return leg of a BUY-IN AUTHORISATION, which lands on the same redirect URI as a sign-in and
   * is told apart by its own stashed `state`. It must be consumed first, because the sign-in path
   * would otherwise treat the code as a fresh sign-in and mint a new session out of a ceremony the
   * player ran to authorise money, not to log in again.
   */
  useEffect(() => {
    const outcome = takeMandateCallback();
    if (outcome.status !== 'signed-in') {
      if (outcome.status === 'error') setError(outcome.message);
      return;
    }
    const current = sessionRef.current;
    if (!current) {
      setError('Your Home finished the authorisation, but this browser is no longer signed in — sign in and try again.');
      return;
    }
    setBusy(true);
    api
      .homeMandate(
        {
          code: outcome.code,
          codeVerifier: outcome.codeVerifier,
          authOrigin: outcome.authOrigin,
          nonce: outcome.nonce,
          state: outcome.state,
        },
        current.token,
      )
      .then(() => {
        setNotice('Buy-ins are authorised — you can take a seat.');
        // Tell the room to read the money again; it last read it before this person left for their Home.
        setMoneyStamp((n) => n + 1);
        // Back to the table they were sitting at when they left, not to the front door.
        const back = takeReturn();
        if (back) goTo(back);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not record the buy-in authorisation.'))
      .finally(() => setBusy(false));
  }, []);

  /**
   * The return leg of HIRING A COACH. Fourth ceremony on the same redirect URI, told apart by its own
   * `state`. The Worker exchanges the code and checks the identity; nothing is recorded here — the
   * arrangement lives in the person's playbook and their grant, at their Home. What is said is for them.
   */
  useEffect(() => {
    const outcome = takeCoachCallback();
    if (outcome.status !== 'signed-in') {
      if (outcome.status === 'error') setError(outcome.message);
      return;
    }
    const coachName = takeCoachName();
    const current = sessionRef.current;
    if (!current) {
      setError('Your Home hired the coach, but this browser is no longer signed in — sign in and it will be there.');
      return;
    }
    setBusy(true);
    api
      .homeCoach({ code: outcome.code, codeVerifier: outcome.codeVerifier, authOrigin: outcome.authOrigin, nonce: outcome.nonce, state: outcome.state }, current.token)
      .then((r) => {
        setNotice(`${r.coach.name} is your coach now — name your own agent as your adviser at a table and it will consult ${r.coach.name}.`);
        const back = takeReturn();
        if (back) goTo(back);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : `Could not finish hiring ${coachName ?? 'the coach'}.`))
      .finally(() => setBusy(false));
  }, []);

  /**
   * The return leg of a CLUB CHARTER. Third ceremony on the same redirect URI, told apart the same
   * way — by the `state` it stashed — and consumed before the sign-in path for the same reason: a
   * code from a charter is not a code to mint a session out of.
   *
   * Which club it was for came back from this origin's own storage, never from the Home. If that is
   * missing the charter cannot be recorded against anything, and saying so beats writing it onto
   * whichever club happens to be on screen.
   */
  useEffect(() => {
    const outcome = takeCharterCallback();
    if (outcome.status !== 'signed-in') {
      if (outcome.status === 'error') setError(outcome.message);
      return;
    }
    const clubId = takeCharterClub();
    const current = sessionRef.current;
    if (!current) {
      setError('Your Home chartered the club, but this browser is no longer signed in — sign in and it will be there.');
      return;
    }
    if (!clubId) {
      setError('Your Home finished, but this browser no longer knows which club it was for. Open the club and try again.');
      return;
    }
    setBusy(true);
    api
      .charterClub(
        clubId,
        {
          code: outcome.code,
          codeVerifier: outcome.codeVerifier,
          authOrigin: outcome.authOrigin,
          nonce: outcome.nonce,
          state: outcome.state,
        },
        current.token,
      )
      .then((club) => setNotice(`${club.name} has an agent of its own now.`))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not record the club charter.'))
      .finally(() => setBusy(false));
  }, []);

  // The return leg of a Home sign-in. `takeHomeCallback` scrubs the URL and clears the stash the
  // first time it sees a `?code`, so a refresh (or React's double-invoked effects) cannot resubmit a
  // single-use code. The Worker does the exchange and the verification; we only carry the code over.
  useEffect(() => {
    const outcome = takeHomeCallback();
    if (outcome.status === 'none') return;
    if (outcome.status === 'error') {
      setError(outcome.message);
      return;
    }
    setBusy(true);
    // What they typed before they left for their Home. Handed over WITH the code so the session is
    // named the moment it exists, rather than the person seeing a truncated address once and then a
    // name. Empty when they chose not to give one, which is a supported way to play.
    const profileName = takeProfileName();
    api
      .homeLogin({
        code: outcome.code,
        codeVerifier: outcome.codeVerifier,
        authOrigin: outcome.authOrigin,
        nonce: outcome.nonce,
        state: outcome.state,
        ...(profileName ? { profileName } : {}),
      })
      .then((r) => login({ token: r.token, playerId: r.playerId, name: r.name, via: 'home', address: r.address, agentName: r.agentName }))
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? `Your Home signed you in, but the card room would not accept it — ${e.message}` : 'Could not finish signing in.'),
      )
      .finally(() => setBusy(false));
  }, [login]);

  const signInWithHome = useCallback((name?: string) => {
    if (!config) return;
    setBusy(true);
    setError(null);
    startHomeSignIn(config, name ?? '')
      .then((url) => {
        location.href = url;
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  }, [config]);

  /**
   * Connect as one of the Home's demo users. The Home mints the session and the tables Worker
   * verifies it; a refusal from either half is named exactly (`describeDemoError`) — today the Home
   * refuses this client, and saying so is more use than a generic failure.
   */
  const connectAsDemo = useCallback(
    (handle: string) => {
      if (!config || demoBusy) return;
      setDemoBusy(handle);
      setDemoError(null);
      setError(null);
      connectAsDemoUser(config, handle)
        .then(login)
        .catch((e: unknown) => setDemoError(describeDemoError(e)))
        .finally(() => setDemoBusy(null));
    },
    [config, demoBusy, login],
  );

  const auth: AuthState = {
    config,
    configError,
    busy,
    error,
    signInWithHome,
    dismissError: () => setError(null),
    personas,
    demoBusy,
    demoError,
    connectAsDemo,
    notice,
  };
  const r = route(hash);

  // A signed-in visitor has no business on the sign-in page; the lobby is what they came for.
  useEffect(() => {
    if (session && r.page === 'signin') goTo(HOME_HASH);
  }, [session, r.page]);

  // THE CLUB HUDDLE lives above every page — the provider owns the browser call, the dock sits over the
  // content — so walking from a club to one of its tables and back does not hang up (spec 378 §1).
  const huddled = (node: ReactNode) => (
    <ClubHuddleProvider session={session} config={config}>
      {node}
      <ClubHuddleDock />
    </ClubHuddleProvider>
  );

  if (r.page === 'join') {
    return huddled(
      <div className="app">
        <CardDefs />
        <div className="topbar">
          <a className="brand" href="#/">
            {PRODUCT_NAME}
          </a>
          <span className="spacer" />
          <span className="meta">{session ? <Identity session={session} onSignOut={signOut} /> : null}</span>
        </div>
        <div className="page">
          <JoinPage clubId={r.clubId} token={r.token} session={session} auth={auth} onLogin={login} />
        </div>
      </div>
    );
  }

  if (r.page === 'table') {
    return huddled(
      <div className="app">
        <CardDefs />
        <TableRoute tableId={r.tableId} practice={r.practice === true} session={session} config={config} onSignOut={signOut} />
      </div>
    );
  }

  // The front page, on two roads: the front door for a visitor with no session, and `#/about` for
  // anybody — which is the only way a signed-in reader can get at the product explanation at all.
  const showLanding = (r.page === 'home' && !session) || r.page === 'about';

  return huddled(
    <div className="app">
      <CardDefs />
      <NewBuild />
      <div className="topbar">
        <a className="brand" href="#/">
          {PRODUCT_NAME}
        </a>
        <span className="spacer" />
        <span className="meta">
          {session ? (
            <Identity session={session} onSignOut={signOut} />
          ) : (
            <>
              <span>card room · test money</span>
              {r.page === 'signin' ? null : <a href="#/signin">Sign in</a>}
            </>
          )}
        </span>
      </div>
      {showLanding ? (
        <Landing auth={auth} onLogin={login} session={session} />
      ) : (
        <div className="page">
          {r.page === 'signin' || !session ? <SignInPage auth={auth} onLogin={login} /> : <Room r={r} session={session} auth={auth} onLogin={login} moneyStamp={moneyStamp} />}
        </div>
      )}
    </div>
  );
}
