import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { chooseAction, TITLES, type MysteryAction, type MysteryEvent, type MysteryView } from '@pokernight/mystery';
import type { AppSession } from '../lib/types';
import { mysteryApi } from '../lib/api';
import { MysterySocket, type MysteryClientState } from '../lib/mysterySocket';
import { castVoicesOn, hushCast, sayAs, setCastVoicesOn, voicesAvailable } from '../lib/castVoices';
import { HOME_HASH } from '../lib/routes';
import { Face } from '../components/mystery/Face';
import type { VenueHandle } from '../components/mystery/Venue';
import { HuddleAffordance } from '../components/huddle/ClubHuddleDock';
import { clubScope } from '../lib/huddle';
/** THE ROOM, DRAWN — a separate chunk, like the lounge: the engine never loads for somebody reading the page. */
const Venue = lazy(() => import('../components/mystery/Venue').then((m) => ({ default: m.Venue })));
/** The room's own audio — the club's huddle, silenced across doors (`RoomVoice`). */
const RoomVoice = lazy(() => import('../components/mystery/RoomVoice').then((m) => ({ default: m.RoomVoice })));
/** Can this browser draw it at all? Asked once, of a throwaway canvas whose context is released at once. */
function canDraw(): boolean {
  if (typeof document === 'undefined') return false;
  try { const c = document.createElement('canvas'); const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null; if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch { return false; }
}
import { Identity } from '../components/Identity';
import { Brand } from '../components/Brand';

/**
 * A NIGHT AT THE BELVEDERE — the place page (docs/MYSTERY-NIGHT.md §9).
 *
 * THIS IS THE PRIMARY CLIENT, not a fallback: everything the engine allows is a control here, the whole
 * mystery is playable with no WebGL, no microphone and no agent of your own, and it is the surface the
 * engine is tested against. The 3D venue, when it comes, is a second presentation of exactly this staging.
 *
 * ONE CHARACTER'S VIEW COMES DOWN THE SOCKET and nothing else does — the transcript is what you heard, the
 * clue book is what you hold, and the killer is named in one person's view all night.
 */
export function MysteryPage({ stagingId, session, onSignOut }: { stagingId: string; session: AppSession | null; onSignOut: () => void }) {
  const sock = useRef<MysterySocket | null>(null);
  const [, bump] = useState(0);
  const redraw = useMemo(() => () => bump((n) => n + 1), []);
  const [line, setLine] = useState('');
  const [whisperTo, setWhisperTo] = useState<string | null>(null);
  const venue = useRef<VenueHandle | null>(null);
  /**
   * EVERY ACT GOES THROUGH THE ROOM FIRST. Pressing "look again at the drinks tray" in the list should walk
   * you to the drinks tray exactly as clicking it in the picture does — the controls and the things are the
   * same acts, and half a game that moves your body and half that teleports your attention is two games.
   * The room takes the two acts that are journeys; everything else goes straight down the socket.
   */
  const act = useMemo(() => (a: unknown) => {
    const move = a as { type?: string; prop?: string; room?: string };
    if (move?.type === 'examine' && move.prop && venue.current?.approach(move.prop)) return;
    if (move?.type === 'move' && move.room && venue.current?.goThrough(move.room)) return;
    sock.current?.act(a);
  }, []);
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState(() => castVoicesOn());
  /** Who is talking right now, so the room can show it — cleared a few seconds after their line lands. */
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [webgl] = useState<boolean>(() => canDraw());
  const [drawn, setDrawn] = useState<boolean>(() => { try { return localStorage.getItem('pokernight.mystery.flat') !== '1'; } catch { return true; } });
  const speakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** How far down the transcript the voice has read, so a reconnect does not say the whole night again. */
  const spoken = useRef<number>(-1);

  useEffect(() => {
    if (!session) return;
    const s = new MysterySocket(stagingId, session.token, redraw);
    sock.current = s;
    return () => { s.close(); sock.current = null; };
  }, [stagingId, session?.token, redraw]);

  const st: MysteryClientState | null = sock.current?.state ?? null;
  const view = st?.view ?? null;

  /**
   * THE CAST, OUT LOUD. Only what is NEW, only what somebody else said, and never your own typing read back
   * at you. The house's cues are read too, in the low slow voice, because an act opening is a voice-over.
   */
  useEffect(() => {
    if (!view) return;
    const t = view.transcript;
    if (spoken.current < 0) { spoken.current = t.length; return; } // arriving mid-night says nothing
    for (let i = spoken.current; i < t.length; i++) {
      const e = t[i];
      if (!e) continue;
      if (e.type === 'said' && e.by !== view.you?.role) {
        sayAs(e.by, e.text);
        // THE ROOM SHOWS WHO IS TALKING: their face lights and its mouth moves while the line is theirs.
        setSpeaking(e.by);
        if (speakingTimer.current) clearTimeout(speakingTimer.current);
        speakingTimer.current = setTimeout(() => setSpeaking(null), Math.min(6000, 1200 + e.text.length * 55));
      } else if (e.type === 'cue') sayAs('house', e.text);
      else if (e.type === 'died') sayAs('house', `${view.cast.find((c) => c.role === e.victim)?.name ?? 'somebody'} is dead.`);
      else if (e.type === 'spared') sayAs('house', 'Nobody died. But somebody was through that room in the dark.');
    }
    spoken.current = t.length;
  }, [view?.transcript.length, view]);
  useEffect(() => () => { hushCast(); if (speakingTimer.current) clearTimeout(speakingTimer.current); }, []);

  if (!session) return <div className="panel"><p className="hint">Sign in to play.</p></div>;

  return (
    <div className="mystery">
      <div className="topbar">
        <Brand />
        <span className="meta">
          <strong>{view?.titleName ?? 'A mystery'}</strong>
          {view ? <span className="tag">{view.phase === 'revealed' ? 'the reveal' : `act ${view.act} · ${view.actName}`}</span> : null}
          {view && view.phase !== 'revealed' ? <Clock deadline={view.deadline} paused={st?.staging?.paused === true} /> : null}
        </span>
        <span className="spacer" />
        <span className="meta">
          {st?.staging?.club ? (
            <HuddleAffordance scope={clubScope({ clubId: st.staging.club })} scopeName={`${view?.titleName ?? 'the night'} · this room`} compact />
          ) : null}
          {webgl ? (
            <button
              type="button"
              className={`tag seat-tag${drawn ? ' out' : ''}`}
              onClick={() => { const on = !drawn; setDrawn(on); try { localStorage.setItem('pokernight.mystery.flat', on ? '0' : '1'); } catch { /* this tab only */ } }}
              title={drawn ? 'Hide the room and read it instead' : 'Draw the room'}
            >
              {drawn ? 'the room' : 'the words'}
            </button>
          ) : null}
          {voicesAvailable() ? (
            <button
              type="button"
              className={`tag seat-tag${voices ? ' out' : ''}`}
              title={voices ? 'The cast is being read aloud' : 'Have the cast read aloud'}
              onClick={() => { const on = !voices; setVoices(on); setCastVoicesOn(on); }}
            >
              {voices ? 'voices on' : 'voices off'}
            </button>
          ) : null}
          {view && view.phase !== 'revealed' ? (
            <button type="button" className="tag seat-tag" onClick={() => sock.current?.pause(!(st?.staging?.paused === true))}>
              {st?.staging?.paused ? 'Carry on' : 'Hold the night'}
            </button>
          ) : null}
          <a className="tag leave-tag" href={HOME_HASH}>Leave</a>
          <span className={`conn ${st?.connection ?? 'connecting'}`}>{st?.connection ?? 'connecting'}</span>
          <Identity session={session} onSignOut={onSignOut} />
        </span>
      </div>

      {!view ? (
        <div className="page"><section className="panel"><p className="hint">Walking in…</p></section></div>
      ) : (
        <div className="page mystery-page">
          <main className="mystery-main">
            {st?.staging?.paused ? <div className="held-banner">Held. Nothing moves — not even them — until you carry on.</div> : null}
            {view.reveal ? <Reveal view={view} onAgain={async () => {
              setBusy(true);
              try { await mysteryApi.solo({ title: view.title, role: view.you?.role, restart: true }, session.token); location.reload(); } finally { setBusy(false); }
            }} busy={busy} /> : null}
            {/* THE PICTURE FIRST, the words under it: a mystery is watched and listened to, and read when
                you want to go back over what somebody said. */}
            {webgl && drawn && view.room ? (
              <Suspense fallback={<div className="venue venue-loading"><p className="hint">Walking in…</p></div>}>
                <Venue ref={venue} view={view} speaking={speaking} act={(a) => sock.current?.act(a)} onPerson={(role) => setWhisperTo(role)} />
              </Suspense>
            ) : null}
            {/* A CLUB'S NIGHT HAS A CALL, and it stays in the room it is spoken in. A night of your own has
                nobody to talk to, so there is nothing to place. */}
            {st?.staging?.club && view.room ? (
              <Suspense fallback={null}><RoomVoice view={view} /></Suspense>
            ) : null}
            <Transcript view={view} speaking={speaking} />
            {view.phase !== 'revealed' ? (
              <form
                className="mystery-say"
                onSubmit={(e) => { e.preventDefault(); const t = line.trim(); if (t) { sock.current?.say(t); setLine(''); } }}
              >
                <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={280} placeholder={view.you ? `Say something as ${view.you.name}` : 'You are watching this one'} disabled={!view.you} />
                <button type="submit" className="primary" disabled={!line.trim() || !view.you}>Say it</button>
              </form>
            ) : null}
            {st?.error ? <div className="form-error">{st.error}</div> : null}
            <Room view={view} act={act} speaking={speaking} whisperTo={whisperTo} onWhisperTo={setWhisperTo} />
          </main>
          <aside className="mystery-side">
            <You view={view} act={act} />
            <Clues view={view} act={act} />
            <Cast view={view} act={act} speaking={speaking} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** The act's clock. A held night shows the hold rather than a number that is not running. */
function Clock({ deadline, paused }: { deadline: number | null; paused: boolean }) {
  const [, bump] = useState(0);
  useEffect(() => { const t = setInterval(() => bump((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (paused) return <span className="tag">held</span>;
  if (deadline === null) return null;
  const left = Math.max(0, deadline - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <span className="num mystery-clock">{m}:{String(s).padStart(2, '0')}</span>;
}

/** WHERE YOU ARE, and everything you can do about it: the people, the things, the doors. */
function Room({ view, act, speaking, whisperTo, onWhisperTo }: { view: MysteryView; act: (a: unknown) => void; speaking: string | null; whisperTo?: string | null; onWhisperTo?: (r: string | null) => void }) {
  const [whisper, setWhisper] = useState<{ to: string; text: string } | null>(null);
  // CLICKING SOMEBODY IN THE ROOM opens the same line you would open from the list under it.
  useEffect(() => { if (whisperTo) setWhisper({ to: whisperTo, text: '' }); }, [whisperTo]);
  const room = view.room;
  if (!room) return null;
  const playing = view.phase === 'act';
  return (
    <section className="panel mystery-room">
      <header>
        <span className="eyebrow">{view.objective}</span>
        <h2>{room.name}</h2>
        <p className="hint">{room.blurb}</p>
      </header>
      {room.death || room.trace ? (
        <div className="mystery-body-here">
          <strong>
            {room.death
              ? `${view.deaths.find((d) => d.victim === room.death!.victim)?.victimName ?? room.death.victim} is here, and beyond help.`
              : 'Somebody has been through this room in a hurry.'}
          </strong>
          <button type="button" disabled={!playing || (room.death ? room.death.searched : room.trace?.searched)} onClick={() => act({ type: 'search', room: room.id })}>
            {(room.death ? room.death.searched : room.trace?.searched) ? 'You have found everything here' : 'Search the room'}
          </button>
        </div>
      ) : null}
      <div className="mystery-here">
        <h3 className="eyebrow-h">Here with you</h3>
        {room.people.length === 0 ? <p className="hint">Nobody. Which is its own kind of news.</p> : (
          <ul className="mystery-people">
            {room.people.map((p) => (
              <li key={p.role}>
                <Face look={p.look} name={p.name} size={44} speaking={speaking === p.role} dead={!p.alive} />
                <strong>{p.name}</strong>
                <span className="tag">{p.operator === 'human' ? 'a person' : 'played by an agent'}</span>
                {playing ? <button type="button" className="small" onClick={() => act({ type: 'alibi', for: p.role })}>They were with me</button> : null}
                {playing ? <button type="button" className="small" onClick={() => setWhisper(whisper?.to === p.role ? null : { to: p.role, text: '' })}>Whisper…</button> : null}
                {whisper?.to === p.role ? (
                  <form
                    className="mystery-whisper"
                    onSubmit={(e) => { e.preventDefault(); const t = whisper.text.trim(); if (t) { act({ type: 'whisper', to: p.role, text: t }); setWhisper(null); onWhisperTo?.(null); } }}
                  >
                    <input autoFocus value={whisper.text} maxLength={280} placeholder={`Just to ${p.name}`} onChange={(e) => setWhisper({ to: p.role, text: e.target.value })} />
                    <button type="submit" className="small">Say it quietly</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mystery-props">
        <h3 className="eyebrow-h">In this room</h3>
        <div className="row wrap">
          {room.props.map((p) => (
            <button key={p.id} type="button" className={p.examined ? 'small' : ''} disabled={!playing} onClick={() => act({ type: 'examine', prop: p.id })}>
              {p.examined ? `Look again at ${p.name}` : `Examine ${p.name}`}
            </button>
          ))}
        </div>
      </div>
      <div className="mystery-doors">
        <h3 className="eyebrow-h">Doors</h3>
        <div className="row wrap">
          {room.doors.map((d) => (
            <button key={d.id} type="button" className="small" disabled={!playing || !d.open} onClick={() => act({ type: 'move', room: d.id })}>
              {d.open ? `Go to ${d.name}` : `${d.name} — shut`}
            </button>
          ))}
        </div>
      </div>
      {view.you?.killer && view.you.opportunity ? (
        <div className="mystery-chance">
          <strong>{view.you.opportunity.ready ? 'Your chance, and it is only this room.' : 'This room would do it — but not yet.'}</strong>
          <p className="hint">
            {view.you.opportunity.propName} is here. It has to be one of you and nobody else in the room.
            {view.you.opportunity.ready ? '' : ' The night is young and everybody is still counting heads.'}
          </p>
          <div className="row wrap">
            {room.people.map((p) => (
              <button key={p.role} type="button" className="danger" disabled={room.people.length !== 1 || !view.you?.opportunity?.ready} onClick={() => act({ type: 'murder', victim: p.role, prop: view.you!.opportunity!.prop })}>
                {room.people.length === 1 ? `…${p.name}` : `${p.name} — not while there is a witness`}
              </button>
            ))}
          </div>
          <p className="hint">You may also do nothing. A night where nobody else dies is a different night, and it is yours to choose — the truth will still be findable, and the house will say what happened instead.</p>
        </div>
      ) : null}
      {view.you?.killer && view.you.plant ? (
        <div className="mystery-chance mystery-plant">
          <strong>{view.you.plant.used ? 'You have left your trail.' : `Leave something at ${view.you.plant.propName}.`}</strong>
          {view.you.plant.used ? (
            <p className="hint">One trail is a lie; two is a pattern. You have laid yours.</p>
          ) : (
            <>
              <p className="hint">A thing left where it will be found, pointing at somebody it is not. It will be named at the reveal for what it was — so choose whose it looks like.</p>
              <div className="row wrap">
                {view.you.plant.options.slice(0, 6).map((o) => (
                  <button key={o.trait} type="button" className="small" onClick={() => act({ type: 'plant', prop: view.you!.plant!.prop, trait: o.trait })} title={o.text}>
                    Point at {o.points.map((p) => p.name.split(' ').slice(-1)[0]).join(' or ')}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * WHAT YOUR CHARACTER WOULD DO — the understudy, reading over your shoulder.
 *
 * It is the SAME policy the characters nobody is playing are run on, given your own view and nothing else:
 * so it can only suggest what you could have thought of, which is the coach's rule (`docs/HOLDEM-COACH.md`)
 * applied to a story. In P2 this becomes your character's own agent answering `mystery.consult` from its
 * archetype at your Home; the button, and what it may see, do not change.
 */
function saying(a: MysteryAction, view: MysteryView): string {
  const who = (r: string) => view.cast.find((c) => c.role === r)?.name ?? r;
  const room = (id: string) => (view.rooms.find((r) => r.id === id)?.name ?? 'the next room').replace(/^The /, 'the ');
  switch (a.type) {
    case 'move': return `Go through to ${room(a.room)} — there is nothing more for you in this one.`;
    case 'examine': return `Look at ${view.room?.props.find((p) => p.id === a.prop)?.name ?? 'that'}. Nobody has, and it is right there.`;
    case 'search': return 'Search this room properly. A death leaves more than one thing behind.';
    case 'share': return 'Tell them what you found. Nothing you keep to yourself can be checked against anybody else.';
    case 'say': return `Say something: "${a.text}"`;
    case 'testify': return `Put ${who(a.about)} on the spot about where they were.`;
    case 'alibi': return `Say ${who(a.for)} was with you — true or not, it is on the record now.`;
    case 'accuse': return `Name ${who(a.against)}, on what you are holding.`;
    case 'murder': return `Your chance, and it will not come again this act: ${who(a.victim)} is alone with you.`;
    case 'whisper': return `Say it to ${who(a.to)} alone.`;
    default: return 'Wait, and listen.';
  }
}

/** WHO YOU ARE. The secret is yours; so, for exactly one person all night, is the other thing. */
function You({ view, act }: { view: MysteryView; act: (a: unknown) => void }) {
  const [idea, setIdea] = useState<{ action: MysteryAction; text: string } | null>(null);
  const you = view.you;
  if (!you) return <section className="panel"><h3 className="eyebrow-h">Watching</h3><p className="hint">You are not in this story — you see the public half of it.</p></section>;
  return (
    <section className={`panel mystery-you${you.killer ? ' killer' : ''}`}>
      <span className="eyebrow">Your part</span>
      <div className="mystery-you-head">
        <Face look={you.look} name={you.name} size={64} dead={!you.alive} />
        <h2>{you.name}</h2>
      </div>
      <p>{you.blurb}</p>
      <p className="mystery-secret"><strong>Nobody knows:</strong> {you.secret}</p>
      {you.killer ? (
        <p className="mystery-killer-note"><strong>It was you.</strong> Nobody else is told this, tonight or ever — the seed said so before the night began, and the reveal will prove it. Take your chance when the room is right, and lie well.</p>
      ) : null}
      {!you.alive ? <p className="hint">You are dead. You may still be heard, which is generous.</p> : null}
      {you.alive && view.phase !== 'revealed' ? (
        <div className="mystery-understudy">
          <button
            type="button"
            className="small"
            onClick={() => {
              const lines = TITLES[view.title]?.roles.find((r) => r.id === you.role)?.lines;
              const move = lines ? chooseAction(view, lines, Math.floor(Date.now() / 3000)) : null;
              setIdea(move ? { action: move.action, text: saying(move.action, view) } : null);
            }}
          >
            What would {you.name.split(' ').slice(-1)[0]} do?
          </button>
          {idea ? (
            <div className="mystery-idea">
              <p>{idea.text}</p>
              <div className="row wrap">
                <button type="button" className="primary" onClick={() => { act(idea.action); setIdea(null); }}>Do that</button>
                <button type="button" className="small" onClick={() => setIdea(null)}>My own way</button>
              </div>
              <p className="hint">Your understudy reads what you can see and nothing else — the same eyes, the same clue book.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** WHAT YOU HOLD — and the one thing you can do with it, which is tell somebody. */
function Clues({ view, act }: { view: MysteryView; act: (a: unknown) => void }) {
  const here = view.room?.people ?? [];
  return (
    <section className="panel mystery-clues">
      <h3 className="eyebrow-h">Your clue book</h3>
      {view.clues.length === 0 ? <p className="hint">Nothing yet. Look at things; ask people.</p> : (
        <ul>
          {view.clues.map((c) => (
            <li key={c.id} className={c.kind === 'evidence' ? 'evidence' : ''}>
              <span>{c.text}</span>
              {c.public ? <span className="tag">everyone knows</span> : (
                <span className="row wrap">
                  <button type="button" className="small" disabled={view.phase !== 'act' || !here.length} onClick={() => act({ type: 'share', clue: c.id })}>Tell the room</button>
                  {here.length ? (
                    <select
                      className="small"
                      value=""
                      disabled={view.phase !== 'act'}
                      onChange={(e) => { if (e.target.value) act({ type: 'share', clue: c.id, to: e.target.value }); }}
                    >
                      <option value="">Tell just one of them…</option>
                      {here.map((p) => <option key={p.role} value={p.role}>{p.name}</option>)}
                    </select>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** THE CAST, and — when it is time — the one thing the night is for. */
function Cast({ view, act, speaking }: { view: MysteryView; act: (a: unknown) => void; speaking: string | null }) {
  const [pick, setPick] = useState<string>('');
  const open = view.phase === 'accusations' || (view.phase === 'act' && view.act >= 3);
  return (
    <section className="panel mystery-cast">
      <h3 className="eyebrow-h">Everyone here tonight</h3>
      <ul>
        {view.cast.map((p) => (
          <li key={p.role} className={p.alive ? '' : 'dead'}>
            <Face look={p.look} name={p.name} size={28} speaking={speaking === p.role} dead={!p.alive} />
            <strong>{p.name}</strong>
            <span className="hint">{p.role === view.you?.role ? 'you' : p.operator === 'human' ? 'a person' : 'an agent'}{p.alive ? '' : ' · dead'}</span>
          </li>
        ))}
      </ul>
      {open && view.you?.alive ? (
        <div className="mystery-accuse">
          <h3 className="eyebrow-h">Name somebody</h3>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Who was it?</option>
            {view.cast.filter((p) => p.alive && p.role !== view.you?.role).map((p) => <option key={p.role} value={p.role}>{p.name}</option>)}
          </select>
          <button type="button" className="primary" disabled={!pick} onClick={() => act({ type: 'accuse', against: pick, clues: view.clues.filter((c) => c.kind === 'evidence').map((c) => c.id) })}>
            {view.accusation ? 'Change my mind' : 'Accuse them'}
          </button>
          {view.accusation ? <p className="hint">You have named {view.cast.find((c) => c.role === view.accusation?.against)?.name}.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/** WHAT YOU HEARD AND SAW, in order. Everything else about the night happened to somebody else. */
function Transcript({ view, speaking }: { view: MysteryView; speaking: string | null }) {
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [view.transcript.length]);
  const name = (role: string) => view.cast.find((c) => c.role === role)?.name ?? role;
  // A clue arrives as an id; the words for it are in the book you are holding.
  const clue = (id: string) => view.clues.find((c) => c.id === id)?.text ?? 'something worth keeping';
  // "…through to The lounge" is how a name written for a heading reads inside a sentence; this is the fix.
  const room = (id: string) => {
    const n = view.rooms.find((r) => r.id === id)?.name ?? 'the next room';
    return n.charAt(0).toLowerCase() + n.slice(1);
  };
  return (
    <section className="panel mystery-transcript" aria-live="polite">
      {view.transcript.map((e, i) => <Line key={`${e.at}:${i}`} e={e} name={name} clue={clue} room={room} cast={view.cast} speaking={speaking} you={view.you?.role ?? null} />)}
      <div ref={end} />
    </section>
  );
}

function Line({ e, name, clue, room, cast, speaking, you }: {
  e: MysteryEvent; name: (r: string) => string; clue: (id: string) => string; room: (id: string) => string;
  cast: MysteryView['cast']; speaking: string | null; you: string | null;
}) {
  /** A line somebody said gets their face beside it — that is the difference between a room and a log. */
  const said = (role: string, body: React.ReactNode, cls: string) => {
    const who = cast.find((c) => c.role === role);
    return (
      <div className={`m-line ${cls}`}>
        {who ? <Face look={who.look} name={who.name} size={34} speaking={speaking === role} dead={!who.alive} /> : null}
        <p><strong>{role === you ? 'You' : name(role)}</strong> {body}</p>
      </div>
    );
  };
  switch (e.type) {
    case 'cue': return <p className="m-cue">{e.text}</p>;
    case 'act': return <p className="m-act">{e.phase === 'interlude' ? 'The house holds its breath.' : e.phase === 'accusations' ? 'Time to name somebody.' : `Act ${e.act}`}</p>;
    case 'said': return said(e.by, <span className="m-words">{e.text}</span>, 'm-said');
    case 'whispered': return said(e.by, <span className="m-words">{e.by === you ? `(to ${name(e.to)}) ` : '(quietly) '}{e.text}</span>, 'm-whisper');
    case 'moved': return <p className="m-move">{e.who === you ? `You go through to ${room(e.to)}.` : `${name(e.who)} goes through to ${room(e.to)}.`}</p>;
    case 'found': return <p className="m-found"><strong>You find:</strong> {clue(e.clue)}</p>;
    case 'planted': return <p className="m-planted"><strong>You leave it where it will be found:</strong> {clue(e.clue)}</p>;
    case 'shared': return said(e.by, <>tells {e.to ? (e.to === you ? 'you' : name(e.to)) : 'the room'}: <span className="m-words">{clue(e.clue)}</span></>, 'm-shared');
    case 'claimed': return said(e.by, <><span className="m-words">{e.text}</span> <span className="tag">a claim</span></>, 'm-claim');
    case 'accused': return said(e.by, <>{e.by === you ? 'accuse' : 'accuses'} <strong>{name(e.against)}</strong>.</>, 'm-accused');
    case 'died': return <p className="m-died"><strong>{name(e.victim)} is dead</strong>, in {room(e.room)}.</p>;
    case 'spared': return <p className="m-died"><strong>Nobody died</strong> — but somebody was through {room(e.room)} in the dark.</p>;
    case 'revealed': return <p className="m-act">The seed is published.</p>;
    default: return null;
  }
}

/** THE REVEAL: the seed, the killer, who was right, and what nobody ever found. */
function Reveal({ view, onAgain, busy }: { view: MysteryView; onAgain: () => void; busy: boolean }) {
  const r = view.reveal;
  if (!r) return null;
  const name = (role: string) => view.cast.find((c) => c.role === role)?.name ?? role;
  const you = view.you?.role ?? null;
  const right = you ? r.correct.includes(you) : false;
  return (
    <section className="panel mystery-reveal">
      <span className="eyebrow">The reveal</span>
      <h2>It was {r.killerName}.</h2>
      {you ? (
        <p className="mystery-verdict">
          {you === r.killer ? 'It was you, and you were only named by ' : right ? 'You were right.' : 'You were wrong.'}
          {you === r.killer ? `${r.correct.length} of them.` : ''}
        </p>
      ) : null}
      <p className="hint">
        Right: {r.correct.length ? r.correct.map(name).join(', ') : 'nobody'}. Fooled:{' '}
        {r.fooled.length ? r.fooled.map((f) => `${name(f.by)} said ${name(f.against)}`).join('; ') : 'nobody'}.
      </p>
      <p className="hint mystery-proof">
        The killer was drawn from this seed before the first word of the night, under a rule set before it was
        spent — {r.rule === 'any' ? 'anybody in the cast' : r.rule === 'human' ? 'somebody with a person behind them' : 'you asked to be the one'} —
        and the commitment was posted then: <code>{view.seedCommit.slice(0, 16)}…</code> is sha256 of{' '}
        <code>{r.seed.slice(0, 16)}…</code>. Nobody chose afterwards: not the house, not the story.
      </p>
      {r.spared ? <p className="hint">Only one person died tonight. The second never came — which is a choice somebody made, and the house found another way to leave the same trail.</p> : null}
      {r.planted.length ? <p className="hint">A trail was laid on purpose, pointing somewhere it should not: {r.planted.map((p) => p.trait).join(', ')}.</p> : null}
      {r.missed.length ? <p className="hint">{r.missed.length} piece{r.missed.length === 1 ? '' : 's'} of evidence nobody ever found.</p> : null}
      <button type="button" className="primary" disabled={busy} onClick={onAgain}>{busy ? 'Setting the scene…' : 'Another night'}</button>
    </section>
  );
}
