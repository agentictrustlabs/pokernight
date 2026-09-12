/**
 * THE COACH DESK — everything about WHO coaches you and HOW YOU HAVE BEEN PLAYING, in one panel,
 * away from the mid-hand coach.
 *
 * The coach panel used to hold all of it: the mode switch, the wait, the advice, the question box,
 * the adviser picker, the who's-who roster, the feed, and the review — "a lot of stuff is going on
 * there". Mid-hand a person needs exactly three things from that panel: what to do, why, and how
 * long the coach is taking. Everything else is about the ARRANGEMENT, not the hand, and it lives
 * here, in three sections a person opens on purpose:
 *
 *   YOUR COACH   who advises you here (the house, your own agent, the coach it consults), hire a
 *                coach — a ceremony at your Home — and who else is at the table.
 *   REVIEW       how you have been playing over the last N days (seven unless you say), from the
 *                hands recorded to your vault; and "send my past hands", so a coach hired today can
 *                read the sessions before it.
 *
 * Nothing here is asked on a clock, and nothing here spends anybody's tokens until pressed.
 */
import { useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { api, ApiError, type CoachListing, type CoachReview } from '../lib/api';
import { startCoachHire, type AuthConfig } from '../lib/home';
import { Adviser } from './Coach';
import { WhoIsWhoPanel } from './WhoIsWho';
import type { WhoIsWho as Roster } from '../lib/whoIsWho';

const DAY_CHOICES = [1, 3, 7, 14, 30] as const;

export function CoachDesk({
  tableId,
  session,
  config,
  adviser,
  coach,
  roster,
  mine = false,
  paused = false,
  myTurn = false,
  onHold,
  onAdviserChanged,
  onWaiting,
}: {
  tableId: string;
  session: AppSession | null;
  config: AuthConfig | null;
  adviser: { agentName: string; displayName: string } | null;
  /** The coach service the adviser last answered through, when one has. */
  coach: string | null;
  roster: Roster;
  /** This is the viewer's OWN practice table — the one place a review may hold the table while it runs. */
  mine?: boolean;
  paused?: boolean;
  myTurn?: boolean;
  /** Hold or release the table (a practice table's owner only). */
  onHold?: (held: boolean) => void;
  onAdviserChanged: (a: { agentName: string; displayName: string } | null) => void;
  /** Tell the coach panel a review is running, so the wait is shown loudly there too. */
  onWaiting?: (w: { what: 'review'; who: string } | null) => void;
}) {
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState<'review' | 'backfill' | 'hire' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<(CoachReview & { days: number }) | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [coaches, setCoaches] = useState<CoachListing[]>([]);
  const [hireable, setHireable] = useState(false);
  useEffect(() => {
    let alive = true;
    api.coaches().then((r) => { if (alive) { setCoaches(r.coaches); setHireable(r.hireable); } }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const voice = adviser ? (coach ? `${coach}, via ${adviser.displayName}` : adviser.displayName) : null;

  /**
   * A REVIEW TAKES A WHILE, AND THE CLOCK DOES NOT KNOW. At your own practice table the table is HELD for the
   * review and released after — a person reading a review must not be folded by the turn clock while they
   * read it. Anywhere else the table cannot be held for one person, so a review is refused while it is your
   * turn: ask between hands.
   */
  const ask = async () => {
    if (!session || busy) return;
    if (myTurn && !mine) { setErr('A review takes a while and it is your turn — ask between hands.'); return; }
    setBusy('review'); setErr(null);
    const held = mine && !paused && !!onHold;
    if (held) onHold!(true);
    onWaiting?.({ what: 'review', who: voice ?? 'your agent' });
    try {
      setReview(await api.reviewDays(days, '', session.token));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Your agent could not review your hands.');
    } finally {
      onWaiting?.(null);
      setBusy(null);
      if (held) onHold!(false); // released only if THIS review held it
    }
  };
  const backfill = async () => {
    if (!session || busy) return;
    setBusy('backfill'); setErr(null); setSent(null);
    try {
      const r = await api.backfillHands(days, session.token);
      setSent(r.note);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Your past hands could not be sent.');
    } finally {
      setBusy(null);
    }
  };
  const hire = async (name: string) => {
    if (!config || busy) return;
    setBusy('hire'); setErr(null);
    try {
      location.assign(await startCoachHire(config, name));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the hiring at your Home.');
      setBusy(null);
    }
  };

  return (
    <section className="panel desk">
      <h2>Your coach</h2>
      <p className="desk-who">
        {voice ? (
          <>
            Advised by <strong>{voice}</strong>
            {coach ? <span className="hint"> — your agent consults the coach you hired; the coach reads your recorded hands under a grant you signed.</span> : <span className="hint"> — no coach hired yet: your agent will say so and the house will answer.</span>}
          </>
        ) : (
          <>Advised by <strong>the house coach</strong><span className="hint"> — one strategy, the same for everybody, free.</span></>
        )}
      </p>

      {session ? <Adviser tableId={tableId} session={session} game="poker" adviser={adviser} onChanged={onAdviserChanged} /> : null}

      {coaches.length > 0 ? (
        <details className="desk-hire">
          <summary>Hire a coach</summary>
          <p className="hint">
            A coach is a service somebody runs. Hiring one happens at your Home: it names the coach in your agent's
            playbook and you sign a grant that lets the coach read the hands recorded to your vault — and nothing else.
            You can fire it there any time. Its tokens, not yours.
          </p>
          <ul className="adviser-offers">
            {coaches.map((c) => (
              <li key={c.agentName}>
                <button type="button" disabled={busy != null || !hireable || !config} onClick={() => void hire(c.agentName)} title={hireable ? `Hire ${c.displayName} at your Home` : 'Your Home does not offer coach hiring yet'}>
                  {c.displayName}
                  <code>{c.agentName}</code>
                  <span className="who-tag agent">language model · its own tokens</span>
                  <span className="hint">{c.description}</span>
                </button>
              </li>
            ))}
          </ul>
          {!hireable ? <p className="hint">Hiring from here is not switched on at this Home yet — a coach can still be bound at your Home.</p> : null}
        </details>
      ) : null}

      <details className="desk-who-is-who">
        <summary>Who’s who at this table</summary>
        <WhoIsWhoPanel roster={roster} />
      </details>

      <h2 className="desk-h2">Review</h2>
      <p className="hint">
        How have you been playing? Your agent asks the coach you hired; the coach reads the hands the card room
        recorded to your vault — every table, not just this one — and answers with the count behind each leak
        and one thing to change.
      </p>
      <div className="desk-row">
        <label className="desk-days">
          Last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={busy != null}>
            {DAY_CHOICES.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
          </select>
        </label>
        <button type="button" className="primary" disabled={!session || !adviser || busy != null} onClick={() => void ask()} title={adviser ? undefined : 'Name your own agent as your adviser first'}>
          {busy === 'review' ? 'Reviewing…' : `Review my hands${mine ? ' (holds the table)' : ''}`}
        </button>
        <button type="button" className="link-button" disabled={!session || !adviser || busy != null} onClick={() => void backfill()} title="Every hand you were dealt in that span, at every table here, sent to your own agent to keep — so a coach hired today can read them.">
          {busy === 'backfill' ? 'Sending…' : 'Send my past hands to my agent'}
        </button>
      </div>
      {!adviser ? <p className="hint">Name your own agent above first — the house coach keeps no hands.</p> : null}
      {sent ? <p className="hint desk-sent" role="status">{sent}</p> : null}
      {err ? <div className="form-error">{err}</div> : null}
      {review ? (
        <div className="coach-ask-answer coach-review">
          <p className="coach-say" style={{ whiteSpace: 'pre-line' }}>{review.say}</p>
          {review.because ? <p className="coach-why">Next session: {review.because}</p> : null}
          <p className="hint">— {review.source?.coach ? `${review.source.coach}, via ${review.source.displayName}` : review.source?.displayName ?? adviser?.displayName}, from your recorded hands of the last {review.days} day{review.days === 1 ? '' : 's'}</p>
        </div>
      ) : null}
    </section>
  );
}
