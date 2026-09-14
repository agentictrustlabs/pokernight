import { useCallback, useEffect, useState } from 'react';
import type { AppSession, ClubView, KnownPerson, Night } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { CHARTER_BLURB, canInvite, confirmsRetire, retireConsequences, standingLabel } from '../lib/clubs';
import { NameCheck, useNameCheck } from './NameCheck';
import { startClubCharter, startMembershipInvite, type AuthConfig } from '../lib/home';
import { shortAddress } from '../lib/format';
import { clubHash } from '../lib/routes';
import { downloadUrl, googleCalendarLink, nextNight } from '../lib/nights';
import { gameBlurb } from '../lib/games';
import { retiredLine } from '../lib/clubs';

/**
 * A CLUB, on its own page.
 *
 * A club is the group a poker night belongs to (`docs/WORKSPACES.md`). This was a panel stacked beside
 * the table list, with the club you were looking at held in the lobby's own `useState` — which meant a
 * club could not be linked to, did not survive a refresh, and was not a place an invitation could drop
 * somebody. It is a destination now (`#/clubs/<id>`), and this is what stands on it: who is in it,
 * whether it has an agent of its own, and — for a host — how to put somebody else in it.
 *
 * There is no list of clubs to browse and there never will be — a club you are not in is
 * indistinguishable from one that does not exist, so the only clubs anywhere are the ones you are in.
 * That is also why the card room needs no club directory: an invitation carries the club with it.
 */

/* ----------------------------------------------------------------- the roster */

export function Roster({
  view,
  session,
  config,
  tables,
  onChanged,
  onRetired,
}: {
  view: ClubView;
  session: AppSession;
  config: AuthConfig | null;
  /** How many tables this club has open, so closing it can say how many it closes. */
  tables: number;
  onChanged: () => void;
  /** What to do when this club has been closed — the page says so, because this panel is going. */
  onRetired: (line: string) => void;
}) {
  const host = canInvite(view.you.standing);
  /**
   * Why the last roster action did not happen.
   *
   * These all used to be `.catch(() => undefined)` on the reasoning that the roster is the record and
   * a refusal shows on the next read — which is true, and is not the same as telling somebody. What it
   * looked like from the outside was a button that did nothing: the list came back unchanged, with no
   * word about why, and the only way to tell a refusal from a slow network was to keep pressing.
   */
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="panel club-detail">
      {/* An h2, not an h3: this is a section of a page now rather than a block inside another panel,
          and a heading level that says otherwise is a lie to anybody reading with a screen reader. */}
      <h2>
        {view.name} <span className="club-role">{standingLabel(view.you.standing)}</span>
      </h2>
      <Welcome view={view} session={session} host={host} onChanged={onChanged} />
      <Calendar clubId={view.clubId} clubName={view.name} session={session} nights={view.nights} />
      <p className="hint club-agent">
        Its agent: <code className="mono" title={view.clubId}>{shortAddress(view.clubId)}</code> — at {host ? 'your' : "the host's"} Home; this card room acts as it.
      </p>
      {err ? <div className="form-error">{err}</div> : null}
      <ul className="club-roster">
        {view.roster.map((m) => (
          <li key={m.agent}>
            <span className="cr-name">{m.name}</span>
            {m.host ? <span className="tag">host</span> : null}
          </li>
        ))}
      </ul>
      {host ? <Invite view={view} session={session} config={config} onErr={setErr} /> : null}
      {/* WHAT A HOST DOES NEXT, said where they are standing.
          Opening a table lives in a folded panel below this one, and a host reading their roster and
          wondering how to actually play was reading the wrong panel with no way to know it. This is
          one line and a link to the thing, rather than a second copy of the form. */}
      {host ? (
        <p className="hint club-next">
          {view.roster.length < 2
            ? `Add someone else, then open a table — only ${view.name}'s members will see it.`
            : `Open a table for ${view.name} below. Its members find it on this page, and you can send them the table's link.`}
        </p>
      ) : null}
      {host ? <Retire view={view} session={session} tables={tables} onRetired={onRetired} /> : null}
    </section>
  );
}

