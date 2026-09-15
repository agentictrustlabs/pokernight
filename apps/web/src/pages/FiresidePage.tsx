import { useEffect, useReducer, useRef, useState } from 'react';
import type { AppSession, ClubView, MissionVisit } from '../lib/types';
import { api, type MissionListing } from '../lib/api';
import { RoomSocket } from '../lib/roomSocket';
import { HuddleAffordance } from '../components/huddle/ClubHuddleDock';
import { clubScope } from '../lib/huddle';
import { fireHash, missionHash, roomHash } from '../lib/routes';
import { nightWhen } from '../lib/nights';

/**
 * TWO PLACES THAT ARE NOT A TABLE (2026-09-15).
 *
 * **The fireside** is where the GUEST is met: a mission comes to a night as its guest, and until now the only
 * thing you could do about that was read a plaque — the introduction had nowhere to happen. Sitting by the fire
 * is that somewhere, and the mission's own representative hosts it: theirs is the call there, so when they come
 * to a club it is the one place they run rather than attend.
 *
 * **The bar** is just a place to talk. Same shape, same huddle, no guest — for the people who are not at a
 * table and are not in the introduction either.
 *
 * NO MONEY AND NO CARDS PASS AT EITHER, which is the whole point. Giving is a separate choice and never a
 * condition of anything (docs/MISSION.md); the fireside introduces people, and that is all it does.
 */
export function FiresidePage({ session, clubId, place = 'fire' }: { session: AppSession; clubId: string | null; place?: 'fire' | 'bar' }) {
  const [club, setClub] = useState<ClubView | null>(null);
  const [missions, setMissions] = useState<MissionListing[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (clubId) api.getClub(clubId, session.token).then((v) => alive && setClub(v)).catch(() => alive && setErr('Could not read the club.'));
    api.missions().then((r) => alive && setMissions(r.missions.filter((m) => m.status === 'active'))).catch(() => alive && setMissions([]));
    return () => { alive = false; };
  }, [clubId, session.token]);

  // THE GUEST IS THE NEXT NIGHT'S, and its visit carries whoever is coming for it.
  const next = (club?.nights ?? []).filter((n) => !n.cancelledAt)[0] ?? null;
  const visit: MissionVisit | null = next?.visit ?? (next?.mission ? { mission: next.mission, status: 'invited' } : null);
  const scope = clubId ? clubScope({ clubId }) : null;
  const when = next ? nightWhen(next, Date.now()) : null;
  const fireside = place === 'fire';
  const title = fireside ? 'The fireside' : 'The bar';

  /**
   * WHO ELSE IS HERE. Sitting down by the fire takes you out of the 3D room and onto this page, and until now
   * that meant the two people who had both sat down could not see each other at all — each was alone in a room
   * about meeting people. So the page keeps its own presence in the same room object and stands your body at
   * the hearth: everyone here shows up in the list, and anybody still walking about sees you sitting there.
   */
  const roomId = clubId ? `club:${clubId}` : 'hall';
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const sock = useRef<RoomSocket | null>(null);
  useEffect(() => {
    const s2 = new RoomSocket(roomId, session.token, undefined, bump);
    sock.current = s2;
    // stand at the anchor so the zone the room derives is this one
    const at = setInterval(() => {
      const an = s2.state.manifest?.anchors?.[fireside ? 'fire' : 'bar'];
      if (an) { s2.pose(an.x - (fireside ? 2.2 : -1.2), an.y, fireside ? Math.PI / 2 : -Math.PI / 2); clearInterval(at); }
    }, 700);
    return () => { clearInterval(at); s2.close(); sock.current = null; };
  }, [roomId, session.token, fireside]);
  const here = [...(sock.current?.state.people.values() ?? [])].filter((p) => p.zone === (fireside ? 'fire' : 'bar'));

  return (
    <div className="stack bar-page">
      <header className="page-head bar-head">
        <div>
          <span className="eyebrow">{club?.name ?? 'The hall'}</span>
          <h1>{title}</h1>
        </div>
        <p className="lede">
          {fireside
            ? 'Where the guest is met. Nothing is dealt here and nothing is asked of you — this is the half of the night that is just people talking.'
            : 'A place to sit and talk, away from the tables. No guest, no cards, no stakes.'}
        </p>
        <div className="bar-actions">
          {scope ? <HuddleAffordance scope={scope} scopeName={`${club?.name ?? 'the club'} · ${title.toLowerCase()}`} /> : <span className="hint">The hall has no call of its own yet — a club’s does.</span>}
          <a className="small" href={roomHash(clubId)}>Stand up · back to the room</a>
        </div>
      </header>

      {err ? <div className="form-error">{err}</div> : null}

      <section className="panel bar-here">
        <h2 className="eyebrow-h">{here.length === 0 ? 'Nobody else is here yet' : here.length === 1 ? 'One person here' : `${here.length} people here`}</h2>
        <ul className="bar-people">
          {here.map((p) => (
            <li key={p.playerId}>
              <span className="cr-name">{p.name}</span>
              {p.playerId === sock.current?.state.you ? <span className="tag">you</span> : null}
            </li>
          ))}
        </ul>
        {here.length <= 1 ? <p className="hint">Anyone in the room can walk over and sit down — the chairs are by the {fireside ? 'fire' : 'bar'}.</p> : null}
      </section>

      {!fireside ? (
        <section className="panel bar-guest">
          <h2>Just a place to talk</h2>
          <p className="hint">
            The night’s guest is met <a href={fireHash(clubId)}>by the fire</a>, not here. Anyone who is not at a
            table can pull up a stool and start a call.
          </p>
        </section>
      ) : visit ? (
        <section className="panel bar-guest">
          <span className="eyebrow-h">{when ? `Guest on ${when.day}` : 'Tonight’s guest'}</span>
          <h2><a href={missionHash(visit.mission.entryId)}>{visit.mission.name}</a></h2>
          {visit.representative ? (
            <p className="bar-rep">
              <strong>{visit.representative.name}</strong> is coming for them
              {visit.status === 'confirmed' ? ' — confirmed' : visit.status === 'attended' ? ' — they were here' : visit.status === 'declined' ? ' — they cannot make it' : ' — invited'}.
            </p>
          ) : (
            <p className="hint">Nobody is named yet for the visit. The host can name who is coming from the club’s Nights tab.</p>
          )}
          {visit.note ? <p className="bar-note">{visit.note}</p> : null}
          <p className="hint">
            Giving is a separate choice and never a condition of playing — declining changes nothing, and nothing
            given buys any advantage at a table.
          </p>
        </section>
      ) : (
        <section className="panel bar-guest">
          <h2>No guest is booked yet</h2>
          <p className="hint">
            {clubId ? 'A host invites a mission to a night from the club’s Nights tab; whoever is coming is met here.' : 'The hall has no nights of its own — a club invites a mission to one of its nights, and its people are met at that club’s bar.'}
          </p>
        </section>
      )}

      <section className="panel">
        <h2 className="eyebrow-h">Missions you could invite</h2>
        {missions == null ? <p className="hint">Reading the registry…</p> : missions.length === 0 ? <p className="hint">None are registered yet.</p> : (
          <ul className="bar-missions">
            {missions.slice(0, 8).map((m) => (
              <li key={m.entryId}>
                <a href={missionHash(m.entryId)}>{m.name}</a>
                <span className="hint"> · {m.place.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
