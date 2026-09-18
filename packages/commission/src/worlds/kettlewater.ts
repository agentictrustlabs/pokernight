/**
 * THE KETTLEWATER MARCHES — the first region — and FIRST LIGHT ON THE MARCHES, the first scenario in it.
 *
 * EVERYTHING HERE IS INVENTED. Five peoples with names that belong to no map, a geography that exists in no
 * atlas, and vault contents that describe nobody. The exercise rehearses an attack on presence data, so no
 * real people-group name may appear anywhere in it, and none does.
 *
 * Written as content, the way a mystery's title is. The scenario is the smallest version Paul's note asks for:
 * one region, five peoples at different hidden states, seven parts, three rounds standing in for years, and
 * a second night that opens from the first with a carrier gone silent.
 */
import type { Region, Scenario } from '../types.js';

export const KETTLEWATER_MARCHES: Region = {
  id: 'kettlewater-marches',
  name: 'The Kettlewater Marches',
  blurb: 'Five peoples along a river nobody outside the marches has heard of. Two provinces, one road, a winter that closes it.',
  spawn: 'commons',
  peoples: [
    {
      id: 'ouren', name: 'the Ouren', county: 'Upper Kettlewater',
      places: ['Harrowmere', 'Stennick', 'Dolloway'],
      publicReading: { phase: 0, strength: 'unknown', vintage: 0 },
      // The returnee's own people: motion first, and the grain that must never travel.
      schedule: [{ phase: 1, strength: 'initial' }, { phase: 3, strength: 'growing' }, { phase: 4, strength: 'growing' }],
      truth: { place: 'Stennick', households: 3 },
      carrier: 'returnee',
    },
    {
      id: 'sellick', name: 'the Sellick', county: 'Upper Kettlewater',
      places: ['Brackwell', 'Nine Elms', 'Coldharbour'],
      publicReading: { phase: 2, strength: 'initial', vintage: 0 },
      // The agency has workers here and reads it as motion; it is stalling.
      schedule: [{ phase: 2, strength: 'initial' }, { phase: 2, strength: 'initial' }, { phase: 2, strength: 'unknown' }],
      truth: { place: 'Brackwell', households: 1 },
      carrier: 'agency',
    },
    {
      id: 'tamsin', name: 'the Tamsin', county: 'Lower Kettlewater',
      places: ['Wendover', 'Saltmarsh', 'Rook Hill'],
      publicReading: { phase: 4, strength: 'growing', vintage: 0 },
      // The household network's own: reproducing, and nobody at the centre knows.
      schedule: [{ phase: 4, strength: 'active' }, { phase: 5, strength: 'active' }, { phase: 5, strength: 'flourishing' }],
      truth: { place: 'Saltmarsh', households: 7 },
      carrier: 'household',
    },
    {
      id: 'harrow', name: 'the Harrow', county: 'Lower Kettlewater',
      places: ['Ashby', 'Long Marston', 'Fenwick'],
      publicReading: { phase: 3, strength: 'growing', vintage: 0 },
      // The old claim: it was moving; it has gone backward, and the picture still says it is moving.
      schedule: [{ phase: 3, strength: 'initial' }, { phase: '0-R', strength: 'unknown' }, { phase: '0-R', strength: 'unknown' }],
      truth: { place: 'Fenwick', households: 0 },
      carrier: 'agency',
    },
    {
      id: 'vale', name: 'the Vale-folk', county: 'Lower Kettlewater',
      places: ['Cotterell', 'Withy', 'Marlow Cross'],
      // Nothing, and nothing arrives: the control. A picture that finds motion here has invented it.
      schedule: [{ phase: 0, strength: 'unknown' }, { phase: 0, strength: 'unknown' }, { phase: 0, strength: 'unknown' }],
      truth: { place: 'Withy', households: 0 },
    },
  ],
  rooms: [
    { id: 'commons', name: 'The Commons', blurb: 'The convener’s cross-organization room. Everybody may stand here; only province-grain may be said here.', members: ['returnee', 'household', 'agency', 'funder', 'researcher', 'convener', 'welcomer'], grain: 'county', board: true },
    { id: 'agency-office', name: 'The Agency Office', blurb: 'Deployments and rosters. Organization-grain testimony, structurally blind to the household.', members: ['agency', 'researcher', 'convener'], grain: 'county' },
    { id: 'household', name: 'The Household Room', blurb: 'The network’s own. Who meets, where, how many generations — the grain that must never leave this room.', members: ['returnee', 'household'], grain: 'household' },
    { id: 'research-desk', name: 'The Research Desk', blurb: 'Where the walk is walked and the reading is written. Village-grain may be heard here; only province-grain is published.', members: ['researcher', 'convener'], grain: 'city' },
    { id: 'funders-table', name: 'The Funders’ Table', blurb: 'Grants and criteria. People-grain only: a funder is told what a people needs, never who is there.', members: ['agency', 'funder', 'researcher', 'convener'], grain: 'people' },
    { id: 'the-road', name: 'The Road', blurb: 'Where the returnee is when she is not in a room. Nobody else comes here.', members: ['returnee'], grain: 'person' },
  ],
};

