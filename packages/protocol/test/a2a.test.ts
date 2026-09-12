/**
 * The A2A turn and advice requests, as message parts.
 */
import { describe, expect, it } from 'vitest';
import { AdviseOutputSchema, decodeAdviseReply, decodeReviewReply, encodeActParts, encodeAdviseParts, encodeRecordParts, encodeReviewParts } from '../src/index.js';

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

describe('the record, in words as well as in data', () => {
  const round = {
    skill: 'poker.record',
    tableId: 't',
    handNo: 7,
    seat: 2,
    view: { handNo: 7, seats: [] },
    legal: null,
    deadlineMs: 5000,
    observation: { game: 'poker', round: 7, subjects: { me: { you: true, counters: { hands: 1 } }, 'agent:sharkbot.svc': { label: 'Sharkbot', counters: { hands: 1, pfr: 1 } } } },
  };

  it('carries the observation in the data part, and says the round is over rather than asking for a move', () => {
    const parts = encodeRecordParts(round);
    const data = (parts[0] as { data: { skill: string; input: { observation: unknown } } }).data;
    expect(data.skill).toBe('poker.record');
    expect(data.input.observation).toEqual(round.observation);
    const text = (parts[1] as { kind: 'text'; text: string }).text;
    expect(text).toContain('round 7 at poker is over');
    expect(text).toContain('record the hand');
    expect(text).toContain('2 players');
    expect(text).not.toMatch(/advise|review|Answer with/);
  });

  it('is still a record with nothing counted', () => {
    const { observation: _o, ...bare } = round;
    const text = (encodeRecordParts(bare)[1] as { kind: 'text'; text: string }).text;
    expect(text).toContain('final view');
  });
});

describe('the review — the person\'s own question, and the coach\'s answer', () => {
  it('carries the question and no hand: the coach reads the recorded ones', () => {
    const parts = encodeReviewParts({ skill: 'poker.review', tableId: 't', seat: 2, question: 'how did Thursday go?' });
    const data = (parts[0] as { data: { skill: string; input: Record<string, unknown> } }).data;
    expect(data.skill).toBe('poker.review');
    expect(data.input).toEqual({ tableId: 't', seat: 2, question: 'how did Thursday go?' });
    expect(Object.keys(data.input)).not.toContain('view');
    expect((parts[1] as { text: string }).text).toBe('poker.review: how did Thursday go?');
    expect((encodeReviewParts({ skill: 'poker.review', tableId: 't', seat: 0, question: '  ' })[1] as { text: string }).text).toContain('How have I been playing?');
  });

  it('decodes a review with the room a review needs, and advice names its source when the agent consulted a coach', () => {
    const long = 'Thursday: 41 hands, down 60. '.repeat(30);
    expect(decodeReviewReply([{ kind: 'text', text: JSON.stringify({ say: long, because: 'Fold the blinds to a raise.', source: 'bob-coach.svc' }) }])).toEqual({ say: long, because: 'Fold the blinds to a raise.', source: 'bob-coach.svc' });
    expect(decodeAdviseReply([{ kind: 'text', text: JSON.stringify({ say: 'Fold.', because: '43% for 18%.', action: { type: 'fold' }, source: 'bob-coach.svc' }) }])).toEqual({ say: 'Fold.', because: '43% for 18%.', action: { type: 'fold' }, source: 'bob-coach.svc' });
    // Advice is still one sentence: a review-length `say` is not advice.
    expect(AdviseOutputSchema.safeParse({ say: long }).success).toBe(false);
  });
});
