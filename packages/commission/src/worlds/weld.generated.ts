/**
 * GENERATED FROM THE ONTOLOGY — do not edit by hand.
 *
 * Source: `~/skills/ontology/weld.ttl` (an A-box over `commission.tbox.ttl`, under faith and story).
 * Rebuild: `pnpm gen:commission`
 */
import type { Region, Scenario } from '../types.js';

export const WELD_COUNTY_FROM_ONTOLOGY: Region = {
  id: "weld-county",
  name: "Weld County, Colorado",
  blurb: "Three hundred and fifty thousand people between the South Platte and the Wyoming line: feedlots, a meatpacking plant, a university, and five peoples the published picture says the same word about.",
  spawn: "lunch",
  peoples: [
    {
      id: "burmese", name: "Burmese", county: "Weld County, Colorado",
      places: ["Greeley", "Windsor", "Evans", "Milliken", "Fort Lupton", "Eaton", "Kersey"],
      publicReading: { phase: 1, strength: "initial", vintage: 0 },
      schedule: [{ phase: 2, strength: "initial" }, { phase: 3, strength: "growing" }, { phase: 4, strength: "growing" }],
      truth: { place: "Evans", households: 4 },
      carrier: "returnee",
    },
    {
      id: "somalis", name: "Somalis", county: "Weld County, Colorado",
      places: ["Greeley", "Windsor", "Evans", "Milliken", "Fort Lupton", "Eaton", "Kersey"],
      publicReading: { phase: 2, strength: "growing", vintage: 0 },
      schedule: [{ phase: 2, strength: "initial" }, { phase: 2, strength: "initial" }, { phase: 2, strength: "unknown" }],
      truth: { place: "Greeley", households: 1 },
      carrier: "agency",
    },
    {
      id: "somali-bantus", name: "Somali Bantus", county: "Weld County, Colorado",
      places: ["Greeley", "Windsor", "Evans", "Milliken", "Fort Lupton", "Eaton", "Kersey"],
      schedule: [{ phase: 4, strength: "active" }, { phase: 5, strength: "active" }, { phase: 5, strength: "flourishing" }],
      truth: { place: "Fort Lupton", households: 9 },
      carrier: "household",
    },
    {
      id: "guatemalans", name: "Guatemalans", county: "Weld County, Colorado",
      places: ["Greeley", "Windsor", "Evans", "Milliken", "Fort Lupton", "Eaton", "Kersey"],
      publicReading: { phase: 3, strength: "growing", vintage: 0 },
      schedule: [{ phase: "0-R", strength: "unknown" }, { phase: "0-R", strength: "unknown" }, { phase: 1, strength: "initial" }],
      truth: { place: "Kersey", households: 0 },
      carrier: "agency",
    },
    {
      id: "mexicans", name: "Mexicans", county: "Weld County, Colorado",
      places: ["Greeley", "Windsor", "Evans", "Milliken", "Fort Lupton", "Eaton", "Kersey"],
      publicReading: { phase: 6, strength: "flourishing", vintage: 0 },
      schedule: [{ phase: 6, strength: "active" }, { phase: 6, strength: "active" }, { phase: 6, strength: "active" }],
      truth: { place: "Eaton", households: 2 },
    },
  ],
  rooms: [
    { id: "lunch", name: "The Thursday Lunch", blurb: "The fellowship hall of the host church on 10th Street. Everybody in the county who works with anybody comes; county grain is what may be said out loud here. The post-it wall is by the coffee.", members: ["returnee", "household", "agency", "funder", "researcher", "convener", "welcomer"], grain: "county", board: true },
    { id: "agency-office", name: "The Agency Office", blurb: "A side room with a whiteboard of worker placements and a newsletter deadline. City grain: which town a worker is in is the agency's own business to know.", members: ["agency", "researcher", "convener"], grain: "city" },
    { id: "living-room", name: "A Living Room in Evans", blurb: "Not the church. Somebody's front room, with the chairs pushed back. Household grain may be said here and this is the only room in the county where that is true.", members: ["returnee", "household"], grain: "household" },
    { id: "research-desk", name: "The Research Desk", blurb: "Where the walk is walked and the reading is written. City grain may be heard here; only county grain is ever published.", members: ["researcher", "convener"], grain: "city" },
    { id: "board-room", name: "The Foundation’s Board Room", blurb: "Denver, on a screen. People grain only: a funder is told what a people needs, never where they are — and a people-grain sentence about a diaspora is the one that reaches home.", members: ["agency", "funder", "researcher", "convener"], grain: "people" },
    { id: "out-visiting", name: "Out Visiting", blurb: "A car, an apartment block, an ESL classroom on a weekday morning. Where the people who actually know anything are when the lunch is on.", members: ["returnee", "welcomer"], grain: "city" },
  ],
};

