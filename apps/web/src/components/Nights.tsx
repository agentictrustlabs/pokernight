import { useCallback, useEffect, useState } from 'react';
import type { AppSession, ClubSchedule, MissionVisitStatus, Night, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { nextNight, nightWhen, scheduleLine, type Recurrence } from '../lib/nights';
import { WEEKDAY_LABELS, WEEKDAY_ORDER } from '../lib/nightsForm';
import { BOARDS, DRAWN_GAME, gameBlurb, gameLabel } from '../lib/games';
import { MissionPicker } from './MissionPicker';
import { missionHash, newTableHash } from '../lib/routes';
import { Drawer } from './Drawer';

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
export function Nights({ clubId, session, host, schedule, nights, tables, onChanged }: { clubId: string; session: AppSession; host: boolean;
  /** From the club's own read — the rule and the nights derived from it — so this costs no second call. */
  schedule: ClubSchedule | null; nights: Night[];
  /** The club's live tables, so a night can list its own (`TableSummary.night`). */
  tables?: TableSummary[] | null;
  onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  /** THE NIGHT IN THE FLYOUT — its detail opens beside the page rather than pushing the list down it. */
  const [selected, setSelected] = useState<string | null>(null);
  const selectedNight = selected ? (nights ?? []).find((n) => n.nightId === selected) ?? null : null;
  // A change is read back from the club's agent by whoever owns the view; this only asks for it.
  const load = useCallback(async () => { setErr(null); onChanged(); }, [onChanged]);

  const now = Date.now();
  const next = nextNight(nights, now);
  const rest = (nights ?? []).filter((n) => n !== next && n.startsAt >= now);
  const tablesOf = (n: Night) => (tables ?? []).filter((t) => t.night === n.nightId);

  return (
    <section className="panel nights">
      <h2>Nights</h2>
      {err ? <div className="form-error">{err}</div> : null}

      {next ? (
        <NextNight night={next} now={now} tables={tablesOf(next)} onOpen={() => setSelected(next.nightId)} />
      ) : (
        <p className="hint">
          {/* Two different silences, and a member should not be told to fix the one they cannot. */}
          {schedule ? 'Nothing is coming up.' : host ? 'This club has no nights yet. Set when it meets, or add a one-time night, and they appear here.' : 'No nights are scheduled yet. A host sets them.'}
        </p>
      )}

      {rest.length > 0 ? (
        <ul className="night-list">
          {rest.map((n) => (
            <NightRow key={n.nightId} night={n} now={now} clubId={clubId} session={session} host={host} tables={tablesOf(n)} onChanged={load} onOpen={() => setSelected(n.nightId)} />
          ))}
        </ul>
      ) : null}

      {schedule ? <p className="hint night-rule">{scheduleLine(schedule as { startLocal: string; recurrence: Recurrence })}</p> : null}

      {/* THE STANDING GUEST of the series (docs/MISSION-REGISTRY.md §3): every night's, unless a night says
          otherwise. A host picks from the registry; a member sees who is coming. */}
      {schedule ? (
        <div className="night-guest">
          {host ? (
            <label className="row">
              <span>Guest every night</span>
              <MissionPicker
                value={schedule.defaults.mission?.entryId ?? null}
                onChange={async (entryId) => {
                  setErr(null);
                  try { await api.setScheduleGuest(clubId, entryId ?? null, session.token); } catch (e) { setErr(e instanceof ApiError ? e.message : 'The guest could not be named.'); }
                  void load();
                }}
              />
            </label>
          ) : schedule.defaults.mission ? (
            <p className="hint">Guest every night: <a href={missionHash(schedule.defaults.mission.entryId)}>♦ {schedule.defaults.mission.name}</a></p>
          ) : null}
        </div>
      ) : null}

      <Drawer open={!!selectedNight} title={selectedNight ? `${selectedNight.title ?? 'Night'} — ${nightWhen(selectedNight, now).day}` : ''} onClose={() => setSelected(null)}>
        {selectedNight ? <NightDetail night={selectedNight} clubId={clubId} session={session} host={host} tables={tablesOf(selectedNight)} onChanged={load} inherited={schedule?.defaults.mission ?? null} /> : null}
      </Drawer>

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
        ) : adding ? (
          <OneOffForm clubId={clubId} session={session} defaultGame={schedule?.defaults.game ?? DRAWN_GAME} defaultZone={schedule?.timezone} onDone={() => { setAdding(false); void load(); }} onCancel={() => setAdding(false)} />
        ) : (
          <div className="row">
            <button type="button" onClick={() => setEditing(true)}>
              {schedule ? 'Change when it meets' : 'Set when it meets'}
            </button>
            {/* A ONE-TIME NIGHT beside the series — an occasion the rule did not produce. */}
            <button type="button" onClick={() => setAdding(true)}>Add a one-time night</button>
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

/** The one a member actually came for, said as a sentence rather than shown as a row — with its guest and its tables. */
function NextNight({ night, now, tables, onOpen }: { night: Night; now: number; tables: TableSummary[]; onOpen: () => void }) {
  const w = nightWhen(night, now);
  return (
    <div className="next-night">
      <p className="next-when">
        <strong>{night.title ?? 'Next night'}</strong> — {w.day} at {w.time}
        <span className="tag">{w.phrase}</span>
        {night.game ? <span className="tag">{gameLabel(night.game)}</span> : null}
        {night.oneOff ? <span className="tag">one-time</span> : null}
      </p>
      {/* The reader's own clock, only when it says something different. */}
      {w.alsoYours ? <p className="hint">Where you are, that is {w.alsoYours}.</p> : null}
      <VisitLine night={night} tables={tables} onOpen={onOpen} />
    </div>
  );
}

/** One line: the guest and where the visit stands, how many tables, and the way into the night's detail. */
function VisitLine({ night, tables, onOpen }: { night: Night; tables: TableSummary[]; onOpen: () => void }) {
  const v = night.visit;
  return (
    <p className="night-visit-line">
      {v ? <><a className="tag guest" href={missionHash(v.mission.entryId)}>♦ {v.mission.name}</a> <span className="hint">{VISIT_WORDS[v.status]}{v.representative ? ` · ${v.representative.name} attending` : ''}</span></> : <span className="hint">No guest{night.oneOff ? '' : ' this night'}.</span>}
      {tables.length ? <span className="hint"> · {tables.length === 1 ? '1 table' : `${tables.length} tables`}</span> : null}
      <button type="button" className="link-button" onClick={onOpen}>Details</button>
    </p>
  );
}

/** What the picker shows for one night: `undefined` = the series' guest; `null` = none; else the entry id.
 *  A night whose guest equals the series' is read as inheriting, since the record says nothing for it. */
function nightGuestValue(night: Night, inherited: { entryId: string } | null | undefined): string | null | undefined {
  if (night.mission && inherited && night.mission.entryId === inherited.entryId && !night.visit?.representative) return undefined;
  if (!night.mission && !inherited) return undefined;
  return night.mission?.entryId ?? null;
}

const VISIT_WORDS: Record<MissionVisitStatus, string> = { invited: 'invited', confirmed: 'confirmed', declined: 'declined', attended: 'attended' };

/**
 * ONE NIGHT'S DETAIL — its visit and its tables (cr:ClubNight: cr:hasVisit, cr:hostsTable).
 *
 * The VISIT is the mission's participation in the night: which mission, who comes on its behalf, where it
 * stands. A host names the mission from the registry, writes the representative (a person, by name, with
 * how to reach them — the host's to keep) and moves the status; a member sees the mission and the name.
 * The TABLES are the night's own — any number, all of its one game — and the host opens another from here.
 */
function NightDetail({ night, clubId, session, host, tables, onChanged, inherited }: { night: Night; clubId: string; session: AppSession; host: boolean; tables: TableSummary[]; onChanged: () => void; inherited?: { entryId: string; name: string } | null }) {
  const v = night.visit;
  const off = night.status === 'cancelled' || night.status === 'skipped';
  // The representative form, host only, kept in local state until saved.
  const [repName, setRepName] = useState(v?.representative?.name ?? '');
  const [repEmail, setRepEmail] = useState(v?.representative?.email ?? '');
  const [repAgent, setRepAgent] = useState(v?.representative?.agent ?? '');
  const [status, setStatus] = useState<MissionVisitStatus>(v?.status ?? 'invited');
  const [note, setNote] = useState(v?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setRepName(v?.representative?.name ?? ''); setRepEmail(v?.representative?.email ?? ''); setRepAgent(v?.representative?.agent ?? ''); setStatus(v?.status ?? 'invited'); setNote(v?.note ?? ''); }, [v?.mission.entryId, v?.representative?.name, v?.representative?.email, v?.representative?.agent, v?.status, v?.note]);

  const save = async (patch: { entryId?: string | null; inherit?: boolean }) => {
    setBusy(true); setErr(null);
    try {
      const rep = repName.trim() ? { name: repName.trim(), ...(repEmail.trim() ? { email: repEmail.trim() } : {}), ...(repAgent.trim() ? { agent: repAgent.trim() } : {}) } : undefined;
      await api.setNightVisit(clubId, night.nightId, { ...patch, ...(patch.inherit || patch.entryId === null ? {} : { ...(rep ? { representative: rep } : {}), status, note }) }, session.token);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'The visit could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const w = nightWhen(night, Date.now());
  return (
    <div className="night-detail">
      <p className="night-visit-line">
        {night.game ? <span className="tag">{gameLabel(night.game)}</span> : null}
        <span className="hint">{w.day} at {w.time} · {w.phrase}</span>
        {v ? <><a className="tag guest" href={missionHash(v.mission.entryId)}>♦ {v.mission.name}</a> <span className="hint">{VISIT_WORDS[v.status]}{v.representative ? ` · ${v.representative.name}${v.representative.agent ? ` (${v.representative.agent})` : ''} attending` : ''}</span></> : <span className="hint">No guest.</span>}
      </p>
      {host && !off ? (
        <div className="night-visit-form">
          <label className="row">
            <span>Guest</span>
            <MissionPicker
              value={nightGuestValue(night, inherited)}
              allowInherit={!!inherited || !night.oneOff}
              inheritLabel={inherited ? `Series’ guest (${inherited.name})` : 'Series’ guest (none)'}
              onChange={(entryId) => void save(entryId === undefined ? { inherit: true } : { entryId })}
              disabled={busy}
            />
          </label>
          {v ? (
            <>
              <div className="pair">
                <label>Who is coming<input value={repName} onChange={(e) => setRepName(e.target.value)} placeholder="Dana Ruiz" /></label>
                <label>Their agent, if they have one<input value={repAgent} onChange={(e) => setRepAgent(e.target.value)} placeholder="dana.me" /></label>
              </div>
              <div className="pair">
                <label>Email<input value={repEmail} onChange={(e) => setRepEmail(e.target.value)} inputMode="email" placeholder="dana@hope.example" /><span className="hint">Yours to keep — members see the name only.</span></label>
                <label>Standing<select value={status} onChange={(e) => setStatus(e.target.value as MissionVisitStatus)}>{(Object.keys(VISIT_WORDS) as MissionVisitStatus[]).map((k) => <option key={k} value={k}>{VISIT_WORDS[k]}</option>)}</select></label>
              </div>
              <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What they will bring, what to introduce" maxLength={400} /></label>
              <div className="row"><button type="button" disabled={busy} onClick={() => void save({})}>{busy ? 'Saving…' : 'Save the visit'}</button></div>
            </>
          ) : null}
          {err ? <div className="form-error">{err}</div> : null}
        </div>
      ) : v?.note && host ? <p className="hint">{v.note}</p> : null}
      <div className="night-tables">
        {tables.length ? (
          <ul>
            {tables.map((t) => <li key={t.tableId}><a href={`#/t/${encodeURIComponent(t.tableId)}`}>{t.name}</a> <span className="hint">{t.seated}/{t.config.seats} seated{t.mission ? ` · ♦ ${t.mission.name}` : ''}</span></li>)}
          </ul>
        ) : <p className="hint">No tables open for this night yet.</p>}
        {host && !off ? <a className="button small" href={newTableHash(clubId, night.nightId)}>+ Open a table for this night</a> : null}
      </div>
    </div>
  );
}

function NightRow({ night, now, clubId, session, host, tables, onChanged, onOpen }: { night: Night; now: number; clubId: string; session: AppSession; host: boolean; tables: TableSummary[]; onChanged: () => void; onOpen: () => void }) {
  const w = nightWhen(night, now);
  const off = night.status === 'cancelled' || night.status === 'skipped';
  return (
    <li className={off ? 'night off' : 'night'}>
      <div className="night-head">
        <span className="night-when">{w.day} at {w.time}</span>
        {off ? <span className="tag">{night.status}</span> : <span className="hint">{w.phrase}</span>}
        {night.title ? <span className="hint">{night.title}</span> : null}
        {night.oneOff ? <span className="tag">one-time</span> : null}
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
      </div>
      {!off ? <VisitLine night={night} tables={tables} onOpen={onOpen} /> : null}
    </li>
  );
}

/** A ONE-TIME NIGHT: a date, a time, what it is called, what it plays. The zone comes from the series or the browser. */
function OneOffForm({ clubId, session, defaultGame, defaultZone, onDone, onCancel }: { clubId: string; session: AppSession; defaultGame: string; defaultZone?: string; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [zone, setZone] = useState(defaultZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
  const [title, setTitle] = useState('');
  const [game, setGame] = useState(defaultGame);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="schedule-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!date || busy) return;
        setBusy(true); setErr(null);
        try {
          await api.addNight(clubId, { localDate: date, startLocal: time, timezone: zone, ...(title.trim() ? { title: title.trim() } : {}), game }, session.token);
          onDone();
        } catch (ex) {
          setErr(ex instanceof ApiError ? ex.message : 'That night could not be added.');
          setBusy(false);
        }
      }}
    >
      <div className="pair">
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>At<input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
      </div>
      <label>What it is called<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Harvest night" maxLength={64} /></label>
      <label>
        What you play
        <select value={game} onChange={(e) => setGame(e.target.value)}>{BOARDS.map((g) => <option key={g} value={g}>{gameLabel(g)}</option>)}</select>
        <span className="hint">{gameBlurb(game)}</span>
      </label>
      <label>Time zone<input value={zone} onChange={(e) => setZone(e.target.value)} /></label>
      {err ? <div className="form-error">{err}</div> : null}
      <div className="row">
        <button className="primary" type="submit" disabled={busy || !date}>{busy ? 'Adding…' : 'Add the night'}</button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
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
  /**
   * WHICH GAME these nights deal.
   *
   * It was not asked, so nights carried no game, and an invitation could not say what was played —
   * which is the one thing somebody who has never been needs in order to decide. A club is not a
   * poker club: it can run either, and the answer belongs to the schedule rather than to the club.
   */
  const [game, setGame] = useState<string>(current?.defaults.game ?? DRAWN_GAME);
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
              defaults: { game, ...(current?.defaults.mission ? { mission: current.defaults.mission } : {}) },
            },
            session.token,
          );
          onDone();
        } catch (ex) {
          // The room names what it will not take — an unknown zone, a day that is not one — and
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
        What you play
        <select value={game} onChange={(e) => setGame(e.target.value)}>
          {BOARDS.map((g) => (
            <option key={g} value={g}>
              {gameLabel(g)}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{gameBlurb(game)}</p>
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
