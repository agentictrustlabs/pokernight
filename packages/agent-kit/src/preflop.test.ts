import { describe, expect, it } from 'vitest';
import type { Card } from '@pokernight/engine';
import { classifyPreflop, preflopDecision, strengthOf } from './preflop.js';

describe('classifyPreflop', () => {
  it('labels and shapes', () => {
    expect(classifyPreflop(['As', 'Ad'])).toMatchObject({ shape: 'pair', label: 'AA', gap: 0 });
    expect(classifyPreflop(['Ks', 'As'])).toMatchObject({ shape: 'suited', label: 'AKs', high: 'A', low: 'K', gap: 0 });
    expect(classifyPreflop(['2d', '7c'])).toMatchObject({ shape: 'offsuit', label: '72o', gap: 4 });
    expect(classifyPreflop(['Th', 'Jh'])).toMatchObject({ shape: 'suited', label: 'JTs', gap: 0 });
    expect(classifyPreflop(['9c', 'Jd'])).toMatchObject({ shape: 'offsuit', label: 'J9o', gap: 1 });
  });

  it('Chen strengths', () => {
    expect(strengthOf('AA')).toBe(20);
    expect(strengthOf('KK')).toBe(16);
    expect(strengthOf('QQ')).toBe(14);
    expect(strengthOf('JJ')).toBe(12);
    expect(strengthOf('AKs')).toBe(12);
    expect(strengthOf('AKo')).toBe(10);
    expect(strengthOf('JTs')).toBe(9);
    expect(strengthOf('T9s')).toBe(8);
    expect(strengthOf('76s')).toBe(7);
    expect(strengthOf('22')).toBe(5);
    expect(strengthOf('72o')).toBe(0);
    expect(strengthOf('A5s')).toBe(7);
    expect(strengthOf('KQo')).toBe(8);
  });

  it('rejects bad input', () => {
    expect(() => classifyPreflop(['As'])).toThrow();
    expect(() => classifyPreflop(['Xs' as Card, 'Ad'])).toThrow();
  });
});

describe('preflopDecision', () => {
  const h = (label: string) => {
    const high = label[0]!;
    const low = label[1]!;
    const suited = label[2] === 's';
    return classifyPreflop((high === low ? [`${high}s`, `${low}h`] : [`${high}s`, `${low}${suited ? 's' : 'h'}`]) as Card[]);
  };

  it('opens premiums from any position and folds junk', () => {
    expect(preflopDecision(h('AA'), { position: 'early', tableSize: 'fullring', facing: 'none' })).toBe('raise');
    expect(preflopDecision(h('72o'), { position: 'late', tableSize: '6max', facing: 'none' })).toBe('fold');
    expect(preflopDecision(h('72o'), { position: 'blinds', tableSize: '6max', facing: 'limp', freeCheck: true })).toBe('call');
  });

  it('is looser in late position and at 6-max', () => {
    expect(preflopDecision(h('T9s'), { position: 'early', tableSize: 'fullring', facing: 'none' })).toBe('fold');
    expect(preflopDecision(h('T9s'), { position: 'late', tableSize: 'fullring', facing: 'none' })).toBe('raise');
    expect(preflopDecision(h('T9s'), { position: 'middle', tableSize: '6max', facing: 'none' })).toBe('raise');
    expect(preflopDecision(h('T9s'), { position: 'middle', tableSize: 'fullring', facing: 'none' })).toBe('fold');
  });

  it('3-bets premiums, calls medium hands, set-mines small pairs, folds junk to a raise', () => {
    expect(preflopDecision(h('QQ'), { position: 'middle', tableSize: '6max', facing: 'raise', toCallBB: 3 })).toBe('raise');
    expect(preflopDecision(h('AKo'), { position: 'blinds', tableSize: '6max', facing: 'raise', toCallBB: 3 })).toBe('raise');
    expect(preflopDecision(h('KQs'), { position: 'late', tableSize: '6max', facing: 'raise', toCallBB: 3 })).toBe('call');
    expect(preflopDecision(h('22'), { position: 'late', tableSize: '6max', facing: 'raise', toCallBB: 3, effectiveBB: 100 })).toBe('call');
    expect(preflopDecision(h('22'), { position: 'late', tableSize: '6max', facing: 'raise', toCallBB: 3, effectiveBB: 20 })).toBe('fold');
    expect(preflopDecision(h('72o'), { position: 'late', tableSize: '6max', facing: 'raise', toCallBB: 3 })).toBe('fold');
  });

  it('against a 3-bet: 4-bet QQ+/AK, call JJ/TT/AQs, fold the rest', () => {
    expect(preflopDecision(h('KK'), { position: 'late', tableSize: '6max', facing: '3bet', toCallBB: 10 })).toBe('raise');
    expect(preflopDecision(h('JJ'), { position: 'late', tableSize: '6max', facing: '3bet', toCallBB: 10, effectiveBB: 100 })).toBe('call');
    expect(preflopDecision(h('A5s'), { position: 'late', tableSize: '6max', facing: '3bet', toCallBB: 10 })).toBe('fold');
  });
});
