/**
 * The canasta helpers, and the promise the copied ones make.
 *
 * `lib/canasta.ts` keeps its own copy of five card predicates rather than importing them, because a
 * value import from `@pokernight/canasta` drags the whole engine into this bundle. A copy is only
 * safe if something checks it, so the first block here checks it — against the engine itself, which
 * is a DEV dependency and never ships. If the deck's values ever change, this fails rather than the
 * screen quietly showing a different number from the one the round is scored with.
 */
import { describe, expect, it } from 'vitest';
import {
  cardValue as engineCardValue,
  fullDeck,
  isBlackThree as engineIsBlackThree,
  isRedThree as engineIsRedThree,
  isWild as engineIsWild,
  initialMeldMinimum,
} from '@pokernight/canasta';
import {
  cardValue,
  checkSelection,
  drawnIndex,
  hasCanasta,
  isBlackThree,
  isRedThree,
  isWild,
  openingMinimum,
  groupHand,
  seatRing,
  sortHand,
  teamName,
  teamOf,
  turnLine,
  valueOf,
  openingProgress,
  primaryAction,
  whyNotTakePile,
} from './canasta';
import type { CanastaCard, CanastaView } from './canasta';

describe('the copied card predicates agree with the engine', () => {
  const deck = fullDeck();

  it('on what every card in the pack is worth', () => {
    for (const c of deck) expect(cardValue(c), c).toBe(engineCardValue(c));
  });

  it('on which cards are wild', () => {
    for (const c of deck) expect(isWild(c), c).toBe(engineIsWild(c));
    expect(deck.filter(isWild)).toHaveLength(12);
  });

  it('on the threes, which are two different cards wearing one rank', () => {
    for (const c of deck) {
      expect(isRedThree(c), c).toBe(engineIsRedThree(c));
      expect(isBlackThree(c), c).toBe(engineIsBlackThree(c));
    }
  });

  it('on what a side must lay to open, which RISES with the score', () => {
    for (const score of [-200, -1, 0, 500, 1499, 1500, 2999, 3000, 9000]) {
      expect(openingMinimum(score), String(score)).toBe(initialMeldMinimum(score));
    }
  });

  it('on what a set of cards adds up to', () => {
    expect(valueOf(['W*', 'AH', '4D'])).toBe(75);
    expect(valueOf([])).toBe(0);
  });
});

describe('grouping a hand', () => {
  it('puts the wilds first, then the red threes, then the ranks high to low', () => {
    const groups = groupHand(['3C', '7D', 'AS', '2H', 'W*', '7C', '3H']);
    expect(groups.map((g) => g.rank)).toEqual(['W', '3', 'A', '7', '3']);
    // Jokers and twos are ONE group: they are interchangeable in a meld, which is the only thing a
    // player ever does with them.
    expect(groups[0]?.cards).toEqual(['2H', 'W*']);
    expect(groups[0]?.wild).toBe(true);
    // A red three is its own group and is marked a bonus, because it is not a card you play.
    expect(groups[1]).toMatchObject({ rank: '3', bonus: true, cards: ['3H'] });
    // …and a black three is an ordinary rank at the far end, not a bonus.
    expect(groups.at(-1)).toMatchObject({ rank: '3', bonus: false, cards: ['3C'] });
  });

  it('keeps every card, because two packs means duplicates are real cards', () => {
    expect(groupHand(['7C', '7C', 'KD']).flatMap((g) => g.cards)).toHaveLength(3);
    expect(sortHand(['7C', '7C', 'KD'])).toHaveLength(3);
  });

  it('flattens to the SAME order it groups in, because a card index means a position', () => {
    const hand = ['3C', '7D', 'AS', '2H', 'W*', '7C', '3H'];
    expect(sortHand(hand)).toEqual(groupHand(hand).flatMap((g) => g.cards));
  });
});

