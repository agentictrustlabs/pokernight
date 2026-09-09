/**
 * Front-channel single sign-out.
 *
 * The bug: `https://poker.faithnet.io/sso-logout` answered 200 for the Home's sign-out chain and did
 * nothing at all — the SPA's not-found handling serves index.html for every unknown path, so the
 * Home walked on believing the card room had let go. These tests hold the two halves that fix it:
 * the path is a REAL route (never the asset fallback), and the `return` it is handed cannot be used
 * to bounce somebody off our origin.
 */
import { describe, expect, it, vi } from 'vitest';
import worker, { SSO_LOGOUT_PATH, type Env } from '../../worker/index';
import { SESSION_KEY, logoutPageHtml, safeReturnTo } from './ssoLogout';

const SELF_ORIGIN = 'https://poker.faithnet.io';
const HOME = 'https://www.faithnet.me';

describe('safeReturnTo', () => {
  const allow = { selfOrigin: SELF_ORIGIN, homeOrigin: HOME, homeZone: 'faithnet.me' };

  it('follows the Home back, which is the whole point of the chain', () => {
    const back = `${HOME}/logout?fc=2&return=${encodeURIComponent(`${SELF_ORIGIN}/`)}`;
    expect(safeReturnTo(back, allow)).toBe(back);
  });

  /**
   * The Home answers on an apex and a `www` with no redirect between them and hops the chain onto
   * whichever it considers canonical. Trusting only the one configured origin would hand back a
   * refusal and strand the person on our root — the Home's own file says exactly this.
   */
  it('follows any single-label host in the Home’s own zone, over https', () => {
    expect(safeReturnTo('https://faithnet.me/logout', allow)).toBe('https://faithnet.me/logout');
    expect(safeReturnTo('https://www.faithnet.me/logout', allow)).toBe('https://www.faithnet.me/logout');
  });

  it('follows our own origin', () => {
    expect(safeReturnTo(`${SELF_ORIGIN}/#/`, allow)).toBe(`${SELF_ORIGIN}/#/`);
    expect(safeReturnTo('/#/signin', allow)).toBe(`${SELF_ORIGIN}/#/signin`);
  });

  /** The one that matters: a link saying "sign out" must not be able to land you anywhere. */
  it('refuses a foreign origin and lands the person on our front door', () => {
    expect(safeReturnTo('https://evil.example/steal', allow)).toBe(`${SELF_ORIGIN}/`);
    // A lookalike that merely CONTAINS the zone, and a deeper subdomain of it.
    expect(safeReturnTo('https://faithnet.me.evil.example/', allow)).toBe(`${SELF_ORIGIN}/`);
    expect(safeReturnTo('https://a.b.faithnet.me/', allow)).toBe(`${SELF_ORIGIN}/`);
    // Plain http to the right zone is not the Home either.
    expect(safeReturnTo('http://www.faithnet.me/logout', allow)).toBe(`${SELF_ORIGIN}/`);
  });

  it('lands the person somewhere sensible with no return, or a malformed one', () => {
    expect(safeReturnTo(null, allow)).toBe(`${SELF_ORIGIN}/`);
    expect(safeReturnTo('', allow)).toBe(`${SELF_ORIGIN}/`);
    expect(safeReturnTo('http://[::bad', allow)).toBe(`${SELF_ORIGIN}/`);
  });

  /** With no Home config readable, the allowlist narrows to us — never widens. */
  it('trusts nothing but ourselves when the Home is unknown', () => {
    const blind = { selfOrigin: SELF_ORIGIN, homeOrigin: null, homeZone: null };
    expect(safeReturnTo(`${HOME}/logout`, blind)).toBe(`${SELF_ORIGIN}/`);
    expect(safeReturnTo(`${SELF_ORIGIN}/x`, blind)).toBe(`${SELF_ORIGIN}/x`);
  });
});

