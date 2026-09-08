/**
 * SessionDO — one instance per `playerId`, holding the server-side half of a Home session.
 *
 * The bearer token stays tiny (playerId, name, exp, HMAC — see `auth.ts`); everything a session knows
 * that a token has no business carrying lives here: the person's Smart Agent address and the
 * SA-signed scoped delegation the Home issued to `HOME_DELEGATE`. Phase 3 reads the delegation from
 * here when a seat moves USDC; nothing on the wire ever carries it.
 *
 * Existence is also the revocation switch: `resolveSession` refuses a `home:` token whose record has
 * been deleted (sign-out), and the record deletes itself on an alarm at the id_token's expiry so the
 * store stays bounded without a sweeper.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';

/** The stored record. `delegation` is opaque JSON — this app never interprets it. */
export interface SessionRecord {
  playerId: string;
  name: string;
  /** Person's Smart Agent address, lowercased. Also encoded in `playerId`, so it is re-derivable. */
  address: string;
  agentName?: string;
  /** The Home origin that minted the id_token (== its `iss`). */
  homeOrigin: string;
  /** SA-signed scoped delegation to the relying delegate. Phase 3 spends against it. */
  delegation?: unknown;
  issuedAt: number;
  /** Absolute ms; the record self-deletes at this point. */
  expiresAt: number;
}

const KEY = 'record';

export class SessionDO extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/record') return json({ error: 'not found' }, 404);

    if (request.method === 'PUT') {
      const rec = (await request.json()) as SessionRecord;
      await this.ctx.storage.put(KEY, rec);
      // Self-cleaning: the record is worthless once the session it describes has expired.
      await this.ctx.storage.setAlarm(Math.max(rec.expiresAt, Date.now() + 1000));
      return json({ ok: true });
    }

    if (request.method === 'DELETE') {
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }

    if (request.method === 'GET') {
      const rec = await this.ctx.storage.get<SessionRecord>(KEY);
      if (!rec) return json({ error: 'no session' }, 404);
      if (rec.expiresAt <= Date.now()) {
        await this.ctx.storage.deleteAll();
        return json({ error: 'session expired' }, 404);
      }
      return json(rec);
    }

    return json({ error: 'method not allowed' }, 405);
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
