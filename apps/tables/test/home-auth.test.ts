/**
 * The SERVER half of Home sign-in (src/home.ts + POST /auth/home).
 *
 * A real ceremony needs a person at their Home, so these tests stand up a FAKE Home instead: a real
 * ES256 P-256 keypair, a real JWKS document, real JWTs signed with it, served to the Worker over the
 * pool's outbound `fetchMock`. That exercises everything the Worker actually decides — token
 * exchange, JWKS lookup, alg pinning, signature, iss/aud/nonce/exp — without pretending we have
 * completed a live sign-in against www.faithnet.me. Only a human can confirm that half.
 *
 * The test env (`[vars]` in wrangler.toml) has HOME_ZONE = "localhost" and
 * HOME_ORIGIN = "http://localhost:3000", so the fake Home lives there and https://www.faithnet.me is
 * (correctly) NOT an allowed issuer here.
 */

import { SELF, env, fetchMock } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyHomeSession } from '../src/auth.js';
import type { Env } from '../src/env.js';
import { cleanProfileName, isAllowedHomeOrigin, shortAddress } from '../src/home.js';
import { TestClient, createTableViaHttp, engineReady } from './helpers.js';

const HOME = 'http://localhost:3000';
const KID = 'test-broker-01';
const PERSON = '0xAbC0000000000000000000000000000000000001';

let keys: CryptoKeyPair;
/** The public half as a JWKS entry. Kept as a plain record so it can be spread with `kid`/`alg`. */
let publicJwk: Record<string, unknown>;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const exported = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as unknown as Record<string, unknown>;
  delete exported.ext;
  delete exported.key_ops;
  publicJwk = exported;
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterAll(() => {
  fetchMock.enableNetConnect();
});

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlJson = (o: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** A genuinely ES256-signed id_token, so signature verification is exercised, not stubbed out. */
async function signIdToken(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64urlJson({ alg: 'ES256', typ: 'JWT', kid: KID, ...header });
  const p = b64urlJson(claims);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(`${h}.${p}`)),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

function claimsFor(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: HOME,
    sub: `eip155:31337:${PERSON}`,
    canonical_agent_id: `eip155:31337:${PERSON}`,
    aud: 'pokernight',
    iat: nowSec(),
    exp: nowSec() + 300,
    nonce: 'test-nonce',
    agent_name: 'richard.me',
    ...over,
  };
}

/** Stub the fake Home's `/token` and `/jwks` for exactly one exchange. */
function mockHome(idToken: string, delegation: unknown = { delegator: PERSON, salt: '1' }): void {
  const pool = fetchMock.get(HOME);
  pool.intercept({ path: '/token', method: 'POST' }).reply(200, { id_token: idToken, delegation });
  pool.intercept({ path: '/jwks', method: 'GET' }).reply(200, { keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] });
}

