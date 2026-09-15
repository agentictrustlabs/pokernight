import { useState } from 'react';
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
export function SignInPanel({ auth, onLogin }: { auth: AuthState; onLogin: (s: AppSession) => void }) {
  const { config, configError, busy, error } = auth;
  const homeHost = config?.home.origin ? safeHost(config.home.origin) : null;
  const personas = auth.personas;
  const [name, setName] = useState('');

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
            <BuyInConsent buyIn={config.home.buyIn ?? null} />
            <button className="primary big" type="button" onClick={() => auth.signInWithHome(name)} disabled={busy}>
              {busy ? 'Coming in…' : 'Come in and play'}
            </button>
            <p className="hint">
              Use a phone number, an email address or a social account at your Home{homeHost ? ` (${homeHost})` : ''}. No
              password to set, nothing to install.
            </p>
          </div>

          {personas.length > 0 ? <DemoUsers auth={auth} homeHost={homeHost} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * What signing in ALSO approves, in the numbers the Home is about to show.
 *
 * Rendered only where the room states caps. Where it does not — local dev, a deployment with
 * no mandate configuration — sign-in asks for a plain session, so there is nothing to disclose and
 * this renders nothing rather than a reassurance nobody needs.
 *
 * "Nothing is taken until you sit down" is load-bearing and it is true: the mandate is a `pull`
 * authority, so the ceremony mints a ceiling and moves no money. The revocation sentence is true
 * too, and it is the player's, not ours — it happens at their Home.
 */
function BuyInConsent({ buyIn }: { buyIn: NonNullable<AuthConfig['home']['buyIn']> | null }) {
  if (!buyIn) return null;
  const per = `${fmtAsset(BigInt(buyIn.maxPerBuyIn))} ${buyIn.symbol}`;
  const all = `${fmtAsset(BigInt(buyIn.sessionTotal))} ${buyIn.symbol}`;
  const hours = Math.max(1, Math.round(buyIn.validSeconds / 3600));
  // STILL SAID, NEVER SHOUTED. The ceiling is real and a person is about to approve it, so it cannot be hidden —
  // but the first screen of a games site should not open with money. Folded away, and the person's own Home shows
  // the same numbers again before anything is signed.
  return (
    <details className="signin-consent">
      <summary>Signing in also sets a limit for tonight</summary>
      <p>
        Your Home will ask you to approve a ceiling for this room: up to {per} per buy-in, {all} in all, at most{' '}
        {buyIn.maxBuyIns} buy-ins, for the next {hours} hours.
      </p>
      <p className="hint">
        Nothing is taken until you sit down at a table and buy in. You can undo the limit at your Home at any time.
      </p>
    </details>
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
