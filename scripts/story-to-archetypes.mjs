/**
 * THE PART ARCHETYPES, GENERATED FROM THE STORY ONTOLOGY.
 *
 * Eight parts, eight archetypes — the document an agent is given when it is asked to BE one of these people
 * for an evening. Generated rather than hand-written for the same reason the title is: the part's age, what
 * they are hiding, what evidence could point at them and how they speak when nobody's model is asked are all
 * stated once, in `~/skills/ontology/belvedere-snowfall.ttl`, and an archetype that restated any of it would
 * be a second copy waiting to drift.
 *
 * What is NOT generated is the craft — how to play a part in a mystery at all — which is the same for all
 * eight and lives in the skills the archetype is attached to (`mystery-inhabit`, `mystery-scene`, and the
 * rest). This file writes who you are; those say how to be anybody.
 *
 *   node scripts/story-to-archetypes.mjs [outDir]     # default ~/skills/archetypes
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;
const ST = 'https://skills.demo/story#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const src = `${process.env.HOME}/skills/ontology/belvedere-snowfall.ttl`;
const outDir = process.argv[2] ?? `${process.env.HOME}/skills/archetypes`;

const store = new Store(new Parser().parse(readFileSync(src, 'utf8')));
// the intent layer — what each part wants, what it would cost, and the choice they will face — when it is there
const v2 = src.replace(/\.ttl$/, '-v2.ttl');
if (existsSync(v2)) store.addQuads(new Parser().parse(readFileSync(v2, 'utf8')));
const one = (s, p) => store.getObjects(s, namedNode(p), null)[0] ?? null;
const all = (s, p) => store.getObjects(s, namedNode(p), null);
const lit = (s, p) => one(s, p)?.value ?? null;
const num = (s, p) => { const v = lit(s, p); return v === null ? null : Number(v); };
/**
 * WHAT YOU WANT, AND WHAT YOU WILL HAVE TO DECIDE. A part with a goal behaves like somebody who wants
 * something, which is the difference between a suspect and a witness; a part with a written choice can make an
 * evening differ from the last one by deciding, not by a model wording it differently. The consequences are
 * given in full — you are the one choosing, and you may choose knowing what it costs.
 */
const wantSection = (p) => {
  const goal = one(p, `${ST}pursues`), stake = one(p, `${ST}atStake`), torn = one(p, `${ST}torn`);
  const choices = all(p, `${ST}faces`);
  if (!goal && !choices.length) return '';
  const out = [];
  if (goal) {
    out.push('', '## What you want tonight', '', `**${lit(goal, `${RDFS}label`)}.**`);
    if (stake) out.push('', `What it would cost you: ${lit(stake, `${RDFS}label`)}.`);
    if (torn) out.push(`What you are torn between: ${lit(torn, `${RDFS}label`)}.`);
  }
  for (const c of choices) {
    const act = num(one(c, `${ST}openedBy`), `${ST}actNumber`);
    out.push('', `## What you will have to decide (from act ${act})`, '', `> ${lit(c, `${ST}question`)}`, '');
    for (const o of all(c, `${ST}hasOption`)) {
      const cons = one(o, `${ST}leadsToConsequence`);
      out.push(`- **${lit(o, `${RDFS}label`)}** (\`${lit(cons, `${ST}outcomeKey`)}\`) — ${lit(cons, `${RDFS}label`)}`);
    }
    out.push('', `You take it with \`{"type":"choose","choice":"${lit(c, `${ST}choiceKey`)}","option":"<option>"}\` — once, and only when you mean it. Neither option changes who did it; both change the night.`);
  }
  out.push('');
  return out.join('\n');
};
const story = store.getSubjects(namedNode(`${RDF}type`), namedNode(`${ST}Story`), null)[0].value;
const byOrder = (a, b) => (num(a, `${ST}order`) ?? 0) - (num(b, `${ST}order`) ?? 0);
const parts = all(story, `${ST}hasPart`).map((p) => p.value).sort(byOrder);
const acts = all(story, `${ST}hasAct`).map((a) => a.value).sort(byOrder);
const clues = all(story, `${ST}hasEvidence`).map((c) => c.value).sort(byOrder);
const traitKey = (t) => lit(t, `${ST}traitKey`);
const storyName = lit(story, `${RDFS}label`);

/** The traits nobody else has — what makes this part identifiable, and therefore what they must be careful with. */
const traitsOf = (p) => (lit(p, `${ST}traitOrder`) ?? '').split(',').filter(Boolean);
const traitOwners = new Map();
for (const p of parts) for (const t of traitsOf(p)) traitOwners.set(t, [...(traitOwners.get(t) ?? []), lit(p, `${RDFS}label`)]);

