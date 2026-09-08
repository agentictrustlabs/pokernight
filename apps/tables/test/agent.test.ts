/**
 * A2A agent seats (DESIGN.md §6, phase 2).
 *
 * The agent is stubbed with `fetchMock`, the pool's undici MockAgent: it intercepts `globalThis.fetch`
 * for the test runner worker, which is the same isolate the main Worker and its Durable Objects run in,
 * so the DO's outbound `poker.act` call lands on these interceptors.
 */
import { SELF, env, fetchMock, runInDurableObject } from 'cloudflare:test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LegalActions, PlayerInfo, ServerMessage } from '@pokernight/protocol';
import type { PokerTableDO } from '../src/table-do.js';
import { TestClient, createTableViaHttp, devSession, engineReady, waitForAny } from './helpers.js';
import { resolveAgentBase } from '../src/a2a.js';

/**
 * A fresh origin per test: `fetchMock` interceptors are only reset between FILES, so persisted stubs
 * from an earlier test would otherwise win the match in a later one.
 */
let agentOrigin = 'http://agent-0.test';
let originCounter = 0;

interface AgentCallRecord {
  seat: number;
  requestedAt: number;
  respondedAt: number | null;
  ok: boolean | null;
  action: { type: string } | null;
  note: string | null;
  error: string | null;
}

function agentCard(): Record<string, unknown> {
  return {
    name: 'Sharkbot',
    description: 'A tight-aggressive rules bot.',
    version: '1.0.0',
    supportedInterfaces: [{ transport: 'JSONRPC', url: `${agentOrigin}/api/a2a` }],
    capabilities: {},
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{ id: 'poker.act', name: 'poker.act', description: 'Play one poker turn', tags: ['poker', 'rules'] }],
  };
}

/** `fetchMock.get(origin)` with the agent card served (the seat-agent precondition). */
function stubCard(origin = agentOrigin): void {
  fetchMock
    .get(origin)
    .intercept({ path: '/.well-known/agent-card.json', method: 'GET' })
    .reply(200, agentCard(), { headers: { 'content-type': 'application/json' } })
    .persist();
}

/** Stub `/api/a2a`; `pick` chooses the action from the `poker.act` input the DO sent. */
function stubAct(pick: (legal: LegalActions, input: { handNo: number; seat: number }) => unknown, delayMs = 0): void {
  const interceptor = fetchMock
    .get(agentOrigin)
    .intercept({ path: '/api/a2a', method: 'POST' })
    .reply(200, (opts: { body?: unknown }) => {
      const req = JSON.parse(typeof opts.body === 'string' ? opts.body : '{}') as {
        id: unknown;
        params: { message: { parts: Array<{ data?: { input?: { legal: LegalActions; handNo: number; seat: number } } }> } };
      };
      const input = req.params.message.parts[0]?.data?.input;
      if (!input) throw new Error('no poker.act input in the request');
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          message: {
            messageId: crypto.randomUUID(),
            role: 'agent',
            parts: [{ kind: 'data', data: { action: pick(input.legal, input), note: 'stub' } }],
          },
        },
      };
    }, { headers: { 'content-type': 'application/json' } })
    .persist();
  if (delayMs > 0) interceptor.delay(delayMs);
}

const checkOrCall = (legal: LegalActions): unknown =>
  legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' };

