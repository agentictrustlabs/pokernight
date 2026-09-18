/**
 * A GREAT COMMISSION NIGHT — the page (docs/GREAT-COMMISSION.md §10).
 *
 * The mystery page's shape, because it is the same kind of place: the whole window, two height-bounded columns,
 * the transcript that is the room, a side that is YOUR PART. What differs is what a part is for. The main column
 * leads with the meeting house, then THE BOARD: five peoples, the reading published for each and the need it
 * emitted, which is the whole object of the night. Your side leads with your VAULT, each item with the grains it
 * may be spoken at here, because choosing the grain is the one decision anybody is ever judged on.
 *
 * THE ACTIVITIES ARE THE PAGE (2026-09-18, after a design pass on the owner's verdict "I cannot see the activities
 * because they scroll at the bottom of the page"). Four panels each took a fixed slice of the height and the
 * transcript got what was left — three lines. Now the picture, the board and the room are content-sized STRIPS
 * and the transcript takes the remainder, with filters (all · this room · to me · testimony · readings) and a rule
 * between rounds. A WHISPER IS A TARGET CHIP ON THE TALK BOX, never a button that says "whispering…": pressing a
 * name — in the room, in the cast, or in the picture — arms the chip, × clears it, and the button says Say or
 * Send. THE CAST LIST SAYS WHERE EVERYBODY IS AND PRESSING A NAME WALKS YOU THERE, as the mystery's does. What
 * you have been shown is GROUPED — the same slip from the same person is one row with a count and one Confirm.
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
import { planFor } from '../components/commission/plan';

/** THE ENGINE NEVER AT MODULE TIME: PlayCanvas is loaded when somebody walks into a room, like the lounge's. */
const Venue = lazy(() => import('../components/mystery/Venue').then((m) => ({ default: m.Venue })));

/**
 * THE MEETING HOUSE, DRAWN BY THE MYSTERY'S VENUE. The venue reads a mystery's view — a room with props and a
 * death, a cast with `alive` — so a commission's view is handed to it in that shape: the room's things are the
 * plan's own features (the map, the wall, the hearth), nobody is dead, and a part gone silent is drawn where
 * they stood. Nothing here is a fact of the game; it is how the game is drawn.
 */
