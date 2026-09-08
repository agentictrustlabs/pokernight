/**
 * The Home's demo users — the NETWORK half (the pure half is `demo.ts`).
 *
 * Two calls, and neither of them is a shortcut past proof:
 *   `listQuickConnect`  asks the Home who it lends out. Never throws; `[]` means "offer nothing".
 *   `connectAsQuickConnect` asks the Home for a session. What comes back is an ordinary sign-in
 *   result — an id_token and a site-login delegation — which we hand STRAIGHT to the tables Worker
 *   (`POST /auth/home/demo`) for the same JWKS verification a redirect sign-in gets. This app never
 *   decides who anyone is.
 */

import { connectAsQuickConnect, listQuickConnect, type QuickConnectConfig } from '@agenticprimitives/connect-client';
import { api } from './api';
import { mapDemoPersonas, type DemoPersona } from './demo';
import type { AuthConfig } from './home';
import type { AppSession } from './types';

/** The Home and client id come from `GET /auth/config`; this app hardcodes no origin (ADR-0021). */
export function quickConnectConfig(config: AuthConfig): QuickConnectConfig {
  return { homeOrigin: config.home.origin, clientId: config.home.clientId };
}

/** The roster, ready to render. `[]` for a Home that offers none, or that we cannot reach. */
export async function fetchDemoPersonas(config: AuthConfig): Promise<DemoPersona[]> {
  if (!config.home.origin || !config.home.clientId) return [];
  return mapDemoPersonas(await listQuickConnect(quickConnectConfig(config)));
}

/** Connect as one of them. Throws — a person clicked something, so a failure has to say so. */
export async function connectAsDemoUser(config: AuthConfig, handle: string): Promise<AppSession> {
  const result = await connectAsQuickConnect(quickConnectConfig(config), handle);
  const session = await api.demoLogin({
    idToken: result.idToken,
    delegation: result.delegation,
    authOrigin: config.home.origin,
  });
  return {
    token: session.token,
    playerId: session.playerId,
    name: session.name,
    via: 'demo',
    address: session.address,
    agentName: session.agentName,
  };
}
