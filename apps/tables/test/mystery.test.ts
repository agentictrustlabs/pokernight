/**
 * MYSTERY NIGHT (docs/MYSTERY-NIGHT.md): a story at a place. A solo night is derived from its owner like a
 * practice table — asking twice is asking about the same night — it opens with one person and seven agents,
 * and the socket carries ONE CHARACTER'S VIEW and nothing else.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { devSession, sleep } from './helpers.js';

interface Down { type: string; view?: { you?: { role: string; killer: boolean; secret: string }; cast?: Array<{ role: string }>; act?: number; phase?: string; room?: { id: string } } | null; staging?: { stagingId: string; paused: boolean } | null; message?: string }

async function socket(stagingId: string, token: string) {
  const res = await SELF.fetch(`http://tables.test/mysteries/${stagingId}/ws?token=${token}`, { headers: { upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no socket: ${res.status}`);
  ws.accept();
  const log: Down[] = [];
  ws.addEventListener('message', (e) => log.push(JSON.parse(String(e.data)) as Down));
  const waitFor = async (pred: (m: Down) => boolean, tries = 40) => {
    for (let i = 0; i < tries; i++) { const m = log.find(pred); if (m) return m; await sleep(50); }
    throw new Error(`nothing matched; saw ${log.map((m) => m.type).join(',')}`);
  };
  return { ws, log, waitFor, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe('a night of your own', () => {
  it('is the same night when you ask twice, and a new one when you ask for another', async () => {
    const me = await devSession('sleuth');
    const a = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'doctor' }) });
    expect(a.status).toBe(200);
    const first = (await a.json()) as { staging: { stagingId: string; seedCommit: string; act: number } };
    const b = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'doctor' }) });
    const same = (await b.json()) as { staging: { stagingId: string; seedCommit: string } };
    expect(same.staging.stagingId).toBe(first.staging.stagingId);
    expect(same.staging.seedCommit).toBe(first.staging.seedCommit);
    const c = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'doctor', restart: true }) });
    const fresh = (await c.json()) as { staging: { stagingId: string; seedCommit: string } };
    expect(fresh.staging.stagingId).toBe(first.staging.stagingId);
    expect(fresh.staging.seedCommit).not.toBe(first.staging.seedCommit);
  });

  it('refuses a night to somebody who is not signed in, and an unknown mystery to somebody who is', async () => {
    expect((await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST' })).status).toBe(401);
    const me = await devSession('nobody-in-particular');
    const r = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'a-mystery-nobody-wrote' }) });
    expect(r.status).toBe(404);
  });

  it('lists what can be staged without asking who you are', async () => {
    const r = await SELF.fetch('http://tables.test/mysteries');
    expect(r.status).toBe(200);
    const b = (await r.json()) as { titles: Array<{ id: string; roles: unknown[] }> };
    expect(b.titles[0]?.id).toBe('belvedere-snowfall');
    expect(b.titles[0]?.roles).toHaveLength(8);
  });

  it('opens with you in your part and the rest of the cast played by agents', async () => {
    const me = await devSession('understudy');
    const r = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'journalist', restart: true }) });
    const { staging } = (await r.json()) as { staging: { stagingId: string } };
    const read = await SELF.fetch(`http://tables.test/mysteries/${staging.stagingId}`, { headers: { authorization: `Bearer ${me.token}` } });
    const body = (await read.json()) as { view: { you: { role: string; secret: string }; cast: Array<{ role: string; operator: string }>; room: { id: string; props: unknown[] } } };
    expect(body.view.you.role).toBe('journalist');
    expect(body.view.you.secret.length).toBeGreaterThan(10);
    expect(body.view.cast.filter((c) => c.operator === 'agent')).toHaveLength(7);
    expect(body.view.room.id).toBe('lobby');
  });

  it('takes an action down the socket, refuses an illegal one in the game\'s own words, and holds the night', async () => {
    const me = await devSession('walker');
    const r = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'doctor', restart: true }) });
    const { staging } = (await r.json()) as { staging: { stagingId: string } };
    const s = await socket(staging.stagingId, me.token);
    s.send({ type: 'join' });
    await s.waitFor((m) => m.type === 'staging' && !!m.view);
    s.send({ type: 'act', action: { type: 'move', room: 'lounge' } });
    const moved = await s.waitFor((m) => m.type === 'staging' && m.view?.room?.id === 'lounge');
    expect(moved.view?.room?.id).toBe('lounge');
    s.send({ type: 'act', action: { type: 'move', room: 'ski-room' } });
    const refused = await s.waitFor((m) => m.type === 'error');
    expect(refused.message).toBeTruthy();
    s.send({ type: 'pause', on: true });
    const held = await s.waitFor((m) => m.type === 'staging' && m.staging?.paused === true);
    expect(held.staging?.paused).toBe(true);
    s.ws.close();
  });

  /**
   * A HOLD IS THE HOST'S (2026-09-16). Every socket could send `pause`, so any one of eight people could stop
   * the whole evening for the other seven and nobody could tell who had. A solo night's host is its owner, so
   * the person playing alone is unaffected; a passer-by watching the same night is refused by name.
   */
  it('refuses a hold from anybody who is not the host', async () => {
    const me = await devSession('the-host');
    const r = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'guide', restart: true }) });
    const { staging } = (await r.json()) as { staging: { stagingId: string } };
    const other = await devSession('a-watcher');
    const theirs = await socket(staging.stagingId, other.token);
    theirs.send({ type: 'join' });
    await theirs.waitFor((m) => m.type === 'staging');
    theirs.send({ type: 'pause', on: true });
    const refused = await theirs.waitFor((m) => m.type === 'error');
    expect(refused.message).toMatch(/host/i);
    theirs.ws.close();
    // and the host's own hold still lands
    const mine = await socket(staging.stagingId, me.token);
    mine.send({ type: 'join' });
    await mine.waitFor((m) => m.type === 'staging' && !!m.view);
    mine.send({ type: 'pause', on: true });
    const held = await mine.waitFor((m) => m.type === 'staging' && m.staging?.paused === true);
    expect(held.staging?.paused).toBe(true);
    mine.ws.close();
  });

  it('tells exactly one person that it was them, when they asked to be the one', async () => {
    const me = await devSession('suspect');
    const r = await SELF.fetch('http://tables.test/mysteries/solo', { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'chef', killer: 'me', restart: true }) });
    const { staging } = (await r.json()) as { staging: { stagingId: string } };
    const read = await SELF.fetch(`http://tables.test/mysteries/${staging.stagingId}`, { headers: { authorization: `Bearer ${me.token}` } });
    const body = (await read.json()) as { view: { you: { killer: boolean }; transcript: unknown[] } };
    // ASKED FOR, DRAWN UNDER THAT RULE, and said to them alone. A night left to chance is a night they
    // will usually spend solving one instead, which is the point of the default.
    expect(body.view.you.killer).toBe(true);
    // a stranger gets the public half and no part at all
    const other = await devSession('passer-by');
    const theirs = await SELF.fetch(`http://tables.test/mysteries/${staging.stagingId}`, { headers: { authorization: `Bearer ${other.token}` } });
    const tb = (await theirs.json()) as { view: { you: unknown; reveal: unknown } };
    expect(tb.view.you).toBeNull();
    expect(tb.view.reveal).toBeNull();
  });
});

