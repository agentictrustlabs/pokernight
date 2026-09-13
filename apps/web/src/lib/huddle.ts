/**
 * A CLUB HUDDLE — the Home's governed call (spec 378), from the card room.
 *
 * THE ARRANGEMENT. A club is a `.workspace` agent its host custodies at their Home; the Home's huddle
 * service (`a2a.faithnet.io`) decides who may start, join, invite or end a huddle at that scope, and
 * Cloudflare RealtimeKit carries the audio, video and screen. This card room keeps the club's ROSTER, so
 * for a `club` scope the Home asks the card room who is a member before it admits anybody (a shared secret
 * between the two workers; `GET /clubs/:id/standing-of`), and the card room calls the Home FOR the member
 * it verified (`POST /clubs/:id/huddle/:op`). The one credential that comes back (the join's `authToken`)
 * passes through the card room once and goes to the browser SDK and nowhere else: not to state that
 * persists, not to a URL, not to a log.
 *
 * WHO MAY BE THERE is the club's roster: a host or member of the club, playing or not. A member who is
 * not seated still sees the table (the socket admits club members as spectators) and hears and sees the
 * others; that is the point — the club watching its own game together.
 */
import type { AuthConfig } from './home';
import { API_BASE } from './api';

export type HuddleScopeKind = 'club';
export interface HuddleScope { kind: HuddleScopeKind; principal: string; id: string }
export interface HuddleRosterEntry { actor: string; represented?: string; role: 'host' | 'participant'; joined: boolean }
export interface HuddleRunView {
  runId: string; scope: HuddleScope; state: 'creating' | 'active' | 'ending' | 'ended';
  startedBy: string; startedAt: number; endedAt?: number; roster: HuddleRosterEntry[];
}
export type HuddleReply =
  | { ok: true; run: HuddleRunView | null; authToken?: string; participant?: { role: 'host' | 'participant'; correlationId: string }; parks?: string }
  | { ok: false; error: string; notConfigured?: boolean; noHomeSession?: boolean };

/**
 * THE ROAD: through the card room. A person who signed in through their Home holds no Home bearer in this
 * browser (the code exchange happened server-side, and a Home credential is not something an app keeps in a
 * tab), so the card room — which verified their session and keeps the club's roster — calls the Home for
 * them, server-to-server under the paired secret, naming their agent. `POST /clubs/:id/huddle/:op` with the
 * card-room session; what comes back is passed through once and kept nowhere.
 */
export function huddlesOffered(config: AuthConfig | null, session: { via?: string } | null): boolean {
  return !!config?.home.a2aOrigin && !!session && session.via !== 'dev';
}

async function op(token: string, name: string, scope: HuddleScope, extra: Record<string, unknown> = {}): Promise<HuddleReply> {
  const r = await fetch(`${API_BASE}/clubs/${encodeURIComponent(scope.id)}/huddle/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: `${name}:${crypto.randomUUID()}`, ...extra }),
  });
  const b = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.ok === true) {
    return { ok: true, run: (b.run as HuddleRunView | null) ?? null, ...(typeof b.authToken === 'string' ? { authToken: b.authToken } : {}), ...(b.participant ? { participant: b.participant as { role: 'host' | 'participant'; correlationId: string } } : {}), ...(typeof b.parks === 'string' ? { parks: b.parks } : {}) };
  }
  const error = String(b.error ?? `the card room answered ${r.status}`);
  return { ok: false, error: error === 'huddles_not_configured' ? 'Huddles are not switched on here yet.' : error, ...(error === 'huddles_not_configured' ? { notConfigured: true } : {}) };
}

export const huddles = {
  get: (token: string, scope: HuddleScope) => op(token, 'get', scope),
  start: (token: string, scope: HuddleScope, displayName: string) => op(token, 'start', scope, { displayName }),
  join: (token: string, scope: HuddleScope, displayName: string) => op(token, 'join', scope, { displayName }),
  leave: (token: string, scope: HuddleScope) => op(token, 'leave', scope),
  end: (token: string, scope: HuddleScope) => op(token, 'end', scope),
};

/** The scope of a club's huddle: its workspace agent, narrowed by the card room's club id. */
export function clubScope(club: { clubId: string; agent?: string | null }): HuddleScope | null {
  return club.agent && /^0x[0-9a-fA-F]{40}$/.test(club.agent) ? { kind: 'club', principal: club.agent.toLowerCase(), id: club.clubId } : null;
}
