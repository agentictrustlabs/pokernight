import type { CreateTableRequest, Session, TableSummary, TableView } from '@pokernight/protocol';

/** Base URL of the tables API. `/api` is proxied by Vite in dev; baked at build otherwise. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

const SESSION_KEY = 'pokernight.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (typeof s.token === 'string' && typeof s.playerId === 'string' && typeof s.name === 'string') {
      return { token: s.token, playerId: s.playerId, name: s.name };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
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

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
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

export const api = {
  devLogin: (name: string) => request<Session>('/dev/session', { method: 'POST', body: JSON.stringify({ name }) }),
  listTables: (token?: string) => request<TableSummary[]>('/tables', {}, token),
  createTable: (req: CreateTableRequest, token?: string) =>
    request<TableSummary>('/tables', { method: 'POST', body: JSON.stringify(req) }, token),
  getTable: (id: string, token?: string) => request<TableView>(`/tables/${encodeURIComponent(id)}`, {}, token),
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
