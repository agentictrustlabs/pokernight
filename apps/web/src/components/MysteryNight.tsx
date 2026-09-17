import { useCallback, useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, clubMystery, type StagedPart, type StagingSummary } from '../lib/api';
import { goTo, mysteryHash } from '../lib/routes';
import { Face } from './mystery/Face';
import type { Look } from '@pokernight/mystery';

/**
 * A CLUB'S MYSTERY NIGHT (docs/MYSTERY-NIGHT.md §4, §10).
 *
 * A night of your own opens the moment you press the button. A night PEOPLE COME TO is cast first: the host
 * sets it up, the club's people take parts one at a time, and nothing is drawn — not the killer, not a clue —
 * until the host raises the curtain. Every part nobody took is played by one of the house's own, so three
 * friends can stage an eight-hander, and the killer is drawn over the PEOPLE in it, because a party is better
 * when somebody at the table has to lie.
 */
/**
 * THE POSTER FOR THE NIGHT (2026-09-16). A mystery is an EVENING somebody has to want to come to, and the tab
 * used to open on a heading and a paragraph. This is the hotel on the night the pass shut — authored artwork,
 * so it is sharp on any screen and costs a few kilobytes — with the title over it and the one line that says
 * what kind of evening it is. Swapping in a photograph is one file and nothing here changes.
 */
function Curtain({ status }: { status: string }) {
  return (
    <div className="mystery-hero">
      <div className="mystery-hero-art" role="img"
        aria-label="The Hôtel Belvedere above the treeline on the night the pass shut: lit windows, falling snow, and the peaks behind it." />
      <div className="mystery-hero-words">
        <span className="mystery-hero-eyebrow">Mystery Night{status ? ` · ${status}` : ''}</span>
        <h2>Snowfall at the Belvedere</h2>
        <p>The pass is shut and the wind is up. Eight people are in a ski hotel above the treeline, one of
          them did it, and nobody — including us — knows which until the seed is spent.</p>
      </div>
    </div>
  );
}

/** Is anybody who took a part not yet in the room? */
function waiting(ready: StagingSummary['ready']): boolean { return !!ready && ready.waitingFor.length > 0; }

/**
 * THE DOORWAY (2026-09-16) — who has said they are coming, and who has actually walked in.
 *
 * A host asked to decide when to begin was previously deciding blind: the cast list says who TOOK a part,
 * which is a promise, and nothing at all said who was in the room. So the curtain went up on people who were
 * still making tea, and their first act happened without them.
 *
 * This never blocks. A night runs with two people and six of the house's own, and a host who knows somebody
 * is stuck on a call should be able to start without them — the button says "Start anyway" rather than going
 * grey, because refusing to begin is a decision this app has no standing to make. It only makes the choice
 * an informed one.
 */
function Doorway({ ready, host }: { ready: StagingSummary['ready']; host: boolean }) {
  if (!ready || ready.taken === 0) return null;
  const { taken, present, waitingFor } = ready;
  return (
    <div className={`mystery-doorway${waitingFor.length ? ' waiting' : ' all-here'}`}>
      <span className="eyebrow-h">In the room</span>
      <p className="hint">
        <strong>{present} of {taken}</strong> {taken === 1 ? 'person who took a part is' : 'people who took parts are'} here.
        {waitingFor.length ? <> Still to arrive: <strong>{waitingFor.join(', ')}</strong>.</> : ' Everybody is in.'}
      </p>
      {host && waitingFor.length ? (
        <p className="hint">You can wait, or start anyway — whatever nobody is playing is played by the house.</p>
      ) : null}
    </div>
  );
}

