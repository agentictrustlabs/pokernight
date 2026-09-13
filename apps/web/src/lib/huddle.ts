/**
 * A CLUB HUDDLE — the Home's governed call (spec 378), from the card room.
 *
 * THE ARRANGEMENT. A club is a `.workspace` agent its host custodies at their Home; the Home's huddle
 * service (`a2a.faithnet.io`) decides who may start, join, invite or end a huddle at that scope, and
 * Cloudflare RealtimeKit carries the audio, video and screen. This card room keeps the club's ROSTER, so
 * for a `club` scope the Home asks the card room who is a member before it admits anybody (a shared secret
 * between the two workers; `GET /clubs/:id/standing-of`). The person themselves acts with THEIR OWN Home
 * session, straight from this browser to the Home's worker — no token of theirs ever reaches the card
 * room, and the one credential that comes back (the join's `authToken`) goes to the browser SDK and
 * nowhere else: not to state that persists, not to a URL, not to a log.
 *
 * WHO MAY BE THERE is the club's roster: a host or member of the club, playing or not. A member who is
 * not seated still sees the table (the socket admits club members as spectators) and hears and sees the
 * others; that is the point — the club watching its own game together.
 */
import { readHomeSession, type AuthConfig } from './home';

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

/** The Home's CSRF bootstrap: a signed, origin-bound token this browser sends as a custom header. Fetched once per page. */
let csrf: Promise<string> | null = null;
async function csrfToken(a2a: string): Promise<string> {
  if (!csrf) {
    csrf = fetch(`${a2a}/auth/csrf`, { credentials: 'include' })
      .then(async (r) => { const b = (await r.json().catch(() => ({}))) as { token?: string }; if (!b.token) throw new Error('the Home gave no csrf token'); return b.token; })
      .catch((e) => { csrf = null; throw e; });
  }
  return csrf;
}

export function huddlesOffered(config: AuthConfig | null): boolean {
  return !!config?.home.a2aOrigin && !!readHomeSession();
}

async function op(config: AuthConfig, name: string, scope: HuddleScope, extra: Record<string, unknown> = {}): Promise<HuddleReply> {
  const a2a = (config.home.a2aOrigin ?? '').replace(/\/$/, '');
  if (!a2a) return { ok: false, error: 'This card room has no Home huddle service configured.', notConfigured: true };
  const session = readHomeSession();
  if (!session) return { ok: false, error: 'Sign in through your Home to join a huddle.', noHomeSession: true };
  let token: string;
  try { token = await csrfToken(a2a); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const r = await fetch(`${a2a}/huddles/${name}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify({ session, scope, key: `${name}:${crypto.randomUUID()}`, ...extra }),
  });
  const b = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.ok === true) {
    return { ok: true, run: (b.run as HuddleRunView | null) ?? null, ...(typeof b.authToken === 'string' ? { authToken: b.authToken } : {}), ...(b.participant ? { participant: b.participant as { role: 'host' | 'participant'; correlationId: string } } : {}), ...(typeof b.parks === 'string' ? { parks: b.parks } : {}) };
  }
  const error = String(b.error ?? `the Home answered ${r.status}`);
  return { ok: false, error: error === 'huddles_not_configured' ? 'Huddles are not switched on at this Home yet.' : error, ...(error === 'huddles_not_configured' ? { notConfigured: true } : {}) };
}

export const huddles = {
  get: (config: AuthConfig, scope: HuddleScope) => op(config, 'get', scope),
  start: (config: AuthConfig, scope: HuddleScope, displayName: string) => op(config, 'start', scope, { displayName }),
  join: (config: AuthConfig, scope: HuddleScope, displayName: string) => op(config, 'join', scope, { displayName }),
  leave: (config: AuthConfig, scope: HuddleScope) => op(config, 'leave', scope),
  end: (config: AuthConfig, scope: HuddleScope) => op(config, 'end', scope),
};

/** The scope of a club's huddle: its workspace agent, narrowed by the card room's club id. */
export function clubScope(club: { clubId: string; agent?: string | null }): HuddleScope | null {
  return club.agent && /^0x[0-9a-fA-F]{40}$/.test(club.agent) ? { kind: 'club', principal: club.agent.toLowerCase(), id: club.clubId } : null;
}
