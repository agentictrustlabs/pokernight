import { useEffect, useState } from 'react';
import { api } from './api';
import { clubScope, type HuddleScope } from './huddle';

/**
 * A club table knows its club by id and name; the huddle's scope needs the club's WORKSPACE AGENT too,
 * which only the club's own view carries. Read once per table; null while unknown or for a club that has
 * no chartered agent (then there is no huddle to offer).
 */
export function useClubScope(club: { id: string; name: string } | null, token: string | null): HuddleScope | null {
  const [scope, setScope] = useState<HuddleScope | null>(null);
  useEffect(() => {
    if (!club || !token) { setScope(null); return; }
    let alive = true;
    api.getClub(club.id, token).then((v) => { if (alive) setScope(clubScope(v)); }).catch(() => { if (alive) setScope(null); });
    return () => { alive = false; };
  }, [club?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps
  return scope;
}
