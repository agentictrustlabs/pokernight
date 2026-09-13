/**
 * Home sign-in — the BROWSER half of the OIDC ceremony (DESIGN.md §3).
 *
 * We only ever run the front half here: build an authorize request to the person's Home with PKCE
 * S256 + state + nonce (`@agenticprimitives/connect-client`), stash the verifier/nonce/state in
 * `sessionStorage`, and navigate. The Home runs the credential ceremony and returns the person to
 * the registered redirect URI with `?code&state`.
 *
 * The template that request asks for is `poker-buyin`, not `site-login`, wherever this deployment
 * states the caps — so ONE visit to the Home establishes the session AND mints the buy-in mandate,
 * instead of the player being sent back a second time to authorise what they came to do. What that
 * costs is a duty: the sign-in screen has to say what ceiling it is asking for, in the same numbers
 * the Home will show, before anybody is sent anywhere.
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
    /** The template that charters a club, and the `purpose` its link carries at the Home. Absent on
     *  a deployment whose Home is not registered for it — the client then offers no charter. */
    clubTemplate?: string;
    clubPurpose?: string;
    /** The Home's coach-hire template, when this deployment's Home has one. Null ⇒ hiring is not offered. */
    coachTemplate?: string | null;
    /** The Home's A2A worker origin for club huddles (spec 378). Null ⇒ huddles are not offered here. */
    a2aOrigin?: string | null;
    /**
     * The spending ceiling SIGNING IN also asks the player to approve, or null/absent where this
     * deployment cannot ask for one (local dev, a half-configured deployment).
     *
     * Present, the sign-in ceremony asks the Home for the payment template and comes back with the
     * session and the mandate together — so the sign-in screen must say what the player is
     * approving, in these numbers, before it sends them. Absent, sign-in is a plain sign-in and the
     * screen promises nothing about money.
     */
    buyIn?: {
      template: string;
      /** Base units. */
      maxPerBuyIn: string;
      sessionTotal: string;
      maxBuyIns: number;
      maxBuyInChips: number;
      validSeconds: number;
      /** What the money is called: `SHQ`. */
      symbol: string;
    } | null;
  };
}

/** Query parameters the ceremony puts on the return URL; all are stripped once consumed. */
// `treasury`, `treasury_status` and `treasury_error` come back from the Home's treasury ceremony,
// which returns to this SAME redirect URI. They are stripped with the rest so a player never sees a
// raw account address sitting in their address bar, and a refresh cannot replay a finished ceremony.
const CALLBACK_PARAMS = [
  'code',
  'state',
  'error',
  'error_description',
  'error_uri',
  'iss',
  'session_state',
  'ac_relay',
  'ac_iss',
  'treasury',
  'treasury_status',
  'treasury_error',
];

/** What the Home's treasury ceremony said, if this load is a return from it. */
export function readTreasuryReturn(href: string = location.href): { treasury?: string; status?: string; error?: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const treasury = u.searchParams.get('treasury') ?? undefined;
  const status = u.searchParams.get('treasury_status') ?? undefined;
  const error = u.searchParams.get('treasury_error') ?? undefined;
  if (!treasury && !error) return null;
  return { ...(treasury ? { treasury } : {}), ...(status ? { status } : {}), ...(error ? { error } : {}) };
}

export const STASH_KEY = 'pokernight.home.stash';
/** A separate stash, because a buy-in authorisation and a sign-in return to the SAME redirect URI and
 *  must not be mistaken for one another: a mandate ceremony must never mint a new session. */
export const MANDATE_STASH_KEY = 'pokernight.home.mandate';
/** The charter ceremony's own stash — a THIRD ceremony, and a third `state` to tell them apart. */
export const CHARTER_STASH_KEY = 'pokernight.home.charter';
/**
 * The person's own HOME session, when the Home handed one over at quick-connect.
 *
 * DELIBERATELY NOT ON `AppSession`, which is written to `localStorage`. This is a bearer token for
 * somebody's Home, and the difference between `localStorage` and `sessionStorage` here is the
 * difference between a Home credential that outlives the browser and one that dies with the tab.
 * It survives a navigation to the Home and back, which is all a ceremony needs, and nothing else.
 *
 * It exists because a ceremony is a full-page trip to the Home, and a demo persona has no credential
 * to sign in WITH — the Home holds their key. Without the handoff they arrive at a "Continue with
 * Social / email / phone / passkey" screen and none of those four is a thing they have.
 */
export const HOME_SESSION_KEY = 'pokernight.home.session';

export function rememberHomeSession(token: string | undefined, store: StorageLike | null = sessionStore()): void {
  if (!token) return;
  try {
    store?.setItem(HOME_SESSION_KEY, token);
  } catch {
    /* a browser that will not keep it simply sends the person to sign in at their Home */
  }
}