async function postHome(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await SELF.fetch('http://tables.test/auth/home', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const goodRequest = (over: Record<string, unknown> = {}) => ({
  code: 'auth-code-1',
  codeVerifier: 'verifier-1',
  authOrigin: HOME,
  nonce: 'test-nonce',
  state: 'state-1',
  ...over,
});

describe('GET /auth/config', () => {
  it('tells the client which sign-in paths this deployment offers', async () => {
    const res = await SELF.fetch('http://tables.test/auth/config');
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as { devAuth: boolean; home: Record<string, unknown> };
    expect(cfg.devAuth).toBe(true); // [vars] DEV_AUTH = "true"
    expect(cfg.home.clientId).toBe('pokernight');
    expect(cfg.home.origin).toBe(HOME);
    expect(cfg.home.zone).toBe('localhost');
    expect(cfg.home.redirectUri).toBe('http://localhost:5173/');
    expect(typeof cfg.home.delegate).toBe('string');
  });
});

describe('issuer allowlist', () => {
  const at = (zone: string): Env => ({ ...env, HOME_ZONE: zone });

  it('accepts the zone apex and single-label subdomains, over https only', () => {
    const e = at('faithnet.me');
    expect(isAllowedHomeOrigin(e, 'https://faithnet.me')).toBe(true);
    expect(isAllowedHomeOrigin(e, 'https://www.faithnet.me')).toBe(true);
    expect(isAllowedHomeOrigin(e, 'https://richard.faithnet.me')).toBe(true);
    expect(isAllowedHomeOrigin(e, 'http://www.faithnet.me')).toBe(false);
    expect(isAllowedHomeOrigin(e, 'https://a.b.faithnet.me')).toBe(false);
    expect(isAllowedHomeOrigin(e, 'https://faithnet.me.evil.example')).toBe(false);
    expect(isAllowedHomeOrigin(e, 'https://evil.example')).toBe(false);
    expect(isAllowedHomeOrigin(e, 'https://www.faithnet.me/path')).toBe(false);
    expect(isAllowedHomeOrigin(e, 'not a url')).toBe(false);
    // A production deployment must never be talked into verifying against a developer's machine.
    expect(isAllowedHomeOrigin(e, 'http://localhost:3000')).toBe(false);
  });

  it('trusts localhost only when the deployment zone IS localhost', () => {
    expect(isAllowedHomeOrigin(at('localhost'), 'http://localhost:3000')).toBe(true);
    expect(isAllowedHomeOrigin(at('localhost'), 'https://www.faithnet.me')).toBe(false);
  });
});

describe('POST /auth/home', () => {
  it('rejects a malformed or absent body', async () => {
    expect((await postHome({})).status).toBe(400);
    expect((await postHome(goodRequest({ code: '' }))).status).toBe(400);
    const noBody = await SELF.fetch('http://tables.test/auth/home', { method: 'POST' });
    expect(noBody.status).toBe(400);
  });

  it('refuses an issuer origin that is not on the allowlist, before talking to it', async () => {
    const r = await postHome(goodRequest({ authOrigin: 'https://evil.example' }));
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/not a trusted issuer/);
  });

  it('refuses a code the Home will not exchange', async () => {
    fetchMock.get(HOME).intercept({ path: '/token', method: 'POST' }).reply(400, { error: 'invalid_grant' });
    const r = await postHome(goodRequest({ code: 'used-or-forged' }));
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/code exchange failed/);
  });

  it('refuses an id_token minted for another client (aud)', async () => {
    mockHome(await signIdToken(claimsFor({ aud: 'someone-else' })));
    const r = await postHome(goodRequest());
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/aud/);
  });

  it('refuses an id_token whose nonce is not the one this browser asked for', async () => {
    mockHome(await signIdToken(claimsFor({ nonce: 'someone-elses-nonce' })));
    const r = await postHome(goodRequest());
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/nonce/);
  });

  it('refuses an id_token whose iss is not the origin we exchanged at', async () => {
    mockHome(await signIdToken(claimsFor({ iss: 'http://127.0.0.1:3000' })));
    const r = await postHome(goodRequest());
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/iss/);
  });

  it('refuses an expired id_token', async () => {
    mockHome(await signIdToken(claimsFor({ iat: nowSec() - 600, exp: nowSec() - 60 })));
    const r = await postHome(goodRequest());
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/expired/);
  });

  it('refuses a forged signature', async () => {
    const good = await signIdToken(claimsFor());
    const [h, p, s] = good.split('.') as [string, string, string];
    mockHome(`${h}.${p}.${s.slice(0, -3)}AAA`);
    const r = await postHome(goodRequest());
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/id_token/);
  });

  it('refuses an algorithm other than ES256', async () => {
    mockHome(await signIdToken(claimsFor(), { alg: 'HS256' }));
    const r = await postHome(goodRequest());
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/ES256/);
  });

  it('mints a session from a valid id_token and keeps the delegation server-side', async () => {
    const delegation = { delegator: PERSON, delegate: '0x89d13c596c45e4ee80af5ae06c727fe9a820ffd0', salt: '42' };
    mockHome(await signIdToken(claimsFor()), delegation);
    const r = await postHome(goodRequest());
    expect(r.status).toBe(200);
    expect(r.body.playerId).toBe(`home:${PERSON.toLowerCase()}`);
    expect(r.body.name).toBe('richard.me');
    expect(r.body.agentName).toBe('richard.me');
    expect(r.body.address).toBe(PERSON.toLowerCase());
    // The bearer token carries claims only — never the delegation.
    const token = String(r.body.token);
    expect(token.split('.')).toHaveLength(2);
    expect(token).not.toContain('delegator');

    // …but the server can reach the address and the delegation from the token.
    const session = await verifyHomeSession(env, token);
    expect(session?.playerId).toBe(`home:${PERSON.toLowerCase()}`);
    expect(session?.address).toBe(PERSON.toLowerCase());
    expect(session?.agentName).toBe('richard.me');
    expect(session?.homeOrigin).toBe(HOME);
    expect(session?.delegation).toEqual(delegation);

    // The session works on an authenticated route…
    const seat = await SELF.fetch('http://tables.test/tables/nope/seat-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(seat.status).toBe(400); // authenticated, then rejected on the body — not 401

    // …until it is signed out, at which point the server-side record is gone and the token is dead.
    const out = await SELF.fetch('http://tables.test/auth/signout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(out.status).toBe(200);
    expect(await verifyHomeSession(env, token)).toBeNull();
    const after = await SELF.fetch('http://tables.test/tables/nope/seat-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(after.status).toBe(401);
  });

  /**
   * The server half of single sign-out, which `/sso-logout` in the web app drives.
   *
   * When a person signs out at their Home, the Home navigates them through this card room's
   * `/sso-logout`, which posts exactly this request. So it has to do BOTH halves in one go: give up
   * the seat (a Home-initiated sign-out is a deliberate act, not a dropped connection, so the chips
   * come off the table rather than the seat merely being sat out) and kill the session record so the
   * bearer token stops resolving. Doing only one of them is the bug — a signed-out person with money
   * still committed to a seat, or a dead-looking session whose token still works.
   */
  it.skipIf(!engineReady)('signing out gives up the seat AND kills the token, in one call', async () => {
    mockHome(await signIdToken(claimsFor({ nonce: 'sso-nonce' })));
    const r = await postHome(goodRequest({ nonce: 'sso-nonce' }));
    expect(r.status).toBe(200);
    const token = String(r.body.token);
    const playerId = String(r.body.playerId);

    // In the DEFAULT lobby, which is the set of tables a sign-out sweeps (see the route's comment:
    // a table in another circle is not reachable from here, and the operator route is its backstop).
    const table = await createTableViaHttp('single sign-out');
    const client = await TestClient.connect(table.tableId, token);
    client.send({ type: 'join', seat: 0, buyIn: 100 });
    await client.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');

    const out = await SELF.fetch('http://tables.test/auth/signout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(out.status).toBe(200);
    const body = (await out.json()) as { stoodUp: Array<{ tableId: string; seat: number; chips: number }> };
    expect(body.stoodUp).toEqual([expect.objectContaining({ tableId: table.tableId, seat: 0, chips: 100 })]);

    // The seat is empty…
    const view = (await (await SELF.fetch(`http://tables.test/tables/${table.tableId}`)).json()) as { view: { seats: unknown[] } };
    expect(view.view.seats).toEqual([]);
    // …and the session is genuinely revoked, not just forgotten by the browser.
    expect(await verifyHomeSession(env, token)).toBeNull();
    void playerId;
    client.close();
  }, 30_000);

  it('falls back to a truncated address when the Home issued no agent_name', async () => {
    mockHome(await signIdToken(claimsFor({ agent_name: undefined })));
    const r = await postHome(goodRequest());
    expect(r.status).toBe(200);
    expect(r.body.name).toBe(shortAddress(PERSON.toLowerCase()));
    expect(r.body.agentName).toBeUndefined();
  });

  /**
   * The profile name: a DISPLAY name the person typed on the sign-in page, so a nameless account is
   * not shown to the table as `0x4514…4c90`. It is not identity and it is not a Faithnet handle — an
   * asserted `agent_name` still wins, and nothing here claims a name in the naming service.
   */
  it('calls a nameless person what they asked to be called', async () => {
    mockHome(await signIdToken(claimsFor({ agent_name: undefined })));
    const r = await postHome(goodRequest({ profileName: '  Rich  Pedersen ' }));
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Rich Pedersen');
    // Still nameless in the naming service: no handle was claimed for it.
    expect(r.body.agentName).toBeUndefined();
    // And the session itself carries the name, so the table and the log say it too.
    const session = await verifyHomeSession(env, String(r.body.token));
    expect(session?.name).toBe('Rich Pedersen');
  });

  it('lets a name the Home actually asserted win over the typed one', async () => {
    mockHome(await signIdToken(claimsFor()));
    const r = await postHome(goodRequest({ profileName: 'Somebody Else' }));
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('richard.me');
  });

  it('refuses a display name that would let a seat pass itself off as an address', async () => {
    mockHome(await signIdToken(claimsFor({ agent_name: undefined })));
    const r = await postHome(goodRequest({ profileName: '0x2a5ae595cc5009c8517780e78a20a34e653c2747' }));
    expect(r.status).toBe(200);
    expect(r.body.name).toBe(shortAddress(PERSON.toLowerCase()));
  });

  it('keeps a display name to one short line, whatever arrives', async () => {
    expect(cleanProfileName('  Rich\n\nPedersen  ')).toBe('Rich Pedersen');
    expect(cleanProfileName('a'.repeat(80))).toHaveLength(24);
    expect(cleanProfileName('\u200b\u2028')).toBe('');
    expect(cleanProfileName(undefined)).toBe('');
    // A name is optional, and a blank one is treated as none at all.
    mockHome(await signIdToken(claimsFor({ agent_name: undefined })));
    const r = await postHome(goodRequest({ profileName: '   ' }));
    expect(r.body.name).toBe(shortAddress(PERSON.toLowerCase()));
  });
});

describe('verifyHomeSession', () => {
  it('ignores tokens that are not Home sessions', async () => {
    const dev = await SELF.fetch('http://tables.test/dev/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dev Dan' }),
    });
    const { token } = (await dev.json()) as { token: string };
    expect(await verifyHomeSession(env, token)).toBeNull();
    expect(await verifyHomeSession(env, 'garbage')).toBeNull();
  });
});

