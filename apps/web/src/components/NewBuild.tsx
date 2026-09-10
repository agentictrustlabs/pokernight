import { useEffect, useState } from 'react';
import { newBuildAvailable } from '../lib/version';

/** Twice a minute would be noise; twice an hour would miss a session's worth of deploys. */
const EVERY_MS = 3 * 60 * 1000;

/**
 * "I don't see it" — when the site has it and the tab does not.
 *
 * A deploy does not reach a page somebody already has open: the HTML says `must-revalidate` so a
 * RELOAD always gets the newest build, and until then they are running whatever they loaded. On a
 * site deployed several times a day that is a regular, invisible failure — somebody looks for a thing
 * they were told is there, does not find it, and reports it missing.
 *
 * NEVER RELOADS BY ITSELF. Taking somebody's page away mid-hand to install an improvement is worse
 * than the stale tab, so this is a sentence and a button and nothing else. It can be dismissed, and it
 * does not come back for that build.
 *
 * It only looks while the tab is VISIBLE. A background tab polling the origin forever is the kind of
 * thing that shows up in somebody's battery report.
 */
export function NewBuild() {
  const [stale, setStale] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    const look = async () => {
      if (document.hidden || !alive) return;
      if (await newBuildAvailable()) {
        if (alive) setStale(true);
      }
    };
    const h = setInterval(look, EVERY_MS);
    // Also on coming back to the tab, which is exactly when somebody has been away long enough.
    const onShow = () => void look();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      alive = false;
      clearInterval(h);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);

  if (!stale || hidden) return null;
  return (
    <div className="new-build" role="status">
      <span>There is a newer version of this page.</span>
      <button type="button" className="link-button" onClick={() => location.reload()}>
        Reload
      </button>
      <button type="button" className="link-button quiet" onClick={() => setHidden(true)} aria-label="dismiss">
        Not now
      </button>
    </div>
  );
}
