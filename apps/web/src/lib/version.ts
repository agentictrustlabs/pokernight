/**
 * A DEPLOY DOES NOT REACH A TAB THAT IS ALREADY OPEN.
 *
 * The HTML is served `max-age=0, must-revalidate`, which is right — a reload always gets the newest
 * build. But a person who left the page open an hour ago is running the JavaScript they loaded then,
 * and the site gives them no way to know. That is a real cost on a site deployed several times a day:
 * they look for something they were told is there, do not find it, and reasonably report it missing.
 *
 * HOW IT KNOWS. Vite gives every build a content-hashed bundle name, so the name IS the version. This
 * asks the server for the current HTML and compares the bundle it names with the one this page is
 * actually running. No build step, no version file to remember to bump, and it cannot drift — the
 * thing compared is the thing loaded.
 *
 * Never automatic. Reloading a page out from under somebody mid-hand would be worse than a stale tab.
 */

/** The bundle this page is running, from the script tag the browser actually loaded. */
export function runningBundle(): string | null {
  try {
    const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '';
    return bundleOf(src);
  } catch {
    return null;
  }
}

/** `index-Bdq5mdTN.js` out of any URL or markup that mentions one. */
export function bundleOf(text: string): string | null {
  return /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(text)?.[1] ?? null;
}

/**
 * Whether the server is serving a different build from the one running here.
 *
 * A failed check is NOT a new version. Offline, rate-limited, a blip — all of them must read as "no
 * news", because a reload prompt shown to somebody whose network dropped is a prompt that takes their
 * table away for nothing.
 */
export async function newBuildAvailable(here = runningBundle()): Promise<boolean> {
  if (!here) return false;
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', headers: { accept: 'text/html' } });
    if (!res.ok) return false;
    const there = bundleOf(await res.text());
    return there !== null && there !== here;
  } catch {
    return false;
  }
}
