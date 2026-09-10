/**
 * What the coach SAYS.
 *
 * Two properties are worth holding here, and neither is about the words being pretty.
 *
 * The first: every sentence names the RULE, because the rules are what a beginner is missing. A
 * coach that says "melding 3 cards" has described the screen back to them. One that says "a side
 * cannot put anything down until its first meld reaches fifty" has taught them the thing that will
 * still be true next round.
 *
 * The second: the spoken half must be SPEAKABLE. It is read out by a voice while the move happens,
 * so card codes and punctuation a voice stumbles on are bugs, not blemishes.
 */
import { describe, expect, it } from 'vitest';
import { explainMove, spokenCard, spokenRank } from '../src/index.js';
import type { CanastaView } from '@pokernight/canasta';

function view(over: Partial<CanastaView> = {}): CanastaView {
  return {
    roundNo: 1,
    seedCommit: 'x',
    seedReveal: null,
    dealer: 3,
    toAct: 0,
    phase: 'play',
    actionDeadline: null,
    stock: 60,
    pileTop: '7C',
    pileSize: 5,
    frozen: false,
    target: 5000,
    scores: { 0: 0, 1: 0 },
    winner: null,
    melds: { 0: [], 1: [] },
    redThrees: { 0: 0, 1: 0 },
    seats: [0, 1, 2, 3].map((seat) => ({ seat, playerId: `p${seat}`, status: 'active', cards: 11, team: (seat % 2) as 0 | 1 })),
    hand: ['7D', '7H', 'KC', 'KH', 'KS', 'AS', '5C', '2C'],
    result: null,
    ...over,
  } as CanastaView;
}

