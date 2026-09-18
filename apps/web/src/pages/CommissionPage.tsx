/**
 * A GREAT COMMISSION NIGHT — the page (docs/GREAT-COMMISSION.md §10).
 *
 * The mystery page's shape, because it is the same kind of place: the whole window, two height-bounded columns,
 * the transcript that is the room, a side that is YOUR PART. What differs is what a part is for. There is no
 * 3D venue — the rooms are workspaces, not a hotel — so the main column leads with THE BOARD: five peoples, the
 * reading published for each and the need it emitted, which is the whole object of the night. Your side leads
 * with your VAULT, each item with the grains it may be spoken at here, because choosing the grain is the one
 * decision anybody is ever judged on.
 *
 * NO HOOK AFTER AN EARLY RETURN — every hook in this file is above the first `return`.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CommissionEvent, CommissionView, Grain, Phase, Strength } from '@pokernight/commission';
import { PHASE_NAMES, phaseName } from '@pokernight/commission';
import type { AppSession } from '../lib/types';
import { commissionApi } from '../lib/api';
import { CommissionSocket, type CommissionClientState } from '../lib/commissionSocket';
import { HOME_HASH } from '../lib/routes';
import { Face } from '../components/mystery/Face';
import type { VenueHandle } from '../components/mystery/Venue';
import type { MysteryView } from '@pokernight/mystery';
import { KETTLEWATER_HOUSE_PLAN } from '../components/commission/plan';

/** THE ENGINE NEVER AT MODULE TIME: PlayCanvas is loaded when somebody walks into a room, like the lounge's. */
const Venue = lazy(() => import('../components/mystery/Venue').then((m) => ({ default: m.Venue })));

/**
 * THE MEETING HOUSE, DRAWN BY THE MYSTERY'S VENUE. The venue reads a mystery's view — a room with props and a
 * death, a cast with `alive` — so a commission's view is handed to it in that shape: the room's things are the
 * plan's own features (the map, the wall, the hearth), nobody is dead, and a part gone silent is drawn where
 * they stood. Nothing here is a fact of the game; it is how the game is drawn.
 */
function asVenueView(v: CommissionView): MysteryView {
  const plan = v.room ? KETTLEWATER_HOUSE_PLAN[v.room.id] : undefined;
  const props = (plan?.things ?? []).filter((t) => t.prop).map((t) => ({ id: t.prop!, name: t.label ?? t.prop!, examined: false }));
  const person = (p: CommissionView['cast'][number]) => ({
    role: p.role, name: p.name, operator: p.operator, agent: p.agent, alive: !p.silent, look: p.look,
    ...(p.room ? { room: p.room } : {}), ...(p.roomName ? { roomName: p.roomName } : {}),
    ...(p.appearance ? { appearance: p.appearance } : {}), ...(p.mind ? { mind: p.mind } : {}), ...(p.playedBy ? { playedBy: p.playedBy } : {}),
  });
  return {
    title: v.scenario, titleName: v.scenarioName, venue: v.region,
    act: v.round, actName: v.roundName, objective: v.objective, pace: v.pace,
    phase: v.phase === 'round' ? 'act' : v.phase === 'closing' ? 'accusations' : v.phase, deadline: v.deadline, seedCommit: v.seedCommit,
    you: v.you ? { role: v.you.role, name: v.you.name, blurb: v.you.blurb, secret: v.you.secret, alive: !v.you.silent, look: v.you.look, killer: false } : null,
    room: v.room ? { id: v.room.id, name: v.room.name, blurb: v.room.blurb, people: v.room.people.map(person), props, doors: v.room.doors, death: null, trace: null } : null,
    cast: v.cast.map(person),
    rooms: v.rooms.map((r) => ({ id: r.id, name: r.name })),
    clues: [], deaths: [], transcript: [], outcomes: [], choices: [], accusation: null, reveal: null,
  } as unknown as MysteryView;
}
import { Identity } from '../components/Identity';
import { Brand } from '../components/Brand';

const STRENGTHS: Strength[] = ['unknown', 'initial', 'growing', 'active', 'flourishing'];
const PHASES: Phase[] = [0, 1, 2, 3, 4, 5, 6, 7, '0-R'];

