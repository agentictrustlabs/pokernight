/**
 * The pure half of Home sign-in: the stash round trip, the callback URL parsing, and the issuer
 * allowlist. Everything a live ceremony needs (a person at their Home, a real code, the Worker's
 * exchange) is out of reach here by construction — these tests cover the parts that decide what the
 * browser does BEFORE and AFTER that, which is where the mistakes that lose a sign-in live.
 */

import { describe, expect, it } from 'vitest';
import type { ConnectStash } from '@agenticprimitives/connect-client';
import {
  BUY_IN_TEMPLATE,
  MANDATE_STASH_KEY,
  STASH_KEY,
  clearStash,
  consumeCallback,
  describeCallbackError,
  isAllowedHomeOrigin,
  parseCallback,
  readStash,
  startBuyInMandate,
  stripAuthParams,
  writeStash,
  type AuthConfig,
  type StorageLike,
} from './home';

/** A `Storage`-shaped map. `throwOn` simulates private-mode storage, which throws on write. */
function fakeStore(throwOn?: 'set' | 'get'): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem(k) {
      if (throwOn === 'get') throw new Error('blocked');
      return map.get(k) ?? null;
    },
    setItem(k, v) {
      if (throwOn === 'set') throw new Error('blocked');
      map.set(k, v);
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

const stash: ConnectStash = {
  name: '',
  state: 'st-abc',
  authOrigin: 'https://www.faithnet.me',
  codeVerifier: 'verifier-xyz',
  nonce: 'nonce-123',
};

describe('the PKCE stash', () => {
  it('round-trips through storage', () => {
    const store = fakeStore();
    expect(writeStash(store, stash)).toBe(true);
    expect(store.map.get(STASH_KEY)).toBeTruthy();
    expect(readStash(store)).toEqual(stash);
    clearStash(store);
    expect(readStash(store)).toBeNull();
  });

  it('reports failure rather than throwing when storage is blocked', () => {
    expect(writeStash(fakeStore('set'), stash)).toBe(false);
    expect(writeStash(null, stash)).toBe(false);
    expect(readStash(fakeStore('get'))).toBeNull();
    expect(readStash(null)).toBeNull();
    expect(() => clearStash(null)).not.toThrow();
  });

  it('refuses anything that is not the shape we wrote', () => {
    const store = fakeStore();
    store.setItem(STASH_KEY, 'not json');
    expect(readStash(store)).toBeNull();
    store.setItem(STASH_KEY, JSON.stringify({ state: 'st', authOrigin: 'https://x.example' }));
    expect(readStash(store)).toBeNull();
    store.setItem(STASH_KEY, JSON.stringify({ ...stash, codeVerifier: '' }));
    expect(readStash(store)).toBeNull();
  });
});

describe('the callback URL', () => {
  it('reads a code return', () => {
    expect(parseCallback('https://poker.faithnet.io/?code=abc&state=st-abc')).toEqual({ kind: 'code', code: 'abc', state: 'st-abc' });
  });

  it('reads an error return, and prefers it over anything else on the URL', () => {
    expect(parseCallback('https://poker.faithnet.io/?error=access_denied')).toEqual({ kind: 'error', error: 'access_denied', description: undefined });
    expect(parseCallback('https://poker.faithnet.io/?error=server_error&error_description=broker+down&code=abc&state=st')).toEqual({
      kind: 'error',
      error: 'server_error',
      description: 'broker down',
    });
  });

  it('is null for a normal load, a half-return and a non-URL', () => {
    expect(parseCallback('https://poker.faithnet.io/')).toBeNull();
    expect(parseCallback('https://poker.faithnet.io/#/t/abc')).toBeNull();
    expect(parseCallback('https://poker.faithnet.io/?code=abc')).toBeNull(); // no state: not a return we started
    expect(parseCallback('https://poker.faithnet.io/?state=st')).toBeNull();
    expect(parseCallback('nonsense')).toBeNull();
  });

  it('strips every ceremony parameter and keeps the rest of the URL intact', () => {
    expect(stripAuthParams('https://poker.faithnet.io/?code=abc&state=st#/t/xyz')).toBe('https://poker.faithnet.io/#/t/xyz');
    expect(stripAuthParams('https://poker.faithnet.io/?code=abc&state=st&iss=https%3A%2F%2Fwww.faithnet.me&keep=1')).toBe(
      'https://poker.faithnet.io/?keep=1',
    );
    expect(stripAuthParams('https://poker.faithnet.io/?error=access_denied&error_description=nope')).toBe('https://poker.faithnet.io/');
    expect(stripAuthParams('https://poker.faithnet.io/')).toBe('https://poker.faithnet.io/');
    expect(stripAuthParams('not a url')).toBe('not a url');
  });
});

describe('consuming a return', () => {
  const withStash = () => {
    const store = fakeStore();
    writeStash(store, stash);
    return store;
  };

  it('hands the Worker the code plus the verifier and nonce THIS browser generated', () => {
    expect(consumeCallback('https://poker.faithnet.io/?code=abc&state=st-abc', withStash())).toEqual({
      status: 'signed-in',
      code: 'abc',
      codeVerifier: 'verifier-xyz',
      authOrigin: 'https://www.faithnet.me',
      nonce: 'nonce-123',
      state: 'st-abc',
    });
  });

  it('does nothing on a normal load', () => {
    expect(consumeCallback('https://poker.faithnet.io/#/', withStash())).toEqual({ status: 'none' });
  });

  it('refuses a state that does not match the request this browser started', () => {
    const r = consumeCallback('https://poker.faithnet.io/?code=abc&state=someone-elses', withStash());
    expect(r.status).toBe('error');
    expect(r).toMatchObject({ message: expect.stringContaining('state mismatch') as unknown as string });
  });

  it('refuses a code with no stash at all (a pasted or replayed return URL)', () => {
    const r = consumeCallback('https://poker.faithnet.io/?code=abc&state=st-abc', fakeStore());
    expect(r.status).toBe('error');
    expect(r).toMatchObject({ message: expect.stringContaining('could not be matched') as unknown as string });
  });

  it('explains a cancellation at the Home in words a person can act on', () => {
    const r = consumeCallback('https://poker.faithnet.io/?error=access_denied', withStash());
    expect(r).toEqual({ status: 'error', message: 'Sign-in was cancelled at your Home.' });
    expect(describeCallbackError('server_error', 'broker down')).toContain('broker down');
    expect(describeCallbackError('temporarily_unavailable')).toContain('temporarily_unavailable');
  });
});

describe('the issuer allowlist (the browser copy of the Worker rule)', () => {
  it('accepts the zone apex and single-label subdomains over https', () => {
    expect(isAllowedHomeOrigin('faithnet.me', 'https://faithnet.me')).toBe(true);
    expect(isAllowedHomeOrigin('faithnet.me', 'https://www.faithnet.me')).toBe(true);
    expect(isAllowedHomeOrigin('faithnet.me', 'https://richard.faithnet.me')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isAllowedHomeOrigin('faithnet.me', 'http://www.faithnet.me')).toBe(false);
    expect(isAllowedHomeOrigin('faithnet.me', 'https://a.b.faithnet.me')).toBe(false);
    expect(isAllowedHomeOrigin('faithnet.me', 'https://faithnet.me.evil.example')).toBe(false);
    expect(isAllowedHomeOrigin('faithnet.me', 'https://www.faithnet.me/authorize')).toBe(false);
    expect(isAllowedHomeOrigin('faithnet.me', 'http://localhost:3000')).toBe(false);
    expect(isAllowedHomeOrigin('', 'https://www.faithnet.me')).toBe(false);
    expect(isAllowedHomeOrigin('faithnet.me', 'nonsense')).toBe(false);
  });

  it('trusts localhost only for a localhost deployment', () => {
    expect(isAllowedHomeOrigin('localhost', 'http://localhost:3000')).toBe(true);
    expect(isAllowedHomeOrigin('localhost', 'https://www.faithnet.me')).toBe(false);
  });
});


/**
 * The buy-in authorisation is the SAME ceremony as sign-in with one parameter changed, and that one
 * parameter is the whole of it: the Home decides what `poker-buyin` means and shows the player the
 * caps. What this half must get right is the template, the amount, and keeping its stash apart from
 * the sign-in stash — because both ceremonies come back to the same redirect URI.
 */
describe('startBuyInMandate', () => {
  const config: AuthConfig = {
    devAuth: false,
    home: {
      clientId: 'pokernight',
      origin: 'https://www.faithnet.me',
      zone: 'faithnet.me',
      delegate: `0x${'de'.repeat(20)}`,
      redirectUri: 'https://poker.faithnet.io/',
      buyInTemplate: BUY_IN_TEMPLATE,
    },
  };

  it('asks the Home for the buy-in template, for this client, at the registered redirect', async () => {
    const store = fakeStore();
    const url = new URL(await startBuyInMandate(config, '200000000', store));
    expect(url.origin).toBe('https://www.faithnet.me');
    expect(url.searchParams.get('delegation_template')).toBe('poker-buyin');
    expect(url.searchParams.get('client_id')).toBe('pokernight');
    expect(url.searchParams.get('redirect_uri')).toBe('https://poker.faithnet.io/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // The biggest single buy-in this table would take, in base units. The Home caps it further.
    expect(url.searchParams.get('pay_amount')).toBe('200000000');
  });

  it('keeps its stash separate from the sign-in stash, so a return leg cannot be mistaken', async () => {
    const store = fakeStore();
    const url = new URL(await startBuyInMandate(config, null, store));
    expect(store.map.has(MANDATE_STASH_KEY)).toBe(true);
    expect(store.map.has(STASH_KEY)).toBe(false);
    const stash = readStash(store, MANDATE_STASH_KEY);
    expect(stash?.state).toBe(url.searchParams.get('state'));
    expect(stash?.nonce).toBe(url.searchParams.get('nonce'));
  });

  it('omits an amount it cannot vouch for rather than sending nonsense', async () => {
    const url = new URL(await startBuyInMandate(config, 'lots', fakeStore()));
    expect(url.searchParams.has('pay_amount')).toBe(false);
  });

  it('refuses to send anyone to a Home this deployment does not trust', async () => {
    const rogue: AuthConfig = { ...config, home: { ...config.home, origin: 'https://evil.example' } };
    await expect(startBuyInMandate(rogue, null, fakeStore())).rejects.toThrow(/not a trusted Home/);
  });

  it('will not navigate when the browser refuses to keep the secret it would need on the way back', async () => {
    await expect(startBuyInMandate(config, null, fakeStore('set'))).rejects.toThrow(/session storage is blocked/);
  });
});