function asVenueView(v: CommissionView): MysteryView {
  const plan = v.room ? planFor(v.region)[v.room.id] : undefined;
  const props = (plan?.things ?? []).filter((t) => t.prop).map((t) => ({ id: t.prop!, name: t.label ?? t.prop!, examined: false }));
  const person = (p: CommissionView['cast'][number]) => ({
    role: p.role, name: p.name, operator: p.operator, agent: p.agent, alive: !p.silent, look: p.look, part: p.kind,
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
  /** WHO A WHISPER GOES TO — armed by pressing a name anywhere (the room strip, the cast, a body in the picture). */
  const [whisperTo, setWhisperTo] = useState<string | null>(null);
  const [looking, setLooking] = useState<{ kind: 'person' | 'thing'; id: string } | null>(null);
  // A target who has left the room is no target: the chip clears itself rather than sending into the wrong room.
  useEffect(() => { if (whisperTo && view?.room && !view.room.people.some((p) => p.role === whisperTo)) setWhisperTo(null); }, [view?.room?.id, view?.room?.people.length]);
  /** A DOOR IS WALKED THROUGH, not teleported: the room takes the move and sends it down the socket on arrival. */
  const actThroughRoom = (a: unknown) => {
    const m = a as { type?: string; room?: string };
    if (m?.type === 'move' && m.room && venue.current?.goThrough(m.room)) return;
    sock?.act(a);
  };
  const roundLabel = useMemo(() => (view ? (view.phase === 'closing' ? 'The closing' : view.phase === 'revealed' ? 'The reveal' : `Round ${view.round} · ${view.roundName}`) : ''), [view]);

  if (!session) return <div className="page"><section className="panel"><p className="hint">Sign in to come to the night.</p></section></div>;
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
                <Venue ref={venue} plan={planFor(view.region)} view={venueView} speaking={null} act={(a) => sock?.act(a)}
                  onPerson={(role) => setWhisperTo((cur) => (cur === role ? null : role))} onInspect={setLooking} />
                <Inspector view={view} looking={looking} onClose={() => setLooking(null)} />
              </div>
            </Suspense>
          ) : null}
          <Board view={view} />
          <Room view={view} act={actThroughRoom} whisperTo={whisperTo} setWhisperTo={setWhisperTo} />
          <Transcript view={view} />
        </main>
        <aside className="mystery-side">
          {view.reveal ? <Reveal view={view} onAgain={again} busy={busy} /> : null}
          <You view={view} act={act} />
          <Cast view={view} goTo={(role) => venue.current?.goTo(role) ?? false} />
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
  // The towns every people here shares — the county's own map, said once.
  const towns = view.peoples.length && view.peoples.every((p) => (p.places ?? []).join('·') === (view.peoples[0]!.places ?? []).join('·'))
    ? (view.peoples[0]!.places ?? [])
    : [];
  return (
    <section className="panel gc-board">
      {/* THE MAP IS THE REGION'S, NOT EACH PEOPLE'S. Every people in a county shares its towns, so the list is said
          once — on the title's tooltip, since a strip has one line for the objective. */}
      <header><h3 title={towns.length ? towns.join(' · ') : undefined}>The picture · {view.regionName}</h3><span className="hint">{view.objective}</span></header>
      {/* ONE ROW OF FIVE: a people and its reading — two lines a card; strength, witnesses, round and the need it
          emitted are on the card's tooltip. A strip, so the board is content-sized and the transcript gets the height. */}
      <ul className="gc-people">
        {view.peoples.map((p) => {
          const r = p.reading;
          const more = [r ? `${r.strength} · ${r.corroboration} witness${r.corroboration === 1 ? '' : 'es'} · round ${r.round}` : 'no reading published yet', p.need ? `needs: ${p.need}` : '', p.places?.length ? p.places.join(' · ') : ''].filter(Boolean).join('\n');
          return (
            <li key={p.id} title={more}>
              <strong>{p.name}</strong>
              {r ? <span className="gc-phase">Phase {r.phase === '0-R' ? '0-R' : r.phase} <span className="gc-phase-name">· {phaseName(r.phase)}</span> <span className="muted small">· {r.corroboration}w</span></span> : <span className="muted small">no reading</span>}
            </li>
          );
        })}
      </ul>
      {view.commitments.length ? (
        <details className="gc-fold">
          <summary>Commitments ({view.commitments.length})</summary>
          <ul className="gc-commits">
            {view.commitments.map((c) => (
              <li key={c.id} className={c.stale ? 'stale' : c.fulfilled ? 'done' : ''}>
                <strong>{view.cast.find((x) => x.role === c.by)?.name ?? c.by}</strong> offers <em>{c.resource}</em> against <em>{c.need}</em> for {view.peoples.find((p) => p.id === c.people)?.name ?? c.people}
                {c.fulfilled ? ' — carried out' : c.stale ? ' — STALE' : ` — round ${c.round}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * THE ROOM you are standing in: its rule, the talk box, who is here, where you can go. A strip, not a panel to
 * read. A WHISPER IS A TARGET ON THE BOX: press a name to arm it (again to disarm), × to clear, and the button
 * says what pressing it does — Say, or Send. There is no button whose own label changes to a participle.
 */
function Room({ view, act, whisperTo, setWhisperTo }: { view: CommissionView; act: (a: unknown) => void; whisperTo: string | null; setWhisperTo: (r: string | null) => void }) {
  const room = view.room;
  if (!room || !view.you) return null;
  const toggle = (role: string) => setWhisperTo(whisperTo === role ? null : role);
  return (
    <section className="panel mystery-room gc-room">
      <header>
        <h3>{room.name} <span className="tag gc-grain">rule: {room.grain} grain</span></h3>
        <p className="hint">{room.blurb}</p>
      </header>
      {view.you.silent ? <p className="hint">You have gone quiet. Nothing you do reaches anybody.</p> : (
        <TalkBox room={room} target={whisperTo} onTarget={setWhisperTo} act={act} />
      )}
      <p className="gc-here small">
        <span className="muted">Here: </span>
        {room.people.length ? room.people.map((p, i) => (
          <span key={p.role}>{i ? ', ' : ''}
            <button type="button" className="gc-here-chip" aria-pressed={whisperTo === p.role} title={`${p.kind}${p.silent ? ', gone quiet' : ''} — ${whisperTo === p.role ? 'stop whispering to' : 'whisper to'} ${p.name}`} onClick={() => toggle(p.role)}>{p.name}</button>
            {p.silent ? <span className="muted"> (quiet)</span> : null}
          </span>
        )) : <span className="muted">nobody else.</span>}
        <span className="muted small"> (press a name to whisper)</span>
      </p>
      <div className="mystery-doors">
        {room.doors.map((d) => (
          <button key={d.id} type="button" disabled={!d.open} title={d.open ? `Go through to ${d.name}` : 'not a member — the convener admits'} aria-label={d.open ? undefined : `${d.name}, not open to you — the convener admits`} onClick={() => act({ type: 'move', room: d.id })}>
            → {d.name}{d.open ? '' : ' 🔒'}
          </button>
        ))}
      </div>
      {room.board ? (
        <details className="gc-fold">
          <summary>The wall ({room.board.length}) <span className="hint">— topics, unsigned</span></summary>
          <Wall board={room.board} act={act} silent={view.you.silent} />
        </details>
      ) : null}
    </section>
  );
}

/** The one box for saying and whispering. The target is a chip IN the box, so what will happen is on the screen. */
function TalkBox({ room, target, onTarget, act }: { room: NonNullable<CommissionView['room']>; target: string | null; onTarget: (r: string | null) => void; act: (a: unknown) => void }) {
  const [text, setText] = useState('');
  const targetName = room.people.find((p) => p.role === target)?.name;
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    act(target ? { type: 'whisper', to: target, text: t } : { type: 'say', text: t });
    setText('');
  };
  return (
    <div className="mystery-say gc-talk">
      {target ? (
        <span className="gc-talk-target">To {targetName ?? target}
          <button type="button" aria-label={`Stop whispering to ${targetName ?? target}`} onClick={() => onTarget(null)}>×</button>
        </span>
      ) : null}
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={target ? `Whisper to ${targetName ?? target}…` : `Say something in ${room.name}…`} maxLength={280} />
      <button type="button" onClick={submit}>{target ? 'Send' : 'Say'}</button>
    </div>
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
  // Slips you have had a moment to see; a slip not in here is marked new. A ref, so marking them is not a render.
  const seen = useRef(new Set<string>());
  const receivedCount = you?.received.length ?? 0;
  useEffect(() => {
    const t = setTimeout(() => { for (const r of you?.received ?? []) seen.current.add(r.disclosure); }, 4000);
    return () => clearTimeout(t);
  }, [receivedCount]);
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
          {/* THE SAME SLIP FROM THE SAME PERSON IS ONE ROW: a count, one Confirm, and a mark while it is new. */}
          <ul className="gc-received">
            {groupReceived(you.received).map((g) => (
              <li key={g.key} className={g.live ? '' : 'revoked'}>
                {g.ids.some((id) => !seen.current.has(id)) ? <span className="gc-received-new" title="new" /> : null}
                <strong>{nameOf(g.first.from)}</strong> on {peopleName(g.first.people)}{g.count > 1 ? <span className="gc-received-count">×{g.count}</span> : null} <span className="muted small">at {g.first.grain} · supports Phase {g.first.supports}{g.live ? '' : ' · withdrawn'}</span>
                <div className="small">“{g.first.text}”</div>
                {g.live ? <button type="button" className="small" onClick={() => act({ type: 'corroborate', people: g.first.people, phase: g.first.supports })}>Confirm (Phase {g.first.supports})</button> : null}
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

/**
 * EVERYONE, WHERE THEY ARE, AND A WAY THERE. Each row says the room a person is in; pressing it walks your own
 * body to them through however many doors it takes (`venue.goTo`, the mystery's precedent). A door shut to you
 * stops the walk at the door, and the row says so.
 */
function Cast({ view, goTo }: { view: CommissionView; goTo: (role: string) => boolean }) {
  const [missed, setMissed] = useState<string | null>(null);
  return (
    <section className="panel mystery-cast">
      <h3 className="eyebrow-h">Everyone in {view.regionName}</h3>
      <ul>
        {view.cast.map((c) => {
          const you = c.role === view.you?.role;
          return (
            <li key={c.role} className={c.silent ? 'dead' : ''}>
              <button type="button" className="mystery-cast-row" disabled={you} onClick={() => setMissed(goTo(c.role) ? null : c.role)}
                title={you ? 'This is you' : `Walk to ${c.name}${c.roomName ? ` in ${c.roomName}` : ''}`}>
                <Face look={c.look as never} name={c.name} size={20} />
                <strong>{c.name}</strong>
                <span className="muted small">
                  {c.kind}{you ? ' · you' : c.playedBy ? ` · ${c.playedBy}` : c.mind === 'agent' ? ` · ${c.agent}` : c.mind === 'rules' ? ' · the house' : ''}
                  {c.roomName ? <> · in <span className="mystery-where">{c.roomName}</span></> : ' · not placed yet'}
                  {c.silent ? ' · gone quiet' : ''}
                </span>
              </button>
              {missed === c.role ? <em className="hint mystery-elsewhere">no way there from here — a room on the way may be shut to you; the convener admits.</em> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What is pressed in the picture: a person (who they are, which part, who plays them) or a thing. */
function Inspector({ view, looking, onClose }: { view: CommissionView; looking: { kind: 'person' | 'thing'; id: string } | null; onClose: () => void }) {
  if (!looking) return null;
  let name = '', lines: string[] = [], look: CommissionView['cast'][number]['look'] | null = null;
  if (looking.kind === 'person') {
    const p = view.cast.find((c) => c.role === looking.id);
    if (!p) return null;
    name = p.name; look = p.look;
    lines = [
      `${p.kind}${p.role === view.you?.role ? ' — you' : ''}`,
      p.appearance ?? '',
      p.role === view.you?.role ? '' : p.playedBy ? `Played by ${p.playedBy}.` : p.mind === 'agent' ? `Played by their own agent, ${p.agent}.` : 'Played by the house.',
      p.roomName ? `In ${p.roomName}.` : '',
      p.silent ? 'Gone quiet — nothing has come from them.' : '',
    ].filter(Boolean);
  } else {
    const plan = view.room ? planFor(view.region)[view.room.id] : undefined;
    const t = (plan?.things ?? []).find((x) => x.prop === looking.id);
    if (!t) return null;
    name = t.label ?? looking.id;
    lines = [(t as { detail?: string }).detail ?? 'A thing in the room. Nothing about it says anything yet.'];
  }
  return (
    <aside className="mystery-inspector">
      <button type="button" className="mystery-inspector-close" onClick={onClose} aria-label="Stop looking at this">×</button>
      <div className="mystery-inspector-head">
        {look ? <Face look={look as never} name={name} size={40} /> : null}
        <h3>{name}</h3>
      </div>
      {lines.map((l, i) => <p key={i} className={i === 0 ? '' : 'hint'}>{l}</p>)}
    </aside>
  );
}

/** THE SAME SLIP FROM THE SAME PERSON IS ONE ROW: grouped by who, what, at which grain, in which words. */
function groupReceived(received: CommissionView['you'] extends infer Y ? Y extends { received: infer R } ? R extends ReadonlyArray<infer T> ? T[] : never : never : never) {
  const groups = new Map<string, { key: string; first: (typeof received)[number]; count: number; live: boolean; ids: string[] }>();
  for (const r of received) {
    const key = `${r.from}|${r.people}|${r.grain}|${r.supports}|${r.text}`;
    const g = groups.get(key) ?? { key, first: r, count: 0, live: false, ids: [] };
    g.count++; g.ids.push(r.disclosure); if (!r.revoked) g.live = true;
    groups.set(key, g);
  }
  return [...groups.values()];
}

const FILTERS = [['all', 'All'], ['room', 'This room'], ['tome', 'To me'], ['testimony', 'Testimony'], ['readings', 'Readings']] as const;
type Filter = (typeof FILTERS)[number][0];
/** Night-wide markers (a round, a cue, a reveal, somebody gone quiet) show under every filter. */
function matches(e: CommissionEvent, f: Filter, roomId: string | undefined, you: string | null): boolean {
  if (f === 'all') return true;
  if (e.type === 'cue' || e.type === 'round' || e.type === 'revealed' || e.type === 'silent') return true;
  if (f === 'room') return 'room' in e && e.room === roomId;
  if (f === 'tome') return (e.type === 'whispered' && e.to === you) || (e.type === 'testified' && e.to === you) || (e.type === 'admitted' && e.who === you);
  if (f === 'testimony') return e.type === 'testified' || e.type === 'replayed' || e.type === 'fabricated' || e.type === 'revoked';
  return e.type === 'assessed' || e.type === 'corroborated';
}

/** THE ACTIVITIES: everything that happened, filtered, with a rule between rounds — and the height left over. */
function Transcript({ view }: { view: CommissionView }) {
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [view.transcript.length, filter]);
  const name = (r: string) => view.cast.find((c) => c.role === r)?.name ?? r;
  const people = (p: string) => view.peoples.find((x) => x.id === p)?.name ?? p;
  const you = view.you?.role ?? null;
  const shown = view.transcript.filter((e) => matches(e, filter, view.room?.id, you));
  return (
    <section className="panel mystery-transcript gc-transcript">
      <div className="gc-filter-row" role="tablist" aria-label="Show">
        {FILTERS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={filter === id} className={`gc-filter${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      {/* Live only while unfiltered: re-filtering swaps every line, and that churn is not news. */}
      <div className="gc-lines" aria-live={filter === 'all' ? 'polite' : 'off'} ref={ref}>
        {shown.map((e, i) => <Line key={`${e.at}-${i}`} e={e} name={name} people={people} you={you} />)}
        {!shown.length ? <p className="hint">Nothing here yet.</p> : null}
      </div>
    </section>
  );
}

function Line({ e, name, people, you }: { e: CommissionEvent; name: (r: string) => string; people: (p: string) => string; you: string | null }) {
  switch (e.type) {
    case 'cue': return <p className="m-cue">{e.text}</p>;
    case 'round': return <p className="gc-round-divider">{e.phase === 'closing' ? 'The closing' : e.phase === 'interlude' ? `end of round ${e.round}` : `Round ${e.round}`}</p>;
    case 'revealed': return <p className="m-act">THE REVEAL</p>;
    case 'said': return <p><strong>{name(e.by)}</strong> {e.text}</p>;
    case 'whispered': return <p className={`m-words${e.to === you ? ' gc-tome' : ''}`}><strong>{name(e.by)}</strong> <em>whispers to {e.to === you ? 'you' : name(e.to)}:</em> {e.text}</p>;
    case 'moved': return <p className="m-move">{name(e.who)} goes through to another room.</p>;
    case 'admitted': return <p className="m-move">{name(e.by)} admits {name(e.who)}.</p>;
    case 'testified': return <p className={`${e.leak ? 'gc-leak' : ''}${e.to === you ? ' gc-tome' : ''}`}><strong>{name(e.by)}</strong> <em>testifies at {e.grain} grain{e.to ? ` to ${e.to === you ? 'you' : name(e.to)}` : ''}:</em> {e.text}{e.leak && e.by === you ? <span className="small"> — finer than this room allows</span> : null}</p>;
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
      <button type="button" className="primary" disabled={busy} onClick={onAgain}>Another night</button>
    </section>
  );
}
