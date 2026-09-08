/**
 * Where a session ends, and where the person ends up. Both ways out land on the sign-in page; only
 * one of them owes an explanation.
 */
import { describe, expect, it } from 'vitest';
import { SESSION_ENDED_NOTICE, signOutTo } from './session';
import { SIGNIN_HASH, route } from './routes';

describe('signOutTo', () => {
  it('sends a person who signed out to the sign-in page, saying nothing', () => {
    expect(signOutTo('user')).toEqual({ session: null, notice: null, hash: SIGNIN_HASH, revoke: true });
    expect(route(SIGNIN_HASH)).toEqual({ page: 'signin' });
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
