import { useEffect, useState } from 'react';
import type { MissionVisit } from '@pokernight/protocol';
import { api, type MissionListing } from '../lib/api';
import type { AppSession } from '../lib/types';
import { missionHash } from '../lib/routes';
import { Drawer } from './Drawer';
import { MissionMap } from './MissionMap';

/**
 * THE GUEST, AT THE TABLE — a flyout over the cards, so a player can read who the mission is and who came on
 * its behalf without leaving the game (2026-09-14). The mission's presence comes from the registry; the visit
 * — the person attending, where the visit stands, the host's note — comes from the club night this table was
 * opened for, when it was. The page behind keeps dealing.
 */
export function GuestDrawer({ open, onClose, guest, club, night, session }: {
  open: boolean;
  onClose: () => void;
  guest: { entryId: string; name: string } | null;
  club: { id: string; name: string } | null;
  night: string | null;
  session: AppSession | null;
}) {
  const [listing, setListing] = useState<MissionListing | null>(null);
  const [visit, setVisit] = useState<MissionVisit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !guest) return;
    let alive = true;
    setErr(null);
    api.mission(guest.entryId).then((r) => alive && setListing(r.listing)).catch(() => alive && setErr('Could not read the mission from the registry.'));
    if (club && night && session) {
      api.getClub(club.id, session.token).then((v) => { if (!alive) return; const n = v.nights.find((x) => x.nightId === night); setVisit(n?.visit ?? null); }).catch(() => undefined);
    } else setVisit(null);
    return () => { alive = false; };
  }, [open, guest?.entryId, club?.id, night, session?.token]);
  if (!guest) return null;
  const rep = visit?.representative;
  return (
    <Drawer open={open} title={`♦ ${guest.name}`} onClose={onClose} modal={false}>
      <div className="guest-drawer">
        <p className="hint">Tonight's guest — a mission registered on its own word. It holds no cards, no chips, no hand in anyone's money.</p>
        {err ? <div className="form-error">{err}</div> : null}
        {listing ? (
          <>
            <section className="guest-block">
              <h3 className="eyebrow-h">The mission</h3>
              <p>{listing.blurb}</p>
              <p className="hint">{listing.place.label}{listing.orgName ? ` · ${listing.orgName}` : ''}</p>
              <p><a href={listing.website} target="_blank" rel="noreferrer">{listing.website.replace(/^https?:\/\//, '')}</a>{listing.languages.length ? ` · ${listing.languages.join(', ')}` : ''}</p>
              {listing.point ? <MissionMap missions={[listing]} height={180} /> : null}
            </section>
            <section className="guest-block">
              <h3 className="eyebrow-h">Who is here for them</h3>
              {rep ? (
                <>
                  <p><strong>{rep.name}</strong>{rep.agent ? <span className="hint"> · {rep.agent}</span> : null}</p>
                  {rep.email ? <p className="hint">{rep.email}</p> : null}
                  {visit?.status ? <p className="hint">{visit.status === 'confirmed' ? 'Confirmed to attend.' : visit.status === 'attended' ? 'Attended.' : visit.status === 'declined' ? 'Could not make it.' : 'Invited.'}</p> : null}
                  {visit?.note ? <p>{visit.note}</p> : null}
                </>
              ) : (
                <p className="hint">{club && night ? 'The host has not said who is coming yet.' : 'This table was opened for the mission directly, not for a club night, so nobody is named as attending.'}</p>
              )}
            </section>
            <p><a className="small" href={missionHash(listing.entryId)}>The mission's full page — its receipt, what the registry checked →</a></p>
          </>
        ) : !err ? <p className="hint">Reading the registry…</p> : null}
      </div>
    </Drawer>
  );
}