describe('the /sso-logout page', () => {
  const page = logoutPageHtml({ apiBase: 'https://tables.faithnet.io', returnTo: `${HOME}/logout?fc=1` });

  it('signs the session out at the card room, which is what gives up the seats', () => {
    // The same route an explicit sign-out uses — so a Home-initiated sign-out stands the player up
    // and cashes them out, rather than merely sitting them out the way a dropped socket does.
    expect(page).toContain("'/auth/signout'");
    expect(page).toContain("'Bearer ' + token");
  });

  it('forgets the browser copy of the session, and does it before anything can fail', () => {
    expect(page).toContain(`removeItem(C.key)`);
    expect(page).toContain(SESSION_KEY);
    // Cleared before the request goes out: whatever happens next, this browser is signed out — and
    // the storage event that fires is what signs out the app's other open tabs.
    expect(page.indexOf('removeItem(C.key)')).toBeLessThan(page.indexOf('/auth/signout'));
  });

  it('is harmless with no session: it bounces on without calling anything', () => {
    expect(page).toContain('if (!token) return onward();');
  });

  it('boots no SPA — it has to work on a cold load in the middle of somebody else’s redirect', () => {
    expect(page).not.toContain('/src/main.tsx');
    expect(page).not.toContain('id="root"');
  });

  it('never leaves the person on a spinner if the card room is slow', () => {
    expect(page).toContain('setTimeout(onward, C.waitMs)');
    expect(page).toContain('keepalive: true');
  });

  it('escapes the destination it writes into the page', () => {
    const nasty = logoutPageHtml({ apiBase: 'https://api.test', returnTo: 'https://poker.faithnet.io/"><script>x()</script>' });
    expect(nasty).not.toContain('"><script>x()');
    expect(nasty).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('the Worker route', () => {
  function env(): Env & { assetCalls: number } {
    const e = {
      assetCalls: 0,
      API_BASE: 'https://tables.faithnet.io',
      ASSETS: {
        fetch: async () => {
          e.assetCalls += 1;
          return new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } });
        },
      },
    };
    return e as Env & { assetCalls: number };
  }

  const config = () =>
    vi.fn(async () => new Response(JSON.stringify({ home: { origin: HOME, zone: 'faithnet.me' } }), { headers: { 'content-type': 'application/json' } }));

  it('serves /sso-logout itself, and never lets the SPA fallback answer for it', async () => {
    vi.stubGlobal('fetch', config());
    const e = env();
    const res = await worker.fetch(new Request(`${SELF_ORIGIN}${SSO_LOGOUT_PATH}?return=${encodeURIComponent(`${HOME}/logout?fc=1`)}`), e);
    expect(res.status).toBe(200);
    expect(e.assetCalls).toBe(0);
    const html = await res.text();
    expect(html).toContain('Signing you out');
    expect(html).toContain(`${HOME}/logout?fc=1`);
    // A sign-out page that a cache could replay is not a sign-out page.
    expect(res.headers.get('cache-control')).toBe('no-store');
    vi.unstubAllGlobals();
  });

  it('ignores a foreign return and leaves the person on our own origin', async () => {
    vi.stubGlobal('fetch', config());
    const res = await worker.fetch(new Request(`${SELF_ORIGIN}${SSO_LOGOUT_PATH}?return=https%3A%2F%2Fevil.example%2F`), env());
    const html = await res.text();
    expect(html).not.toContain('evil.example');
    expect(html).toContain(`"returnTo":"${SELF_ORIGIN}/"`);
    vi.unstubAllGlobals();
  });

  /** The Home walks its list idempotently and may well arrive after we are already signed out. */
  it('answers the same way with no return at all, and with a trailing slash', async () => {
    vi.stubGlobal('fetch', config());
    for (const path of [SSO_LOGOUT_PATH, `${SSO_LOGOUT_PATH}/`]) {
      const res = await worker.fetch(new Request(`${SELF_ORIGIN}${path}`), env());
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`"returnTo":"${SELF_ORIGIN}/"`);
    }
    vi.unstubAllGlobals();
  });

  it('still serves the page when the Home config cannot be read — narrowed, not broken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('tables worker unreachable');
      }),
    );
    const res = await worker.fetch(new Request(`${SELF_ORIGIN}${SSO_LOGOUT_PATH}?return=${encodeURIComponent(`${HOME}/logout`)}`), env());
    expect(res.status).toBe(200);
    // Could not check the Home, so did not follow it. Wrong in the safe direction.
    expect(await res.text()).toContain(`"returnTo":"${SELF_ORIGIN}/"`);
    vi.unstubAllGlobals();
  });

  it('hands everything else to the assets, untouched', async () => {
    const e = env();
    for (const path of ['/', '/index.html', '/assets/index-abc.js', '/sso-logout-not-really']) {
      await worker.fetch(new Request(`${SELF_ORIGIN}${path}`), e);
    }
    expect(e.assetCalls).toBe(4);
  });
});
