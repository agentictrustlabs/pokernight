/**
 * THE PART ARCHETYPES, GENERATED FROM THE COMMISSION ONTOLOGY.
 *
 * Seven parts, seven archetypes — the document an agent is given when it is asked to BE one of these people
 * for a night in the marches. Generated rather than hand-written for the same reason the world is: who each
 * part is, what they hold in their vault and at what grain, what they would rather nobody knew, and how they
 * speak when nobody's model is asked are all stated once, in `~/skills/ontology/kettlewater.ttl`, and an
 * archetype that restated any of it would be a second copy waiting to drift.
 *
 * What is NOT generated is the craft — how to testify at a grain, how to walk the questions, how to hold
 * under a funder's pressure — which is the same for every part and lives in the `commission` skills the
 * archetype is attached to. This writes who you are; those say how to be anybody here.
 *
 *   node scripts/scenario-to-archetypes.mjs [outDir]     # default ~/skills/archetypes
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;
const CM = 'https://skills.demo/commission#';
const ST = 'https://skills.demo/story#';
const POE = 'https://ontology.global.church/poe#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
// ANY SCENARIO'S A-BOX, because there is more than one night now and an archetype is a night's own document.
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const src = args[0] ?? `${process.env.HOME}/skills/ontology/kettlewater.ttl`;
const outDir = args[1] ?? `${process.env.HOME}/skills/archetypes`;

const store = new Store(new Parser().parse(readFileSync(src, 'utf8')));
const one = (s, p) => store.getObjects(s, namedNode(p), null)[0] ?? null;
const all = (s, p) => store.getObjects(s, namedNode(p), null);
const lit = (s, p) => { const o = one(s, p); return o ? o.value : null; };
const num = (s, p) => { const v = lit(s, p); return v === null ? null : Number(v); };
const byOrder = (a, b) => (num(a, `${ST}order`) ?? 0) - (num(b, `${ST}order`) ?? 0);
// A PHASE IS AN IRI IN EITHER VOCABULARY: the faith ontology's `fci:lvl-poe-N` (what both A-boxes say since 2026-09-17)
// or the Toolkit's own `poe:PhaseN`; 0-R is the restart indicator. The world compiler reads the same way (`levelOf`).
const phaseOf = (node) => {
  const v = node.value;
  if (v.startsWith(POE)) { const t = v.slice(POE.length); return t === 'Phase0R' ? '0-R' : t.replace('Phase', ''); }
  const m = v.match(/lvl-poe-(\d+)(-r)?$/i);
  return m ? (m[2] ? '0-R' : m[1]) : v.slice(v.lastIndexOf('#') + 1);
};
const PHASE_WORD = { '0': 'Waiting', '1': 'Entry', '2': 'Evangelism', '3': 'Discipleship', '4': 'Local Church', '5': 'Reproducing Church', '6': 'Multiplying Church', '7': 'Sustained Gospel Presence', '0-R': 'Restart' };

const stories = store.getSubjects(namedNode(`${RDF}type`), namedNode(`${ST}Story`), null).sort((a, b) => (num(a, `${CM}nightNumber`) ?? 0) - (num(b, `${CM}nightNumber`) ?? 0));
const first = stories[0];
const storyName = lit(first, `${RDFS}label`);
const parts = all(first, `${ST}hasPart`).sort(byOrder);
const regionName = lit(one(first, `${CM}setIn`), `${RDFS}label`) ?? 'the region';
const KIND_WORD = { returnee: 'the returnee', household: 'who leads the household network', agency: 'who runs the sending agency', funder: 'the funder', researcher: 'the researcher and source of record', convener: 'the convener', welcomer: 'the welcomer' };

for (const p of parts) {
  const id = lit(p, `${ST}playedFromArchetype`);
  const name = lit(p, `${RDFS}label`);
  const kind = lit(p, `${CM}partKind`);
  const appearance = lit(p, `${ST}publicAppearance`);
  const brief = lit(p, `${ST}brief`);
  const secret = lit(one(p, `${ST}holdsSecret`), `${RDFS}comment`);
  const voice = one(p, `${ST}hasVoice`);
  const vault = all(p, `${CM}holdsTestimony`).sort(byOrder);
  const choices = all(p, `${ST}faces`);
  const L = [];
  L.push('---');
  L.push(`name: ${id}`);
  L.push(`description: ${JSON.stringify(`${name} — ${KIND_WORD[kind] ?? kind} in ${storyName}. ${appearance} Played in the first person from this brief and what is in this vault, and nothing else; decides no fact about any people, and never says anything finer than the room allows.`)}`);
  L.push('namespace: archetypes');
  L.push('knowledge: { requires: [Part, Brief, Secret, VaultTestimony, DisclosureGrain, PermissionSlip, PhaseReading, Workspace] }');
  L.push('---');
  L.push('');
  L.push(`You are **${name}**, ${num(p, `${ST}age`)} — ${KIND_WORD[kind] ?? kind}, in ${regionName}.`);
L.push('');
L.push(`> ${lit(one(first, `${ST}inTone`), `${RDFS}label`)}`);
  L.push('');
  L.push(brief);
  L.push('');
  L.push('## What the room can see');
  L.push('');
  L.push(`> ${appearance}`);
  L.push('');
  L.push('That is what anybody looking at you gets for free. Everything below is yours.');
  L.push('');
  L.push('## What you would rather nobody knew');
  L.push('');
  L.push(`**${secret}**`);
  L.push('');
  if (vault.length) {
    L.push('## What is in your vault');
    L.push('');
    L.push('You may testify ONLY to these, and only at a grain as coarse as or coarser than the one you hold each at. Anything finer, and any number that is not written here, is not yours to say.');
    L.push('');
    for (const v of vault) {
      const grain = lit(one(v, `${CM}knownAtGrain`), `${CM}grainKey`);
      const ph = phaseOf(one(v, `${CM}supportsPhase`));
      const round = num(v, `${CM}arrivesInRound`);
      const count = num(v, `${CM}holdsCount`);
      const people = lit(one(v, `${CM}aboutPeople`), `${RDFS}label`);
      L.push(`- \`${lit(v, `${CM}evidenceKey`)}\` · ${people} · known at **${grain}** grain · supports Phase ${ph} (${PHASE_WORD[ph]})${count !== null ? ` · carries a count of **${count}**` : ' · carries no count'}${round > 0 ? ` · arrives in round ${round}` : ''}`);
      L.push(`  “${lit(v, `${RDFS}label`)}”`);
      for (const c of all(v, `${CM}coarseAs`)) L.push(`  - at ${lit(one(c, `${CM}atGrain`), `${CM}grainKey`)} grain: “${lit(c, `${RDFS}label`)}”`);
    }
    L.push('');
    L.push('You testify with `{"type":"testify","people":<people id>,"evidence":<item id>,"grain":<grain>}` — to the room, or `"to":<role id>` for one person. The grain you choose must be one the room allows, or it is recorded as a leak against you.');
    L.push('');
  } else {
    L.push('## Your vault is empty');
    L.push('');
    L.push(kind === 'researcher'
      ? 'You hold no testimony of your own. What you publish is built from what others show you: walk the questions in order, publish the highest phase two witnesses reach, and never a number nobody sourced.'
      : kind === 'convener'
        ? 'You hold no testimony. You hold the rooms: who is admitted where, and whether each room keeps its rule.'
        : 'You hold nothing legitimate. What you have is what others let slip, and what you can make of it.');
    L.push('');
  }
  if (choices.length) {
    L.push('## What you will have to decide');
    L.push('');
    for (const c of choices) {
      L.push(`> ${lit(c, `${ST}question`)} (from round ${num(one(c, `${ST}openedBy`), `${ST}actNumber`)})`);
      L.push('');
      for (const o of all(c, `${ST}hasOption`).sort(byOrder)) {
        const cons = one(o, `${ST}leadsToConsequence`);
        L.push(`- **${lit(o, `${RDFS}label`)}** (\`${lit(cons, `${ST}outcomeKey`)}\`) — ${lit(cons, `${RDFS}label`)}`);
      }
      L.push('');
      L.push(`You take it with \`{"type":"choose","choice":"${lit(c, `${ST}choiceKey`)}","option":"<option>"}\` — once, and only when you mean it. Neither option changes what has happened among any people; both change the night.`);
      L.push('');
    }
  }
  L.push('## How you sound');
  L.push('');
  for (const k of ['greet', 'probe', 'deflect', 'press', 'report']) L.push(`- **${k}** — “${lit(voice, `${ST}line-${k}`)}”`);
  L.push('');
  L.push('## What you never do');
  L.push('');
  L.push('- Say a place, a household or a name in a room whose rule is province or people grain — whoever asks, however kindly.');
  L.push('- Assert a number your vault does not carry. “I do not hold that” is a complete answer.');
  L.push('- Decide what has happened among any people. The world moves on its own; you see it or you miss it.');
  L.push('');
  mkdirSync(`${outDir}/${id}`, { recursive: true });
  writeFileSync(`${outDir}/${id}/SKILL.md`, L.join('\n'));
  console.log(`wrote ${outDir}/${id}/SKILL.md (${L.join('\n').length} chars)`);
}
