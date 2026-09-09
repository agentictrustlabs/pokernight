/**
 * SessionDO — one instance per `playerId`, holding the server-side half of a Home session.
 *
 * The bearer token stays tiny (playerId, name, exp, HMAC — see `auth.ts`); everything a session knows
 * that a token has no business carrying lives here: the person's Smart Agent address and the
 * SA-signed scoped delegation the Home issued to `HOME_DELEGATE`. Phase 3 reads the delegation from
 * here when a seat moves money; nothing on the wire ever carries it.
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
  /**
   * The display name the person typed on the sign-in page, when they gave one. Kept apart from
   * `agentName` on purpose: that is a Faithnet handle the Home asserted, this is a name this card
   * room calls them by, and these accounts are meant to stay nameless in the naming service. A
   * Home-supplied profile name, once one rides the id_token, takes precedence over this — see
   * `issueHomeSession`.
   */
  profileName?: string;
  /** The Home origin that minted the id_token (== its `iss`). */
  homeOrigin: string;
  /** SA-signed scoped delegation to the relying delegate. Phase 3 spends against it. */
  delegation?: unknown;
  /**
   * The id_token the Home minted at sign-in.
   *
   * Kept here and NOWHERE else: it is what lets the Worker ask the person's own Home which treasuries
   * they have (`GET /connect/related-orgs`). It never goes back to the browser and never rides on a
   * pokernight token — the session token stays a claims-only HMAC. Its own `exp` bounds the session,
   * so a record that exists has an id_token that has not expired.
   */
  idToken?: string;
  /**
   * The treasury Smart Agent this player chose to fund their play with, lowercased. Chosen once per
   * connect (`POST /treasury/select`) and verified there — the custodian check happens before it is
   * written, so anything stored here is a treasury this person actually custodies.
   *
   * It lives on the SERVER because a seat that pays out to an address the browser supplied would be
   * a browser deciding where money goes. The table reads it from here, never from the wire.
   */
  treasury?: string;
  /** `<label>.treasury` when the chosen treasury has a name, else ''. Display only. */
  treasuryName?: string;
  /**
   * The signed `poker-buyin` mandate delegation, when the player has one. Opaque JSON; only
   * `@pokernight/treasury` interprets it. Written by `POST /treasury/mandate` after the delegation
   * has been checked against this session's treasury, the house delegate, the payee and the window.
   * Absent means a mandate-transfer buy-in refuses by name rather than guessing.
   */
  buyInMandate?: unknown;
  /**
   * The treasury `buyInMandate` was signed BY. A mandate authorises one account to be spent from, so
   * switching treasury must invalidate it rather than quietly re-point it at money the player never
   * authorised. `playerFunding` refuses to hand the adapter a mandate whose binding has moved.
   */
  mandateTreasury?: string;
  /**
   * The CURRENCY `buyInMandate` is denominated in. A mandate names one asset as well as one account:
   * an authority to move one currency says nothing about a treasury's holdings in another. A table settling in
   * a different coin therefore may not use it, which is what `PokerTableDO.playerFunding` enforces.
   */
  mandateAsset?: string;
  /**
   * A payment mandate the player's Home minted during SIGN-IN, before this card room knew which
   * treasury the session would spend from.
   *
   * Sign-in asks the Home for the payment template, so the mandate arrives with the session rather
   * than on a second trip. It cannot be accepted at that instant: a mandate is an authority over one
   * named account, and the card room has not yet asked the Home which of the player's accounts are
   * theirs. So it waits here, unaccepted and unusable, until `GET /treasury` discovers the player's
   * treasuries and can check it against one of them — at which point it is promoted to
   * `buyInMandate` through exactly the same verification a hand-delivered mandate goes through, or
   * dropped. Nothing ever spends under this field.
   */
  pendingMandate?: unknown;
  /** Unix SECONDS the mandate stops being valid, for the panel to show without decoding caveats. */
  mandateValidUntil?: number;
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

    if (request.method === 'POST') {
      // Partial update: the treasury choice must not require re-writing (and so risk losing) the
      // identity half of the record.
      const patch = (await request.json()) as {
        treasury?: string | null;
        treasuryName?: string | null;
        buyInMandate?: unknown;
        mandateTreasury?: string | null;
        mandateAsset?: string | null;
        mandateValidUntil?: number | null;
        pendingMandate?: unknown;
      };
      const rec = await this.ctx.storage.get<SessionRecord>(KEY);
      if (!rec) return json({ error: 'no session' }, 404);
      if (rec.expiresAt <= Date.now()) {
        await this.ctx.storage.deleteAll();
        return json({ error: 'session expired' }, 404);
      }
      const next: SessionRecord = { ...rec };
      if (patch.treasury === null) delete next.treasury;
      else if (typeof patch.treasury === 'string') next.treasury = patch.treasury.toLowerCase();
      if (patch.treasuryName === null) delete next.treasuryName;
      else if (typeof patch.treasuryName === 'string') next.treasuryName = patch.treasuryName;
      if ('buyInMandate' in patch) {
        if (patch.buyInMandate === null) delete next.buyInMandate;
        else next.buyInMandate = patch.buyInMandate;
      }
      if (patch.mandateTreasury === null) delete next.mandateTreasury;
      else if (typeof patch.mandateTreasury === 'string') next.mandateTreasury = patch.mandateTreasury.toLowerCase();
      if (patch.mandateAsset === null) delete next.mandateAsset;
      else if (typeof patch.mandateAsset === 'string') next.mandateAsset = patch.mandateAsset.toLowerCase();
      if (patch.mandateValidUntil === null) delete next.mandateValidUntil;
      else if (typeof patch.mandateValidUntil === 'number') next.mandateValidUntil = patch.mandateValidUntil;
      if ('pendingMandate' in patch) {
        if (patch.pendingMandate === null) delete next.pendingMandate;
        else next.pendingMandate = patch.pendingMandate;
      }
      await this.ctx.storage.put(KEY, next);
      return json(next);
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
