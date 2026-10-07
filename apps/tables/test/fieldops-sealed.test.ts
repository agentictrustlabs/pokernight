// A SEALED SEASON IS PLAYED ONCE (`FIELDOPS_SEALED`): the parse the Worker, the object and the scenario list share.
import { describe, expect, it } from 'vitest';
import { fieldOpsSealed, type Env } from '../src/env.js';

const env = (v?: string) => ({ ...(v === undefined ? {} : { FIELDOPS_SEALED: v }) }) as unknown as Env;

describe('fieldOpsSealed', () => {
  it('nothing is sealed by default', () => {
    expect(fieldOpsSealed(env()).size).toBe(0);
    expect(fieldOpsSealed(env('')).size).toBe(0);
    expect(fieldOpsSealed(env(' , ')).size).toBe(0);
  });
  it('a scenario, with the one season everybody may look at', () => {
    const m = fieldOpsSealed(env('north-of-denver:6d76b03c-6930-4c94-9c39-dfc6782ce4f5'));
    expect(m.get('north-of-denver')).toEqual({ stagingId: '6d76b03c-6930-4c94-9c39-dfc6782ce4f5' });
    expect(m.has('another')).toBe(false);
  });
  it('a scenario sealed with no season named, and a season id that is not one', () => {
    expect(fieldOpsSealed(env('north-of-denver')).get('north-of-denver')).toEqual({ stagingId: null });
    expect(fieldOpsSealed(env('north-of-denver:not-a-staging')).get('north-of-denver')).toEqual({ stagingId: null });
  });
  it('several, untidily written', () => {
    const m = fieldOpsSealed(env(' a , b:6d76b03c-6930-4c94-9c39-dfc6782ce4f5 ,'));
    expect([...m.keys()]).toEqual(['a', 'b']);
  });
});
