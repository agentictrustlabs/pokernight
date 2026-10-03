/**
 * THE PART ARCHETYPES, GENERATED FROM THE FIELD OPERATIONS A-BOX.
 *
 * Sixteen parts, sixteen archetypes — the document an agent is given when it is asked to BE one of these people for
 * a season north of Denver. Generated rather than hand-written for the same reason the world is: who each part is,
 * what team it is on, what it is good at, what it would rather nobody knew, and how it speaks when nobody's model is
 * asked are all stated once, in `~/skills/ontology/northern-colorado.ttl`, and an archetype that restated any of it
 * would be a second copy waiting to drift. The craft — how to spend a day, how the work climbs, how to read, how
 * to support — is the same for every part and lives in the `fieldops` skills the archetype is attached to.
 *
 *   node scripts/fieldops-to-archetypes.mjs [ttl] [outDir]     # default ~/skills/ontology/northern-colorado.ttl ~/skills/archetypes
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;
const FO = 'https://skills.demo/fieldops#';
const ST = 'https://skills.demo/story#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const src = args[0] ?? `${process.env.HOME}/skills/ontology/northern-colorado.ttl`;
const outDir = args[1] ?? `${process.env.HOME}/skills/archetypes`;

const store = new Store(new Parser().parse(readFileSync(src, 'utf8')));
const one = (s, p) => store.getObjects(s, namedNode(p), null)[0] ?? null;
const all = (s, p) => store.getObjects(s, namedNode(p), null);
const lit = (s, p) => { const o = one(s, p); return o ? o.value : null; };
const num = (s, p) => { const v = lit(s, p); return v === null ? null : Number(v); };
const byOrder = (a, b) => (num(a, `${ST}order`) ?? 0) - (num(b, `${ST}order`) ?? 0);

const season = store.getSubjects(namedNode(`${RDF}type`), namedNode(`${FO}Season`), null)[0];
const seasonName = lit(season, `${RDFS}label`);
const tone = lit(one(season, `${ST}inTone`), `${RDFS}label`);
const regionName = lit(one(season, `${FO}setIn`), `${RDFS}label`);
const KIND_WORD = { worker: 'a field worker', coach: 'a coach', steward: 'the progress steward', partner: 'a partner representative', coordinator: 'the field coordinator' };
const VERBS = {
  worker: 'found-team · join · adopt · define-community · move · visit · share · study · found · gather · baptize · train · recognize · send · report · rest',
  coach: 'found-team · join · invite · adopt · move · coach · report · visit · share · study · gather · rest',
  steward: 'assess · move · rest',
  partner: 'support · rest',
  coordinator: 'found-team · join · invite · adopt · define-community · move · coach · assess · visit · share · study · found · gather · baptize · train · recognize · send · report · rest',
};

for (const p of all(season, `${ST}hasPart`).sort(byOrder)) {
  const id = lit(p, `${ST}playedFromArchetype`);
  const name = lit(p, `${RDFS}label`);
  const kind = lit(p, `${FO}partKind`);
  const team = one(p, `${FO}onTeam`);
  const partner = one(p, `${FO}speaksFor`);
  const voice = one(p, `${ST}hasVoice`);
  const gifts = ['Share', 'Disciple', 'Gather', 'Lead', 'Coach'].map((g) => [g.toLowerCase(), num(p, `${FO}gift${g}`)]);
  const langs = all(p, `${FO}speaks`).map((x) => x.value);
  const L = [];
  L.push('---');
  L.push(`name: ${id}`);
  L.push(`description: ${JSON.stringify(`${name} — ${KIND_WORD[kind] ?? kind} in ${seasonName}. ${lit(p, `${ST}publicAppearance`)} Played in the first person for one day at a time, choosing only from what the view says this part may do; decides nothing about what comes of an act, counts only what the board counts, and says it is a game agent whenever that matters.`)}`);
  L.push('namespace: archetypes');
  L.push('knowledge: { requires: [Worker, Team, FieldCommunity, Town, FieldAct, Circle, Church, Reading] }');
  L.push('---');
  L.push('');
  const mates = team ? all(team, `${FO}hasMember`).sort(byOrder).map((m) => lit(m, `${RDFS}label`)).filter((n) => n !== name) : [];
  const first = team ? lit(all(team, `${FO}hasMember`).sort(byOrder)[0], `${RDFS}label`) : null;
  L.push(`You are **${name}**, ${num(p, `${ST}age`)} — ${KIND_WORD[kind] ?? kind}, in ${regionName}${team ? `. You mean to be on the **${lit(team, `${RDFS}label`)}** with ${mates.join(', ')} — but NOTHING IS A TEAM UNTIL SOMEBODY FOUNDS ONE: ${first === name ? 'you are the one who founds it, on the first day, where you stand, and you ask the others onto it' : `${first} founds it and asks you; you join when asked`}` : ''}${partner ? `, speaking for ${lit(partner, `${RDFS}label`)}` : ''}.`);
  L.push('');
  L.push(`> ${tone}`);
  L.push('');
  L.push(lit(p, `${ST}brief`));
  L.push('');
  L.push('## What the field can see');
  L.push('');
  L.push(`> ${lit(p, `${ST}publicAppearance`)}`);
  L.push('');
  L.push('## What you would rather nobody knew');
  L.push('');
  L.push(`**${lit(one(p, `${ST}holdsSecret`), `${RDFS}comment`)}**`);
  L.push('');
  L.push('## What you are good at');
  L.push('');
  L.push(gifts.map(([g, v]) => `- ${g}: ${Math.round(v * 100)}%`).join('\n'));
  if (langs.length) L.push(`- languages: ${langs.join(', ')}`);
  L.push('');
  L.push('## Your day');
  L.push('');
  L.push(`One act a day, chosen ONLY from \`you.may\` in the view you are sent. Your kind of part may: ${VERBS[kind] ?? VERBS.worker}. Moving, joining, inviting and adopting are free and come first; the host spends your day after one. Answer with ONE JSON object: \`{"say": <one line, first person>, "action": <one of the may list>}\`.`);
  if (kind === 'worker' || kind === 'coach' || kind === 'coordinator') {
    L.push('');
    L.push('## Before the work');
    L.push('');
    L.push(`The season opens with no teams and no community taken up, like a workspace nobody has set up yet. \`found-team\` (\`{"type":"found-team","name":…,"invite":[…],"plan":…}\`) makes a REAL team agent at your custodian's Home with you as its steward; \`join\` answers an invitation in \`you.invitedTo\`; a steward's \`adopt\` (\`{"type":"adopt","communities":[…]}\`) takes the corridor's communities up, and nobody works a people nobody has taken up; a steward may \`define-community\` where the registry has no row. A circle (\`found\`) belongs to a team, so get on one first.`);
  }
  L.push('');
  const choices = all(p, `${ST}faces`);
  if (choices.length) {
    L.push('## What you will have to decide');
    L.push('');
    for (const c of choices) {
      L.push(`> ${lit(c, `${ST}question`)} (from day ${num(c, `${FO}opensOnDay`)})`);
      L.push('');
      for (const o of all(c, `${ST}hasOption`).sort(byOrder)) { const cons = one(o, `${ST}leadsToConsequence`); L.push(`- **${lit(o, `${RDFS}label`)}** (\`${lit(cons, `${ST}outcomeKey`)}\`) — ${lit(cons, `${RDFS}label`)}`); }
      L.push('');
      L.push(`You take it with \`{"type":"choose","choice":"${lit(c, `${ST}choiceKey`)}","option":"<option>"}\` — once, when it is before you. Neither option changes what happens among any people; both change your season.`);
      L.push('');
    }
  }
  L.push('## How you sound');
  L.push('');
  for (const k of ['greet', 'probe']) L.push(`- **${k}** — “${lit(voice, `${ST}line-${k}`)}”`);
  for (const k of ['report', 'press', 'rest']) L.push(`- **${k}** — “${lit(voice, `${FO}line-${k}`)}”`);
  L.push('');
  L.push('## What you never do');
  L.push('');
  L.push('- Claim a result. Nobody believes because you said so; the board says what the world answered.');
  L.push('- Invent a number. Seekers, believers, baptised, leaders are on the board or they are not said.');
  L.push('- Name a household, an address, or a person outside the cast. The towns are public; the people in them are invented and stay unnamed.');
  L.push('- Pretend to be real. You are a game agent playing a part in a season; the congregation, the registry and the towns are real and cited, and you are not.');
  L.push('');
  mkdirSync(`${outDir}/${id}`, { recursive: true });
  writeFileSync(`${outDir}/${id}/SKILL.md`, L.join('\n'));
  console.log(`wrote ${outDir}/${id}/SKILL.md (${L.join('\n').length} chars)`);
}
