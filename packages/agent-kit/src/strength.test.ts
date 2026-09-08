import { describe, expect, it } from 'vitest';
import type { Card } from '@pokernight/engine';
import { madeAtLeast, postflopStrength } from './strength.js';
import { fakeEvaluate } from './test-helpers.js';

const s = (hole: Card[], board: Card[]) => postflopStrength(hole, board, fakeEvaluate);

describe('postflopStrength (fake evaluator)', () => {
  it('nothing on a dry miss', () => {
    const r = s(['As', 'Kd'], ['2c', '7h', '9d']);
    expect(r.made).toBe('nothing');
    expect(r.draws).toEqual({ flush: false, openEnded: false, gutshot: false });
    expect(r.rank.category).toBe('high-card');
  });

  it('top pair, second pair, overpair, underpair', () => {
    expect(s(['As', 'Kd'], ['Ac', '7h', '9d']).made).toBe('top-pair');
    expect(s(['As', '9d'], ['Kc', '7h', '9h']).made).toBe('pair');
    expect(s(['Qs', 'Qd'], ['Jc', '7h', '2d']).made).toBe('overpair');
    expect(s(['5s', '5d'], ['Jc', '7h', '2d']).made).toBe('pair');
  });

  it('paired board without our involvement is nothing', () => {
    expect(s(['As', 'Kd'], ['7c', '7h', '9d']).made).toBe('nothing');
    expect(s(['As', 'Kd'], ['7c', '7h', '9d', '9s']).made).toBe('nothing');
  });

  it('two pair, set, trips', () => {
    expect(s(['As', 'Kd'], ['Ac', 'Kh', '9d']).made).toBe('two-pair');
    expect(s(['9s', '9d'], ['Ac', 'Kh', '9c']).made).toBe('set');
    expect(s(['As', '9d'], ['9c', 'Kh', '9h']).made).toBe('set');
    // Top pair with a paired board is still top pair, not two pair.
    expect(s(['As', 'Kd'], ['Ac', '7h', '7d']).made).toBe('top-pair');
  });

  it('straight, flush, full house, quads, straight flush', () => {
    expect(s(['Ts', 'Jd'], ['7c', '8h', '9d']).made).toBe('straight');
    expect(s(['As', '2s'], ['7s', '8s', 'Ks']).made).toBe('flush');
    expect(s(['9s', '9d'], ['9c', 'Kh', 'Kd']).made).toBe('full');
    expect(s(['9s', '9d'], ['9c', '9h', 'Kd']).made).toBe('quads');
    expect(s(['Ts', 'Js'], ['7s', '8s', '9s']).made).toBe('straight-flush');
  });

  it('flush draw and straight draws', () => {
    const fd = s(['As', '2s'], ['7s', '8s', 'Kd']);
    expect(fd.draws.flush).toBe(true);
    expect(fd.outs).toBeGreaterThanOrEqual(9);

    const oesd = s(['Ts', 'Jd'], ['8c', '9h', '2d']);
    expect(oesd.draws.openEnded).toBe(true);
    expect(oesd.draws.gutshot).toBe(false);

    const gut = s(['Ts', 'Jd'], ['7c', '9h', '2d']);
    expect(gut.draws.gutshot).toBe(true);
    expect(gut.draws.openEnded).toBe(false);

    // Draw entirely on the board does not count.
    const boardDraw = s(['As', '2d'], ['7c', '8h', '9d', 'Td']);
    expect(boardDraw.draws.openEnded).toBe(false);
    expect(boardDraw.draws.gutshot).toBe(false);
  });

  it('no draws on the river or when already made', () => {
    expect(s(['As', '2s'], ['7s', '8s', 'Kd', '3c', '4h']).draws.flush).toBe(false);
    expect(s(['Ts', 'Jd'], ['7c', '8h', '9d']).draws.openEnded).toBe(false);
  });

  it('madeAtLeast ordering', () => {
    expect(madeAtLeast('set', 'two-pair')).toBe(true);
    expect(madeAtLeast('pair', 'top-pair')).toBe(false);
    expect(madeAtLeast('top-pair', 'top-pair')).toBe(true);
  });

  it('rejects bad boards', () => {
    expect(() => s(['As', 'Kd'], ['2c'])).toThrow();
    expect(() => s(['As'], ['2c', '3c', '4c'])).toThrow();
  });
});
