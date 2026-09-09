/**
 * The Worker in front of the Pokernight SPA.
 *
 * Almost everything here is `env.ASSETS.fetch(request)` — the client is a static Vite build and this
 * Worker exists for exactly one path: `/sso-logout`, the front-channel sign-out the person's Home
 * navigates to when they sign out there (see `src/lib/ssoLogout.ts` for the contract and the rules).
 *
 * It has to be a REAL route. Before this, `/sso-logout` answered 200 purely because the asset
 * router's single-page-application fallback serves index.html for any unknown path: the Home's
 * sign-out chain saw a success and moved on, and this card room stayed signed in behind it. So the
 * path is claimed here, `run_worker_first` in wrangler.toml makes sure the asset router hands it over
 * rather than swallowing it, and the response is a self-contained document that boots no SPA.
 *
 * The `return` allowlist is decided HERE, not in the browser: the Worker knows which Home this
 * deployment belongs to (it asks the tables Worker, the one place that config lives) and hands the
 * page a destination that has already been checked.
 */

import { logoutPageHtml, safeReturnTo, type LogoutAllowlist } from '../src/lib/ssoLogout';

export interface Env {
  /** Workers Assets binding: the built SPA. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /**
   * Base URL of the tables Worker. The logout page posts the sign-out to it, and this Worker reads
   * the Home config from it so there is one source of truth for which Home we belong to.
   */
  API_BASE?: string;
}

export const SSO_LOGOUT_PATH = '/sso-logout';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === SSO_LOGOUT_PATH || url.pathname === `${SSO_LOGOUT_PATH}/`) {
      return ssoLogout(url, env);
    }
    return env.ASSETS.fetch(request);
  },
};

/**
 * Serve the sign-out page.
 *
 * Never fails the request: a person mid-way through signing out of their Home must not be handed an
 * error page by the app that was supposed to let go of them. If the Home config cannot be read, the
 * allowlist narrows to our own origin — the person lands here rather than being forwarded somewhere
 * we could not check, which is the safe direction to be wrong in.
 */
export async function ssoLogout(url: URL, env: Env): Promise<Response> {
  const apiBase = (env.API_BASE ?? '').trim().replace(/\/+$/, '');
  const allow: LogoutAllowlist = { selfOrigin: url.origin, ...(await homeConfig(apiBase)) };
  const returnTo = safeReturnTo(url.searchParams.get('return'), allow);
  return new Response(logoutPageHtml({ apiBase, returnTo }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // A sign-out page is never a cached page: the next person through this browser must run it.
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

/** Which Home this deployment belongs to, from `GET /auth/config` — the one place that is configured. */
async function homeConfig(apiBase: string): Promise<{ homeOrigin: string | null; homeZone: string | null }> {
  if (!apiBase) return { homeOrigin: null, homeZone: null };
  try {
    const res = await fetch(`${apiBase}/auth/config`, { headers: { accept: 'application/json' } });
    if (!res.ok) return { homeOrigin: null, homeZone: null };
    const body = (await res.json()) as { home?: { origin?: string; zone?: string } };
    const origin = (body.home?.origin ?? '').trim();
    const zone = (body.home?.zone ?? '').trim();
    let normalized: string | null = null;
    try {
      normalized = origin ? new URL(origin).origin : null;
    } catch {
      normalized = null;
    }
    return { homeOrigin: normalized, homeZone: zone || null };
  } catch {
    return { homeOrigin: null, homeZone: null };
  }
}
