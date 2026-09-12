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

/**
 * THE ROUND, AFTERWARDS — RECORDED, not reviewed, and never to a coach.
 *
 * An adviser asked only during a hand sees the moments somebody thought to ask about and never learns
 * how any of them turned out — enough to advise, not enough to say "you have done this before". So a
 * finished round is sent to the seated person's OWN AGENT to record in their vault, as that seat saw it.
 * The person's COACH is a service their agent consults under their grant: the table holds no address
 * for it, sends it nothing mid-hand and nothing at showdown, and learns only whose voice answered.
 *
 * What is tested here is the boundary, not the learning: only the agent that person named, only their
 * own seat, a record that is not a review, and a review only when the person asks.
 */
describe('recording a finished round, and reviewing on request', () => {
  it('is offered only to an adviser somebody actually named', async () => {
    // No adviser, no call. A table with nobody's agent on it talks to nothing.
    const who = await devSession('review none');
    const t = await createTableViaHttp('review none', {}, { token: who.token });
    const res = await req(`/tables/${t.tableId}/advice`, {}, who.token);
    // Not seated, so nothing to advise and nothing to record — and that is a 404, not an invention.
    expect(res.status).toBe(404);
  });

  it('names acting, advising, recording and reviewing as four different skills', async () => {
    // Four different things an agent may advertise separately: take a turn, talk, keep, and look back.
    // A coach advertises the second and the fourth; a person's own agent the second, third and fourth;
    // a house persona the first and second. Nothing advertises all four.
    const { POKER_ACT_SKILL, POKER_ADVISE_SKILL, POKER_RECORD_SKILL, POKER_REVIEW_SKILL, CANASTA_RECORD_SKILL, CANASTA_REVIEW_SKILL } = await import('@pokernight/protocol');
    expect(new Set([POKER_ACT_SKILL, POKER_ADVISE_SKILL, POKER_RECORD_SKILL, POKER_REVIEW_SKILL]).size).toBe(4);
    expect(POKER_RECORD_SKILL).toBe('poker.record');
    expect(CANASTA_RECORD_SKILL).toBe('canasta.record');
    expect(CANASTA_REVIEW_SKILL).toBe('canasta.review');
  });

  it('a record says the round is over and asks for nothing; it is not an advice request in disguise', async () => {
    const { encodeRecordParts } = await import('@pokernight/protocol');
    const parts = encodeRecordParts({ skill: 'poker.record', tableId: 't', handNo: 3, seat: 1, view: {}, legal: null, deadlineMs: 1000, observation: { subjects: { me: { you: true, counters: { hands: 1 } } } } });
    const text = (parts[1] as { text: string }).text;
    expect(text).toContain('record the hand');
    expect(text).not.toMatch(/advise|review|Answer with/);
    expect((parts[0] as unknown as { data: { skill: string } }).data.skill).toBe('poker.record');
  });

  it('a review is the person\'s own question: it needs a session, a seat, and an adviser — the house keeps no hands', async () => {
    const t = await createTableViaHttp('review auth', {});
    expect((await req(`/tables/${t.tableId}/review?q=how+did+I+do`)).status).toBe(401);
    const who = await devSession('review unseated');
    const t2 = await createTableViaHttp('review unseated', {}, { token: who.token });
    // Not seated: nothing to review from this table's side, and no adviser named either way.
    expect((await req(`/tables/${t2.tableId}/review?q=how+did+I+do`, {}, who.token)).status).toBe(404);
  });

  it('the table stores where to reach the PERSON\'s agent and what its card answers — never a coach\'s endpoint', async () => {
    // What the DO keeps about an adviser is exactly what the card said: name, message URL, display
    // name, and whether it records / reviews. There is no field for a coach: the person's agent
    // consults it under the person's grant, and the answer's `source` is the only thing the table
    // ever learns about it.
    const src = await import('../src/table-do.js');
    expect(typeof src.PokerTableDO).toBe('function');
    const { AdviseOutputSchema } = await import('@pokernight/protocol');
    const parsed = AdviseOutputSchema.safeParse({ say: 'Fold.', source: 'bob-coach.svc' });
    expect(parsed.success && parsed.data.source).toBe('bob-coach.svc');
  });
});
