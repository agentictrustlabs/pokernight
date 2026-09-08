import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSession } from './lib/types';
import { ApiError, api, loadSession, saveSession, setUnauthorizedHandler } from './lib/api';
import { startHomeSignIn, takeHomeCallback, takeMandateCallback, type AuthConfig } from './lib/home';
import { describeDemoError, type DemoPersona } from './lib/demo';
import { connectAsDemoUser, fetchDemoPersonas } from './lib/quickConnect';
import { HOME_HASH, goTo, route, takeReturn } from './lib/routes';
import { signOutTo, type SignOutReason } from './lib/session';
import { useHash } from './lib/hooks';
import { CardDefs } from './components/Card';
import { Identity } from './components/Identity';
import { Landing } from './pages/Landing';
import { Lobby } from './pages/Lobby';
import { SignInPage } from './pages/SignInPage';
import { TablePage } from './pages/TablePage';

/** Everything sign-in related, in one bag, so every surface can render every state of it. */
export interface AuthState {
  config: AuthConfig | null;
  /** Could not reach `GET /auth/config` — we do not know which doors are open. */
  configError: string | null;
  /** A sign-in is in flight (redirecting out, or finishing the return leg). */
  busy: boolean;
  /** Something went wrong and the person needs to see it and be able to try again. */
  error: string | null;
  signInWithHome: () => void;
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
   */
  const endSession = useCallback((reason: SignOutReason) => {
    const outcome = signOutTo(reason);
    const current = sessionRef.current;
    // Best effort: tell the Worker to drop the server-side record so the token dies now, not at exp.
    // Pointless when the API has already refused it.
    if (outcome.revoke && current) void api.signOut(current.token);
    saveSession(outcome.session);
    setSession(outcome.session);
    setNotice(outcome.notice);
    setError(null);
    setDemoError(null);
    goTo(outcome.hash);
  }, []);

  const signOut = useCallback(() => endSession('user'), [endSession]);

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
        // Back to the table they were sitting at when they left, not to the front door.
        const back = takeReturn();
        if (back) goTo(back);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not record the buy-in authorisation.'))
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
    api
      .homeLogin({
        code: outcome.code,
        codeVerifier: outcome.codeVerifier,
        authOrigin: outcome.authOrigin,
        nonce: outcome.nonce,
        state: outcome.state,
      })
      .then((r) => login({ token: r.token, playerId: r.playerId, name: r.name, via: 'home', address: r.address, agentName: r.agentName }))
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? `Your Home signed you in, but the card room would not accept it — ${e.message}` : 'Could not finish signing in.'),
      )
      .finally(() => setBusy(false));
  }, [login]);

  const signInWithHome = useCallback(() => {
    if (!config) return;
    setBusy(true);
    setError(null);
    startHomeSignIn(config)
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

  if (r.page === 'table') {
    return (
      <div className="app">
        <CardDefs />
        <TablePage tableId={r.tableId} session={session} config={config} onSignOut={signOut} />
      </div>
    );
  }

  const showLanding = r.page === 'home' && !session;

  return (
    <div className="app">
      <CardDefs />
      <div className="topbar">
        <a className="brand" href="#/">
          Pokernight
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
        <Landing auth={auth} onLogin={login} />
      ) : (
        <div className="page">
          {r.page === 'signin' || !session ? <SignInPage auth={auth} onLogin={login} /> : <Lobby session={session} auth={auth} onLogin={login} />}
        </div>
      )}
    </div>
  );
}