export function readHomeSession(store: StorageLike | null = sessionStore()): string | null {
  try {
    return store?.getItem(HOME_SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

export function forgetHomeSession(store: StorageLike | null = sessionStore()): void {
  try {
    store?.removeItem(HOME_SESSION_KEY);
  } catch {
    /* nothing to do about a store that will not forget */
  }
}
/** Which club the charter now returning is for. The Home carries no app state of ours, so the club
 *  id has to survive the round trip on this origin, next to the stash it belongs with. */
export const CHARTER_CLUB_KEY = 'pokernight.home.charter.club';
export const COACH_STASH_KEY = 'pokernight.home.coach';
export const COACH_NAME_KEY = 'pokernight.home.coach.name';

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
 * A PROFILE name — what a person is called at this table — cleaned up but not reshaped.
 *
 * This is deliberately NOT a Faithnet handle. A handle is claimed by putting `agent_name` on the
 * authorize request, which makes the Home mint `<label>.me`, hop the ceremony to that subdomain, and
 * bind the person to a name in the naming service forever. These accounts are meant to stay nameless
 * there. So the name a person types here is a display name the card room keeps, and nothing else
 * claims anything: "Rich Pedersen" stays "Rich Pedersen" rather than becoming `rich-pedersen.me`.
 *
 * All this does is make it safe to show to other players: one line, no control or zero-width
 * characters, collapsed whitespace, and short enough to fit on a seat plate.
 */
export function toProfileName(input: string): string {
  return input
    // Whitespace FIRST, so a newline becomes a space and does not weld two words together; then the
    // characters that have no business in a name at all.
    .replace(/\s+/g, ' ')
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/^ +/, '')
    .slice(0, PROFILE_NAME_MAX);
}

/**
 * The same name, settled: the version that is stored and shown.
 *
 * The trailing space a person is mid-way through typing has to survive the FIELD — trim on every
 * keystroke and "Rich Pedersen" can never be typed at all — so it is trimmed once, here, on the way
 * out. The card room trims again server-side: nothing about a display name rests on the browser.
 */
export function finishProfileName(input: string): string {
  return toProfileName(input).trim();
}

/** As long as a name may be. A seat plate is narrow, and this is a name, not a sentence. */
export const PROFILE_NAME_MAX = 24;

/** Where the profile name waits while the person is away at their Home. */
export const PROFILE_NAME_KEY = 'pokernight.profileName';

/**
 * Keep the typed name across the redirect. The ceremony leaves this origin entirely, so a name held
 * only in React state would not survive it. Separate from the PKCE stash on purpose: the stash is a
 * secret the ceremony turns on, and this is a display string — losing it must cost a name, never a
 * sign-in, which is why a storage that refuses the write is not an error here.
 */
export function rememberProfileName(store: StorageLike | null, name: string): void {
  const clean = finishProfileName(name);
  try {
    if (clean) store?.setItem(PROFILE_NAME_KEY, clean);
    else store?.removeItem(PROFILE_NAME_KEY);
  } catch {
    /* a browser that will not keep a display name still signs the person in */
  }
}

/** Take the remembered name, once. Returns '' when there is none. */
export function takeProfileName(store: StorageLike | null = sessionStore()): string {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PROFILE_NAME_KEY) ?? null;
    store?.removeItem(PROFILE_NAME_KEY);
  } catch {
    return '';
  }
  return finishProfileName(raw ?? '');
}

/**
 * Start the ceremony: build the authorize URL, persist the stash, then navigate. Throws with a
 * message worth showing if the Home origin is untrusted or the browser will not keep the stash.
 *
 * ONE TRIP, not two. This used to run `startEnrollment`, which hardcodes `site-login`, so the
 * session came back carrying no payment authority and the player was sent straight back to their
 * Home to authorise buy-ins — a second visit that existed only because the first one had asked for
 * the narrower thing. `pokernight` is registered for `poker-buyin` as well, and the Home's payment
 * ceremony mints the mandate DURING the enrol, so asking for that template on the FIRST connect
 * brings the session and the mandate back together.
 *
 * The template is only requested where the deployment states the caps (`config.home.buyIn`),
 * because those caps are what the sign-in screen shows the player before they go. A ceiling nobody
 * was shown is not consent, so no caps means no payment request: a plain `site-login`, exactly as
 * before, and the separate authorisation path still there for whoever needs it.
 *
 * `name` is the person's PROFILE name and it never goes on the authorize request — see
 * {@link toProfileName}. It is remembered on this origin and handed to the card room on the return
 * leg. The enrolment itself stays name-deferred, which is what keeps the account nameless in the
 * naming service, and is also exactly what this flow did before there was a field at all.
 */
