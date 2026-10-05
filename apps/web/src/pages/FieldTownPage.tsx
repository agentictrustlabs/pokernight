/**
 * THE TOWN, ON ITS OWN PAGE — `#/fo/<staging>/town` (docs/FIELD-OPERATIONS.md §7).
 *
 * The whole window for the scene, for a season that is running, paused or finished. IT OPENS NO SOCKET: a socket is
 * a tab the season counts as somebody attending, and attention is what lets it ask sixteen agents for their day.
 * Looking at what a season built is not attending it. So this page READS the view over HTTP when it opens and when
 * a person presses Refresh, and otherwise leaves the season exactly as it found it.
 *
 * NO HOOK AFTER AN EARLY RETURN — every hook is above the first `return`.
 */
import { useCallback, useEffect, useState } from 'react';
import type { FieldOpsView } from '@pokernight/fieldops';
import type { AppSession } from '../lib/types';
import { fieldOpsApi } from '../lib/api';
import { fieldOpsHash, HOME_HASH } from '../lib/routes';
import { Identity } from '../components/Identity';
import { Brand } from '../components/Brand';
import { FieldTownPanel } from '../components/fieldops/FieldTownPanel';

export function FieldTownPage({ stagingId, session, onSignOut }: { stagingId: string; session: AppSession | null; onSignOut: () => void }) {
  const [view, setView] = useState<FieldOpsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const token = session?.token ?? null;
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const r = await fieldOpsApi.read(stagingId, token);
      if (r.view) setView(r.view as FieldOpsView); else setError('This season has not opened yet.');
    } catch (e) { setError(e instanceof Error ? e.message : 'The season could not be read.'); }
    finally { setLoading(false); }
  }, [stagingId, token]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="ft-page" data-testid="field-town-page">
      <header className="topbar">
        <Brand />
        <span className="topbar-title">{view ? `${view.scenarioName} — the town` : 'The town'}</span>
        {view ? <span className="ft-page-day">{view.phase === 'revealed' ? 'The season is over' : `Day ${view.day} of ${view.weeks * view.daysPerWeek}`}</span> : null}
        <span className="spacer" />
        <button type="button" className="link" onClick={() => void load()} disabled={loading}>{loading ? 'Reading…' : 'Refresh'}</button>
        <a href={fieldOpsHash(stagingId)}>The season’s page</a>
        <a href={HOME_HASH}>← Play</a>
        {session ? <Identity session={session} onSignOut={onSignOut} /> : null}
      </header>
      {!session ? <div className="form-error">Sign in to see this season.</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {view ? <FieldTownPanel view={view} tall /> : !error && session ? <p className="ft-loading">Reading the season…</p> : null}
    </div>
  );
}
