/**
 * The card room naming itself to a person's own agent.
 *
 * What is pinned: the assertion binds the exact bytes sent, the method, the host and the moment; the
 * signature is the session key's, wrapped with the wire; and NOTHING is sent to the house's own worker,
 * which asks nobody's name. A Home verifies the rest on chain — that is its test, not this one.
 */
import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverAddress } from 'viem';
import { parseSessionWrappedSignature } from '@agenticprimitives/a2a';
import { callerAssertionDigest, parseSessionAuthorization, requestBodyHash } from '@agenticprimitives/a2a/standard';
import { houseAuthorization, houseCallerConfigured, isHouseUrl } from '../src/house-caller.js';
import type { Env } from '../src/env.js';

const sessionKey = generatePrivateKey();
const session = privateKeyToAccount(sessionKey);
const HOUSE = '0x0347e808a0bB7a7a7086a29d853E799f351C04DD';
const wire = {
  delegator: HOUSE,
  delegate: session.address,
  authority: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  caveats: [],
  salt: '1',
  signature: '0xabcd',
};
const env = (over: Partial<Env> = {}): Env =>
  ({ AGENT_BASE_URL: 'https://agents.faithnet.io', HOUSE_A2A_WIRE: JSON.stringify(wire), HOUSE_A2A_SESSION_KEY: sessionKey, ...over }) as Env;

describe('whether the card room can name itself', () => {
  it('needs both the wire and the session key', () => {
    expect(houseCallerConfigured(env())).toBe(true);
    expect(houseCallerConfigured(env({ HOUSE_A2A_WIRE: '' } as Partial<Env>))).toBe(false);
    expect(houseCallerConfigured(env({ HOUSE_A2A_SESSION_KEY: undefined } as Partial<Env>))).toBe(false);
  });

  it('knows its own worker by origin, not by string', () => {
    expect(isHouseUrl(env(), 'https://agents.faithnet.io/sharkbot.svc/api/a2a')).toBe(true);
    expect(isHouseUrl(env(), 'https://alice-me.faithnet.ai/api/a2a')).toBe(false);
    expect(isHouseUrl(env({ AGENT_BASE_URL: '' } as Partial<Env>), 'https://agents.faithnet.io/x')).toBe(false);
  });
});

describe('the authorization it sends', () => {
  const raw = JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'SendMessage', params: {} });

  it('is nothing for the house’s own personas, which ask nobody’s name', async () => {
    expect(await houseAuthorization(env(), 'https://agents.faithnet.io/sharkbot.svc/api/a2a', 'SendMessage', raw)).toBeNull();
  });

  it('is nothing when unconfigured, so a Home refuses by name rather than this guessing', async () => {
    expect(await houseAuthorization(env({ HOUSE_A2A_WIRE: '' } as Partial<Env>), 'https://alice-me.faithnet.ai/api/a2a', 'SendMessage', raw)).toBeNull();
  });

  it('binds the house agent, the method, the exact body and the host', async () => {
    const header = await houseAuthorization(env(), 'https://alice-me.faithnet.ai/api/a2a', 'SendMessage', raw);
    const a = parseSessionAuthorization(header);
    expect(a).not.toBeNull();
    expect(a!.agent).toBe(HOUSE.toLowerCase());
    expect(a!.method).toBe('SendMessage');
    expect(a!.bodyHash).toBe(requestBodyHash(raw));
    // The ORIGIN, not the path: an assertion for one agent's host must not be usable at another's, and a
    // path would only over-bind it.
    expect(a!.audience).toBe('https://alice-me.faithnet.ai');
    expect(Math.abs(a!.issuedAt - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it('is signed by the session key and wrapped with the wire the custodian signed', async () => {
    const header = await houseAuthorization(env(), 'https://alice-me.faithnet.ai/api/a2a', 'SendMessage', raw);
    const a = parseSessionAuthorization(header)!;
    const wrapped = parseSessionWrappedSignature(a.signature);
    expect(wrapped).not.toBeNull();
    expect(wrapped!.wire.delegator.toLowerCase()).toBe(HOUSE.toLowerCase());
    expect(wrapped!.wire.delegate.toLowerCase()).toBe(session.address.toLowerCase());
    const { signature: _s, ...unsigned } = a;
    const digest = callerAssertionDigest(unsigned);
    expect((await recoverAddress({ hash: digest, signature: wrapped!.sig })).toLowerCase()).toBe(session.address.toLowerCase());
  });

  it('changes when the body changes by one byte — it is the bytes that are signed', async () => {
    const a = parseSessionAuthorization(await houseAuthorization(env(), 'https://alice-me.faithnet.ai/api/a2a', 'SendMessage', raw))!;
    const b = parseSessionAuthorization(await houseAuthorization(env(), 'https://alice-me.faithnet.ai/api/a2a', 'SendMessage', raw + ' '))!;
    expect(a.bodyHash).not.toBe(b.bodyHash);
  });
});
