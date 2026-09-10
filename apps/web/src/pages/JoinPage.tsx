import { useCallback, useEffect, useState } from 'react';
import type { AppSession, InviteGreeting } from '../lib/types';
import type { AuthState } from '../App';
import { ApiError, api } from '../lib/api';
import { PRODUCT_NAME } from '../lib/brand';
import { clubHash, rememberReturn } from '../lib/routes';
import { SignInPage } from './SignInPage';

/**
 * Opening an invitation somebody was emailed.
 *
 * THE ORDER MATTERS. What this page says first is who invited them and to what — before any mention
 * of signing in. Somebody arriving here followed a link from a friend; a sign-in wall that asks them
 * to prove who they are before it says what it is asking about is how an invitation reads as a
 * phishing attempt.
 *
 * Then, and only then, the sign-in — because a membership has to be keyed to a real agent, and the
 * card room will key it to whoever actually signs in rather than to the address the mail went to.
 * That is not a technicality: a forwarded invitation admits the person who opened it, which is the
 * only person a session can ever be about.
 */
export function JoinPage({
  clubId,
  token,
  session,
  auth,
  onLogin,
}: {
  clubId: string;
  token: string;
  session: AppSession | null;
  auth: AuthState;
  onLogin: (s: AppSession) => void;
}) {
  const [greeting, setGreeting] = useState<InviteGreeting | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [joined, setJoined] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .inviteGreeting(clubId, token)
      .then((g) => alive && setGreeting(g))
      // A token this club never sent is indistinguishable from one that expired long ago, and it has
      // to stay that way: guessing tokens must learn nothing, including whether a guess was close.
      .catch(() => alive && setGone('This invitation is not one we can find. Ask whoever sent it for a new link.'));
    return () => {
      alive = false;
    };
  }, [clubId, token]);

  const claim = useCallback(async () => {
    if (!session || claiming) return;
    setClaiming(true);
    setErr(null);
    try {
      await api.claimInvite(clubId, token, session.token);
      setJoined(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That invitation could not be accepted.');
    } finally {
      setClaiming(false);
    }
  }, [claiming, clubId, session, token]);

  // Signed in and the invitation is good: take it. Nobody wants a second button that says "yes,
  // really" after they already pressed the one in their email.
  useEffect(() => {
    if (session && greeting?.state === 'open' && !joined && !claiming && !err) void claim();
  }, [claim, claiming, err, greeting?.state, joined, session]);

  if (gone) {
    return (
      <Frame>
        <p>{gone}</p>
        <a className="small" href="#/">
          ← {PRODUCT_NAME}
        </a>
      </Frame>
    );
  }

  if (!greeting) {
    return (
      <Frame>
        <p className="hint">Reading the invitation…</p>
      </Frame>
    );
  }

  if (greeting.state !== 'open' && !joined) {
    return (
      <Frame title={`${greeting.invitedByName} invited you to ${greeting.clubName}`}>
        <p>
          {greeting.state === 'claimed'
            ? 'This invitation has already been used. If that was you, sign in and the club is in your list.'
            : 'This invitation has expired. Ask them to send another — they take a moment.'}
        </p>
        <a className="small" href="#/">
          ← {PRODUCT_NAME}
        </a>
      </Frame>
    );
  }

  if (joined) {
    return (
      <Frame title={`You are in ${greeting.clubName}`}>
        <p>
          {greeting.invitedByName} put you on the roster. {greeting.clubName}&rsquo;s tables are private to its members,
          and they are on its page.
        </p>
        {/* THE CLUB, not the front door. An invitation that lands somebody at a lobby which does not
            mention the club they were invited to has made them go and find it — and before clubs were
            a route there was nowhere to send them. */}
        <a className="small" href={clubHash(clubId)}>
          Go to {greeting.clubName} →
        </a>
      </Frame>
    );
  }

  return (
    <Frame title={`${greeting.invitedByName} invited you to ${greeting.clubName}`}>
      <p>
        {greeting.clubName} is a club at {PRODUCT_NAME}: a group who play together, at tables only its members can see.
        Sign in with your Home and you are on the roster.
      </p>
      {err ? <div className="form-error">{err}</div> : null}
      {session ? (
        <p className="hint">{claiming ? 'Joining…' : 'One moment…'}</p>
      ) : (
        <>
          {/* Coming back from a Home lands on the front door, so remember where they were standing —
              otherwise a person who signed in FROM an invitation arrives at a lobby that does not
              mention it and has to go back to their email for the link. */}
          <SignInPage auth={auth} onLogin={(s) => { rememberReturn(location.hash); onLogin(s); }} />
        </>
      )}
    </Frame>
  );
}

function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="panel join">
      <h2>{title ?? 'An invitation'}</h2>
      {children}
    </section>
  );
}