/**
 * CLOSING THE CLUB — the host's own way out, folded shut and asking for the name back.
 *
 * Every other refusal about a host has been pointing here: a club, once made, could not be closed, so
 * a mistake or a group that stopped meeting stayed in its members' navigation for good.
 *
 * Three things make this safe enough to offer at all, and none of them is a confirm dialog:
 *
 *   it is FOLDED, so it is never the thing a hand lands on;
 *   the consequences are listed BEFORE the control, including the one nobody expects — the club's
 *   Smart Agent is not ours to remove and does not go;
 *   and the button does nothing until the club's own name is typed back, which is the difference
 *   between meaning to close THIS club and meaning to close something.
 */
function Retire({
  view,
  session,
  tables,
  onRetired,
}: {
  view: ClubView;
  session: AppSession;
  tables: number;
  /** Hand the outcome up: this component is about to stop existing. */
  onRetired: (line: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sure = confirmsRetire(typed, view.name);

  return (
    <details className="club-retire">
      <summary>Close {view.name}</summary>
      <ul className="club-retire-what">
        {retireConsequences(view.name, tables).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {err ? <div className="form-error">{err}</div> : null}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!sure || busy) return;
          setBusy(true);
          setErr(null);
          try {
            const result = await api.retireClub(view.clubId, session.token);
            // THE RECEIPT IS THE PAGE'S, NOT THIS COMPONENT'S. It lived here first, and it never
            // appeared: the page re-reads the club the moment anything changes, the club now answers
            // 404 — correctly — and the whole roster including this receipt was replaced by "not a
            // club you are in". Which is true, and is a terrible thing to say to somebody who has just
            // deliberately closed their own club.
            onRetired(retiredLine(result));
          } catch (ex) {
            // The one refusal a host will actually meet: somebody is still sitting at a table. The
            // card room names them, so this prints its sentence rather than inventing a shorter one.
            setErr(ex instanceof ApiError ? ex.message : 'The club could not be closed.');
            setBusy(false);
          }
        }}
      >
        <label>
          Type <strong>{view.name}</strong> to confirm
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={view.name} autoComplete="off" />
        </label>
        <button type="submit" className="danger" disabled={!sure || busy}>
          {busy ? 'Closing…' : `Close ${view.name} for good`}
        </button>
      </form>
    </details>
  );
}

/**
 * WHAT THE HOST WANTS SAID about their club — and it is not decoration.
 *
 * This text IS the invitation. The Home's mailer composes the email itself and accepts only an
 * address, a link and a name, so a host's own words cannot ride in the mail; what the link opens
 * carries them instead. So the editor says where the words will appear, because a host writing into a
 * box that does not say what it is for writes nothing.
 *
 * A member sees it too — it is what the club is, not a sales pitch aimed only at strangers.
 */
