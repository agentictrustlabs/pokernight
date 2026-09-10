import { useCallback, useEffect, useState } from 'react';
import type { AppSession, ClubInvite, ClubView, KnownPerson } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { CHARTER_BLURB, canInvite, charterState, checkMember, confirmsRetire, memberAction, retireConsequences, standingLabel } from '../lib/clubs';
import { startClubCharter, type AuthConfig } from '../lib/home';
import { shortAddress } from '../lib/format';
import { TABLES_HASH } from '../lib/routes';
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
}: {
  view: ClubView;
  session: AppSession;
  config: AuthConfig | null;
  /** How many tables this club has open, so closing it can say how many it closes. */
  tables: number;
  onChanged: () => void;
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
      <Charter view={view} config={config} />
      {err ? <div className="form-error">{err}</div> : null}
      <ul className="club-roster">
        {view.roster.map((m) => (
          <li key={m.member}>
            <span className="cr-name">{m.name}</span>
            {m.class === 'guest' ? <span className="tag">guest</span> : null}
            {m.member === view.createdBy ? <span className="tag">host</span> : null}
            {host && m.member !== view.createdBy ? (
              <button
                type="button"
                className="link-button"
                onClick={async () => {
                  setErr(null);
                  try {
                    await api.removeMember(view.clubId, m.member, session.token);
                  } catch (e) {
                    // The card room names its refusals — "the person who started a club cannot be
                    // removed from it" is a useful sentence and this used to eat it.
                    setErr(e instanceof ApiError ? e.message : `${m.name} could not be removed.`);
                  }
                  onChanged();
                }}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {host ? <Invite clubId={view.clubId} session={session} roster={view.roster.map((m) => m.member)} onAdded={onChanged} /> : null}
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
      {host ? <Retire view={view} session={session} tables={tables} onChanged={onChanged} /> : null}
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
  onChanged,
}: {
  view: ClubView;
  session: AppSession;
  tables: number;
  onChanged: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** What the card room did, once it has done it. */
  const [done, setDone] = useState<string | null>(null);

  // AFTERWARDS, SAID HERE. The obvious alternative was to navigate away carrying the sentence in the
  // URL, which puts prose in the address bar and in the back button. This page cannot re-read the club
  // — it answers 404 now, correctly — so it stops being a club page and becomes the receipt.
  if (done) {
    return (
      <div className="club-retire done">
        <p>{done}</p>
        <a className="small" href={TABLES_HASH}>
          See what is running →
        </a>
      </div>
    );
  }

  const sure = confirmsRetire(typed, view.name);

  return (
    <details className="club-retire">
      <summary>Close {view.name}</summary>
      <ul className="club-retire-what">
        {retireConsequences(view.name, tables, view.agent).map((line) => (
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
            setDone(retiredLine(result));
            // The rail is holding a club that is gone; it has to be told before somebody presses it.
            onChanged();
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
 * The club's own Smart Agent, or the offer to give it one.
 *
 * A NAVIGATION, not a button that posts something — the Home is what deploys the agent and what
 * shows the host what they are agreeing to, and the card room never holds the club's key. That is
 * the same reason signing in and authorising a buy-in are navigations too.
 */
function Charter({ view, config }: { view: ClubView; config: AuthConfig | null }) {
  const [err, setErr] = useState<string | null>(null);
  const state = charterState(view, Boolean(config?.home.clubTemplate));
  if (state.kind === 'hidden') return null;
  if (state.kind === 'chartered') {
    return (
      <p className="hint club-agent">
        Its own agent: <code className="mono" title={state.agent}>{shortAddress(state.agent)}</code>
      </p>
    );
  }
  if (state.kind === 'unavailable') {
    return <p className="hint">This card room cannot charter clubs yet, so this one lives here and nowhere else.</p>;
  }
  return (
    <div className="club-charter">
      <p className="hint">{CHARTER_BLURB}</p>
      {err ? <div className="form-error">{err}</div> : null}
      <button
        type="button"
        onClick={async () => {
          if (!config) return;
          try {
            location.href = await startClubCharter(config, { clubId: view.clubId, name: view.name });
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'The charter could not be started.');
          }
        }}
      >
        Charter it at your Home
      </button>
    </div>
  );
}

/**
 * Adding somebody — by whatever the host actually knows about them.
 *
 * THIS FORM USED TO TAKE ONE THING: a forty-character Smart Agent address, which is the identifier a
 * host is least likely to have and cannot ask a friend for without explaining what it is. Everything
 * here exists to undo that. There are three roads in, and the field decides which one it is on from
 * what has been typed rather than making the host choose a mode first:
 *
 *   a name  (`carol.me`)          the card room resolves it on chain — on the roster at once
 *   an address or player id       on the roster at once, as before
 *   an email                      an invitation, mailed by the host's Home; a membership when the
 *                                 person opens it and signs in
 *
 * And above the field, the shortest road of all: the people this host ALREADY PLAYS WITH, who the
 * card room can name because a host named them once already.
 */
function Invite({
  clubId,
  session,
  roster,
  onAdded,
}: {
  clubId: string;
  session: AppSession;
  /** Who is already here, so the picker never offers somebody the club would refuse. */
  roster: string[];
  onAdded: () => void;
}) {
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** What the last send did, when it needs saying: a link to pass on, or mail that did go. */
  const [sent, setSent] = useState<{ joinUrl: string; email: string; delivery: string; why?: string } | null>(null);
  const check = checkMember(who);
  const action = memberAction(who);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who.trim() || !check.ok || busy) return;
    setBusy(true);
    setErr(null);
    setSent(null);
    try {
      if (check.shape === 'email') {
        const res = await api.inviteByEmail(clubId, who.trim(), name.trim() || undefined, session.token);
        setSent({ joinUrl: res.joinUrl, email: res.invite.email, delivery: res.delivery, ...(res.deliveryError ? { why: res.deliveryError } : {}) });
      } else {
        await api.inviteMember(clubId, who.trim(), name.trim() || undefined, session.token);
      }
      setWho('');
      setName('');
      onAdded();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="club-add">
      <KnownPeople clubId={clubId} session={session} roster={roster} onAdded={onAdded} />
      <form className="club-invite" onSubmit={submit}>
        <label>
          Add someone
          <input
            type="text"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="carol.me, or an email address"
            aria-invalid={!check.ok}
            aria-describedby="invite-hint"
          />
        </label>
        <label>
          What to call them
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marcus" />
        </label>
        {/* One line, always present, saying what the button will do with what has been typed. The
            two roads have different consequences and the host should know which one they are on. */}
        <p className={check.ok ? 'hint' : 'hint invite-bad'} id="invite-hint">
          {check.ok ? action.hint : check.hint}
        </p>
        {err ? <div className="form-error">{err}</div> : null}
        <button type="submit" disabled={busy || !who.trim() || !check.ok}>
          {busy ? 'Sending…' : action.label}
        </button>
      </form>
      {sent ? <Sent sent={sent} /> : null}
      <PendingInvites clubId={clubId} session={session} refreshOn={sent?.joinUrl ?? ''} />
    </div>
  );
}

/**
 * What happened to an invitation that was just sent.
 *
 * THE LINK IS ALWAYS SHOWN, including when the mail went out. A host who wants to send it in a group
 * chat instead should not have to go and find it, and a host whose Home has no mailer must not be
 * left thinking an invitation vanished. `delivery` says which of those happened, in the Home's own
 * words rather than a guess.
 */
function Sent({ sent }: { sent: { joinUrl: string; email: string; delivery: string; why?: string } }) {
  const mailed = sent.delivery === 'sent';
  return (
    <div className="club-sent">
      <p className="hint">
        {mailed
          ? `Invitation sent to ${sent.email}. It is good for two weeks.`
          : `The invitation is open for ${sent.email}, but nothing was emailed${sent.why ? ` — ${sent.why}` : ''}. Send them this link yourself:`}
      </p>
      <input className="mono" readOnly value={sent.joinUrl} onFocus={(e) => e.currentTarget.select()} aria-label="invitation link" />
    </div>
  );
}

/**
 * The people this host already plays with, as one press each.
 *
 * The most common invitation there is — "the three of them from Tuesday" — and the one that should
 * need no identifier at all, because the card room already knows these people by the name a host
 * typed for them once. Anybody already on THIS club's roster is not offered.
 */
function KnownPeople({
  clubId,
  session,
  roster,
  onAdded,
}: {
  clubId: string;
  session: AppSession;
  roster: string[];
  onAdded: () => void;
}) {
  const [people, setPeople] = useState<KnownPerson[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Why the last one-press add did not take. It used to be swallowed, so the chip simply stayed. */
  const [addErr, setAddErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .knownPeople(session.token)
      .then((r) => alive && setPeople(r.people))
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, [session.token, clubId]);

  const here = new Set(roster);
  const offer = (people ?? []).filter((p) => !here.has(p.member));
  if (offer.length === 0) return null;

  return (
    <div className="club-known">
      <p className="hint">People you already play with:</p>
      <ul className="known-list">
        {offer.map((p) => (
          <li key={p.member}>
            <button
              type="button"
              className="known-add"
              disabled={busy !== null}
              title={p.clubs.join(', ')}
              onClick={async () => {
                setBusy(p.member);
                try {
                  await api.inviteMember(clubId, p.member, p.name, session.token);
                  setPeople((cur) => (cur ?? []).filter((q) => q.member !== p.member));
                  onAdded();
                } catch (e) {
                  setAddErr(e instanceof ApiError ? e.message : `${p.name} could not be added.`);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === p.member ? 'Adding…' : `+ ${p.name}`}
            </button>
          </li>
        ))}
      </ul>
      {addErr ? <div className="form-error">{addErr}</div> : null}
    </div>
  );
}

/**
 * Invitations sent and not yet opened.
 *
 * A club with an outstanding invitation is in a real state that the roster does not show, and a host
 * who cannot see it will send a second one. Claimed invitations are not listed: those people are on
 * the roster, which is where a member belongs.
 */
function PendingInvites({ clubId, session, refreshOn }: { clubId: string; session: AppSession; refreshOn: string }) {
  const [invites, setInvites] = useState<ClubInvite[] | null>(null);
  /** Why taking one back did not work. Silence here reads as "it worked", and the list is unchanged. */
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvites((await api.listInvites(clubId, session.token)).invites);
    } catch {
      setInvites([]);
    }
  }, [clubId, session.token]);

  useEffect(() => {
    void load();
  }, [load, refreshOn]);

  const open = (invites ?? []).filter((i) => !i.claimedBy && i.expiresAt > Date.now());
  if (open.length === 0) return null;

  return (
    <div className="club-pending">
      <p className="hint">Waiting to be opened:</p>
      {err ? <div className="form-error">{err}</div> : null}
      <ul className="pending-list">
        {open.map((i) => (
          <li key={i.token}>
            <span className="cr-name">{i.name ?? i.email}</span>
            <span className="hint">{i.name ? i.email : ''}</span>
            <button
              type="button"
              className="link-button"
              onClick={async () => {
                setErr(null);
                try {
                  await api.revokeInvite(clubId, i.token, session.token);
                } catch (e) {
                  setErr(e instanceof ApiError ? e.message : `That invitation could not be taken back.`);
                }
                void load();
              }}
            >
              Take back
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- starting one */

/**
 * The form that starts a club: a name, and that is all.
 *
 * It was a folded `<details>` beside the table list. It is bare now, because it stands on a page of its
 * own (`#/clubs/new`) that says what a club is — a form carrying its own explanation twice reads as two
 * different explanations.
 */
export function StartClub({ session, onStarted }: { session: AppSession; onStarted: (c: { clubId: string }) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const club = await api.createClub(name.trim(), session.token);
      setName('');
      onStarted(club);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'The club could not be started');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="club-start" onSubmit={submit}>
      <label>
        Call it
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Thursday Night" maxLength={64} autoFocus />
      </label>
      {err ? <div className="form-error">{err}</div> : null}
      <button className="primary" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Starting…' : 'Start it'}
      </button>
    </form>
  );
}
