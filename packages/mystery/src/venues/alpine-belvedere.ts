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
        { id: 'register', name: 'the guest register' },
        { id: 'keyboard', name: 'the key board' },
        { id: 'coat-stand', name: 'the coat stand' },
      ],
    },
    {
      id: 'lounge',
      name: 'The lounge',
      blurb: 'Deep chairs round a hearth, a piano nobody has touched, and a drinks tray going warm.',
      props: [
        { id: 'drinks-tray', name: 'the drinks tray' },
        { id: 'piano', name: 'the piano' },
        { id: 'hearth', name: 'the hearth' },
      ],
    },
    {
      id: 'kitchen',
      name: 'The kitchen',
      blurb: 'Steel and steam, a range still warm, and the service stairs going up into the dark.',
      props: [
        { id: 'knife-block', name: 'the knife block' },
        { id: 'larder', name: 'the larder' },
        { id: 'service-stairs', name: 'the service stairs' },
      ],
    },
    {
      id: 'guest-room',
      name: 'The guest floor',
      blurb: 'A corridor of numbered doors, one of them ajar, and a window onto the drifts.',
      props: [
        { id: 'suitcase', name: 'an opened suitcase' },
        { id: 'writing-desk', name: 'the writing desk' },
        { id: 'balcony', name: 'the balcony door' },
      ],
    },
    {
      id: 'ski-room',
      name: 'The ski room',
      blurb: 'Cold, concrete, racks of skis, and the piste door letting the weather in.',
      props: [
        { id: 'wax-bench', name: 'the wax bench' },
        { id: 'racks', name: 'the ski racks' },
        { id: 'boot-dryer', name: 'the boot dryer' },
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
