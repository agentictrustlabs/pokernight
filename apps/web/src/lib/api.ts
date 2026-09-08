import type { CreateTableRequest, Session, TableSummary } from '@pokernight/protocol';
import type { AppSession } from './types';
import type { AuthConfig } from './home';
import type { TableDetail } from './lobby';
import type { FundTreasuryResult, SelectTreasuryResult, TableSettlement, TreasuryView } from './treasury';

/** Base URL of the tables API. `/api` is proxied by Vite in dev; baked at build otherwise. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

const SESSION_KEY = 'pokernight.session';

export function loadSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<AppSession>;
    if (typeof s.token === 'string' && typeof s.playerId === 'string' && typeof s.name === 'string') {
      return {
        token: s.token,
        playerId: s.playerId,
        name: s.name,
        via: s.via === 'home' || s.via === 'demo' || s.via === 'dev' ? s.via : s.playerId.startsWith('home:') ? 'home' : 'dev',
        address: typeof s.address === 'string' ? s.address : undefined,
        agentName: typeof s.agentName === 'string' ? s.agentName : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: AppSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode / storage blocked: session lives in memory only */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Told when the API refuses a session token we sent. Registered by the app, which turns it into the
 * one correct outcome: clear the session and land on the sign-in page saying so. It lives here
 * because every route is a place a session can be found dead, and a table view that silently stops
 * updating is the worst of the alternatives.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, notifyUnauthorized = true): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    // A 401 on a request we DID authenticate means this session is over, wherever we were.
    if (res.status === 401 && token && notifyUnauthorized) unauthorizedHandler?.();
    const msg =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : typeof body === 'string' && body
          ? body
          : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

/** What `POST /auth/home` answers with. A superset of `Session`; the extras are display-only. */
export interface HomeSessionResponse extends Session {
  agentName?: string;
  address?: string;
}

/** What the browser hands the Worker on the return leg. The Worker trusts none of it as identity —
 *  it exchanges the code and verifies the id_token itself. */
export interface HomeAuthBody {
  code: string;
  codeVerifier: string;
  authOrigin: string;
  nonce: string;
  state: string;
}

/** What the browser hands the Worker after `connectAsQuickConnect`. The Worker verifies the id_token
 *  against the Home's JWKS itself; this is a shortcut past the code exchange, not past the proof. */
export interface DemoAuthBody {
  idToken: string;
  delegation?: unknown;
  authOrigin: string;
}

export const api = {
  authConfig: () => request<AuthConfig>('/auth/config'),
  homeLogin: (body: HomeAuthBody) => request<HomeSessionResponse>('/auth/home', { method: 'POST', body: JSON.stringify(body) }),
  demoLogin: (body: DemoAuthBody) => request<HomeSessionResponse>('/auth/home/demo', { method: 'POST', body: JSON.stringify(body) }),
  /** Best effort: drops the server-side session record so the token stops resolving straight away.
   *  Never reports a 401 upward — we are already on our way out. */
  signOut: (token: string) => request<{ ok: boolean }>('/auth/signout', { method: 'POST', body: '{}' }, token, false).catch(() => ({ ok: false })),
  devLogin: (name: string) => request<Session>('/dev/session', { method: 'POST', body: JSON.stringify({ name }) }),
  listTables: (token?: string) => request<TableSummary[]>('/tables', {}, token),
  createTable: (req: CreateTableRequest, token?: string) =>
    request<TableSummary>('/tables', { method: 'POST', body: JSON.stringify(req) }, token),
  getTable: (id: string, token?: string) => request<TableDetail>(`/tables/${encodeURIComponent(id)}`, {}, token),

  /** The treasury that funds this session's play, its live balance, and what else it could be. */
  getTreasury: (token: string) => request<TreasuryView>('/treasury', {}, token),
  /** Ask the card room to fund play from `address`. It checks custody on chain before agreeing. */
  selectTreasury: (address: string, token: string) =>
    request<SelectTreasuryResult>('/treasury/select', { method: 'POST', body: JSON.stringify({ address }) }, token),
  /** Mint test USDC into the chosen treasury. Test assets only; the Worker refuses anything else. */
  fundTreasury: (amount: string, token: string) =>
    request<FundTreasuryResult>('/treasury/fund', { method: 'POST', body: JSON.stringify({ amount }) }, token),
  /** Where this player's money at a table has got to. Scoped to the caller by the Worker. */
  getTableSettlement: (id: string, token: string) =>
    request<TableSettlement>(`/tables/${encodeURIComponent(id)}/settlement`, {}, token),
};

/** WebSocket URL for a table, derived from API_BASE (relative or absolute). */
export function tableSocketUrl(tableId: string, token: string | null): string {
  const path = `/tables/${encodeURIComponent(tableId)}/ws`;
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  if (/^https?:\/\//i.test(API_BASE)) {
    return API_BASE.replace(/^http/i, 'ws') + path + q;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${API_BASE}${path}${q}`;
}
