/**
 * FIELD OPERATIONS (docs/FIELD-OPERATIONS.md): a season hosted exactly as a commission night is. A solo season is
 * derived from its owner, opens with one person in a part and fifteen played by the house (no cast is chartered in
 * the test deployment), and the socket carries the part's view — where it stands, what it may do today, the board
 * with the registry's floor — and never the hidden readiness. The agent report rides every view.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { devSession, sleep } from './helpers.js';

interface Down {
  type: string;
  view?: { you?: { role: string; kind: string; town: string; may: Array<{ action: string }> }; cast?: Array<{ role: string; operator: string; mind?: string }>; day?: number; phase?: string; communities?: Array<{ id: string; registry: { phase: number }; derived: number; iri: string }>; bodies?: unknown[]; reveal?: unknown } | null;
  staging?: { stagingId: string; paused: boolean; day: number; estate: unknown; graph: unknown } | null;
  agents?: unknown[];
  code?: string; message?: string;
}

async function socket(stagingId: string, token: string) {
  const res = await SELF.fetch(`http://tables.test/fieldops/${stagingId}/ws?token=${token}`, { headers: { upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no socket: ${res.status}`);
  ws.accept();
  const log: Down[] = [];
  ws.addEventListener('message', (e) => log.push(JSON.parse(String(e.data)) as Down));
  ws.send(JSON.stringify({ type: 'join' }));
  const waitFor = async (pred: (m: Down) => boolean, tries = 40) => {
    for (let i = 0; i < tries; i++) { const m = log.find(pred); if (m) return m; await sleep(50); }
    throw new Error(`nothing matched; saw ${log.map((m) => `${m.type}${m.code ? ':' + m.code : ''}`).join(',')}`);
  };
  return { ws, log, waitFor, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}
const post = (path: string, token: string, body: unknown) =>
  SELF.fetch(`http://tables.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('a season of your own north of Denver', () => {
  it('lists what can be staged: one season, twelve communities with the registry’s phase on each', async () => {
    const r = await SELF.fetch('http://tables.test/fieldops');
    expect(r.status).toBe(200);
    const b = (await r.json()) as { scenarios: Array<{ id: string; roles: unknown[]; teams: unknown[]; communities: Array<{ phase: number; iri: string }>; registryReadAt: string }> };
    expect(b.scenarios.map((s) => s.id)).toEqual(['north-of-denver']);
    expect(b.scenarios[0]?.roles).toHaveLength(16);
    expect(b.scenarios[0]?.teams).toHaveLength(4);
    expect(b.scenarios[0]?.communities).toHaveLength(12);
    expect(b.scenarios[0]?.communities.every((c) => c.iri.startsWith('https://graph.global.church/community/'))).toBe(true);
    expect(b.scenarios[0]?.registryReadAt).toMatch(/^\d{4}-/);
  });

  it('is the same season when you ask twice, and a new one when you ask for another', async () => {
    const me = await devSession('a-worker');
    const first = (await (await post('/fieldops/solo', me.token, { role: 'naomi' })).json()) as { staging: { stagingId: string; seedCommit: string } };
    const same = (await (await post('/fieldops/solo', me.token, { role: 'naomi' })).json()) as { staging: { stagingId: string; seedCommit: string } };
    expect(same.staging.stagingId).toBe(first.staging.stagingId);
    expect(same.staging.seedCommit).toBe(first.staging.seedCommit);
    const fresh = (await (await post('/fieldops/solo', me.token, { role: 'naomi', restart: true })).json()) as { staging: { stagingId: string; seedCommit: string } };
    expect(fresh.staging.seedCommit).not.toBe(first.staging.seedCommit);
  });

  it('refuses a season to somebody not signed in, and an unknown scenario to somebody who is', async () => {
    expect((await SELF.fetch('http://tables.test/fieldops/solo', { method: 'POST' })).status).toBe(401);
    const me = await devSession('nobody');
    expect((await post('/fieldops/solo', me.token, { scenario: 'a-season-nobody-wrote' })).status).toBe(404);
  });

  it('opens with you in your part and the rest played by the house; the socket carries your day and never the readiness', async () => {
    const me = await devSession('naomi-player');
    const { staging } = (await (await post('/fieldops/solo', me.token, { role: 'naomi', restart: true, pace: 'short' })).json()) as { staging: { stagingId: string } };
    const s = await socket(staging.stagingId, me.token);
    const m = await s.waitFor((x) => x.type === 'staging' && !!x.view);
    expect(m.view?.you?.role).toBe('naomi');
    expect(m.view?.you?.kind).toBe('worker');
    expect(m.view?.you?.town).toBe('greeley');
    // NOTHING IS A TEAM AND NOBODY HAS TAKEN A PEOPLE UP: the first day offers founding a team, not visiting anybody.
    expect(m.view?.you?.may.map((x) => x.action)).toEqual(expect.arrayContaining(['found-team', 'move', 'rest']));
    expect(m.view?.you?.may.map((x) => x.action)).not.toContain('visit');
    expect((m.view as { teams?: unknown[] } | null)?.teams).toEqual([]);
    expect(m.view?.cast?.filter((c) => c.operator === 'agent')).toHaveLength(15);
    expect(m.view?.cast?.every((c) => c.operator === 'human' || c.mind === 'rules')).toBe(true);
    expect(m.view?.reveal ?? null).toBeNull();
    expect(JSON.stringify(m.view)).not.toContain('readiness');
    expect(m.view?.communities?.find((c) => c.id === 'burmese-weld')?.registry.phase).toBe(1);
    expect(m.view?.communities?.find((c) => c.id === 'burmese-weld')?.derived).toBe(1);
    expect(Array.isArray(m.agents)).toBe(true);
    // No estate note in the test deployment: the summary says nothing has been written, rather than pretending.
    expect(m.staging?.estate ?? null).toBeNull();
    s.ws.close();
  });

  it('opens as a watcher with every part played by an agent or the house, no part of your own, and takes attention from the page', async () => {
    const me = await devSession('a-watcher');
    const { staging } = (await (await post('/fieldops/solo', me.token, { role: 'watch', restart: true, pace: 'short' })).json()) as { staging: { stagingId: string; role: string } };
    expect(staging.role).toBe('watch');
    const s = await socket(staging.stagingId, me.token);
    const m = await s.waitFor((x) => x.type === 'staging' && !!x.view);
    expect(m.view?.you ?? null).toBeNull();
    expect(m.view?.cast).toHaveLength(16);
    expect(m.view?.cast?.every((c) => c.operator === 'agent')).toBe(true);
    s.send({ type: 'attend' });
    s.send({ type: 'act', action: { type: 'rest' } });
    const refused = await s.waitFor((x) => x.type === 'error');
    expect(refused.code).toBe('watching');
    // Asking again without a part keeps the same watched season.
    const same = (await (await post('/fieldops/solo', me.token, { role: 'watch' })).json()) as { staging: { stagingId: string; seedCommit: string } };
    expect(same.staging.stagingId).toBe(staging.stagingId);
    s.ws.close();
  });

  it('takes an act down the socket, refuses a second one the same day, and refuses a verb the engine does not know', async () => {
    const me = await devSession('yusuf-player');
    const { staging } = (await (await post('/fieldops/solo', me.token, { role: 'yusuf', restart: true })).json()) as { staging: { stagingId: string } };
    const s = await socket(staging.stagingId, me.token);
    await s.waitFor((x) => x.type === 'staging' && !!x.view);
    // BOOTSTRAP FIRST: found a team where you stand (a day's act), take the people up (free) — the charter of the team
    // agent is queued, and in the test deployment it fails honestly for want of an estate note.
    s.send({ type: 'act', action: { type: 'found-team', name: 'Weld Corridor Team', invite: ['naomi', 'carla'], plan: 'weld-team' } });
    const founded = await s.waitFor((x) => x.type === 'staging' && !!x.view && ((x.view as { teams?: Array<{ id: string; steward: string; agent: string | null }> }).teams?.length ?? 0) === 1);
    const team = (founded.view as { teams: Array<{ id: string; steward: string; agent: string | null; invited: string[] }> }).teams[0]!;
    expect(team.steward).toBe('yusuf'); expect(team.agent).toBeNull(); expect(team.invited).toEqual(['naomi', 'carla']);
    s.send({ type: 'act', action: { type: 'adopt', communities: ['somali-bantus-weld'] } });
    await s.waitFor((x) => x.type === 'staging' && !!x.view && (x.view as { communities?: Array<{ id: string; workedBy: string | null }> }).communities?.find((c) => c.id === 'somali-bantus-weld')?.workedBy === team.id);
    s.send({ type: 'act', action: { type: 'visit', community: 'somali-bantus-weld' } });
    const spentByFounding = await s.waitFor((x) => x.type === 'error' && x.code === 'spent');
    expect(spentByFounding.message).toMatch(/spent today/);
    s.send({ type: 'act', action: { type: 'share', community: 'somali-bantus-weld' } });
    const spent = await s.waitFor((x) => x.type === 'error' && x.code === 'spent');
    expect(spent.message).toMatch(/spent today/);
    s.send({ type: 'act', action: { type: 'teleport' } });
    const bad = await s.waitFor((x) => x.type === 'error' && x.code === 'bad-action');
    expect(bad.code).toBe('bad-action');
    s.ws.close();
  });

  it('a club’s season is set up by the host, cast by members, and opened by the host; the field is written to nobody without an estate note', async () => {
    // The club door is exercised by the commission tests with a stubbed Home; here the solo season proves the estate
    // route refuses a stranger and answers the host honestly.
    const me = await devSession('host-player');
    const { staging } = (await (await post('/fieldops/solo', me.token, { role: 'sam', restart: true })).json()) as { staging: { stagingId: string } };
    const other = await devSession('somebody-else');
    expect((await post(`/fieldops/${staging.stagingId}/estate`, other.token, {})).status).toBe(403);
    const r = await post(`/fieldops/${staging.stagingId}/estate`, me.token, {});
    expect(r.status).toBe(400);
    const b = (await r.json()) as { ok: boolean; report: { failures: string[] } };
    expect(b.ok).toBe(false);
    expect(b.report.failures[0]).toMatch(/no estate note/);
  });
});
