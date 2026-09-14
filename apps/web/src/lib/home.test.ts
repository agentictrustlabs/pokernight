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
  PROFILE_NAME_KEY,
  finishProfileName,
  startBuyInMandate,
  startClubCharter,
  startHomeSignIn,
  takeCharterClub,
  rememberHomeSession,
  forgetHomeSession,
  readHomeSession,
  CHARTER_CLUB_KEY,
  CHARTER_STASH_KEY,
  HOME_SESSION_KEY,
  stripAuthParams,
  takeProfileName,
  toProfileName,
  writeStash,
  type AuthConfig,
  type StorageLike, readTreasuryReturn,
  askToChooseNextTime,
  CHOOSE_NEXT_KEY,
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

  it('reads and then strips the treasury ceremony return', () => {
    const href = 'https://poker.example/?treasury=0xabc&treasury_status=created&state=s1';
    expect(readTreasuryReturn(href)).toEqual({ treasury: '0xabc', status: 'created' });
    // Stripped so a raw account address never sits in the address bar and a refresh cannot replay it.
    expect(stripAuthParams(href)).toBe('https://poker.example/');
    expect(readTreasuryReturn('https://poker.example/?treasury_error=denied&state=s1')).toEqual({ error: 'denied' });
    expect(readTreasuryReturn('https://poker.example/')).toBeNull();
  });
});

/**
 * The name a person types on the way in.
 *
 * It is a PROFILE name and not a Faithnet handle, and that distinction is the whole of this: putting
 * it on the authorize request as `agent_name` makes the Home claim `<label>.me` and hop the ceremony
 * to that subdomain, which is exactly what these accounts must not do. So the authorize request stays
 * name-deferred and the name is carried across the redirect on this origin instead.
 */
describe('the name on the way in', () => {
  const config: AuthConfig = {
    devAuth: false,
    home: {
      clientId: 'pokernight',
      origin: 'https://www.faithnet.me',
      zone: 'faithnet.me',
      delegate: `0x${'de'.repeat(20)}`,
      redirectUri: 'https://poker.faithnet.io/',
    },
  };

  it('keeps a typed name as typed, only making it safe to show to other players', () => {
    expect(finishProfileName('Rich Pedersen')).toBe('Rich Pedersen');
    expect(finishProfileName('  Rowan  ')).toBe('Rowan');
    expect(finishProfileName('a\u200bb\nc')).toBe('ab c');
    expect(finishProfileName('x'.repeat(60))).toHaveLength(24);
    expect(finishProfileName('')).toBe('');
    // A trailing space is a name being typed THROUGH, so the FIELD keeps it — trim on every keystroke
    // and "Rich Pedersen" could never be typed at all.
    expect(toProfileName('Rich ')).toBe('Rich ');
    expect(toProfileName('  Rich')).toBe('Rich');
  });

  it('does NOT ask the Home to claim a handle — the enrolment stays name-deferred', async () => {
    const store = fakeStore();
    const url = new URL(await startHomeSignIn(config, 'Rich Pedersen', store));
    expect(url.searchParams.get('agent_name')).toBe('');
    expect(url.origin).toBe('https://www.faithnet.me');
    // It waits here instead, on this origin, for the return leg to hand to the card room.
    expect(store.map.get(PROFILE_NAME_KEY)).toBe('Rich Pedersen');
  });

  it('hands the name over once, then forgets it, so a later sign-in cannot inherit it', async () => {
    const store = fakeStore();
    await startHomeSignIn(config, 'Rowan', store);
    expect(takeProfileName(store)).toBe('Rowan');
    expect(takeProfileName(store)).toBe('');
  });

  it('signs a nameless person in exactly as before, and remembers nothing', async () => {
    const store = fakeStore();
    const url = new URL(await startHomeSignIn(config, '', store));
    expect(url.searchParams.get('agent_name')).toBe('');
    expect(store.map.has(PROFILE_NAME_KEY)).toBe(false);
    expect(takeProfileName(store)).toBe('');
    // And with no argument at all, which is what a caller with no name to pass does.
    expect(new URL(await startHomeSignIn(config, undefined, fakeStore())).searchParams.get('agent_name')).toBe('');
  });

  it('a browser that will not keep the name still signs the person in', async () => {
    const blocked = fakeStore();
    blocked.setItem = () => {
      throw new Error('blocked');
    };
    // writeStash is what actually fails first on such a store, and that IS fatal — the PKCE verifier
    // is a secret the ceremony turns on. What must not happen is a display name causing a new failure.
    await expect(startHomeSignIn(config, 'Rowan', blocked)).rejects.toThrow(/will not let the site keep/);
    expect(takeProfileName(blocked)).toBe('');
  });

  it('refuses to send anyone to a Home this deployment does not trust, named or not', async () => {
    const rogue: AuthConfig = { ...config, home: { ...config.home, origin: 'https://evil.example' } };
    await expect(startHomeSignIn(rogue, 'Rowan', fakeStore())).rejects.toThrow(/not a trusted Home/);
  });
});

