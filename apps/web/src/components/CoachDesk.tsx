/**
 * THE ARRANGEMENT AND THE REVIEW — two sections the side panel's tabs mount, away from the mid-hand coach.
 *
 * The coach card used to hold all of it: the mode switch, the wait, the advice, the question box, the
 * adviser picker, the who's-who roster, the feed, and the review — "a lot of stuff is going on there",
 * and then, laid out one under the other, "it is just a running list of stuff". Mid-hand a person needs
 * exactly three things from that card: what to do, why, and how long the coach is taking. Everything
 * else is about the ARRANGEMENT or the PAST, and it lives here, behind a tab a person opens on purpose:
 *
 *   CoachSection   who advises you here (the house, your own agent, the coach it consults), how to
 *                  hire or change a coach — a ceremony at your Home.
 *   ReviewSection  how you have been playing over the last N days (seven unless you say), from the
 *                  hands recorded to your vault; and "send my past hands", so a coach hired today can
 *                  read the sessions before it.
 *
 * Nothing here is asked on a clock, and nothing here spends anybody's tokens until pressed.
 */
import { useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { api, ApiError, type CoachListing, type CoachReview } from '../lib/api';
import { startCoachHire, type AuthConfig } from '../lib/home';
import { Adviser } from './Coach';

const DAY_CHOICES = [1, 3, 7, 14, 30] as const;

type AdviserRef = { agentName: string; displayName: string } | null;

/** The voice a table hears, in words: "bob-coach.svc, via nathan.me", or the adviser alone, or nothing. */
export const voiceOf = (adviser: AdviserRef, coach: string | null): string | null =>
  adviser ? (coach ? `${coach}, via ${adviser.displayName}` : adviser.displayName) : null;

export function CoachSection({
  tableId,
  session,
  config,
  adviser,
  coach,
  onAdviserChanged,
  game = 'poker',
  pickAdviser = true,
}: {
  tableId: string;
  session: AppSession | null;
  config: AuthConfig | null;
  adviser: AdviserRef;
  /** The coach service the adviser last answered through, when one has. */
  coach: string | null;
  onAdviserChanged: (a: AdviserRef) => void;
  /** Which game's coaches are on offer, and which game's Home page hires them. */
  game?: 'poker' | 'canasta';
  /** Whether to mount the adviser picker here (the canasta coach panel carries its own). */
  pickAdviser?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [coaches, setCoaches] = useState<CoachListing[]>([]);
  const [hireable, setHireable] = useState(false);
  useEffect(() => {
    let alive = true;
    api.coaches(game).then((r) => { if (alive) { setCoaches(r.coaches); setHireable(r.hireable); } }).catch(() => {});
    return () => { alive = false; };
  }, [game]);
  const hire = async (name: string) => {
    if (!config || busy) return;
    setBusy(true); setErr(null);
    try {
      location.assign(await startCoachHire(config, name));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the hiring at your Home.');
      setBusy(false);
    }
  };
  const homeCoaches = config?.home.origin ? `${config.home.origin.replace(/\/$/, '')}/coaches?game=${game}` : null;

  return (
    <div className="side-section coach-section">
      {/* THE CHAIN, DRAWN: the table asks your agent; your agent consults the coach. One row per link, so
          "who is answering me?" is read off the picture rather than worked out from two names matching. */}
      <ol className="voice-chain" aria-label="Who advises you here">
        <li><span className="voice-role">table asks</span><strong>{adviser ? adviser.displayName : 'the house coach'}</strong><span className="hint">{adviser ? 'your own agent, at your Home' : 'one strategy, the same for everybody, free'}</span></li>
        {adviser ? (
          <li className={coach ? '' : 'missing'}>
            <span className="voice-role">it consults</span>
            <strong>{coach ?? 'no coach yet'}</strong>
            <span className="hint">{coach ? `reads your recorded ${game === 'canasta' ? 'rounds' : 'hands'} under a grant you signed · its tokens` : 'until you hire one, your agent says so and the house answers'}</span>
          </li>
        ) : null}
      </ol>

      {session && pickAdviser ? <Adviser tableId={tableId} session={session} game={game} adviser={adviser} onChanged={onAdviserChanged} /> : null}

      <div className="side-sub">
        <h3>{coach ? 'Change your coach' : 'Hire a coach'}</h3>
        <p className="hint">
          A coach is a service somebody runs. Hiring one happens at your Home, under Settings → Coaches: it names the coach
          in your agent's playbook and you sign a grant that lets the coach read the {game === 'canasta' ? 'rounds' : 'hands'} recorded to your vault — and
          nothing else. A coach knows one game: a hold’em coach is not a canasta coach. You can fire it there any time.
        </p>
        {coaches.length > 0 ? (
          <ul className="adviser-offers">
            {coaches.map((c) => (
              <li key={c.agentName}>
                <div className="adviser-offer">
                  <strong>{c.displayName}</strong>{c.displayName !== c.agentName ? <> <code>{c.agentName}</code></> : null}
                  <span className="who-tag agent">language model · its own tokens</span>
                  {c.description && c.description !== 'poker.advise' ? <span className="hint">{c.description}</span> : null}
                  {hireable && config ? <button type="button" className="link-button" disabled={busy} onClick={() => void hire(c.agentName)}>Hire from here</button> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {homeCoaches ? (
          <a className="button primary" href={homeCoaches} target="_blank" rel="noreferrer">
            {coach ? 'Manage coaches at my Home' : 'Choose a coach at my Home'}
          </a>
        ) : null}
        {err ? <div className="form-error">{err}</div> : null}
      </div>
    </div>
  );
}

export function ReviewSection({
  session,
  adviser,
  coach,
  mine = false,
  paused = false,
  myTurn = false,
  onHold,
  onWaiting,
  game = 'poker',
}: {
  session: AppSession | null;
  adviser: AdviserRef;
  coach: string | null;
  /** Which game's cabinet the review reads — the review skill, the coach and the records are all per game. */
  game?: 'poker' | 'canasta';
  /** This is the viewer's OWN practice table — the one place a review may hold the table while it runs. */
  mine?: boolean;
  paused?: boolean;
  myTurn?: boolean;
  /** Hold or release the table (a practice table's owner only). */
  onHold?: (held: boolean) => void;
  /** Tell the coach card a review is running, so the wait is shown loudly there too. */
  onWaiting?: (w: { what: 'review'; who: string } | null) => void;
}) {
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState<'review' | 'backfill' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<(CoachReview & { days: number }) | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const voice = voiceOf(adviser, coach);
  const unit = game === 'canasta' ? 'rounds' : 'hands';

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
      setReview(await api.reviewDays(days, '', session.token, game));
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
      const r = await api.backfillHands(days, session.token, game);
      setSent(r.note);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Your past hands could not be sent.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="side-section review-section">
      <h3>How have I been playing?</h3>
      <p className="hint">
        Your agent asks the coach you hired; the coach reads the {unit} the card room recorded to your vault — every
        table, not just this one — and answers with the count behind each leak and one thing to change.
      </p>
      <div className="desk-row">
        <label className="desk-days">
          Last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={busy != null}>
            {DAY_CHOICES.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
          </select>
        </label>
        <button type="button" className="primary" disabled={!session || !adviser || busy != null} onClick={() => void ask()} title={adviser ? undefined : 'Name your own agent as your adviser first'}>
          {busy === 'review' ? 'Reviewing…' : `Review my ${unit}${mine ? ' (holds the table)' : ''}`}
        </button>
      </div>
      {!adviser ? <p className="hint">Name your own agent {pickAdviserWords(game)} first — the house coach keeps no {unit}.</p> : null}
      {err ? <div className="form-error">{err}</div> : null}
      {review ? (
        <div className="coach-ask-answer coach-review">
          <p className="coach-say" style={{ whiteSpace: 'pre-line' }}>{review.say}</p>
          {review.because ? <p className="coach-why">Next session: {review.because}</p> : null}
          <p className="hint">— {review.source?.coach ? `${review.source.coach}, via ${review.source.displayName}` : review.source?.displayName ?? adviser?.displayName}, from your recorded {unit} of the last {review.days} day{review.days === 1 ? '' : 's'}</p>
        </div>
      ) : null}
      <details className="side-more">
        <summary>A coach hired today has not seen yesterday</summary>
        <p className="hint">Every {game === 'canasta' ? 'round' : 'hand'} you were dealt in that span, at every table here, sent to your own agent to keep — so the coach can read the sessions before it was hired.</p>
        <button type="button" disabled={!session || !adviser || busy != null} onClick={() => void backfill()}>
          {busy === 'backfill' ? 'Sending…' : `Send my last ${days === 1 ? 'day' : `${days} days`} of ${unit} to my agent`}
        </button>
        {sent ? <p className="hint desk-sent" role="status">{sent}</p> : null}
      </details>
    </div>
  );
}

const pickAdviserWords = (game: 'poker' | 'canasta'): string => (game === 'canasta' ? 'in the coach panel above' : 'under People');

/**
 * THE CANASTA COACH DESK — the arrangement and the review beside the canasta coach, in one panel. The canasta
 * coach panel carries its own adviser picker and who's-who; this adds what it lacks: which coach the agent
 * consults, how to hire or change one (per game — Carol's, not Bob's), and the review over the last N days
 * of recorded rounds. Reads the adviser from the table so the review knows whether there is anybody to ask.
 */
export function CanastaCoachDesk({
  tableId,
  session,
  config,
  mine = false,
  paused = false,
  myTurn = false,
  onHold,
}: {
  tableId: string;
  session: AppSession | null;
  config: AuthConfig | null;
  mine?: boolean;
  paused?: boolean;
  myTurn?: boolean;
  onHold?: (held: boolean) => void;
}) {
  const [adviser, setAdviser] = useState<AdviserRef>(null);
  const [coach, setCoach] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    api.getAdviser(tableId, session.token).then((r) => { if (alive) setAdviser(r.adviser); }).catch(() => {});
    api.coachStatus(session.token, 'canasta').then((r) => { if (alive) setCoach(r.coach); }).catch(() => {});
    return () => { alive = false; };
  }, [session, tableId]);
  return (
    <section className="panel desk">
      <h2>Your canasta coach</h2>
      <CoachSection tableId={tableId} session={session} config={config} adviser={adviser} coach={coach} onAdviserChanged={setAdviser} game="canasta" pickAdviser={false} />
      <ReviewSection session={session} adviser={adviser} coach={coach} mine={mine} paused={paused} myTurn={myTurn} onHold={onHold} game="canasta" />
    </section>
  );
}
