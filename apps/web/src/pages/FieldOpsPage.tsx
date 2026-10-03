/**
 * A SEASON OF FIELD OPERATIONS — the page (docs/FIELD-OPERATIONS.md §7).
 *
 * The commission page's shape — the whole window, two height-bounded columns, the activity in the middle, your part
 * on the side — because it is the same kind of place. What differs is what there is to look at: a season is WORK ON
 * A MAP, so the main column leads with the field drawn (corridors, towns, roads, every worker where they stand, every
 * circle and church the season has founded, and an act lighting its town as it happens), then THE BOARD — each
 * community with the registry's floor, the phase the records derive, the steward's reading and the counters that
 * make them — then the ACTIVITY, newest last, with filters. The side is YOUR DAY: the one act you may spend, drawn
 * from the engine's own `may` list; then the teams and where everybody is; then THE AGENT REPORT, because the season
 * is a test of the agents and the tally should be on the screen while it runs.
 *
 * NO HOOK AFTER AN EARLY RETURN — every hook in this file is above the first `return`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldOpsAction, FieldOpsEvent, FieldOpsView, PhaseN, ViewBody, ViewCommunity, ViewPerson } from '@pokernight/fieldops';
import { PHASE_NAMES, PHASE_SHORT } from '@pokernight/fieldops';
import type { AppSession } from '../lib/types';
import { fieldOpsApi, type FieldOpsAgentRow, type FieldOpsSummary } from '../lib/api';
import { FieldOpsSocket, type FieldOpsClientState } from '../lib/fieldOpsSocket';
import { HOME_HASH } from '../lib/routes';
import { Face } from '../components/mystery/Face';
import type { Look as MysteryLook } from '@pokernight/mystery';
import { FieldMap, pulseOf, type MapPulse } from '../components/fieldops/FieldMap';
import { Identity } from '../components/Identity';
import { Brand } from '../components/Brand';

const FIELD_APP = 'https://field.faithnet.io/';

function useSeason(stagingId: string, token: string | null): { state: FieldOpsClientState; sock: FieldOpsSocket | null } {
  const [, bump] = useState(0);
  const ref = useRef<FieldOpsSocket | null>(null);
  useEffect(() => {
    if (!token) return;
    const s = new FieldOpsSocket(stagingId, token, () => bump((n) => n + 1));
    ref.current = s;
    return () => { s.close(); ref.current = null; };
  }, [stagingId, token]);
  return { state: ref.current?.state ?? { view: null, staging: null, agents: [], connection: 'connecting', error: null }, sock: ref.current };
}

export function FieldOpsPage({ stagingId, session, onSignOut }: { stagingId: string; session: AppSession | null; onSignOut: () => void }) {
  const { state, sock } = useSeason(stagingId, session?.token ?? null);
  const [busy, setBusy] = useState(false);
  const [selectedTown, setSelectedTown] = useState<string | null>(null);
  const [whisperTo, setWhisperTo] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'team' | 'town' | 'readings' | 'talk' | 'mine'>('all');
  const view = state.view;
  const staging = state.staging;
  const isHost = !!session && !!staging && staging.host === session.playerId;
  // The map's pulses: every act since the page opened, kept for a couple of seconds each.
  const seenRef = useRef<number>(0);
  const [pulses, setPulses] = useState<MapPulse[]>([]);
  useEffect(() => {
    if (!view) return;
    const fresh = view.transcript.filter((e) => e.at > seenRef.current).map(pulseOf).filter((p): p is MapPulse => !!p);
    if (view.transcript.length) seenRef.current = Math.max(seenRef.current, view.transcript[view.transcript.length - 1]!.at);
    if (fresh.length) setPulses((ps) => [...ps.filter((p) => Date.now() - p.at < 2200), ...fresh.map((p) => ({ ...p, at: Date.now() }))]);
  }, [view?.transcript.length]);
  const again = async () => {
    if (!session || !view) return;
    setBusy(true);
    try { await fieldOpsApi.solo({ scenario: view.scenario, role: view.you?.role ?? (staging?.role === 'watch' ? 'watch' : undefined), restart: true }, session.token); } finally { setBusy(false); }
  };
  // THE PERSON IS HERE: their own pointer, key, wheel or touch, told to the season at most once a minute. A part's
  // acts already count; a watcher has none, and without this the sixteen agents would stop twenty minutes in.
  useEffect(() => {
    if (!sock) return;
    let last = 0;
    const on = () => { const now = Date.now(); if (now - last > 60_000) { last = now; sock.attend(); } };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of evs) window.addEventListener(e, on, { passive: true });
    return () => { for (const e of evs) window.removeEventListener(e, on); };
  }, [sock]);
  const act = (a: unknown) => sock?.act(a);
  const label = useMemo(() => (view ? (view.phase === 'closing' ? 'The closing' : view.phase === 'revealed' ? 'The reveal' : view.phase === 'interlude' ? `End of week ${view.week}` : `Day ${view.day} · week ${view.week}, ${view.weekName}`) : ''), [view]);

  if (!session) return <div className="page"><section className="panel"><p className="hint">Sign in to come to the field.</p></section></div>;
  if (!view) return <div className="page"><section className="panel"><p className="hint">{state.error ?? (state.connection === 'reconnecting' ? 'Reconnecting…' : 'Driving out…')}</p></section></div>;

  return (
    <div className="mystery gc fo">
      <header className="topbar">
        <Brand />
        <span className="tag">{view.scenarioName}</span>
        <span className="tag">{label}</span>
        <Clock deadline={view.deadline} paused={!!staging?.paused} />
        {isHost && view.phase !== 'revealed' ? (
          <button type="button" onClick={() => sock?.pause(!staging?.paused)}>{staging?.paused ? 'Resume the season' : 'Hold the season'}</button>
        ) : staging?.paused ? <span className="tag">held by your host</span> : null}
        <span className="spacer" />
        <a href={HOME_HASH}>← Play</a>
        <Identity session={session} onSignOut={onSignOut} />
      </header>
      {state.error ? <div className="form-error">{state.error}</div> : null}
      <div className="page mystery-page gc-page fo-page">
        <main className="mystery-main">
          <section className="panel fo-map-wrap">
            <FieldMap view={view} selected={selectedTown} onTown={(t) => setSelectedTown((cur) => (cur === t ? null : t))} onPerson={(r) => setWhisperTo((cur) => (cur === r ? null : r))} pulses={pulses} />
            <DayStrip view={view} />
          </section>
          <Board view={view} selectedTown={selectedTown} onTown={(t) => setSelectedTown((cur) => (cur === t ? null : t))} />
          <Activity view={view} filter={filter} setFilter={setFilter} selectedTown={selectedTown} act={act} whisperTo={whisperTo} setWhisperTo={setWhisperTo} />
        </main>
        <aside className="mystery-side">
          {view.reveal ? <Reveal view={view} staging={staging} agents={state.agents} onAgain={again} busy={busy} /> : null}
          <YourDay view={view} act={act} selectedTown={selectedTown} />
          <Teams view={view} onPerson={(r) => setWhisperTo((cur) => (cur === r ? null : r))} whisperTo={whisperTo} charters={staging?.charters ?? []} />
          <AgentReport view={view} agents={state.agents} />
          <Partners view={view} />
          <Estate staging={staging} isHost={isHost} stagingId={stagingId} token={session.token} />
        </aside>
      </div>
    </div>
  );
}

function Clock({ deadline, paused }: { deadline: number | null; paused: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (deadline === null) return <span className="num mystery-clock">—</span>;
  const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  return <span className="num mystery-clock" title={paused ? 'held' : 'until the day ends'}>{paused ? '⏸ ' : ''}{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>;
}

/** The season's calendar as a strip: six weeks of seven days, today lit, the weeks' names over them. */
function DayStrip({ view }: { view: FieldOpsView }) {
  const total = view.weeks * view.daysPerWeek;
  return (
    <div className="fo-days" title={`Day ${view.day} of ${total}`}>
      {Array.from({ length: total }, (_, i) => i + 1).map((d) => (
        <span key={d} className={`fo-day${d < view.day ? ' past' : d === view.day ? ' today' : ''}${d % view.daysPerWeek === 0 ? ' week-end' : ''}`} />
      ))}
      <span className="fo-days-label">{view.weekName} · {view.objective}</span>
    </div>
  );
}

