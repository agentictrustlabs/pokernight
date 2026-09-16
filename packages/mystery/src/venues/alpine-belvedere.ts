import type { Venue } from '../types.js';

/**
 * THE BELVEDERE — a ski resort hotel in the Alps, and the first place Mystery Night is staged in.
 *
 * Five rooms, because five is enough for eight people to split up, meet again, and be alone with somebody.
 * The venue knows nothing about any mystery: no clue, no killer, no act. A second title runs here by naming
 * these rooms and these props, and the staging refuses to open if it names one that is not here.
 */
export const ALPINE_BELVEDERE: Venue = {
  id: 'alpine-belvedere',
  name: 'Hôtel Belvedere',
  blurb: 'A stone-and-timber hotel above the treeline. The pass is shut, the wind is up, and nobody is leaving tonight.',
  spawn: 'lobby',
  rooms: [
    {
      id: 'lobby',
      name: 'The lobby',
      blurb: 'Snow against the glass, a fire that has not caught, and the front doors banked shut.',
      props: [
        { id: 'register', name: 'the guest register', detail: "A ledger open at tonight's page, a pen laid across the gutter. Look at the hand: who signed for whom, and which line was written later than the rest." },
        { id: 'keyboard', name: 'the key board', detail: 'Fifteen hooks in three rows, a numbered tag on most. Look at the gaps — a key off its hook is a room somebody can be in.' },
        { id: 'coat-stand', name: 'the coat stand', detail: 'A loden coat, a pale one and a scarf, all still damp at the shoulders. Look at what is in the pockets and how wet the hems are.' },
      ],
    },
    {
      id: 'lounge',
      name: 'The lounge',
      blurb: 'Deep chairs round a hearth, a piano nobody has touched, and a drinks tray going warm.',
      props: [
        { id: 'drinks-tray', name: 'the drinks tray', detail: 'Glasses on a silver tray, two of them used, the ice long gone. Look at which glass was set down where, and what is left in it.' },
        { id: 'piano', name: 'the piano', detail: 'The lid is up and the stool is pushed back at an angle. Look at the music left open and the dust the keys have not got.' },
        { id: 'hearth', name: 'the hearth', detail: 'A fire laid twice and caught neither time. Look at what went in with the kindling and did not burn.' },
      ],
    },
    {
      id: 'kitchen',
      name: 'The kitchen',
      blurb: 'Steel and steam, a range still warm, and the service stairs going up into the dark.',
      props: [
        { id: 'knife-block', name: 'the knife block', detail: 'A block of six slots on the pass. Look at which slots are full, which knife is back wet, and which is not back at all.' },
        { id: 'larder', name: 'the larder', detail: 'Cold shelves and a door that does not sit flush. Look at what has been moved to reach behind, and the mark on the floor where it stood.' },
        { id: 'service-stairs', name: 'the service stairs', detail: 'Bare stone up to the guest floor, no carpet, no light past the turn. Look at the tread halfway up and what has been walked through it.' },
      ],
    },
    {
      id: 'guest-room',
      name: 'The guest floor',
      blurb: 'A corridor of numbered doors, one of them ajar, and a window onto the drifts.',
      props: [
        { id: 'suitcase', name: 'an opened suitcase', detail: 'Opened on the bed and gone through by somebody in a hurry. Look at what has been unpacked and what has been pushed back down the sides.' },
        { id: 'writing-desk', name: 'the writing desk', detail: 'A blotter, a dry inkwell, and one drawer that does not close. Look at the impression in the blotter and the corner of paper in the drawer.' },
        { id: 'balcony', name: 'the balcony door', detail: 'The door is shut against the snow but the catch is not turned. Look at the sill, and at what the wind has and has not covered.' },
      ],
    },
    {
      id: 'ski-room',
      name: 'The ski room',
      blurb: 'Cold, concrete, racks of skis, and the piste door letting the weather in.',
      props: [
        { id: 'wax-bench', name: 'the wax bench', detail: 'An iron, a scraper, and wax gone hard in the pot. Look at what has been cleaned recently and what has been cleaned too well.' },
        { id: 'racks', name: 'the ski racks', detail: 'Five pairs standing and one pair down on the floor. Look at the bindings, at which pair is wet, and at where the down pair fell from.' },
        { id: 'boot-dryer', name: 'the boot dryer', detail: 'A row of warm pegs, most of them empty. Look at which boots are on it, whose they are, and how long they have been dry.' },
      ],
    },
  ],
  doors: [
    ['lobby', 'lounge'],
    ['lobby', 'ski-room'],
    ['lobby', 'guest-room'],
    ['lounge', 'kitchen'],
    ['kitchen', 'guest-room'],
  ],
};