/**
 * ONE TRIP TO THE HOME, not two.
 *
 * Sign-in used to ask for `site-login`, which is why the session came back with no payment authority
 * and the player was immediately sent back to their Home to authorise buy-ins. `pokernight` is
 * registered for `poker-buyin` too, and the Home's payment ceremony mints the mandate DURING the
 * enrol — so the first connect can bring both halves back, and does.
 *
 * The condition is disclosure, not capability: the payment template is requested only where the
 * deployment states the caps the sign-in screen shows. A deployment that states none asks for a
 * plain session, exactly as before.
 */
describe('signing in asks for the buy-in template, once', () => {
  const caps = {
    template: BUY_IN_TEMPLATE,
    maxPerBuyIn: '200000000',
    sessionTotal: '1000000000',
    maxBuyIns: 5,
    maxBuyInChips: 200,
    validSeconds: 43200,
    symbol: 'SHQ',
  };
  const config: AuthConfig = {
    devAuth: false,
    home: {
      clientId: 'pokernight',
      origin: 'https://www.faithnet.me',
      zone: 'faithnet.me',
      delegate: `0x${'de'.repeat(20)}`,
      redirectUri: 'https://poker.faithnet.io/',
      buyInTemplate: BUY_IN_TEMPLATE,
      buyIn: caps,
    },
  };

  it('asks for poker-buyin on the FIRST connect, with the ceiling it showed the player', async () => {
    const store = fakeStore();
    const url = new URL(await startHomeSignIn(config, 'Rowan', store));
    expect(url.searchParams.get('delegation_template')).toBe('poker-buyin');
    expect(url.searchParams.get('pay_amount')).toBe('200000000');
    expect(url.searchParams.get('client_id')).toBe('pokernight');
    expect(url.searchParams.get('redirect_uri')).toBe('https://poker.faithnet.io/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Still name-deferred: asking for money must not start claiming handles as a side effect.
    expect(url.searchParams.get('agent_name')).toBe('');
    expect(store.map.get(PROFILE_NAME_KEY)).toBe('Rowan');
  });

  it('uses the SIGN-IN stash, so the return leg still mints a session', async () => {
    const store = fakeStore();
    const url = new URL(await startHomeSignIn(config, '', store));
    expect(store.map.has(STASH_KEY)).toBe(true);
    expect(store.map.has(MANDATE_STASH_KEY)).toBe(false);
    const stash = readStash(store, STASH_KEY);
    expect(stash?.state).toBe(url.searchParams.get('state'));
    expect(stash?.nonce).toBe(url.searchParams.get('nonce'));
    expect(consumeCallback(`https://poker.faithnet.io/?code=abc&state=${stash?.state}`, store).status).toBe('signed-in');
  });

  it('asks for a plain sign-in where the deployment states no ceiling — nothing about money is implied', async () => {
    const bare: AuthConfig = { ...config, home: { ...config.home, buyIn: null } };
    const url = new URL(await startHomeSignIn(bare, '', fakeStore()));
    expect(url.searchParams.get('delegation_template')).toBe('site-login');
    expect(url.searchParams.has('pay_amount')).toBe(false);
  });

  it('still refuses an untrusted Home, and a browser that will not keep the secret', async () => {
    const rogue: AuthConfig = { ...config, home: { ...config.home, origin: 'https://evil.example' } };
    await expect(startHomeSignIn(rogue, '', fakeStore())).rejects.toThrow(/not a trusted Home/);
    await expect(startHomeSignIn(config, '', fakeStore('set'))).rejects.toThrow(/session storage is blocked/);
  });
});


/**
 * Chartering a club — the third ceremony that lands on this one redirect URI.
 *
 * What this half must get right is the same three things the buy-in authorisation must: the
 * template, the extra parameter the Home needs, and a stash of its own — because a `state` that
 * collided with the sign-in stash would let one ceremony consume the other's return leg.
 */
describe('startClubCharter', () => {
  const config: AuthConfig = {
    devAuth: false,
    home: {
      clientId: 'pokernight',
      origin: 'https://www.faithnet.me',
      zone: 'faithnet.me',
      delegate: `0x${'de'.repeat(20)}`,
      redirectUri: 'https://poker.faithnet.io/',
      clubTemplate: 'workspace-create',
      clubPurpose: 'poker-club',
    },
  };
  const club = { clubId: 'c1ub-0000-0000-0000-000000000001', name: 'Thursday Night' };

  it('asks the Home for the workspace template, under the club’s own name', async () => {
    const store = fakeStore();
    const url = new URL(await startClubCharter(config, club, store));
    expect(url.origin).toBe('https://www.faithnet.me');
    expect(url.searchParams.get('delegation_template')).toBe('workspace-create');
    expect(url.searchParams.get('client_id')).toBe('pokernight');
    expect(url.searchParams.get('redirect_uri')).toBe('https://poker.faithnet.io/');
    // The name the workspace is deployed under, and WHY it exists — which is what the host will see
    // beside that agent in their own list, forever.
    // THE LABEL, slugged the way the Home slugs an org's name: the club's own name is founded from the stash.
    expect(url.searchParams.get('org_base')).toBe('thursday-night');
    expect(url.searchParams.get('purpose')).toBe('poker-club');
  });

  it('keeps its own stash, so it cannot consume the sign-in ceremony’s return leg', async () => {
    const store = fakeStore();
    await startHomeSignIn(config, '', store);
    await startClubCharter(config, club, store);
    const signIn = readStash(store);
    const charter = readStash(store, CHARTER_STASH_KEY);
    expect(signIn).not.toBeNull();
    expect(charter).not.toBeNull();
    expect(charter!.state).not.toBe(signIn!.state);
  });

  it('remembers the NAME the club is to be founded under, because the Home carries no state of ours', async () => {
    const store = fakeStore();
    await startClubCharter(config, club, store);
    expect(JSON.parse(store.map.get(CHARTER_CLUB_KEY) ?? 'null')).toEqual({ name: club.name });
    // Consumed once: a second charter must never be founded under the first one's name.
    expect(takeCharterClub(store)).toEqual({ name: club.name });
    expect(takeCharterClub(store)).toBeNull();
  });

  it('refuses to send anyone to a Home this site does not trust', async () => {
    const store = fakeStore();
    const evil = { ...config, home: { ...config.home, origin: 'https://evil.example' } };
    await expect(startClubCharter(evil, club, store)).rejects.toThrow(/not a trusted Home/);
  });

  it('says so plainly when the browser will not keep the secret', async () => {
    await expect(startClubCharter(config, club, fakeStore('set'))).rejects.toThrow(/session storage is blocked/);
  });
});


/**
 * The Home-session handoff.
 *
 * A ceremony is a full-page trip to the Home, and a demo persona has no credential to sign in with —
 * the Home holds their key. The Home hands the app that person's own session for exactly this, and
 * the app hands it straight back on the ceremony URL.
 */
describe('handing a ceremony the person’s own Home session', () => {
  const config: AuthConfig = {
    devAuth: false,
    home: {
      clientId: 'pokernight',
      origin: 'https://www.faithnet.me',
      zone: 'faithnet.me',
      delegate: `0x${'de'.repeat(20)}`,
      redirectUri: 'https://poker.faithnet.io/',
      clubTemplate: 'workspace-create',
    },
  };
  const club = { clubId: 'c1ub-0000-0000-0000-000000000001', name: 'Thursday Night' };

  it('sends them in already signed in when the Home gave us their session', async () => {
    const store = fakeStore();
    rememberHomeSession('home-session-token', store);
    const url = new URL(await startClubCharter(config, club, store));
    expect(url.hash).toBe('#session=home-session-token');
    // …and does NOT also ask them to pick an account, which would be asking a question we answered.
    expect(url.searchParams.get('prompt')).toBeNull();
  });

  it('says nothing about who when we have no session for them — the Home runs it on its own session', async () => {
    // A forced chooser asked a signed-in person "who are you?" twice, and a pinned name sent workspace-create
    // down the Home's named-org flow, which deploys a workspace without its vault (2026-09-14).
    const url = new URL(await startClubCharter(config, club, fakeStore()));
    expect(url.hash).toBe('');
    expect(url.searchParams.get('prompt')).toBeNull();
    expect(url.searchParams.get('agent_name')).toBe('');
  });

  it('keeps it out of the session object, and forgets it on demand', () => {
    const store = fakeStore();
    rememberHomeSession('t', store);
    // Its own key, because the session object is written to localStorage and this is a Home bearer.
    expect(store.map.get(HOME_SESSION_KEY)).toBe('t');
    expect(readHomeSession(store)).toBe('t');
    forgetHomeSession(store);
    expect(readHomeSession(store)).toBeNull();
  });

  it('does nothing at all when the Home handed over no session', () => {
    const store = fakeStore();
    rememberHomeSession(undefined, store);
    expect(readHomeSession(store)).toBeNull();
  });

  it('survives a browser that refuses storage, rather than failing the ceremony', async () => {
    // Blocked storage means no handoff, not a broken button: they sign in at their Home instead.
    expect(() => rememberHomeSession('t', fakeStore('set'))).not.toThrow();
    expect(readHomeSession(fakeStore('get'))).toBeNull();
  });
});

describe('signing out means choosing next time', () => {
  const config = {
    devAuth: false,
    home: { clientId: 'pokernight', origin: 'https://www.faithnet.me', zone: 'faithnet.me', delegate: '0x0000000000000000000000000000000000000001', redirectUri: 'https://poker.faithnet.io/', buyIn: { template: 'poker-buyin', maxPerBuyIn: '1', maxTotal: '2', maxBuyIns: 1, windowSeconds: 1, assetSymbol: 'SHQ', assetDecimals: 6 } },
  } as unknown as AuthConfig;

  it('asks the Home for the account chooser on every sign-in — never the person the Home\'s cookie last was', async () => {
    const store = fakeStore();
    expect(new URL(await startHomeSignIn(config, '', store)).searchParams.get('prompt')).toBe('select_account');
    askToChooseNextTime(store);
    expect(new URL(await startHomeSignIn(config, '', store)).searchParams.get('prompt')).toBe('select_account');
    expect(store.map.get(CHOOSE_NEXT_KEY)).toBeUndefined();
  });
});
