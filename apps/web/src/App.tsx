import { useCallback, useEffect, useState } from 'react';
import type { AppSession } from './lib/types';
import { ApiError, api, loadSession, saveSession } from './lib/api';
import { startHomeSignIn, takeHomeCallback, type AuthConfig } from './lib/home';
import { useHash } from './lib/hooks';
import { CardDefs } from './components/Card';
import { Identity } from './components/Identity';
import { Lobby } from './pages/Lobby';
import { TablePage } from './pages/TablePage';

/** Hash routes: `#/` lobby, `#/t/<tableId>` table. */
function route(hash: string): { page: 'lobby' } | { page: 'table'; tableId: string } {
  const m = /^\/t\/([^/?#]+)/.exec(hash);
  if (m?.[1]) return { page: 'table', tableId: decodeURIComponent(m[1]) };
  return { page: 'lobby' };
}

/** Everything sign-in related, in one bag, so the lobby can render every state of it. */
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
}

export function App() {
  const hash = useHash();
  const [session, setSession] = useState<AppSession | null>(() => loadSession());
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback((s: AppSession) => {
    saveSession(s);
    setSession(s);
    setError(null);
  }, []);

  const signOut = useCallback(() => {
    // Best effort: tell the Worker to drop the server-side record so the token dies now, not at exp.
    if (session) void api.signOut(session.token);
    saveSession(null);
    setSession(null);
    setError(null);
  }, [session]);

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

  const auth: AuthState = { config, configError, busy, error, signInWithHome, dismissError: () => setError(null) };
  const r = route(hash);

  return (
    <div className="app">
      <CardDefs />
      {r.page === 'table' ? (
        <TablePage tableId={r.tableId} session={session} onSignOut={signOut} />
      ) : (
        <>
          <div className="topbar">
            <a className="brand" href="#/">
              Pokernight
            </a>
            <span className="spacer" />
            <span className="meta">
              {session ? <Identity session={session} onSignOut={signOut} /> : <span>card room · play money</span>}
            </span>
          </div>
          <div className="page">
            <Lobby session={session} auth={auth} onLogin={login} />
          </div>
        </>
      )}
    </div>
  );
}
