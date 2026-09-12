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
import { api } from '../lib/api';
import type { AuthConfig } from '../lib/home';

export function CoachQuestion({ session, config }: { session: AppSession | null; config: AuthConfig | null }) {
  const [show, setShow] = useState<{ agent: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // A dev session is a name and nothing behind it; a demo or Home session has an agent to ask.
    if (!session || session.via === 'dev') return;
    let alive = true;
    api
      .coachStatus(session.token)
      .then((r) => {
        if (!alive) return;
        if (r.agent && r.coach === null && r.asked === null) setShow({ agent: r.agent });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session]);
  if (!session || !show) return null;

  const answer = async (a: 'hired' | 'later' | 'no') => {
    if (busy) return;
    setBusy(true);
    try {
      await api.coachAnswered(a, session.token);
    } catch {
      /* the sheet still closes; the question may come back next visit, which is the honest outcome */
    } finally {
      setBusy(false);
      setShow(null);
    }
  };
  const homeCoaches = config?.home.origin ? `${config.home.origin.replace(/\/$/, '')}/coaches?game=poker` : null;

  return (
    <div className="sheet-backdrop" role="presentation">
      <div className="sheet coach-question" role="dialog" aria-modal="true" aria-labelledby="coachq-title">
        <h2 id="coachq-title">Want a coach at the table?</h2>
        <p>
          Your agent <code>{show.agent}</code> can answer at the table, but it has no coach to consult yet. A coach is a
          service somebody runs: it reads the hands the card room records to your vault — under a grant you sign, and
          nothing else — and advises you in its own name, on its own tokens. You pick one per game at your Home, and you
          can fire it there any time.
        </p>
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
        <p className="hint">Asked once. Whatever you choose is kept in your own vault, and the desk beside a table always has the option.</p>
      </div>
    </div>
  );
}
