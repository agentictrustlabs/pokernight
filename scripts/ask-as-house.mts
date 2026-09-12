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
if (!host) throw new Error('usage: ask-as-house.mts <host> [question] [--advise | --record | --review]');
// THE CARD ROOM'S OWN THREE ASKS, as the table would send them (`encodeAdviseParts` / `encodeRecordParts`):
// a data part naming the skill with a seat's view, and a text part. `--advise` is one hand's question to the
// person's agent (which consults the coach it names); `--record` is a hand end (a vault put, no model);
// `--review` is the person's own question about her past hands (forwarded to the coach).
const mode = process.argv.includes('--advise') ? 'advise' : process.argv.includes('--record') ? 'record' : process.argv.includes('--review') ? 'review' : null;
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
const seat = { skill: `poker.${mode}`, tableId: 'probe', handNo: 12, seat: 0, deadlineMs: 20_000,
  view: { hand: { street: 'turn', board: ['As', 'Kd', '7c', '2h'], pot: 24, toCall: 18 }, me: { cards: ['Qh', 'Jh'], stack: 180 }, seats: [{ seat: 0, playerId: 'me', name: 'Alice' }, { seat: 1, playerId: 'agent:sharkbot.svc', name: 'Sharkbot', stack: 210 }] },
  legal: { fold: true, call: 18, raise: { min: 36, max: 180 } } };
const parts = mode === 'advise'
  ? [{ kind: 'data', data: { skill: 'poker.advise', input: { ...seat, question: text, read: { street: 'turn', priceToCall: '43%', outs: 9, chanceOneCard: '18%', position: 'out of position', facing: 'a bet of 18 into 24 by Sharkbot' }, baseline: { say: 'Fold — 43% to call with 18% to come.', action: { type: 'fold' } } }, answer: { say: 'one sentence', because: 'the reason', action: 'the move, EXACTLY one of {"type":"fold"} | {"type":"check"} | {"type":"call"} | {"type":"bet","amount":<total>} | {"type":"raise","amount":<total>} | {"type":"all-in"}' } } }, { kind: 'text', text: `poker.advise: advise seat 0 at poker, round 12. The person asked: "${text}".` }]
  : mode === 'record'
    ? [{ kind: 'data', data: { skill: 'poker.record', input: { ...seat, observation: { subjects: { 'agent:sharkbot.svc': { label: 'Sharkbot', counters: { hands: 1, vpip: 1, pfr: 1, cbetOpps: 1, cbet: 1, doubleBarrelOpps: 1, doubleBarrel: 1 } }, me: { you: true, counters: { hands: 1, vpip: 1, foldToBetOpps: 1, foldToBet: 1, netChips: -6 } } } } } } }, { kind: 'text', text: 'poker.record: round 12 at poker is over, as seat 0 saw it. Nothing is asked; record the hand.' }]
    : mode === 'review'
      ? [{ kind: 'data', data: { skill: 'poker.review', input: { ...seat, question: text } } }, { kind: 'text', text }]
      : [{ kind: 'text', text }];
const raw = JSON.stringify({
  jsonrpc: '2.0', id: 'house-ask-1', method: 'SendMessage',
  params: { message: { messageId: crypto.randomUUID(), role: 'user', parts } },
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