/** THE BOARD — every community with the registry's floor, the derived phase, the reading and the counters. */
function Board({ view, selectedTown, onTown }: { view: FieldOpsView; selectedTown: string | null; onTown: (t: string) => void }) {
  const townName = (id: string) => view.towns.find((t) => t.id === id)?.name ?? id;
  return (
    <section className="panel gc-board fo-board">
      <header>
        <h3>The board · {view.regionName}</h3>
        <span className="hint">the registry's floor, read {view.registryReadAt.slice(0, 10)} · the phase the records derive · the steward's reading</span>
      </header>
      {view.trail.length ? (
        <ul className="fo-road" aria-label="What the road has brought">
          {view.trail.map((t) => <li key={`${t.id}-${t.day}-${t.target}`} className={`fo-road-${t.kind}`} title={`day ${t.day} · until day ${t.until}`}><strong>{t.kind}</strong> · {t.text}</li>)}
        </ul>
      ) : null}
      <div className="fo-corridors">
        {view.corridors.map((c) => (
          <div key={c.id} className={`fo-corridor fo-${c.id}`}>
            <h4>{c.name} <span className="muted small">· {view.teams.filter((t) => t.corridor === c.id).map((t) => t.name).join(', ') || 'no team yet'}</span></h4>
            <ul className="fo-communities">
              {view.communities.filter((x) => x.corridor === c.id).map((x) => <CommunityRow key={x.id} c={x} view={view} dim={!!selectedTown && !x.towns.includes(selectedTown)} onTown={onTown} townName={townName} />)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function PhaseGauge({ floor, derived, published }: { floor: PhaseN; derived: PhaseN; published: PhaseN | null }) {
  return (
    <span className="fo-gauge" title={`registry ${floor} · records ${derived}${published !== null ? ` · published ${published}` : ''}`}>
      {([0, 1, 2, 3, 4, 5, 6, 7] as PhaseN[]).map((p) => (
        <span key={p} className={`fo-gauge-cell${p <= derived ? ' on' : ''}${p === floor ? ' floor' : ''}${published === p ? ' published' : ''}`} title={`P${p} ${PHASE_SHORT[p]}`} />
      ))}
    </span>
  );
}

function CommunityRow({ c, view, dim, onTown, townName }: { c: ViewCommunity; view: FieldOpsView; dim: boolean; onTown: (t: string) => void; townName: (t: string) => string }) {
  const bodies = view.bodies.filter((b) => b.community === c.id && b.lifecycle !== 'RecognizedAsChurch');
  const circles = bodies.filter((b) => b.kind === 'circle').length;
  const churches = bodies.filter((b) => b.kind === 'church').length;
  const gens = bodies.reduce((m, b) => Math.max(m, b.kind === 'church' ? b.generation : 0), 0);
  const cite = [c.people.ropId ? `ROP ${c.people.ropId}` : '', c.people.pgId ?? '', c.people.scheme.split('/').pop() ?? ''].filter(Boolean).join(' · ');
  return (
    <li className={dim ? 'dim' : ''} title={`${c.name}\n${cite}\n${c.claims.map((k) => `${k.label}: ${k.value} (${k.source})`).join('\n')}\n${c.blockedBy ? `next: ${c.blockedBy}` : 'at the top of the scale'}`}>
      <div className="fo-community-head">
        <strong>{c.people.name}</strong>{c.fictional ? <span className="tag fo-defined" title={c.definition}>defined in play</span> : null}
        {c.workedBy ? <span className="muted small"> · {view.teams.find((t) => t.id === c.workedBy)?.name ?? c.workedBy}</span> : <span className="muted small fo-unworked"> · nobody has taken them up</span>}
        <span className="muted small"> {c.towns.map((t, i) => <span key={t}>{i ? ' · ' : ''}<button type="button" className="gc-here-chip" onClick={() => onTown(t)}>{townName(t)}</button></span>)}</span>
      </div>
      <PhaseGauge floor={c.registry.phase} derived={c.derived} published={c.reading?.phase ?? null} />
      <span className="fo-phase-words"><span className="gc-phase">P{c.derived}</span> <span className="gc-phase-name">{PHASE_SHORT[c.derived]}</span>{c.registry.phase !== c.derived ? <span className="muted small"> from P{c.registry.phase}</span> : null}{c.reading ? <span className={`small ${c.reading.phase === c.derived ? 'fo-ok' : 'fo-off'}`}> · published P{c.reading.phase}</span> : <span className="muted small"> · no reading</span>}</span>
      <span className="fo-counts small">
        <span title="gospel conversations">{c.counts.conversations} talks</span> · <span title="seekers — asking to hear more">{c.counts.seekers} asking</span> · <span title="believers">{c.counts.believers} believe</span> · <span title="baptised">{c.counts.baptized} baptised</span> · <span title="leaders">{c.counts.leaders} lead</span>
        {c.counts.studies ? <span title="studies running"> · {c.counts.studies} {c.counts.studies === 1 ? 'study' : 'studies'}</span> : null}
        {circles ? <span title="circles"> · {circles} {circles === 1 ? 'circle' : 'circles'}</span> : null}{churches ? <span title="churches"> · {churches} {churches === 1 ? 'church' : 'churches'}</span> : null}{gens > 1 ? <span title="generations"> · gen {gens}</span> : null}
      </span>
      {c.blockedBy ? <span className="muted small fo-next">next: {c.blockedBy}</span> : null}
    </li>
  );
}

/** What an event says, in one line, with the names the view knows. */
function lineOf(e: FieldOpsEvent, view: FieldOpsView): { who: string | null; text: string; kind: string } {
  const name = (r: string) => view.cast.find((c) => c.role === r)?.name ?? r;
  const town = (t: string) => view.towns.find((x) => x.id === t)?.name ?? t;
  const comm = (c: string) => view.communities.find((x) => x.id === c)?.people.name ?? c;
  switch (e.type) {
    case 'acted': return { who: name(e.by), text: e.text, kind: e.action };
    case 'said': return { who: name(e.by), text: e.text, kind: 'said' };
    case 'whispered': return { who: name(e.by), text: `(to ${name(e.to)}) ${e.text}`, kind: 'whisper' };
    case 'moved': return { who: name(e.who), text: `drove from ${town(e.from)} to ${town(e.to)}.`, kind: 'moved' };
    case 'founded': return { who: name(e.by), text: `${e.name} begins in ${town(e.town)} — generation ${e.generation}; its own agent is being chartered.`, kind: 'founded' };
    case 'recognized': return { who: name(e.by), text: `${e.name} is recognised as a church in ${town(e.town)}; its own agent is being chartered.`, kind: 'recognized' };
    case 'team-founded': return { who: name(e.by), text: `founded ${e.name} in ${town(e.home)}${e.invited.length ? ` and asked ${e.invited.map(name).join(', ')} onto it` : ''}. Its team agent is being chartered at the Home.`, kind: 'founded' };
    case 'invited': return { who: name(e.by), text: `asked ${name(e.who)} onto ${view.teams.find((t) => t.id === e.team)?.name ?? e.team}.`, kind: 'invited' };
    case 'joined': return { who: name(e.who), text: `joined ${view.teams.find((t) => t.id === e.team)?.name ?? e.team}.`, kind: 'joined' };
    case 'declined': return { who: name(e.who), text: `declined ${view.teams.find((t) => t.id === e.team)?.name ?? e.team}.`, kind: 'declined' };
    case 'adopted': return { who: name(e.by), text: `${view.teams.find((t) => t.id === e.team)?.name ?? e.team} takes up the ${e.communities.map(comm).join(', ')}.`, kind: 'adopted' };
    case 'defined': return { who: name(e.by), text: `defined a people community: ${e.name}, in ${town(e.town)} — invented, marked as the game's; ${view.teams.find((t) => t.id === e.team)?.name ?? e.team} takes them up.`, kind: 'defined' };
    case 'reported': return { who: name(e.by), text: `observation on the ${comm(e.community)}: ${e.text}`, kind: 'report' };
    case 'assessed': return { who: name(e.by), text: `published the ${comm(e.community)} at Phase ${e.phase} (${PHASE_SHORT[e.phase]}); the records derive ${e.derived}.`, kind: 'assess' };
    case 'supported': return { who: name(e.by), text: `${view.partners.find((p) => p.id === e.partner)?.name ?? e.partner} committed ${e.resource} to ${view.teams.find((t) => t.id === e.team)?.name ?? e.team}.`, kind: 'support' };
    case 'stalled': return { who: null, text: `${view.bodies.find((b) => b.id === e.body)?.name ?? e.body} has stalled — nobody has gathered it.`, kind: 'stalled' };
    case 'trail': return { who: null, text: e.text, kind: `trail trail-${e.kind}` };
    case 'chose': return { who: name(e.by), text: `decided — ${e.text}`, kind: 'chose' };
    case 'phase': return { who: null, text: `The ${comm(e.community)} move from Phase ${e.from} to Phase ${e.to} — ${PHASE_NAMES[e.to]}.`, kind: 'phase' };
    case 'cue': return { who: e.by === 'director' ? 'the director' : null, text: e.text, kind: 'cue' };
    case 'day': return { who: null, text: e.phase === 'interlude' ? `Week ${e.week} is done.` : e.phase === 'closing' ? 'The season closes.' : `Day ${e.day}.`, kind: 'day' };
    case 'revealed': return { who: null, text: 'The season is over. The readiness is revealed and the score stands.', kind: 'day' };
    default: return { who: null, text: '', kind: 'other' };
  }
}

/** THE ACTIVITY — every act anybody made, newest last, with filters; and the one box for talking. */
function Activity({ view, filter, setFilter, selectedTown, act, whisperTo, setWhisperTo }: { view: FieldOpsView; filter: 'all' | 'team' | 'town' | 'readings' | 'talk' | 'mine'; setFilter: (f: 'all' | 'team' | 'town' | 'readings' | 'talk' | 'mine') => void; selectedTown: string | null; act: (a: unknown) => void; whisperTo: string | null; setWhisperTo: (r: string | null) => void }) {
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement | null>(null);
  const you = view.you;
  const myTeam = you?.team ?? null;
  const teamRoles = new Set(view.cast.filter((c) => c.team === myTeam).map((c) => c.role));
  const shown = view.transcript.filter((e) => {
    if (e.type === 'day' && e.phase === 'day') return filter === 'all';
    if (filter === 'team') return 'by' in e && teamRoles.has((e as { by: string }).by) || e.type === 'moved' && teamRoles.has(e.who);
    if (filter === 'town') return !!selectedTown && (('town' in e && (e as { town: string }).town === selectedTown) || (e.type === 'moved' && (e.to === selectedTown || e.from === selectedTown)));
    if (filter === 'readings') return e.type === 'assessed' || e.type === 'phase' || e.type === 'reported';
    if (filter === 'talk') return e.type === 'said' || e.type === 'whispered' || e.type === 'cue';
    if (filter === 'mine') return !!you && 'by' in e && (e as { by: string }).by === you.role;
    return true;
  }).slice(-160);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [shown.length]);
  const target = whisperTo ? view.cast.find((c) => c.role === whisperTo) : null;
  const submit = () => { const t = text.trim(); if (!t) return; act(target ? { type: 'whisper', to: target.role, text: t } : { type: 'say', text: t }); setText(''); };
  return (
    <section className="panel mystery-transcript gc-transcript fo-activity">
      <div className="gc-filter-row">
        {(['all', 'team', 'town', 'readings', 'talk', 'mine'] as const).map((f) => (
          <button key={f} type="button" className={`gc-filter${filter === f ? ' active' : ''}`} disabled={(f === 'town' && !selectedTown) || (f === 'team' && !myTeam) || (f === 'mine' && !you)} onClick={() => setFilter(f)}>
            {f === 'all' ? 'all' : f === 'team' ? 'my team' : f === 'town' ? (selectedTown ? view.towns.find((t) => t.id === selectedTown)?.name ?? 'this town' : 'this town') : f}
          </button>
        ))}
        <span className="muted small">{view.transcript.length} entries</span>
      </div>
      <div className="gc-lines">
        {shown.map((e, i) => {
          const l = lineOf(e, view);
          if (!l.text) return null;
          if (e.type === 'day' && e.phase !== 'day') return <div key={i} className="gc-round-divider">{l.text}</div>;
          const face = l.who ? view.cast.find((c) => c.name === l.who) : null;
          return (
            <div key={i} className={`fo-line fo-${l.kind}${face && you && face.role === you.role ? ' mine' : ''}`}>
              {face ? <Face look={face.look as unknown as MysteryLook} name={face.name} size={22} /> : <span className="fo-line-dot" />}
              <span className="fo-line-body">
                {l.who ? <strong>{l.who}</strong> : null} {e.type === 'cue' ? <em>{l.text}</em> : l.text}
                {'day' in e && typeof (e as { day?: number }).day === 'number' ? <span className="muted small"> · day {(e as { day: number }).day}</span> : null}
              </span>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {you ? (
        <div className="mystery-say gc-talk">
          {target ? <span className="gc-talk-target">To {target.name}<button type="button" aria-label={`Stop whispering to ${target.name}`} onClick={() => setWhisperTo(null)}>×</button></span> : null}
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={target ? `Whisper to ${target.name}…` : 'Say something to the field…'} maxLength={280} />
          <button type="button" onClick={submit}>{target ? 'Send' : 'Say'}</button>
        </div>
      ) : null}
    </section>
  );
}

const VERB_WORDS: Record<string, { label: string; hint: string }> = {
  visit: { label: 'Visit households', hint: 'A relationship visit among a people in this town. Somebody may ask to hear more.' },
  share: { label: 'Share the gospel', hint: 'A gospel conversation. Five among a people is sowing; some will want to read.' },
  study: { label: 'Hold a study', hint: 'Start a discovery study with those who asked, or meet the one that is running.' },
  found: { label: 'Found a circle', hint: 'Gather the believers from a study into a circle — a body the field app will show.' },
  gather: { label: 'Gather a circle', hint: 'Meet a circle or church here. A circle nobody gathers for twelve days stalls.' },
  baptize: { label: 'Baptise', hint: 'Baptise believers of a body here. Baptisms are Phase 3.' },
  train: { label: 'Train leaders', hint: 'Leadership training in a body with three believers or more.' },
  recognize: { label: 'Recognise a church', hint: 'An active circle with six believers, three baptised and a leader of its own.' },
  send: { label: 'Send', hint: 'A church with two leaders and eight believers sends a leader and two families to another town.' },
  coach: { label: 'Coach a worker', hint: 'A coaching call: lifts a worker for the day and gives back some energy.' },
  report: { label: 'File an observation', hint: 'What you saw, about a community. The steward reads it; the field app keeps it.' },
  assess: { label: 'Publish a reading', hint: 'A phase for a community on the registry\'s scale. Scored against the records at the end.' },
  support: { label: 'Commit support', hint: 'Funds, volunteers, a venue or prayer for a team. Raises its capacity; buys no result.' },
  rest: { label: 'Rest', hint: 'Spend the day resting. Energy comes back; below twenty your work weakens.' },
  move: { label: 'Drive to', hint: 'Free. Go where your people are before you act among them.' },
  'found-team': { label: 'Found a team', hint: 'Start a team where you stand: you are its steward, and a real team agent is chartered at your custodian\'s Home — one approval. Ask whom you like onto it.' },
  invite: { label: 'Invite to the team', hint: 'Free. Ask somebody onto your team; they join or decline when they like.' },
  join: { label: 'Join a team', hint: 'Free. Answer an invitation. A circle belongs to a team, so you need one before you found any.' },
  decline: { label: 'Decline', hint: 'Free. Turn an invitation down.' },
  adopt: { label: 'Take up a people', hint: 'Free. A team\'s steward takes a registry community up into the team\'s work — the workspace\'s pointer. Nobody works among a people nobody has taken up.' },
  'define-community': { label: 'Define a community', hint: 'Define a new People Community in a town, in your own words — invented, marked as the game\'s, with a record in your team\'s vault. Your team takes them up.' },
};

/** YOUR DAY — the one act you may spend, drawn from the engine's own list, with the pickers each verb needs. */
function YourDay({ view, act, selectedTown }: { view: FieldOpsView; act: (a: unknown) => void; selectedTown: string | null }) {
  const you = view.you;
  const [verb, setVerb] = useState<string>('');
  const [community, setCommunity] = useState('');
  const [body, setBody] = useState('');
  const [town, setTown] = useState('');
  const [who, setWho] = useState('');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<PhaseN>(1);
  const [team, setTeam] = useState('');
  const [resource, setResource] = useState<'funds' | 'volunteers' | 'venue' | 'prayer'>('funds');
  const [teamName, setTeamName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [invite, setInvite] = useState<string[]>([]);
  const [adopting, setAdopting] = useState<string[]>([]);
  const [peopleName, setPeopleName] = useState('');
  const [language, setLanguage] = useState('');
  const [definition, setDefinition] = useState('');
  useEffect(() => { if (selectedTown) setTown(selectedTown); }, [selectedTown]);
  if (!you) return (
    <section className="panel mystery-you gc-you fo-you">
      <h3>Watching</h3>
      <p className="hint">You are not in this season. Everything the field does is on the board and in the activity.</p>
    </section>
  );
  const may = you.may.map((m) => m.action);
  const hereCommunities = view.communities.filter((c) => c.towns.includes(you.town));
  const hereBodies = view.bodies.filter((b) => b.town === you.town && b.lifecycle !== 'RecognizedAsChurch');
  const teamMates = view.cast.filter((p) => p.role !== you.role && (you.kind === 'coordinator' || p.team === you.team));
  const askable = view.cast.filter((p) => p.role !== you.role && !p.team && !p.partner && p.kind !== 'steward');
  const myTeamState = view.teams.find((t) => t.id === you.team);
  const chosen = verb && may.includes(verb as FieldOpsAction['type']) ? verb : '';
  const needs = (k: string) => ['visit', 'share', 'study', 'found', 'report', 'assess'].includes(k) ? 'community' : ['gather', 'baptize', 'train', 'recognize', 'send'].includes(k) ? 'body' : k === 'coach' || k === 'invite' ? 'who' : k === 'support' || k === 'join' || k === 'decline' ? 'team' : k === 'move' ? 'town' : k === 'found-team' ? 'name' : k === 'adopt' ? 'adopt' : k === 'define-community' ? 'define' : null;
  const unworked = view.communities.filter((c) => !c.workedBy);
  const go = () => {
    const k = chosen;
    if (!k) return;
    const n = needs(k);
    if (n === 'community' && !community) return;
    if (n === 'body' && !body) return;
    if (k === 'send' && !town) return;
    const a: Record<string, unknown> = { type: k };
    if (n === 'community') a.community = community;
    if (n === 'body') a.body = body;
    if (k === 'send' || k === 'move') a.town = town;
    if (k === 'coach' || k === 'invite') a.who = who;
    if (k === 'report') a.text = text;
    if (k === 'assess') a.phase = phase;
    if (k === 'support') { a.team = team; a.resource = resource; }
    if (k === 'join' || k === 'decline') a.team = team;
    if (k === 'found-team') { if (!teamName.trim()) return; a.name = teamName.trim(); if (purpose.trim()) a.purpose = purpose.trim(); if (invite.length) a.invite = invite; if (you.intended && you.intended.name.toLowerCase() === teamName.trim().toLowerCase()) a.plan = you.intended.id; }
    if (k === 'adopt') { if (!adopting.length) return; a.communities = adopting; }
    if (k === 'define-community') { if (!teamName.trim() || !peopleName.trim() || !town || !definition.trim()) return; a.name = teamName.trim(); a.people = peopleName.trim(); a.town = town; a.definition = definition.trim(); if (language.trim()) a.language = language.trim(); }
    act(a);
    setVerb(''); setText(''); setTeamName(''); setPurpose(''); setInvite([]); setAdopting([]); setPeopleName(''); setLanguage(''); setDefinition('');
  };
  const hint = chosen ? VERB_WORDS[chosen]?.hint : you.actedToday ? 'You have spent today. Tomorrow comes with the clock; you can still drive and talk.' : view.phase !== 'day' ? 'The week is between days.' : 'Pick what you will do today.';
  return (
    <section className="panel mystery-you gc-you fo-you">
      <div className="mystery-you-head">
        <Face look={you.look as unknown as MysteryLook} name={you.name} size={44} />
        <div>
          <h3>{you.name}</h3>
          <p className="muted small">{you.kind}{you.team ? ` · ${view.teams.find((t) => t.id === you.team)?.name}` : ''}{you.partner ? ` · ${view.partners.find((p) => p.id === you.partner)?.name}` : ''} · in {view.towns.find((t) => t.id === you.town)?.name}</p>
        </div>
      </div>
      <p className="fo-energy small" title="energy — an act spends some, a night gives some back"><span className="fo-energy-bar"><span style={{ width: `${you.energy}%` }} /></span> {you.energy}% {you.actedToday ? <span className="gc-phase">· spent today</span> : <span className="fo-ok">· today is yours</span>}</p>
      <details className="gc-fold"><summary>Who you are</summary><p className="small">{you.blurb}</p><p className="small"><em>What only you know:</em> {you.secret}</p></details>
      {!you.team && you.intended && (you.kind === 'worker' || you.kind === 'coach' || you.kind === 'coordinator') ? <p className="hint small fo-plan">You set out to be on <strong>{you.intended.name}</strong> with {you.intended.members.filter((m) => m !== you.role).map((m) => view.cast.find((p) => p.role === m)?.name ?? m).join(', ')}. Nothing is a team until somebody founds it.</p> : null}
      {you.invitedTo.length ? <p className="hint small fo-bell">You have been asked onto {you.invitedTo.map((t) => view.teams.find((x) => x.id === t)?.name ?? t).join(' and ')}.</p> : null}
      {myTeamState ? <p className="hint small">{myTeamState.name}: {myTeamState.agent ? <>a real team agent, <code>{myTeamState.agent.slice(0, 10)}…</code>, custodied at {myTeamState.custodian}'s Home</> : 'its team agent is being chartered at the Home'}{myTeamState.steward === you.role ? ' · you are its steward' : ''}.</p> : null}
      {you.choices.map((c) => (
        <div key={c.id} className="fo-choice">
          <p className="fo-choice-q">{c.question}</p>
          <div className="fo-choice-options">
            {c.options.map((o) => <button key={o.id} type="button" onClick={() => act({ type: 'choose', choice: c.id, option: o.id })}>{o.label}</button>)}
          </div>
          <p className="hint small">A decision changes your season, never the world. It does not spend your day.</p>
        </div>
      ))}
      <div className="fo-verbs">
        {may.filter((m) => m !== 'say' && m !== 'whisper' && m !== 'choose').map((m) => (
          <button key={m} type="button" className={`fo-verb${chosen === m ? ' on' : ''}`} title={VERB_WORDS[m]?.hint} onClick={() => setVerb((cur) => (cur === m ? '' : m))}>{VERB_WORDS[m]?.label ?? m}</button>
        ))}
      </div>
      <p className="hint small">{hint}</p>
      {chosen ? (
        <div className="gc-form">
          {needs(chosen) === 'community' ? (
            <select value={community} onChange={(e) => setCommunity(e.target.value)}>
              <option value="">which people…</option>
              {(chosen === 'assess' || chosen === 'report' ? view.communities : hereCommunities.filter((c) => c.workedBy)).map((c) => <option key={c.id} value={c.id}>{c.people.name} · P{c.derived}{chosen !== 'assess' && chosen !== 'report' ? ` · ${c.counts.seekers} seekers, ${c.counts.studies} studies` : ''}</option>)}
            </select>
          ) : null}
          {needs(chosen) === 'body' ? (
            <select value={body} onChange={(e) => setBody(e.target.value)}>
              <option value="">which circle or church…</option>
              {hereBodies.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.believers} believe, {b.baptized} baptised, {b.leaders} lead{b.lifecycle === 'Stalled' ? ' · stalled' : ''}</option>)}
            </select>
          ) : null}
          {chosen === 'send' || chosen === 'move' || chosen === 'define-community' ? (
            <select value={town} onChange={(e) => setTown(e.target.value)}>
              <option value="">which town…</option>
              {view.towns.filter((t) => chosen === 'define-community' || t.id !== you.town).map((t) => <option key={t.id} value={t.id}>{t.name} · {view.corridors.find((c) => c.id === t.corridor)?.name.split(' /')[0]}</option>)}
            </select>
          ) : null}
          {chosen === 'adopt' ? (<>
            <div className="fo-invite-list">
              {unworked.map((c) => (
                <label key={c.id} className="small"><input type="checkbox" checked={adopting.includes(c.id)} onChange={(e) => setAdopting((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} /> {c.people.name} <span className="muted">· {c.towns.map((t) => view.towns.find((x) => x.id === t)?.name ?? t).join(', ')} · P{c.registry.phase}{c.fictional ? ' · defined in play' : ''}</span></label>
              ))}
              {!unworked.length ? <span className="muted small">Every community is taken up.</span> : null}
            </div>
            <p className="hint small">A People Community the workspace works with: held by your team, whose vault carries its records; the workspace keeps a pointer.</p>
          </>) : null}
          {chosen === 'define-community' ? (<>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Name — e.g. Eritreans around the 8th Avenue shops" maxLength={80} />
            <input value={peopleName} onChange={(e) => setPeopleName(e.target.value)} placeholder="The people — e.g. Eritreans" maxLength={60} />
            <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Their language (optional)" maxLength={40} />
            <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="Why these people are one community, in your own words" maxLength={400} rows={3} />
            <p className="hint small">One approval at your custodian's Home: a context record in your team's vault, and the workspace keeps a pointer. This community is INVENTED and says so in every record; the seed decides its readiness, not you.</p>
          </>) : null}
          {chosen === 'coach' ? <select value={who} onChange={(e) => setWho(e.target.value)}><option value="">whom…</option>{teamMates.map((p) => <option key={p.role} value={p.role}>{p.name} · {p.energy}%</option>)}</select> : null}
          {chosen === 'invite' ? <select value={who} onChange={(e) => setWho(e.target.value)}><option value="">whom…</option>{askable.filter((p) => !myTeamState?.invited.includes(p.role) && !myTeamState?.declined.includes(p.role)).map((p) => <option key={p.role} value={p.role}>{p.name} · {p.kind} · {p.townName}</option>)}</select> : null}
          {chosen === 'join' || chosen === 'decline' ? <select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">which team…</option>{view.teams.filter((t) => you.invitedTo.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name} · {view.cast.find((p) => p.role === t.steward)?.name ?? t.steward}'s</option>)}</select> : null}
          {chosen === 'found-team' ? (<>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={you.intended ? you.intended.name : 'Team name — e.g. Weld Corridor Team'} maxLength={80} />
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What is this team for? (optional)" maxLength={240} />
            <div className="fo-invite-list">
              {askable.map((p) => (
                <label key={p.role} className="small"><input type="checkbox" checked={invite.includes(p.role)} onChange={(e) => setInvite((cur) => (e.target.checked ? [...cur, p.role] : cur.filter((r) => r !== p.role)))} /> {p.name} <span className="muted">· {p.kind}{you.intended?.members.includes(p.role) ? ' · in your plan' : ''}</span></label>
              ))}
            </div>
            <p className="hint small">Each person you ask is told; anyone may decline. You are on the team either way, as its steward. One approval at your custodian's Home — a real team agent with its own records and roster.</p>
          </>) : null}
          {chosen === 'report' ? <input value={text} onChange={(e) => setText(e.target.value)} placeholder="what you saw" maxLength={240} /> : null}
          {chosen === 'assess' ? <select value={phase} onChange={(e) => setPhase(Number(e.target.value) as PhaseN)}>{([0, 1, 2, 3, 4, 5, 6, 7] as PhaseN[]).map((p) => <option key={p} value={p}>P{p} · {PHASE_SHORT[p]}</option>)}</select> : null}
          {chosen === 'support' ? (<>
            <select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">which team…</option>{view.teams.map((t) => <option key={t.id} value={t.id}>{t.name} · capacity {t.capacity}</option>)}</select>
            <select value={resource} onChange={(e) => setResource(e.target.value as 'funds')}>{(['funds', 'volunteers', 'venue', 'prayer'] as const).map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </>) : null}
          <button type="button" className="primary" onClick={go} disabled={(needs(chosen) === 'community' && !community) || (needs(chosen) === 'body' && !body) || ((chosen === 'send' || chosen === 'move' || chosen === 'define-community') && !town) || (needs(chosen) === 'who' && !who) || (chosen === 'report' && !text.trim()) || (needs(chosen) === 'team' && !team) || (chosen === 'found-team' && !teamName.trim()) || (chosen === 'adopt' && !adopting.length) || (chosen === 'define-community' && (!teamName.trim() || !peopleName.trim() || !definition.trim()))}>{chosen === 'found-team' ? 'Create team' : chosen === 'define-community' ? 'Define the community' : VERB_WORDS[chosen]?.label ?? chosen}</button>
        </div>
      ) : null}
    </section>
  );
}

/** THE TEAMS — the ones the season has founded: who stewards each, who is on it, who was asked, whether its agent has landed; pressing a name arms a whisper. */
function Teams({ view, onPerson, whisperTo, charters }: { view: FieldOpsView; onPerson: (r: string) => void; whisperTo: string | null; charters: NonNullable<FieldOpsSummary['charters']> }) {
  const row = (p: ViewPerson) => (
    <li key={p.role} className={`mystery-cast-row fo-cast-row${whisperTo === p.role ? ' armed' : ''}`}>
      <button type="button" className="gc-here-chip fo-cast-name" aria-pressed={whisperTo === p.role} onClick={() => onPerson(p.role)} title={`${p.kind} · ${p.mind === 'human' ? `played by ${p.playedBy ?? 'a person'}` : p.mind === 'agent' ? `agent ${p.agent}${p.custodian ? `, custodied by ${p.custodian}` : ''}` : 'played by the house'} — press to whisper`}>
        <Face look={p.look as unknown as MysteryLook} name={p.name} size={24} /> <strong>{p.name}</strong>
      </button>
      <span className="muted small">{p.kind} · {p.townName} · {p.energy}% · {p.mind === 'human' ? `played by ${p.playedBy ?? 'you'}` : p.mind === 'agent' ? `agent ${p.agent}` : 'the house'}{p.today ? ` · ${p.today}` : p.actedToday ? '' : ' · not yet today'}</span>
    </li>
  );
  const unteamed = view.cast.filter((p) => !p.team && !p.partner);
  const name = (r: string) => view.cast.find((p) => p.role === r)?.name ?? r;
  return (
    <section className="panel mystery-cast fo-teams">
      <h3>The teams</h3>
      {!view.teams.length ? <p className="hint small">No team yet. Nothing is a team until somebody founds one; the plan each part carries says who means to.</p> : null}
      {view.teams.map((t) => {
        const ch = charters.find((c) => c.key === `team:${t.id}`);
        return (
          <details key={t.id} className="gc-fold" open>
            <summary><strong>{t.name}</strong> <span className="muted small">· {view.corridors.find((c) => c.id === t.corridor)?.name} · capacity {t.capacity} · steward {name(t.steward)}</span></summary>
            <p className="small fo-team-agent">{t.agent ? <>agent <code>{t.agent.slice(0, 10)}…</code> at {t.custodian}'s Home</> : ch?.step === 'failed' ? <span className="fo-off">no agent: {ch.error}</span> : <span className="muted">chartering its agent{ch ? ` · ${ch.step}${ch.error ? ` (retrying: ${ch.error.slice(0, 60)})` : ''}` : ''}…</span>}{t.purpose ? ` · ${t.purpose}` : ''}</p>
            <ul className="mystery-cast-list">{view.cast.filter((p) => p.team === t.id).map(row)}</ul>
            {t.invited.length ? <p className="muted small">asked, not yet answered: {t.invited.map(name).join(', ')}</p> : null}
            {t.declined.length ? <p className="muted small">declined: {t.declined.map(name).join(', ')}</p> : null}
          </details>
        );
      })}
      {unteamed.length ? <details className="gc-fold" open><summary><strong>On no team yet</strong></summary><ul className="mystery-cast-list">{unteamed.map(row)}</ul></details> : null}
      <details className="gc-fold"><summary><strong>Partner representatives</strong></summary><ul className="mystery-cast-list">{view.cast.filter((p) => p.partner).map(row)}</ul></details>
    </section>
  );
}

/** THE AGENT REPORT — the season is a test of the agents, and the tally is on the screen while it runs. */
function AgentReport({ view, agents }: { view: FieldOpsView; agents: FieldOpsAgentRow[] }) {
  const agentParts = view.cast.filter((p) => p.mind === 'agent' || agents.some((a) => a.role === p.role));
  if (!agentParts.length) return (
    <section className="panel fo-agents">
      <h3>The agents</h3>
      <p className="hint small">No part is played by an agent in this deployment: the house plays them all, which is the control the agents are measured against. Chartering a cast (the operator's `charter-cast.mts --cast demo/fieldops-cast.json`) puts sixteen persona agents at the Home in these parts.</p>
    </section>
  );
  return (
    <section className="panel fo-agents">
      <h3>The agents <span className="muted small">· asked / answered / applied · refused · missed · avg</span></h3>
      <ul className="fo-agent-rows">
        {agentParts.map((p) => {
          const a = agents.find((x) => x.role === p.role);
          return (
            <li key={p.role} title={a?.muted ? `muted: ${a.muted}` : a?.resting ? 'resting after misses' : ''}>
              <strong>{p.name}</strong> <span className="muted small">{p.agent}</span>
              {a ? <span className="num small"> {a.asked}/{a.answered}/{a.applied} · <span className={a.refused ? 'fo-off' : ''}>{a.refused + a.unparsed}✗</span> · {a.missed}∅ · {a.avgMs !== null ? `${(a.avgMs / 1000).toFixed(1)}s` : '—'}{a.byRules ? <span className="muted"> · house {a.byRules}</span> : null}{a.muted ? ' · muted' : a.resting ? ' · resting' : ''}</span> : <span className="muted small"> not asked yet</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Partners({ view }: { view: FieldOpsView }) {
  return (
    <section className="panel fo-partners">
      <h3>Partner churches</h3>
      <ul className="fo-partner-rows">
        {view.partners.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> <span className="muted small">· {view.towns.find((t) => t.id === p.town)?.name}{p.denomination ? ` · ${p.denomination}` : ''}</span>
            <span className="small"> · {p.used}/{p.capacity} given</span>
            {p.website ? <a className="small" href={p.website} target="_blank" rel="noreferrer"> ↗</a> : null}
            <span className="muted small"> · a game agent speaks for it{p.agent ? ` (${p.agent})` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** WHAT LANDED AT THE FIELD APP — the season's records are written at every week's end; the host can ask for it now. */
function Estate({ staging, isHost, stagingId, token }: { staging: FieldOpsClientState['staging']; isHost: boolean; stagingId: string; token: string }) {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const e = staging?.estate ?? null;
  return (
    <section className="panel fo-estate">
      <h3>The field app</h3>
      <p className="hint small">
        {e ? (e.ok ? `${e.written} records written through day ${e.throughDay} — teams, activities, circles, churches and readings, each marked as a game's.` : `${e.written} records written; not written: ${e.failures.join('; ')}`) : 'Nothing written yet. The week\'s end writes the season\'s records into the teams\' and bodies\' vaults at the Home.'}
        {' '}<a href={FIELD_APP} target="_blank" rel="noreferrer">Open field.faithnet.io ↗</a>
      </p>
      {staging?.graph ? <p className="hint small">{staging.graph.ok ? 'The season is in the game\'s graph in the public registry.' : `Not in the graph: ${staging.graph.error}`}</p> : null}
      {staging?.charters?.length ? (
        <ul className="fo-charters small">
          {staging.charters.map((c) => <li key={c.key} className={c.step === 'failed' ? 'fo-off' : c.step === 'done' ? 'fo-ok' : ''}><strong>{c.name}</strong> · {c.kind} · {c.step === 'done' ? <>chartered, <code>{(c.sa ?? '').slice(0, 10)}…</code></> : c.step === 'failed' ? `not chartered: ${c.error}` : `${c.step}${c.tries ? ` (try ${c.tries}${c.error ? `: ${c.error.slice(0, 80)}` : ''})` : ''}…`}</li>)}
        </ul>
      ) : null}
      {isHost ? <button type="button" disabled={busy} onClick={async () => { setBusy(true); setLine(null); try { const r = await fieldOpsApi.estate(stagingId, token); setLine(r.ok ? `wrote ${r.report.written}` : r.report.failures.join('; ')); } catch (err) { setLine(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } }}>{busy ? 'Writing…' : 'Write the season out now'}</button> : null}
      {line ? <p className="small">{line}</p> : null}
    </section>
  );
}

/** THE REVEAL — the readiness, the score, the agents' tally. */
function Reveal({ view, staging, agents, onAgain, busy }: { view: FieldOpsView; staging: FieldOpsClientState['staging']; agents: FieldOpsAgentRow[]; onAgain: () => void; busy: boolean }) {
  const r = view.reveal!;
  const s = r.score;
  return (
    <section className="panel mystery-reveal fo-reveal">
      <h3>{s.verdict === 'field-moved' ? 'The field moved' : s.verdict === 'field-held' ? 'The field held' : 'The field slipped'}</h3>
      <p>{s.movedTotal} phases gained across {s.communities.filter((c) => c.moved > 0).length} communities{s.reachedP7 ? `; ${s.reachedP7} reached Phase 7` : ''}. Seed <code>{r.seed.slice(0, 12)}…</code>.</p>
      <ul className="fo-score">
        {s.communities.map((c) => (
          <li key={c.community}><strong>{c.name}</strong>: P{c.start} → P{c.end}{c.published !== null ? <span className={c.accurate ? 'fo-ok' : 'fo-off'}> · published P{c.published}{c.accurate ? ' ✓' : ' ✗'}</span> : <span className="muted"> · no reading</span>} <span className="muted small">· readiness {Math.round(c.readiness * 100)}%</span></li>
        ))}
      </ul>
      <details className="gc-fold"><summary>Teams</summary><ul className="fo-score">{s.teams.map((t) => <li key={t.team}><strong>{t.name}</strong>: {t.acts} acts · {t.circles} circles · {t.churches} churches · {t.generations} generations · {t.baptized} baptised</li>)}</ul></details>
      <details className="gc-fold" open><summary>The parts, and the agents</summary>
        <ul className="fo-score">{s.parts.map((p) => { const a = agents.find((x) => x.role === p.role); return <li key={p.role}><strong>{p.name}</strong> ({p.mind}): {p.acts} acts on {p.days} days{a ? ` · asked ${a.asked}, answered ${a.answered}, applied ${a.applied}, refused ${a.refused + a.unparsed}, missed ${a.missed}${a.byRules ? `, house played ${a.byRules}` : ''}` : ''}</li>; })}</ul>
      </details>
      {staging?.estate ? <p className="small">{staging.estate.ok ? `${staging.estate.written} records at the field app.` : `Field app: ${staging.estate.failures.join('; ')}`}</p> : null}
      <button type="button" className="primary" disabled={busy} onClick={onAgain}>{busy ? 'Opening…' : 'Another season'}</button>
    </section>
  );
}

export type { ViewBody };