function useCommission(stagingId: string, token: string | null): { state: CommissionClientState; sock: CommissionSocket | null } {
  const [, bump] = useState(0);
  const ref = useRef<CommissionSocket | null>(null);
  useEffect(() => {
    if (!token) return;
    const s = new CommissionSocket(stagingId, token, () => bump((n) => n + 1));
    ref.current = s;
    return () => { s.close(); ref.current = null; };
  }, [stagingId, token]);
  return { state: ref.current?.state ?? { view: null, staging: null, connection: 'connecting', error: null }, sock: ref.current };
}

export function CommissionPage({ stagingId, session, onSignOut }: { stagingId: string; session: AppSession | null; onSignOut: () => void }) {
  const { state, sock } = useCommission(stagingId, session?.token ?? null);
  const [busy, setBusy] = useState(false);
  const view = state.view;
  const staging = state.staging;
  const isHost = !!session && !!staging && staging.host === session.playerId;
  const act = (a: unknown) => sock?.act(a);
  const again = async () => {
    if (!session || !view) return;
    setBusy(true);
    try { await commissionApi.solo({ scenario: view.scenario, role: view.you?.role, restart: true }, session.token); } finally { setBusy(false); }
  };
  const venue = useRef<VenueHandle | null>(null);
  const venueView = useMemo(() => (view ? asVenueView(view) : null), [view]);
  /** A DOOR IS WALKED THROUGH, not teleported: the room takes the move and sends it down the socket on arrival. */
  const actThroughRoom = (a: unknown) => {
    const m = a as { type?: string; room?: string };
    if (m?.type === 'move' && m.room && venue.current?.goThrough(m.room)) return;
    sock?.act(a);
  };
  const roundLabel = useMemo(() => (view ? (view.phase === 'closing' ? 'The closing' : view.phase === 'revealed' ? 'The reveal' : `Round ${view.round} · ${view.roundName}`) : ''), [view]);

  if (!session) return <div className="page"><section className="panel"><p className="hint">Sign in to come to the marches.</p></section></div>;
  if (!view) return <div className="page"><section className="panel"><p className="hint">{state.error ?? (state.connection === 'reconnecting' ? 'Reconnecting…' : 'Walking in…')}</p></section></div>;

  // THE TOPBAR IS OUTSIDE THE GRID, as the mystery's is. `.mystery-page` is a two-column grid whose DIRECT children
  // are the main and the side; with the header and a wrapper as its children instead, the whole night was laid
  // in the 340px column and the left column stood empty and green (seen live, 2026-09-17).
  return (
    <div className="mystery gc">
      <header className="topbar">
        <Brand />
        <span className="tag">{view.scenarioName} · night {view.night}</span>
        <span className="tag">{roundLabel}</span>
        <Clock deadline={view.deadline} paused={!!staging?.paused} />
        {isHost && view.phase !== 'revealed' ? (
          <button type="button" onClick={() => sock?.pause(!staging?.paused)}>{staging?.paused ? 'Resume the night' : 'Hold the night'}</button>
        ) : staging?.paused ? <span className="tag">held by your host</span> : null}
        <span className="spacer" />
        <a href={HOME_HASH}>← Play</a>
        <Identity session={session} onSignOut={onSignOut} />
      </header>
      {state.error ? <div className="form-error">{state.error}</div> : null}
      <div className="page mystery-page gc-page">
        <main className="mystery-main">
          {view.room && venueView ? (
            <Suspense fallback={<section className="panel"><p className="hint">Opening the meeting house…</p></section>}>
              <div className="mystery-venue-wrap">
                <Venue ref={venue} plan={KETTLEWATER_HOUSE_PLAN} view={venueView} speaking={null} act={(a) => sock?.act(a)} />
              </div>
            </Suspense>
          ) : null}
          <Board view={view} />
          <Room view={view} act={actThroughRoom} />
          <Transcript view={view} />
        </main>
        <aside className="mystery-side">
          {view.reveal ? <Reveal view={view} onAgain={again} busy={busy} /> : null}
          <You view={view} act={act} />
          <Cast view={view} />
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
  return <span className="num mystery-clock" title={paused ? 'held' : undefined}>{paused ? '⏸ ' : ''}{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>;
}

/** THE BOARD — the public picture, which is the object of the night. */
function Board({ view }: { view: CommissionView }) {
  return (
    <section className="panel gc-board">
      <header><h3>The picture · {view.regionName}</h3><span className="hint">{view.objective}</span></header>
      <ul className="gc-people">
        {view.peoples.map((p) => (
          <li key={p.id}>
            <div>
              <strong>{p.name}</strong> <span className="muted small">{p.county}</span>
              {p.places?.length ? <div className="small muted">{p.places.join(' · ')}</div> : null}
            </div>
            <div className="gc-reading">
              {p.reading ? (
                <>
                  <span className="gc-phase">Phase {p.reading.phase === '0-R' ? '0-R' : p.reading.phase} · {phaseName(p.reading.phase)}</span>
                  <span className="small muted">{p.reading.strength} · {p.reading.corroboration} witness{p.reading.corroboration === 1 ? '' : 'es'} · round {p.reading.round}</span>
                </>
              ) : <span className="muted">no reading yet</span>}
              {p.need ? <span className="small gc-need">needs: {p.need}</span> : null}
            </div>
          </li>
        ))}
      </ul>
      {view.commitments.length ? (
        <>
          <h3>Commitments</h3>
          <ul className="gc-commits">
            {view.commitments.map((c) => (
              <li key={c.id} className={c.stale ? 'stale' : c.fulfilled ? 'done' : ''}>
                <strong>{view.cast.find((x) => x.role === c.by)?.name ?? c.by}</strong> offers <em>{c.resource}</em> against <em>{c.need}</em> for {view.peoples.find((p) => p.id === c.people)?.name ?? c.people}
                {c.fulfilled ? ' — carried out' : c.stale ? ' — STALE' : ` — round ${c.round}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** THE ROOM you are standing in: its rule, who is here, where you can go. */
function Room({ view, act }: { view: CommissionView; act: (a: unknown) => void }) {
  const [text, setText] = useState('');
  const [whisperTo, setWhisperTo] = useState<string | null>(null);
  const room = view.room;
  if (!room || !view.you) return null;
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (whisperTo) act({ type: 'whisper', to: whisperTo, text: t }); else act({ type: 'say', text: t });
    setText('');
  };
  return (
    <section className="panel mystery-room">
      <header>
        <h3>{room.name} <span className="tag gc-grain">rule: {room.grain} grain</span></h3>
        <p className="hint">{room.blurb}</p>
      </header>
      {room.people.length ? (
        <ul className="mystery-people">
          {room.people.map((p) => (
            <li key={p.role}>
              <Face look={p.look as never} name={p.name} size={22} />
              <strong>{p.name}</strong> <span className="muted small">{p.kind}{p.silent ? ' · gone quiet' : ''}{p.playedBy ? ` · ${p.playedBy}` : p.mind === 'agent' ? ` · ${p.agent}` : ''}</span>
              <button type="button" className="small" onClick={() => setWhisperTo(whisperTo === p.role ? null : p.role)}>{whisperTo === p.role ? 'whispering…' : 'whisper'}</button>
            </li>
          ))}
        </ul>
      ) : <p className="hint">Nobody else is here.</p>}
      {view.you.silent ? <p className="hint">You have gone quiet. Nothing you do reaches anybody.</p> : (
        <div className="mystery-say">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={whisperTo ? `Whisper to ${room.people.find((p) => p.role === whisperTo)?.name ?? whisperTo}…` : `Say something in ${room.name}…`} maxLength={280} />
          <button type="button" onClick={submit}>{whisperTo ? 'Whisper' : 'Say'}</button>
        </div>
      )}
      {room.board ? <Wall board={room.board} act={act} silent={view.you.silent} /> : null}
      <div className="mystery-doors">
        {room.doors.map((d) => (
          <button key={d.id} type="button" disabled={!d.open} title={d.open ? '' : 'not a member — the convener admits'} onClick={() => act({ type: 'move', room: d.id })}>
            → {d.name}{d.open ? '' : ' 🔒'}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * THE POST-IT WALL — anonymous by construction. Anybody in the room may put up a topic; the words and the round
 * travel, and no author ever does. It is the safest contribution the whole exercise allows, and a board of
 * them is how a group finds what it wants to talk about without anybody having to be the one who asked.
 */
function Wall({ board, act, silent }: { board: Array<{ id: string; text: string; round: number }>; act: (a: unknown) => void; silent: boolean }) {
  const [text, setText] = useState('');
  const put = () => { const t = text.trim(); if (!t) return; act({ type: 'post', text: t }); setText(''); };
  return (
    <div className="gc-wall">
      <h3>The wall <span className="hint">— topics, unsigned</span></h3>
      {board.length ? (
        <ul className="gc-postits">
          {board.map((p, i) => <li key={p.id} className={`gc-postit c${i % 3}`} style={{ transform: `rotate(${((i * 7) % 5) - 2}deg)` }}>{p.text}<span className="small muted">round {p.round}</span></li>)}
        </ul>
      ) : <p className="hint">Nothing on the wall yet.</p>}
      {!silent ? (
        <div className="mystery-say">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') put(); }} placeholder="Put up a topic — nobody will know it was you" maxLength={140} />
          <button type="button" onClick={put}>Post</button>
        </div>
      ) : null}
    </div>
  );
}

/** YOUR PART: the vault and the one decision that matters — the grain; then what your kind of part may do. */
function You({ view, act }: { view: CommissionView; act: (a: unknown) => void }) {
  const you = view.you;
  const [grainFor, setGrainFor] = useState<Record<string, Grain>>({});
  const [toFor, setToFor] = useState<Record<string, string>>({});
  const [countFor, setCountFor] = useState<Record<string, string>>({});
  const [assessPeople, setAssessPeople] = useState('');
  const [assessPhase, setAssessPhase] = useState<Phase>(1);
  const [assessStrength, setAssessStrength] = useState<Strength>('initial');
  const [commitPeople, setCommitPeople] = useState('');
  const [resource, setResource] = useState('');
  const [inferPeople, setInferPeople] = useState('');
  const [place, setVillage] = useState('');
  const [households, setHouseholds] = useState('');
  const [admitWho, setAdmitWho] = useState('');
  const [admitRoom, setAdmitRoom] = useState('');
  if (!you) return (
    <section className="panel mystery-you"><h3>Watching</h3><p className="hint">You are not in this story. The public picture is above; the room is not yours.</p></section>
  );
  const roomGrain = view.room?.grain ?? 'people';
  const nameOf = (r: string) => view.cast.find((c) => c.role === r)?.name ?? r;
  const peopleName = (p: string) => view.peoples.find((x) => x.id === p)?.name ?? p;
  return (
    <section className="panel mystery-you gc-you">
      <div className="mystery-you-head">
        <Face look={you.look as never} name={you.name} size={40} />
        <div><strong>{you.name}</strong><div className="muted small">{you.kind} · you</div></div>
      </div>
      <p className="hint">{you.blurb}</p>
      <p className="hint mystery-secret"><b>Yours alone:</b> {you.secret}</p>

      <h3>Your vault</h3>
      {you.vault.length === 0 ? <p className="hint">You hold no testimony. What you have is what others show you.</p> : null}
      <ul className="gc-vault">
        {you.vault.map((v) => {
          const grain = grainFor[v.id] ?? (v.projections.find((p) => p.allowedHere)?.grain ?? v.grain);
          const proj = v.projections.find((p) => p.grain === grain) ?? v.projections[0];
          return (
            <li key={v.id} className={v.revoked ? 'revoked' : ''}>
              <div><strong>{peopleName(v.people)}</strong> <span className="muted small">held at {v.grain} · supports Phase {v.supports} {PHASE_NAMES[v.supports]}{v.count !== undefined ? ` · count ${v.count}` : ''}</span></div>
              <div className="small">“{v.text}”</div>
              {v.revoked ? <div className="small muted">withdrawn</div> : (
                <div className="gc-slip">
                  <label>as
                    <select value={grain} onChange={(e) => setGrainFor({ ...grainFor, [v.id]: e.target.value as Grain })}>
                      {v.projections.map((p) => <option key={p.grain} value={p.grain}>{p.grain}{p.allowedHere ? '' : ' — finer than this room allows'}</option>)}
                    </select>
                  </label>
                  <label>to
                    <select value={toFor[v.id] ?? ''} onChange={(e) => setToFor({ ...toFor, [v.id]: e.target.value })}>
                      <option value="">the room</option>
                      {(view.room?.people ?? []).map((p) => <option key={p.role} value={p.role}>{p.name}</option>)}
                    </select>
                  </label>
                  {v.count !== undefined || you.kind !== 'researcher' ? (
                    <label>count <input value={countFor[v.id] ?? ''} onChange={(e) => setCountFor({ ...countFor, [v.id]: e.target.value })} placeholder={v.count !== undefined ? String(v.count) : 'none held'} size={4} /></label>
                  ) : null}
                  <div className="small muted">would say: “{proj?.text ?? v.text}”{proj && !proj.allowedHere ? ` — a LEAK in ${view.room?.name ?? 'this room'} (${roomGrain} grain)` : ''}</div>
                  <div className="row wrap">
                    <button type="button" onClick={() => act({ type: 'testify', people: v.people, evidence: v.id, grain, ...(toFor[v.id] ? { to: toFor[v.id] } : {}), ...(countFor[v.id] ? { count: Number(countFor[v.id]) } : {}) })}>Testify</button>
                    <button type="button" onClick={() => act({ type: 'revoke', evidence: v.id })}>Withdraw</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {you.received.length ? (
        <>
          <h3>What you have been shown</h3>
          <ul className="gc-received">
            {you.received.map((r) => (
              <li key={r.disclosure} className={r.revoked ? 'revoked' : ''}>
                <strong>{nameOf(r.from)}</strong> on {peopleName(r.people)} <span className="muted small">at {r.grain} · supports Phase {r.supports}{r.revoked ? ' · withdrawn' : ''}</span>
                <div className="small">“{r.text}”</div>
                {!r.revoked ? <button type="button" className="small" onClick={() => act({ type: 'corroborate', people: r.people, phase: r.supports })}>Confirm (Phase {r.supports})</button> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {you.kind === 'researcher' ? (
        <>
          <h3>Publish a reading</h3>
          <div className="gc-form">
            <select value={assessPeople} onChange={(e) => setAssessPeople(e.target.value)}><option value="">a people…</option>{view.peoples.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select value={String(assessPhase)} onChange={(e) => setAssessPhase(e.target.value === '0-R' ? '0-R' : Number(e.target.value) as Phase)}>{PHASES.map((p) => <option key={String(p)} value={String(p)}>Phase {String(p)} · {phaseName(p)}</option>)}</select>
            <select value={assessStrength} onChange={(e) => setAssessStrength(e.target.value as Strength)}>{STRENGTHS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button type="button" disabled={!assessPeople} onClick={() => act({ type: 'assess', people: assessPeople, phase: assessPhase, strength: assessStrength })}>Publish</button>
          </div>
          <p className="hint">Publish what two witnesses will stand behind. The count travels; their names never do.</p>
        </>
      ) : null}

      {you.kind === 'funder' || you.kind === 'agency' ? (
        <>
          <h3>Commit against a need</h3>
          <div className="gc-form">
            <select value={commitPeople} onChange={(e) => setCommitPeople(e.target.value)}><option value="">a people with a published need…</option>{view.peoples.filter((p) => p.need).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.need}</option>)}</select>
            <input value={resource} onChange={(e) => setResource(e.target.value)} placeholder="what you offer" maxLength={120} />
            <button type="button" disabled={!commitPeople || !resource.trim()} onClick={() => { const need = view.peoples.find((p) => p.id === commitPeople)?.need; if (need) act({ type: 'commit', people: commitPeople, need, resource: resource.trim() }); }}>Commit</button>
          </div>
          {view.commitments.filter((c) => c.by === you.role && !c.fulfilled).map((c) => (
            <button key={c.id} type="button" className="small" onClick={() => act({ type: 'fulfil', commitment: c.id })}>Carry out: {c.resource} for {peopleName(c.people)}</button>
          ))}
        </>
      ) : null}

      {you.kind === 'convener' ? (
        <>
          <h3>Admit somebody to a room</h3>
          <div className="gc-form">
            <select value={admitWho} onChange={(e) => setAdmitWho(e.target.value)}><option value="">who…</option>{view.cast.filter((c) => c.role !== you.role).map((c) => <option key={c.role} value={c.role}>{c.name}</option>)}</select>
            <select value={admitRoom} onChange={(e) => setAdmitRoom(e.target.value)}><option value="">to…</option>{view.rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.grain})</option>)}</select>
            <button type="button" disabled={!admitWho || !admitRoom} onClick={() => act({ type: 'admit', who: admitWho, room: admitRoom })}>Admit</button>
          </div>
        </>
      ) : null}

      {you.source ? (
        <>
          <h3>Your inference</h3>
          <div className="gc-form">
            <select value={inferPeople} onChange={(e) => { setInferPeople(e.target.value); setVillage(''); }}><option value="">a people…</option>{view.peoples.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select value={place} onChange={(e) => setVillage(e.target.value)}><option value="">which place…</option>{(view.peoples.find((p) => p.id === inferPeople)?.places ?? []).map((v) => <option key={v} value={v}>{v}</option>)}</select>
            <input value={households} onChange={(e) => setHouseholds(e.target.value)} placeholder="households" size={5} />
            <button type="button" disabled={!inferPeople} onClick={() => act({ type: 'infer', people: inferPeople, ...(place ? { place } : {}), ...(households ? { households: Number(households) } : {}) })}>Infer</button>
          </div>
          <p className="hint">Your last inference per people is the one scored. If you name the place, the rails failed.</p>
        </>
      ) : null}

      {view.choices.length ? (
        <>
          <h3>Before you</h3>
          {view.choices.map((c) => (
            <div key={c.id} className="mystery-choice">
              <p>{c.question}</p>
              <div className="row wrap">{c.options.map((o) => <button key={o.id} type="button" onClick={() => act({ type: 'choose', choice: c.id, option: o.id })}>{o.label}</button>)}</div>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

function Cast({ view }: { view: CommissionView }) {
  return (
    <section className="panel mystery-cast">
      <h3>Everyone in the marches</h3>
      <ul>
        {view.cast.map((c) => (
          <li key={c.role} className={c.silent ? 'dead' : ''}>
            <Face look={c.look as never} name={c.name} size={20} />
            <strong>{c.name}</strong>
            <span className="muted small">{c.kind} · {c.roomName ?? '—'}{c.silent ? ' · gone quiet' : ''}{c.playedBy ? ` · ${c.playedBy}` : c.mind === 'agent' ? ` · ${c.agent}` : c.mind === 'rules' ? ' · the house' : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Transcript({ view }: { view: CommissionView }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [view.transcript.length]);
  const name = (r: string) => view.cast.find((c) => c.role === r)?.name ?? r;
  const people = (p: string) => view.peoples.find((x) => x.id === p)?.name ?? p;
  return (
    <section className="panel mystery-transcript" aria-live="polite" ref={ref}>
      {view.transcript.map((e, i) => <Line key={`${e.at}-${i}`} e={e} name={name} people={people} you={view.you?.role ?? null} />)}
    </section>
  );
}

function Line({ e, name, people, you }: { e: CommissionEvent; name: (r: string) => string; people: (p: string) => string; you: string | null }) {
  switch (e.type) {
    case 'cue': return <p className="m-cue">{e.text}</p>;
    case 'round': return <p className="m-act">{e.phase === 'closing' ? 'THE CLOSING' : e.phase === 'interlude' ? `end of round ${e.round}` : `ROUND ${e.round}`}</p>;
    case 'revealed': return <p className="m-act">THE REVEAL</p>;
    case 'said': return <p><strong>{name(e.by)}</strong> {e.text}</p>;
    case 'whispered': return <p className="m-words"><strong>{name(e.by)}</strong> <em>whispers to {name(e.to)}:</em> {e.text}</p>;
    case 'moved': return <p className="m-move">{name(e.who)} goes through to another room.</p>;
    case 'admitted': return <p className="m-move">{name(e.by)} admits {name(e.who)}.</p>;
    case 'testified': return <p className={e.leak ? 'gc-leak' : ''}><strong>{name(e.by)}</strong> <em>testifies at {e.grain} grain{e.to ? ` to ${name(e.to)}` : ''}:</em> {e.text}{e.leak && e.by === you ? <span className="small"> — finer than this room allows</span> : null}</p>;
    case 'assessed': return <p className="m-cue"><strong>{name(e.by)}</strong> publishes {people(e.people)}: Phase {String(e.phase)} · {phaseName(e.phase)}, {e.strength}, {e.corroboration} witness{e.corroboration === 1 ? '' : 'es'}. Needs: {e.need}.</p>;
    case 'corroborated': return <p className="m-move">A witness confirms {people(e.people)} at Phase {String(e.phase)} — {e.corroboration} now.</p>;
    case 'committed': return <p><strong>{name(e.by)}</strong> commits <em>{e.resource}</em> against “{e.need}” for {people(e.people)}.</p>;
    case 'fulfilled': return <p className="m-move">{name(e.by)} carries out a commitment.</p>;
    case 'revoked': return <p className="m-move">{name(e.by)} withdraws what they said about {people(e.people)}.</p>;
    case 'replayed': return <p className="gc-leak">You stood on a withdrawn slip. Refused, and recorded.</p>;
    case 'fabricated': return <p className="gc-leak">You asserted a number your vault does not hold ({e.count}). Recorded.</p>;
    case 'inferred': return <p className="m-move">You make an inference about {people(e.people)}.</p>;
    case 'chose': return <p className="m-cue">{e.text}</p>;
    case 'silent': return <p className="m-cue">{name(e.role)} has gone quiet. Nothing has come from them since round {e.round}.</p>;
    default: return null;
  }
}

function Reveal({ view, onAgain, busy }: { view: CommissionView; onAgain: () => void; busy: boolean }) {
  const r = view.reveal;
  if (!r) return null;
  const sc = r.score;
  const people = (p: string) => view.peoples.find((x) => x.id === p)?.name ?? p;
  const name = (x: string) => view.cast.find((c) => c.role === x)?.name ?? x;
  const verdict = sc.verdict === 'rails-held' ? 'THE RAILS HELD' : sc.verdict === 'rails-failed' ? 'THE RAILS FAILED' : 'NOTHING FOUND';
  return (
    <section className={`panel mystery-reveal gc-reveal ${sc.verdict}`}>
      <h3>{verdict}</h3>
      <p className="hint">{sc.verdict === 'rails-held' ? 'The picture found the motion and the adversary did not find the person.' : sc.verdict === 'rails-failed' ? 'The adversary named a place. Whatever the picture found, somebody was found first.' : 'Nobody was found — and neither was the motion. A quiet night is not a safe night.'}</p>
      <h3>Detection</h3>
      <ul className="gc-score">
        {sc.detection.map((d) => <li key={d.people} className={d.hit ? 'hit' : 'miss'}>{people(d.people)}: read {d.assessed === null ? 'nothing' : `Phase ${String(d.assessed)}`}, was Phase {String(d.actual)}{d.hit ? ` — right${d.lagRounds ? `, ${d.lagRounds} round${d.lagRounds === 1 ? '' : 's'} late` : ''}` : ' — wrong'}</li>)}
      </ul>
      <h3>Exposure</h3>
      <ul className="gc-score">
        {sc.exposure.map((x) => <li key={x.people} className={x.place ? 'miss' : 'hit'}>{people(x.people)}: {x.place ? `the place was named (${r.truth[x.people]?.place})` : 'the place was not found'}{x.households ? ', and the household count' : ''}</li>)}
      </ul>
      {sc.leaks.length ? <><h3>Leaks</h3><ul className="gc-score">{sc.leaks.map((l, i) => <li key={i} className="miss">{name(l.by)} spoke {people(l.people)} at {l.grain} grain in a {l.allowed}-grain room, round {l.round}</li>)}</ul></> : <p className="hint">No leaks.</p>}
      {sc.fabrications.length ? <><h3>Fabrications</h3><ul className="gc-score">{sc.fabrications.map((f, i) => <li key={i} className="miss">{name(f.by)} asserted {f.count} for {people(f.people)} with nothing behind it, round {f.round}</li>)}</ul></> : <p className="hint">No fabrications.</p>}
      {sc.replays.length ? <><h3>Replays</h3><ul className="gc-score">{sc.replays.map((x, i) => <li key={i} className="miss">{name(x.by)} stood on a withdrawn slip, round {x.round}</li>)}</ul></> : null}
      {sc.stale.length ? <><h3>Stale</h3><ul className="gc-score">{sc.stale.map((s, i) => <li key={i} className="miss">{people(s.people)} still read as Phase {String(s.assessedPhase)} after its carrier went quiet in round {s.sinceRound}</li>)}</ul></> : null}
      <p className="hint small">Seed {r.seed.slice(0, 16)}… — the same scenario and seed replay this night exactly.</p>
      <button type="button" className="primary" disabled={busy} onClick={onAgain}>Another night in the marches</button>
    </section>
  );
}
