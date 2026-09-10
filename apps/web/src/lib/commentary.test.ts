/**
 * The running commentary, and the silence it exists to fill.
 *
 * The complaint: "it sits for a while and then does something. I have no idea what is going on."
 * The pause was the other three players taking their turns while the coach said nothing — it only
 * ever spoke about the learner's own move, and three of every four turns belong to somebody else.
 *
 * Two rules hold here. Everything gets a LINE, so the feed reads like a person at your shoulder.
 * Only what is worth interrupting for gets SPOKEN, because a table that talks over itself is one
 * people mute, and then they hear nothing at all.
 */
import { describe, expect, it } from 'vitest';
import { commentaryFor, endsTurn, seatOfEvent, spokenLine, turnSentence } from './commentary';
import type { CanastaTableEvent } from './canasta';

const nameOf = (s: number) => ['Melder', 'Alice', 'Pile Hawk', 'Red Three'][s] ?? `Seat ${s + 1}`;
const line = (ev: unknown, you: number | null = 1) => commentaryFor(ev as CanastaTableEvent, you, nameOf);

describe('what everybody else is doing', () => {
  it('narrates the ordinary moves on screen', () => {
    expect(line({ type: 'drew', seat: 0, stock: 40 })?.text).toBe('Melder draws. 40 left.');
    expect(line({ type: 'discarded', seat: 0, card: '7C', frozen: false })?.text).toBe('Melder discards the seven of clubs.');
    expect(line({ type: 'melded', seat: 0, rank: 'K', size: 4, canasta: false })?.text).toBe('Melder melds 4 kings.');
  });

  it('says "you" about you, rather than reading your own name back', () => {
    expect(line({ type: 'drew', seat: 1, stock: 40 })?.text).toBe('You draw. 40 left.');
    expect(line({ type: 'took-pile', seat: 1, cards: 9, top: '7C' })?.text).toBe('You take the pile — 9 cards.');
    expect(line({ type: 'melded', seat: 1, rank: '7', size: 7, canasta: true })?.text).toBe('You make a canasta in sevens.');
  });

  it('calls everybody by name for a spectator, who is not any of them', () => {
    // Nobody is "you" when the viewer holds no seat, and telling a watcher they just drew would be
    // narrating somebody else's turn at them.
    expect(line({ type: 'drew', seat: 1, stock: 40 }, null)?.text).toBe('Alice draws. 40 left.');
    expect(line({ type: 'took-pile', seat: 1, cards: 9, top: '7C' }, null)?.text).toBe('Alice takes the pile — 9 cards.');
  });
});

describe('what is said out loud', () => {
  it('is nearly everything, because the ordinary moves ARE the game', () => {
    // Leaving draws and discards silent is what made three of every four turns sound like nothing.
    expect(line({ type: 'drew', seat: 0, stock: 40 })?.speak).toBe(true);
    expect(line({ type: 'discarded', seat: 0, card: '7C', frozen: false })?.speak).toBe(true);
    expect(line({ type: 'melded', seat: 0, rank: 'K', size: 3, canasta: false })?.speak).toBe(true);
    expect(line({ type: 'took-pile', seat: 0, cards: 12, top: '7C' })?.speak).toBe(true);
    expect(line({ type: 'opened', seat: 0, team: 0, value: 55 })?.speak).toBe(true);
    expect(line({ type: 'round-ended', result: { wentOut: 0, concealed: false } })?.speak).toBe(true);
  });

  it('never reads CHAT aloud — those are somebody else’s words', () => {
    const c = line({ type: 'chat', name: 'Marcus', text: 'nice one' });
    expect(c?.text).toBe('Marcus: nice one');
    expect(c?.speak).toBe(false);
  });

  it('says ranks the way a person says them, not as codes', () => {
    // A voice reading "3 Ks" says "three kays".
    expect(line({ type: 'melded', seat: 0, rank: 'K', size: 3, canasta: false })?.text).toBe('Melder melds 3 kings.');
    expect(line({ type: 'melded', seat: 0, rank: 'T', size: 7, canasta: true })?.text).toBe('Melder makes a canasta in tens.');
    // "sixes", not "sixs" — the one irregular plural in a deck, and the one a voice makes obvious.
    expect(line({ type: 'melded', seat: 0, rank: '6', size: 4, canasta: false })?.text).toBe('Melder melds 4 sixes.');
  });

  it('marks the viewer’s OWN moves, so the coach does not say them twice', () => {
    // In "play for me" the coach announces the move and the reason before making it; repeating it
    // as it lands is an echo, in a queue only three deep.
    expect(line({ type: 'drew', seat: 1, stock: 40 })?.mine).toBe(true);
    expect(line({ type: 'drew', seat: 0, stock: 40 })?.mine).toBeUndefined();
    expect(line({ type: 'melded', seat: 1, rank: '7', size: 3, canasta: false })?.mine).toBe(true);
  });
});

