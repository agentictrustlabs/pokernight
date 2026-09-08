/**
 * THE GUARANTEE: whatever comes out of `poker.act` is legal per the `legal` record that went in.
 *
 * 200 randomized turns, every persona, including deliberately hostile `legal` records (folding not
 * allowed, only an all-in, an inverted raise range, no hand at all). The seed is printed on failure so
 * a bad fixture can be replayed exactly.
 */

import { describe, expect, it } from 'vitest';
import { isLegal } from '@pokernight/agent-kit';
import { PokerActOutputSchema, encodePokerActParts } from '@pokernight/protocol';
import { PERSONAS, type Persona } from '../src/personas.js';
import { ensureLegal, safeDefault } from '../src/executor.js';
import { randomInput, runExecutor, seededRng } from './fixtures.js';

const FIXTURES = 200;

describe('legality', () => {
  it(`always answers with a legal action across ${FIXTURES} randomized turns`, async () => {
    const gen = seededRng(0xc0ffee);
    for (let i = 0; i < FIXTURES; i++) {
      const input = randomInput(gen);
      const persona: Persona = PERSONAS[i % PERSONAS.length]!;
      const seed = `fixture ${i} / ${persona.agentName}`;
      const { replied, failed } = await runExecutor(persona, encodePokerActParts(input), undefined, seededRng(i + 1));

      expect(failed, `${seed}: a well-formed request must not fail`).toBeNull();
      expect(replied, `${seed}: no reply`).not.toBeNull();
      const part = (replied ?? [])[0] as { kind?: string; data?: unknown } | undefined;
      expect(part?.kind, seed).toBe('data');

      const parsed = PokerActOutputSchema.safeParse(part?.data);
      expect(parsed.success, `${seed}: ${JSON.stringify(part?.data)}`).toBe(true);
      if (!parsed.success) continue;
      expect(isLegal(parsed.data.action, input.legal), `${seed}: ${JSON.stringify(parsed.data.action)} vs ${JSON.stringify(input.legal)}`).toBe(true);
    }
  });

  it('never leaks another seat’s hole cards into the reply', async () => {
    const gen = seededRng(7);
    for (let i = 0; i < 20; i++) {
      const input = randomInput(gen);
      const { replied } = await runExecutor(PERSONAS[i % PERSONAS.length]!, encodePokerActParts(input), undefined, seededRng(i));
      const body = JSON.stringify(replied);
      expect(Object.keys(JSON.parse(body)[0].data).sort()).toEqual(expect.arrayContaining(['action']));
      expect(body.length).toBeLessThan(600);
    }
  });
});

describe('ensureLegal', () => {
  const gen = seededRng(99);

  it('snaps anything, including nonsense, into the legal set', async () => {
    for (let i = 0; i < 50; i++) {
      const input = randomInput(gen);
      const nonsense = [
        { type: 'raise' as const, amount: 10 ** 9 },
        { type: 'bet' as const, amount: -5 },
        { type: 'all-in' as const },
        { type: 'call' as const },
        { type: 'check' as const },
        { type: 'fold' as const },
      ];
      for (const desired of nonsense) {
        const action = ensureLegal(desired, input.view, input.legal);
        expect(isLegal(action, input.legal), `${JSON.stringify(desired)} -> ${JSON.stringify(action)}`).toBe(true);
      }
    }
  });

  it('defaults to check when it is free and fold when it is not', () => {
    const base = { fold: true, check: false, call: null, bet: null, raise: null, allIn: 0 };
    expect(safeDefault({ ...base, check: true })).toEqual({ type: 'check' });
    expect(safeDefault(base)).toEqual({ type: 'fold' });
    expect(safeDefault({ ...base, fold: false, call: 10 })).toEqual({ type: 'call' });
    expect(safeDefault({ ...base, fold: false, allIn: 50 })).toEqual({ type: 'all-in' });
  });
});
