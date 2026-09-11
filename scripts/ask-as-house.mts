/**
 * ASK A HOME AGENT SOMETHING, AS THE HOUSE — the proof that the card room can name itself.
 *
 * Sends one plain conversational message to an agent's standard A2A surface with the house's session
 * wire on it, and prints what came back. It uses the SAME secrets and the SAME signing as the Worker,
 * read from the local files, so a refusal here is a refusal the Worker would get too.
 *
 *   npx tsx scripts/ask-as-house.mts alice-me.faithnet.ai "What can you help me with?"
 *
 * This runs a harness ask at the person's Home, under THEIR playbook — a language-model run they pay
 * for. One question, on purpose, when checking the path; not a thing to loop.
 */
import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapSessionSignature } from '@agenticprimitives/a2a';
import { callerAssertionDigest, requestBodyHash, sessionAuthorizationHeader } from '@agenticprimitives/a2a/standard';

const host = process.argv[2];
const text = process.argv[3] ?? 'What can you help me with?';
if (!host) throw new Error('usage: ask-as-house.mts <host> [question]');
// WHERE THE CARD SAYS, not where the host is. A Home agent's card names the estate's EDGE as its
// message URL; the worker host behind it refuses direct calls (`gateway_assertion_required`).
const card = (await (await fetch(`https://${host}/.well-known/agent-card.json`)).json()) as { supportedInterfaces?: Array<{ url?: string }> };
const advertised = card.supportedInterfaces?.[0]?.url;
// The wire is a secret on the Worker and is not kept in the repo; point at wherever the mint wrote it.
const wireFile = process.env.HOUSE_WIRE_FILE;
if (!wireFile) throw new Error('set HOUSE_WIRE_FILE to the wire JSON `scripts/mint-house-wire.mts` printed');
const wire = JSON.parse(readFileSync(wireFile, 'utf8'));
const session = privateKeyToAccount((JSON.parse(readFileSync('.house-a2a-session.json', 'utf8')) as { privateKey: `0x${string}` }).privateKey);

const url = advertised ?? `https://${host}/api/a2a`;
console.log('asking :', url);
const raw = JSON.stringify({
  jsonrpc: '2.0', id: 'house-ask-1', method: 'SendMessage',
  params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text }] } },
});
const unsigned = { agent: wire.delegator.toLowerCase(), method: 'SendMessage', bodyHash: requestBodyHash(raw), issuedAt: Math.floor(Date.now() / 1000), audience: new URL(url).origin };
const sig = await session.sign({ hash: callerAssertionDigest(unsigned) });
const authorization = sessionAuthorizationHeader({ ...unsigned, signature: wrapSessionSignature(wire, sig) });

const started = Date.now();
const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization }, body: raw, signal: AbortSignal.timeout(90_000) });
const body = await res.text();
console.log(`${res.status} in ${Date.now() - started}ms`);
try {
  const j = JSON.parse(body);
  const r = j.result ?? j.error;
  const parts = r?.parts ?? r?.status?.message?.parts ?? r?.message?.parts ?? [];
  console.log('kind   :', r?.kind ?? r?.status?.state ?? (j.error ? `error ${j.error.code}` : '?'));
  if (!parts.length) console.log('result :', JSON.stringify(r).slice(0, 900));
  for (const p of parts) console.log('part   :', (p.text ?? JSON.stringify(p.data ?? p)).slice(0, 600));
  if (j.error) console.log('error  :', j.error.message);
} catch {
  console.log(body.slice(0, 400));
}