let written = 0;
for (const p of parts) {
  const key = lit(p, `${ST}partKey`);
  const name = lit(p, `${RDFS}label`);
  const archetype = lit(p, `${ST}playedFromArchetype`);
  const age = num(p, `${ST}age`);
  const look = one(p, `${ST}hasLook`);
  const voice = one(p, `${ST}hasVoice`);
  const secret = lit(one(p, `${ST}holdsSecret`), `${RDFS}comment`);
  const traits = traitsOf(p);
  const fns = store.getObjects(p, namedNode(`${ST}servesFunction`), null).map((f) => lit(f.value, `${RDFS}label`)).filter(Boolean);
  const wardrobe = all(look, `${ST}hasOutfit`).map((o) => o.value).sort(byOrder);
  const mayBe = lit(p, `${ST}mayBeConspirator`) === 'true';
  const job = key.replace(/[-_]/g, ' ');
  const line = (k) => lit(voice, `${ST}line-${k}`);
  // the clues that point at one of your traits, and the ones found at a thing you would plausibly know
  const aboutYou = clues.filter((c) => { const t = one(c, `${ST}pointsAt`); return t && traits.includes(traitKey(t.value)); });

  const md = `---
name: ${archetype}
description: "${name} — a part in ${storyName}. ${(lit(p, `${ST}publicAppearance`) ?? '').replace(/"/g, "'")} Played in the first person from this brief and nothing else; decides no fact, and never says who did it."
namespace: archetypes
knowledge: { requires: [Part, Brief, Secret, Trait, Evidence, Claim, Scene, Move, Line, Conspirator] }
---

You are **${name}**${age ? `, ${age}` : ''} — the ${job} at the Hôtel Belvedere, on the night the pass shut.

${lit(p, `${ST}brief`)}

## What the room can see

> ${lit(p, `${ST}publicAppearance`)}

That is what anybody looking at you gets for free. Everything below is yours.

## What you would rather nobody knew

**${secret}**

It is almost certainly nothing to do with the death — but you do not know that, and you will behave like
somebody with something to hide, because you are. That is what you are for: a room where everybody is
hiding something is a room where everybody behaves like a suspect.

## What is true of you that evidence could point at

${traits.map((t) => { const others = (traitOwners.get(t) ?? []).filter((o) => o !== name); return `- \`${t}\`${others.length ? ` — also true of ${others.join(', ')}, so on its own it does not name you` : ' — **yours alone in this house**, so anything that turns this up is about you'}`; }).join('\n')}

You do not get to choose what a night gives up about you. You can sometimes choose where you are when it does.
${aboutYou.length ? `\nThings that can be found that point this way: ${aboutYou.map((c) => `“${lit(c, `${RDFS}label`)}”`).join(' ')}` : ''}

## What you are for, structurally
${fns.length ? fns.map((f) => `- ${f}`).join('\n') : '- One of the eight. Nobody in this house is decoration.'}
${wantSection(p)}
## How you sound

${['greet', 'probe', 'deny', 'accuse', 'mourn', 'found'].map((k) => `- **${k === 'found' ? 'when somebody finds something' : k}** — “${line(k)}”`).join('\n')}

Those are the lines the house plays when nobody's model is asked. They are not a script: they are the pitch.
Match them and you will sound like the same person all evening.

## What you are wearing
${wardrobe.length ? wardrobe.map((w) => `- **${lit(w, `${RDFS}label`)}**`).join('\n') : '- What you arrived in.'}

## The evening

${acts.map((a) => `**Act ${num(a, `${ST}actNumber`)} · ${lit(a, `${RDFS}label`)}** — ${lit(one(a, `${ST}actObjective`), `${RDFS}label`)}`).join('\n\n')}

## The ceiling

You decide no fact. You answer with ONE action and ONE line, from your own redacted view of the room and
nothing else — not from this document's knowledge of the other seven, and not from anything you were not
told in the story. Every move you make is validated like anybody's.

${mayBe ? `**You may be the one who did it.** If you are, you will be told so privately and you will know what you are for; if you are not, you are as much in the dark as everybody else. Play the person either way — a character who behaves like a culprit is one nobody has to deduce.` : `**You are never the one who did it** in this story, and you are not told who is. Play it straight.`}

**You never say who did it**, including when you think you know. Say what ${name.split(' ').slice(-1)[0]} would say.
`;
  mkdirSync(`${outDir}/${archetype}`, { recursive: true });
  writeFileSync(`${outDir}/${archetype}/SKILL.md`, md);
  written++;
  console.error(`${archetype}  ${md.length} chars`);
}
console.error(`\n${written} part archetypes written to ${outDir}`);
