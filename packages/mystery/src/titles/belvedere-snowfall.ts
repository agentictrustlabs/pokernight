import type { Title } from '../types.js';

/**
 * SNOWFALL AT THE BELVEDERE — the first title (docs/MYSTERY-NIGHT.md §3.2).
 *
 * A TITLE IS CONTENT. Everything here is data the engine reads: eight parts, three acts, the props a clue
 * hides behind, the traits a death gives up, and a written line for every moment the director would
 * otherwise narrate. Authoring a second mystery is writing another one of these — not another package.
 *
 * SOLVABILITY IS A PROPERTY OF THIS FILE, and `checkTitle` proves it before anybody plays: for EVERY role
 * that can be the killer, the traits two deaths reveal must narrow the cast to exactly one person.
 */
export const BELVEDERE_SNOWFALL: Title = {
  id: 'belvedere-snowfall',
  name: 'Snowfall at the Belvedere',
  venue: 'alpine-belvedere',
  blurb: 'The pass is shut, the wind is up, and by morning two of the eight people in this hotel will be dead. One of you did it.',
  tone: 'A death happens off the page and is described the way a novel would: no injury, no cruelty, nothing sexual.',
  evidencePerDeath: 2,
  accusationMinutes: 3,
  openingDeath: { room: 'ski-room', prop: 'racks' },

  roles: [
    {
      id: 'concierge', name: 'Émile Rossi', archetype: 'belvedere-concierge', canBeKiller: true,
      blurb: 'You have run the Belvedere for nineteen winters. You know which door sticks and who came down late.',
      secret: 'You have been letting one guest stay all season without paying, and the books do not show it.',
      traits: ['keys:master', 'boots:42', 'gloves:wool'],
      lines: {
        greet: 'The pass will not open before morning. Please, stay where it is warm.',
        probe: 'I see everyone who crosses this lobby. Not everyone remembers that.',
        deny: 'I was at the desk. The desk is where I always am.',
        accuse: 'I keep the keys, and I know who asked me for one tonight.',
        mourn: 'Nineteen winters, and never this.',
        found: 'Hm. That was not there this morning.',
      },
    },
    {
      id: 'heiress', name: 'Delphine Aubert', archetype: 'belvedere-heiress', canBeKiller: true,
      blurb: 'The resort is yours since your father died on the mountain two winters ago.',
      secret: 'The will is being contested, and you have known for a week who is contesting it.',
      traits: ['scent:iris', 'boots:38', 'gloves:leather'],
      lines: {
        greet: 'My father built this place. I would rather it not be remembered for tonight.',
        probe: 'You knew him, did you not? Before.',
        deny: 'I was upstairs. Alone, yes — as usual.',
        accuse: 'Somebody here wants what my father left, and it is not me.',
        mourn: 'This house takes people. It took him too.',
        found: 'Let me see that. No — let me see it properly.',
      },
    },
    {
      id: 'instructor', name: 'Kai Brunner', archetype: 'belvedere-instructor', canBeKiller: true,
      blurb: 'You teach the guests to ski and you know the mountain better than the map does.',
      secret: 'You were on the slope the night of the accident two winters ago, and you have never said so.',
      traits: ['scent:pine-wax', 'boots:44', 'hands:calloused'],
      lines: {
        greet: 'Nobody goes out in this. I have told them twice.',
        probe: 'Everybody keeps asking me about two winters ago.',
        deny: 'I was waxing. Ask anyone who has smelled me tonight.',
        accuse: 'The mountain does not push people. People do.',
        mourn: 'I brought him up that slope. Not that night. Not that one.',
        found: 'That is from the ski room. I would know it anywhere.',
      },
    },
    {
      id: 'doctor', name: 'Dr Halloran', archetype: 'belvedere-doctor', canBeKiller: true,
      blurb: 'You winter here for your chest, and tonight you are the only one who can certify a death.',
      secret: 'You certified the old man’s death two winters ago in nine minutes, and took a cheque for it.',
      traits: ['hands:ink', 'boots:44', 'gloves:leather'],
      lines: {
        greet: 'Keep everyone in one room and out of the cold. That is my whole advice.',
        probe: 'You are asking me what I saw. I am asking you the same thing.',
        deny: 'I was writing. I am always writing.',
        accuse: 'I have signed one certificate too many in this hotel.',
        mourn: 'There was nothing to be done by the time I reached them.',
        found: 'Careful with that — you are handling evidence.',
      },
    },
    {
      id: 'chef', name: 'Marek Novák', archetype: 'belvedere-chef', canBeKiller: true,
      blurb: 'You feed eight people and hear all of them, because nobody lowers their voice near a kitchen.',
      secret: 'You have been buying somebody’s silence with dinners since November.',
      traits: ['scent:kitchen-smoke', 'boots:42', 'hands:calloused'],
      lines: {
        greet: 'Sit. Eat. Whatever else is happening, it will happen after the soup.',
        probe: 'People say things in my kitchen they would not say in your lounge.',
        deny: 'I was at the range. The range does not leave.',
        accuse: 'I know what everyone in this hotel eats and who they eat it with.',
        mourn: 'I cooked for them tonight. That is a strange thing to carry.',
        found: 'That does not belong in my kitchen.',
      },
    },
    {
      id: 'journalist', name: 'Nadia Kowal', archetype: 'belvedere-journalist', canBeKiller: true,
      blurb: 'You came to write about a beautiful hotel in a beautiful place.',
      secret: 'You came for the accident two winters ago, and you have the file in your case.',
      traits: ['hands:ink', 'boots:38', 'left-handed'],
      lines: {
        greet: 'Do not mind me. I write things down; it is a habit, not a threat.',
        probe: 'Two winters ago. Were you here?',
        deny: 'I was taking notes. In writing. You may read them.',
        accuse: 'I have the file, and the file has a name in it.',
        mourn: 'I have written about deaths. It is different in the room.',
        found: 'Now that is worth a paragraph.',
      },
    },
    {
      id: 'guide', name: 'Sofia Lindqvist', archetype: 'belvedere-guide', canBeKiller: true,
      blurb: 'You brought the last party up before the pass closed, and you will bring them down.',
      secret: 'You know exactly who came down the mountain late, two winters ago, because you waited for them.',
      traits: ['scent:pine-wax', 'boots:42', 'limp'],
      lines: {
        greet: 'The pass is shut till the plough comes. I would not try the road.',
        probe: 'I count people up and I count them down. I am good at it.',
        deny: 'I was checking the ropes. Somebody has to.',
        accuse: 'I waited for someone in the dark once. I remember who it was.',
        mourn: 'You do not leave people on a mountain. Not ever.',
        found: 'Snow does not lie the way people do.',
      },
    },
    {
      id: 'widow', name: 'Mme Perrin', archetype: 'belvedere-widow', canBeKiller: true,
      blurb: 'You have the best room, you are in mourning, and you have been here a fortnight.',
      secret: 'The name in the register is not yours, and one person here knows your real one.',
      traits: ['scent:iris', 'boots:38', 'keys:master'],
      lines: {
        greet: 'I came here to be left alone. It appears I have failed.',
        probe: 'You look at me as though we have met.',
        deny: 'I was in my room. Where else would I be?',
        accuse: 'Everyone in this hotel is pretending. I am simply better at it.',
        mourn: 'One learns, eventually, how to stand in a room with a death in it.',
        found: 'Put that back where you found it.',
      },
    },
  ],

  acts: [
    {
      n: 1, name: 'Arrival', minutes: 18, opens: ['lobby', 'lounge'],
      objective: 'Meet everyone. Find out who was here before tonight, and who came up with the last party.',
      opening: 'The plough turns back at the second bend and the pass is shut behind it. Eight of you, one hotel, and weather that has no intention of stopping. The concierge lights the fire twice; it does not take.',
      interlude: 'The lights dip once, and come back. Somewhere below, the piste door is banging in the wind — and it should not be, because the ski room is locked at six. It is not locked now. Somebody is lying at the foot of the racks, and has been for a while.',
    },
    {
      n: 2, name: 'The house', minutes: 24,
      opens: ['lobby', 'lounge', 'kitchen', 'guest-room', 'ski-room'],
      objective: 'Search the hotel. Find what the ski room gave up, and do not be the next one alone in a room.',
      opening: 'Nobody sleeps. The doctor has done what can be done and the concierge has stopped pretending the fire matters. The house is open — the kitchen, the guest floor, the cold room below — and everyone in it has somewhere they would rather you did not look.',
      interlude: 'The generator falters, and in the twenty seconds of dark somebody screams in a part of the house where nobody should have been alone. When the lights come up there are seven of you.',
      opportunities: [
        { room: 'kitchen', prop: 'knife-block' },
        { room: 'ski-room', prop: 'racks' },
        { room: 'guest-room', prop: 'balcony' },
      ],
    },
    {
      n: 3, name: 'What we know', minutes: 18, opens: ['lobby', 'lounge'],
      objective: 'Everyone back in the lounge. Say what you have, hear what they have, and decide who it was.',
      opening: 'The concierge puts every chair in the lounge in a rough circle, which is either good sense or the worst idea anybody has had tonight. Say what you found. Say where you were. Somebody in this circle is going to have to be wrong out loud.',
      interlude: 'The wind drops, all at once, the way it does before morning. Time to name somebody.',
    },
  ],

  clues: [
    // ── what is simply true, and is found by looking at a thing ──────────────────────────────────────
    { id: 'register-name', kind: 'fact', prop: 'register', act: 1, text: 'The register says Mme Perrin, and the luggage tag under the desk says something else entirely.' },
    { id: 'wet-coat', kind: 'fact', prop: 'coat-stand', act: 1, text: 'One coat is wet through to the lining. It has been outside tonight, and not briefly.' },
    { id: 'piano-photo', kind: 'fact', prop: 'piano', act: 1, text: 'Inside the piano lid, a photograph: the old man on the piste, two winters ago, with the guide a step behind him.' },
    { id: 'fresh-wax', kind: 'fact', prop: 'wax-bench', act: 1, text: 'Wax on the bench, still tacky, and a rag thrown down beside it as though somebody stopped in the middle.' },
    { id: 'missing-keys', kind: 'fact', prop: 'keyboard', act: 2, text: 'Two hooks on the key board are empty: the ski room, and room fourteen.' },
    { id: 'wiped-glass', kind: 'fact', prop: 'drinks-tray', act: 2, text: 'Six glasses on the tray have a night’s worth of fingerprints. The seventh has been wiped clean.' },
    { id: 'burned-letter', kind: 'fact', prop: 'hearth', act: 2, text: 'Paper burned in the grate, and one corner left: a lawyer’s letterhead and the words "contest the estate".' },
    { id: 'seven-slots', kind: 'fact', prop: 'knife-block', act: 2, text: 'The block has seven slots and holds six knives.' },
    { id: 'walked-stairs', kind: 'fact', prop: 'service-stairs', act: 2, text: 'The service stairs go from the kitchen to the guest floor, and the dust on them has been walked through twice tonight.' },
    { id: 'old-file', kind: 'fact', prop: 'suitcase', act: 2, text: 'A press file on the accident of two winters ago, annotated in a left-hander’s slant.' },
    { id: 'telegram', kind: 'fact', prop: 'writing-desk', act: 2, text: 'A half-written telegram: "contesting the will — arrive Thursday — say nothing".' },
    { id: 'skis-returned', kind: 'fact', prop: 'racks', act: 2, text: 'One pair of skis is back in its rack with snow still packed in the binding.' },
    { id: 'larder-book', kind: 'fact', prop: 'larder', act: 3, text: 'The larder book: a fortnight of dinners recorded and not one of them billed to a room.' },
    { id: 'forced-balcony', kind: 'fact', prop: 'balcony', act: 3, text: 'The balcony door has been forced, from the outside, tonight.' },
    { id: 'dry-boots', kind: 'fact', prop: 'boot-dryer', act: 3, text: 'The dryer has run all evening. One pair of boots in it is bone dry — somebody wanted them to be.' },

    // ── what a death gives up: one trait of whoever did it ───────────────────────────────────────────
    { id: 'ev-boots-38', kind: 'evidence', trait: 'boots:38', text: 'A print in the snow at the piste door: a boot, size thirty-eight.' },
    { id: 'ev-boots-42', kind: 'evidence', trait: 'boots:42', text: 'A print in the snow at the piste door: a boot, size forty-two.' },
    { id: 'ev-boots-44', kind: 'evidence', trait: 'boots:44', text: 'A print in the snow at the piste door: a boot, size forty-four.' },
    { id: 'ev-wax', kind: 'evidence', trait: 'scent:pine-wax', text: 'Pine wax on the victim’s cuff — the kind that is only used downstairs, on skis.' },
    { id: 'ev-smoke', kind: 'evidence', trait: 'scent:kitchen-smoke', text: 'The victim’s collar smells of kitchen smoke, and nobody else in the room does.' },
    { id: 'ev-iris', kind: 'evidence', trait: 'scent:iris', text: 'Iris, faint, at the victim’s throat. An expensive scent, and a distinctive one.' },
    { id: 'ev-ink', kind: 'evidence', trait: 'hands:ink', text: 'Ink transferred to the victim’s collar from a hand that had been writing.' },
    { id: 'ev-calloused', kind: 'evidence', trait: 'hands:calloused', text: 'The grip on the victim’s arm was wide and rough: a working hand.' },
    { id: 'ev-left', kind: 'evidence', trait: 'left-handed', text: 'Whatever was done was done from the left.' },
    { id: 'ev-master-key', kind: 'evidence', trait: 'keys:master', text: 'The door was locked behind them, from the outside, with a master key.' },
    { id: 'ev-leather', kind: 'evidence', trait: 'gloves:leather', text: 'A leather glove-mark, quite clear, on the cold glass.' },
    { id: 'ev-wool', kind: 'evidence', trait: 'gloves:wool', text: 'Wool fibres caught in the latch, dark grey.' },
    { id: 'ev-limp', kind: 'evidence', trait: 'limp', text: 'One set of prints drags: whoever walked away from this had a limp.' },
  ],
};