describe('silence', () => {
  it('is the answer for a player’s own cards, which are private', () => {
    // Narrating these would put somebody's hand into a feed they might read out.
    expect(line({ type: 'dealt', seat: 1, cards: ['AS'], private: true })).toBeNull();
    expect(line({ type: 'drew-card', seat: 1, card: 'AS', private: true })).toBeNull();
  });

  it('is the answer for an event it has never heard of', () => {
    expect(line({ type: 'something-new' })).toBeNull();
  });
});

describe('speaking about the person reading it', () => {
  it('conjugates the verb for "you", rather than saying "You deals"', () => {
    expect(line({ type: 'round-started', roundNo: 1, dealer: 1, stock: 64 })?.text).toMatch(/^Round 1 — You deal\./);
    expect(line({ type: 'round-started', roundNo: 1, dealer: 0, stock: 64 })?.text).toMatch(/^Round 1 — Melder deals\./);
  });

  it('makes the possessive a word, not a name with an s — "Your side", never "You\u2019s side"', () => {
    expect(line({ type: 'opened', seat: 1, team: 1, value: 55 })?.text).toBe('Your side opens with 55.');
    expect(line({ type: 'opened', seat: 0, team: 0, value: 55 })?.text).toBe("Melder's side opens with 55.");
  });
});

describe('the round ending', () => {
  it('names who went out, and says it in the second person when it was you', () => {
    expect(line({ type: 'round-ended', result: { wentOut: 0, concealed: false } })?.text).toMatch(/Melder goes out/);
    expect(line({ type: 'round-ended', result: { wentOut: 1, concealed: true } })?.text).toMatch(/You go out, concealed/);
    expect(line({ type: 'round-ended', result: { wentOut: null, concealed: false } })?.text).toMatch(/stock ran out/);
  });
});

/**
 * A WHOLE TURN AS ONE SENTENCE.
 *
 * Narrating each event separately produced more speech than a voice could deliver: a lap of the
 * table is a dozen events, each takes two or three seconds to say, and the lap itself takes about
 * ten. The queue dropped whatever was oldest to make room, so what survived was whatever arrived
 * last — which is why a player heard their own moves and almost none of anybody else's.
 */
describe('a turn, said as one sentence', () => {
  const ev = (o: Record<string, unknown>) => o as never;

  it('joins the ordinary turn into a single clause list', () => {
    const line = turnSentence(
      [ev({ type: 'drew', seat: 0, stock: 55 }), ev({ type: 'discarded', seat: 0, card: '5D', frozen: false })],
      'Melder',
      false,
    );
    expect(line).toBe('Melder draws, and discards the five of diamonds.');
  });

  it('puts the melds where they happened, not tacked on the end', () => {
    const line = turnSentence(
      [
        ev({ type: 'drew', seat: 0, stock: 55 }),
        ev({ type: 'melded', seat: 0, rank: '8', size: 4, canasta: false }),
        ev({ type: 'melded', seat: 0, rank: 'Q', size: 3, canasta: false }),
        ev({ type: 'discarded', seat: 0, card: '5D', frozen: false }),
      ],
      'Melder',
      false,
    );
    expect(line).toBe('Melder draws, melds 4 eights and 3 queens, and discards the five of diamonds.');
  });

  it('calls a canasta a canasta inside the sentence', () => {
    const line = turnSentence(
      [ev({ type: 'drew', seat: 0, stock: 40 }), ev({ type: 'melded', seat: 0, rank: '7', size: 7, canasta: true })],
      'Pile Hawk',
      false,
    );
    expect(line).toBe('Pile Hawk draws, and melds sevens for a canasta.');
  });

  it('says taking the pile, and how much of it', () => {
    const line = turnSentence(
      [ev({ type: 'took-pile', seat: 1, cards: 12, top: '7C' }), ev({ type: 'discarded', seat: 1, card: 'KH', frozen: false })],
      'Red Three',
      false,
    );
    expect(line).toBe('Red Three takes the pile, 12 cards, and discards the king of hearts.');
  });

  it('conjugates for YOU rather than reading your name back at you', () => {
    const line = turnSentence(
      [ev({ type: 'drew', seat: 1, stock: 55 }), ev({ type: 'discarded', seat: 1, card: '5D', frozen: false })],
      'You',
      true,
    );
    expect(line).toBe('You draw, and discard the five of diamonds.');
  });

  it('adds the opening as its own clause, because it is the rule people trip on', () => {
    const line = turnSentence(
      [
        ev({ type: 'drew', seat: 0, stock: 50 }),
        ev({ type: 'melded', seat: 0, rank: 'K', size: 3, canasta: false }),
        ev({ type: 'opened', seat: 0, team: 0, value: 60 }),
        ev({ type: 'discarded', seat: 0, card: '4C', frozen: false }),
      ],
      'Melder',
      false,
    );
    expect(line).toMatch(/That opens their side, with 60\.$/);
  });

  it('counts red threes instead of repeating the clause', () => {
    // Each one is its own event, and a turn can lay several. "lay down a red three, and lay down a
    // red three" is a sentence nobody would say out loud.
    const one = turnSentence([ev({ type: 'red-three', seat: 1, card: '3H', team: 1 }), ev({ type: 'drew', seat: 1, stock: 50 })], 'You', true);
    expect(one).toBe('You lay down a red three, and draw.');
    const two = turnSentence(
      [
        ev({ type: 'red-three', seat: 1, card: '3H', team: 1 }),
        ev({ type: 'red-three', seat: 1, card: '3D', team: 1 }),
        ev({ type: 'drew', seat: 1, stock: 49 }),
        ev({ type: 'discarded', seat: 1, card: '5C', frozen: false }),
      ],
      'You',
      true,
    );
    expect(two).toBe('You lay down 2 red threes, draw, and discard the five of clubs.');
  });

  it('says nothing about a turn with nothing in it', () => {
    expect(turnSentence([], 'Melder', false)).toBeNull();
    expect(turnSentence([ev({ type: 'chat', name: 'x', text: 'hi' })], 'Melder', false)).toBeNull();
  });
});

