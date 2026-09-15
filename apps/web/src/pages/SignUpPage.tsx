import type { AuthState } from '../App';
import type { AppSession } from '../lib/types';
import { SignInPanel } from '../components/SignInPanel';
import { PRODUCT_NAME } from '../lib/brand';

/**
 * SIGNING UP — a page, because it is a different errand from coming back.
 *
 * Somebody who has played here before wants one press and their seat; somebody who has never been here wants to
 * know what they are joining before they give it a name. Those two were one form, and the form asked everybody
 * the newcomer's question. This is the newcomer's half on its own: three lines of what happens, the name, and
 * the same one trip to their Home. Nothing here is a second account — the Home is the account.
 */
export function SignUpPage({ auth, onLogin }: { auth: AuthState; onLogin: (s: AppSession) => void }) {
  return (
    <div className="signin-page">
      <div className="panel signin-card signup-card">
        <p className="hero-eyebrow">{PRODUCT_NAME}</p>
        <h1>Come and play</h1>
        <ol className="signup-steps">
          <li><strong>Pick a name</strong> — what other players see. You can leave it blank.</li>
          <li><strong>One trip to your Home</strong> — a phone number, an email address or a social account. No password, nothing to install.</li>
          <li><strong>Straight to a table</strong> — you arrive with play money and a seat.</li>
        </ol>
        <SignInPanel auth={auth} onLogin={onLogin} startSigningUp showSwitch={false} />
        <p className="hint signup-back">
          Been here before? <a href="#/signin">Just come in</a>.
        </p>
      </div>
    </div>
  );
}
