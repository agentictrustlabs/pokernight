/**
 * CAN THIS STORY RUN IN THIS PLACE — and if not, exactly which requirement fails and why.
 *
 * A story that requires "the room named Winter Garden" runs in one building. A story that requires "a
 * gathering space for eight, a private place to interview, a place for a body with two ways in, the register
 * and the racks, a two-door route from the kitchen to the guest floor, and somewhere outdoors to have been" runs
 * in any building that has those — and is REFUSED, with the reason, by any that does not. The refusal is the
 * valuable half: "this story cannot run in the lodge because the room its body lies in has one way in" is an
 * authoring conversation; changing 'hotel' to 'lodge' in a prompt is not.
 *
 * Each requirement satisfied is answered with a BINDING WITNESS — the exact place bound to the role and the
 * condition that was checked — so a director can address "the gathering space" and have it be the lobby
 * tonight and the great hall next month. Topology (door-crossings) is the only route check made here; travel
 * time, sightlines and audibility are different checks and are reported as unchecked rather than assumed.
 *
 *   node scripts/place-compat.mjs [story.ttl ...] --place path/to/place.ttl [--json]
 *   defaults: ~/skills/ontology/belvedere-snowfall.ttl + -v2.ttl against ~/skills/ontology/belvedere.ttl
 * Exit 0 when compatible, 1 when not.
 */
import { readFileSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';
const { namedNode } = DataFactory;
const PL = 'https://skills.demo/place#', ST = 'https://skills.demo/story#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const H = process.env.HOME;
const args = process.argv.slice(2);
const json = args.includes('--json');
const placeIdx = args.indexOf('--place');
const placeFile = placeIdx >= 0 ? args[placeIdx + 1] : `${H}/skills/ontology/belvedere.ttl`;
const storyFiles = args.filter((a, i) => !a.startsWith('--') && i !== placeIdx + 1);
if (!storyFiles.length) storyFiles.push(`${H}/skills/ontology/belvedere-snowfall.ttl`, `${H}/skills/ontology/belvedere-snowfall-v2.ttl`);

const load = (files) => { const s = new Store(); for (const f of files) s.addQuads(new Parser().parse(readFileSync(f, 'utf8'))); return s; };
const story = load(storyFiles), place = load([placeFile]);
const lit = (g, s, p) => g.getObjects(s, namedNode(p), null)[0]?.value ?? null;
const num = (g, s, p) => { const v = lit(g, s, p); return v === null ? null : Number(v); };
const objs = (g, s, p) => g.getObjects(s, namedNode(p), null).map((o) => o.value);
const typed = (g, t) => g.getSubjects(namedNode(`${RDF}type`), namedNode(t), null).map((x) => x.value);
const short = (iri) => iri.split('#').pop();
const label = (g, s) => lit(g, s, `${RDFS}label`) ?? short(s);

// ── the place, as a graph a story can be asked about ──
const rooms = [...new Set([...typed(place, `${PL}Room`), ...typed(place, `${PL}OpenSpace`), ...typed(place, `${PL}Grounds`)])];
const isOutdoors = (r) => lit(place, r, `${PL}outdoors`) === 'true';
const stations = (r) => objs(place, r, `${PL}hasStation`).length;
const openings = (r) => objs(place, r, `${PL}hasOpening`).map((o) => ({ o, to: objs(place, o, `${PL}leadsTo`)[0] })).filter((x) => x.to);
const featureKeys = (r) => place.getSubjects(namedNode(`${PL}featureIn`), namedNode(r), null).map((f) => lit(place, f.value, `${PL}featureKey`)).filter(Boolean);
const hasRepose = (r) => objs(place, r, `${PL}hasAnchor`).some((a) => lit(place, a, `${PL}anchorRole`) === 'repose');
const adj = new Map(rooms.map((r) => [r, new Set(openings(r).map((x) => x.to))]));
// undirected, because a door is walkable both ways once open
for (const [a, set] of adj) for (const b of set) adj.get(b)?.add(a);
const crossings = (from, to) => { // BFS over doors
  const seen = new Map([[from, 0]]); const q = [from];
  while (q.length) { const x = q.shift(); if (x === to) return seen.get(x); for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.set(y, seen.get(x) + 1); q.push(y); } }
  return Infinity;
};

