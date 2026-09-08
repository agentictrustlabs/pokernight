import type { AppSession } from '../lib/types';
import { shortAddress } from '../lib/format';
import { displayName } from '../lib/session';

export { shortAddress };

/**
 * Who you are signed in as.
 *
 * The name the Home asserted, when it asserted one — and "You" when it did not, which is what a
 * Home that knows someone only as a phone number hands back. It used to print the Smart Agent
 * address there, which put a raw `0x…` on every screen in the app to say something a person already
 * knows. The address is still on the title, and in the details of the money panel.
 *
 * A demo session carries a tag saying the identity is one the Home lends out; a dev session says so
 * plainly, because it proves nothing.
 */
export function Identity({ session, onSignOut }: { session: AppSession; onSignOut: () => void }) {
  const fromHome = session.via === 'home' || session.via === 'demo';
  const name = displayName(session);
  const secondary = fromHome ? (session.agentName && session.agentName !== name ? session.agentName : null) : 'dev session';
  return (
    <span className="identity">
      <strong title={session.address ?? undefined}>{name}</strong>
      {secondary && secondary !== name ? (
        <span className="identity-sub" title={session.address ?? undefined}>
          {secondary}
        </span>
      ) : null}
      {session.via === 'demo' ? <span className="tag">demo user</span> : null}
      <button className="quiet small" type="button" onClick={onSignOut}>
        sign out
      </button>
    </span>
  );
}
