/**
 * Where a session ends, and where the person ends up. Both ways out land on the sign-in page; only
 * one of them owes an explanation.
 */
import { describe, expect, it } from 'vitest';
import { seatLabel } from './format';
import { SESSION_ENDED_NOTICE, describeSignOut, displayName, signOutTo } from './session';
import type { SignOutResult } from './types';
import { SIGNIN_HASH, route } from './routes';

describe('signOutTo', () => {
  it('sends a person who signed out to the sign-in page, saying nothing', () => {
    expect(signOutTo('user')).toEqual({ session: null, notice: null, hash: SIGNIN_HASH, revoke: true, standUp: true });
    expect(route(SIGNIN_HASH)).toEqual({ page: 'signin' });
  });

  /**
   * The asymmetry that matters. An explicit sign-out gives up the seats and cashes them out; a
   * session that merely lapsed does NOT — it behaves like a dropped connection, so the seat and the
   * chips stay put. An expired token is not consent to move somebody's money.
   */
  it('gives up seats only when the person ASKED to sign out, never when a session expired', () => {
    expect(signOutTo('user').standUp).toBe(true);
    expect(signOutTo('expired').standUp).toBe(false);
    expect(signOutTo('expired').revoke).toBe(false);
  });

  it('sends a person whose session was refused to the same place, with a reason', () => {
    const out = signOutTo('expired');
    expect(out.session).toBeNull();
    expect(out.hash).toBe(SIGNIN_HASH);
    expect(out.notice).toBe(SESSION_ENDED_NOTICE);
    // Nothing to revoke: the API has already refused this token.
    expect(out.revoke).toBe(false);
  });

  it('never lands anywhere a signed-out person cannot act', () => {
    for (const reason of ['user', 'expired'] as const) {
      const out = signOutTo(reason);
      expect(out.hash).not.toBe('#/');
      expect(route(out.hash).page).toBe('signin');
    }
  });
});

describe('describeSignOut', () => {
  const result = (over: Partial<SignOutResult> = {}): SignOutResult => ({ ok: true, stoodUp: [], failed: [], ...over });

  it('says nothing when there were no seats to give up', () => {
    expect(describeSignOut(result())).toBeNull();
  });

  it('says a play-money seat was given up, and claims nothing about money', () => {
    const said = describeSignOut(
      result({ stoodUp: [{ tableId: 't1', tableName: 'Cash Game', seat: 3, chips: 120, settlement: 'play-money', pending: false }] }),
    );
    expect(said).toBe('You were stood up from Cash Game.');
    expect(said).not.toContain('SHQ');
  });

  /** The one thing this must never do: report a queued cash-out as money that has arrived. */
  it('says a settled cash-out is on its way, NOT that it is back', () => {
    const said = describeSignOut(
      result({ stoodUp: [{ tableId: 't2', tableName: 'Real Money', seat: 0, chips: 200, settlement: 'mandate-transfer', pending: true }] }),
    ) as string;
    expect(said).toContain('on its way back to your treasury and has not landed yet');
    expect(said).not.toMatch(/back in your treasury|has been returned|refunded/);
  });

  it('names a seat it could not give up, and says the chips are still on it', () => {
    const said = describeSignOut(
      result({ ok: false, failed: [{ tableId: 't3', tableName: 'Dollar Table', reason: 'the table could not be reached' }] }),
    ) as string;
    expect(said).toContain('Dollar Table');
    expect(said).toContain('Your chips are still on that seat.');
  });
});

describe('route', () => {
  it('reads the three pages, and treats anything else as the front door', () => {
    expect(route('/')).toEqual({ page: 'home' });
    expect(route('')).toEqual({ page: 'home' });
    expect(route('#/')).toEqual({ page: 'home' });
    expect(route('/signin')).toEqual({ page: 'signin' });
    expect(route('#/signin')).toEqual({ page: 'signin' });
    expect(route('/signin/')).toEqual({ page: 'signin' });
    expect(route('/t/abc-123')).toEqual({ page: 'table', tableId: 'abc-123' });
    expect(route('#/t/a%20b')).toEqual({ page: 'table', tableId: 'a b' });
    expect(route('/nonsense')).toEqual({ page: 'home' });
  });

  it('ignores the in-page anchors the landing page uses, so they do not change the page', () => {
    // "Take a seat" scrolls to #signin ON the landing page; it must not be read as the /signin route.
    expect(route('signin')).toEqual({ page: 'home' });
    expect(route('#how')).toEqual({ page: 'home' });
    expect(route('#live')).toEqual({ page: 'home' });
  });
});

describe('names on screen', () => {
  it('uses the name a Home asserted', () => {
    expect(displayName({ name: 'richard.me', agentName: 'richard.me' })).toBe('richard.me');
    expect(seatLabel('richard.me', 2)).toBe('richard.me');
  });

  /**
   * A Home that knows someone as a phone number or an email address asserts no agent name and hands
   * back their Smart Agent address as the display name. Neither the top bar nor a seat plate is a
   * place for a raw `0x…`, so neither shows one.
   */
  it('never puts an address on screen, in either place', () => {
    const nameless = { name: '0x2a5ae595…653c2747', address: '0x2a5ae595cc5009c8517780e78a20a34e653c2747' };
    expect(displayName(nameless)).toBe('You');
    expect(displayName({ name: '0x2a5ae595cc5009c8517780e78a20a34e653c2747' })).toBe('You');
    expect(seatLabel('0x2a5ae595…653c2747', 2)).toBe('Seat 3');
    expect(seatLabel('', 0)).toBe('Seat 1');
    expect(seatLabel(null, 5)).toBe('Seat 6');
  });
});