async function seatAgent(tableId: string, token: string | null, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`http://tables.test/tables/${tableId}/seat-agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function unseatAgent(tableId: string, token: string, seat: number): Promise<Response> {
  return SELF.fetch(`http://tables.test/tables/${tableId}/seat-agent/${seat}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Answer every `turn` this client receives with a check or a call, so the hand keeps moving. */
function autoPlay(c: TestClient): () => void {
  return c.subscribe((m: ServerMessage) => {
    if (m.type !== 'turn') return;
    c.send({ type: 'act', handNo: m.handNo, action: checkOrCall(m.legal) });
  });
}

async function agentCalls(tableId: string, handNo: number): Promise<AgentCallRecord[]> {
  const res = await SELF.fetch(`http://tables.test/tables/${tableId}/hands/${handNo}`);
  const body = (await res.json()) as { agentCalls?: AgentCallRecord[] };
  return body.agentCalls ?? [];
}

/** A human at seat 0 plus a stubbed agent at seat 1; the human answers its own turns. */
async function tableWithAgent(actionTimeoutMs: number): Promise<{ tableId: string; human: TestClient; token: string }> {
  const table = await createTableViaHttp('agents', { minBuyIn: 40, maxBuyIn: 200, actionTimeoutMs });
  const session = await devSession(`Human${Math.floor(Math.random() * 1e6)}`);
  const human = await TestClient.connect(table.tableId, session.token);
  await human.waitFor((m) => m.type === 'welcome');
  human.send({ type: 'join', seat: 0, buyIn: 100 });
  await human.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');
  const res = await seatAgent(table.tableId, session.token, { seat: 1, buyIn: 100, agentName: 'sharkbot.svc', endpoint: agentOrigin });
  expect(res.status).toBe(201);
  autoPlay(human);
  return { tableId: table.tableId, human, token: session.token };
}

describe('A2A agent seats', () => {
  // Activated for the whole file, not per test: an agent turn that is still on the wire when a test
  // ends would otherwise escape the mock and try a real DNS lookup.
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterAll(() => {
    fetchMock.deactivate();
  });
  beforeEach(() => {
    agentOrigin = `http://agent-${++originCounter}.test`;
  });

  it('refuses to seat an agent without a session', async () => {
    const table = await createTableViaHttp('no auth');
    const res = await seatAgent(table.tableId, null, { seat: 0, buyIn: 100, agentName: 'sharkbot.svc', endpoint: agentOrigin });
    expect(res.status).toBe(401);
  });

  it('rejects an unreachable agent endpoint', async () => {
    const table = await createTableViaHttp('unreachable');
    const s = await devSession('Ida');
    const res = await seatAgent(table.tableId, s.token, { seat: 0, buyIn: 100, agentName: 'ghost.svc', endpoint: 'http://nobody.test' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/agent card unreachable/);
  });

  it('rejects an agent card without the poker.act skill', async () => {
    fetchMock
      .get('http://chatty.test')
      .intercept({ path: '/.well-known/agent-card.json', method: 'GET' })
      .reply(200, { ...agentCard(), skills: [{ id: 'chat.say', name: 'chat.say', description: 'talk', tags: [] }] }, { headers: { 'content-type': 'application/json' } });
    const table = await createTableViaHttp('no skill');
    const s = await devSession('Jon');
    const res = await seatAgent(table.tableId, s.token, { seat: 0, buyIn: 100, agentName: 'chatty.svc', endpoint: 'http://chatty.test' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/poker\.act/);
  });

  it.skipIf(!engineReady)('seats an agent against a stubbed card and reports it as a player', async () => {
    stubCard();
    const table = await createTableViaHttp('seated agent', { minBuyIn: 40, maxBuyIn: 200 });
    const s = await devSession('Kim');
    const res = await seatAgent(table.tableId, s.token, { seat: 3, buyIn: 120, agentName: 'sharkbot.svc', endpoint: agentOrigin });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      seat: 3,
      stack: 120,
      player: { playerId: 'agent:sharkbot.svc', name: 'Sharkbot', kind: 'agent', agentName: 'sharkbot.svc', agentKind: 'rules' },
    });

    // `players` rides along with the spectator view and the welcome frame; `names` stays populated.
    const view = (await (await SELF.fetch(`http://tables.test/tables/${table.tableId}`)).json()) as {
      names: Record<string, string>;
      players: Record<string, PlayerInfo>;
    };
    expect(view.names['agent:sharkbot.svc']).toBe('Sharkbot');
    expect(view.players['agent:sharkbot.svc']).toMatchObject({ kind: 'agent', agentName: 'sharkbot.svc' });
    // The endpoint is a DO-internal detail and must not leak to viewers.
    expect(JSON.stringify(view.players)).not.toContain(agentOrigin);

    const spectator = await TestClient.connect(table.tableId);
    const welcome = await spectator.waitFor((m) => m.type === 'welcome');
    if (welcome.type !== 'welcome') throw new Error('unreachable');
    expect(welcome.players?.['agent:sharkbot.svc']).toMatchObject({ kind: 'agent' });
    spectator.close();

    // Unseating cashes the agent out and empties the seat.
    const del = await SELF.fetch(`http://tables.test/tables/${table.tableId}/seat-agent/3`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${s.token}` },
    });
    expect(del.status).toBe(200);
    const after = (await (await SELF.fetch(`http://tables.test/tables/${table.tableId}`)).json()) as { view: { seats: unknown[] } };
    expect(after.view.seats).toHaveLength(0);
  });

  it.skipIf(!engineReady)('plays an agent turn end to end and records the exchange', async () => {
    stubCard();
    stubAct((legal) => checkOrCall(legal));
    const { tableId, human, token } = await tableWithAgent(5000);

    const acted = await human.waitFor(
      (m) => m.type === 'event' && m.event.type === 'action' && m.event.record.seat === 1,
      15_000,
    );
    if (acted.type !== 'event' || acted.event.type !== 'action') throw new Error('unreachable');
    expect(acted.event.record.timedOut).toBeFalsy();
    expect(['check', 'call', 'fold']).toContain(acted.event.record.action.type);

    const calls = await agentCalls(tableId, 1);
    const ok = calls.filter((c) => c.ok === true);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok[0]).toMatchObject({ seat: 1 });
    expect(ok[0]?.respondedAt).toBeGreaterThanOrEqual(ok[0]?.requestedAt ?? 0);
    // The rationale is stored but withheld from the hand record while the hand is still running.
    expect(ok[0]?.note).toBeNull();
    await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(tableId)), async (_do: PokerTableDO, doState) => {
      const row = doState.storage.sql
        .exec<{ note: string | null }>('SELECT note FROM agent_calls WHERE seat = 1 AND ok = 1 ORDER BY requested_at LIMIT 1')
        .toArray()[0];
      expect(row?.note).toBe('stub');
    });
    await unseatAgent(tableId, token, 1);
    human.close();
  }, 30_000);

  it.skipIf(!engineReady)('ignores an illegal agent reply and lets the turn clock default stand', async () => {
    stubCard();
    // Far above any legal raise for a 100-chip stack: the DO must drop it, not hand it to the engine.
    stubAct(() => ({ type: 'raise', amount: 1_000_000 }));
    const { tableId, human, token } = await tableWithAgent(1000);

    const timedOut = await human.waitFor(
      (m) => m.type === 'event' && m.event.type === 'action' && m.event.record.seat === 1 && m.event.record.timedOut === true,
      15_000,
    );
    expect(timedOut).toBeTruthy();
    const calls = await agentCalls(tableId, 1);
    const dropped = calls.find((c) => c.ok === false);
    expect(dropped?.error).toMatch(/illegal action/);
    expect(dropped?.action).toMatchObject({ type: 'raise' });
    await unseatAgent(tableId, token, 1);
    human.close();
  }, 30_000);

  it.skipIf(!engineReady)('applies the default when the agent does not answer in time', async () => {
    stubCard();
    stubAct((legal) => checkOrCall(legal), 4000);
    const { tableId, human, token } = await tableWithAgent(1000);

    const timedOut = await human.waitFor(
      (m) => m.type === 'event' && m.event.type === 'action' && m.event.record.seat === 1 && m.event.record.timedOut === true,
      15_000,
    );
    expect(timedOut).toBeTruthy();
    const calls = await agentCalls(tableId, 1);
    expect(calls.some((c) => c.seat === 1)).toBe(true);
    await unseatAgent(tableId, token, 1);
    human.close();
  }, 30_000);

  it.skipIf(!engineReady)('sits an agent out after two consecutive failed turns', async () => {
    stubCard();
    fetchMock.get(agentOrigin).intercept({ path: '/api/a2a', method: 'POST' }).reply(503, 'nope').persist();
    const { tableId, human, token } = await tableWithAgent(1000);

    // Each failure leaves the turn clock to apply the default, which is what increments `timeouts`.
    // MAX_TIMEOUTS_BEFORE_SIT_OUT is 2, so the second one sits the seat out — the same path a silent
    // human hits; nothing in it is transport-specific.
    const sat = await waitForAny(
      [human],
      (m) => m.type === 'event' && m.event.type === 'seat-status' && m.event.seat === 1 && m.event.status === 'sitting-out',
      25_000,
    );
    expect(sat.message).toBeTruthy();
    await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(tableId)), async (_do: PokerTableDO, state) => {
      const failures = state.storage.sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM agent_calls WHERE seat = 1 AND ok = 0')
        .toArray()[0];
      expect(failures?.n ?? 0).toBeGreaterThanOrEqual(2);
    });
    await unseatAgent(tableId, token, 1);
    human.close();
  }, 40_000);

  it('refuses a caller-supplied endpoint outside a dev-auth deployment (SSRF guard)', () => {
    // resolveAgentBase is the gate: in production the agent name must resolve inside AGENT_CARD_ZONE,
    // so a session holder cannot make the table fetch an arbitrary host every turn.
    const prod = { AGENT_CARD_ZONE: 'faithnet.ai', ALLOW_AGENT_ENDPOINT: 'false' } as unknown as Parameters<typeof resolveAgentBase>[0];
    expect(() => resolveAgentBase(prod, 'sharkbot.svc', 'http://169.254.169.254/latest/meta-data')).toThrow(/not accepted here/);
    expect(resolveAgentBase(prod, 'sharkbot.svc')).toBe('https://sharkbot-svc.faithnet.ai');

    // A single-host deployment names the persona in the path; this is operator config, not caller input.
    const oneHost = { AGENT_CARD_ZONE: 'faithnet.ai', AGENT_BASE_URL: 'https://agents.faithnet.io' } as unknown as Parameters<typeof resolveAgentBase>[0];
    expect(resolveAgentBase(oneHost, 'sharkbot.svc')).toBe('https://agents.faithnet.io/sharkbot.svc');

    const dev = { AGENT_CARD_ZONE: 'localhost', ALLOW_AGENT_ENDPOINT: 'true' } as unknown as Parameters<typeof resolveAgentBase>[0];
    expect(resolveAgentBase(dev, 'sharkbot.svc', 'http://localhost:8788/?agent=sharkbot.svc')).toContain('localhost:8788');
  });
});
