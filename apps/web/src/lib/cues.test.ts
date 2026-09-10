/**
 * What the table sounds like.
 *
 * Two rules are worth a test rather than a listen. The turn chime is the only sound addressed to a
 * PERSON rather than describing the table, so it must never fire for somebody else's turn — a table
 * that pings at every seat's turn is a table people mute, and then it pings at nothing. And most
 * events are silent on purpose: a sound for everything is the same failure by a different route.
 */
import { describe, expect, it } from 'vitest';
import { canastaCue, pokerCue } from './cues';
import type { TableEvent } from './types';
import type { CanastaTableEvent } from './canasta';

const poker = (ev: unknown, seat: number | null = 0) => pokerCue(ev as TableEvent, seat);
const canasta = (ev: unknown, seat: number | null = 0) => canastaCue(ev as CanastaTableEvent, seat);

describe('the turn chime', () => {
  it('plays for YOUR turn and for nobody else’s, in both games', () => {
    expect(poker({ type: 'turn', seat: 0, legal: {} }, 0)).toBe('turn');
    expect(poker({ type: 'turn', seat: 1, legal: {} }, 0)).toBeNull();
    expect(canasta({ type: 'turn', seat: 0, phase: 'draw' }, 0)).toBe('turn');
    expect(canasta({ type: 'turn', seat: 1, phase: 'draw' }, 0)).toBeNull();
  });

  it('never plays for a spectator, who has no turn to be told about', () => {
    expect(poker({ type: 'turn', seat: 0, legal: {} }, null)).toBeNull();
    expect(canasta({ type: 'turn', seat: 0, phase: 'draw' }, null)).toBeNull();
  });
});

describe('poker', () => {
  it('deals cards, moves chips, and resolves', () => {
    expect(poker({ type: 'hand-started' })).toBe('deal');
    expect(poker({ type: 'street' })).toBe('deal');
    expect(poker({ type: 'blind-posted' })).toBe('chips');
    expect(poker({ type: 'action', record: { action: { type: 'raise' } } })).toBe('chips');
    expect(poker({ type: 'action', record: { action: { type: 'call' } } })).toBe('chips');
    expect(poker({ type: 'hand-ended' })).toBe('good');
  });

  it('makes a fold and a check a card sound, not a money one — nothing moved', () => {
    expect(poker({ type: 'action', record: { action: { type: 'fold' } } })).toBe('card');
    expect(poker({ type: 'action', record: { action: { type: 'check' } } })).toBe('card');
  });
});

describe('canasta', () => {
  it('uses the SAME palette, because a card is the same card in both games', () => {
    expect(canasta({ type: 'round-started' })).toBe('deal');
    expect(canasta({ type: 'drew', seat: 1 })).toBe('card');
    expect(canasta({ type: 'discarded', seat: 1, card: '7C' })).toBe('card');
  });

  it('makes taking the pile the loudest thing in a round, which is what it is', () => {
    expect(canasta({ type: 'took-pile', seat: 1, cards: 12, top: '7C' })).toBe('deal');
  });

  it('marks a canasta out from an ordinary meld — it is what the whole game is for', () => {
    expect(canasta({ type: 'melded', seat: 1, canasta: false })).toBe('chips');
    expect(canasta({ type: 'melded', seat: 1, canasta: true })).toBe('good');
  });
});

describe('silence', () => {
  it('is the answer for a player’s own private events, which are already on screen', () => {
    // A sound for the cards you were dealt is a sound that plays while nothing changes for anybody.
    expect(canasta({ type: 'dealt', seat: 0, cards: ['AS'], private: true })).toBeNull();
    expect(canasta({ type: 'drew-card', seat: 0, card: 'AS', private: true })).toBeNull();
    expect(poker({ type: 'hole-cards', seat: 0, cards: [], private: true })).toBeNull();
  });

  it('is the answer for chat and for seats coming and going', () => {
    expect(poker({ type: 'chat', text: 'hi' })).toBeNull();
    expect(canasta({ type: 'chat', text: 'hi' })).toBeNull();
    expect(poker({ type: 'seat-joined', seat: 1 })).toBeNull();
    expect(canasta({ type: 'seat-left', seat: 1 })).toBeNull();
  });

  it('is the answer for an event neither game has heard of', () => {
    expect(poker({ type: 'something-new' })).toBeNull();
    expect(canasta({ type: 'something-new' })).toBeNull();
  });
});