function Welcome({ view, session, host, onChanged }: { view: ClubView; session: AppSession; host: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(view.welcome ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editing) {
    if (!view.welcome && !host) return null;
    return (
      <div className="club-welcome">
        {view.welcome ? <p>{view.welcome}</p> : null}
        {host ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setText(view.welcome ?? '');
              setEditing(true);
            }}
          >
            {view.welcome ? 'Change what invitations say' : 'Say what this club is'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="club-welcome editing"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setErr(null);
        try {
          await api.setWelcome(view.clubId, text, session.token);
          setEditing(false);
          onChanged();
        } catch (ex) {
          setErr(ex instanceof ApiError ? ex.message : 'That could not be saved.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        What this club is
        <textarea
          value={text}
          maxLength={2000}
          rows={5}
          onChange={(e) => setText(e.target.value)}
          placeholder="We play most Thursdays, cards at eight, and there is always food. Newcomers welcome — half the table learned canasta here."
        />
      </label>
      <p className="hint">
        This is what an invitation says. Whoever opens the link reads it, above the dates and the games — so tell them
        what the evening is actually like.
      </p>
      {err ? <div className="form-error">{err}</div> : null}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link-button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The club's nights, in your own calendar.
 *
 * A SUBSCRIPTION, not a download. A club's nights change — one gets called off, the schedule moves —
 * and a handful of events frozen at the moment somebody pressed a button would be wrong within a
 * month, silently, in the one place they are trusting.
 *
 * `webcal:` is what makes a phone offer to subscribe rather than to import once. The https URL is
 * shown too, because that is the one that works when pasted into a desktop calendar.
 */
function Calendar({ clubId, clubName, session, nights }: { clubId: string; clubName: string; session: AppSession; nights: Night[] }) {
  const [cal, setCal] = useState<{ url: string; webcal: string } | null>(null);
  const [next, setNext] = useState<Night | null>(null);

  useEffect(() => {
    let alive = true;
    // A deployment that cannot publish calendars simply does not show this — better than a button
    // that leads to a 404 every time.
    void api
      .calendarUrl(clubId, session.token)
      .then((c) => alive && setCal(c))
      .catch(() => undefined);
    setNext(nextNight(nights, Date.now()));
    return () => {
      alive = false;
    };
  }, [clubId, session.token, nights]);

  if (!cal) return null;
  return (
    <details className="club-calendar">
      <summary>Put {clubName}&rsquo;s nights in your calendar</summary>

      {/* THE FAST WAYS FIRST, because they are the ones that answer "did that work?". */}
      {next ? (
        <p>
          <a
            className="cta-quiet"
            href={googleCalendarLink({
              startsAt: next.startsAt,
              title: next.title ?? clubName,
              url: `${location.origin}/${clubHash(clubId)}`,
              ...(next.game ? { details: gameBlurb(next.game) ?? '' } : {}),
            })}
            target="_blank"
            rel="noreferrer"
          >
            Add the next night to Google Calendar
          </a>
        </p>
      ) : null}
      <p>
        <a className="cta-quiet" href={downloadUrl(cal.url)}>
          Download the next {'8'} nights
        </a>
        <span className="hint"> — opens in any calendar, straight away.</span>
      </p>

      {/* AND THE ONE THAT KEEPS UP, with the caveat that is the whole reason somebody thinks this is
          broken: Google fetches a subscribed URL on its own schedule and ignores every refresh hint
          in the file. Saying so is the difference between a slow feature and a broken one. */}
      <p className="hint cal-keeps-up">
        To have it <strong>keep up</strong> with the club — nights added, moved or called off — subscribe instead:
      </p>
      <p>
        <a className="cta-quiet" href={cal.webcal}>
          Subscribe
        </a>
        <span className="hint"> — Apple Calendar and Outlook. Most desktop browsers do nothing with this; use the link below.</span>
      </p>
      <label>
        In Google Calendar, use <em>Other calendars → From URL</em> and paste this
        <input className="mono" readOnly value={cal.url} onFocus={(e) => e.currentTarget.select()} aria-label="calendar link" />
      </label>
      <p className="hint">
        Google fetches a subscribed calendar on its own schedule — often several hours before the first one appears, and it
        ignores how often this feed says to look. That is Google, not the card room; the two links above are instant.
      </p>
    </details>
  );
}

/**
 * The club's own Smart Agent, or the offer to give it one.
 *
 * A NAVIGATION, not a button that posts something — the Home is what deploys the agent and what
 * shows the host what they are agreeing to, and the card room never holds the club's key. That is
 * the same reason signing in and authorising a buy-in are navigations too.
 */
/**
 * INVITING SOMEBODY IS A CEREMONY AT THE HOST'S HOME, and this is the door to it.
 *
 * Membership lives at the Home: the host signs the person's access into the club's workspace there
 * (`workspace-member-invite`), their agent tells the person, and the person joins from the link it sent.
 * What this form does is turn what the host knows — `carol.me`, or an address — into the agent the
 * invitation names, on chain, and go. There is no email road: somebody without a Home gets one the
 * first time they sign in, and is invited by the name they took.
 */
function Invite({ view, session, config, onErr }: { view: ClubView; session: AppSession; config: AuthConfig | null; onErr: (e: string | null) => void }) {
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const here = new Set(view.roster.map((m) => m.agent));

  const invite = async (target: string) => {
    if (!config || busy) return;
    setBusy(true);
    onErr(null);
    try {
      const r = await api.resolveMember(view.clubId, target.trim(), session.token);
      if (here.has(r.agent.toLowerCase())) { onErr(`${r.name ?? target} is already a member of ${view.name}.`); return; }
      location.href = await startMembershipInvite(config, { clubId: view.clubId, name: view.name }, r.agent);
    } catch (ex) {
      onErr(ex instanceof ApiError ? ex.message : ex instanceof Error ? ex.message : 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="club-add">
      <KnownPeople session={session} roster={[...here]} busy={busy} onPick={(p) => void invite(p.agent)} />
      <form
        className="club-invite"
        onSubmit={(e) => {
          e.preventDefault();
          if (who.trim()) void invite(who);
        }}
      >
        <label>
          Invite someone
          <input type="text" value={who} onChange={(e) => setWho(e.target.value)} placeholder="carol.me, or a Smart Agent address" aria-describedby="invite-hint" />
        </label>
        <p className="hint" id="invite-hint">
          Their agent name or address. You will sign the invitation at your Home; your agent tells them, and they join from the link it sends.
        </p>
        <button type="submit" disabled={busy || !who.trim() || !config}>
          {busy ? 'Finding them…' : 'Invite at your Home'}
        </button>
      </form>
    </div>
  );
}

/**
 * The people this host already plays with, as one press each — the most common invitation there is,
 * and the one that should need no identifier: the card room reads them off the rosters of the host's
 * clubs, by the names those clubs' agents record them under.
 */
function KnownPeople({ session, roster, busy, onPick }: { session: AppSession; roster: string[]; busy: boolean; onPick: (p: KnownPerson) => void }) {
  const [people, setPeople] = useState<KnownPerson[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .knownPeople(session.token)
      .then((r) => alive && setPeople(r.people))
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, [session.token]);
  const here = new Set(roster);
  const offer = (people ?? []).filter((p) => !here.has(p.agent));
  if (offer.length === 0) return null;
  return (
    <div className="club-known">
      <p className="hint">People you already play with:</p>
      <ul className="known-list">
        {offer.map((p) => (
          <li key={p.agent}>
            <button type="button" className="known-add" disabled={busy} title={p.clubs.join(', ')} onClick={() => onPick(p)}>
              + {p.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * STARTING A CLUB is chartering its agent at your Home — the club IS that agent. The name typed here is
 * what the workspace is deployed under and what the club is founded as; the trip is two ceremonies at
 * the Home (charter, then authorising this card room to act as the club), and the return leg lands on
 * the club's page.
 */
export function StartClub({ config }: { config: AuthConfig | null }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // THE NAME IS CHECKED HERE, before the trip: a taken workspace name was a dead end at the Home's door.
  const check = useNameCheck(config, name, 'workspace');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !config) return;
    setBusy(true);
    setErr(null);
    try {
      location.href = await startClubCharter(config, { name: name.trim() });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'The club could not be started');
      setBusy(false);
    }
  };

  return (
    <form className="club-start" onSubmit={submit}>
      <label>
        Call it
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Thursday Night" maxLength={64} autoFocus />
      </label>
      <NameCheck check={check} what="club" />
      <p className="hint">{CHARTER_BLURB}</p>
      {err ? <div className="form-error">{err}</div> : null}
      <button className="primary" type="submit" disabled={busy || !name.trim() || !config || check.state === 'taken' || check.state === 'checking'}>
        {busy ? 'Off to your Home…' : 'Start it at your Home'}
      </button>
    </form>
  );
}
