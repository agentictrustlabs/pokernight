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

  it('keeps the act request\'s data part first, with the answer shape beside it', () => {
    const parts = encodeAdviseParts(input);
    const act = encodeActParts(input)[0] as { data: Record<string, unknown> };
    const data = (parts[0] as { data: Record<string, unknown> }).data;
    expect(data.skill).toBe(act.data.skill);
    expect(data.input).toEqual(act.data.input);
    // The SHAPE rides in the data part because the thing that writes the answer at a Home reads the data,
    // not the text: an action that came back as `{"raise":10}` was one the card room could not use.
    expect((data.answer as { action: string }).action).toContain('{"type":"raise","amount":');
    expect((encodeAdviseParts({ ...input, skill: 'canasta.advise' })[0] as { data: { answer: { action: string } } }).data.answer.action).toContain('"take-pile"');
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
