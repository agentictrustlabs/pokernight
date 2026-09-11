/**
 * WHOSE ADVICE IS THIS?
 *
 * The card room's coach is one strategy, the same for everybody. A person's own agent carries THEIR
 * style, written as their own artifacts somewhere this card room never reaches — so the app's whole
 * part is to ask the right agent and to say whose answer it is showing.
 *
 * What is worth testing is therefore not the advice (the card room has no standing to judge it) but
 * the boundaries: an adviser is named per PERSON, it is refused unless it advertises the skill, an
 * agent that only talks is never handed a turn, and a partner that cannot be reached does not leave
 * somebody mid-hand with nothing — nor quietly pass the house's answer off as theirs.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createTableViaHttp, devSession, engineReady } from './helpers.js';

async function req(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return SELF.fetch(`http://tables.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
}

describe('naming the agent that advises you', () => {
  it('needs a session — an adviser is somebody’s own', async () => {
    const t = await createTableViaHttp('adviser auth', {});
    expect((await req(`/tables/${t.tableId}/adviser`, { method: 'POST', body: JSON.stringify({ agentName: 'x.me' }) })).status).toBe(401);
  });

  it('asks for a name rather than guessing', async () => {
    const who = await devSession('adviser namer');
    const t = await createTableViaHttp('adviser name', {}, { token: who.token });
    const res = await req(`/tables/${t.tableId}/adviser`, { method: 'POST', body: JSON.stringify({}) }, who.token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/name the agent/i);
  });

  it('refuses an agent that does not advertise the ADVISE skill', async () => {
    // Deliberately separate from `*.act`: an agent that only ever meant to talk must never be handed
    // a turn, and one that cannot answer must not be discovered mid-hand.
    const who = await devSession('adviser skill');
    const t = await createTableViaHttp('adviser skill', {}, { token: who.token });
    const res = await req(
      `/tables/${t.tableId}/adviser`,
      { method: 'POST', body: JSON.stringify({ agentName: 'nobody.me' }) },
      who.token,
    );
    // Either unreachable or missing the skill — both are refusals with a reason, never a silent accept.
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
  });
});

describe('the advice a table gives back', () => {
  it.skipIf(!engineReady)('says the HOUSE is speaking when nobody has named an adviser', async () => {
    // The honesty that matters: whose answer this is, always stated.
    const who = await devSession('house advice');
    const t = await createTableViaHttp('house advice', {}, { token: who.token });
    const res = await req(`/tables/${t.tableId}/advice`, {}, who.token);
    // Not seated yet, so there is nothing to advise — and that is a 404, not a pretend answer.
    expect(res.status).toBe(404);
  });

  it('refuses advice to somebody with no session at all', async () => {
    const t = await createTableViaHttp('advice auth', {});
    expect((await req(`/tables/${t.tableId}/advice`)).status).toBe(401);
  });
});