describe('knowing when a turn is over', () => {
  it('is the discard, because that is the only way one ends', () => {
    expect(endsTurn({ type: 'discarded', seat: 0, card: '5D', frozen: false } as never)).toBe(true);
    expect(endsTurn({ type: 'drew', seat: 0, stock: 40 } as never)).toBe(false);
    // Melding does NOT end a turn, which is the rule that has cost this table two bugs already.
    expect(endsTurn({ type: 'melded', seat: 0, rank: 'K', size: 3, canasta: false } as never)).toBe(false);
  });

  it('is also the round ending, since nobody discards to finish that one', () => {
    expect(endsTurn({ type: 'round-ended', result: {} } as never)).toBe(true);
    expect(endsTurn({ type: 'game-ended', winner: 0 } as never)).toBe(true);
  });

  it('tells a player’s event from the table’s own', () => {
    expect(seatOfEvent({ type: 'drew', seat: 2, stock: 40 } as never)).toBe(2);
    expect(seatOfEvent({ type: 'upcard', card: '7C', frozen: false } as never)).toBeNull();
    expect(seatOfEvent({ type: 'round-started', roundNo: 1, dealer: 0, stock: 63 } as never)).toBeNull();
  });
});

/**
 * SHORT ENOUGH TO KEEP UP. Agents are paced at about three seconds a move, so a spoken line has to
 * take less than that — or the voice falls behind the table and describes a turn that has visibly
 * ended while the next player is already moving.
 */
describe('the short line said as it happens', () => {
  const ev = (o: Record<string, unknown>) => o as never;
  const speak = (o: Record<string, unknown>, you: number | null = 1) => spokenLine(ev(o), you, nameOf);

  it('is a name, a verb and a card, and nothing else', () => {
    expect(speak({ type: 'drew', seat: 0, stock: 55 })).toBe('Melder draws.');
    expect(speak({ type: 'discarded', seat: 0, card: '5D', frozen: false })).toBe('Melder discards the five of diamonds.');
    expect(speak({ type: 'melded', seat: 0, rank: '8', size: 4, canasta: false })).toBe('Melder melds 4 eights.');
    expect(speak({ type: 'took-pile', seat: 0, cards: 12, top: '7C' })).toBe('Melder takes the pile, 12 cards.');
  });

  it('is short enough to say in the time a move takes', () => {
    const events = [
      { type: 'drew', seat: 0, stock: 55 },
      { type: 'discarded', seat: 0, card: 'KH', frozen: false },
      { type: 'melded', seat: 0, rank: 'Q', size: 3, canasta: false },
      { type: 'melded', seat: 0, rank: 'T', size: 7, canasta: true },
      { type: 'took-pile', seat: 0, cards: 12, top: '7C' },
      { type: 'discarded', seat: 0, card: '2C', frozen: true },
    ];
    for (const e of events) {
      const line = speak(e);
      // Roughly 14 characters a second at a slightly slow pace: 40 characters is under three seconds.
      expect(line!.length, line!).toBeLessThanOrEqual(44);
    }
  });

  it('narrates YOU in the same rhythm as everybody else', () => {
    expect(speak({ type: 'drew', seat: 1, stock: 55 })).toBe('You draw.');
    expect(speak({ type: 'melded', seat: 1, rank: '8', size: 4, canasta: false })).toBe('You meld 4 eights.');
    expect(speak({ type: 'discarded', seat: 1, card: '5D', frozen: false })).toBe('You discard the five of diamonds.');
    expect(speak({ type: 'opened', seat: 1, team: 1, value: 60 })).toBe('Your side is open.');
  });

  it('leaves the stock count and the asides for the screen', () => {
    expect(speak({ type: 'drew', seat: 0, stock: 55 })).not.toContain('55');
    expect(speak({ type: 'upcard', card: '7C', frozen: false })).toBeNull();
    expect(speak({ type: 'upcard', card: '2C', frozen: true })).toBe('The pile starts frozen.');
  });

  it('says nothing about chat or a player’s own cards', () => {
    expect(speak({ type: 'chat', name: 'x', text: 'hi' })).toBeNull();
    expect(speak({ type: 'dealt', seat: 1, cards: ['AS'], private: true })).toBeNull();
  });
});
