/**
 * WHERE EACH PEOPLE IS NOW, READ FROM THE PUBLIC REGISTRY — the floor a Field Operations season starts from.
 *
 * `gc-public` (GraphDB, graphdb.agentkg.io) holds a `gc:PeopleCommunity` per people per corridor north of Denver,
 * each pointing at its identity (`gc:communityHasIdentity` — the Colorado Impact Project's alliance identity, or a
 * Joshua Project / IMB one), and a `gc:CommunityPhaseResult` per community with `gc:assignedLevel` in the
 * registry's `fw-npl-phases`. This reads those, resolves each identity to its ROP / PEID / PG ids through the
 * aligned IMB and JP identities (`gc:hasPeopleClassification` → ROP concept; the IMB identity's notations), and
 * writes `packages/fieldops/src/worlds/registry.generated.ts` — the communities, cited, with the phase each one
 * opens at. The world compiler lays the A-box's content (towns, teams, parts, weeks) over it.
 *
 *   GRAPHDB_BASIC=user:pass node scripts/registry-to-fieldops.mjs > packages/fieldops/src/worlds/registry.generated.ts
 *   (reads .graphdb.env at the repo root when the variable is not set)
 *
 * COMPILED, NEVER LOADED: the Worker holds no registry credential and a season opens on the floor this wrote. The
 * date it was read is stamped on the world so the board can say how old its floor is.
 */
import { readFileSync, existsSync } from 'node:fs';

const envFile = new URL('../.graphdb.env', import.meta.url);
if (!process.env.GRAPHDB_BASIC && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
}
const URL_BASE = process.env.GRAPHDB_URL ?? 'https://graphdb.agentkg.io';
const BASIC = process.env.GRAPHDB_BASIC;
if (!BASIC) { console.error('GRAPHDB_BASIC is required (user:pass), or .graphdb.env at the repo root'); process.exit(1); }
const REPO = `${URL_BASE}/repositories/gc-public`;
const auth = 'Basic ' + Buffer.from(BASIC).toString('base64');

