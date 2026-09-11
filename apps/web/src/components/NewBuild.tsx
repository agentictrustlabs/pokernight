import { useEffect, useState } from 'react';
import { newerBundle } from '../lib/version';

/** Once a minute: a person told a fix is live should see the offer to take it before they have
 *  finished looking for it. It is one tiny HTML fetch, and only while the tab is visible. */
const EVERY_MS = 60 * 1000;

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
 * does not come back for THAT build — but it does for the next one. The first version hid itself for
 * the life of the tab, so on a day with a dozen deploys one "not now" silenced every one after it, and
 * a person was told three fixes were live and could see none of them.
 *
 * It only looks while the tab is VISIBLE. A background tab polling the origin forever is the kind of
 * thing that shows up in somebody's battery report.
 */
export function NewBuild() {
  /** The build the server is serving, when it is not this one. */
  const [newer, setNewer] = useState<string | null>(null);
  /** The build that was declined. A different one asks again. */
  const [declined, setDeclined] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const look = async () => {
      if (document.hidden || !alive) return;
      const b = await newerBundle();
      if (alive && b) setNewer(b);
    };
    const h = setInterval(look, EVERY_MS);
    // Also on coming back to the tab, and on moving between screens — this is a hash-routed app, so
    // navigating never reloads the page, and a person who has "gone to Play" three times since a
    // deploy has never once fetched the new build.
    const onShow = () => void look();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('hashchange', onShow);
    void look();
    return () => {
      alive = false;
      clearInterval(h);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('hashchange', onShow);
    };
  }, []);

  if (!newer || newer === declined) return null;
  return (
    <div className="new-build" role="status">
      <span>There is a newer version of this page.</span>
      <button type="button" className="link-button" onClick={() => location.reload()}>
        Reload
      </button>
      <button type="button" className="link-button quiet" onClick={() => setDeclined(newer)} aria-label="dismiss">
        Not now
      </button>
    </div>
  );
}
