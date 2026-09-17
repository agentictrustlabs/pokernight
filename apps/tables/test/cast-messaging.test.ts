// THE CARD ROOM AS A CHARACTER'S RUNTIME — the two-round-trip send, against a fake standard surface that behaves as
// the Home's does: the first ask parks AUTH_REQUIRED naming what it needs; the continuation must present a chain
// of two whose child is bound to the standing grant; then it completes. Nothing here reaches a network.
import { describe, expect, it } from 'vitest';
import { CAPABILITY_RAR_TYPE, capabilityHandler, hashDelegation, ROOT_AUTHORITY, type Delegation, type MandateRequirementV1 } from '@agenticprimitives/delegation';
import { toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { castMessaging, parseCastMessaging, recipientAddress, whisperAs, whispersToCarry, type CastMessaging, type StandingGrantV1 } from '../src/cast-messaging.js';

const ENF = { timestamp: '0x73A7B878168b7DE48677617179A8bE894f0Dfe96', allowedMethods: '0xdBb2E47793393C499efB0f3fcbf6Ca8669791a41', value: '0x8759c1a6cEBF1D5069e9434EF46327Bf2ef69975', allowedTargets: '0x2156311097A936de1916a878bF53Bfd43c7b5715', digestBinding: '0xA3bb9BCC9b2F6F2419E1aBe5ED6Fd5399b9E68e1' } as const;
const DM = '0x710cb1bF08C234Df397e0910331e0A29710EF4F7' as Address;
const ILSE = '0x4f13d4b8e3b21908a4ee1121fb904a2495109bca' as Address;
const TEODOR = '0xa32f1338b987d8a2623bbacb210520654482acad' as Address;
const ALICE = '0xb0d11ce19b756a682e78b4904cd8d832303b3d11' as Address;
const HARNESS = '0xd34c3fbc89706dd57d426546dcebd3ba926ede35' as Address;

/** The standing grant as the estate mints it (`buildStandingGrant`): member → runtime key, the capability, no intent binding. */
async function standingGrant(member: Address, runtimeKey: Address, locations: Address[], signDigest: (d: Hex) => Promise<Hex>): Promise<StandingGrantV1> {
  const now = Math.floor(Date.now() / 1000);
  const requirement: Omit<MandateRequirementV1, 'intentDigest'> = { type: CAPABILITY_RAR_TYPE, actions: ['messaging.direct.send'], locations, validAfter: now - 60, validUntil: now + 3600 };
  const caveats = capabilityHandler.toCaveats(requirement as MandateRequirementV1, ENF as never);
  const salt = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
  const d: Delegation = { delegator: member, delegate: runtimeKey, authority: ROOT_AUTHORITY, caveats, salt, signature: '0x' };
  const ref = hashDelegation(d, 34348, DM);
  d.signature = await signDigest(ref);
  return { v: 1, wire: { ...d, salt: salt.toString() }, ref, requirement, enforcers: ENF as never, chainId: 34348, delegationManager: DM, grantedAt: new Date().toISOString() };
}

async function note(): Promise<{ cm: CastMessaging; key: Hex }> {
  const key = generatePrivateKey();
  const session = privateKeyToAccount(key).address;
  const custodian = generatePrivateKey(); // stands in for persona-sign; the fake surface verifies nothing on chain
  const standing = await standingGrant(ILSE, session, [TEODOR, ALICE], (d) => sign({ hash: d, privateKey: custodian, to: 'hex' }));
  const wire = { delegator: ILSE, delegate: session, authority: '0x' + 'ff'.repeat(32), caveats: [], salt: '1', signature: '0x00' };
  const cm = parseCastMessaging(JSON.stringify({ sessionKey: session, chainId: 34348, edge: 'https://edge.test', parts: { 'ilse-elena.me': { sa: ILSE, role: 'returnee', character: 'Ilse Varrow', wire, standing } } }))!;
  return { cm, key };
}

/** A standard surface for ONE agent: parks the first send, completes a continuation that presents the right chain. */
function fakeSurface(standingRef: string, seen: { asks: string[]; presented: unknown[] }) {
  // GetTask answers with the task AS IT STANDS — status message included — exactly as the Home does.
  let last: unknown = null;
  const task = (state: string, parts: unknown[]) => (last = { id: 'task-1', status: { state, message: { role: 'ROLE_AGENT', parts } } });
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: { message?: { parts?: Array<{ text?: string }>; taskId?: string; metadata?: { presented?: unknown[]; plan?: unknown } }; id?: string } };
    expect(String(url)).toBe('https://edge.test/api/a2a/ilse-elena.me');
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
    if (body.method === 'SendMessage' && !body.params.message?.taskId) {
      seen.asks.push(body.params.message?.parts?.[0]?.text ?? '');
      expect(body.params.message?.metadata?.plan).toBeTruthy();
      const now = Math.floor(Date.now() / 1000);
      return reply({ task: task('TASK_STATE_AUTH_REQUIRED', [{ text: 'This needs your authority to send direct messages.' }, { data: { runRef: 'r1', openToStewards: true, requirement: { type: CAPABILITY_RAR_TYPE, actions: ['messaging.direct.send'], locations: [TEODOR], validAfter: now - 60, validUntil: now + 600, intentDigest: '0x' + '11'.repeat(32) }, delegator: ILSE, delegate: HARNESS } }]) });
    }
    if (body.method === 'GetTask') return reply(last);
    if (body.method === 'SendMessage' && body.params.message?.taskId === 'task-1') {
      const presented = body.params.message.metadata?.presented as Array<{ authority?: string; delegator?: string }>;
      seen.presented.push(presented);
      expect(presented).toHaveLength(2);
      expect(String(presented[0]!.authority).toLowerCase()).toBe(standingRef.toLowerCase());   // the child hangs off the standing grant
      expect(String(presented[1]!.delegator).toLowerCase()).toBe(ILSE);                      // whose root is the character
      return reply({ task: task('TASK_STATE_COMPLETED', [{ text: 'Done — send direct messages: done.' }]) });
    }
    return reply({ task: task('TASK_STATE_FAILED', [{ text: `unexpected ${body.method}` }]) });
  };
}

