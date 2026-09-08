/**
 * Home sign-in — the BROWSER half of the OIDC ceremony (DESIGN.md §3).
 *
 * We only ever run the front half here: build a `site-login` authorize request to the person's Home
 * with PKCE S256 + state + nonce (`@agenticprimitives/connect-client`), stash the verifier/nonce/state
 * in `sessionStorage`, and navigate. The Home runs the credential ceremony and returns the person to
 * the registered redirect URI with `?code&state`.
 *
 * The code is then handed STRAIGHT to the tables Worker, which exchanges and verifies it itself. This
 * app never sees an id_token, never decides who the person is, and holds nothing the Worker would
 * take its word for. What comes back is an ordinary pokernight session token.
 *
 * The registered redirect URI is `https://poker.faithnet.io/` and nothing else — so this flow cannot
 * complete from localhost. Local dev uses the dev-name login, which `GET /auth/config` advertises.
 */

import {
  connectViaRedirect,
  createConnectClient,
  generatePkce,
  randomB64url,
  type ConnectClient,
  type ConnectStash,
} from '@agenticprimitives/connect-client';

/** `GET /auth/config` on the tables Worker. Drives the sign-in UI so there is no build-time flag. */
export interface AuthConfig {
  devAuth: boolean;
  home: {
    clientId: string;
    origin: string;
    zone: string;
    delegate: string;
    redirectUri: string | null;
    /** The delegation template a buy-in authorisation asks the Home to run. */
    buyInTemplate?: string;
  };
}

/** Query parameters the ceremony puts on the return URL; all are stripped once consumed. */
const CALLBACK_PARAMS = ['code', 'state', 'error', 'error_description', 'error_uri', 'iss', 'session_state', 'ac_relay', 'ac_iss'];

export const STASH_KEY = 'pokernight.home.stash';
/** A separate stash, because a buy-in authorisation and a sign-in return to the SAME redirect URI and
 *  must not be mistaken for one another: a mandate ceremony must never mint a new session. */
export const MANDATE_STASH_KEY = 'pokernight.home.mandate';

