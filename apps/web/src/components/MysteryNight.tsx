import { useCallback, useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, clubCommission, clubFieldOps, clubMystery, commissionApi, fieldOpsApi, type CommissionPart, type CommissionSummary, type FieldOpsPart, type FieldOpsSummary, type StagedPart, type StagingSummary } from '../lib/api';
import { commissionHash, fieldOpsHash, goTo, mysteryHash } from '../lib/routes';
import { Face } from './mystery/Face';
import type { Look } from '@pokernight/mystery';
void (null as unknown as StagedPart);

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
function Curtain({ status, game }: { status: string; game: NightGame }) {
  if (game === 'fieldops') return (
    <div className="mystery-hero fo-hero">
      <div className="mystery-hero-art fo-hero-art" role="img"
        aria-label="Northern Colorado from above: the Front Range, I-25, four corridors of towns, and the plains going east." />
      <div className="mystery-hero-words">
        <span className="mystery-hero-eyebrow">Field Operations{status ? ` · ${status}` : ''}</span>
        <h2>A Season North of Denver</h2>
        <p>Four teams, twelve of the registry's people communities, four partner churches, six weeks. Every team, worker
          and church is a real agent, marked as the game's; every community starts where the public picture puts it.
          Days play out in minutes, and the field app shows what the season did.</p>
      </div>
    </div>
  );
  if (game === 'commission') return (
    <div className="mystery-hero gc-hero">
      <div className="mystery-hero-art gc-hero-art" role="img"
        aria-label="A fellowship hall on a Thursday: folding tables, a coffee urn, and a map of Weld County on the end wall." />
      <div className="mystery-hero-words">
        <span className="mystery-hero-eyebrow">Great Commission{status ? ` · ${status}` : ''}</span>
        <h2>Thursday in Greeley</h2>
        <p>Seven people who each hold one piece of the picture of five peoples in one county. Three rounds stand in
          for three years. The rails pass if the picture finds the motion before the reporter finds a household.</p>
      </div>
    </div>
  );
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

/**
 * ONE COMPONENT, TWO NIGHTS (2026-09-18). A club is one game, and a commission club had no way to stage its
 * night from its page — the API existed and nothing called it. The two nights are the same shape (a staging,
 * a cast sheet, a doorway, a curtain, a way in); what differs is which API, which poster, which page, and
 * whether the middle of the night is an act or a round. `NightApi` is that difference, and nothing else is.
 */
export type NightGame = 'mystery' | 'commission' | 'fieldops';
type Part = { role: string; name: string; blurb: string; look: unknown; takenBy: string | null; takenById: string | null };
type Summary = { stagingId: string; phase: string; ready?: StagingSummary['ready']; host?: string; middle: string };
type NightApi = {
  read: (clubId: string, token: string) => Promise<{ staging: Summary | null; cast: Part[] }>;
  plan: (clubId: string, body: { pace?: 'short' | 'full'; restart?: boolean }, token: string) => Promise<unknown>;
  take: (stagingId: string, role: string | null, token: string) => Promise<unknown>;
  curtain: (stagingId: string, token: string) => Promise<unknown>;
  hash: (stagingId: string) => string;
  setUp: string;
  shortLine: string;
  fullLine: string;
};
const asMysterySummary = (s: (StagingSummary & { host?: string }) | null): Summary | null => (s ? { stagingId: s.stagingId, phase: s.phase, ready: s.ready, host: s.host, middle: `Act ${s.act}` } : null);
const asCommissionSummary = (s: CommissionSummary | null): Summary | null => (s ? { stagingId: s.stagingId, phase: s.phase, ready: s.ready, host: s.host, middle: `Round ${s.round}` } : null);
const asFieldOpsSummary = (s: FieldOpsSummary | null): Summary | null => (s ? { stagingId: s.stagingId, phase: s.phase, ready: s.ready, host: s.host, middle: `Day ${s.day}` } : null);
const NIGHTS: Record<NightGame, NightApi> = {
  mystery: {
    read: async (clubId, token) => { const r = await clubMystery.read(clubId, token); return { staging: asMysterySummary(r.staging), cast: r.cast ?? [] }; },
    plan: (clubId, body, token) => clubMystery.plan(clubId, body, token),
    take: (id, role, token) => clubMystery.take(id, role, token),
    curtain: (id, token) => clubMystery.curtain(id, token),
    hash: mysteryHash, setUp: 'Set up a mystery night', shortLine: 'A short night — about twenty minutes', fullLine: 'The whole evening — about an hour',
  },
  commission: {
    read: async (clubId, token) => { const r = await clubCommission.read(clubId, token); return { staging: asCommissionSummary(r.staging), cast: (r.cast ?? []).map((p: CommissionPart) => ({ role: p.role, name: p.name, blurb: p.blurb, look: p.look, takenBy: p.takenBy, takenById: p.takenById })) }; },
    plan: (clubId, body, token) => clubCommission.plan(clubId, body, token),
    take: (id, role, token) => commissionApi.take(id, role, token),
    curtain: (id, token) => commissionApi.curtain(id, token),
    hash: commissionHash, setUp: 'Set up a Thursday in Greeley', shortLine: 'A short night — three rounds in about fifteen minutes', fullLine: 'The whole lunch — three rounds in about an hour',
  },
  fieldops: {
    read: async (clubId, token) => { const r = await clubFieldOps.read(clubId, token); return { staging: asFieldOpsSummary(r.staging), cast: (r.cast ?? []).map((p: FieldOpsPart) => ({ role: p.role, name: p.name, blurb: p.blurb, look: p.look, takenBy: p.takenBy, takenById: p.takenById })) }; },
    plan: (clubId, body, token) => clubFieldOps.plan(clubId, body, token),
    take: (id, role, token) => fieldOpsApi.take(id, role, token),
    curtain: (id, token) => fieldOpsApi.curtain(id, token),
    hash: fieldOpsHash, setUp: 'Set up a season north of Denver', shortLine: 'A short season — six weeks in about twenty minutes', fullLine: 'The whole season — a day a minute, about an hour',
  },
};

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

export function MysteryNight({ clubId, session, host, game = 'mystery' }: { clubId: string; session: AppSession; host: boolean; game?: NightGame }) {
  const api = NIGHTS[game];
  const [staging, setStaging] = useState<Summary | null>(null);
  const [cast, setCast] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pace, setPace] = useState<'short' | 'full'>('short');

  const load = useCallback(async () => {
    try {
      const r = await api.read(clubId, session.token);
      setStaging(r.staging);
      setCast(r.cast);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not read the club’s night.'); }
  }, [clubId, session.token, api]);

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
        <Curtain status="" game={game} />
        {err ? <div className="form-error">{err}</div> : null}
        {host ? (
          <div className="row wrap">
            <select value={pace} onChange={(e) => setPace(e.target.value as 'short' | 'full')}>
              <option value="short">{api.shortLine}</option>
              <option value="full">{api.fullLine}</option>
            </select>
            <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.plan(clubId, { pace }, session.token))}>
              {busy ? 'Setting the scene…' : api.setUp}
            </button>
          </div>
        ) : <p className="hint">Nothing staged just now. Your host sets these up.</p>}
      </section>
    );
  }

  return (
    <section className="panel mystery-plan">
      <Curtain status={casting ? 'casting' : running ? 'playing' : 'over'} game={game} />
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
                      onClick={() => void act(() => api.take(staging.stagingId, p.role, session.token))}>
                      {mine ? 'Take this one instead' : 'Take this part'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <Doorway ready={staging.ready} host={host} />
          <div className="row wrap">
            {mine ? <button type="button" className="small" disabled={busy} onClick={() => void act(() => api.take(staging.stagingId, null, session.token))}>Give up my part</button> : null}
            {host ? (
              <button type="button" className="primary" disabled={busy} onClick={() => void act(async () => { await api.curtain(staging.stagingId, session.token); goTo(api.hash(staging.stagingId)); })}>
                {busy ? 'Raising the curtain…' : waiting(staging.ready) ? 'Start anyway' : 'Raise the curtain'}
              </button>
            ) : <span className="hint">Your host raises the curtain when everyone is here.</span>}
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            {running ? `${staging.middle} is running.` : 'The night is over.'}{' '}
            {mine ? `You are ${mine.name}.` : 'You are not in the cast — you can still watch.'}
          </p>
          <div className="row wrap">
            <a className="button primary" href={api.hash(staging.stagingId)}>{running ? 'Go in →' : 'See how it ended →'}</a>
            {host ? (
              <button type="button" className="small" disabled={busy} onClick={() => void act(() => api.plan(clubId, { pace, restart: true }, session.token))}>
                Stage another
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
