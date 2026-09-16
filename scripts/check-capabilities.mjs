/**
 * ONE CAPABILITY CATALOGUE, AND EVERYTHING THAT NAMES A CAPABILITY IS CHECKED AGAINST IT.
 *
 * The reference kit's review found `story.ack-cue` in one file and `story.cue.ack` in another — the exact
 * drift an ontology-and-skills architecture exists to prevent, and the kind that ships. The catalogue here is
 * the protocol's own constants (`MYSTERY_*_SKILL` in packages/protocol), because those are what the Worker
 * actually asks an agent for. Everything else — the archetype contracts in ~/skills, the skills' frontmatter,
 * the registry script — must spell them identically, or this fails and so does the build that runs it.
 *
 *   node scripts/check-capabilities.mjs        exit 1 on any drift
 */
import { readFileSync, readdirSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';
const { namedNode } = DataFactory;
const H = process.env.HOME;
const ST = 'https://skills.demo/story#';

// the catalogue: what the wire actually carries
const proto = readFileSync('packages/protocol/src/index.ts', 'utf8');
const catalogue = new Set([...proto.matchAll(/export const MYSTERY_[A-Z_]+_SKILL = '([a-z.]+)'/g)].map((m) => m[1]));
const problems = [];
const check = (where, ids) => { for (const id of ids) if (!catalogue.has(id)) problems.push(`${where}: "${id}" is not in the catalogue`); };

// the archetype contracts
const data = new Store(new Parser().parse(readFileSync(`${H}/skills/ontology/story.data.ttl`, 'utf8')));
for (const c of data.getSubjects(namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode(`${ST}ArchetypeContract`), null)) {
  const ids = data.getObjects(c, namedNode(`${ST}requiresCapability`), null).map((o) => o.value);
  check(`contract ${c.value.split('#').pop()}`, ids);
}
// the skills' frontmatter
const skillsDir = `${H}/skills/skills/mystery`;
for (const d of readdirSync(skillsDir)) {
  const md = readFileSync(`${skillsDir}/${d}/SKILL.md`, 'utf8');
  const m = md.match(/^capability:\s*(\S+)/m);
  if (m) check(`skill ${d}`, [m[1]]);
}
// the registry scripts
for (const f of ['register-mystery.mjs', 'register-place-story.mjs']) {
  const src = readFileSync(`${H}/skills/scripts/${f}`, 'utf8');
  check(`script ${f}`, [...src.matchAll(/'(mystery\.[a-z]+)'/g)].map((m) => m[1]));
}
// the engine's effects vs the contracts' effects: every effect a contract writes must be an action `apply` knows
const engine = readFileSync('packages/mystery/src/engine.ts', 'utf8');
const applies = new Set([...engine.matchAll(/case '([a-z]+)': \{/g)].map((m) => m[1]).concat([...engine.matchAll(/case '([a-z]+)': return/g)].map((m) => m[1])));
const meta = new Set(['narrate', 'cue']); // the director's effects are not engine actions; they are speech
for (const q of data.getQuads(null, namedNode(`${ST}writes`), null, null)) {
  const eff = q.object.value.split('#eff-').pop();
  if (!applies.has(eff) && !meta.has(eff)) problems.push(`contract ${q.subject.value.split('#').pop()} writes "${eff}", which apply() does not accept`);
}

console.log(`catalogue: ${[...catalogue].join(', ')}`);
console.log(`engine actions: ${[...applies].join(', ')}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):`); for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
console.log('\n✓ every capability and every written effect resolves — no drift');
