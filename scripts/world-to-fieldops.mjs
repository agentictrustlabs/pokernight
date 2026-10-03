/**
 * THE WORLD, GENERATED FROM THE ONTOLOGY AND THE REGISTRY — Field Operations' region and season.
 *
 * `~/skills/ontology/northern-colorado.ttl` is the SOURCE for the region (corridors, towns, which registry
 * communities the season works and where, the partner churches) and the season (teams, parts with gifts, lines
 * and looks, weeks). It is an A-box over `fieldops.tbox.ttl`, under faith and story. The COMMUNITIES' identities
 * and starting phases are not in it: they are the public registry's, read by `registry-to-fieldops.mjs` into
 * `registry.generated.ts`, and this joins the two on the registry's own community IRI.
 *
 *   node scripts/world-to-fieldops.mjs [path/to/northern-colorado.ttl] > packages/fieldops/src/worlds/northern-colorado.generated.ts
 *
 * Compiled, never loaded: the Worker opens a season on what this wrote.
 */
import { readFileSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;
const FO = 'https://skills.demo/fieldops#';
const ST = 'https://skills.demo/story#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const src = process.argv[2] ?? `${process.env.HOME}/skills/ontology/northern-colorado.ttl`;
const registryPath = process.argv[3] ?? new URL('../packages/fieldops/src/worlds/registry.generated.ts', import.meta.url).pathname;

const store = new Store(new Parser().parse(readFileSync(src, 'utf8')));
const one = (s, p) => store.getObjects(s, namedNode(p), null)[0] ?? null;
const all = (s, p) => store.getObjects(s, namedNode(p), null);
const lit = (s, p) => { const o = one(s, p); return o ? o.value : null; };
const num = (s, p) => { const v = lit(s, p); return v === null ? null : Number(v); };
const typed = (t) => store.getSubjects(namedNode(`${RDF}type`), namedNode(t), null);
const j = (v) => JSON.stringify(v);
const byOrder = (a, b) => (num(a, `${ST}order`) ?? 0) - (num(b, `${ST}order`) ?? 0);
const key = (node, p) => lit(node, p);

// The registry floor: the generated module is TypeScript; read its JSON literal rather than importing it.
const registrySrc = readFileSync(registryPath, 'utf8');
const readAt = /REGISTRY_READ_AT = "([^"]+)"/.exec(registrySrc)?.[1] ?? '';
const registry = JSON.parse(registrySrc.slice(registrySrc.indexOf('= [', registrySrc.indexOf('REGISTRY_COMMUNITIES')) + 2).replace(/;\s*$/, ''));
const byIri = new Map(registry.map((r) => [r.iri, r]));

const region = typed(`${FO}Region`)[0];
const seasons = typed(`${FO}Season`);
if (!region || !seasons.length) throw new Error('no fo:Region or fo:Season in the A-box');

const L = [];
L.push(`/**`);
L.push(` * GENERATED FROM THE ONTOLOGY AND THE PUBLIC REGISTRY — do not edit by hand.`);
L.push(` *`);
L.push(` * Source: \`${src.replace(process.env.HOME ?? '~', '~')}\` (an A-box over \`fieldops.tbox.ttl\`, under faith and story), joined on each`);
L.push(` * community's registry IRI with \`registry.generated.ts\` (gc-public, read ${readAt}).`);
L.push(` * Rebuild: \`pnpm gen:fieldops\``);
L.push(` */`);
L.push(`import type { Region, Scenario } from '../types.js';`);
L.push('');

