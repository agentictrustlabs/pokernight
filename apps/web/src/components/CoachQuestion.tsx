/**
 * "WANT A COACH?" — asked of a person who arrives with their own agent and no coach, ONCE.
 *
 * The card room asks their agent (`poker.coach`): do you consult a coach, and has your person been asked?
 * Their agent answers from their playbook and their own preferences record, in their vault — so "asked
 * once" is a fact about them, not about this browser: another device or another card room reads the same
 * answer and stays quiet. Whatever they press, the answer is written down before the sheet closes.
 *
 * Getting a coach is a Home act (a specialist in the playbook, a grant they sign), so the sheet points at
 * the Home's Coaches page rather than pretending to do it here. Until that page exists at their Home, it
 * says so plainly and still records that they were asked.
 */
import { useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { readHomeSession, type AuthConfig } from '../lib/home';

/** Where "asked" lives for an agent that cannot yet keep it: this browser, keyed by the agent. */
const ASKED_KEY = (agent: string, game: string) => `pokernight.coach.asked:${game === 'poker' ? '' : `${game}:`}${agent.toLowerCase()}`;

/** ASKED ONCE PER GAME: the hold'em question on arrival, the canasta one when a canasta table is first opened. */
export function CoachQuestion({ session, config, game = 'poker' }: { session: AppSession | null; config: AuthConfig | null; game?: 'poker' | 'canasta' }) {
  const [show, setShow] = useState<{ agent: string; advertises: boolean; nameless?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingUp, setSettingUp] = useState<string | null>(null);
  useEffect(() => {
    // A dev session is a name and nothing behind it; a demo or Home session has an agent to ask.
    if (!session || session.via === 'dev') return;
    let alive = true;
    // THE APP'S DEFAULTS FIRST — everybody who connects from here gets the card room's skills and its default
    // coach. A person who signed in through the Home's own pages had them applied in the connect ceremony;
    // a demo person came through a server-side sign-in and did not, so the Home is asked to finish it now,
    // with the Home session this browser carries. Idempotent at the Home; bounded here; never fatal.
    const home = readHomeSession();
    const defaults = home && config?.home.origin
      ? (async () => {
          setSettingUp('Setting up your coach at your Home…');
          try {
            const r = await fetch(`${config.home.origin.replace(/\/$/, '')}/connect/cardroom-defaults`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${home}` }, body: JSON.stringify({ client_id: config.home.clientId || 'pokernight' }), signal: AbortSignal.timeout(60_000) });
            const b = (await r.json().catch(() => ({}))) as { ok?: boolean; applied?: string[]; needsSignature?: boolean };
            if (b.ok && b.applied?.length) { setSettingUp(`Your agent now has the card room's skills and a coach — ${b.applied.join(', ')} set up at your Home.`); setTimeout(() => setSettingUp(null), 9000); }
            else setSettingUp(null);
          } catch { setSettingUp(null); }
        })()
      : Promise.resolve();
    defaults.then(() => api.coachStatus(session.token, game))
      .then((r) => {
        // NO NAME, NO COACH — and said so. The card room addresses a person's agent by its public name and
        // nothing else; an email or phone home that never claimed one cannot be asked for advice, have its
        // hands recorded, or consult a coach, whatever was hired at the Home. The Home now requires a name on
        // the way in; a person who got here before that is told where to claim one.
        // OFFERED UNTIL THERE IS ONE. "Later" and "no" used to be kept for good; a person whose connect-time
        // defaults had failed then never saw the offer again and played on with the house coach, wondering.
        // A coach is the card room's default now, so the sheet stays until one is hired — a person who really
        // does not want one says "no thanks" each visit, which is one tap.
        if (!alive || !r.agent || r.coach !== null) return;
        // An agent WITHOUT the card-room skills cannot keep the answer in its person's vault yet, so the
        // browser keeps it until it can — and the sheet says what the agent is missing.
        if (r.advertises === false) {
          try { if (localStorage.getItem(ASKED_KEY(r.agent, game))) return; } catch { /* ask anyway */ }
        }
        setShow({ agent: r.agent, advertises: r.advertises !== false });
      })
      .catch((e: unknown) => {
        // NO NAME, NO COACH — and said so. The card room addresses a person's agent by its public name and
        // nothing else; an email or phone home that never claimed one cannot be asked for advice, have its
        // hands recorded, or consult a coach, whatever was hired at the Home. The Home now requires a name on
        // the way in; a person who got here before that is told where to claim one.
        if (alive && e instanceof ApiError && e.status === 404 && /could not find a name/i.test(e.message)) setShow({ agent: '', advertises: false, nameless: true });
      });
    return () => {
      alive = false;
    };
  }, [session, game]);
  if (settingUp && !show) {
    return <div className="toast" role="status"><div>{settingUp}</div></div>;
  }
  if (!session || !show) return null;

  const answer = async (a: 'hired' | 'later' | 'no') => {
    if (busy) return;
    setBusy(true);
    try {
      if (show.advertises) await api.coachAnswered(a, session.token, game);
      else { try { localStorage.setItem(ASKED_KEY(show.agent, game), `${a}@${new Date().toISOString()}`); } catch { /* then it is asked again next time */ } }
    } catch {
      /* the sheet still closes; the question may come back next visit, which is the honest outcome */
    } finally {
      setBusy(false);
      setShow(null);
    }
  };
  const homeCaps = config?.home.origin ? `${config.home.origin.replace(/\/$/, '')}/capabilities` : null;
  const homeCoaches = config?.home.origin ? `${config.home.origin.replace(/\/$/, '')}/coaches?game=${game}` : null;
  const gameLabel = game === 'canasta' ? 'canasta' : 'hold’em';
  const skills = game === 'canasta' ? ['canasta.advise', 'canasta.record', 'canasta.review', 'canasta.coach'] : ['poker.advise', 'poker.record', 'poker.review', 'poker.coach'];

  if (show.nameless) {
    const claim = config?.home.origin ? `${config.home.origin.replace(/\/$/, '')}/` : null;
    return (
      <div className="sheet-backdrop" role="presentation">
        <div className="sheet coach-question" role="dialog" aria-modal="true" aria-labelledby="coachq-title">
          <h2 id="coachq-title">Your agent needs a public name</h2>
          <p>
            The card room talks to your own agent by its name — that is how it asks for advice, records your hands, and
            reaches the coach you hire. Your Home has not given your agent a public name yet, so none of that can happen:
            the house coach answers for you, and nothing is remembered.
          </p>
          <p className="hint">Claim a name at your Home (one screen, once), then sign in here again — your coach comes with it.</p>
          <div className="sheet-actions">
            {claim ? <a className="button primary" href={claim} target="_blank" rel="noreferrer" onClick={() => setShow(null)}>Claim a name at my Home</a> : null}
            <button type="button" onClick={() => setShow(null)}>Not now</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-backdrop" role="presentation">
      <div className="sheet coach-question" role="dialog" aria-modal="true" aria-labelledby="coachq-title">
        <h2 id="coachq-title">Want a {gameLabel} coach at the table?</h2>
        <p>
          Your agent <code>{show.agent}</code> can answer at the table, but it has no {gameLabel} coach to consult yet. A
          coach is a service somebody runs: it reads the {game === 'canasta' ? 'rounds' : 'hands'} the card room records
          to your vault — under a grant you sign, and nothing else — and advises you in its own name, on its own tokens.
          You pick one per game at your Home, and you can fire it there any time.
        </p>
        {!show.advertises ? (
          <p className="hint">
            First, your agent needs the card room’s skills on its card — at your Home, under{' '}
            {homeCaps ? <a href={homeCaps} target="_blank" rel="noreferrer">Capabilities</a> : 'Capabilities'}, add{' '}
            {skills.map((sk, i) => <span key={sk}><code>{sk}</code>{i < skills.length - 1 ? ', ' : ''}</span>)}, publish, and release the card. Until then the house coach answers for you, and this answer is kept in this browser only.
          </p>
        ) : null}
        <div className="sheet-actions">
          {homeCoaches ? (
            <a
              className="button primary"
              href={homeCoaches}
              target="_blank"
              rel="noreferrer"
              onClick={() => void answer('hired')}
            >
              Choose a coach at my Home
            </a>
          ) : null}
          <button type="button" disabled={busy} onClick={() => void answer('later')}>
            Not now
          </button>
          <button type="button" className="link-button" disabled={busy} onClick={() => void answer('no')}>
            Don’t ask again
          </button>
        </div>
        <p className="hint">Asked once. Whatever you choose is kept{show.advertises ? ' in your own vault' : ' here until your agent can keep it'}, and the desk beside a table always has the option.</p>
      </div>
    </div>
  );
}
