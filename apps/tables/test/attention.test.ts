/**
 * NOBODY LOOKING, NOBODY DEALT TO — and a coach playing for somebody is not somebody looking.
 *
 * `anybodyAttending` is what keeps a table of house bots (and a language-model coach behind a person's
 * agent) from running all night for a tab left open. It used to accept an ACTIVE HUMAN SEAT as attention,
 * which in play-for-me mode is a seat the coach keeps active by acting every turn — so the gate never
 * closed. Now attention is a person's own input within ATTENTION_MS, and a move marked `auto` is not one.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { PokerTableDO } from '../src/table-do.js';
import { TestClient, createTableViaHttp, devSession, engineReady } from './helpers.js';

const TEN_MINUTES = 10 * 60 * 1000;

describe('attention (engine required)', () => {
  it.skipIf(!engineReady)('an active seat whose only input is the coach’s auto moves is not attending; a real command is', async () => {
    const table = await createTableViaHttp('attention', { actionTimeoutMs: 30_000 });
    const a = await TestClient.connect(table.tableId, (await devSession('Ann')).token);
    const b = await TestClient.connect(table.tableId, (await devSession('Ben')).token);
    a.send({ type: 'join', seat: 0, buyIn: 100 });
    await a.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
    b.send({ type: 'join', seat: 1, buyIn: 100 });
    await b.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined' && m.event.seat === 1);
    const stub = env.TABLES.get(env.TABLES.idFromName(table.tableId));
    const attending = () => runInDurableObject(stub, async (instance: PokerTableDO) => (instance as unknown as { anybodyAttending: () => boolean }).anybodyAttending());
    const age = (ms: number) => runInDurableObject(stub, async (instance: PokerTableDO) => { (instance as unknown as { lastHumanInput: number }).lastHumanInput = Date.now() - ms; });

    // Two people just joined: attending.
    expect(await attending()).toBe(true);
    // Ten minutes with no input, seats still active and sockets still open: NOT attending — the old rule
    // said yes here, because a human seat was active.
    await age(TEN_MINUTES + 1);
    expect(await attending()).toBe(false);
    // A move the coach made for Ann (`auto`) — refused as out of turn or applied, either way it is not a person.
    a.send({ type: 'act', handNo: 1, action: { type: 'check' }, auto: true } as never);
    await new Promise((r) => setTimeout(r, 200));
    expect(await attending()).toBe(false);
    // A line of chat is a person.
    a.send({ type: 'chat', text: 'still here' });
    await a.waitFor((m) => m.type === 'event' && m.event.type === 'chat', 4000);
    expect(await attending()).toBe(true);
  });
});