const REGION_CONST = `${key(region, `${FO}regionKey`).toUpperCase().replace(/-/g, '_')}_FROM_ONTOLOGY`;
L.push(`export const ${REGION_CONST}: Region = {`);
L.push(`  id: ${j(key(region, `${FO}regionKey`))},`);
L.push(`  name: ${j(lit(region, `${RDFS}label`))},`);
L.push(`  blurb: ${j(lit(region, `${RDFS}comment`))},`);
L.push(`  registryReadAt: ${j(readAt)},`);
L.push(`  corridors: [`);
for (const c of all(region, `${FO}hasCorridor`).sort(byOrder)) {
  const hotspot = lit(c, `${FO}hotspotOrg`);
  L.push(`    { id: ${j(key(c, `${FO}corridorKey`))}, name: ${j(lit(c, `${RDFS}label`))}, counties: [${all(c, `${FO}county`).map((x) => j(x.value)).join(', ')}], towns: [${all(c, `${FO}hasTown`).map((t) => j(key(t, `${FO}townKey`))).join(', ')}]${hotspot ? `, hotspotOrg: ${j(hotspot)}` : ''} },`);
}
L.push(`  ],`);
L.push(`  towns: [`);
for (const c of all(region, `${FO}hasCorridor`).sort(byOrder)) for (const t of all(c, `${FO}hasTown`)) {
  L.push(`    { id: ${j(key(t, `${FO}townKey`))}, name: ${j(lit(t, `${RDFS}label`))}, corridor: ${j(key(c, `${FO}corridorKey`))}, lat: ${num(t, `${FO}lat`)}, lng: ${num(t, `${FO}lng`)}, population: ${num(t, `${FO}population`)}, churches: ${num(t, `${FO}churchCount`)} },`);
}
L.push(`  ],`);
L.push(`  communities: [`);
for (const c of all(region, `${FO}hasCommunity`).sort(byOrder)) {
  const iri = one(c, `${FO}registryCommunity`)?.value;
  const r = byIri.get(iri);
  if (!r) throw new Error(`${key(c, `${FO}communityKey`)} cites ${iri}, which the registry read does not hold — re-run registry-to-fieldops.mjs`);
  const claims = [
    { label: 'phase (registry)', value: `P${r.phase}${r.resultDate ? ` @ ${r.resultDate}` : ' (undated)'}`, source: 'gc-public · fw-npl-phases' },
    { label: 'identity scheme', value: r.identity.scheme.split('/').pop() ?? r.identity.scheme, source: 'gc-public' },
    ...(r.ropId ? [{ label: 'ROP3', value: r.ropId, source: 'HIS / PeopleGroups.org' }] : []),
    ...(r.pgId ? [{ label: 'IMB PGID', value: r.pgId, source: 'PeopleGroups.org' }] : []),
  ];
  L.push(`    {`);
  L.push(`      id: ${j(key(c, `${FO}communityKey`))}, iri: ${j(iri)}, name: ${j(r.name)}, corridor: ${j(key(one(c, `${FO}inCorridor`), `${FO}corridorKey`))},`);
  L.push(`      people: { name: ${j(r.peopleName)}, iri: ${j(r.identity.iri)}, scheme: ${j(r.identity.scheme)}${r.ropId ? `, ropId: ${j(r.ropId)}` : ''}${r.peid ? `, peid: ${j(r.peid)}` : ''}${r.pgId ? `, pgId: ${j(r.pgId)}` : ''}${r.language ? `, language: ${j(r.language)}` : ''}${r.religion ? `, religion: ${j(r.religion)}` : ''}${r.homeCountry ? `, homeCountry: ${j(r.homeCountry)}` : ''} },`);
  L.push(`      towns: [${all(c, `${FO}worksTown`).map((t) => j(key(t, `${FO}townKey`))).join(', ')}],`);
  L.push(`      population: ${num(c, `${FO}populationEstimate`) ?? 'null'},`);
  L.push(`      registry: { phase: ${r.phase}, qualifier: null, resultDate: ${j(r.resultDate)}, framework: 'https://ontology.global.church/core#fw-npl-phases' },`);
  L.push(`      claims: ${j([...claims, { label: 'estimate basis', value: lit(c, `${FO}estimateBasis`) ?? '', source: 'the season' }])},`);
  L.push(`      base: { readiness: ${num(c, `${FO}baseReadiness`)} },`);
  L.push(`    },`);
}
L.push(`  ],`);
L.push(`  partners: [`);
for (const p of all(region, `${FO}hasPartner`).sort(byOrder)) {
  const town = one(p, `${FO}atTown`);
  const corridor = key(one(town, `${FO}inCorridor`), `${FO}corridorKey`);
  const opt = (k, prop) => { const v = lit(p, prop); return v ? `, ${k}: ${j(v)}` : ''; };
  L.push(`    { id: ${j(key(p, `${FO}partnerKey`))}, name: ${j(lit(p, `${RDFS}label`))}, town: ${j(key(town, `${FO}townKey`))}, corridor: ${j(corridor)}${opt('denomination', `${FO}denomination`)}${opt('website', `${FO}website`)}${opt('directoryId', `${FO}directoryId`)}${opt('address', `${FO}address`)}, lat: ${num(p, `${FO}lat`)}, lng: ${num(p, `${FO}lng`)}, capacity: ${num(p, `${FO}supportCapacity`)} },`);
}
L.push(`  ],`);
L.push(`};`);
L.push('');

