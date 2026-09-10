import { useCallback, useEffect, useState } from 'react';
import type { AppSession, InviteGreeting } from '../lib/types';
import type { AuthState } from '../App';
import { ApiError, api } from '../lib/api';
import { PRODUCT_NAME } from '../lib/brand';
import { nightWhen, scheduleLine } from '../lib/nights';
import { gameBlurb, gameLabel } from '../lib/games';
import { MONEY_HASH, clubHash, rememberReturn } from '../lib/routes';
import { stakeStage } from '../lib/stake';
import type { TreasuryView } from '../lib/treasury';
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
        {/* THE THREE THINGS A NEW MEMBER NEEDS, in the order they need them: the nights in their own
            calendar, money to play with, and the club itself. Each is one press, here, rather than
            something to go and find. */}
        {session ? <Landed clubId={clubId} clubName={greeting.clubName} session={session} /> : null}
        {/* THE CLUB, not the front door. An invitation that lands somebody at a lobby which does not
            mention the club they were invited to has made them go and find it. */}
        <a className="small" href={clubHash(clubId)}>
          Go to {greeting.clubName} →
        </a>
      </Frame>
    );
  }

  return (
    <Frame title={`${greeting.invitedByName} invited you to ${greeting.clubName}`}>
      {/* WHAT THE INVITATION ACTUALLY SAYS lives here, not in the email. The Home composes the mail
          itself and takes only an address, a link and a name — and this is the better place for it
          anyway: mail clients strip formatting and block images, and this can show the real dates. */}
      <Pitch greeting={greeting} />
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

/**
 * WHAT A NEW MEMBER GETS, the moment they are on the roster.
 *
 * "Once they are in the system, send them a calendar invite that shows up in their calendar with a
 * link that takes them right into the game" — and the onboarding sets up their money.
 *
 * Both are offered HERE rather than left to be discovered, because this is the one moment somebody
 * is definitely looking. The calendar is a SUBSCRIPTION rather than a download: a club's nights
 * change, and eight events frozen at the moment of joining would be wrong within a month.
 */
function Landed({ clubId, clubName, session }: { clubId: string; clubName: string; session: AppSession }) {
  const [cal, setCal] = useState<{ url: string; webcal: string } | null>(null);
  const [stake, setStake] = useState<TreasuryView | null>(null);

  useEffect(() => {
    let alive = true;
    // Neither of these is allowed to fail the join. A calendar that cannot be published and money
    // that cannot be read are both reasons to show less, never reasons to undo a membership.
    void api.calendarUrl(clubId, session.token).then((c) => alive && setCal(c)).catch(() => undefined);
    void api.getTreasury(session.token).then((t) => alive && setStake(t)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [clubId, session.token]);

  const ready = stakeStage(stake) === 'ready';
  return (
    <div className="join-landed">
      {cal ? (
        <p>
          <a className="cta-quiet" href={cal.webcal}>
            Put {clubName}&rsquo;s nights in your calendar
          </a>
          <span className="hint"> — it keeps up with the club, and each night links straight to the game.</span>
        </p>
      ) : null}
      {stake && !ready ? (
        <p>
          <a className="cta-quiet" href={MONEY_HASH}>
            Set up your money
          </a>
          <span className="hint"> — an account of your own, and something to play with. It takes a few seconds.</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The club, as somebody who has never heard of it needs it: what the host says it is, when they meet,
 * the next few actual dates, and what is dealt.
 *
 * IN THE READER'S OWN TIME as well as the club's, whenever those differ. A Denver night at eight is
 * two in the morning in London, the next day — and somebody deciding whether to accept an invitation
 * is exactly the person who has not yet learned where the club is.
 */
function Pitch({ greeting }: { greeting: InviteGreeting }) {
  const now = Date.now();
  return (
    <>
      {greeting.welcome ? <p className="join-welcome">{greeting.welcome}</p> : null}
      <p>
        {greeting.clubName} is a club at {PRODUCT_NAME}: a group who play together, at tables only its members can see.
      </p>

      {greeting.meets ? <p className="join-meets">{scheduleLine(greeting.meets as never)}</p> : null}

      {greeting.nights && greeting.nights.length > 0 ? (
        <ul className="join-nights">
          {greeting.nights.map((n) => {
            const w = nightWhen(n, now);
            return (
              <li key={n.startsAt}>
                <strong>{w.day}</strong> at {w.time}
                {w.alsoYours ? <span className="hint"> — {w.alsoYours} where you are</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {greeting.games && greeting.games.length > 0 ? (
        <ul className="join-games">
          {greeting.games.map((g) => (
            <li key={g}>{gameBlurb(g) ?? gameLabel(g)}</li>
          ))}
        </ul>
      ) : null}

      {/* WHAT HAPPENS NEXT, said before they press anything. Signing in is the whole of joining, and
          the money is set up for them — a newcomer should not have to wonder what a treasury is. */}
      <p className="hint">
        Sign in with your Home and you are on the roster. There is no account to create: we set you up
        with an account of your own and money to play with, and the club’s nights go into your calendar.
      </p>
    </>
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