describe('a club\'s mystery night', () => {
  it('refuses to plan one to somebody with no standing at the club', async () => {
    const me = await devSession('stranger-at-the-door');
    const r = await SELF.fetch('http://tables.test/clubs/0x00000000000000000000000000000000000000ff/mystery', {
      method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    // no club, or no standing in it: the same answer, because they are the same to somebody outside
    expect([403, 404]).toContain(r.status);
  });

  it('refuses a part and the curtain to somebody who is not signed in', async () => {
    const a = await SELF.fetch('http://tables.test/mysteries/whatever/cast', { method: 'POST' });
    expect(a.status).toBe(401);
    const b = await SELF.fetch('http://tables.test/mysteries/whatever/curtain', { method: 'POST' });
    expect(b.status).toBe(401);
  });
});

/**
 * NOBODY HERE, NOBODY ASKED.
 *
 * Every wake of the night's alarm may ask a character's agent for a line, and that agent is a language model
 * at somebody's Home. A night left open in a tab is therefore not idle — it is a hotel full of models talking
 * to each other, billed to whoever custodies them, with nobody reading a word. The clock and the cast run only
 * while a PERSON has done something inside the attention window; a ping is a tab proving it is still a tab.
 */
describe('a night nobody is at', () => {
  it('stops asking anybody once the attention window has passed, and starts again when somebody does something', async () => {
    const me = await devSession('nobody-here');
    const r = await SELF.fetch('http://tables.test/mysteries/solo', {
      method: 'POST',
      headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'belvedere-snowfall' }),
    });
    const { staging } = (await r.json()) as { staging: { stagingId: string } };
    const { env: testEnv, runInDurableObject } = await import('cloudflare:test');
    const ns = (testEnv as unknown as { STAGINGS: DurableObjectNamespace }).STAGINGS;
    const stub = ns.get(ns.idFromName(staging.stagingId));
    type Peek = { attended: () => boolean; heard: number };
    const attended = () => runInDurableObject(stub, async (o: unknown) => (o as Peek).attended());
    const age = (ms: number) => runInDurableObject(stub, async (o: unknown) => { (o as Peek).heard -= ms; });

    const s = await socket(staging.stagingId, me.token);
    s.send({ type: 'join' });
    await s.waitFor((m) => m.type === 'staging');
    expect(await attended()).toBe(true);

    // twenty minutes of nothing but heartbeats: the tab is open and the person is not
    await age(20 * 60_000 + 1);
    s.send({ type: 'ping' });
    await sleep(120);
    expect(await attended()).toBe(false);

    // …and a person saying something starts the night again
    s.send({ type: 'say', text: 'I am still here.' });
    await sleep(200);
    expect(await attended()).toBe(true);
    s.ws.close();
  });
});