describe('where each seat is drawn', () => {
  it('puts you at the bottom and your partner opposite', () => {
    // Seats 0 and 2 are one side. Whoever the viewer is, their partner is the seat drawn across.
    for (const v of [0, 1, 2, 3]) {
      const ring = seatRing(v);
      expect(ring.south).toBe(v);
      expect(teamOf(ring.north)).toBe(teamOf(v));
      expect(teamOf(ring.west)).not.toBe(teamOf(v));
      expect(teamOf(ring.east)).not.toBe(teamOf(v));
      expect(new Set(Object.values(ring)).size).toBe(4);
    }
  });

  it('runs play to the LEFT, so the turn visibly travels round the table', () => {
    expect(seatRing(0).west).toBe(1);
    expect(seatRing(3).west).toBe(0);
  });

  it('shows a spectator the table from seat 1 rather than from nobody', () => {
    expect(seatRing(null)).toEqual({ south: 0, west: 1, north: 2, east: 3 });
  });
});

/**
 * The check under the buttons. It must never let through something the engine would refuse — a
 * player told "that is a legal meld" and then refused has been lied to by their own screen.
 */
describe('checking what has been picked up', () => {
  it('accepts three of a rank', () => {
    expect(checkSelection(['7C', '7D', '7H'])).toMatchObject({ ok: true, rank: '7', value: 15 });
  });

  it('refuses two, and says a meld is three', () => {
    const r = checkSelection(['7C', '7D']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.why).toMatch(/three cards or more/);
  });

  it('refuses a mixed handful, and says a meld is one rank', () => {
    const r = checkSelection(['7C', '8D', '9H']);
    if (r.ok) throw new Error('unreachable');
    expect(r.why).toMatch(/one rank/);
  });

  it('refuses more than three wilds, and refuses more wilds than naturals', () => {
    expect(checkSelection(['7C', '7D', '7H', '7S', 'W*', '2C', '2D', '2H']).ok).toBe(false);
    expect(checkSelection(['7C', '7D', 'W*', '2C', '2D']).ok).toBe(false);
    // Three naturals and three wilds is legal; the cap and the ratio are different rules.
    expect(checkSelection(['KC', 'KD', 'KH', 'W*', '2C', '2D']).ok).toBe(true);
  });

  it('refuses wilds on their own, however many', () => {
    const r = checkSelection(['W*', '2C', '2D']);
    if (r.ok) throw new Error('unreachable');
    expect(r.why).toMatch(/on their own/);
  });

  it('refuses a red three, which is a bonus and not a card you lay down', () => {
    const r = checkSelection(['3H', '3D', '3C']);
    if (r.ok) throw new Error('unreachable');
    expect(r.why).toMatch(/bonus/);
  });

  it('refuses black threes, which only go down as you go out', () => {
    const r = checkSelection(['3C', '3S', '3C']);
    if (r.ok) throw new Error('unreachable');
    expect(r.why).toMatch(/go out/);
  });

  it('lets TWO cards join a meld already on the table, because an addition is judged on the whole', () => {
    expect(checkSelection(['7S', '7C'], ['7']).ok).toBe(true);
    expect(checkSelection(['W*'], ['7']).ok).toBe(false); // still not a rank of its own
    expect(checkSelection(['7S'], ['7'])).toMatchObject({ ok: true, rank: '7' });
  });

  it('says nothing has been picked rather than going red at an empty selection', () => {
    const r = checkSelection([]);
    if (r.ok) throw new Error('unreachable');
    expect(r.why).toMatch(/Pick the cards/);
  });
});

describe('the partnership', () => {
  it('seats 1 and 3 play together, and so do 2 and 4', () => {
    expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1]);
  });

  it('names the sides from where the viewer is sitting', () => {
    expect(teamName(0, 0)).toBe('Your side');
    expect(teamName(1, 0)).toBe('The other side');
    expect(teamName(0, 1)).toBe('The other side');
    // A spectator has no side, and must not be told they have one.
    expect(teamName(0, null)).toBe('Seats 1 & 3');
  });

  it('knows a side may go out once it has a canasta', () => {
    expect(hasCanasta([{ rank: '7', cards: [], canasta: false, natural: false }])).toBe(false);
    expect(hasCanasta([{ rank: '7', cards: [], canasta: true, natural: false }])).toBe(true);
  });
});

/**
 * The line at the top. Canasta's turn has TWO halves and a player who does not know that is stuck:
 * the meld and discard controls are dead until you have drawn. Saying which half turns a dead
 * button into a step.
 */
