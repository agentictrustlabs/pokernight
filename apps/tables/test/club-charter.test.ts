/**
 * Chartering a club — the `workspace-create` ceremony, finished on the server.
 *
 * A club is a `<label>.workspace` Smart Agent the HOST custodies (`docs/WORKSPACES.md` §2). The card
 * room never deploys it and never holds its key: the host runs the ceremony at their own Home, and
 * all the card room does is check that the person handing it over is a host of THIS club, and write
 * the address down.
 *
 * ITS OWN FILE, and that is not tidiness. The fake Home here is an outbound `fetchMock`, and an
 * interceptor answers whoever asks next — so a file where earlier cases register `/token` replies
 * they never reach (an issuer refused before the exchange, say) hands those leftovers to the next
 * ceremony that runs. Sharing a file with `home-auth.test.ts` made these tests pass or fail on the
 * order of the cases above them, which is not a property worth having.
 */

import { SELF, fetchMock } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClubViaHttp, devSession } from './helpers.js';

const HOME = 'http://localhost:3000';
const KID = 'test-broker-charter';
const PERSON = '0xAbC0000000000000000000000000000000000009';
const WORKSPACE = '0xC1B0000000000000000000000000000000000001';

let keys: CryptoKeyPair;
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

/** A genuinely ES256-signed id_token, so the Worker's verification is exercised, not stubbed out. */
async function signIdToken(claims: Record<string, unknown>): Promise<string> {
  const h = b64urlJson({ alg: 'ES256', typ: 'JWT', kid: KID });
  const p = b64urlJson(claims);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(`${h}.${p}`)),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: HOME,
  sub: `eip155:31337:${PERSON}`,
  canonical_agent_id: `eip155:31337:${PERSON}`,
  aud: 'pokernight',
  iat: nowSec(),
  exp: nowSec() + 300,
  nonce: 'charter-nonce',
  agent_name: 'barb.me',
  ...over,
});

/** Stub the Home for one exchange, matched by the authorization code in the request body. */
async function mockExchange(code: string, org?: unknown): Promise<void> {
  const pool = fetchMock.get(HOME);
  pool.intercept({ path: '/token', method: 'POST' }).reply(200, {
    id_token: await signIdToken(claims()),
    delegation: { delegator: PERSON, salt: '1' },
    ...(org ? { org } : {}),
  });
  pool.intercept({ path: '/jwks', method: 'GET' }).reply(200, { keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] });
}

const request = (code: string) => ({ code, codeVerifier: 'verifier', authOrigin: HOME, nonce: 'charter-nonce', state: 'state' });

/** Sign in through the fake Home, so the session is a `home:` one the charter check can match. */
async function homeSession(code: string): Promise<string> {
  await mockExchange(code);
  const res = await SELF.fetch('http://tables.test/auth/home', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request(code)),
  });
  expect(res.status).toBe(200);
  return String(((await res.json()) as { token: string }).token);
}

async function charter(clubId: string, token: string, code: string): Promise<Response> {
  return SELF.fetch(`http://tables.test/clubs/${clubId}/charter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(request(code)),
  });
}

const org = {
  orgAgent: WORKSPACE,
  orgName: 'thursday-night.workspace',
  person: PERSON,
  purpose: 'poker-club',
  delegation: { delegator: WORKSPACE, delegate: PERSON, salt: '3' },
};

describe('POST /clubs/:clubId/charter', () => {
  it('records the agent the ceremony deployed, and reports the club as chartered', async () => {
    const token = await homeSession('signin-1');
    const club = await createClubViaHttp(token, 'Thursday Night');
    // Before the ceremony there is no agent, and the club does not pretend there is one.
    expect(club.agent).toBeUndefined();

    await mockExchange('charter-1', org);
    const res = await charter(club.clubId, token, 'charter-1');
    const body = (await res.json()) as { agent?: string; error?: string };
    expect(body.error ?? res.status).toBe(200);
    // Lowercased, because an address is an address whatever case a Home wrote it in.
    expect(body.agent).toBe(WORKSPACE.toLowerCase());

    const view = await SELF.fetch(`http://tables.test/clubs/${club.clubId}`, { headers: { authorization: `Bearer ${token}` } });
    expect(((await view.json()) as { agent?: string }).agent).toBe(WORKSPACE.toLowerCase());
  });

  it('is chartered ONCE — the same agent again is fine, a different one is refused', async () => {
    const token = await homeSession('signin-2');
    const club = await createClubViaHttp(token, 'Chartered once');

    await mockExchange('charter-2a', org);
    expect((await charter(club.clubId, token, 'charter-2a')).status).toBe(200);

    // Running it again with the same result changes nothing and says so quietly.
    await mockExchange('charter-2b', org);
    expect((await charter(club.clubId, token, 'charter-2b')).status).toBe(200);

    // A DIFFERENT agent is refused: the vault, the roster and the club's own messages all hang off
    // this address, and repointing it would orphan every one of them while the club id stayed put.
    await mockExchange('charter-2c', { ...org, orgAgent: '0xC1B0000000000000000000000000000000000002' });
    const res = await charter(club.clubId, token, 'charter-2c');
    expect(res.status).toBe(409);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/chartered once/);
  });

  it('refuses a ceremony that deployed nothing, rather than calling the club chartered', async () => {
    const token = await homeSession('signin-3');
    const club = await createClubViaHttp(token, 'Nothing deployed');
    // An id_token means somebody signed in. It does not mean an agent was deployed, and recording a
    // club as chartered when nothing was chartered is the worst of the three possible outcomes.
    await mockExchange('charter-3');
    const res = await charter(club.clubId, token, 'charter-3');
    expect(res.status).toBe(401);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/deployed no club agent/);
  });

  it('is not reachable by a member, or by anyone outside the club', async () => {
    const token = await homeSession('signin-4');
    const club = await createClubViaHttp(token, 'Hosts only');
    const member = await devSession('a member');
    await SELF.fetch(`http://tables.test/clubs/${club.clubId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ member: member.playerId }),
    });

    // Refused BEFORE the exchange: no interceptor is registered for this code on purpose, so a route
    // that reached the Home first would fail loudly here rather than quietly passing.
    expect((await charter(club.clubId, member.token, 'never-exchanged')).status).toBe(403);
    const stranger = await devSession('a stranger');
    expect((await charter(club.clubId, stranger.token, 'never-exchanged')).status).toBe(404);
  });

  it('will not let one person record a ceremony another person completed', async () => {
    const hostToken = await homeSession('signin-5');
    const club = await createClubViaHttp(hostToken, 'Somebody else’s ceremony');

    // The ceremony verifies, and it is a different person's. Host standing alone is not enough:
    // without this check a host could record any ceremony they got hold of onto their own club.
    const pool = fetchMock.get(HOME);
    pool.intercept({ path: '/token', method: 'POST' }).reply(200, {
      id_token: await signIdToken(
        claims({
          // BOTH claims: the address is read from `canonical_agent_id` when there is one, so
          // overriding only `sub` produced a token that still identified the same person.
          sub: 'eip155:31337:0xAbC000000000000000000000000000000000000F',
          canonical_agent_id: 'eip155:31337:0xAbC000000000000000000000000000000000000F',
        }),
      ),
      delegation: { delegator: PERSON, salt: '1' },
      org,
    });
    pool.intercept({ path: '/jwks', method: 'GET' }).reply(200, { keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] });

    const res = await charter(club.clubId, hostToken, 'charter-5');
    expect(res.status).toBe(403);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/different person/);
  });
});
