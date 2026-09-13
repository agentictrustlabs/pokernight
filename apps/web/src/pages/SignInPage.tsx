import type { AuthState } from '../App';
import type { AppSession } from '../lib/types';
import { SignInPanel } from '../components/SignInPanel';
import { PRODUCT_NAME } from '../lib/brand';

/**
 * Sign-in on its own — where signing out lands, and where a session that stopped being accepted
 * lands. The same panel the landing page carries, with just enough around it to say where you are.
 */
export function SignInPage({ auth, onLogin }: { auth: AuthState; onLogin: (s: AppSession) => void }) {
  return (
    <div className="signin-page">
      <div className="panel signin-card">
        <p className="hero-eyebrow">{PRODUCT_NAME}</p>
        <h1>Sign in to the card room</h1>
        <SignInPanel auth={auth} onLogin={onLogin} />
      </div>
      <p className="hint signin-away">
        New here? <a href="#/">The front page</a> explains the room and shows which tables are running.
      </p>
    </div>
  );
}
