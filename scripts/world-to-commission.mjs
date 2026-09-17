/**
 * THE WORLD, GENERATED FROM THE ONTOLOGY — Great Commission's region and scenarios.
 *
 * `~/skills/ontology/kettlewater.ttl` is the SOURCE for the Kettlewater Marches and the two nights in them: the
 * rooms and their disclosure rules, the five fictional peoples with their public readings and MOVEMENT
 * SCHEDULES, the seven parts with their briefs, looks, lines, choices and VAULTS, and the rounds. It is an
 * A-box over `commission.tbox.ttl`, which sits under the faith ontology (a people is a `gc:PeopleGroup`; a
 * reading is a `gc:EngagementAssessmentResult`; a phase is a `poe:` concept) and the story ontology (parts,
 * acts, secrets, choices). This reads that and writes the world the engine plays.
 *
 *   node scripts/world-to-commission.mjs [path/to/kettlewater.ttl] > packages/commission/src/worlds/kettlewater.generated.ts
 *
 * The output is checked against the hand-written world by a test that deep-compares the two, the same
 * round-trip the mystery's generators were proven by.
 */
import { readFileSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;
const CM = 'https://skills.demo/commission#';
const ST = 'https://skills.demo/story#';
const GC = 'https://ontology.global.church/core#';
const POE = 'https://ontology.global.church/poe#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const src = process.argv[2] ?? `${process.env.HOME}/skills/ontology/kettlewater.ttl`;

const store = new Store(new Parser().parse(readFileSync(src, 'utf8')));
const one = (s, p) => store.getObjects(s, namedNode(p), null)[0] ?? null;
const all = (s, p) => store.getObjects(s, namedNode(p), null);
const lit = (s, p) => { const o = one(s, p); return o ? o.value : null; };
const num = (s, p) => { const v = lit(s, p); return v === null ? null : Number(v); };
const typed = (t) => store.getSubjects(namedNode(`${RDF}type`), namedNode(t), null);
const j = (v) => JSON.stringify(v);
const byOrder = (a, b) => (num(a, `${ST}order`) ?? 0) - (num(b, `${ST}order`) ?? 0);
const byRound = (a, b) => (num(a, `${CM}afterRound`) ?? 0) - (num(b, `${CM}afterRound`) ?? 0);

// THE TOOLKIT'S PHASES, BY IRI → the engine's value. `poe:Phase0R` is the restart indicator.
const phaseOf = (node) => { const tail = node.value.slice(POE.length); return tail === 'Phase0R' ? '0-R' : Number(tail.replace('Phase', '')); };
// THE TOOLKIT'S STRENGTHS, as the faith ontology encodes them (`poe:StrengthActive`) → the engine's lowercase word.
const strengthOf = (node) => node.value.slice(POE.length).replace('Strength', '').toLowerCase();
const grainOf = (node) => lit(node, `${CM}grainKey`);
const key = (node, p) => lit(node, p);

const region = typed(`${CM}FictionalRegion`)[0];
const stories = typed(`${ST}Story`).sort((a, b) => (num(a, `${CM}nightNumber`) ?? 0) - (num(b, `${CM}nightNumber`) ?? 0));

const L = [];
L.push(`/**`);
L.push(` * GENERATED FROM THE ONTOLOGY — do not edit by hand.`);
L.push(` *`);
L.push(` * Source: \`~/skills/ontology/kettlewater.ttl\` (an A-box over \`commission.tbox.ttl\`, under faith and story).`);
L.push(` * Rebuild: \`node scripts/world-to-commission.mjs > packages/commission/src/worlds/kettlewater.generated.ts\``);
L.push(` */`);
L.push(`import type { Region, Scenario } from '../types.js';`);
L.push('');

// ── the region ──
L.push(`export const KETTLEWATER_MARCHES_FROM_ONTOLOGY: Region = {`);
L.push(`  id: ${j(key(region, `${CM}regionKey`))},`);
L.push(`  name: ${j(lit(region, `${RDFS}label`))},`);
L.push(`  blurb: ${j(lit(region, `${RDFS}comment`))},`);
L.push(`  spawn: ${j(key(one(region, `${CM}spawnsIn`), `${CM}roomKey`))},`);
L.push(`  peoples: [`);
for (const p of all(region, `${CM}hasPeople`).sort(byOrder)) {
  const pub = one(p, `${CM}hasPublicReading`);
  const schedule = all(one(p, `${CM}hasSchedule`), `${CM}hasState`).sort(byRound);
  const carrier = one(p, `${CM}carriedBy`);
  L.push(`    {`);
  L.push(`      id: ${j(key(p, `${CM}peopleKey`))}, name: ${j(lit(p, `${RDFS}label`))}, province: ${j(lit(p, `${CM}inProvince`))},`);
  L.push(`      villages: [${all(p, `${CM}hasVillage`).sort(byOrder).map((v) => j(key(v, `${CM}villageKey`))).join(', ')}],`);
  if (pub) L.push(`      publicReading: { phase: ${j(phaseOf(one(pub, `${CM}phase`)))}, strength: ${j(strengthOf(one(pub, `${CM}strength`)))}, vintage: ${num(pub, `${CM}afterRound`) ?? 0} },`);
  L.push(`      schedule: [${schedule.map((s) => `{ phase: ${j(phaseOf(one(s, `${CM}phase`)))}, strength: ${j(strengthOf(one(s, `${CM}strength`)))} }`).join(', ')}],`);
  L.push(`      truth: { village: ${j(key(one(p, `${CM}hiddenVillage`), `${CM}villageKey`))}, households: ${num(p, `${CM}hiddenHouseholds`)} },`);
  if (carrier) L.push(`      carrier: ${j(key(carrier, `${ST}partKey`))},`);
  L.push(`    },`);
}
L.push(`  ],`);
L.push(`  rooms: [`);
for (const r of all(region, `${CM}hasWorkspace`).sort(byOrder)) {
  L.push(`    { id: ${j(key(r, `${CM}roomKey`))}, name: ${j(lit(r, `${RDFS}label`))}, blurb: ${j(lit(r, `${RDFS}comment`))}, members: [${all(r, `${CM}memberPart`).sort(byOrder).map((m) => j(key(m, `${ST}partKey`))).join(', ')}], grain: ${j(grainOf(one(r, `${CM}allowsGrain`)))} },`);
}
L.push(`  ],`);
L.push(`};`);
L.push('');

// ── the parts (shared by both nights) ──
const partLines = (p) => {
  const look = one(p, `${ST}hasLook`);
  const voice = one(p, `${ST}hasVoice`);
  const secret = one(p, `${ST}holdsSecret`);
  const out = [];
  out.push(`    {`);
  out.push(`      id: ${j(key(p, `${ST}partKey`))}, kind: ${j(lit(p, `${CM}partKind`))}, name: ${j(lit(p, `${RDFS}label`))}, archetype: ${j(lit(p, `${ST}playedFromArchetype`))},`);
  out.push(`      appearance: ${j(lit(p, `${ST}publicAppearance`))},`);
  out.push(`      blurb: ${j(lit(p, `${ST}brief`))},`);
  out.push(`      secret: ${j(lit(secret, `${RDFS}comment`))},`);
  const bits = [`figure: ${j(lit(p, `${ST}figure`))}`, `age: ${num(p, `${ST}age`)}`, `skin: ${j(lit(look, `${ST}skinColour`))}`, `hair: ${j(lit(look, `${ST}hairColour`))}`, `wear: ${j(lit(look, `${ST}wearColour`))}`, `accent: ${j(lit(look, `${ST}accentColour`))}`, `hairStyle: ${j(lit(look, `${ST}hairStyle`))}`];
  const facial = lit(look, `${ST}facialHair`); if (facial) bits.push(`facial: ${j(facial)}`);
  const acc = lit(look, `${ST}accessory`); if (acc) bits.push(`accessory: ${j(acc)}`);
  out.push(`      look: { ${bits.join(', ')} },`);
  out.push(`      vault: [`);
  for (const v of all(p, `${CM}holdsTestimony`).sort(byOrder)) {
    const coarse = all(v, `${CM}coarseAs`).map((c) => [grainOf(one(c, `${CM}atGrain`)), lit(c, `${RDFS}label`)]);
    const order = ['person', 'household', 'village', 'province', 'people'];
    coarse.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    const count = num(v, `${CM}holdsCount`);
    const fields = [
      `id: ${j(key(v, `${CM}evidenceKey`))}`, `people: ${j(key(one(v, `${CM}aboutPeople`), `${CM}peopleKey`))}`, `grain: ${j(grainOf(one(v, `${CM}knownAtGrain`)))}`,
      `supports: ${phaseOf(one(v, `${CM}supportsPhase`))}`, `round: ${num(v, `${CM}arrivesInRound`)}`, `text: ${j(lit(v, `${RDFS}label`))}`,
    ];
    if (coarse.length) fields.push(`coarse: { ${coarse.map(([g, t]) => `${g}: ${j(t)}`).join(', ')} }`);
    else fields.push(`coarse: {}`);
    if (count !== null) fields.push(`count: ${count}`);
    out.push(`        { ${fields.join(', ')} },`);
  }
  out.push(`      ],`);
  out.push(`      lines: { ${['greet', 'probe', 'deflect', 'press', 'report'].map((k) => `${k}: ${j(lit(voice, `${ST}line-${k}`))}`).join(', ')} },`);
  const choices = all(p, `${ST}faces`);
  if (choices.length) {
    out.push(`      choices: [`);
    for (const c of choices) {
      out.push(`        { id: ${j(lit(c, `${ST}choiceKey`))}, round: ${num(one(c, `${ST}openedBy`), `${ST}actNumber`)}, question: ${j(lit(c, `${ST}question`))}, options: [`);
      for (const o of all(c, `${ST}hasOption`).sort(byOrder)) {
        const cons = one(o, `${ST}leadsToConsequence`);
        out.push(`          { id: ${j(lit(o, `${ST}optionKey`))}, label: ${j(lit(o, `${RDFS}label`))}, outcome: ${j(lit(cons, `${ST}outcomeKey`))}, consequence: ${j(lit(cons, `${RDFS}label`))} },`);
      }
      out.push(`        ] },`);
    }
    out.push(`      ],`);
    }
  out.push(`    },`);
  return out;
};

// ── the scenarios ──
const constName = (s) => `${lit(s, `${ST}storyKey`).toUpperCase().replace(/-/g, '_')}_FROM_ONTOLOGY`;
for (const s of stories) {
  const tone = one(s, `${ST}inTone`);
  const notes = all(s, `${ST}voiceNote`).map((x) => x.value);
  const groups = {};
  for (const n of notes) { const i = n.indexOf(': '); (groups[n.slice(0, i)] ??= []).push(n.slice(i + 2)); }
  const silent = one(s, `${CM}goesSilent`);
  L.push(`export const ${constName(s)}: Scenario = {`);
  L.push(`  id: ${j(lit(s, `${ST}storyKey`))},`);
  L.push(`  name: ${j(lit(s, `${RDFS}label`))},`);
  L.push(`  region: ${j(key(one(s, `${CM}setIn`), `${CM}regionKey`))},`);
  L.push(`  night: ${num(s, `${CM}nightNumber`)},`);
  L.push(`  blurb: ${j(lit(s, `${RDFS}comment`))},`);
  L.push(`  tone: ${j(lit(tone, `${RDFS}label`))},`);
  L.push(`  voice: { ${Object.entries(groups).map(([who, lines]) => `${who}: [${lines.map(j).join(', ')}]`).join(', ')} },`);
  L.push(`  closingMinutes: ${num(s, `${CM}closingMinutes`)},`);
  if (silent) L.push(`  silent: { role: ${j(key(one(silent, `${CM}silentPart`), `${ST}partKey`))}, fromRound: ${num(silent, `${CM}fromRound`)} },`);
  L.push(`  rounds: [`);
  for (const a of all(s, `${ST}hasAct`).sort((x, y) => num(x, `${ST}actNumber`) - num(y, `${ST}actNumber`))) {
    L.push(`    { n: ${num(a, `${ST}actNumber`)}, name: ${j(lit(a, `${RDFS}label`))}, minutes: ${num(a, `${ST}actMinutes`)}, objective: ${j(lit(one(a, `${ST}actObjective`), `${RDFS}label`))}, opening: ${j(lit(a, `${ST}openingNarration`))}, interlude: ${j(lit(a, `${ST}interludeNarration`))} },`);
  }
  L.push(`  ],`);
  L.push(`  roles: [`);
  for (const p of all(s, `${ST}hasPart`).sort(byOrder)) L.push(...partLines(p));
  L.push(`  ],`);
  L.push(`};`);
  L.push('');
}
console.log(L.join('\n'));