describe('the turn line', () => {
  const view = (over: Partial<CanastaView>): CanastaView =>
    ({ toAct: 0, phase: 'draw', result: null, ...over }) as CanastaView;
  const nameOf = (s: number) => `Player ${s + 1}`;

  it('tells the player on turn which half of it they are in', () => {
    expect(turnLine(view({}), 0, nameOf)).toMatch(/draw a card, or take the discard pile/);
    expect(turnLine(view({ phase: 'play' }), 0, nameOf)).toMatch(/lay melds if you can, then discard/);
  });

  it('names somebody else when it is not your turn', () => {
    expect(turnLine(view({ toAct: 1 }), 0, nameOf)).toBe('Player 2 to draw.');
    expect(turnLine(view({ toAct: 1, phase: 'play' }), 0, nameOf)).toBe('Player 2 to play.');
  });

  it('says the round is over rather than naming a turn nobody has', () => {
    expect(turnLine(view({ result: {} as never }), 0, nameOf)).toBe('The round is over.');
    expect(turnLine(view({ toAct: null }), 0, nameOf)).toMatch(/next round/);
  });
});

describe('why the pile will not come', () => {
  const three = (r: string): CanastaCard => `${r}H` as CanastaCard;
  const base = { canTakePile: true, takePileReason: null, pileTop: '7H' as CanastaCard, selection: [], existingRanks: [] as string[] };

  it('is silent when the pile really can be taken', () => {
    // Two natural sevens in hand plus the seven on top is a meld.
    expect(whyNotTakePile({ ...base, selection: ['7S', '7D'] as CanastaCard[] })).toBeNull();
  });

  it('gives the ENGINE’s reason when the rules are what refuse it', () => {
    // The engine owns the rules; nothing here improves on its words.
    expect(whyNotTakePile({ ...base, canTakePile: false, takePileReason: 'the pile is frozen and you need two natural sevens' })).toBe(
      'the pile is frozen and you need two natural sevens',
    );
  });

  it('says to PICK CARDS when that is all that is missing — the case that said nothing at all', () => {
    // The ordinary failure: the pile is takeable, no cards chosen yet, so the button sat dead with an
    // empty tooltip and the guidance said "take the pile with those".
    expect(whyNotTakePile(base)).toBe('Pick the cards from your hand that go with the 7 on top, then take the pile.');
  });

  it('is silent with NOTHING selected when the side already has that rank down', () => {
    // The top card can be added to a meld already on the table, so no cards from hand are needed and
    // the button is genuinely live. Asserted because it is the one case where an empty selection is
    // not a mistake, and a blanket "pick some cards first" would be wrong.
    expect(whyNotTakePile({ ...base, existingRanks: ['7'] })).toBeNull();
  });

  it('explains a WRONG selection in terms of picking the pile up, not laying down', () => {
    const said = whyNotTakePile({ ...base, selection: ['8S', '9D'] as CanastaCard[] });
    expect(said).toMatch(/^Those and the 7 on top do not make a meld: /);
    expect(said).toMatch(/one rank/i);
  });

  it('says so when there is no pile', () => {
    expect(whyNotTakePile({ ...base, pileTop: null })).toBe('The pile is empty.');
  });
});

