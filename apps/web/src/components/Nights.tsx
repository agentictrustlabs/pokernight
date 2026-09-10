import { useCallback, useEffect, useState } from 'react';
import type { AppSession, ClubSchedule, Night } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { nextNight, nightWhen, scheduleLine, type Recurrence } from '../lib/nights';
import { WEEKDAY_LABELS, WEEKDAY_ORDER } from '../lib/nightsForm';

/**
 * WHEN THIS CLUB MEETS, on the club's page.
 *
 * It goes ABOVE the roster and below the tables, and the order is the point: a member came to find out
 * whether there is a game and when, not to read a list of names. So the next night is the first thing,
 * as a sentence rather than a row in a table.
 *
 * A night carries the CLUB's zone, and the reader may be somewhere else. `nightWhen` gives both and
 * the second only when they differ — see `lib/nights.ts` for why that is not optional.
 */
export function Nights({ clubId, session, host }: { clubId: string; session: AppSession; host: boolean }) {
  const [schedule, setSchedule] = useState<ClubSchedule | null>(null);
  const [nights, setNights] = useState<Night[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([api.getSchedule(clubId, session.token), api.getNights(clubId, session.token)]);
      setSchedule(s.schedule);
      setNights(n.nights);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not read this club’s nights.');
    }
  }, [clubId, session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const next = nextNight(nights, now);
  const rest = (nights ?? []).filter((n) => n !== next && n.startsAt >= now);

  return (
    <section className="panel nights">
      <h2>Nights</h2>
      {err ? <div className="form-error">{err}</div> : null}

      {next ? (
        <NextNight night={next} now={now} />
      ) : nights === null ? (
        <p className="hint">Reading…</p>
      ) : (
        <p className="hint">
          {/* Two different silences, and a member should not be told to fix the one they cannot. */}
          {schedule ? 'Nothing is coming up.' : host ? 'This club has no nights yet. Set when it meets and they appear here.' : 'No nights are scheduled yet. A host sets them.'}
        </p>
      )}

      {rest.length > 0 ? (
        <ul className="night-list">
          {rest.map((n) => (
            <NightRow key={n.nightId} night={n} now={now} clubId={clubId} session={session} host={host} onChanged={load} />
          ))}
        </ul>
      ) : null}

      {schedule ? <p className="hint night-rule">{scheduleLine(schedule as { startLocal: string; recurrence: Recurrence })}</p> : null}

      {host ? (
        editing ? (
          <ScheduleForm
            clubId={clubId}
            session={session}
            current={schedule}
            onDone={() => {
              setEditing(false);
              void load();
            }}
          />
        ) : (
          <div className="row">
            <button type="button" onClick={() => setEditing(true)}>
              {schedule ? 'Change when it meets' : 'Set when it meets'}
            </button>
            {schedule ? (
              <button
                type="button"
                className="link-button"
                onClick={async () => {
                  setErr(null);
                  try {
                    await api.clearSchedule(clubId, session.token);
                  } catch (e) {
                    setErr(e instanceof ApiError ? e.message : 'That could not be stopped.');
                  }
                  void load();
                }}
              >
                Stop meeting regularly
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}

/** The one a member actually came for, said as a sentence rather than shown as a row. */
function NextNight({ night, now }: { night: Night; now: number }) {
  const w = nightWhen(night, now);
  return (
    <div className="next-night">
      <p className="next-when">
        <strong>{night.title ?? 'Next night'}</strong> — {w.day} at {w.time}
        <span className="tag">{w.phrase}</span>
      </p>
      {/* The reader's own clock, only when it says something different. */}
      {w.alsoYours ? <p className="hint">Where you are, that is {w.alsoYours}.</p> : null}
    </div>
  );
}

function NightRow({
  night,
  now,
  clubId,
  session,
  host,
  onChanged,
}: {
  night: Night;
  now: number;
  clubId: string;
  session: AppSession;
  host: boolean;
  onChanged: () => void;
}) {
  const w = nightWhen(night, now);
  const off = night.status === 'cancelled' || night.status === 'skipped';
  return (
    <li className={off ? 'night off' : 'night'}>
      <span className="night-when">
        {w.day} at {w.time}
      </span>
      {off ? <span className="tag">{night.status}</span> : <span className="hint">{w.phrase}</span>}
      {night.reason ? <span className="hint">{night.reason}</span> : null}
      {host && !off ? (
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            // Called OFF, not taken out of the series: a host removing one occasion is telling the
            // people who were coming something, and `skip` is the quieter word for the other case.
            await api.cancelNight(clubId, night.nightId, {}, session.token).catch(() => undefined);
            onChanged();
          }}
        >
          Call it off
        </button>
      ) : null}
    </li>
  );
}

/**
 * Setting the rule.
 *
 * The zone is filled in from the BROWSER rather than asked for, because a host setting up their own
 * club's night is almost always in it — and a dropdown of four hundred IANA zones as the second field
 * of a form is how a two-question setup becomes a chore. It is shown, and it is editable.
 */
function ScheduleForm({
  clubId,
  session,
  current,
  onDone,
}: {
  clubId: string;
  session: AppSession;
  current: ClubSchedule | null;
  onDone: () => void;
}) {
  const [days, setDays] = useState<string[]>(() =>
    current?.recurrence.kind === 'weekly' ? [...current.recurrence.weekdays] : ['thu'],
  );
  const [time, setTime] = useState(current?.startLocal ?? '20:00');
  const [interval, setInterval] = useState<1 | 2>(current?.recurrence.kind === 'weekly' && current.recurrence.interval === 2 ? 2 : 1);
  const [zone, setZone] = useState(current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (d: string) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  return (
    <form
      className="schedule-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (days.length === 0 || busy) return;
        setBusy(true);
        setErr(null);
        try {
          await api.setSchedule(
            clubId,
            {
              startLocal: time,
              timezone: zone,
              recurrence: { kind: 'weekly', weekdays: days as never, ...(interval === 2 ? { interval: 2 as const } : {}) },
              defaults: {},
            },
            session.token,
          );
          onDone();
        } catch (ex) {
          // The card room names what it will not take — an unknown zone, a day that is not one — and
          // those sentences are more use here than a generic failure.
          setErr(ex instanceof ApiError ? ex.message : 'That schedule could not be saved.');
          setBusy(false);
        }
      }}
    >
      <fieldset className="days">
        <legend>Which days</legend>
        {WEEKDAY_ORDER.map((d) => (
          <label key={d} className={days.includes(d) ? 'day on' : 'day'}>
            <input type="checkbox" checked={days.includes(d)} onChange={() => toggle(d)} />
            {WEEKDAY_LABELS[d]}
          </label>
        ))}
      </fieldset>
      <div className="pair">
        <label>
          At
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label>
          How often
          <select value={interval} onChange={(e) => setInterval(Number(e.target.value) === 2 ? 2 : 1)}>
            <option value={1}>Every week</option>
            <option value={2}>Every other week</option>
          </select>
        </label>
      </div>
      <label>
        Time zone
        <input type="text" value={zone} onChange={(e) => setZone(e.target.value)} />
      </label>
      <p className="hint">
        The time is local to the club, so the game stays at {time || 'the same hour'} when the clocks change.
      </p>
      {err ? <div className="form-error">{err}</div> : null}
      <div className="row">
        <button className="primary" type="submit" disabled={busy || days.length === 0}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link-button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