/**
 * `POST /auth/home/demo` — the Home's quick-connect identities (spec 295).
 *
 * The Home runs the ceremony itself and hands the browser a finished result, so there is no code to
 * exchange and no nonce we chose. Everything that DECIDES IDENTITY still runs here, against the same
 * fake Home: JWKS lookup, ES256 pinning, signature, iss/aud/exp, `iat` age. These tests are the proof
 * that the shortcut is only a shortcut past the exchange, never past the verification.
 */
describe('POST /auth/home/demo', () => {
  /** Only `/jwks` — a quick-connect result never touches `/token`. */
  function mockJwks(): void {
    fetchMock
      .get(HOME)
      .intercept({ path: '/jwks', method: 'GET' })
      .reply(200, { keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] });
  }

  async function postDemo(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await SELF.fetch('http://tables.test/auth/home/demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  /** What `connectAsQuickConnect` returns: no nonce claim, because nobody asked for one. */
  const demoClaims = (over: Record<string, unknown> = {}) => claimsFor({ nonce: undefined, agent_name: 'alice.me', ...over });

  it('rejects a malformed or absent body', async () => {
    expect((await postDemo({})).status).toBe(400);
    expect((await postDemo({ idToken: '', authOrigin: HOME })).status).toBe(400);
    const noBody = await SELF.fetch('http://tables.test/auth/home/demo', { method: 'POST' });
    expect(noBody.status).toBe(400);
  });

  it('refuses an issuer origin that is not on the allowlist, before fetching its keys', async () => {
    const r = await postDemo({ idToken: await signIdToken(demoClaims()), authOrigin: 'https://evil.example' });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/not a trusted issuer/);
  });

  it('refuses an id_token minted for another client (aud)', async () => {
    mockJwks();
    const r = await postDemo({ idToken: await signIdToken(demoClaims({ aud: 'someone-else' })), authOrigin: HOME });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/aud/);
  });

  it('refuses a forged signature', async () => {
    mockJwks();
    const [h, p, s] = (await signIdToken(demoClaims())).split('.') as [string, string, string];
    const r = await postDemo({ idToken: `${h}.${p}.${s.slice(0, -3)}AAA`, authOrigin: HOME });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/signature/);
  });

  it('refuses an algorithm other than ES256', async () => {
    mockJwks();
    const r = await postDemo({ idToken: await signIdToken(demoClaims(), { alg: 'HS256' }), authOrigin: HOME });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/ES256/);
  });

  it('refuses an id_token whose iss is not the origin we were told to trust', async () => {
    mockJwks();
    const r = await postDemo({ idToken: await signIdToken(demoClaims({ iss: 'http://127.0.0.1:3000' })), authOrigin: HOME });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/iss/);
  });

  it('refuses an expired id_token, and a stale one that has not expired yet', async () => {
    mockJwks();
    const expired = await postDemo({ idToken: await signIdToken(demoClaims({ iat: nowSec() - 600, exp: nowSec() - 60 })), authOrigin: HOME });
    expect(expired.status).toBe(401);
    expect(String(expired.body.error)).toMatch(/expired/);

    mockJwks();
    const stale = await postDemo({ idToken: await signIdToken(demoClaims({ iat: nowSec() - 3600, exp: nowSec() + 3600 })), authOrigin: HOME });
    expect(stale.status).toBe(401);
    expect(String(stale.body.error)).toMatch(/iat is too old/);
  });

  it('mints the same kind of session an OIDC sign-in does, delegation kept server-side', async () => {
    const delegation = { delegator: PERSON, delegate: '0x89d13c596c45e4ee80af5ae06c727fe9a820ffd0', salt: '295' };
    mockJwks();
    const r = await postDemo({ idToken: await signIdToken(demoClaims()), delegation, authOrigin: HOME });
    expect(r.status).toBe(200);
    expect(r.body.playerId).toBe(`home:${PERSON.toLowerCase()}`);
    expect(r.body.name).toBe('alice.me');
    expect(r.body.address).toBe(PERSON.toLowerCase());
    const token = String(r.body.token);
    expect(token).not.toContain('delegator');

    const session = await verifyHomeSession(env, token);
    expect(session?.address).toBe(PERSON.toLowerCase());
    expect(session?.agentName).toBe('alice.me');
    expect(session?.delegation).toEqual(delegation);

    // Signing out kills it exactly as it kills a redirect session.
    const out = await SELF.fetch('http://tables.test/auth/signout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(out.status).toBe(200);
    expect(await verifyHomeSession(env, token)).toBeNull();
  });
});
