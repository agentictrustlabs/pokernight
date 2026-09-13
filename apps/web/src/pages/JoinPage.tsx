import { useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import type { AuthState } from '../App';
import { ApiError, api } from '../lib/api';
import { PRODUCT_NAME } from '../lib/brand';
import { clubHash, rememberReturn } from '../lib/routes';
import { startMembershipJoin } from '../lib/home';
import { shortAddress } from '../lib/format';
import { SignInPage } from './SignInPage';

/**
 * THE DOOR INTO A CLUB — where the message the host's agent sent lands.
 *
 * Membership lives at the Home: the host invited this person there, and joining is their own ceremony
 * at their own Home (`workspace-join`). Until they have run it they have NO STANDING at the club, so
 * this page can show them nothing about it — not its name, not who is in it; a club you are not in is
 * indistinguishable from one that does not exist. What it can do is say what it is for and send them
 * to their Home to join. If they are already a member (the ceremony ran, or they came back), it simply
 * takes them to the club.
 */
export function JoinPage({ clubId, session, auth, onLogin }: { clubId: string; session: AppSession | null; auth: AuthState; onLogin: (s: AppSession) => void }) {
  const [state, setState] = useState<'checking' | 'member' | 'stranger'>('checking');
  const [err, setErr] = useState<string | null>(null);
  /** The invitation itself, read off their own inbox — the club's name and who asked, when the Home can say. */
  const [invitation, setInvitation] = useState<{ name: string; fromName?: string } | null>(null);

  // TWO QUESTIONS, ASKED TOGETHER: are they already in (then the club's page), and what does the invitation
  // say (the club's name, who asked). Each is a trip to the Home of a couple of seconds; one after the other
  // was the door taking five seconds to say who was knocking.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    api
      .getClub(clubId, session.token)
      .then(() => alive && setState('member'))
      .catch(() => alive && setState('stranger'));
    api
      .listInvitations(session.token)
      .then((r) => { const i = r.invitations.find((x) => x.clubId === clubId); if (alive && i) setInvitation({ name: i.name, ...(i.fromName ? { fromName: i.fromName } : {}) }); })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, clubId]);

  useEffect(() => {
    if (state === 'member') location.hash = clubHash(clubId);
  }, [state, clubId]);

  return (
    <div className="stack">
      <section className="panel join-panel">
        <p className="hero-eyebrow">{PRODUCT_NAME}</p>
        <h1>{invitation ? `${invitation.fromName ? `${invitation.fromName} invited you to ` : 'You are invited to '}${invitation.name}` : 'You have been invited to a club'}</h1>
        <p className="hint">
          Its agent is <code className="mono" title={clubId}>{shortAddress(clubId)}</code>. The host invited you at their Home; joining is done at yours — one
          approval, and the club's own agent will know you as a member. Its tables, its nights and its huddle are then yours to use.
        </p>
        {!session ? (
          <>
            <p className="hint">Sign in first — as the Home the invitation was sent to.</p>
            <SignInPage auth={auth} onLogin={(s) => { rememberReturn(location.hash); onLogin(s); }} />
          </>
        ) : state === 'member' ? (
          <p className="hint">You are already a member — opening the club.</p>
        ) : (
          <>
            {err ? <div className="form-error">{err}</div> : null}
            <button
              type="button"
              className="primary"
              onClick={async () => {
                if (!auth.config) return;
                setErr(null);
                try {
                  location.href = await startMembershipJoin(auth.config, { clubId });
                } catch (e) {
                  setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'The join could not be started.');
                }
              }}
            >
              Join at your Home
            </button>
            <p className="hint">If your Home says it holds no invitation for you, the host has not sent one to this Home yet — ask them to invite the agent you are signed in as.</p>
          </>
        )}
      </section>
    </div>
  );
}