export async function startHomeSignIn(
  config: AuthConfig,
  name = '',
  store: StorageLike | null = sessionStore(),
): Promise<string> {
  if (!config.home.clientId || !config.home.origin) throw new Error('This deployment has no Home configured.');
  if (!isAllowedHomeOrigin(config.home.zone, config.home.origin)) {
    throw new Error(`Refusing to sign in at ${config.home.origin}: it is not a trusted Home for this site.`);
  }
  const client = homeClient(config);
  const offer = config.home.buyIn ?? null;

  // No caps to show means no ceiling to ask for: the ordinary name-deferred `site-login` enrolment,
  // byte-for-byte what this did before.
  if (!offer) {
    const { url, stash } = await connectViaRedirect(client);
    if (!writeStash(store, stash)) {
      throw new Error('This browser will not let the site keep a sign-in secret (session storage is blocked), so sign-in cannot complete.');
    }
    rememberProfileName(store, name);
    return url;
  }

  // The same PKCE/state/nonce ceremony `connectViaRedirect` runs, with the template the caller
  // actually wants. `buildAuthorizeUrl` is on the public client interface precisely so an app can
  // ask for a template it is registered for; `startEnrollment` is the site-login shorthand.
  const pkce = await generatePkce();
  const stash: ConnectStash = {
    name: '',
    state: randomB64url(16),
    authOrigin: config.home.origin,
    codeVerifier: pkce.verifier,
    nonce: randomB64url(16),
  };
  if (!writeStash(store, stash)) {
    throw new Error('This browser will not let the site keep a sign-in secret (session storage is blocked), so sign-in cannot complete.');
  }
  rememberProfileName(store, name);
  const url = new URL(
    client.buildAuthorizeUrl({
      authOrigin: stash.authOrigin,
      state: stash.state,
      nonce: stash.nonce,
      codeChallenge: pkce.challenge,
      agentName: '',
      template: offer.template || BUY_IN_TEMPLATE,
    }),
  );
  // The per-charge amount asked for. The Home caps it at whatever it has registered for this client,
  // so this can only ever ask for less than the ceiling the player is shown — never more.
  if (/^\d+$/.test(offer.maxPerBuyIn)) url.searchParams.set('pay_amount', offer.maxPerBuyIn);
  return url.toString();
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

/* ------------------------------------------------------------ chartering a club */

/** The template that deploys a club as its own `<label>.workspace` Smart Agent, at the host's Home. */
export const CLUB_TEMPLATE = 'workspace-create';

/**
 * Send the host to their Home to charter a club.
 *
 * The same ceremony shape as sign-in and the buy-in authorisation, with the template changed and one
 * extra parameter: `org_base`, the name to deploy the workspace under. The Home does the deploying
 * and the custody — the card room never holds the club's key, exactly as it never holds a player's
 * — and hands back the address on the token exchange, which the Worker runs.
 *
 * The club id is stashed beside the PKCE stash because the Home carries no state of ours. Without it
 * the return leg would know a club had been chartered and not which one, and guessing is how a club
 * ends up pointed at another club's agent.
 */
export async function startClubCharter(
  config: AuthConfig,
  club: { clubId: string; name: string },
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
  if (!writeStash(store, stash, CHARTER_STASH_KEY)) {
    throw new Error('This browser will not let the site keep a secret (session storage is blocked), so the club cannot be chartered.');
  }
  try {
    store?.setItem(CHARTER_CLUB_KEY, club.clubId);
  } catch {
    throw new Error('This browser will not let the site remember which club you are chartering, so the return trip could not be matched.');
  }
  const url = new URL(
    client.buildAuthorizeUrl({
      authOrigin: stash.authOrigin,
      state: stash.state,
      nonce: stash.nonce,
      codeChallenge: pkce.challenge,
      agentName: '',
      template: config.home.clubTemplate ?? CLUB_TEMPLATE,
    }),
  );
  // The Home's own parameters, not `buildAuthorizeUrl`'s: the name to deploy under, and WHY this
  // agent exists — which is what the person will see beside it in their own list of agents forever.
  url.searchParams.set('org_base', club.name);
  if (config.home.clubPurpose) url.searchParams.set('purpose', config.home.clubPurpose);
  // ARRIVE ALREADY SIGNED IN, when the Home gave us their session to hand back. The Home consumes
  // `#session=` the same way it consumes its own cookie. Without it a demo persona lands on a
  // sign-in screen offering four credentials they do not have, because the Home holds their key.
  // With no session we ask the Home to let them choose an account rather than guessing at one.
  const home = readHomeSession(store);
  if (home) url.hash = `session=${encodeURIComponent(home)}`;
  else url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Which club the charter callback belongs to, consumed once. */
/* ------------------------------------------------------------ hiring a coach */

/** The template that hires a coach at the person's Home: a specialist in their playbook and a study grant. */
export const COACH_TEMPLATE = 'coach-hire';

/**
 * Send the person to their Home to HIRE A COACH.
 *
 * Same ceremony shape as the club charter, template changed, one extra parameter: `coach`, the coaching
 * service's typed name. The Home does the two custodial acts the card room cannot — writes the specialist
 * line into the person's playbook and has them sign the study grant that lets the service read their
 * card-room records — and hands back what it bound on the token exchange, which the Worker runs. The coach
 * name is stashed beside the PKCE stash because the Home carries no state of ours.
 */
export async function startCoachHire(config: AuthConfig, coach: string, store: StorageLike | null = sessionStore()): Promise<string> {
  if (!config.home.clientId || !config.home.origin) throw new Error('This deployment has no Home configured.');
  if (!config.home.coachTemplate) throw new Error('Your Home does not offer coach hiring yet.');
  if (!isAllowedHomeOrigin(config.home.zone, config.home.origin)) {
    throw new Error(`Refusing to send you to ${config.home.origin}: it is not a trusted Home for this site.`);
  }
  const client = homeClient(config);
  const pkce = await generatePkce();
  const stash: ConnectStash = { name: '', state: randomB64url(16), authOrigin: config.home.origin, codeVerifier: pkce.verifier, nonce: randomB64url(16) };
  if (!writeStash(store, stash, COACH_STASH_KEY)) {
    throw new Error('This browser will not let the site keep a secret (session storage is blocked), so the coach cannot be hired.');
  }
  try {
    store?.setItem(COACH_NAME_KEY, coach);
  } catch {
    throw new Error('This browser will not let the site remember which coach you are hiring, so the return trip could not be matched.');
  }
  const url = new URL(client.buildAuthorizeUrl({ authOrigin: stash.authOrigin, state: stash.state, nonce: stash.nonce, codeChallenge: pkce.challenge, agentName: '', template: config.home.coachTemplate }));
  url.searchParams.set('coach', coach);
  // Arrive already signed in, exactly as the club charter does (a demo persona has no credential to present).
  const home = readHomeSession(store);
  if (home) url.hash = `session=${encodeURIComponent(home)}`;
  else url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export function takeCoachName(store: StorageLike | null = sessionStore()): string | null {
  try {
    const v = store?.getItem(COACH_NAME_KEY) ?? null;
    store?.removeItem(COACH_NAME_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Consume a return leg belonging to the COACH-HIRE ceremony, told apart by its own `state`. */
export function takeCoachCallback(store: StorageLike | null = sessionStore()): CallbackOutcome {
  if (callbackConsumed) return { status: 'none' };
  const cb = parseCallback(location.href);
  if (!cb || cb.kind === 'error') return { status: 'none' };
  const stash = readStash(store, COACH_STASH_KEY);
  if (!stash || stash.state !== cb.state) return { status: 'none' };
  const outcome = consumeCallback(location.href, store, COACH_STASH_KEY);
  if (outcome.status === 'none') return outcome;
  callbackConsumed = true;
  clearStash(store, COACH_STASH_KEY);
  try {
    history.replaceState(null, '', stripAuthParams(location.href));
  } catch {
    /* an unwritable history is not a reason to fail the hire */
  }
  return outcome;
}

export function takeCharterClub(store: StorageLike | null = sessionStore()): string | null {
  try {
    const v = store?.getItem(CHARTER_CLUB_KEY) ?? null;
    store?.removeItem(CHARTER_CLUB_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Consume a return leg belonging to the CHARTER ceremony, told apart by its own `state`. */
export function takeCharterCallback(store: StorageLike | null = sessionStore()): CallbackOutcome {
  if (callbackConsumed) return { status: 'none' };
  const cb = parseCallback(location.href);
  if (!cb || cb.kind === 'error') return { status: 'none' };
  const stash = readStash(store, CHARTER_STASH_KEY);
  if (!stash || stash.state !== cb.state) return { status: 'none' };
  const outcome = consumeCallback(location.href, store, CHARTER_STASH_KEY);
  if (outcome.status === 'none') return outcome;
  callbackConsumed = true;
  clearStash(store, CHARTER_STASH_KEY);
  try {
    history.replaceState(null, '', stripAuthParams(location.href));
  } catch {
    /* an unwritable history is not a reason to fail the charter */
  }
  return outcome;
}

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