for (const s of seasons) {
  const tone = one(s, `${ST}inTone`);
  const notes = all(s, `${ST}voiceNote`).map((x) => x.value);
  const groups = {};
  for (const n of notes) { const i = n.indexOf(': '); (groups[n.slice(0, i)] ??= []).push(n.slice(i + 2)); }
  const NAME = `${lit(s, `${ST}storyKey`).toUpperCase().replace(/-/g, '_')}_FROM_ONTOLOGY`;
  L.push(`export const ${NAME}: Scenario = {`);
  L.push(`  id: ${j(lit(s, `${ST}storyKey`))},`);
  L.push(`  name: ${j(lit(s, `${RDFS}label`))},`);
  L.push(`  region: ${j(key(one(s, `${FO}setIn`), `${FO}regionKey`))},`);
  L.push(`  blurb: ${j(lit(s, `${RDFS}comment`))},`);
  L.push(`  tone: ${j(lit(tone, `${RDFS}label`))},`);
  L.push(`  voice: { ${Object.entries(groups).map(([who, lines]) => `${who}: [${lines.map(j).join(', ')}]`).join(', ')} },`);
  L.push(`  dayMinutes: ${num(s, `${FO}dayMinutes`)},`);
  L.push(`  closingMinutes: ${num(s, `${FO}closingMinutes`)},`);
  L.push(`  trail: [`);
  for (const t of all(s, `${FO}hasTrailEvent`)) {
    const days = num(t, `${FO}lastsDays`);
    L.push(`    { id: ${j(lit(t, `${FO}trailKey`))}, kind: ${j(lit(t, `${FO}trailKind`))}, text: ${j(lit(t, `${RDFS}label`))}${days !== null ? `, days: ${days}` : ''} },`);
  }
  L.push(`  ],`);
  L.push(`  teams: [`);
  for (const t of all(s, `${FO}hasTeam`).sort(byOrder)) {
    L.push(`    { id: ${j(key(t, `${FO}teamKey`))}, name: ${j(lit(t, `${RDFS}label`))}, corridor: ${j(key(one(t, `${FO}inCorridor`), `${FO}corridorKey`))}, home: ${j(key(one(t, `${FO}basedIn`), `${FO}townKey`))}, members: [${all(t, `${FO}hasMember`).sort(byOrder).map((m) => j(key(m, `${ST}partKey`))).join(', ')}] },`);
  }
  L.push(`  ],`);
  L.push(`  weeks: [`);
  for (const a of all(s, `${ST}hasAct`).sort((x, y) => num(x, `${ST}actNumber`) - num(y, `${ST}actNumber`))) {
    L.push(`    { n: ${num(a, `${ST}actNumber`)}, name: ${j(lit(a, `${RDFS}label`))}, objective: ${j(lit(one(a, `${ST}actObjective`), `${RDFS}label`))}, opening: ${j(lit(a, `${ST}openingNarration`))}, interlude: ${j(lit(a, `${ST}interludeNarration`))} },`);
  }
  L.push(`  ],`);
  L.push(`  roles: [`);
  for (const p of all(s, `${ST}hasPart`).sort(byOrder)) {
    const look = one(p, `${ST}hasLook`);
    const voice = one(p, `${ST}hasVoice`);
    const team = one(p, `${FO}onTeam`);
    const partner = one(p, `${FO}speaksFor`);
    const bits = [`figure: ${j(lit(p, `${ST}figure`))}`, `age: ${num(p, `${ST}age`)}`, `skin: ${j(lit(look, `${ST}skinColour`))}`, `hair: ${j(lit(look, `${ST}hairColour`))}`, `wear: ${j(lit(look, `${ST}wearColour`))}`, `accent: ${j(lit(look, `${ST}accentColour`))}`, `hairStyle: ${j(lit(look, `${ST}hairStyle`))}`];
    const facial = lit(look, `${ST}facialHair`); if (facial) bits.push(`facial: ${j(facial)}`);
    const acc = lit(look, `${ST}accessory`); if (acc) bits.push(`accessory: ${j(acc)}`);
    L.push(`    {`);
    L.push(`      id: ${j(key(p, `${ST}partKey`))}, name: ${j(lit(p, `${RDFS}label`))}, kind: ${j(lit(p, `${FO}partKind`))}, archetype: ${j(lit(p, `${ST}playedFromArchetype`))},${team ? ` team: ${j(key(team, `${FO}teamKey`))},` : ''}${partner ? ` partner: ${j(key(partner, `${FO}partnerKey`))},` : ''}`);
    L.push(`      home: ${j(key(one(p, `${FO}startsIn`), `${FO}townKey`))},`);
    L.push(`      appearance: ${j(lit(p, `${ST}publicAppearance`))},`);
    L.push(`      blurb: ${j(lit(p, `${ST}brief`))},`);
    L.push(`      secret: ${j(lit(one(p, `${ST}holdsSecret`), `${RDFS}comment`))},`);
    L.push(`      look: { ${bits.join(', ')} },`);
    L.push(`      gifts: { share: ${num(p, `${FO}giftShare`)}, disciple: ${num(p, `${FO}giftDisciple`)}, gather: ${num(p, `${FO}giftGather`)}, lead: ${num(p, `${FO}giftLead`)}, coach: ${num(p, `${FO}giftCoach`)} },`);
    L.push(`      languages: [${all(p, `${FO}speaks`).map((x) => j(x.value)).join(', ')}],`);
    L.push(`      lines: { greet: ${j(lit(voice, `${ST}line-greet`))}, probe: ${j(lit(voice, `${ST}line-probe`))}, report: ${j(lit(voice, `${FO}line-report`))}, press: ${j(lit(voice, `${FO}line-press`))}, rest: ${j(lit(voice, `${FO}line-rest`))} },`);
    const choices = all(p, `${ST}faces`);
    if (choices.length) {
      L.push(`      choices: [`);
      for (const c of choices) {
        L.push(`        { id: ${j(lit(c, `${ST}choiceKey`))}, day: ${num(c, `${FO}opensOnDay`)}, question: ${j(lit(c, `${ST}question`))}, options: [`);
        for (const o of all(c, `${ST}hasOption`).sort(byOrder)) {
          const cons = one(o, `${ST}leadsToConsequence`);
          const eff = [];
          const en = num(cons, `${FO}effectEnergy`); if (en !== null) eff.push(`energy: ${en}`);
          const cap = num(cons, `${FO}effectCapacity`); if (cap !== null) eff.push(`capacity: ${cap}`);
          const mv = one(cons, `${FO}effectMoveTo`); if (mv) eff.push(`moveTo: ${j(key(mv, `${FO}townKey`))}`);
          L.push(`          { id: ${j(lit(o, `${ST}optionKey`))}, label: ${j(lit(o, `${RDFS}label`))}, outcome: ${j(lit(cons, `${ST}outcomeKey`))}, consequence: ${j(lit(cons, `${RDFS}label`))}${eff.length ? `, effect: { ${eff.join(', ')} }` : ''} },`);
        }
        L.push(`        ] },`);
      }
      L.push(`      ],`);
    }
    L.push(`    },`);
  }
  L.push(`  ],`);
  L.push(`};`);
  L.push('');
}
console.log(L.join('\n'));