/** The slice of `Storage` we use, so the stash round trip is testable without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `sessionStorage`, or null when it is unavailable (private mode, storage blocked, SSR). */
export function sessionStore(): StorageLike | null {
  try {
    const s = globalThis.sessionStorage;
    if (!s) return null;
    // Safari in private mode throws only on write, so probe.
    const probe = `${STASH_KEY}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Persist the PKCE stash across the navigation to the Home. Returns false if storage refused it —
 *  the caller must not navigate, because the return leg would have nothing to finish with. */
export function writeStash(store: StorageLike | null, stash: ConnectStash, key = STASH_KEY): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(stash));
    return true;
  } catch {
    return false;
  }
}

/** Read the stash back, or null if it is absent or not the shape we wrote. */
export function readStash(store: StorageLike | null, key = STASH_KEY): ConnectStash | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<ConnectStash>;
    if (
      typeof s.state === 'string' &&
      typeof s.authOrigin === 'string' &&
      typeof s.codeVerifier === 'string' &&
      typeof s.nonce === 'string' &&
      s.state !== '' &&
      s.codeVerifier !== '' &&
      s.nonce !== ''
    ) {
      return { name: typeof s.name === 'string' ? s.name : '', state: s.state, authOrigin: s.authOrigin, codeVerifier: s.codeVerifier, nonce: s.nonce };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearStash(store: StorageLike | null, key = STASH_KEY): void {
  try {
    store?.removeItem(key);
  } catch {
    /* nothing to do; the stash is single-use and the code is too */
  }
}

/**
 * SEC-018 issuer allowlist, the same rule the Worker applies (`apps/tables/src/home.ts`): the zone
 * apex or a single-label subdomain of it, https, no path/query/fragment. The Worker's copy is the one
 * that decides anything; this one stops us navigating a person to a Home we do not trust.
 */
export function isAllowedHomeOrigin(zone: string, origin: string): boolean {
  const z = zone.trim().toLowerCase();
  if (!z) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.pathname !== '/' && u.pathname !== '') return false;
  if (u.search !== '' || u.hash !== '') return false;
  const host = u.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) return z === 'localhost';
  if (u.protocol !== 'https:') return false;
  if (host === z) return true;
  if (!host.endsWith(`.${z}`)) return false;
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(host.slice(0, -(z.length + 1)));
}

export type Callback =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; error: string; description?: string };

/** What (if anything) the Home put on the URL we came back to. */
export function parseCallback(href: string): Callback | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const q = u.searchParams;
  const error = q.get('error');
  if (error) return { kind: 'error', error, description: q.get('error_description') ?? undefined };
  const code = q.get('code');
  const state = q.get('state');
  if (code && state) return { kind: 'code', code, state };
  return null;
}

/** The same URL with every ceremony parameter removed, so a refresh cannot re-submit a used code. */
export function stripAuthParams(href: string): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  for (const p of CALLBACK_PARAMS) u.searchParams.delete(p);
  const query = u.searchParams.toString();
  return `${u.origin}${u.pathname}${query ? `?${query}` : ''}${u.hash}`;
}

/** A human sentence for the `error` the Home sent back. */
export function describeCallbackError(error: string, description?: string): string {
  if (error === 'access_denied') return 'Sign-in was cancelled at your Home.';
  return description ? `Your Home refused the sign-in: ${description} (${error})` : `Your Home refused the sign-in (${error}).`;
}

/** The relying-party client for this deployment, built from `GET /auth/config`. */
export function homeClient(config: AuthConfig): ConnectClient {
  const redirectUri = config.home.redirectUri ?? `${location.origin}/`;
  return createConnectClient({
    clientId: config.home.clientId,
    delegate: config.home.delegate as `0x${string}`,
    redirectUri: () => redirectUri,
    resolveAuthOrigin: () => config.home.origin,
    isAllowedIssuerOrigin: (o) => isAllowedHomeOrigin(config.home.zone, o),
    // `profile` is NOT in this client's allowed scopes at the Home; asking for it fails the request.
    scope: 'openid agent',
  });
}

/**
 * Start the ceremony: build the authorize URL, persist the stash, then navigate. Throws with a
 * message worth showing if the Home origin is untrusted or the browser will not keep the stash.
 */
export async function startHomeSignIn(config: AuthConfig, store: StorageLike | null = sessionStore()): Promise<string> {
  if (!config.home.clientId || !config.home.origin) throw new Error('This deployment has no Home configured.');
  if (!isAllowedHomeOrigin(config.home.zone, config.home.origin)) {
    throw new Error(`Refusing to sign in at ${config.home.origin}: it is not a trusted Home for this site.`);
  }
  const { url, stash } = await connectViaRedirect(homeClient(config));
  if (!writeStash(store, stash)) {
    throw new Error('This browser will not let the site keep a sign-in secret (session storage is blocked), so sign-in cannot complete.');
  }
  return url;
}

export type CallbackOutcome =
  | { status: 'none' }
  | { status: 'signed-in'; code: string; codeVerifier: string; authOrigin: string; nonce: string; state: string }
  | { status: 'error'; message: string };

/**
 * Consume a `?code&state` return, PURELY: validate `state` against the stash and hand back what the
 * Worker needs. Does not touch the network or the URL — the caller does both, so this stays testable.
 */
export function consumeCallback(href: string, store: StorageLike | null, key = STASH_KEY): CallbackOutcome {
  const cb = parseCallback(href);
  if (!cb) return { status: 'none' };
  const stash = readStash(store, key);
  if (cb.kind === 'error') return { status: 'error', message: describeCallbackError(cb.error, cb.description) };
  if (!stash) {
    return { status: 'error', message: 'This sign-in could not be matched to a request from this browser. Start again.' };
  }
  if (stash.state !== cb.state) {
    return { status: 'error', message: 'The sign-in did not match the request this browser started (state mismatch). Start again.' };
  }
  return { status: 'signed-in', code: cb.code, codeVerifier: stash.codeVerifier, authOrigin: stash.authOrigin, nonce: stash.nonce, state: cb.state };
}

/** Set once the return leg has been consumed, so React's double-invoked effects (and a second render)
 *  cannot submit the same single-use code twice. Module scope on purpose: it must outlive components. */
let callbackConsumed = false;

/**
 * Consume the return leg for real: read the URL, clear the stash, and scrub the ceremony parameters
 * out of the address bar with `history.replaceState` so a refresh cannot re-submit a used code. Safe
 * to call more than once — every call after the first reports `none`.
 */
export function takeHomeCallback(store: StorageLike | null = sessionStore()): CallbackOutcome {
  if (callbackConsumed) return { status: 'none' };
  const outcome = consumeCallback(location.href, store);
  if (outcome.status === 'none') return outcome;
  callbackConsumed = true;
  clearStash(store);
  try {
    history.replaceState(null, '', stripAuthParams(location.href));
  } catch {
    /* an unwritable history is not a reason to fail the sign-in */
  }
  return outcome;
}

/* ------------------------------------------------------- the buy-in authorisation */

/**
 * Ask the player's Home to authorise buy-ins from their treasury.
 *
 * The SAME ceremony shape as sign-in, with one parameter changed: `delegation_template=poker-buyin`
 * instead of `site-login`. That template is the Home's, not ours — it is the Home that shows the
 * player what they are agreeing to and the Home that signs, which is the entire reason this is a
 * navigation and not a button that posts something. `pay_amount` tells it the biggest single buy-in
 * this table would take, in asset base units.
 *
 * The mandate comes back on the token exchange, which the Worker runs (`POST /auth/home/mandate`).
 * If the Home completes the ceremony without issuing one, the Worker says exactly that; this half
 * neither assumes a mandate nor pretends one arrived.
 */
export async function startBuyInMandate(
  config: AuthConfig,
  maxAmountBaseUnits: string | null,
  store: StorageLike | null = sessionStore(),
): Promise<string> {
  if (!config.home.clientId || !config.home.origin) throw new Error('This deployment has no Home configured.');
  if (!isAllowedHomeOrigin(config.home.zone, config.home.origin)) {
    throw new Error(`Refusing to send you to ${config.home.origin}: it is not a trusted Home for this site.`);
  }
  const client = homeClient(config);
  const pkce = await generatePkce();
  const stash: ConnectStash = {
    name: '',
    state: randomB64url(16),
    authOrigin: config.home.origin,
    codeVerifier: pkce.verifier,
    nonce: randomB64url(16),
  };
  if (!writeStash(store, stash, MANDATE_STASH_KEY)) {
    throw new Error('This browser will not let the site keep a secret (session storage is blocked), so the authorisation cannot complete.');
  }
  const url = new URL(
    client.buildAuthorizeUrl({
      authOrigin: stash.authOrigin,
      state: stash.state,
      nonce: stash.nonce,
      codeChallenge: pkce.challenge,
      agentName: '',
      template: BUY_IN_TEMPLATE,
    }),
  );
  // Not part of `buildAuthorizeUrl`'s parameter set, but part of the Home's: the per-charge amount
  // the app is asking for. The Home caps it at whatever it has registered for this client.
  if (maxAmountBaseUnits && /^\d+$/.test(maxAmountBaseUnits)) url.searchParams.set('pay_amount', maxAmountBaseUnits);
  return url.toString();
}

/** The delegation template this card room asks for. Curated at the Home for this client. */
export const BUY_IN_TEMPLATE = 'poker-buyin';

/**
 * Consume a return leg that belongs to the MANDATE ceremony, or report `none` and leave the URL
 * alone for the sign-in path to look at. Which one it is comes from the `state`: each ceremony
 * stashed its own, and only one of them can match.
 */
export function takeMandateCallback(store: StorageLike | null = sessionStore()): CallbackOutcome {
  if (callbackConsumed) return { status: 'none' };
  const cb = parseCallback(location.href);
  if (!cb || cb.kind === 'error') return { status: 'none' };
  const stash = readStash(store, MANDATE_STASH_KEY);
  if (!stash || stash.state !== cb.state) return { status: 'none' };
  const outcome = consumeCallback(location.href, store, MANDATE_STASH_KEY);
  if (outcome.status === 'none') return outcome;
  callbackConsumed = true;
  clearStash(store, MANDATE_STASH_KEY);
  try {
    history.replaceState(null, '', stripAuthParams(location.href));
  } catch {
    /* an unwritable history is not a reason to fail the authorisation */
  }
  return outcome;
}
