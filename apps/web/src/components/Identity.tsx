import type { AppSession } from '../lib/types';
import { shortAddress } from '../lib/format';

export { shortAddress };

/**
 * Who you are signed in as. A Home session shows the agent name the Home asserted (or the truncated
 * Smart Agent address when it asserted none); a demo session shows the same, plus a tag saying the
 * identity is one the Home lends out; a dev session says so plainly, because it proves nothing.
 */
export function Identity({ session, onSignOut }: { session: AppSession; onSignOut: () => void }) {
  const fromHome = session.via === 'home' || session.via === 'demo';
  const secondary = fromHome ? (session.agentName ?? (session.address ? shortAddress(session.address) : null)) : 'dev session';
  return (
    <span className="identity">
      <strong>{session.name}</strong>
      {secondary && secondary !== session.name ? (
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