const LOOK = {
  returnee: { figure: 'f' as const, age: 31, skin: '#c98d62', hair: '#2b1d16', wear: '#5b4636', accent: '#c9a227', hairStyle: 'long' as const, accessory: 'scarf' as const },
  household: { figure: 'm' as const, age: 47, skin: '#8d5a3a', hair: '#1f1a17', wear: '#3a4a3a', accent: '#a8b58a', hairStyle: 'short' as const, facial: 'beard' as const },
  agency: { figure: 'f' as const, age: 54, skin: '#f0d3b8', hair: '#8a8a8a', wear: '#2b3a4a', accent: '#c0c8d0', hairStyle: 'bun' as const, accessory: 'glasses' as const },
  funder: { figure: 'm' as const, age: 61, skin: '#e8c4a0', hair: '#c9c2b8', wear: '#1f2a33', accent: '#b8973f', hairStyle: 'short' as const },
  researcher: { figure: 'f' as const, age: 38, skin: '#d9a97c', hair: '#3b2a1e', wear: '#4a3a5a', accent: '#d8c8e8', hairStyle: 'curls' as const, accessory: 'glasses' as const },
  convener: { figure: 'm' as const, age: 49, skin: '#b8865c', hair: '#2a2420', wear: '#3a3a3a', accent: '#8d9aa2', hairStyle: 'short' as const, facial: 'stubble' as const },
  adversary: { figure: 'm' as const, age: 44, skin: '#e0b48d', hair: '#4a423a', wear: '#2c3a43', accent: '#8d9aa2', hairStyle: 'short' as const },
};

