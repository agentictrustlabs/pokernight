/**
 * THE REFERENCE ADVISER — three skills through one server, routed by the one that was named.
 *
 * What matters here is the routing and the boundaries, not the quality of the advice: a request that
 * means to ask a question must never fall through into taking somebody's turn, and an agent that was
 * asked to remember must not answer with a move.
 */
import { describe, expect, it } from 'vitest';
import { CANASTA_ADVISE_SKILL, CANASTA_REVIEW_SKILL } from '@pokernight/protocol';
import { createCanastaAdviseExecutor, createKeepsNothingExecutor, createRoutingExecutor } from '../src/advise-executor.js';
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

  it('sends a review or a record to the refusal — a house persona keeps nothing, and never to the mover', async () => {
    const seen: string[] = [];
    const r = createRoutingExecutor(persona, spy('act', seen) as never, spy('advise', seen) as never, spy('review', seen) as never);
    await r.execute(ctxWith([{ kind: 'data', data: { skill: CANASTA_REVIEW_SKILL, input: {} } }]));
    await r.execute(ctxWith([{ kind: 'data', data: { skill: 'canasta.record', input: {} } }]));
    expect(seen).toEqual(['review', 'review']);
  });

  it('treats an unnamed skill as the act skill, which is what every table sends today', async () => {
    const seen: string[] = [];
    const r = createRoutingExecutor(persona, spy('act', seen) as never, spy('advise', seen) as never, spy('review', seen) as never);
    await r.execute(ctxWith([{ kind: 'data', data: { input: {} } }]));
    expect(seen).toEqual(['act']);
  });
});

describe('a record or a review that reaches a house persona', () => {
  it('is refused by name — it keeps no hands and coaches nobody, and says whose the hand is', async () => {
    // The earlier reply said "noted" and kept nothing, which pretended to a shape it never filled. The
    // hand belongs in the seated person's own vault, recorded by their own agent; a review is their
    // question to the coach they named.
    let failed: string | null = null;
    const ctx = {
      message: { parts: [] },
      reply: async () => {},
      fail: async (parts: { text?: string }[]) => void (failed = parts[0]?.text ?? null),
    } as never;
    await createKeepsNothingExecutor(persona).execute(ctx);
    expect(String(failed)).toMatch(/keeps no hands/);
    expect(String(failed)).toMatch(/own agent/);
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
