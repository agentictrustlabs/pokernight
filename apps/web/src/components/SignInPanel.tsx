import { useState } from 'react';
import type { AuthState } from '../App';
import type { AppSession, Session } from '../lib/types';
import { api } from '../lib/api';

/**
 * The way in. Three doors, ranked by how much they prove:
 *
 *   1. YOUR HOME. The OIDC redirect ceremony. Your Smart Agent proves who you are and signs the
 *      site-login delegation; the card room never sees a password and never holds your keys.
 *   2. A DEMO USER the Home lends out. A real Smart Agent with a real id_token, verified server-side
 *      exactly like (1) — but a shared account, so it is offered second and labelled as what it is.
 *      Rendered only when the Home actually returns a roster.
 *   3. A DEV NAME. Proves nothing; present only where `GET /auth/config` says DEV_AUTH is on, and
 *      folded away so it reads as the last resort it is.
 *
 * Every failure — the config not loading, a cancelled ceremony, a Home that will not mint — lands
 * here as a sentence and a way onward, never a blank screen.
 */
export function SignInPanel({ auth, onLogin }: { auth: AuthState; onLogin: (s: AppSession) => void }) {
  const { config, configError, busy, error } = auth;
  const homeHost = config?.home.origin ? safeHost(config.home.origin) : null;
  const personas = auth.personas;

  return (
    <div className="signin">
      {auth.notice ? (
        <p className="signin-notice" role="status">
          {auth.notice}
        </p>
      ) : null}

      {error ? (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button className="quiet small" type="button" onClick={auth.dismissError}>
            dismiss
          </button>
        </div>
      ) : null}

      {configError ? (
        <>
          <p className="hint">The table service did not answer, so we cannot tell which sign-in this room accepts.</p>
          <div className="form-error">{configError}</div>
          <button className="primary" type="button" onClick={() => location.reload()}>
            Try again
          </button>
        </>
      ) : !config ? (
        <p className="hint">Checking how you sign in…</p>
      ) : (
        <>
          <div className="signin-primary">
            <p className="hint">
              Sign in with your Home{homeHost ? ` at ${homeHost}` : ''}. Your Smart Agent proves who you are; the card room never sees a
              password and never holds your keys.
            </p>
            <button className="primary" type="button" onClick={auth.signInWithHome} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in with your Home'}
            </button>
          </div>

          {personas.length > 0 ? <DemoUsers auth={auth} homeHost={homeHost} /> : null}
          {config.devAuth ? <DevLogin onLogin={onLogin} /> : null}
        </>
      )}
    </div>
  );
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * The Home's demo users. These are real Smart Agents whose keys the Home holds — connecting as one
 * yields a genuine id_token and delegation, which the tables Worker verifies like any other. They are
 * shared accounts, so the list says so rather than dressing them up as your own identity.
 */
function DemoUsers({ auth, homeHost }: { auth: AuthState; homeHost: string | null }) {
  const personas = auth.personas;
  return (
    <section className="signin-demo">
      <h3>Or borrow a demo user</h3>
      <p className="hint">
        {homeHost ?? 'The Home'} lends these Smart Agents to anyone who asks, so you can sit down without setting up an identity first.
        Real accounts, shared by everyone — play money only.
      </p>
      {auth.demoError ? (
        <div className="form-error" role="alert">
          {auth.demoError}
        </div>
      ) : null}
      <ul className="persona-list">
        {personas.map((p) => {
          const connecting = auth.demoBusy === p.handle;
          return (
            <li key={p.handle}>
              <button
                type="button"
                className="persona"
                disabled={auth.demoBusy != null || auth.busy}
                onClick={() => auth.connectAsDemo(p.handle)}
                title={p.sa}
              >
                <span className="persona-main">
                  <span className="persona-name">{p.name}</span>
                  <span className="persona-handle">{p.handle}</span>
                </span>
                {p.blurb ? <span className="persona-blurb">{p.blurb}</span> : null}
                <span className="persona-sa mono">{p.shortSa}</span>
                <span className="persona-go">{connecting ? 'connecting…' : 'connect'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Dev-only name login. Proves nothing; only offered where the API says DEV_AUTH is on, and folded
 *  shut so it never competes with a door that does prove something. */
function DevLogin({ onLogin }: { onLogin: (s: AppSession) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="dev-login">
      <summary>Development sign-in</summary>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          setBusy(true);
          setErr(null);
          try {
            const s: Session = await api.devLogin(n);
            onLogin({ ...s, via: 'dev' });
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : String(ex));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="hint">On this development deployment only: pick a name and a play-money session is minted for you. No proof of anything.</p>
        <label>
          Name
          <input type="text" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        </label>
        {err ? <div className="form-error">{err}</div> : null}
        <button className="quiet" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Signing in…' : 'Enter with a dev name'}
        </button>
      </form>
    </details>
  );
}
