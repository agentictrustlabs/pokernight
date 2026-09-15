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
        <span className="eyebrow">Mystery Night</span>
        <h2>Snowfall at the Belvedere</h2>
        <p className="hint">
          Eight parts in a ski hotel with the pass shut. Your people take the parts they want; the house plays the
          rest; one of the people here did it, and nobody — including us — knows which until the seed is spent.
        </p>
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
      <span className="eyebrow">Mystery Night{casting ? ' · casting' : running ? ' · playing' : ' · over'}</span>
      <h2>Snowfall at the Belvedere</h2>
      {err ? <div className="form-error">{err}</div> : null}
      {casting ? (
        <>
          <p className="hint">Take a part. Whatever nobody takes is played by one of the house’s own, so a night runs with two of you or with eight.</p>
          <ul className="mystery-parts">
            {cast.map((p) => {
              const takenByMe = p.takenById === session.playerId;
              return (
                <li key={p.role} className={p.takenBy ? 'taken' : ''}>
                  <Face look={p.look as Look} name={p.name} size={44} />
                  <div>
                    <strong>{p.name}</strong>
                    <span className="hint">{p.blurb}</span>
                  </div>
                  {p.takenBy ? (
                    <span className="tag">{takenByMe ? 'yours' : p.takenBy}</span>
                  ) : (
                    <button type="button" className="small" disabled={busy} onClick={() => void act(() => clubMystery.take(staging.stagingId, p.role, session.token))}>
                      {mine ? 'Take this one instead' : 'Take this part'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="row wrap">
            {mine ? <button type="button" className="small" disabled={busy} onClick={() => void act(() => clubMystery.take(staging.stagingId, null, session.token))}>Give up my part</button> : null}
            {host ? (
              <button type="button" className="primary" disabled={busy} onClick={() => void act(async () => { await clubMystery.curtain(staging.stagingId, session.token); goTo(mysteryHash(staging.stagingId)); })}>
                {busy ? 'Raising the curtain…' : 'Raise the curtain'}
              </button>
            ) : <span className="hint">Your host raises the curtain when everyone has a part.</span>}
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
