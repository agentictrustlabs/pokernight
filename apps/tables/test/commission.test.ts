/**
 * GREAT COMMISSION (docs/GREAT-COMMISSION.md): a substrate test played as a game, hosted exactly as a mystery
 * is. A solo night is derived from its owner, opens with one person in a part and six agents, and the socket
 * carries ONE PART'S VIEW — its vault, what it has been shown, the board — and never the hidden state.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { devSession, sleep } from './helpers.js';

interface Down {
  type: string;
  view?: { you?: { role: string; kind: string; vault: Array<{ id: string; grain: string }>; received: unknown[] }; cast?: Array<{ role: string; operator: string; mind?: string }>; round?: number; phase?: string; room?: { id: string; grain: string }; peoples?: Array<{ id: string; places?: string[] }>; reveal?: unknown } | null;
  staging?: { stagingId: string; paused: boolean; night: number } | null;
  code?: string; message?: string;
}

async function socket(stagingId: string, token: string) {
  const res = await SELF.fetch(`http://tables.test/commissions/${stagingId}/ws?token=${token}`, { headers: { upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no socket: ${res.status}`);
  ws.accept();
  const log: Down[] = [];
  ws.addEventListener('message', (e) => log.push(JSON.parse(String(e.data)) as Down));
  // WALKING IN IS BEING HERE: the staging pushes nothing until the socket says `join` — the client does this
  // on open, and so must a test, or it waits forever for a view nobody asked for.
  ws.send(JSON.stringify({ type: 'join' }));
  const waitFor = async (pred: (m: Down) => boolean, tries = 40) => {
    for (let i = 0; i < tries; i++) { const m = log.find(pred); if (m) return m; await sleep(50); }
    throw new Error(`nothing matched; saw ${log.map((m) => `${m.type}${m.code ? ':' + m.code : ''}`).join(',')}`);
  };
  return { ws, log, waitFor, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

const post = (path: string, token: string, body: unknown) =>
  SELF.fetch(`http://tables.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('a night of your own in Weld County', () => {
  it('is the same night when you ask twice, and a new one when you ask for another', async () => {
    const me = await devSession('a-researcher');
    const first = (await (await post('/commissions/solo', me.token, { role: 'researcher' })).json()) as { staging: { stagingId: string; seedCommit: string } };
    const same = (await (await post('/commissions/solo', me.token, { role: 'researcher' })).json()) as { staging: { stagingId: string; seedCommit: string } };
    expect(same.staging.stagingId).toBe(first.staging.stagingId);
    expect(same.staging.seedCommit).toBe(first.staging.seedCommit);
    const fresh = (await (await post('/commissions/solo', me.token, { role: 'researcher', restart: true })).json()) as { staging: { stagingId: string; seedCommit: string } };
    expect(fresh.staging.stagingId).toBe(first.staging.stagingId);
    expect(fresh.staging.seedCommit).not.toBe(first.staging.seedCommit);
  });

  it('refuses a night to somebody not signed in, and an unknown scenario to somebody who is', async () => {
    expect((await SELF.fetch('http://tables.test/commissions/solo', { method: 'POST' })).status).toBe(401);
    const me = await devSession('nobody-in-particular');
    expect((await post('/commissions/solo', me.token, { scenario: 'a-scenario-nobody-wrote' })).status).toBe(404);
  });

  it('lists what can be staged: two nights in one region, seven parts each', async () => {
    const r = await SELF.fetch('http://tables.test/commissions');
    expect(r.status).toBe(200);
    const b = (await r.json()) as { scenarios: Array<{ id: string; night: number; roles: unknown[]; regionName: string }> };
    // The default night is the real county; the invented marches remain beside it.
    expect(b.scenarios.map((s) => s.id)).toEqual(['first-light', 'second-winter', 'thursday-in-greeley']);
    expect(b.scenarios[0]?.roles).toHaveLength(7);
    expect(b.scenarios[1]?.night).toBe(2);
  });

  it('opens with you in your part and the rest played by agents; your socket carries your vault and never the hidden state', async () => {
    const me = await devSession('ilse');
    const { staging } = (await (await post('/commissions/solo', me.token, { role: 'returnee', restart: true })).json()) as { staging: { stagingId: string } };
    const s = await socket(staging.stagingId, me.token);
    const m = await s.waitFor((x) => x.type === 'staging' && !!x.view);
    expect(m.view?.you?.role).toBe('returnee');
    expect(m.view?.you?.kind).toBe('returnee');
    // The returnee opens holding r1 at household grain, and nothing that has not arrived yet.
    expect(m.view?.you?.vault.map((v) => v.id)).toEqual(['r1']);
    expect(m.view?.you?.vault[0]?.grain).toBe('household');
    expect(m.view?.cast?.filter((c) => c.operator === 'agent')).toHaveLength(6);
    expect(m.view?.reveal ?? null).toBeNull();
    expect(JSON.stringify(m.view)).not.toContain('"truth"');
    // The towns are the map — public to everybody, including whoever is carrying this out of the room.
    expect(m.view?.peoples?.find((p) => p.id === 'burmese')?.places).toContain('Evans');
    s.ws.close();
  });

  it('a slip over the socket lands, at the grain you chose; one finer than you hold is refused in the game’s words', async () => {
    const me = await devSession('ilse-again');
    const { staging } = (await (await post('/commissions/solo', me.token, { role: 'returnee', restart: true })).json()) as { staging: { stagingId: string } };
    const s = await socket(staging.stagingId, me.token);
    await s.waitFor((x) => x.type === 'staging' && !!x.view);
    s.send({ type: 'act', action: { type: 'testify', people: 'burmese', evidence: 'r1', grain: 'person' } });
    const refused = await s.waitFor((x) => x.type === 'error');
    expect(refused.code).toBe('finer-than-held');
    s.send({ type: 'act', action: { type: 'testify', people: 'burmese', evidence: 'r1', grain: 'county' } });
    const after = await s.waitFor((x) => x.type === 'staging' && JSON.stringify(x.view ?? {}).includes('"testified"'));
    expect(JSON.stringify(after.view)).toContain('Weld County');
    s.ws.close();
  });

  it('the hold is the host’s, and a solo night’s host is its owner', async () => {
    const me = await devSession('the-host');
    const { staging } = (await (await post('/commissions/solo', me.token, { role: 'convener', restart: true })).json()) as { staging: { stagingId: string } };
    const s = await socket(staging.stagingId, me.token);
    await s.waitFor((x) => x.type === 'staging' && !!x.view);
    s.send({ type: 'pause', on: true });
    const held = await s.waitFor((x) => x.type === 'staging' && x.staging?.paused === true);
    expect(held.staging?.paused).toBe(true);
    s.ws.close();
  });

  it('the second night opens on night two', async () => {
    const me = await devSession('a-year-later');
    const r = (await (await post('/commissions/solo', me.token, { scenario: 'second-winter', role: 'researcher', restart: true })).json()) as { staging: { night: number; scenario: string } };
    expect(r.staging.scenario).toBe('second-winter');
    expect(r.staging.night).toBe(2);
  });
});