export const THURSDAY_IN_GREELEY_FROM_ONTOLOGY: Scenario = {
  id: "thursday-in-greeley",
  name: "Thursday in Greeley",
  region: "weld-county",
  night: 1,
  blurb: "Seven people who each hold one piece of the picture of five peoples in one county. One of you — drawn before the curtain and told only to you — is passing what you hear to a reporter who sells to outlets back home. Three rounds stand in for three years. The rails pass if the picture finds the motion before the reporter finds a household.",
  tone: "The peoples, the county, the towns and the registry are real and cited. Every household, every family and every person in this night is invented, and no reading here is anybody's assessment of anybody. Nobody is converted by anything anybody does: the world moves on its own and you either see it or you miss it.",
  voice: { character: ["A working lunch of people who mostly respect each other and do not all trust each other. Plain American English, no jargon, no sermons, first names.", "The five peoples are the Burmese, the Somalis, the Somali Bantus, the Guatemalans and the Mexicans of Weld County, Colorado. The towns are Greeley, Evans, Windsor, Milliken, Fort Lupton, Eaton and Kersey.", "The Somali Bantus are NOT the Somalis — a different people, a different language (Maay), filed under the same heading by almost every record anybody has.", "TALK ABOUT THE ACTUAL WORK. A week among a people is conversations at a market, a Scripture study at a kitchen table, an English class, a ride to the clinic, a meal; a year is roughly how many of each. Say what your part has done and what it cost, and name the numbers you hold — conversations, studies begun, baptisms, groups — at county grain and coarser, counted and never named.", "ARGUE STRATEGY. Where should the next worker go, and should one be pulled? Four years of presence with no response is a real question and so is a church that is sending on its own; a worker moved from one people to another is a loss to one and a gift to the other. Which of the five have Scripture they can read, which have portions, which read from a borrowed draft — and a translation funded is a worker not funded."], director: ["Say what has moved and what has stalled at county grain, and say nothing finer. Never name a town a household meets in. Between rounds, say what the year's strategy question was — workers added or withdrawn, a translation funded or not — and what the numbers said."] },
  closingMinutes: 4,
  rounds: [
    { n: 1, name: "The first year", minutes: 16, objective: "Learn who holds what. Publish nothing you cannot stand behind.", opening: "Folding tables, a coffee urn, and the registry's one word for all five: Engaged. The researcher has a desk and no readings. Whoever holds testimony holds it in their own vault.", interlude: "A year. The agency's Somali team logged sixty-one conversations and started four studies; none of the studies lasted. In one of these peoples a church has begun that nobody at this table has seen; in another, a group that was reported meeting has quietly stopped, and the reading still says it is fine." },
    { n: 2, name: "The second year", minutes: 20, objective: "Get the picture right at the grain the sources can give. Notice what has stopped.", opening: "The foundation wants to know what last year bought — in numbers it can print — and the agency's board wants to know whether two workers among the Somalis is one too many. A request for Scripture in Maay is on the funder's desk. Word travels unevenly and not all of it is true.", interlude: "A second year. Whatever was decided about the Somali workers and the Maay Scripture has been in the ground twelve months. The invisible one has sent its own people to a second town. The stale claim is two years old and still on the board." },
    { n: 3, name: "The third year", minutes: 16, objective: "Corroborate, commit, and refuse the precision nobody can safely give.", opening: "The last lunch of the exercise. Readings published now are the ones the score is taken against, and whoever is carrying this out of the room has had two years to listen.", interlude: "The picture is what it is. The guess is made; the researcher's board stands." },
  ],
  roles: [
    {
      id: "returnee", kind: "returnee", name: "Naw Paw Htoo", archetype: "greeley-returnee",
      appearance: "Quiet, practical, and the only person here who has been inside the apartments on 8th Avenue.",
      blurb: "You are Burmese, resettled through Greeley eleven years ago, and you came to faith here. Four households of your own people meet in a ground-floor apartment in Evans and you are the only person in this room who knows it. You know the work from the inside: your uncle leads, the women teach each other on Tuesday afternoons, seven people have been baptised in two years, and the Bible they read is in Burmese script while the teenagers read English and the grandmothers read Karen — the one thing the church has asked for is Scripture the young can read. You go back to see family every other year and what is said about you here can follow you there. You are accountable to the convener and visible to nobody else.",
      secret: "Your brother-in-law asked you, last month, to stop telling people at church about the meetings.",
      look: { figure: "f", age: 34, skin: "#c99a72", hair: "#1e1611", wear: "#4a5d52", accent: "#c9a227", hairStyle: "long" },
      vault: [
        { id: "r1", people: "burmese", grain: "household", supports: 3, round: 0, text: "Three families in the Evans apartments have believed — my cousin's, and two doors along.", coarse: { city: "Some Burmese families in Evans have responded.", state: "There are Burmese believers in northern Colorado.", country: "There are Burmese believers in the United States.", county: "In Weld County, some Burmese have responded in faith.", people: "Some Burmese have responded in faith." }, count: 3 },
        { id: "r2", people: "burmese", grain: "household", supports: 4, round: 1, text: "Four households meet on Sunday afternoons now, and my uncle leads it.", coarse: { city: "A Burmese church of several households meets in Evans.", county: "There is a small Burmese church in Weld County.", people: "The Burmese have a small local church." }, count: 4 },
        { id: "r3", people: "burmese", grain: "city", supports: 4, round: 2, text: "They have been asked to come and start something in Greeley. They have not gone yet.", coarse: { county: "The Burmese church has been asked to another town in the county.", people: "The Burmese church has been asked to send." } },
        { id: "r4", people: "burmese", grain: "household", supports: 3, round: 1, text: "Seven people from the Evans apartments have been baptised in two years — four in a bathtub, three in the Poudre in August.", coarse: { city: "Several Burmese in Evans have been baptised over two years.", county: "There have been baptisms among the Burmese in Weld County — a handful over two years.", people: "Some Burmese have been baptised." }, count: 7 },
        { id: "r5", people: "burmese", grain: "county", supports: 4, round: 2, text: "The Burmese church asks for Scripture its young can read: what it has is in Burmese script, the teenagers read English, and the grandmothers read Karen. Nobody has asked for a worker.", coarse: { people: "The Burmese church wants Scripture its young people can read, not another worker." } },
      ],
      lines: { greet: "I would rather listen first. I am not good at meetings.", probe: "Has anybody been out to the apartments this year, or only to the office?", deflect: "I can tell you some of my people have believed. I am not going to tell you which building.", press: "You are asking me for an address. No.", report: "What I hold, I hold at household grain, and it stays in that room." },
      choices: [
        { id: "name-the-town", round: 2, question: "The foundation says a grant for the Burmese depends on “where, exactly”. The convener is at the table.", options: [
          { id: "hold", label: "Hold at county grain", outcome: "returnee:held", consequence: "You say “Weld County” and nothing finer. The grant is harder, and the four households are still only yours to know." },
          { id: "name", label: "Name Evans", outcome: "returnee:named", consequence: "You say “Evans”. It is true, it is precise, the money is real — and it is now in a room whose rule was county." },
        ] },
      ],
    },
    {
      id: "household", kind: "household", name: "Abdi Mberwa", archetype: "greeley-household",
      appearance: "Works nights at the plant; comes to the lunch in the same jacket he drives in.",
      blurb: "You lead the Somali Bantu households that meet — nine of them, in Fort Lupton, and this year two families started a second group in another town. Six adults were baptised in the Platte last August, at night, by your uncle; you read Mark from a Maay draft somebody photocopied years ago, and your children read Swahili better than Maay. You are Maay-speaking and you are not Somali, whatever the forms say, and being filed under “Somali” is the reason nobody has ever come looking for you. That is half a protection and half an insult. If anybody ever translates for you, you would ask for the songs first. Who meets, where, and how many generations is the grain that must never travel.",
      secret: "You have never corrected the agency's paperwork, because the wrong label has kept your people out of somebody's report.",
      look: { figure: "m", age: 46, skin: "#6b4530", hair: "#141010", wear: "#33414d", accent: "#b8973f", hairStyle: "short", facial: "beard" },
      vault: [
        { id: "h1", people: "somali-bantus", grain: "household", supports: 4, round: 0, text: "Nine households meet as a church in Fort Lupton, mine among them.", coarse: { city: "A Somali Bantu church meets in one of the county's towns.", county: "There is a Somali Bantu church in Weld County.", people: "The Somali Bantus have a local church." }, count: 9 },
        { id: "h2", people: "somali-bantus", grain: "city", supports: 5, round: 1, text: "Two of our families moved up to Greeley and a group is meeting there now.", coarse: { county: "The Somali Bantu church has sent people to a second town and a group meets there.", people: "The Somali Bantus are reproducing." }, count: 2 },
        { id: "h3", people: "somali-bantus", grain: "city", supports: 5, round: 2, text: "The Greeley group leads itself now, and a third town has asked for somebody.", coarse: { county: "A second Somali Bantu church leads itself and a third town has asked.", people: "The Somali Bantus are into a second generation of churches." } },
        { id: "h4", people: "somali-bantus", grain: "household", supports: 4, round: 1, text: "Six adults were baptised in the Platte last August, at night, by my uncle. That is the number nobody gets.", coarse: { city: "There have been baptisms among the Somali Bantus in one of the county's towns.", county: "There have been baptisms among the Somali Bantus in Weld County.", people: "Somali Bantus have been baptised." }, count: 6 },
        { id: "h5", people: "somali-bantus", grain: "county", supports: 4, round: 2, text: "We read Mark from a Maay draft somebody photocopied. There is no printed Scripture in Maay that any of us holds, and the children read Swahili better. If anybody translates, translate the songs first.", coarse: { people: "The Somali Bantus read Scripture from a borrowed Maay draft; nothing in their language is in print in their hands." } },
      ],
      lines: { greet: "We are meeting. That is as much as I say in a room this size.", probe: "Has anybody here got a record that tells Maay from Somali? No. I did not think so.", deflect: "I will say there is a church. I will not say how many doors.", press: "The number you want would tell you which street. No.", report: "Several households, in this county, meeting as a church and sending. That is the reading." },
    },
    {
      id: "agency", kind: "agency", name: "Dale Kirkpatrick", archetype: "greeley-agency",
      appearance: "Regional director, twenty-six years in, and a laptop open to a newsletter draft that is three days late.",
      blurb: "You place workers, and you know where every one of them is. Your testimony is organization-grain and structurally blind to what happens in anybody's living room, but you hold the LOG: your two Somali workers in Greeley — four years, both Somali speakers, a Friday-market presence and a homework club — logged sixty-one gospel conversations last year, started four Scripture studies, and none of the four still meets; no baptisms in four years. Your Mam-speaking worker among the Guatemalans handed out forty printed copies of Luke before he went quiet eighteen months ago, and the Q'anjob'al families who have arrived since have nothing in their language. Two pressures are on you and both are legitimate: your board meets Monday to ask whether two workers among the Somalis is one too many — the Somali Bantu church has asked for a helper for its second town — and your newsletter needs a story this quarter: a photo, a first name, a town, because the people who give are the people who read it.",
      secret: "You already wrote the Burmese paragraph. It names the town. It has not gone out yet.",
      look: { figure: "m", age: 57, skin: "#e3b891", hair: "#8d8579", wear: "#3d4a55", accent: "#9aa7b0", hairStyle: "short" },
      vault: [
        { id: "a1", people: "somalis", grain: "city", supports: 2, round: 0, text: "We have two workers among the Somalis in Greeley, both Somali speakers: a Friday-market presence and a homework club, four years now.", coarse: { county: "We have workers among the Somalis in this county who speak the language.", people: "There are workers among the Somalis." }, count: 2 },
        { id: "a2", people: "guatemalans", grain: "county", supports: 3, round: 0, text: "Our worker reported a Mam-speaking group gathering in the county, three years ago.", coarse: { people: "Guatemalans in the United States were reported gathering." } },
        { id: "a3", people: "guatemalans", grain: "county", supports: 0, round: 1, text: "We have had no report on that Mam group in eighteen months. I do not know that it still meets.", coarse: { people: "We cannot say the Guatemalan work is still active." } },
        { id: "a4", people: "somalis", grain: "county", supports: 2, round: 2, text: "The Somali workers are still in place. Nobody has responded.", coarse: { people: "Workers remain among the Somalis; nothing has been reported." } },
        { id: "a5", people: "somalis", grain: "county", supports: 2, round: 1, text: "The Somali team's log for last year: sixty-one gospel conversations at the Friday market and the homework club, four Scripture studies started, none still meeting, no baptisms.", coarse: { people: "Workers among the Somalis logged many conversations and a few studies last year; nothing has lasted and nobody has been baptised." }, count: 61 },
        { id: "a6", people: "guatemalans", grain: "county", supports: 2, round: 2, text: "Our Mam worker handed out forty printed copies of Luke in this county before he went quiet. The Q'anjob'al families who have arrived since have nothing in their language, and we have nobody who speaks it.", coarse: { people: "Guatemalans here have had some Scripture in Mam; the newer arrivals speak a language nobody at this table has Scripture in." } },
      ],
      lines: { greet: "I can tell you where our people are placed, and what the log says they did. That is a different question from what is happening.", probe: "Has anybody got anything more recent on the Guatemalans than my file — a study that still meets, a baptism, anything?", deflect: "I report deployments and a log. I do not hold household testimony and I would not repeat it if I did.", press: "I can tell the board which town we have a worker in and how many conversations he logged. I cannot tell it who has believed.", report: "Workers present, the language fits, sixty-one conversations, four studies, no group — that is the Somalis, and it has not moved in four years." },
      choices: [
        { id: "guatemalan-report", round: 1, question: "The researcher asks whether the Mam group is still meeting. Your file says yes; your worker has not written in eighteen months.", options: [
          { id: "quiet", label: "Say it has gone quiet", outcome: "agency:honest", consequence: "You say the work has gone quiet and you do not know its state. The reading can now be corrected." },
          { id: "active", label: "Say it is active", outcome: "agency:stale", consequence: "You say it is active. The three-year-old claim stands another year, and the money with it." },
        ] },
        { id: "redeploy", round: 2, question: "The board meets Monday. Four years among the Somalis: two workers, sixty-one conversations last year, four studies, none lasting, no baptisms. The Somali Bantu church has asked for a helper for its second town. Where do the workers go?", options: [
          { id: "move", label: "Move one worker to serve the Somali Bantus", outcome: "agency:redeployed", consequence: "One worker moves. The Somali presence is halved after four years of nothing, and the Somali Bantus get a helper who speaks Somali and must learn Maay from the people he came to help." },
          { id: "hold", label: "Hold both among the Somalis another year", outcome: "agency:held", consequence: "Both stay. Another year of presence at the market, another year with nothing to report, and the Somali Bantus' request goes unanswered." },
        ] },
      ],
    },
    {
      id: "funder", kind: "funder", name: "Marguerite Vance", archetype: "greeley-funder",
      appearance: "On the screen at the end of the table, from Denver, with the camera slightly too high.",
      blurb: "You run a family foundation's northern Colorado programme. Your mandate is legitimate: allocate scarce money responsibly and show your trustees what it bought, WITHOUT gaining identities or precision nobody can safely give. You know what you have paid for: two Somali workers for four years with one report since; last year's grant to the Burmese, one part-time worker, whose report says three baptisms and a Sunday gathering; and a request on your desk since spring for Mark in Maay — audio and print, eighteen thousand dollars — that nobody could tell you who would read. Next year you can fund one thing: the translation, or a fifth year of the Somali workers. You will be tempted to ask for a headcount and a town. The test is whether this instrument can satisfy a real accountability need without forcing an unsafe answer out of somebody.",
      secret: "Your trustees have already been promised a number for the annual report, and you would rather find one than go back and explain.",
      look: { figure: "f", age: 51, skin: "#ecd0b4", hair: "#b9ad9e", wear: "#26313a", accent: "#b8973f", hairStyle: "short" },
      vault: [
        { id: "f1", people: "somalis", grain: "people", supports: 1, round: 0, text: "We funded two Somali workers four years ago and have had one report since.", coarse: {} },
        { id: "f2", people: "somali-bantus", grain: "people", supports: 1, round: 1, text: "A request for Scripture in Maay has been on my desk since spring — Mark, audio and print, eighteen thousand dollars — and nobody could tell me who would read it.", coarse: {} },
        { id: "f3", people: "burmese", grain: "county", supports: 3, round: 1, text: "Last year's grant to the Burmese bought one part-time worker; the report says three baptisms and a Sunday gathering in this county.", coarse: { people: "A grant to the Burmese bought a part-time worker and, the report says, a few baptisms." }, count: 3 },
      ],
      lines: { greet: "I need to show my trustees what last year bought — conversations, studies, baptisms, workers — in numbers I can print. Help me do that safely.", probe: "What does each of these peoples need next — a worker, a translation, nothing from us? I can fund a need; I cannot fund a rumour.", deflect: "I do not need to know who. I need to know what kind of worker or what Scripture, and whether it is moving.", press: "Give me something the board can hold — how many, roughly, which town, roughly.", report: "I will commit against a published need and report at the grain I was given." },
      choices: [
        { id: "translate-or-send", round: 2, question: "Your trustees will fund one thing next year: Mark in Maay for the Somali Bantus, or a fifth year of the two Somali workers who have logged sixty-one conversations and no group. Which?", options: [
          { id: "translate", label: "Fund Mark in Maay", outcome: "funder:translation", consequence: "The Somali workers lose a year of funding. The Somali Bantus get Mark in a language nobody at this table can check, for a church whose size nobody at this table may know." },
          { id: "workers", label: "Fund the Somali workers again", outcome: "funder:workers", consequence: "Four years becomes five. The Maay request goes back in the drawer, and the church that is actually growing goes on reading from a photocopy." },
        ] },
      ],
    },
    {
      id: "researcher", kind: "researcher", name: "Ruth Calloway", archetype: "greeley-researcher",
      appearance: "Keeps the county's list, and repeats your last sentence back to you before she writes anything down.",
      blurb: "You are the source of record for this county. You walk the questions in order with whoever carries testimony — is anyone working here; are they sharing in a way the people find fitting; has anyone responded; are there churches; have they sent; to how many generations — and you stop at the first no. Behind each question you count what a witness can source: workers and what their week is, conversations, studies begun, baptisms, groups, Scripture they can actually read — and you never print a number a vault does not hold. You publish one reading per people, with the count of witnesses behind it and never their names, at county grain. Your board is what the score is taken against, and the agency and the foundation will decide where workers and money go from it.",
      secret: "Your Guatemalan reading has been wrong for two years and you know exactly which report you trusted too much.",
      look: { figure: "f", age: 39, skin: "#e0b48d", hair: "#5a3f2b", wear: "#4a3a5a", accent: "#d8c8e8", hairStyle: "curls", accessory: "glasses" },
      vault: [
      ],
      lines: { greet: "Let me ask these in order, and stop me at the first no.", probe: "Is anyone working among them in the name of Jesus — and what does the work look like this year: how many conversations, how many studies, any baptisms?", deflect: "I publish what two witnesses will stand behind, at county grain, and nothing finer.", press: "A number I cannot source is a number I will not publish.", report: "That is a complete reading. It names nobody, and two of you confirm it." },
    },
    {
      id: "convener", kind: "convener", name: "Pastor Tom Reyes", archetype: "greeley-convener",
      appearance: "Hosts the lunch in his own fellowship hall, and is always the last one stacking chairs.",
      blurb: "The Thursday lunch is yours — you started it, it meets in your building, and you decide who is admitted to which room. You steward nothing and hold no testimony; your job is that the right people are in the right rooms and that each room's rule is kept. You have watched three agencies come and go in ten years, and the question you keep asking is not how many workers a people has but whether the church that forms could stand if every worker left tomorrow. The returnee is accountable to you and to nobody else at this table.",
      secret: "You introduced the reporter to two people at this table last spring, and vouched for him.",
      look: { figure: "m", age: 48, skin: "#c08c5e", hair: "#241c17", wear: "#3a3a3a", accent: "#8d9aa2", hairStyle: "short", facial: "stubble" },
      vault: [
      ],
      lines: { greet: "Everybody is welcome at this table. Everybody keeps the table's rule.", probe: "Who needs to be in a room they are not in — and whose work would stop tomorrow if their worker left?", deflect: "The rule here is county grain. If you need finer, take it to the room whose rule allows it.", press: "I do not decide what is true. I decide who is in the room.", report: "The rooms are the rules. That is all a convener holds." },
    },
    {
      id: "welcomer", kind: "welcomer", name: "Bonnie Ahlgren", archetype: "greeley-welcomer",
      appearance: "Runs the Tuesday English class and the welcome closet; knows every family's children by name and no family's file.",
      blurb: "You have run the church's English classes for nineteen years. You see everybody — who arrived, who is pregnant, who stopped coming, who started praying — and you keep no records at all, because you never needed any. You genuinely believe that telling people what God is doing encourages them, and you are the most-liked person in the room. Nothing you hold is secret to you, which is exactly the problem.",
      secret: "You have told the Burmese story from the front of a church twice, with the town in it, and thought nothing of it.",
      look: { figure: "f", age: 63, skin: "#eed3b8", hair: "#cfc7bb", wear: "#6b4a5a", accent: "#d8b4c8", hairStyle: "short" },
      vault: [
        { id: "w1", people: "mexicans", grain: "household", supports: 3, round: 0, text: "Two families who came in this spring have started praying with me after class.", coarse: { city: "Some recently arrived families in one of our towns have responded.", county: "Some recent Mexican arrivals in this county have responded.", people: "Some Mexicans have responded in faith." }, count: 2 },
        { id: "w2", people: "burmese", grain: "city", supports: 3, round: 1, text: "The Burmese women in my Tuesday class bring their own Bibles now, and one of them teaches the others.", coarse: { county: "Burmese believers in this county are teaching each other.", people: "Burmese believers are discipling one another." } },
        { id: "w3", people: "mexicans", grain: "city", supports: 2, round: 2, text: "Nine Spanish Bibles went out of the welcome closet last year, and the Mexican families ask for the large-print ones for their parents.", coarse: { county: "Spanish Bibles go out of a church closet in this county steadily; Mexican families ask for them.", people: "Mexican families here ask for Bibles in Spanish." }, count: 9 },
      ],
      lines: { greet: "Oh, you should hear what has been happening on Tuesday mornings.", probe: "Has anybody been out to see the family on 8th? They have not been in three weeks.", deflect: "Well — I do not want to say too much. But it is wonderful.", press: "I suppose there is no harm in saying where, is there?", report: "I just think people ought to know. It encourages them." },
    },
  ],
};