async function select(query) {
  const r = await fetch(REPO, { method: 'POST', headers: { authorization: auth, accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ query }) });
  if (!r.ok) throw new Error(`gc-public ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

const PREFIX = `PREFIX gc: <https://ontology.global.church/core#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX skos: <http://www.w3.org/2004/02/skos/core#> PREFIX at: <https://agentictrustlabs.dev/ns/agentic-trust#>`;

/** The corridors this game plays, by the suffix the registry's community IRIs carry. */
const CORRIDORS = {
  weld: { suffix: '-weld', name: 'Greeley / Weld County corridor' },
  larimer: { suffix: '-larimer', name: 'Northern Front Range / Larimer' },
  boulder: { suffix: '-boulder-broomfield', name: 'Boulder / Broomfield / Longmont corridor' },
  plains: { suffix: '-morgan-logan-yuma', name: 'Northeast Plains' },
};

const communities = await select(`${PREFIX}
SELECT ?c ?label ?identity ?idLabel ?scheme ?lang ?religion ?lvl ?date WHERE {
  ?c a gc:PeopleCommunity ; rdfs:label ?label ; gc:communityHasIdentity ?identity .
  ?identity rdfs:label ?idLabel . OPTIONAL { ?identity gc:identityInScheme ?scheme }
  OPTIONAL { ?identity gc:hasLanguageClassification ?lang } OPTIONAL { ?identity gc:hasReligionClassification ?religion }
  OPTIONAL { ?r a gc:CommunityPhaseResult ; at:aboutSubject ?c ; gc:assignedLevel ?lvl . OPTIONAL { ?r gc:resultDate ?date } }
}`);

/** ROP, PEID and PG id for an identity: the alliance identity carries none, so the IMB identity on the same ROP is found by name. */
const imb = await select(`${PREFIX}
SELECT ?i ?label ?rop ?notation WHERE {
  ?i a gc:PeopleGroupIdentity ; gc:identityInScheme <https://graph.global.church/scheme/peoplegroups-org> ; rdfs:label ?label .
  OPTIONAL { ?i gc:hasPeopleClassification ?pc . ?pc skos:notation ?rop }
  OPTIONAL { ?i skos:notation ?notation }
}`);
const jp = await select(`${PREFIX}
SELECT ?i ?label ?rop WHERE {
  ?i a gc:PeopleGroupIdentity ; gc:identityInScheme <https://graph.global.church/scheme/joshua-project> ; rdfs:label ?label .
  OPTIONAL { ?i gc:hasPeopleClassification ?pc . ?pc skos:notation ?rop }
}`);
const byImbLabel = new Map();
for (const r of imb) {
  const e = byImbLabel.get(r.label) ?? { iri: r.i, rop: r.rop, peid: undefined, pgId: undefined };
  const m = /IMB (PEID|PGID) (\S+)/.exec(r.notation ?? '');
  if (m) { if (m[1] === 'PEID') e.peid = m[2]; else e.pgId = m[2]; }
  if (r.rop) e.rop = String(r.rop).replace(/^.*?(\d{6}).*$/, '$1');
  byImbLabel.set(r.label, e);
}
const byJpLabel = new Map(jp.map((r) => [r.label, { iri: r.i, rop: r.rop ? String(r.rop).replace(/^.*?(\d{6}).*$/, '$1') : undefined }]));
const HOME_COUNTRY = { Somalis: 'Somalia', 'Somali Bantus': 'Somalia', Burmese: 'Myanmar', Guatemalans: 'Guatemala', Mexicans: 'Mexico', Rohingya: 'Myanmar', Eritreans: 'Eritrea', Tigrai: 'Ethiopia', Burundians: 'Burundi', Congolese: 'DR Congo', Rwandans: 'Rwanda', "S'gaw Karen": 'Myanmar', 'Pwo Karen': 'Myanmar', Swahili: 'Tanzania', Afghans: 'Afghanistan', 'Han Chinese (Mandarin)': 'China', Hindi: 'India', Vietnamese: 'Vietnam', Nepalis: 'Nepal', Russians: 'Russia', Gujaratis: 'India', 'Chinese Americans': 'United States', Punjabis: 'India', Persians: 'Iran', Sikhs: 'India', Koreans: 'Korea', Ukrainians: 'Ukraine', Tibetans: 'Tibet', Filipinos: 'Philippines' };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const out = [];
for (const r of communities) {
  const corridor = Object.entries(CORRIDORS).find(([, v]) => r.c.endsWith(v.suffix))?.[0];
  if (!corridor) continue;
  const peopleName = r.label.split(' — ')[0].trim();
  const i = byImbLabel.get(peopleName) ?? byImbLabel.get(peopleName.replace(/s$/, '')) ?? null;
  const j = byJpLabel.get(peopleName) ?? null;
  const level = r.lvl ? Number(r.lvl.slice(-1)) : 0;
  const existing = out.find((x) => x.iri === r.c);
  if (existing) { if (r.date && (!existing.resultDate || r.date > existing.resultDate)) { existing.phase = level; existing.resultDate = r.date; } continue; }
  out.push({
    id: `${slug(peopleName)}-${corridor}`, iri: r.c, name: r.label, corridor, peopleName,
    identity: { iri: r.identity, label: r.idLabel, scheme: r.scheme ?? '' },
    ropId: i?.rop ?? j?.rop, peid: i?.peid, pgId: i?.pgId, language: r.lang ? r.lang.split('/').pop().replace(/-/g, ' ') : undefined, religion: r.religion ? r.religion.split('/').pop().replace(/-/g, ' ') : undefined,
    homeCountry: HOME_COUNTRY[peopleName],
    phase: r.lvl ? level : 0, resultDate: r.date && r.date !== 'undated' ? r.date : null, hasResult: !!r.lvl,
  });
}
out.sort((a, b) => a.corridor.localeCompare(b.corridor) || a.name.localeCompare(b.name));
const j = (v) => JSON.stringify(v);
const L = [];
L.push('/**');
L.push(' * GENERATED FROM THE PUBLIC REGISTRY — do not edit by hand.');
L.push(' *');
L.push(` * Source: gc-public (${URL_BASE}), read ${new Date().toISOString()} by scripts/registry-to-fieldops.mjs.`);
L.push(' * Each entry is a gc:PeopleCommunity north of Denver with its identity, cited, and the phase its latest');
L.push(' * gc:CommunityPhaseResult assigned in fw-npl-phases — the floor a season opens from. Rebuild: `pnpm gen:fieldops`');
L.push(' */');
L.push('export interface RegistryCommunity {');
L.push('  id: string; iri: string; name: string; corridor: string; peopleName: string;');
L.push('  identity: { iri: string; label: string; scheme: string };');
L.push('  ropId?: string; peid?: string; pgId?: string; language?: string; religion?: string; homeCountry?: string;');
L.push('  phase: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; resultDate: string | null; hasResult: boolean;');
L.push('}');
L.push(`export const REGISTRY_READ_AT = ${j(new Date().toISOString())};`);
L.push(`export const REGISTRY_COMMUNITIES: RegistryCommunity[] = ${JSON.stringify(out, null, 2)};`);
console.log(L.join('\n'));
console.error(`${out.length} communities across ${new Set(out.map((x) => x.corridor)).size} corridors; ${out.filter((x) => x.hasResult).length} with a phase result`);
