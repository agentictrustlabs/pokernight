/**
 * GENERATED FROM THE STORY ONTOLOGY — do not edit by hand.
 *
 * Source: `~/skills/ontology/belvedere-snowfall.ttl` (the story as an A-box over `story.ttl`).
 * Rebuild: `node scripts/story-to-title.mjs > packages/mystery/src/titles/belvedere-snowfall.generated.ts`
 *
 * The story names the PLACE it is set at and joins to it on one string per thing — a clue's
 * `foundAtKey` against a feature's `featureKey` — so neither document holds the other's identifiers.
 */
import type { Title } from '../types.js';

export const BELVEDERE_SNOWFALL_FROM_ONTOLOGY: Title = {
  id: 'belvedere-snowfall',
  name: "Snowfall at the Belvedere",
  venue: 'alpine-belvedere',
  blurb: "The pass is shut, the wind is up, and by morning two of the eight people in this hotel will be dead. One of you did it.",
  tone: "A death happens off the page and is described the way a novel would: no injury, no cruelty, nothing sexual.",
  evidencePerDeath: 2,
  accusationMinutes: 3,
  murderAfter: 0.5,
  openingDeath: { room: "ski-room", prop: "racks" },
  spared: {
    room: "guest-room", prop: "suitcase",
    interlude: "The generator falters, and for twenty seconds the Belvedere is as dark as the mountain. When the lights come up everybody is standing where they were — and upstairs a door is open that was locked, a case has been emptied onto a bed, and whoever did it was in a hurry and left something of themselves behind.",
  },
  plantable: { props: ["drinks-tray", "wax-bench", "knife-block", "coat-stand", "writing-desk"], traits: ["boots:38", "boots:42", "boots:44", "scent:pine-wax", "scent:iris", "scent:kitchen-smoke", "hands:ink", "hands:calloused", "gloves:leather", "gloves:wool", "left-handed", "limp", "keys:master"] },
  voice: {
    character: ["This is a grand alpine hotel in the nineteen-thirties and everybody is a little formal, even when frightened. Nobody swears; nobody says \"guys\".", "Two winters ago the old man died on the mountain. Everybody here has a reason to bring it up and a reason not to."],
    director: ["The Belvedere is stone, timber and weather. Cold rooms, a fire that will not take, a generator that falters, snow against every window.", "The register, the keys, the drinks, the skis, the service stairs — the hotel is the evidence, and it is what the house notices."],
  },
  roles: [
    {
      id: "concierge", name: "Émile Rossi", archetype: "belvedere-concierge", canBeKiller: true,
      appearance: "A small, contained man in hotel navy, moving as though the building is watching him do it.",
      look: {
        figure: "m", body: "ink", age: 58, skin: "#e0b48d", hair: "#4a423a", wear: "#1f2a33", accent: "#b8973f", hairStyle: "short", facial: "moustache",
        wardrobe: [
          { id: "uniform", name: "Night uniform", wear: "#1f2a33", accent: "#b8973f" },
          { id: "daycoat", name: "Day coat", wear: "#2c3a43", accent: "#8d9aa2" },
          { id: "shirtsleeves", name: "Shirtsleeves", wear: "#d8d2c4", accent: "#3a4148" },
        ],
      },
      blurb: "You have run the Belvedere for nineteen winters. You know which door sticks and who came down late.",
      secret: "You have been letting one guest stay all season without paying, and the books do not show it.",
      traits: ["keys:master", "boots:42", "gloves:wool"],
      choices: [
        {
          id: "concierge:books", act: 2,
          question: "The heiress asks you straight: is there a room let out of the books? Tell her now, or find her support first.",
          options: [
            { id: "tell", label: "Tell her, tonight, in front of whoever is there", outcome: "books:told", consequence: "The heiress knows, and so does the room. Her decision about the hotel is made with the books open; the staff learn the concierge told the truth when it cost him." },
            { id: "wait", label: "Deny it for now and go to the widow first", outcome: "books:hidden", consequence: "The books stay shut tonight. If the register is read closely, the concierge is caught in the lie rather than credited with the truth." },
          ],
        },
      ],
      lines: {
        greet: "The pass will not open before morning. Please, stay where it is warm.",
        probe: "I see everyone who crosses this lobby. Not everyone remembers that.",
        deny: "I was at the desk. The desk is where I always am.",
        accuse: "I keep the keys, and I know who asked me for one tonight.",
        mourn: "Nineteen winters, and never this.",
        found: "Hm. That was not there this morning.",
      },
    },
    {
      id: "heiress", name: "Delphine Aubert", archetype: "belvedere-heiress", canBeKiller: true,
      appearance: "Dressed for an evening that is not happening, and drinking as if it still might.",
      look: {
        figure: "f", body: "rose", age: 34, skin: "#f0d3b8", hair: "#6b3f22", wear: "#4a2740", accent: "#7c5372", hairStyle: "bun", accessory: "pearls",
        wardrobe: [
          { id: "evening", name: "Evening plum", wear: "#4a2740", accent: "#7c5372" },
          { id: "travelling", name: "Travelling grey", wear: "#4e5158", accent: "#8f939b" },
          { id: "furs", name: "Furs", wear: "#6b5a4a", accent: "#d8c9b4" },
        ],
      },
      blurb: "The resort is yours since your father died on the mountain two winters ago.",
      secret: "The will is being contested, and you have known for a week who is contesting it.",
      traits: ["scent:iris", "boots:38", "gloves:leather"],
      choices: [
        {
          id: "heiress:hotel", act: 2,
          question: "Restore the Belvedere on somebody else's terms, or sell it and be done with the mountain.",
          options: [
            { id: "restore", label: "Fund the restoration, with conditions", outcome: "hotel:restoring", consequence: "The hotel has a future and she has allies in it. Whoever ran the books answers to her now." },
            { id: "sell", label: "Sell it, and say so tonight", outcome: "hotel:selling", consequence: "Everybody whose winter depends on the Belvedere hears it. The concierge and the chef have nothing left to protect, which changes what they will say." },
          ],
        },
      ],
      lines: {
        greet: "My father built this place. I would rather it not be remembered for tonight.",
        probe: "You knew him, did you not? Before.",
        deny: "I was upstairs. Alone, yes — as usual.",
        accuse: "Somebody here wants what my father left, and it is not me.",
        mourn: "This house takes people. It took him too.",
        found: "Let me see that. No — let me see it properly.",
      },
    },
    {
      id: "instructor", name: "Kai Brunner", archetype: "belvedere-instructor", canBeKiller: true,
      appearance: "Broad, sunburnt to the goggle line, and the only person here still in his boots.",
      look: {
        figure: "m", body: "moss", age: 29, skin: "#d9a173", hair: "#c8a24a", wear: "#25424f", accent: "#3f7a86", hairStyle: "short", facial: "stubble", accessory: "goggles",
        wardrobe: [
          { id: "shell", name: "Piste shell", wear: "#25424f", accent: "#e0653a" },
          { id: "baselayer", name: "Base layer", wear: "#2b2f33", accent: "#5a6168" },
          { id: "apres", name: "Après jumper", wear: "#7a4536", accent: "#c9a14a" },
        ],
      },
      blurb: "You teach the guests to ski and you know the mountain better than the map does.",
      secret: "You were on the slope the night of the accident two winters ago, and you have never said so.",
      traits: ["scent:pine-wax", "boots:44", "hands:calloused"],
      choices: [
        {
          id: "instructor:friend", act: 2,
          question: "You know who was late off the hill. Name them, or defend them and say only what you saw yourself.",
          options: [
            { id: "name", label: "Name them", outcome: "party:named", consequence: "The room has a name it did not have. The instructor is believed and has lost a friend." },
            { id: "defend", label: "Defend them, and admit the limits of what you saw", outcome: "party:unnamed", consequence: "Loyalty, at the price of being doubted. The room has to find the name another way — and it can." },
          ],
        },
      ],
      lines: {
        greet: "Nobody goes out in this. I have told them twice.",
        probe: "Everybody keeps asking me about two winters ago.",
        deny: "I was waxing. Ask anyone who has smelled me tonight.",
        accuse: "The mountain does not push people. People do.",
        mourn: "I brought him up that slope. Not that night. Not that one.",
        found: "That is from the ski room. I would know it anywhere.",
      },
    },
    {
      id: "doctor", name: "Dr Halloran", archetype: "belvedere-doctor", canBeKiller: true,
      appearance: "Grey, unhurried, with a bag he has not put down since the lights dipped.",
      look: {
        figure: "m", body: "slate", age: 61, skin: "#e8c6a4", hair: "#9b9791", wear: "#5a5140", accent: "#8a7d63", hairStyle: "short", facial: "beard", accessory: "glasses",
        wardrobe: [
          { id: "tweed", name: "Tweed", wear: "#5a5140", accent: "#8a7d63" },
          { id: "consulting", name: "Consulting black", wear: "#2b2e33", accent: "#e8e4da" },
          { id: "braces", name: "Shirt and braces", wear: "#dcd6c6", accent: "#4a3a2c" },
        ],
      },
      blurb: "You winter here for your chest, and tonight you are the only one who can certify a death.",
      secret: "You certified the old man’s death two winters ago in nine minutes, and took a cheque for it.",
      traits: ["hands:ink", "boots:44", "gloves:leather"],
      choices: [
        {
          id: "doctor:certificate", act: 3,
          question: "Somebody says the old man's death was certified in nine minutes. Challenge it, or let the confident timeline stand.",
          options: [
            { id: "challenge", label: "Challenge the timeline, and admit your part in it", outcome: "accident:reopened", consequence: "The accident two winters ago is a question again. The doctor is diminished and, for once, believed." },
            { id: "stand", label: "Let it stand", outcome: "accident:closed", consequence: "The old story holds, and the room's hypothesis about tonight builds on it — which is how a room ends up sure and wrong." },
          ],
        },
      ],
      lines: {
        greet: "Keep everyone in one room and out of the cold. That is my whole advice.",
        probe: "You are asking me what I saw. I am asking you the same thing.",
        deny: "I was writing. I am always writing.",
        accuse: "I have signed one certificate too many in this hotel.",
        mourn: "There was nothing to be done by the time I reached them.",
        found: "Careful with that — you are handling evidence.",
      },
    },
    {
      id: "chef", name: "Marek Novák", archetype: "belvedere-chef", canBeKiller: true,
      appearance: "Still in his whites at this hour, with his sleeves pushed up and his hands scrubbed raw.",
      look: {
        figure: "m", body: "oak", age: 41, skin: "#c98d61", hair: "#241d19", wear: "#e8e4da", accent: "#3a3d42", hairStyle: "cap", facial: "stubble",
        wardrobe: [
          { id: "whites", name: "Kitchen whites", wear: "#e8e4da", accent: "#3a3d42" },
          { id: "service", name: "Service blacks", wear: "#23252a", accent: "#8a7a5c" },
          { id: "offduty", name: "Off duty", wear: "#3d4a3a", accent: "#6f7a5c" },
        ],
      },
      blurb: "You feed eight people and hear all of them, because nobody lowers their voice near a kitchen.",
      secret: "You have been buying somebody’s silence with dinners since November.",
      traits: ["scent:kitchen-smoke", "boots:42", "hands:calloused"],
      choices: [
        {
          id: "chef:knife", act: 2,
          question: "The knife is back in the block and it is wet. Say you washed it and why, or say nothing and let them wonder.",
          options: [
            { id: "admit", label: "Admit the lapse", outcome: "knife:explained", consequence: "One suspicion off the table, and a chef who looks honest because he was." },
            { id: "silent", label: "Say nothing", outcome: "knife:unexplained", consequence: "Suspicion falls where it will. The kitchen is searched, and the cold room with it." },
          ],
        },
      ],
      lines: {
        greet: "Sit. Eat. Whatever else is happening, it will happen after the soup.",
        probe: "People say things in my kitchen they would not say in your lounge.",
        deny: "I was at the range. The range does not leave.",
        accuse: "I know what everyone in this hotel eats and who they eat it with.",
        mourn: "I cooked for them tonight. That is a strange thing to carry.",
        found: "That does not belong in my kitchen.",
      },
    },
    {
      id: "journalist", name: "Nadia Kowal", archetype: "belvedere-journalist", canBeKiller: true,
      appearance: "Watching the room rather than the fire, and writing something down whenever it goes quiet.",
      look: {
        figure: "f", body: "brass", age: 37, skin: "#e7bb96", hair: "#1f1b18", wear: "#7d6a4a", accent: "#b5a181", hairStyle: "long", accessory: "glasses",
        wardrobe: [
          { id: "mac", name: "Press mac", wear: "#7d6a4a", accent: "#b5a181" },
          { id: "wool", name: "Wool suit", wear: "#2c3b33", accent: "#4f7a63" },
          { id: "field", name: "Field jacket", wear: "#3f4a3a", accent: "#7c8a6a" },
        ],
      },
      blurb: "You came to write about a beautiful hotel in a beautiful place.",
      secret: "You came for the accident two winters ago, and you have the file in your case.",
      traits: ["hands:ink", "boots:38", "left-handed"],
      choices: [
        {
          id: "journalist:source", act: 2,
          question: "You have enough to print. Say what you have now, or protect the source and wait until it is verified.",
          options: [
            { id: "print", label: "Say it now", outcome: "source:burned", consequence: "The room hears the accident story before it hears the evidence. Somebody in this house will never speak to her again." },
            { id: "protect", label: "Protect the source", outcome: "source:kept", consequence: "The story waits and the source stays. The room reaches the accident by evidence, or not at all." },
          ],
        },
      ],
      lines: {
        greet: "Do not mind me. I write things down; it is a habit, not a threat.",
        probe: "Two winters ago. Were you here?",
        deny: "I was taking notes. In writing. You may read them.",
        accuse: "I have the file, and the file has a name in it.",
        mourn: "I have written about deaths. It is different in the room.",
        found: "Now that is worth a paragraph.",
      },
    },
    {
      id: "guide", name: "Sofia Lindqvist", archetype: "belvedere-guide", canBeKiller: true,
      appearance: "Weathered, practical, standing nearest the door out of habit.",
      look: {
        figure: "f", body: "moss", age: 31, skin: "#dcae85", hair: "#d8c49a", wear: "#2f4a44", accent: "#c98f3a", hairStyle: "curls", accessory: "scarf",
        wardrobe: [
          { id: "fleece", name: "Mountain fleece", wear: "#2f4a44", accent: "#c98f3a" },
          { id: "guideshell", name: "Guide's shell", wear: "#3a2f28", accent: "#8a6f4e" },
          { id: "jumper", name: "Dinner jumper", wear: "#6b4a5c", accent: "#b58ba1" },
        ],
      },
      blurb: "You brought the last party up before the pass closed, and you will bring them down.",
      secret: "You know exactly who came down the mountain late, two winters ago, because you waited for them.",
      traits: ["scent:pine-wax", "boots:42", "limp"],
      choices: [
        {
          id: "guide:outside", act: 2,
          question: "Somebody wants to go out to the woodshed for the prints before the snow takes them. Take them, or refuse and keep everybody in.",
          options: [
            { id: "take", label: "Take them out", outcome: "prints:seen", consequence: "The prints at the woodshed are seen before the snow covers them. Somebody's claim about being indoors has a witness against it." },
            { id: "refuse", label: "Keep everybody in", outcome: "prints:lost", consequence: "Nobody goes out and nobody is hurt. The prints are gone by morning and the outside alibi has to be broken some other way — which it can be." },
          ],
        },
      ],
      lines: {
        greet: "The pass is shut till the plough comes. I would not try the road.",
        probe: "I count people up and I count them down. I am good at it.",
        deny: "I was checking the ropes. Somebody has to.",
        accuse: "I waited for someone in the dark once. I remember who it was.",
        mourn: "You do not leave people on a mountain. Not ever.",
        found: "Snow does not lie the way people do.",
      },
    },
    {
      id: "widow", name: "Mme Perrin", archetype: "belvedere-widow", canBeKiller: true,
      appearance: "In black, seated, and the only one here who has not once asked what happened.",
      look: {
        figure: "f", body: "ink", age: 72, skin: "#efd6c0", hair: "#c9c4bd", wear: "#20222a", accent: "#3d3f4a", hairStyle: "bun", accessory: "veil",
        wardrobe: [
          { id: "mourning", name: "Mourning black", wear: "#20222a", accent: "#3d3f4a" },
          { id: "travelling", name: "Grey travelling", wear: "#4f5058", accent: "#8b8d95" },
          { id: "shawl", name: "Shawl and wool", wear: "#4a3a44", accent: "#9a8a94" },
        ],
      },
      blurb: "You have the best room, you are in mourning, and you have been here a fortnight.",
      secret: "The name in the register is not yours, and one person here knows your real one.",
      traits: ["scent:iris", "boots:38", "keys:master"],
      choices: [
        {
          id: "widow:name", act: 2,
          question: "The register says one name and the luggage another. Explain it before you are asked, or wait to be asked.",
          options: [
            { id: "explain", label: "Explain it now", outcome: "widow:explained", consequence: "Why she is here is on the table. She is pitied rather than suspected, and the money thread has a new end to pull." },
            { id: "wait", label: "Wait to be asked", outcome: "widow:unexplained", consequence: "The discrepancy stands until somebody reads the register. When they do, she is the one who did not say." },
          ],
        },
      ],
      lines: {
        greet: "I came here to be left alone. It appears I have failed.",
        probe: "You look at me as though we have met.",
        deny: "I was in my room. Where else would I be?",
        accuse: "Everyone in this hotel is pretending. I am simply better at it.",
        mourn: "One learns, eventually, how to stand in a room with a death in it.",
        found: "Put that back where you found it.",
      },
    },
  ],
  acts: [
    {
      n: 1, name: "Arrival", minutes: 18,
      opens: ["lobby", "lounge"],
      objective: "Meet everyone. Find out who was here before tonight, and who came up with the last party.",
      opening: "The plough turns back at the second bend and the pass is shut behind it. Eight of you, one hotel, and weather that has no intention of stopping. The concierge lights the fire twice; it does not take.",
      interlude: "The lights dip once, and come back. Somewhere below, the piste door is banging in the wind — and it should not be, because the ski room is locked at six. It is not locked now. Somebody is lying at the foot of the racks, and has been for a while.",
    },
    {
      n: 2, name: "The house", minutes: 24,
      opens: ["lobby", "lounge", "kitchen", "guest-room", "ski-room"],
      opportunities: [{ room: "kitchen", prop: "knife-block" }, { room: "ski-room", prop: "racks" }, { room: "guest-room", prop: "balcony" }],
      objective: "Search the hotel. Find what the ski room gave up, and do not be the next one alone in a room.",
      opening: "Nobody sleeps. The doctor has done what can be done and the concierge has stopped pretending the fire matters. The house is open — the kitchen, the guest floor, the cold room below — and everyone in it has somewhere they would rather you did not look.",
      interlude: "The generator falters, and in the twenty seconds of dark somebody screams in a part of the house where nobody should have been alone. When the lights come up there are seven of you.",
    },
    {
      n: 3, name: "What we know", minutes: 18,
      opens: ["lobby", "lounge"],
      objective: "Everyone back in the lounge. Say what you have, hear what they have, and decide who it was.",
      opening: "The concierge puts every chair in the lounge in a rough circle, which is either good sense or the worst idea anybody has had tonight. Say what you found. Say where you were. Somebody in this circle is going to have to be wrong out loud.",
      interlude: "The wind drops, all at once, the way it does before morning. Time to name somebody.",
    },
  ],
  clues: [
    { id: "register-name", kind: "fact", prop: "register", act: 1, text: "The register says Mme Perrin, and the luggage tag under the desk says something else entirely." },
    { id: "wet-coat", kind: "fact", prop: "coat-stand", act: 1, text: "One coat is wet through to the lining. It has been outside tonight, and not briefly." },
    { id: "piano-photo", kind: "fact", prop: "piano", act: 1, text: "Inside the piano lid, a photograph: the old man on the piste, two winters ago, with the guide a step behind him." },
    { id: "fresh-wax", kind: "fact", prop: "wax-bench", act: 1, text: "Wax on the bench, still tacky, and a rag thrown down beside it as though somebody stopped in the middle." },
    { id: "missing-keys", kind: "fact", prop: "keyboard", act: 2, text: "Two hooks on the key board are empty: the ski room, and room fourteen." },
    { id: "wiped-glass", kind: "fact", prop: "drinks-tray", act: 2, text: "Six glasses on the tray have a night’s worth of fingerprints. The seventh has been wiped clean." },
    { id: "burned-letter", kind: "fact", prop: "hearth", act: 2, text: "Paper burned in the grate, and one corner left: a lawyer’s letterhead and the words \"contest the estate\"." },
    { id: "seven-slots", kind: "fact", prop: "knife-block", act: 2, text: "The block has seven slots and holds six knives." },
    { id: "walked-stairs", kind: "fact", prop: "service-stairs", act: 2, text: "The service stairs go from the kitchen to the guest floor, and the dust on them has been walked through twice tonight." },
    { id: "old-file", kind: "fact", prop: "suitcase", act: 2, text: "A press file on the accident of two winters ago, annotated in a left-hander’s slant." },
    { id: "telegram", kind: "fact", prop: "writing-desk", act: 2, text: "A half-written telegram: \"contesting the will — arrive Thursday — say nothing\"." },
    { id: "skis-returned", kind: "fact", prop: "racks", act: 2, text: "One pair of skis is back in its rack with snow still packed in the binding." },
    { id: "larder-book", kind: "fact", prop: "larder", act: 3, text: "The larder book: a fortnight of dinners recorded and not one of them billed to a room." },
    { id: "forced-balcony", kind: "fact", prop: "balcony", act: 3, text: "The balcony door has been forced, from the outside, tonight." },
    { id: "dry-boots", kind: "fact", prop: "boot-dryer", act: 3, text: "The dryer has run all evening. One pair of boots in it is bone dry — somebody wanted them to be." },
    { id: "ev-boots-38", kind: "evidence", trait: "boots:38", text: "A print in the snow at the piste door: a boot, size thirty-eight." },
    { id: "ev-boots-42", kind: "evidence", trait: "boots:42", text: "A print in the snow at the piste door: a boot, size forty-two." },
    { id: "ev-boots-44", kind: "evidence", trait: "boots:44", text: "A print in the snow at the piste door: a boot, size forty-four." },
    { id: "ev-wax", kind: "evidence", trait: "scent:pine-wax", text: "Pine wax on the victim’s cuff — the kind that is only used downstairs, on skis." },
    { id: "ev-smoke", kind: "evidence", trait: "scent:kitchen-smoke", text: "The victim’s collar smells of kitchen smoke, and nobody else in the room does." },
    { id: "ev-iris", kind: "evidence", trait: "scent:iris", text: "Iris, faint, at the victim’s throat. An expensive scent, and a distinctive one." },
    { id: "ev-ink", kind: "evidence", trait: "hands:ink", text: "Ink transferred to the victim’s collar from a hand that had been writing." },
    { id: "ev-calloused", kind: "evidence", trait: "hands:calloused", text: "The grip on the victim’s arm was wide and rough: a working hand." },
    { id: "ev-left", kind: "evidence", trait: "left-handed", text: "Whatever was done was done from the left." },
    { id: "ev-master-key", kind: "evidence", trait: "keys:master", text: "The door was locked behind them, from the outside, with a master key." },
    { id: "ev-leather", kind: "evidence", trait: "gloves:leather", text: "A leather glove-mark, quite clear, on the cold glass." },
    { id: "ev-wool", kind: "evidence", trait: "gloves:wool", text: "Wool fibres caught in the latch, dark grey." },
    { id: "ev-limp", kind: "evidence", trait: "limp", text: "One set of prints drags: whoever walked away from this had a limp." },
  ],
};