/** A voice reads this aloud. Card codes and stray punctuation are bugs, not blemishes. */
function isSpeakable(s: string): void {
  expect(s.length, `too long to finish before the next turn: ${s}`).toBeLessThanOrEqual(90);
  // No raw card codes — `7C`, `W*`, `TD`. A voice says "seven see".
  expect(s, `raw card code in spoken text: ${s}`).not.toMatch(/\b[2-9TJQKAW][CDHS*]\b/);
  expect(s, `unspeakable punctuation: ${s}`).not.toMatch(/[{}[\]<>|_#]/);
}

describe('saying a card out loud', () => {
  it('says what a person says', () => {
    expect(spokenCard('7C')).toBe('the seven of clubs');
    expect(spokenCard('TD')).toBe('the ten of diamonds');
    expect(spokenCard('AS')).toBe('the ace of spades');
    // A joker has no suit, so it does not get one.
    expect(spokenCard('W*')).toBe('a joker');
  });

  it('pluralises a rank the way a rule is spoken', () => {
    expect(spokenRank('7', true)).toBe('sevens');
    expect(spokenRank('A', true)).toBe('aces');
    expect(spokenRank('T')).toBe('ten');
  });
});

describe('opening', () => {
  it('names the minimum and the reason it exists', () => {
    const e = explainMove(view(), 0, { type: 'meld', melds: [{ rank: 'K', cards: ['KC', 'KH', 'KS'] }] });
    isSpeakable(e.say);
    expect(e.say).toMatch(/Opening with kings/);
    expect(e.because).toMatch(/minimum/i);
    expect(e.because).toContain('50');
    // The rule that surprises people: the minimum RISES as you win.
    expect(e.because).toMatch(/ninety|hundred and twenty/);
  });

  it('says the higher minimum when the side is ahead', () => {
    const e = explainMove(view({ scores: { 0: 1600, 1: 0 } }), 0, { type: 'meld', melds: [{ rank: 'K', cards: ['KC', 'KH', 'KS'] }] });
    expect(e.because).toContain('90');
  });
});

describe('melding once open', () => {
  const open = view({ melds: { 0: [{ rank: 'K', cards: ['KC', 'KH', 'KS'], canasta: false, natural: false }], 1: [] } });

  it('says why melded cards are safe and held cards are not', () => {
    const e = explainMove(open, 0, { type: 'meld', melds: [{ rank: '7', cards: ['7D', '7H', '7C'] }] });
    isSpeakable(e.say);
    expect(e.because).toMatch(/count AGAINST you|against you/i);
  });

  it('calls a canasta a canasta, and says what it is for', () => {
    const six = view({ melds: { 0: [{ rank: 'K', cards: ['KC', 'KH', 'KS', 'KD', 'KC', 'KH'], canasta: false, natural: false }], 1: [] } });
    const e = explainMove(six, 0, { type: 'meld', melds: [{ rank: 'K', cards: ['KS'] }] });
    expect(e.say).toMatch(/canasta/);
    expect(e.because).toMatch(/five hundred/);
    // …and the rule people miss: no canasta, no going out.
    expect(e.because).toMatch(/cannot go out/i);
  });

  it('warns that a spent wild is a wild you no longer have', () => {
    const e = explainMove(open, 0, { type: 'meld', melds: [{ rank: '7', cards: ['7D', '7H', '2C'] }] });
    expect(e.because).toMatch(/wild/i);
    expect(e.because).toMatch(/at most three/);
  });
});

describe('drawing', () => {
  it('says WHY the pile was not taken, in the words of the rule that stopped it', () => {
    const frozen = view({ phase: 'draw', frozen: true, pileTop: '9C', hand: ['9D', 'KC', 'KH'] });
    const e = explainMove(frozen, 0, { type: 'draw' });
    isSpeakable(e.say);
    expect(e.because).toMatch(/frozen/);
    expect(e.because).toMatch(/two natural nines/);
  });

  it('names a wild on top, which stops the pile whatever you hold', () => {
    const e = explainMove(view({ phase: 'draw', pileTop: 'W*' }), 0, { type: 'draw' });
    expect(e.because).toMatch(/wild card/);
  });

  it('names a black three, which stops it for the next player only', () => {
    const e = explainMove(view({ phase: 'draw', pileTop: '3S' }), 0, { type: 'draw' });
    expect(e.because).toMatch(/black three/);
  });

  it('says it simply was not worth it when nothing was stopping it', () => {
    const e = explainMove(view({ phase: 'draw', pileTop: '7C' }), 0, { type: 'draw' });
    expect(e.because).toMatch(/not worth|worth what it would cost/i);
  });
});

describe('taking the pile', () => {
  it('says what it cost and what it bought', () => {
    const e = explainMove(view({ phase: 'draw', pileSize: 9 }), 0, { type: 'take-pile', meld: { rank: '7', cards: ['7D', '7H'] } });
    isSpeakable(e.say);
    expect(e.say).toMatch(/9 cards/);
    expect(e.because).toMatch(/2 natural sevens/);
    expect(e.because).toMatch(/biggest swing/i);
  });

  it('explains the freeze when the pile was frozen', () => {
    const e = explainMove(view({ phase: 'draw', frozen: true }), 0, { type: 'take-pile', meld: { rank: '7', cards: ['7D', '7H'] } });
    expect(e.because).toMatch(/frozen/);
  });
});

describe('discarding', () => {
  it('says a discard is how every turn ends, and which card hurts least', () => {
    const e = explainMove(view(), 0, { type: 'discard', card: '5C' });
    isSpeakable(e.say);
    expect(e.say).toBe('Discarding the five of clubs.');
    expect(e.because).toMatch(/Every turn ends with a discard/);
  });

  it('warns when the discard hands the other side the pile', () => {
    const risky = view({ melds: { 0: [], 1: [{ rank: '5', cards: ['5D', '5H', '5S'], canasta: false, natural: false }] } });
    const e = explainMove(risky, 0, { type: 'discard', card: '5C' });
    expect(e.because).toMatch(/they can take the pile/);
  });

  it('says a discarded wild freezes the pile against your own side too', () => {
    const e = explainMove(view(), 0, { type: 'discard', card: '2C' });
    expect(e.because).toMatch(/freezes the pile/);
    expect(e.because).toMatch(/your own side/);
  });

  it('names the COST of being caught holding an expensive card', () => {
    // Everything left in hand counts against your side, and the expensive cards are the ones a
    // beginner hoards. Holding wilds for a canasta that never comes is the priciest habit there is.
    const joker = explainMove(view({ hand: ['W*', 'KC', 'KH', 'KS'] }), 0, { type: 'discard', card: 'W*' });
    expect(joker.say).toMatch(/too dear to hold/);
    expect(joker.because).toMatch(/worth 50 against you/);

    const ace = explainMove(view(), 0, { type: 'discard', card: 'AS' });
    expect(ace.because).toMatch(/worth 20 against you/);
  });

  it('says nothing about cost for an ordinary low card', () => {
    const five = explainMove(view(), 0, { type: 'discard', card: '5C' });
    expect(five.say).toBe('Discarding the five of clubs.');
    expect(five.because).not.toMatch(/against you/);
  });

  it('calls the last card what it is', () => {
    const e = explainMove(view({ hand: ['5C'] }), 0, { type: 'discard', card: '5C' });
    expect(e.say).toMatch(/Going out/);
    expect(e.because).toMatch(/only be played with a canasta/);
  });
});

describe('every move is speakable', () => {
  it('across every kind of move there is', () => {
    const moves = [
      { type: 'draw' as const },
      { type: 'take-pile' as const, meld: { rank: '7' as const, cards: ['7D', '7H'] } },
      { type: 'meld' as const, melds: [{ rank: 'K' as const, cards: ['KC', 'KH', 'KS'] }] },
      { type: 'discard' as const, card: '5C' },
    ];
    for (const m of moves) {
      const e = explainMove(view(), 0, m);
      isSpeakable(e.say);
      // The reading half is allowed to be long, but never empty — a coach with nothing to say is
      // a coach that has stopped teaching.
      expect(e.because.length, JSON.stringify(m)).toBeGreaterThan(40);
    }
  });
});