describe('cast messaging — a whisper is a direct message from the character’s own agent', () => {
  it('asks as the character, derives the mandate from the standing grant when the run parks, and continues to completion', async () => {
    const { cm, key } = await note();
    const seen = { asks: [] as string[], presented: [] as unknown[] };
    const from = cm.parts['ilse-elena.me']!;
    const out = await whisperAs({ HOUSE_A2A_SESSION_KEY: key }, cm, from, TEODOR, 'Teodor Maske', 'The road is closed until spring.', { fetch: fakeSurface(from.standing.ref, seen) as never, timeoutMs: 2000 });
    expect(out).toEqual({ ok: true, state: 'TASK_STATE_COMPLETED' });
    expect(seen.asks[0]).toBe('Whisper to Teodor Maske: The road is closed until spring.');
    expect(seen.presented).toHaveLength(1);
  });

  it('refuses to derive outside the standing grant — a recipient the custodian did not name stays in the room', async () => {
    const { cm, key } = await note();
    const from = cm.parts['ilse-elena.me']!;
    const stranger = '0x00000000000000000000000000000000000000aa' as Address;
    const surface = fakeSurface(from.standing.ref, { asks: [], presented: [] });
    // the fake parks naming TEODOR; the STANDING GRANT is what bounds the derivation, and it is checked against the NEED
    const narrowed = { ...cm, parts: { ...cm.parts, 'ilse-elena.me': { ...from, standing: { ...from.standing, requirement: { ...from.standing.requirement, locations: [stranger] } } } } };
    const out = await whisperAs({ HOUSE_A2A_SESSION_KEY: key }, narrowed, narrowed.parts['ilse-elena.me']!, TEODOR, 'Teodor Maske', 'hello', { fetch: surface as never, timeoutMs: 2000 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/standing grant does not cover/);
  });

  it('picks the whispers to carry: spoken by an agent-played part this deployment can speak for, to an addressable part, once', async () => {
    const { cm } = await note();
    const cast = [
      { role: 'returnee', agent: 'ilse-elena.me', name: 'Ilse Varrow' },
      { role: 'household', agent: 'teodor-dave.me', name: 'Teodor Maske' },   // not in the note: a recipient by name it cannot resolve
      { role: 'convener', agent: `home:${ALICE}`, name: 'Alice' },              // a person's own agent
      { role: 'funder', agent: 'funder.cast', name: 'Anselm Dray' },            // the house's rules: no address
    ];
    const log = [
      { type: 'whispered', at: 1, by: 'returnee', to: 'convener', text: 'a word' },
      { type: 'whispered', at: 2, by: 'convener', to: 'returnee', text: 'a person typed this' },  // no wire for a person: stays
      { type: 'whispered', at: 3, by: 'returnee', to: 'funder', text: 'to nobody addressable' },
      { type: 'said', at: 4, by: 'returnee', text: 'room talk' },
    ];
    const first = whispersToCarry(log, cast, cm, new Set());
    expect(first.map((w) => [w.toSa, w.text])).toEqual([[ALICE, 'a word']]);
    const carried = new Set(first.map((w) => w.key));
    expect(whispersToCarry(log, cast, cm, carried)).toEqual([]);
    expect(recipientAddress(cm, 'ilse-elena.me')).toBe(ILSE);
    expect(recipientAddress(cm, `home:${ALICE}`)).toBe(ALICE);
    expect(recipientAddress(cm, 'funder.cast')).toBeNull();
  });

  it('is off without a session key or a note, and reads the note from the environment before KV', async () => {
    const { cm, key } = await note();
    expect(await castMessaging({ HOUSE_A2A_SESSION_KEY: '', CAST_MESSAGING: JSON.stringify(cm) })).toBeNull();
    expect(await castMessaging({ HOUSE_A2A_SESSION_KEY: key })).toBeNull();
    const got = await castMessaging({ HOUSE_A2A_SESSION_KEY: key, CAST_MESSAGING: JSON.stringify({ sessionKey: cm.sessionKey, chainId: cm.chainId, edge: cm.edge + '/', parts: { 'ilse-elena.me': { sa: ILSE.toUpperCase(), role: 'returnee', character: 'Ilse', wire: {}, standing: cm.parts['ilse-elena.me']!.standing } } }) });
    expect(got?.edge).toBe('https://edge.test');
    expect(got?.parts['ilse-elena.me']?.sa).toBe(ILSE);
    expect(got?.parts['ilse-elena.me']?.name).toBe('ilse-elena.me');
  });
});
