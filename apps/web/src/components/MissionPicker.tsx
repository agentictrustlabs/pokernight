import { useEffect, useState } from 'react';
import { api, type MissionListing } from '../lib/api';
import { missionHash } from '../lib/routes';

/**
 * WHO IS THE GUEST — a select over the registry's active missions, with "none". Used wherever a game names
 * its guest: the series' standing guest, one night's, a table's. It reads the registry once per mount and
 * says plainly when there is nobody to invite yet, with the road to the register page.
 */
export function MissionPicker({ value, onChange, disabled, allowInherit, inheritLabel }: {
  value: string | null | undefined;
  /** A mission's entry id, `null` for no guest, or `undefined` for "the series' guest" when `allowInherit`. */
  onChange: (entryId: string | null | undefined) => void;
  disabled?: boolean;
  /** For one night: a third choice, "the series' guest", carried as `undefined`. */
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const [missions, setMissions] = useState<MissionListing[] | null>(null);
  useEffect(() => {
    let alive = true;
    api.missions().then((r) => alive && setMissions(r.missions.filter((m) => m.status === 'active'))).catch(() => alive && setMissions([]));
    return () => { alive = false; };
  }, []);
  const current = value === undefined && allowInherit ? '__inherit' : value ?? '';
  return (
    <span className="mission-picker">
      <select
        value={current}
        disabled={disabled || missions === null}
        onChange={(e) => onChange(e.target.value === '__inherit' ? undefined : e.target.value || null)}
        aria-label="Guest mission"
      >
        {allowInherit ? <option value="__inherit">{inheritLabel ?? 'The series’ guest'}</option> : null}
        <option value="">No guest</option>
        {(missions ?? []).map((m) => (
          <option key={m.entryId} value={m.entryId}>{m.name} · {m.place.label.split(',')[0]}</option>
        ))}
      </select>
      {missions && missions.length === 0 ? <a className="small" href="#/missions/new">No missions registered yet — register one</a> : null}
      {value ? <a className="small" href={missionHash(value)}>about the guest</a> : null}
    </span>
  );
}
