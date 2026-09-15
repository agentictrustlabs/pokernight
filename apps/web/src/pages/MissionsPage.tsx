import { useEffect, useState } from 'react';
import { MissionMap } from '../components/MissionMap';
import { api, type MissionListing } from '../lib/api';
import { NEW_MISSION_HASH, missionHash } from '../lib/routes';

/**
 * THE MISSIONS — the registry on a map, and the list beside it (docs/MISSION-REGISTRY.md).
 *
 * A mission here is a standing presence — where it is and what it does — never an event. The page leads with
 * the map because "who is near us" is the question a host asks when picking a guest; the list carries the
 * ones the ceiling keeps off the map, and every row leads to the mission's page and, for a host, to inviting it.
 */
export function MissionsPage() {
  const [missions, setMissions] = useState<MissionListing[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.missions().then((r) => alive && setMissions(r.missions)).catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : 'Could not read the registry.'));
    return () => { alive = false; };
  }, []);
  const active = (missions ?? []).filter((m) => m.status === 'active');
  const offMap = active.filter((m) => !m.point);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Missions</span>
          <h1>Guests for a night</h1>
        </div>
        <p className="lede">Mission organizations that registered themselves here, each on its own word and its own agent. A club invites one to a night; any table can seat one as its guest.</p>
      </header>

      <section className="panel mission-panel">
        <div className="mission-toolbar">
          <span className="hint">{missions == null ? 'Reading the registry…' : active.length === 0 ? 'No missions are registered yet.' : `${active.length} registered ${active.length === 1 ? 'mission' : 'missions'}`}</span>
          <a className="small" href={NEW_MISSION_HASH}>Register a mission</a>
        </div>
        {err ? <div className="form-error">{err}</div> : null}
        <MissionMap missions={active} selected={selected} onSelect={setSelected} />
        <p className="hint mission-legend">A solid mark is the place itself; a pale, larger one is “near here” — a mission’s country, or its own choice, keeps the exact point private.</p>
      </section>

      {missions && active.length > 0 ? (
        <section className="panel">
          <h2>Registered</h2>
          <ul className="mission-list">
            {active.map((m) => (
              <li key={m.entryId} className={selected === m.entryId ? 'on' : ''} onMouseEnter={() => m.point && setSelected(m.entryId)}>
                <a className="mission-name" href={missionHash(m.entryId)}>{m.name}</a>
                <span className="mission-place">{m.place.label}{m.grain === 'hidden' ? ' · location not shown' : m.grain === 'region' ? ' · region' : ''}</span>
                <span className="mission-blurb">{m.blurb}</span>
              </li>
            ))}
          </ul>
          {offMap.length > 0 ? <p className="hint">{offMap.length === 1 ? 'One mission is listed by name and country only.' : `${offMap.length} missions are listed by name and country only.`}</p> : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>What registering means</h2>
        <p className="hint">
          A mission is an organization with its own agent at its Home. Its steward affirms a three-clause covenant — genuine, contact only about the night, safe to publish — and the organization
          signs its own entry in the room’s registry, on chain, for a year. The room checks every line against that entry and keeps a signed receipt anyone can verify. A mission is a
          <strong> guest</strong>: it never holds cards, chips, or a hand in anyone’s money.
        </p>
      </section>
    </div>
  );
}
