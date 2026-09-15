import { useEffect, useMemo, useRef, useState } from 'react';
import type { MysteryEvent, MysteryView } from '@pokernight/mystery';
import type { AppSession } from '../lib/types';
import { mysteryApi } from '../lib/api';
import { MysterySocket, type MysteryClientState } from '../lib/mysterySocket';
import { HOME_HASH } from '../lib/routes';
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    const s = new MysterySocket(stagingId, session.token, redraw);
    sock.current = s;
    return () => { s.close(); sock.current = null; };
  }, [stagingId, session?.token, redraw]);

  const st: MysteryClientState | null = sock.current?.state ?? null;
  const view = st?.view ?? null;

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
            <Transcript view={view} />
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
            <Room view={view} act={(a) => sock.current?.act(a)} />
          </main>
          <aside className="mystery-side">
            <You view={view} />
            <Clues view={view} act={(a) => sock.current?.act(a)} />
            <Cast view={view} act={(a) => sock.current?.act(a)} />
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
function Room({ view, act }: { view: MysteryView; act: (a: unknown) => void }) {
  const [whisper, setWhisper] = useState<{ to: string; text: string } | null>(null);
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
      {room.death ? (
        <div className="mystery-body-here">
          <strong>{view.deaths.find((d) => d.victim === room.death!.victim)?.victimName ?? room.death.victim} is here, and beyond help.</strong>
          <button type="button" disabled={!playing || room.death.searched} onClick={() => act({ type: 'search', room: room.id })}>
            {room.death.searched ? 'You have found everything here' : 'Search the room'}
          </button>
        </div>
      ) : null}
      <div className="mystery-here">
        <h3 className="eyebrow-h">Here with you</h3>
        {room.people.length === 0 ? <p className="hint">Nobody. Which is its own kind of news.</p> : (
          <ul className="mystery-people">
            {room.people.map((p) => (
              <li key={p.role}>
                <strong>{p.name}</strong>
                <span className="tag">{p.operator === 'human' ? 'a person' : 'played by an agent'}</span>
                {playing ? <button type="button" className="small" onClick={() => act({ type: 'alibi', for: p.role })}>They were with me</button> : null}
                {playing ? <button type="button" className="small" onClick={() => setWhisper(whisper?.to === p.role ? null : { to: p.role, text: '' })}>Whisper…</button> : null}
                {whisper?.to === p.role ? (
                  <form
                    className="mystery-whisper"
                    onSubmit={(e) => { e.preventDefault(); const t = whisper.text.trim(); if (t) { act({ type: 'whisper', to: p.role, text: t }); setWhisper(null); } }}
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
          <strong>Your chance, and it is only this room.</strong>
          <p className="hint">{view.you.opportunity.propName} is here. It has to be one of you and nobody else in the room.</p>
          <div className="row wrap">
            {room.people.map((p) => (
              <button key={p.role} type="button" className="danger" disabled={room.people.length !== 1} onClick={() => act({ type: 'murder', victim: p.role, prop: view.you!.opportunity!.prop })}>
                {room.people.length === 1 ? `…${p.name}` : `${p.name} — not while there is a witness`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** WHO YOU ARE. The secret is yours; so, for exactly one person all night, is the other thing. */
function You({ view }: { view: MysteryView }) {
  const you = view.you;
  if (!you) return <section className="panel"><h3 className="eyebrow-h">Watching</h3><p className="hint">You are not in this story — you see the public half of it.</p></section>;
  return (
    <section className={`panel mystery-you${you.killer ? ' killer' : ''}`}>
      <span className="eyebrow">Your part</span>
      <h2>{you.name}</h2>
      <p>{you.blurb}</p>
      <p className="mystery-secret"><strong>Nobody knows:</strong> {you.secret}</p>
      {you.killer ? (
        <p className="mystery-killer-note"><strong>It was you.</strong> Nobody else is told this, tonight or ever — the seed said so before the night began, and the reveal will prove it. Take your chance when the room is right, and lie well.</p>
      ) : null}
      {!you.alive ? <p className="hint">You are dead. You may still be heard, which is generous.</p> : null}
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
function Cast({ view, act }: { view: MysteryView; act: (a: unknown) => void }) {
  const [pick, setPick] = useState<string>('');
  const open = view.phase === 'accusations' || (view.phase === 'act' && view.act >= 3);
  return (
    <section className="panel mystery-cast">
      <h3 className="eyebrow-h">Everyone here tonight</h3>
      <ul>
        {view.cast.map((p) => (
          <li key={p.role} className={p.alive ? '' : 'dead'}>
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
function Transcript({ view }: { view: MysteryView }) {
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [view.transcript.length]);
  const name = (role: string) => view.cast.find((c) => c.role === role)?.name ?? role;
  // A clue arrives as an id; the words for it are in the book you are holding.
  const clue = (id: string) => view.clues.find((c) => c.id === id)?.text ?? 'something worth keeping';
  const room = (id: string) => view.rooms.find((r) => r.id === id)?.name ?? 'the next room';
  return (
    <section className="panel mystery-transcript" aria-live="polite">
      {view.transcript.map((e, i) => <Line key={`${e.at}:${i}`} e={e} name={name} clue={clue} room={room} you={view.you?.role ?? null} />)}
      <div ref={end} />
    </section>
  );
}

function Line({ e, name, clue, room, you }: { e: MysteryEvent; name: (r: string) => string; clue: (id: string) => string; room: (id: string) => string; you: string | null }) {
  switch (e.type) {
    case 'cue': return <p className="m-cue">{e.text}</p>;
    case 'act': return <p className="m-act">{e.phase === 'interlude' ? 'The house holds its breath.' : e.phase === 'accusations' ? 'Time to name somebody.' : `Act ${e.act}`}</p>;
    case 'said': return <p className="m-said"><strong>{e.by === you ? 'You' : name(e.by)}:</strong> {e.text}</p>;
    case 'whispered': return <p className="m-whisper"><strong>{e.by === you ? 'You' : name(e.by)}</strong> {e.by === you ? `whisper to ${name(e.to)}` : 'whispers'}: {e.text}</p>;
    case 'moved': return <p className="m-move">{e.who === you ? `You go through to ${room(e.to)}.` : `${name(e.who)} goes through to ${room(e.to)}.`}</p>;
    case 'found': return <p className="m-found"><strong>You find:</strong> {clue(e.clue)}</p>;
    case 'shared': return <p className="m-shared"><strong>{e.by === you ? 'You tell' : `${name(e.by)} tells`}</strong> {e.to ? name(e.to) : 'the room'}: {clue(e.clue)}</p>;
    case 'claimed': return <p className="m-claim"><strong>{e.by === you ? 'You' : name(e.by)}:</strong> {e.text} <span className="tag">a claim</span></p>;
    case 'accused': return <p className="m-accused"><strong>{e.by === you ? 'You accuse' : `${name(e.by)} accuses`}</strong> {name(e.against)}.</p>;
    case 'died': return <p className="m-died"><strong>{name(e.victim)} is dead</strong>, in {room(e.room)}.</p>;
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
      {r.missed.length ? <p className="hint">{r.missed.length} piece{r.missed.length === 1 ? '' : 's'} of evidence nobody ever found.</p> : null}
      <button type="button" className="primary" disabled={busy} onClick={onAgain}>{busy ? 'Setting the scene…' : 'Another night'}</button>
    </section>
  );
}
