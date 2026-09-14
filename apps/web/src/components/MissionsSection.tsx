import { useEffect, useState } from 'react';
import { api, type MissionListing } from '../lib/api';
import { MISSIONS_HASH, NEW_MISSION_HASH, missionHash, rememberReturn } from '../lib/routes';
import { MissionMap } from './MissionMap';

/**
 * THE MISSIONS, on the front door and on Play (2026-09-14): the site is as much about the missions as about
 * hosting a night, so the map of registered missions and the road to register one are on the first screen a
 * person sees, signed in or not. The registry is public, so a visitor sees the map before any sign-in; the
 * register button remembers where it was pressed, so a visitor who signs in to register lands on the form.
 */
export function MissionsSection({ signedIn, variant = 'landing' }: { signedIn: boolean; variant?: 'landing' | 'play' }) {
  const [missions, setMissions] = useState<MissionListing[] | null>(null);
  useEffect(() => {
    let alive = true;
    api.missions().then((r) => alive && setMissions(r.missions.filter((m) => m.status === 'active'))).catch(() => alive && setMissions([]));
    return () => { alive = false; };
  }, []);
  const shown = (missions ?? []).slice(0, 6);
  const register = () => { if (!signedIn) rememberReturn(NEW_MISSION_HASH); };
  const registerHref = signedIn ? NEW_MISSION_HASH : '#signin';
  return (
    <section className={variant === 'landing' ? 'landing-section missions-section' : 'panel missions-section play-running'} id="missions">
      <div className="missions-head">
        <div>
          <span className="eyebrow">Missions</span>
          <h2 className="section-title">{missions == null ? 'The missions' : missions.length === 0 ? 'The missions — yours could be first' : missions.length === 1 ? 'One mission, registered on its own word' : `${missions.length} missions, each registered on its own word`}</h2>
        </div>
        <div className="missions-ctas">
          <a className="cta" href={registerHref} onClick={register}>Register a mission</a>
          <a className="cta-quiet" href={MISSIONS_HASH}>See them all</a>
        </div>
      </div>
      <p className="missions-lede">
        A mission is an organization that registered itself here — its steward affirmed the covenant, its own agent signed the entry, and the card room checked every line. A game night invites one as
        its guest: its people join the talk, tell what they do, answer what is asked. Giving is a separate choice, and never a condition of playing.
      </p>
      <div className="missions-grid">
        <MissionMap missions={missions ?? []} height={variant === 'landing' ? 380 : 300} />
        <ul className="missions-names">
          {missions == null ? <li className="hint">Reading the registry…</li> : shown.length === 0 ? <li className="hint">No missions are registered yet.</li> : shown.map((m) => (
            <li key={m.entryId}>
              <a className="mission-name" href={missionHash(m.entryId)}>{m.name}</a>
              <span className="mission-place">{m.place.label}</span>
            </li>
          ))}
          {missions && missions.length > shown.length ? <li><a className="small" href={MISSIONS_HASH}>and {missions.length - shown.length} more →</a></li> : null}
        </ul>
      </div>
    </section>
  );
}
