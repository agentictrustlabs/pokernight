/**
 * THE TITLE, GENERATED FROM THE STORY ONTOLOGY.
 *
 * `~/skills/ontology/belvedere-snowfall.ttl` is the SOURCE for Snowfall at the Belvedere: the eight parts
 * and what each is hiding, what they look like and what else is in their wardrobe, the three acts and what
 * each is for, the twenty-eight things that can be found out and which trait each narrows the cast by, and
 * the rule the culprit is drawn under. This reads that and writes the title the engine plays.
 *
 * The join to the building is TWO STRINGS and nothing else: a story says `st:foundAtKey "register"` and the
 * place says `pl:featureKey "register"`. Neither document holds the other's identifiers, so a hotel can be
 * re-lit and a story re-cast without either touching the other — which is what makes a second story at this
 * hotel a new file rather than a fork.
 *
 *   node scripts/story-to-title.mjs [path/to/belvedere-snowfall.ttl] > packages/mystery/src/titles/belvedere-snowfall.generated.ts
 */
import { readFileSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;
const ST = 'https://skills.demo/story#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const src = process.argv[2] ?? `${process.env.HOME}/skills/ontology/belvedere-snowfall.ttl`;

const store = new Store(new Parser().parse(readFileSync(src, 'utf8')));
const one = (s, p) => store.getObjects(s, namedNode(p), null)[0] ?? null;
const all = (s, p) => store.getObjects(s, namedNode(p), null);
const lit = (s, p) => { const o = one(s, p); return o ? o.value : null; };
const num = (s, p) => { const v = lit(s, p); return v === null ? null : Number(v); };
const typed = (t) => store.getSubjects(namedNode(`${RDF}type`), namedNode(`${ST}${t}`), null).map((x) => x.value);

const story = typed('Story')[0];
const j = (v) => JSON.stringify(v);
// AUTHORED ORDER, NOT SET ORDER. RDF is a set and a story is a sequence; st:order is what carries it.
const byOrder = (a, b) => (num(a, `${ST}order`) ?? 0) - (num(b, `${ST}order`) ?? 0);
const parts = all(story, `${ST}hasPart`).map((p) => p.value).sort(byOrder);
const acts = all(story, `${ST}hasAct`).map((a) => a.value).sort((a, b) => num(a, `${ST}actNumber`) - num(b, `${ST}actNumber`));
const clues = all(story, `${ST}hasEvidence`).map((c) => c.value).sort(byOrder);
const traitKey = (t) => lit(t, `${ST}traitKey`);

const L = [];
L.push(`/**`);
L.push(` * GENERATED FROM THE STORY ONTOLOGY — do not edit by hand.`);
L.push(` *`);
L.push(` * Source: \`~/skills/ontology/belvedere-snowfall.ttl\` (the story as an A-box over \`story.ttl\`).`);
L.push(` * Rebuild: \`node scripts/story-to-title.mjs > packages/mystery/src/titles/belvedere-snowfall.generated.ts\``);
L.push(` *`);
L.push(` * The story names the PLACE it is set at and joins to it on one string per thing — a clue's`);
L.push(` * \`foundAtKey\` against a feature's \`featureKey\` — so neither document holds the other's identifiers.`);
L.push(` */`);
L.push(`import type { Title } from '../types.js';`);
L.push('');
L.push(`export const BELVEDERE_SNOWFALL_FROM_ONTOLOGY: Title = {`);
L.push(`  id: 'belvedere-snowfall',`);
L.push(`  name: ${j(lit(story, `${RDFS}label`))},`);
L.push(`  venue: 'alpine-belvedere',`);
L.push(`  blurb: ${j(lit(story, `${RDFS}comment`))},`);
const tone = one(story, `${ST}inTone`);
L.push(`  tone: ${j(lit(tone, `${RDFS}label`))},`);
L.push(`  evidencePerDeath: ${num(story, `${ST}evidencePerDeath`)},`);
L.push(`  accusationMinutes: ${num(story, `${ST}accusationMinutes`)},`);
L.push(`  murderAfter: ${num(story, `${ST}murderAfter`)},`);
const deathAt = one(story, `${ST}opensWithDeathAt`);
if (deathAt) L.push(`  openingDeath: { room: ${j(deathAt.value.split('#').pop())}, prop: ${j(lit(story, `${ST}opensWithDeathOnKey`))} },`);
const sparedAt = one(story, `${ST}sparedAt`);
if (sparedAt) {
  L.push(`  spared: {`);
  L.push(`    room: ${j(sparedAt.value.split('#').pop())}, prop: ${j(lit(story, `${ST}sparedOnKey`))},`);
  L.push(`    interlude: ${j(lit(story, `${ST}sparedInterlude`))},`);
  L.push(`  },`);
}
const plantProps = all(story, `${ST}plantableOnKey`).map((x) => x.value);
const plantTraits = all(story, `${ST}plantableTrait`).map((t) => traitKey(t.value)).filter(Boolean);
if (plantProps.length) {
  L.push(`  plantable: { props: [${plantProps.map(j).join(', ')}], traits: [${plantTraits.map(j).join(', ')}] },`);
}
// the voice notes, grouped back under who they are for
const notes = all(story, `${ST}voiceNote`).map((x) => x.value);
if (notes.length) {
  const groups = {};
  for (const nline of notes) { const i = nline.indexOf(': '); const who = nline.slice(0, i); (groups[who] ??= []).push(nline.slice(i + 2)); }
  L.push(`  voice: {`);
  for (const [who, lines] of Object.entries(groups)) L.push(`    ${who}: [${lines.map(j).join(', ')}],`);
  L.push(`  },`);
}
L.push(`  roles: [`);
for (const p of parts) {
  const look = one(p, `${ST}hasLook`);
  const voice = one(p, `${ST}hasVoice`);
  const secret = one(p, `${ST}holdsSecret`);
  const wardrobe = all(look, `${ST}hasOutfit`).map((o) => o.value);
  const traits = (lit(p, `${ST}traitOrder`) ?? '').split(',').filter(Boolean);
  L.push(`    {`);
  L.push(`      id: ${j(lit(p, `${ST}partKey`))}, name: ${j(lit(p, `${RDFS}label`))}, archetype: ${j(lit(p, `${ST}playedFromArchetype`))}, canBeKiller: ${lit(p, `${ST}mayBeConspirator`) === 'true'},`);
  L.push(`      appearance: ${j(lit(p, `${ST}publicAppearance`))},`);
  const bits = [
    `figure: ${j(lit(p, `${ST}figure`))}`,
    `body: ${j(lit(look, `${ST}outfitWord`))}`,
    `age: ${num(p, `${ST}age`)}`,
    `skin: ${j(lit(look, `${ST}skinColour`))}`,
    `hair: ${j(lit(look, `${ST}hairColour`))}`,
    `wear: ${j(lit(look, `${ST}wearColour`))}`,
    `accent: ${j(lit(look, `${ST}accentColour`))}`,
    `hairStyle: ${j(lit(look, `${ST}hairStyle`))}`,
  ];
  const facial = lit(look, `${ST}facialHair`); if (facial) bits.push(`facial: ${j(facial)}`);
  const acc = lit(look, `${ST}accessory`); if (acc) bits.push(`accessory: ${j(acc)}`);
  L.push(`      look: {`);
  L.push(`        ${bits.join(', ')},`);
  if (wardrobe.length) {
    L.push(`        wardrobe: [`);
    for (const w of wardrobe.sort(byOrder)) {
      L.push(`          { id: ${j(lit(w, `${ST}outfitKey`))}, name: ${j(lit(w, `${RDFS}label`))}, wear: ${j(lit(w, `${ST}wearColour`))}, accent: ${j(lit(w, `${ST}accentColour`))} },`);
    }
    L.push(`        ],`);
  }
  L.push(`      },`);
  L.push(`      blurb: ${j(lit(p, `${ST}brief`))},`);
  L.push(`      secret: ${j(lit(secret, `${RDFS}comment`))},`);
  L.push(`      traits: [${traits.map(j).join(', ')}],`);
  L.push(`      lines: {`);
  for (const k of ['greet', 'probe', 'deny', 'accuse', 'mourn', 'found']) L.push(`        ${k}: ${j(lit(voice, `${ST}line-${k}`))},`);
  L.push(`      },`);
  L.push(`    },`);
}
L.push(`  ],`);
L.push(`  acts: [`);
for (const a of acts) {
  const opens = (lit(a, `${ST}opensOrder`) ?? '').split(',').filter(Boolean);
  const chances = all(a, `${ST}hasOpportunity`).map((o) => o.value).sort(byOrder);
  L.push(`    {`);
  L.push(`      n: ${num(a, `${ST}actNumber`)}, name: ${j(lit(a, `${RDFS}label`))}, minutes: ${num(a, `${ST}actMinutes`)},`);
  L.push(`      opens: [${opens.map(j).join(', ')}],`);
  if (chances.length) L.push(`      opportunities: [${chances.map((c) => `{ room: ${j(one(c, `${ST}opportunityAt`).value.split('#').pop())}, prop: ${j(lit(c, `${ST}opportunityOnKey`))} }`).join(', ')}],`);
  L.push(`      objective: ${j(lit(one(a, `${ST}actObjective`), `${RDFS}label`))},`);
  L.push(`      opening: ${j(lit(a, `${ST}openingNarration`))},`);
  const inter = lit(a, `${ST}interludeNarration`);
  if (inter) L.push(`      interlude: ${j(inter)},`);
  L.push(`    },`);
}
L.push(`  ],`);
L.push(`  clues: [`);
for (const c of clues) {
  const kind = lit(c, `${ST}evidenceKind`);
  const prop = lit(c, `${ST}foundAtKey`);
  const trait = one(c, `${ST}pointsAt`);
  const act = num(c, `${ST}fromAct`);
  const bits = [`id: ${j(lit(c, `${ST}evidenceKey`))}`, `kind: ${j(kind)}`];
  if (prop) bits.push(`prop: ${j(prop)}`);
  if (trait) bits.push(`trait: ${j(traitKey(trait.value))}`);
  if (act !== null) bits.push(`act: ${act}`);
  bits.push(`text: ${j(lit(c, `${RDFS}label`))}`);
  L.push(`    { ${bits.join(', ')} },`);
}
L.push(`  ],`);
L.push(`};`);
L.push('');
console.log(L.join('\n'));