describe('which button is green', () => {
  const base = { drawing: false, selectionCount: 0, canDraw: false, canTake: false, canMeld: false, canDiscard: false };

  it('marks DRAW in the first half, until the pile is actually takeable', () => {
    expect(primaryAction({ ...base, drawing: true, canDraw: true })).toBe('draw');
    // Taking needs the cards chosen, so it is the selection's act and takes the green when it is on.
    expect(primaryAction({ ...base, drawing: true, canDraw: true, canTake: true, selectionCount: 2 })).toBe('take');
  });

  it('marks DISCARD for exactly one card — the shape of ending a turn', () => {
    expect(primaryAction({ ...base, selectionCount: 1, canDiscard: true })).toBe('discard');
  });

  it('marks LAY DOWN for a legal meld, which is the thing that used to be invisible', () => {
    // Discard was permanently green, so a player holding three matching cards pressed it and never
    // saw `Lay down` beside it.
    expect(primaryAction({ ...base, selectionCount: 3, canMeld: true, canDiscard: false })).toBe('meld');
  });

  it('keeps DISCARD on one card even when it would extend a meld', () => {
    // A single card matching a meld already down CAN be laid off. But the common reason to pick one
    // card is to throw it, and green on `Lay down` would turn a routine discard into an irreversible
    // meld on a mis-click.
    expect(primaryAction({ ...base, selectionCount: 1, canMeld: true, canDiscard: true })).toBe('discard');
  });

  it('marks NOTHING when nothing is ready', () => {
    expect(primaryAction(base)).toBeNull();
    // Two cards that do not make a meld: not a discard, not a meld, so no green at all.
    expect(primaryAction({ ...base, selectionCount: 2 })).toBeNull();
    expect(primaryAction({ ...base, drawing: true })).toBeNull();
  });

  it('is never more than one thing', () => {
    const every = [
      { ...base, drawing: true, canDraw: true, canTake: true, selectionCount: 2 },
      { ...base, selectionCount: 1, canDiscard: true, canMeld: true },
      { ...base, selectionCount: 3, canMeld: true },
    ];
    for (const a of every) expect(typeof primaryAction(a)).toBe('string');
  });
});

describe('how close to opening', () => {
  it('counts the GAP, which is the number somebody is actually asking about', () => {
    // "60 points" answers a question nobody asked. "30 short of 90" says whether to keep looking.
    expect(openingProgress({ opened: false, value: 60, minimum: 90 })).toEqual({ short: 30, line: '30 short of 90' });
  });

  it('says when there is enough, rather than counting down past zero', () => {
    expect(openingProgress({ opened: false, value: 95, minimum: 90 })).toEqual({ short: 0, line: 'enough to open (90)' });
    expect(openingProgress({ opened: false, value: 90, minimum: 90 })).toEqual({ short: 0, line: 'enough to open (90)' });
  });

  it('is silent once the side has opened — there is no minimum left to be short of', () => {
    expect(openingProgress({ opened: true, value: 10, minimum: 90 })).toBeNull();
  });

  it('is silent when there is no minimum to meet', () => {
    expect(openingProgress({ opened: false, value: 0, minimum: 0 })).toBeNull();
  });

  it('tracks the minimum as it climbs with the score', () => {
    // 50 below 1500, 90 below 3000, 120 above — so the same cards are short by different amounts.
    for (const [score, min] of [[0, 50], [1500, 90], [3000, 120]] as const) {
      expect(openingMinimum(score)).toBe(min);
      expect(openingProgress({ opened: false, value: 40, minimum: min })?.short).toBe(min - 40);
    }
  });
});

/**
 * WHICH CARD IS NEW.
 *
 * A draw puts one card into a dozen sorted by rank, so it lands in the middle rather than at the end
 * where a person is looking, and the count going from eleven to twelve says nothing about which one it
 * is. Answering that by counting is not something a card game should ask of anybody.
 */
describe('the card you just drew', () => {
  const groups = () => groupHand(['7C', '7D', 'KS', '2H', '3H'] as CanastaCard[]);

  it('is located in the flat order the hand actually renders in', () => {
    const g = groups();
    const flat = g.flatMap((x) => x.cards);
    const i = drawnIndex(g, 'KS' as CanastaCard);
    expect(flat[i]).toBe('KS');
  });

  it('picks the first of two identical cards, so the mark does not move between renders', () => {
    const g = groupHand(['7C', '7C', 'KS'] as CanastaCard[]);
    const flat = g.flatMap((x) => x.cards);
    const i = drawnIndex(g, '7C' as CanastaCard);
    expect(flat[i]).toBe('7C');
    expect(drawnIndex(g, '7C' as CanastaCard)).toBe(i);
  });

  it('points at nothing when there is nothing to point at', () => {
    expect(drawnIndex(groups(), null)).toBe(-1);
    // Drawn earlier and since melded or discarded: the hand no longer holds it.
    expect(drawnIndex(groups(), 'AS' as CanastaCard)).toBe(-1);
    expect(drawnIndex([], '7C' as CanastaCard)).toBe(-1);
  });
});
