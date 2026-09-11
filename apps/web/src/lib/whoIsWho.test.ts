/**
 * Who is who at a table — and the one fact worth a colour: the agent advising you is also playing.
 */
import { describe, expect, it } from 'vitest';
import { seatLine, strategyWords, whoIsWho } from './whoIsWho';

const seats = [
  { seat: 0, playerId: 'home:alice', status: 'active' },
  { seat: 1, playerId: 'agent:sharkbot.svc', status: 'active' },
  { seat: 2, playerId: 'home:bob', status: 'sitting-out' },
  { seat: 3, playerId: 'agent:deepthought.svc', status: 'active' },
];
const nameOf = (s: number) => ['Alice', 'Sharkbot', 'Bob', 'Deep Thought'][s] ?? `Seat ${s + 1}`;
const players: Record<string, { kind: 'human' | 'agent'; agentName?: string; agentKind?: string }> = {
  'home:alice': { kind: 'human' },
  'agent:sharkbot.svc': { kind: 'agent', agentName: 'sharkbot.svc', agentKind: 'rules' },
  'home:bob': { kind: 'human' },
  'agent:deepthought.svc': { kind: 'agent', agentName: 'deepthought.svc', agentKind: 'claude' },
};
const playerOf = (id: string) => players[id];

describe('what is behind an agent', () => {
  it('says it in words a person uses, not the card room’s shorthand', () => {
    expect(strategyWords('rules')).toBe('rules-based');
    expect(strategyWords('claude')).toBe('language model');
    expect(strategyWords(undefined)).toBe('unknown');
  });
});

describe('the seats', () => {
  it('tells you, a person, and an agent apart — and says what is behind each agent', () => {
    const r = whoIsWho(seats, nameOf, playerOf, 0, null);
    expect(r.playing.map((s) => s.kind)).toEqual(['you', 'agent', 'person', 'agent']);
    expect(r.playing[1]?.behind).toBe('rules-based');
    expect(r.playing[3]?.behind).toBe('language model');
    expect(r.playing[2]?.sittingOut).toBe(true);
  });

  it('has no "you" for somebody watching', () => {
    const r = whoIsWho(seats, nameOf, playerOf, null, null);
    expect(r.playing.some((s) => s.kind === 'you')).toBe(false);
  });

  it('reads as one line each', () => {
    const r = whoIsWho(seats, nameOf, playerOf, 0, null);
    expect(seatLine(r.playing[0]!)).toBe('Alice — you');
    expect(seatLine(r.playing[1]!)).toBe('Sharkbot — an A2A agent, rules-based');
    expect(seatLine(r.playing[2]!)).toBe('Bob — a person, sitting out');
  });
});

describe('the coach', () => {
  it('is the house by default, and says the house coach is not an agent', () => {
    const r = whoIsWho(seats, nameOf, playerOf, 0, null);
    expect(r.coach.kind).toBe('house');
    expect(r.coach.what).toContain('Not an agent');
  });

  it('names your own adviser as an A2A agent that never takes a turn', () => {
    const r = whoIsWho(seats, nameOf, playerOf, 0, { agentName: 'carol.me', displayName: 'carol.me' });
    expect(r.coach.kind).toBe('agent');
    expect(r.coach.what).toContain('never takes a turn');
    expect((r.coach as { alsoPlaying: boolean }).alsoPlaying).toBe(false);
  });

  it('says out loud when the agent advising you is also one of the players', () => {
    // Not forbidden and not a bug: a fact a person should see rather than deduce from two names.
    const r = whoIsWho(seats, nameOf, playerOf, 0, { agentName: 'sharkbot.svc', displayName: 'Sharkbot' });
    expect((r.coach as { alsoPlaying: boolean }).alsoPlaying).toBe(true);
    expect(r.coach.what).toContain('one of your opponents');
  });

  it('decides "also playing" by the seats, not by the display name', () => {
    const r = whoIsWho(seats, nameOf, playerOf, 0, { agentName: 'sharkbot.svc', displayName: 'Something Else' });
    expect((r.coach as { alsoPlaying: boolean }).alsoPlaying).toBe(true);
  });
});
