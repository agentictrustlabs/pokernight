/**
 * THE REFERENCE ADVISER — three skills through one server, routed by the one that was named.
 *
 * What matters here is the routing and the boundaries, not the quality of the advice: a request that
 * means to ask a question must never fall through into taking somebody's turn, and an agent that was
 * asked to remember must not answer with a move.
 */
import { describe, expect, it } from 'vitest';
import { CANASTA_ADVISE_SKILL, CANASTA_REVIEW_SKILL } from '@pokernight/protocol';
import { createCanastaAdviseExecutor, createReviewExecutor, createRoutingExecutor } from '../src/advise-executor.js';
import { PERSONAS } from '../src/personas.js';

const persona = PERSONAS.find((p) => p.agentName.includes('pile') || p.game === 'canasta') ?? PERSONAS[0]!;

/** A minimal executor that records it was reached. */
const spy = (name: string, seen: string[]) => ({ execute: async () => void seen.push(name) });

function ctxWith(parts: unknown[]): never {
  return { message: { parts }, reply: async () => {}, fail: async () => {} } as never;
}

describe('routing by the skill that was named', () => {
  it('sends an advice request to the adviser, never to the mover', async () => {
    const seen: string[] = [];
    const r = createRoutingExecutor(persona, spy('act', seen) as never, spy('advise', seen) as never, spy('review', seen) as never);
    await r.execute(ctxWith([{ kind: 'data', data: { skill: CANASTA_ADVISE_SKILL, input: {} } }]));
    expect(seen).toEqual(['advise']);
  });

  it('sends a review to the one that remembers', async () => {
    const seen: string[] = [];
    const r = createRoutingExecutor(persona, spy('act', seen) as never, spy('advise', seen) as never, spy('review', seen) as never);
    await r.execute(ctxWith([{ kind: 'data', data: { skill: CANASTA_REVIEW_SKILL, input: {} } }]));
    expect(seen).toEqual(['review']);
  });

  it('treats an unnamed skill as the act skill, which is what every table sends today', async () => {
    const seen: string[] = [];
    const r = createRoutingExecutor(persona, spy('act', seen) as never, spy('advise', seen) as never, spy('review', seen) as never);
    await r.execute(ctxWith([{ kind: 'data', data: { input: {} } }]));
    expect(seen).toEqual(['act']);
  });
});

describe('a review', () => {
  it('acknowledges and says plainly that it kept nothing', async () => {
    // A reference implementation claiming a memory it does not have would be the one misleading thing
    // in an otherwise exact example.
    let said: Record<string, unknown> | null = null;
    const ctx = {
      message: { parts: [] },
      reply: async (parts: { data?: Record<string, unknown> }[]) => void (said = parts[0]?.data ?? null),
      fail: async () => {},
    } as never;
    await createReviewExecutor(persona, CANASTA_REVIEW_SKILL).execute(ctx);
    expect(said).toMatchObject({ noted: true, skill: CANASTA_REVIEW_SKILL });
    expect(String((said as unknown as { note: string }).note)).toMatch(/keeps no memory/i);
  });
});

describe('advice on a malformed request', () => {
  it('complains rather than guessing a move', async () => {
    let failed = false;
    const ctx = { message: { parts: [] }, reply: async () => {}, fail: async () => void (failed = true) } as never;
    await createCanastaAdviseExecutor(persona).execute(ctx);
    expect(failed).toBe(true);
  });
});
