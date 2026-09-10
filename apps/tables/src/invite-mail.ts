/**
 * Having an invitation MAILED — by the host's Home, never by the card room.
 *
 * The card room has no mail key and should never have one. Sending email is a thing a person's Home
 * already does on their behalf, with their own sender identity and their own deliverability, and
 * `POST /connect/app-invite/email` exists for exactly this: a registered app hands Home an address
 * and a link that lives on the app, and Home posts it. The key stays at Home; the link must be on an
 * origin registered for this app, which is what stops this route from becoming an open mailer.
 *
 * IT RIDES THE HOST'S OWN SESSION. The bearer is the id_token the host signed in with, so the
 * invitation goes out as something a person did, not as something a Worker did — and a host whose
 * session has expired cannot send one, which is the correct answer rather than an inconvenience.
 *
 * WHAT HAPPENS IF MAIL IS OFF. The Home answers `delivery: "logged"` when it has no sender
 * configured, and this returns that verbatim. The caller then shows the host the link to send
 * themselves. A deployment with no mailer must not look like one that silently drops invitations.
 */

import type { Env } from './env.js';
import { sessionStub } from './auth.js';
import type { SessionRecord } from './session-do.js';

export type MailOutcome =
  | { ok: true; delivery: 'sent' | 'logged' }
  /** The link is still good — the host can send it themselves. `why` is quotable at them. */
  | { ok: false; why: string };

/** The id_token this player signed in with, or null when the record is gone (signed out, expired). */
async function idTokenOf(env: Env, playerId: string): Promise<string | null> {
  try {
    const res = await sessionStub(env, playerId).fetch('https://session/record');
    if (!res.ok) return null;
    return ((await res.json()) as SessionRecord).idToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask the host's Home to mail `joinUrl` to `email`.
 *
 * Never throws and never fails the invitation: the record is already written, the link already
 * works, and a mailer that is down is a reason to show the host the link, not to lose the
 * invitation they just made.
 */
export async function mailInvite(
  env: Env,
  opts: { playerId: string; homeOrigin?: string; email: string; joinUrl: string; clubName: string },
): Promise<MailOutcome> {
  const idToken = await idTokenOf(env, opts.playerId);
  if (!idToken) return { ok: false, why: 'this session cannot ask your Home to send mail — sign in again, or send the link yourself' };
  const origin = (opts.homeOrigin ?? env.HOME_ORIGIN ?? '').trim();
  if (!origin) return { ok: false, why: 'no Home is configured to send from' };

  let res: Response;
  try {
    res = await fetch(new URL('/connect/app-invite/email', origin).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        email: opts.email,
        returnUrl: opts.joinUrl,
        app: (env.HOME_CLIENT_ID ?? '').trim(),
        // What the mail says they are being invited TO. The club's name, not this app's.
        name: opts.clubName,
      }),
    });
  } catch {
    return { ok: false, why: 'your Home could not be reached to send the invitation' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, why: body?.error ?? `your Home refused to send the invitation (${res.status})` };
  }
  const body = (await res.json().catch(() => null)) as { delivery?: string } | null;
  return { ok: true, delivery: body?.delivery === 'sent' ? 'sent' : 'logged' };
}
