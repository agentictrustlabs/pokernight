import type { AppSession } from '../lib/types';

/** `0x89d13c59…a820ffd0` — recognisable, short enough for a topbar. */
export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

/**
 * Who you are signed in as. A Home session shows the agent name the Home asserted (or the truncated
 * Smart Agent address when it asserted none); a dev session says so plainly, because it proves nothing.
 */
export function Identity({ session, onSignOut }: { session: AppSession; onSignOut: () => void }) {
  const secondary = session.via === 'home' ? (session.agentName ?? (session.address ? shortAddress(session.address) : null)) : 'dev session';
  return (
    <span className="identity">
      <strong>{session.name}</strong>
      {secondary && secondary !== session.name ? (
        <span className="identity-sub" title={session.address ?? undefined}>
          {secondary}
        </span>
      ) : null}
      <button className="quiet small" type="button" onClick={onSignOut}>
        sign out
      </button>
    </span>
  );
}
