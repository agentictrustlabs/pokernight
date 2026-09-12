/**
 * What the rolling list keeps, and what it is allowed to forget.
 */
import { describe, expect, it } from 'vitest';
import { KEEP, forRound, remember, whoSaid, type Recommendation } from './recommendations';

const house = { say: 'Draw from the stock.', because: 'The pile is frozen.', source: 'house' as const };
const mine = { say: 'Take the pile.', because: 'It opens us.', source: { agent: 'carol.me', displayName: 'Carol’s agent' } };

describe('remembering advice', () => {
  it('keeps it newest first, so somebody reads from the top and stops', () => {
    let list: Recommendation[] = [];
    list = remember(list, house, 1);
    list = remember(list, mine, 1);
    expect(list.map((r) => r.say)).toEqual(['Take the pile.', 'Draw from the stock.']);
  });

  it('counts the SAME advice asked twice as one entry', () => {
    // A coach asked again mid-turn answers the same thing; a list that grew each time would bury the
    // turn before under four copies of this one.
    let list = remember([], house, 1);
    list = remember(list, house, 1);
    list = remember(list, house, 1);
    expect(list).toHaveLength(1);
  });

  it('treats the same words in a NEW round as new — a deal changes what they mean', () => {
    let list = remember([], house, 1);
    list = remember(list, house, 2);
    expect(list).toHaveLength(2);
  });

  it('treats the same words from a DIFFERENT adviser as new', () => {
    // The house and somebody's own agent are not the same voice, even saying the same sentence.
    let list = remember([], { ...house, say: 'Take the pile.' }, 1);
    list = remember(list, mine, 1);
    expect(list).toHaveLength(2);
  });

  it('carries WHOSE advice it was, and never drops it', () => {
    const list = remember([], mine, 1);
    expect(whoSaid(list[0]!.from)).toBe('Carol’s agent');
    expect(whoSaid(remember([], house, 1)[0]!.from)).toBe('the house coach');
    // Through a coach: the voice AND the agent it came through, never one passed off as the other.
    const viaCoach = { say: 'Fold.', source: { agent: 'alice.me', displayName: 'alice.me', coach: 'bob-coach.svc' } };
    expect(whoSaid(remember([], viaCoach, 1)[0]!.from)).toBe('bob-coach.svc, via alice.me');
  });

  it('defaults to the house when a reply says nothing about its source', () => {
    // Older replies carry no `source`. Attributing them to somebody's agent would be worse than
    // attributing them to the coach that almost certainly said them.
    expect(whoSaid(remember([], { say: 'Discard the four.' }, 1)[0]!.from)).toBe('the house coach');
  });

  it('drops the oldest rather than growing into a transcript', () => {
    let list: Recommendation[] = [];
    for (let i = 0; i < KEEP + 4; i++) list = remember(list, { ...house, say: `line ${i}` }, 1);
    expect(list).toHaveLength(KEEP);
    expect(list[0]?.say).toBe(`line ${KEEP + 3}`);
    expect(list.some((r) => r.say === 'line 0')).toBe(false);
  });

  it('ignores an empty answer rather than keeping a blank row', () => {
    expect(remember([], null, 1)).toEqual([]);
    expect(remember([], { say: '   ' }, 1)).toEqual([]);
  });

  it('keeps ids stable as the list is trimmed, so nothing re-renders as something else', () => {
    let list = remember([], { ...house, say: 'a' }, 1);
    const first = list[0]!.id;
    list = remember(list, { ...house, say: 'b' }, 1);
    expect(list.find((r) => r.say === 'a')?.id).toBe(first);
    expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
  });
});

describe('which round a list is about', () => {
  it('can be narrowed to the round being played, so a finished one is not read as now', () => {
    let list = remember([], house, 1);
    list = remember(list, mine, 2);
    expect(forRound(list, 2).map((r) => r.say)).toEqual(['Take the pile.']);
  });
});