// ── the story's requirements ──
const st = typed(story, `${ST}Story`)[0];
const reqs = objs(story, st, `${ST}requiresPlace`);
const bound = {}; // role key → place iri, so a route can refer to roles bound earlier and to raw room keys
const results = [];
const satisfy = (req) => {
  const key = lit(story, req, `${PL}requirementKey`), kind = lit(story, req, `${PL}requiredKind`);
  const name = label(story, req);
  const ok = (placeIri, condition) => { bound[key] = placeIri; return { key, kind, name, ok: true, place: short(placeIri), condition }; };
  const fail = (reason) => ({ key, kind, name, ok: false, reason });
  switch (kind) {
    case 'gathering': {
      const need = num(story, req, `${PL}minStations`) ?? 1;
      const cands = rooms.filter((r) => !isOutdoors(r) && stations(r) >= need).sort((a, b) => stations(b) - stations(a));
      if (!cands.length) return fail(`no indoor place has ${need} stations (best: ${rooms.map((r) => `${short(r)}=${stations(r)}`).join(', ')})`);
      const r = cands[0];
      return ok(r, `${stations(r)} stations ≥ ${need}; doors to ${[...adj.get(r)].map(short).join(', ')}`);
    }
    case 'private': {
      const maxO = num(story, req, `${PL}maxOpenings`) ?? 1, minS = num(story, req, `${PL}minStations`) ?? 2;
      const cands = rooms.filter((r) => r !== bound.gathering && !isOutdoors(r) && openings(r).length <= maxO && stations(r) >= minS);
      if (!cands.length) return fail(`no indoor place other than the gathering space has ≤ ${maxO} openings and ≥ ${minS} stations`);
      return ok(cands[0], `${openings(cands[0]).length} opening(s) ≤ ${maxO}; ${stations(cands[0])} stations`);
    }
    case 'repose': {
      const minO = num(story, req, `${PL}minOpenings`) ?? 2;
      const fk = lit(story, req, `${PL}requiresFeatureKey`);
      const withAnchor = rooms.filter((r) => hasRepose(r) && (!fk || featureKeys(r).includes(fk)));
      if (!withAnchor.length) return fail(`no place declares where a body lies${fk ? ` beside the "${fk}"` : ''} (an anchor with role "repose")`);
      const cands = withAnchor.filter((r) => openings(r).length >= minO);
      if (!cands.length) return fail(`a body can lie in ${withAnchor.map(short).join(', ')}, but none of those has ${minO} ways in — the alibi has nothing to turn on (openings: ${withAnchor.map((r) => `${short(r)}=${openings(r).length}`).join(', ')})`);
      // prefer the one the story opens with, if it says
      const opening = objs(story, st, `${ST}opensWithDeathAt`)[0];
      const r = cands.find((c) => c === opening) ?? cands[0];
      return ok(r, `repose anchor; ${openings(r).length} openings ≥ ${minO}: ${openings(r).map((x) => label(place, x.o)).join(', ')}`);
    }
    case 'feature': {
      const fk = lit(story, req, `${PL}requiresFeatureKey`);
      const r = rooms.find((rm) => featureKeys(rm).includes(fk));
      if (!r) return fail(`no feature with key "${fk}" anywhere in the place (features: ${rooms.flatMap(featureKeys).join(', ')})`);
      return ok(r, `feature "${fk}" is in ${short(r)}`);
    }
    case 'route': {
      const fromRole = lit(story, req, `${PL}fromRole`), toRole = lit(story, req, `${PL}toRole`), max = num(story, req, `${PL}maxCrossings`);
      const resolve = (role) => bound[role] ?? rooms.find((r) => short(r) === role || short(r) === role.replace(/-floor$/, '-room') || label(place, r).toLowerCase().includes(role.replace(/-/g, ' ')));
      const a = resolve(fromRole), b = resolve(toRole);
      if (!a || !b) return fail(`cannot resolve ${!a ? fromRole : toRole} to a place`);
      const n = crossings(a, b);
      if (n > max) return fail(`${short(a)} → ${short(b)} takes ${n === Infinity ? 'no route at all' : `${n} doors`}, more than ${max}`);
      return ok(b, `${short(a)} → ${short(b)} in ${n} door(s) ≤ ${max} (topology only; walking time unchecked)`);
    }
    case 'outdoor': {
      const r = rooms.find(isOutdoors);
      if (!r) return fail('the place has nowhere outdoors — nobody can claim to have been outside');
      return ok(r, 'outdoors: true');
    }
    default: return fail(`unknown requirement kind "${kind}"`);
  }
};
// order: bind the gathering space first, then everything that may refer to it
const order = ['gathering', 'private', 'repose', 'feature', 'route', 'outdoor'];
for (const kind of order) for (const req of reqs) if (lit(story, req, `${PL}requiredKind`) === kind) results.push(satisfy(req));

const passed = results.every((r) => r.ok);
if (json) console.log(JSON.stringify({ story: label(story, st), place: label(place, typed(place, `${PL}Building`)[0] ?? typed(place, `${PL}Site`)[0] ?? ''), compatible: passed, results }, null, 2));
else {
  console.log(`${label(story, st)}  ×  ${label(place, typed(place, `${PL}Building`)[0] ?? '') || placeFile}`);
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.key.padEnd(10)} ${r.ok ? `→ ${r.place}  (${r.condition})` : `FAILS: ${r.reason}`}`);
  console.log(passed ? '\nCompatible. Every requirement has a witness.' : '\nNOT compatible — the failures above say exactly what the place lacks.');
}
process.exit(passed ? 0 : 1);
