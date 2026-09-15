import { useState } from 'react';

/** Set the first time a session is saved on this device; read before sign-in to tell a return from a first visit. */
export const EVER_KEY = 'pokernight.ever';
import type { AuthState } from '../App';
import type { AppSession, Session } from '../lib/types';
import { api } from '../lib/api';
import { PROFILE_NAME_MAX, toProfileName, type AuthConfig } from '../lib/home';
import { fmtAsset } from '../lib/money';

/**
 * The way in. ONE question, ONE action, and two things folded away behind them.
 *
 * The headline is the door a stranger actually uses: their Home, where they sign in with a phone
 * number, an email address or a social account. What happens after they press it — the OIDC
 * ceremony, their Smart Agent signing a delegation, the room verifying it against their Home —
 * is true and is not their problem, so this says what they get rather than how.
 *
 * ONE THING IS THEIR PROBLEM, and it is stated here rather than discovered later. That same visit
 * to their Home also mints the buy-in mandate: a ceiling on what this table may take from their
 * money tonight. It used to be a second trip, which is why it used to be somebody else's screen to
 * explain. It is this screen's job now, so {@link BuyInConsent} says the numbers — per buy-in, in
 * all, how many, how long, and that nothing moves until they actually sit down — BEFORE the button,
 * and the button says both things it does. A money grant folded into something labelled only "sign
 * in" would be a worse bug than the extra trip it replaced.
 *
 * The question above it is what to call them, and it is a PROFILE name — not a Faithnet handle. It
 * is what the seat plate, the hand log and the header say instead of a truncated address, and it is
 * kept by the room; nothing claims `<label>.me` in the naming service for it, so a person can
 * be "Rich Pedersen" here and nameless there. It is OPTIONAL, and blank has to keep working: a Home
 * may know somebody as nothing but a phone number, and making a stranger invent a word before they
 * can sit down is the wrong trade.
 *
 * Below it, collapsed, the two doors that are not for a new player:
 *   A DEMO USER the Home lends out. A real Smart Agent verified exactly like a redirect sign-in,
 *   but a shared account — offered as "try it as someone else" and labelled as what it is.
 *   Rendered only when the Home actually returns a roster.
 *   A DEV NAME. Proves nothing; only where `GET /auth/config` says DEV_AUTH is on.
 *
 * Every failure — the config not loading, a cancelled ceremony, a Home that will not mint — lands
 * here as a sentence and a way onward, never a blank screen.
 */
export function SignInPanel({ auth, onLogin, startSigningUp = false, showSwitch = true }: { auth: AuthState; onLogin: (s: AppSession) => void; startSigningUp?: boolean; showSwitch?: boolean }) {
  const { config, configError, busy, error } = auth;
  const homeHost = config?.home.origin ? safeHost(config.home.origin) : null;
  const personas = auth.personas;
  const [name, setName] = useState('');
  /**
   * HAS THIS BROWSER EVER HELD A SESSION? That is what "returning" means here, and it is the only honest thing
   * the page can know before anybody signs in: the room has no idea who is looking at it. A wrong guess costs
   * nothing — both doors lead to the same ceremony at the same Home — so the returning one is offered first and
   * the name box waits behind "first time here".
   */
  const [returning] = useState(() => { try { return localStorage.getItem(EVER_KEY) === '1'; } catch { return false; } });
  const [signingUp, setSigningUp] = useState(startSigningUp);

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
            {/* THE NAME BELONGS TO SIGNING UP (2026-09-15). Somebody who has played here before is not being
                asked their name again — they are coming back, and one press should do it. What is NOT behind
                that door is the disclosure: the Home you are about to use and the ceiling you are about to
                approve are on whichever door you are actually going to press, because hiding either behind
                "first time here" would be hiding it from everybody who is not. */}
            {signingUp ? (
              <>
                <label className="signin-name">
                  What should we call you?
                  <input
                    type="text"
                    value={name}
                    maxLength={PROFILE_NAME_MAX}
                    autoComplete="given-name"
                    placeholder="optional"
                    aria-describedby="signin-name-hint"
                    onChange={(e) => setName(toProfileName(e.target.value))}
                    disabled={busy}
                  />
                </label>
                <p className="hint" id="signin-name-hint">
                  This is the name other players see. Leave it blank and you will play as &ldquo;Seat 4&rdquo;.
                </p>
              </>
            ) : (
              <p className="hint signin-welcome">
                {returning ? 'Welcome back — your Home knows you, and your name comes with you.' : 'Already have a Home on the faithnet estate? Come straight in.'}
              </p>
            )}

            <button className="primary big" type="button" onClick={() => auth.signInWithHome(signingUp ? name : '')} disabled={busy}>
              {busy ? 'Coming in…' : signingUp ? 'Set me up and come in' : returning ? 'Welcome back — come in and play' : 'Come in and play'}
            </button>
            <p className="hint">
              Use an email address or a social account at your Home{homeHost ? ` (${homeHost})` : ''}. No
              password to set, nothing to install.
            </p>
            {showSwitch ? (
              <button className="link-button" type="button" onClick={() => setSigningUp(!signingUp)} disabled={busy}>
                {signingUp ? '← Been here before? Just come in' : 'First time here? Set your name up →'}
              </button>
            ) : null}
          </div>

          {personas.length > 0 ? <DemoUsers auth={auth} homeHost={homeHost} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * THE CEILING IS DISCLOSED AND APPROVED AT THE PERSON'S OWN HOME (2026-09-15), not here.
 *
 * This screen used to state the numbers — per buy-in, in all, how many, for how long — before sending anybody
 * over. That was honest but it made a games site open on money, and it duplicated a disclosure the Home makes
 * properly a moment later: the Home SHOWS the same ceiling and asks the person to sign it, which is where the
 * consent actually happens and the only place it can be refused. So the line is gone from here and the
 * ceremony is unchanged.
 */

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
    <details className="signin-demo">
      <summary>Try it as someone else</summary>
      <p className="hint">
        {homeHost ?? 'The Home'} lends these accounts to anyone, so you can look around without signing in. They are shared by
        everyone who visits — treat anything you do with one as public.
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
    </details>
  );
}

/** Dev-only name login. Proves nothing; only offered where the API says DEV_AUTH is on, and folded
 *  shut so it never competes with a door that does prove something. */