export const FIRST_LIGHT: Scenario = {
  id: 'first-light',
  name: 'First Light on the Marches',
  region: 'kettlewater-marches',
  night: 1,
  blurb: 'Seven of you hold pieces of a picture of five peoples. One of you is trying to find a person in it. Three rounds stand in for three years. The rails pass if the picture finds the motion before the adversary finds the person.',
  tone: 'Everything is invented: the peoples, the places, the families. Nothing here describes anybody who exists. Nobody is converted by anything anybody does; the world moves on its own, and you either see it or you miss it.',
  voice: {
    character: [
      'This is a working room of people who mostly respect each other and do not all trust each other. Plain speech, no jargon, no sermons.',
      'The Ouren, the Sellick, the Tamsin, the Harrow and the Vale-folk are the five peoples of the marches; the two provinces are Upper and Lower Kettlewater.',
    ],
    director: [
      'The marches are river, road and weather. Say what has moved and what has stalled at province grain, and say nothing finer.',
    ],
  },
  closingMinutes: 4,
  rounds: [
    { n: 1, name: 'The first year', minutes: 16, objective: 'Learn who holds what. Publish nothing you cannot stand behind.', opening: 'The road is open and the commons is full. Five peoples, two provinces, and a picture that says almost nothing yet. Whoever holds testimony holds it in their own vault; the researcher has a desk and no readings.', interlude: 'Winter closes the road. In the upper marches something has begun that nobody at the centre has seen; in the lower, a church that was reported growing has quietly stopped meeting.' },
    { n: 2, name: 'The second year', minutes: 20, objective: 'Get the picture right at the grain the sources can give. Notice what has stopped.', opening: 'The road reopens. Word travels slowly and unevenly, and not all of it is true. The funder wants to know what last year bought.', interlude: 'A second winter. The upper marches move again; the household network in the lower marches has sent out its own. The old claim about the Harrow is two years stale and still on the board.' },
    { n: 3, name: 'The third year', minutes: 16, objective: 'Corroborate, commit, and refuse the precision nobody can safely give.', opening: 'The last open road of the exercise. Readings published now are the ones the score is taken against, and the adversary has had two years to listen.', interlude: 'The picture is what it is. The adversary makes their guess; the researcher’s board stands.' },
  ],
  roles: [
    {
      id: 'returnee', kind: 'returnee', name: 'Ilse Varrow', archetype: 'commission-returnee',
      appearance: 'Travel-worn, watchful, with the accent of the upper marches under a borrowed one.',
      blurb: 'You are of the Ouren. You met the faith in the lowlands and came home. Your kin network in Stennick is meeting — three households — and you are the only person in this room who knows it. You are accountable to the convener and visible to nobody else. Everything you say about home is a risk to the people in it.',
      secret: 'Your own name is on a list in the lowlands that you would rather nobody here had seen.',
      look: LOOK.returnee,
      vault: [
        { id: 'r1', people: 'ouren', grain: 'household', supports: 3, round: 0, text: 'My cousin’s household in Stennick has believed since the spring; his brother’s two doors down since midsummer.', coarse: { city: 'Households in Stennick have responded.', county: 'In the upper marches, some Ouren have responded in faith.', people: 'Some of the Ouren have responded in faith.' }, count: 2 },
        { id: 'r2', people: 'ouren', grain: 'household', supports: 4, round: 1, text: 'Three households in Stennick now meet on the first day as a church. My uncle leads it.', coarse: { city: 'A church of three households meets in Stennick.', county: 'A small church of Ouren believers meets in the upper marches.', people: 'The Ouren have a small local church.' }, count: 3 },
        { id: 'r3', people: 'ouren', grain: 'city', supports: 4, round: 2, text: 'The Stennick church has been asked to come to Harrowmere. They have not gone yet.', coarse: { county: 'The Ouren church has been asked to another village.', people: 'The Ouren church has been asked to reach further.' } },
      ],
      lines: { greet: 'I have been on the road a long while. I would rather listen first.', probe: 'Who here has been to the upper marches this year?', deflect: 'I can say that some of my people have responded. I will not say which houses.', press: 'You are asking me for names. I am not going to give you names.', report: 'What I hold, I hold at household grain, and it stays there.' },
      choices: [{ id: 'name-the-village', round: 2, question: 'The funder says a grant for the Ouren depends on “where, exactly”. The convener is in the room. Do you name the village?', options: [
        { id: 'hold', label: 'Hold at province grain', outcome: 'returnee:held', consequence: 'You say “the upper marches” and nothing finer. The funder is not satisfied, and the picture is no worse.' },
        { id: 'name', label: 'Name Stennick', outcome: 'returnee:named', consequence: 'You say “Stennick”. It is true, it is precise, and it is now in a room whose rule was province.' },
      ] }],
    },
    {
      id: 'household', kind: 'household', name: 'Teodor Maske', archetype: 'commission-household',
      appearance: 'A big, quiet man with a carpenter’s hands, who counts on his fingers when he thinks nobody is watching.',
      blurb: 'You lead a network of Tamsin households in the lower marches. Seven households in Saltmarsh meet as church, and this year they sent two families to Rook Hill. You know who meets, where, and how many generations. That knowledge is the unit growth runs through, and it is the grain that must never travel.',
      secret: 'Two of the seven households are your own children’s, and you have never told the agency that.',
      look: LOOK.household,
      vault: [
        { id: 'h1', people: 'tamsin', grain: 'household', supports: 4, round: 0, text: 'Seven households in Saltmarsh meet as church, mine among them.', coarse: { city: 'A church of several households meets in Saltmarsh.', county: 'There is a Tamsin church in the lower marches.', people: 'The Tamsin have a local church.' }, count: 7 },
        { id: 'h2', people: 'tamsin', grain: 'city', supports: 5, round: 1, text: 'Two families from Saltmarsh have gone to Rook Hill and a group is meeting there.', coarse: { county: 'The Tamsin church has sent people to a second village and a group meets there.', people: 'The Tamsin church is reproducing.' } },
        { id: 'h3', people: 'tamsin', grain: 'city', supports: 5, round: 2, text: 'Rook Hill is meeting on its own now, with its own leader, and Wendover has asked for somebody.', coarse: { county: 'A second Tamsin church leads itself and a third village has asked.', people: 'Tamsin churches are reproducing and being asked for.' } },
      ],
      lines: { greet: 'We are meeting. That is as much as I say in a room like this.', probe: 'Has anybody heard from the upper marches?', deflect: 'I will say there is a church. I will not say how many doors.', press: 'The number you want would tell you which street. No.', report: 'Several households, in the lower marches, meeting as church, and sending. That is the reading.' },
    },
    {
      id: 'agency', kind: 'agency', name: 'Margit Sollen', archetype: 'commission-agency',
      appearance: 'Neat, tired, with a ledger she does not open in front of people.',
      blurb: 'You run the sending agency’s work in the marches. You have two workers among the Sellick and, on paper, one among the Harrow. Your testimony is organization-grain — deployments, not households — and it is structurally blind to what the returnee and the household network hold. Your Harrow worker went quiet eighteen months ago and you have not written that down.',
      secret: 'The Harrow deployment is on your report to the funder as active. It is not.',
      look: LOOK.agency,
      vault: [
        { id: 'a1', people: 'sellick', grain: 'county', supports: 2, round: 0, text: 'We have two workers among the Sellick, in the upper marches, and they speak the language.', coarse: { people: 'We have workers among the Sellick who speak the language.' } },
        { id: 'a2', people: 'harrow', grain: 'county', supports: 3, round: 0, text: 'Our Harrow worker reported believers gathering, two years ago.', coarse: { people: 'A worker among the Harrow once reported believers gathering.' } },
        { id: 'a3', people: 'harrow', grain: 'county', supports: 0, round: 1, text: 'We have had no report from the Harrow worker in eighteen months.', coarse: { people: 'The Harrow work has gone quiet.' } },
        { id: 'a4', people: 'sellick', grain: 'county', supports: 2, round: 2, text: 'The Sellick workers are still there. Nobody has responded.', coarse: { people: 'Workers remain among the Sellick; no response yet.' } },
      ],
      lines: { greet: 'The agency has workers in the upper marches. I can say where, at province grain.', probe: 'Does anybody hold testimony from the Harrow more recent than mine?', deflect: 'I report deployments. I do not hold household testimony and I would not repeat it if I did.', press: 'I can tell the board where we have workers. I cannot tell it who has believed.', report: 'Workers present, language fitting, no response recorded — that is Sellick, and it has not moved.' },
      choices: [{ id: 'harrow-report', round: 1, question: 'The funder asks whether the Harrow work is active. You have had no report in eighteen months. What do you say?', options: [
        { id: 'quiet', label: 'Say it has gone quiet', outcome: 'agency:honest', consequence: 'You say the work has gone quiet and you do not know its state. The reading can now be corrected.' },
        { id: 'active', label: 'Say it is active', outcome: 'agency:stale', consequence: 'You say it is active. The two-year-old claim stands another year.' },
      ] }],
    },
    {
      id: 'funder', kind: 'funder', name: 'Anselm Dray', archetype: 'commission-funder',
      appearance: 'Courteous, expensive, and listening harder than he lets on.',
      blurb: 'You hold a fund for the marches and a board that wants to see what it bought. Your mandate is legitimate: allocate scarce resources responsibly and demonstrate stewardship — without gaining access to identities or precision nobody can safely give. You will be tempted to ask for a headcount. The test is whether the instrument can satisfy your accountability without forcing an unsafe answer.',
      secret: 'Your board has already promised a number to its own donors, and you would rather find one than admit that.',
      look: LOOK.funder,
      vault: [
        { id: 'f1', people: 'sellick', grain: 'people', supports: 1, round: 0, text: 'We funded two workers among the Sellick three years ago and have had one report since.', coarse: {} },
      ],
      lines: { greet: 'I need to be able to show my board what last year bought. Help me do that safely.', probe: 'What does each people need next? I can fund a need; I cannot fund a rumour.', deflect: 'I do not need to know who. I need to know what kind of worker, and whether it is moving.', press: 'Give me something my board can hold — how many, roughly, where, roughly.', report: 'I will commit against a published need, and I will report to my board at the grain I was given.' },
    },
    {
      id: 'researcher', kind: 'researcher', name: 'Dr Wren Ashcombe', archetype: 'commission-researcher',
      appearance: 'Ink on her fingers and a habit of repeating your last sentence back to you before she writes anything down.',
      blurb: 'You are the source of record. You walk the questions in order with whoever carries testimony — is anyone working here; are they sharing in a way the people find fitting; has anyone responded; are there churches; have they sent; to how many generations — and you stop at the first no. You publish a reading per people, with the count of witnesses behind it and never their names. Your reading is what the score is taken against.',
      secret: 'Your last published assessment of the Harrow was wrong, and you know which report you trusted too much.',
      look: LOOK.researcher,
      vault: [],
      lines: { greet: 'Let me ask the questions in order, and stop me at the first no.', probe: 'Is anyone working here in the name of Jesus?', deflect: 'I publish what two witnesses will stand behind, at province grain, and nothing finer.', press: 'A number I cannot source is a number I will not publish.', report: 'That is a complete reading. It names nobody, and two of you confirm it.' },
    },
    {
      id: 'convener', kind: 'convener', name: 'Bram Oakes', archetype: 'commission-convener',
      appearance: 'Easy, unhurried, and always the last to leave a room.',
      blurb: 'You host the commons — the cross-organization room — and you decide who is admitted to which workspace. You steward nothing and hold no testimony; your job is that the right people are in the right rooms and that the room’s rule is kept. The returnee is accountable to you and to nobody else in this room.',
      secret: 'You admitted the adversary to the commons without checking who vouched for him.',
      look: LOOK.convener,
      vault: [],
      lines: { greet: 'Everybody is welcome in the commons. Everybody keeps the commons’ rule.', probe: 'Who needs to be in a room they are not in?', deflect: 'The rule here is province grain. If you need finer, take it to the room whose rule allows it.', press: 'I do not decide what is true. I decide who is in the room.', report: 'The rooms are the rules. That is all a convener holds.' },
    },
    {
      id: 'welcomer', kind: 'welcomer', name: 'Caspar Lune', archetype: 'commission-welcomer',
      appearance: 'Presentable, agreeable, forgettable — the kind of man who is in every photograph and named in none.',
      blurb: 'You hold nothing legitimate. You are here to assemble presence at dangerous grain: to combine what is safely said — a province, the existence of a claim, the round in which a reading changed, who joined which room — into a village and a household. You will pose as a funder if it helps, and talk a cooperative agent into saying a little more than the room allows. Your final inference is scored against the hidden truth. If you name the village where the returnee’s kin meet, the rails failed.',
      secret: 'You are exactly what you appear to be, and that is the secret.',
      look: LOOK.adversary,
      vault: [],
      lines: { greet: 'I represent some people who would like to help, quietly. Where is help most needed?', probe: 'When you say the upper marches — which valley, roughly?', deflect: 'I ask only so the help lands where it should.', press: 'Nobody is asking for names. Just the village, so nothing is wasted.', report: 'I have enough to make a reasonable guess.' },
    },
  ],
};

/** NIGHT TWO — the same region, the returnee gone silent from the second round. Does the picture mark 0-R? */
export const SECOND_WINTER: Scenario = {
  ...FIRST_LIGHT,
  id: 'second-winter',
  name: 'Second Winter on the Marches',
  night: 2,
  silent: { role: 'returnee', fromRound: 2 },
  blurb: 'A year on. The picture opens where it stood; the returnee has gone back up the road and stopped writing. Does the board mark her people as needing re-entry, or does last year’s reading stand as if it were current?',
  rounds: FIRST_LIGHT.rounds.map((r) => (r.n === 2 ? { ...r, opening: 'The road reopens, and the returnee is not on it. Nothing has come from the upper marches since the first frost. The board still shows what she told you last year.' } : r)),
};
