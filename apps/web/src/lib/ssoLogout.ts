/**
 * Front-channel single sign-out: `GET /sso-logout`.
 *
 * When somebody signs out at their Home, the Home does not just drop its own session — it walks the
 * list of relying apps they are connected to and navigates, top level, to each app's `/sso-logout`
 * with a `return` pointing back at itself, so it can carry on down the list. An app that does not
 * answer that call stays signed in behind the Home's back, which is exactly what "if I disconnect on
 * Home it should disconnect the poker" means and exactly what this card room was failing to do: the
 * path returned 200 only because the SPA's not-found handling serves index.html for everything, and
 * it cleared nothing at all.
 *
 * A Home-initiated sign-out is a DELIBERATE act by the person, not a dropped connection. So it takes
 * the same path an explicit sign-out takes — `POST /auth/signout`, which stands them up from every
 * seat and, on a settled table, cashes them out — and not the sit-out path a closing socket takes.
 *
 * Two rules this file exists to hold:
 *
 *   1. The `return` is an OPEN REDIRECT unless it is checked. We follow it only to our own origin or
 *      to the person's own Home; anything else is ignored and they land on our front door instead.
 *      The Home's own comment says relying apps' allowlists trust only themselves and their Home,
 *      and that is precisely the rule implemented here.
 *   2. It must be safe with no session at all, and safe to call twice. The Home walks its list
 *      idempotently and may well arrive when we have already been signed out.
 */

/** Where the browser keeps the session. Defined here so the logout page and the app cannot drift. */
import { pageTitle } from './brand';

export const SESSION_KEY = 'pokernight.session';

/** The origins a `return` may name, resolved by the Worker before the page is written. */
export interface LogoutAllowlist {
  /** This deployment's own origin — always allowed. */
  selfOrigin: string;
  /** The configured Home origin, when we know it. */
  homeOrigin?: string | null;
  /**
   * The Home's zone. A Home answers on more than one host (an apex and a `www`, with no redirect
   * between them) and hops the sign-out chain onto whichever one it considers canonical, so trusting
   * only the single configured origin would hand the person a return we refuse and strand them on
   * our root, signed out, on an app they were not using. The rule is the tables Worker's own issuer
   * allowlist (`isAllowedHomeOrigin`): the zone apex or a single-label subdomain of it, over https.
   */
  homeZone?: string | null;
}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Where to send the person after we have signed them out.
 *
 * Anything we do not recognise — a foreign origin, a malformed URL, a missing parameter — becomes our
 * own front door. Never an error page, and never the unvalidated value: being dropped somewhere safe
 * is a mild annoyance, being bounced to an attacker's origin by a link that says "sign out" is not.
 */
export function safeReturnTo(raw: string | null | undefined, allow: LogoutAllowlist): string {
  const home = `${allow.selfOrigin.replace(/\/+$/, '')}/`;
  if (!raw) return home;
  let u: URL;
  try {
    u = new URL(raw, allow.selfOrigin);
  } catch {
    return home;
  }
  if (u.origin === allow.selfOrigin) return u.toString();
  if (allow.homeOrigin && u.origin === allow.homeOrigin) return u.toString();
  return isHomeZoneOrigin(u, allow.homeZone) ? u.toString() : home;
}

/** The tables Worker's issuer rule, applied to a redirect target instead of an issuer. */
function isHomeZoneOrigin(u: URL, zone: string | null | undefined): boolean {
  const z = (zone ?? '').trim().toLowerCase();
  if (!z) return false;
  const host = u.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) return z === 'localhost';
  if (u.protocol !== 'https:') return false;
  if (host === z) return true;
  if (!host.endsWith(`.${z}`)) return false;
  return LABEL_RE.test(host.slice(0, -(z.length + 1)));
}

/**
 * How long the page waits for the sign-out to complete before bouncing anyway.
 *
 * There is a real tension here. Waiting is what stands the player up and revokes the token server
 * side, so we do wait. But the Home is mid-chain and a person staring at a spinner because our
 * tables Worker is slow is a worse outcome than a seat cleaned up a moment later — and the browser
 * copy of the session is already gone by then either way. `keepalive` lets the request outlive the
 * navigation, so a slow answer still lands.
 */
export const SIGN_OUT_WAIT_MS = 5000;

export interface LogoutPageOptions {
  /** Base URL of the tables API, e.g. `https://games.faithnet.io`. */
  apiBase: string;
  /** Already validated by {@link safeReturnTo}. */
  returnTo: string;
}

/**
 * The whole page, as one self-contained document.
 *
 * Deliberately NOT the SPA. This has to work on a cold load, with the script parsed for the first
 * time, in the middle of somebody else's redirect chain — so it boots no router, mounts no React,
 * and depends on no hash route. It reads the token, asks the card room to give up the seats and kill
 * the session, forgets it locally, and moves on.
 */
export function logoutPageHtml({ apiBase, returnTo }: LogoutPageOptions): string {
  const cfg = jsonForScript({ apiBase: apiBase.replace(/\/+$/, ''), returnTo, key: SESSION_KEY, waitMs: SIGN_OUT_WAIT_MS });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${pageTitle('Signing you out')}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; display: grid; place-items: center; min-height: 100vh;
         font: 16px/1.5 "Public Sans", system-ui, -apple-system, sans-serif;
         background: #f2f4f1; color: #16211c; }
  @media (prefers-color-scheme: dark) { body { background: #101613; color: #e8eee9; } }
  main { text-align: center; padding: 2rem; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>Signing you out…</h1>
  <p>Giving up your seats and ending your session at the card room.</p>
  <p><a id="onward" href="${escapeAttr(returnTo)}">Continue</a></p>
</main>
<script>
(function () {
  var C = ${cfg};
  var done = false;
  function onward() { if (done) return; done = true; location.replace(C.returnTo); }
  var token = null;
  try {
    var raw = localStorage.getItem(C.key);
    if (raw) token = (JSON.parse(raw) || {}).token || null;
  } catch (e) { /* storage blocked: there is nothing of ours in it either */ }
  // Forget it locally FIRST. Whatever happens to the request below, this browser is signed out —
  // and the storage event this fires is what signs out the app's other open tabs.
  try { localStorage.removeItem(C.key); } catch (e) {}
  if (!token) return onward();
  setTimeout(onward, C.waitMs);
  fetch(C.apiBase + '/auth/signout', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: '{}'
  }).then(onward, onward);
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${escapeAttr(returnTo)}"></noscript>
</body>
</html>
`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * JSON safe to sit inside a `<script>` block.
 *
 * `safeReturnTo` fixes the ORIGIN of the destination and nothing else — the path and query still
 * arrive from the Home's URL. `JSON.stringify` does not escape `<`, so a return carrying `</script>`
 * would close this tag and run whatever followed. Escaping the four characters that can end a script
 * element (plus the two line separators JS treats as newlines) closes that off; they are ordinary
 * escapes, so `JSON.parse` reads the identical value back.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
