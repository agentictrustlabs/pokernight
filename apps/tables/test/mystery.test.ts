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