export function MysteryNight({ clubId, session, host }: { clubId: string; session: AppSession; host: boolean }) {
  const [staging, setStaging] = useState<(StagingSummary & { host?: string }) | null>(null);
  const [cast, setCast] = useState<StagedPart[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pace, setPace] = useState<'short' | 'full'>('short');

  const load = useCallback(async () => {
    try {
      const r = await clubMystery.read(clubId, session.token);
      setStaging(r.staging);
      setCast(r.cast ?? []);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not read the club’s night.'); }
  }, [clubId, session.token]);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);

  const mine = cast.find((c) => c.takenById === session.playerId);
  const casting = staging?.phase === 'casting';
  const running = !!staging && !casting && staging.phase !== 'revealed';
  const act = async (what: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await what(); await load(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (!staging) {
    return (
      <section className="panel mystery-plan">
        <Curtain status="" />
        {err ? <div className="form-error">{err}</div> : null}
        {host ? (
          <div className="row wrap">
            <select value={pace} onChange={(e) => setPace(e.target.value as 'short' | 'full')}>
              <option value="short">A short night — about twenty minutes</option>
              <option value="full">The whole evening — about an hour</option>
            </select>
            <button type="button" className="primary" disabled={busy} onClick={() => void act(() => clubMystery.plan(clubId, { pace }, session.token))}>
              {busy ? 'Setting the scene…' : 'Set up a mystery night'}
            </button>
          </div>
        ) : <p className="hint">Nothing staged just now. Your host sets these up.</p>}
      </section>
    );
  }

  return (
    <section className="panel mystery-plan">
      <Curtain status={casting ? 'casting' : running ? 'playing' : 'over'} />
      {err ? <div className="form-error">{err}</div> : null}
      {casting ? (
        <>
          <p className="hint">Take a part. Whatever nobody takes is played by one of the house’s own, so a night runs with two of you or with eight.</p>
          {/*
            * A CAST SHEET, NOT A LIST (2026-09-16). Eight rows of face-plus-paragraph-plus-button was the
            * shape of a settings screen, and a person choosing who to BE for three hours was reading it like
            * one. A card each: the face big enough to see, the name, the one line that says who they are, and
            * the action on its own row underneath where it cannot squeeze the words. A part somebody has taken
            * stops being an offer and becomes a statement — no button, a ribbon with their name on it.
            */}
          <ul className="mystery-cast">
            {cast.map((p) => {
              const takenByMe = p.takenById === session.playerId;
              return (
                <li key={p.role} className={`mystery-card${p.takenBy ? ' taken' : ''}${takenByMe ? ' mine' : ''}`}>
                  <div className="mystery-card-head">
                    <Face look={p.look as Look} name={p.name} size={56} />
                    <div className="mystery-card-who">
                      <strong>{p.name}</strong>
                      {p.takenBy ? (
                        <span className="mystery-card-by">{takenByMe ? 'you are playing this part' : `${p.takenBy} is playing this part`}</span>
                      ) : (
                        <span className="mystery-card-by free">nobody has taken this part</span>
                      )}
                    </div>
                  </div>
                  <p className="mystery-card-line">{p.blurb}</p>
                  {p.takenBy ? null : (
                    <button type="button" className="small mystery-card-take" disabled={busy}
                      onClick={() => void act(() => clubMystery.take(staging.stagingId, p.role, session.token))}>
                      {mine ? 'Take this one instead' : 'Take this part'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <Doorway ready={staging.ready} host={host} />
          <div className="row wrap">
            {mine ? <button type="button" className="small" disabled={busy} onClick={() => void act(() => clubMystery.take(staging.stagingId, null, session.token))}>Give up my part</button> : null}
            {host ? (
              <button type="button" className="primary" disabled={busy} onClick={() => void act(async () => { await clubMystery.curtain(staging.stagingId, session.token); goTo(mysteryHash(staging.stagingId)); })}>
                {busy ? 'Raising the curtain…' : waiting(staging.ready) ? 'Start anyway' : 'Raise the curtain'}
              </button>
            ) : <span className="hint">Your host raises the curtain when everyone is here.</span>}
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            {running ? `Act ${staging.act} is running.` : 'The night is over.'}{' '}
            {mine ? `You are ${mine.name}.` : 'You are not in the cast — you can still watch.'}
          </p>
          <div className="row wrap">
            <a className="button primary" href={mysteryHash(staging.stagingId)}>{running ? 'Go in →' : 'See how it ended →'}</a>
            {host ? (
              <button type="button" className="small" disabled={busy} onClick={() => void act(() => clubMystery.plan(clubId, { pace, restart: true }, session.token))}>
                Stage another
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
