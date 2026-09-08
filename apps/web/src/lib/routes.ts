/**
 * Hash routes. Pure, so the route table is testable and there is exactly one place that decides what
 * a URL means.
 *
 *   #/            the front door — the landing page when signed out, the lobby when signed in
 *   #/signin      sign-in on its own, where a sign-out or an expired session lands
 *   #/t/<tableId> a table
 */

export type Route = { page: 'home' } | { page: 'signin' } | { page: 'table'; tableId: string };

/** Where sign-out, an expired session and "I want to sign in" all go. */
export const SIGNIN_HASH = '#/signin';
/** The front door. */
export const HOME_HASH = '#/';

export function route(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '/';
  const table = /^\/t\/([^/?#]+)/.exec(path);
  if (table?.[1]) return { page: 'table', tableId: decodeURIComponent(table[1]) };
  if (/^\/signin\/?$/.test(path)) return { page: 'signin' };
  return { page: 'home' };
}

/** Navigate without adding a history entry the back button would bounce off. */
export function goTo(hash: string): void {
  if (location.hash === hash) return;
  location.hash = hash;
}

/* --------------------------------------------------- coming back from the Home */

const RETURN_KEY = 'pokernight.returnTo';

/**
 * Remember where the person was standing before a trip to their Home.
 *
 * The buy-in authorisation returns to the site's ONE registered redirect URI, which is the front
 * door — so without this, a person who authorised buy-ins while sitting at a table comes back to
 * the lobby and has to find the table again. That is the difference between a flow and an errand.
 */
export function rememberReturn(hash: string = location.hash): void {
  try {
    sessionStorage.setItem(RETURN_KEY, hash || HOME_HASH);
  } catch {
    /* storage blocked: they land on the front door, which is where they would have landed anyway */
  }
}

/** Where to send them back to, once and once only. Null when there is nowhere in particular. */
export function takeReturn(): string | null {
  try {
    const hash = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return hash && hash !== location.hash ? hash : null;
  } catch {
    return null;
  }
}
