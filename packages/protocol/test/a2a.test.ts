/**
 * The A2A turn and advice requests, as message parts.
 */
import { describe, expect, it } from 'vitest';
import { encodeActParts, encodeAdviseParts } from '../src/index.js';

describe('the advice request, in words as well as in data', () => {
  const input = {
    skill: 'poker.advise',
    tableId: 't',
    handNo: 7,
    seat: 2,
    view: { handNo: 7, seats: [] },
    legal: { fold: true, check: true, call: null, bet: null, raise: null, allIn: 10 },
    deadlineMs: 5000,
    question: 'should I bluff here?',
  };

  it('keeps the data part exactly as the act request has it, first', () => {
    const parts = encodeAdviseParts(input);
    expect(parts[0]).toEqual(encodeActParts(input)[0]);
  });

  it('adds a text part a conversational agent can reason from', () => {
    // A person's own agent at their Home is handed the message's TEXT; a data part alone arrives as
    // "the message carried no text".
    const text = (encodeAdviseParts(input)[1] as { kind: 'text'; text: string }).text;
    expect(text).toContain('poker.advise');
    expect(text).toContain('seat 2');
    expect(text).toContain('should I bluff here?');
    expect(text).toContain('"say"');
    expect(text).toContain('"because"');
    expect(text).toContain('"allIn":10');
  });

  it('says so when nothing was asked, rather than quoting an empty question', () => {
    const text = (encodeAdviseParts({ ...input, question: undefined })[1] as { kind: 'text'; text: string }).text;
    expect(text).toContain('Nothing was asked');
    expect(text).not.toContain('""');
  });
});
