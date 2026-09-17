/**
 * THE ROOM PLAN, GENERATED FROM THE PLACE ONTOLOGY.
 *
 * `~/skills/ontology/belvedere.ttl` is the SOURCE for the Hôtel Belvedere: its rooms, their sizes and
 * palettes, every door between them, where people stand, where a body lies, and every thing in every room
 * with the numbers to draw it. This reads that and writes the plan the venue renders — so the hotel a
 * player walks through and the hotel a director narrates are the same hotel by construction, rather than by
 * two people keeping two files in step. Move a door in the ontology and it moves on the screen.
 *
 * WHY A GENERATOR AND NOT A LOADER. The scene is built in a browser, on a lazy-loaded canvas, at the moment
 * somebody walks into a room; parsing a thousand triples there to find out how wide the lobby is would be a
 * download and a delay in exchange for nothing. The ontology is authoring-time truth; this is the compile.
 *
 *   node scripts/place-to-plan.mjs [path/to/belvedere.ttl] > apps/web/src/components/mystery/plan.generated.ts
 *
 * The check that matters is `pnpm test`: the venue's own tests read the generated plan.
 */
import { readFileSync } from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;
const PL = 'https://skills.demo/place#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const src = process.argv[2] ?? `${process.env.HOME}/skills/ontology/belvedere.ttl`;
/**
 * A SECOND PLACE IS A SECOND FILE, and the constant it compiles to is named for it: `--name KETTLEWATER_HOUSE`
 * writes `KETTLEWATER_HOUSE_PLAN_FROM_ONTOLOGY`. The Belvedere keeps its name so nothing that imports it moves.
 */
const nameArg = process.argv.indexOf('--name');
const NAME = nameArg > 0 ? process.argv[nameArg + 1] : 'BELVEDERE';
const srcLabel = src.split('/').pop();

const store = new Store(new Parser().parse(readFileSync(src, 'utf8')));
const one = (s, p) => store.getObjects(s, namedNode(p), null)[0] ?? null;
const all = (s, p) => store.getObjects(s, namedNode(p), null);
const lit = (s, p) => { const o = one(s, p); return o ? o.value : null; };
const num = (s, p) => { const v = lit(s, p); return v === null ? null : Number(v); };
const bool = (s, p) => { const v = lit(s, p); return v === null ? null : v === 'true'; };
const short = (t) => (t?.value ?? '').split('#').pop() ?? '';
/** A room's own id as the app spells it: the last segment of the IRI, which is how it was written. */
const roomKey = (t) => short(t);

// every pl:Room in the file, in the order they appear — the order a reader meets them
const rooms = store
  .getSubjects(namedNode(`${RDF}type`), namedNode(`${PL}Room`), null)
  .map((r) => r.value)
  .filter((v, i, a) => a.indexOf(v) === i);

const j = (v) => JSON.stringify(v);
const n = (v) => (Number.isInteger(v) ? String(v) : String(v));
const out = [];
out.push(`/**`);
out.push(` * GENERATED FROM THE PLACE ONTOLOGY — do not edit by hand.`);
out.push(` *`);
out.push(` * Source: \`~/skills/ontology/${srcLabel}\` (an A-box over \`place.ttl\`).`);
out.push(` * Rebuild: \`node scripts/place-to-plan.mjs > apps/web/src/components/mystery/plan.generated.ts\``);
out.push(` *`);
out.push(` * Every number below is stated in the ontology, in metres, against the bearing the building declares:`);
out.push(` * the origin at the middle of each room's floor, +X to the right, +Z away from the way you come in,`);
out.push(` * and a yaw of zero facing +Z. Changing the building is editing that file and running this one.`);
out.push(` */`);
out.push(`import type { RoomPlan } from './plan';`);
out.push('');
out.push(`export const ${NAME}_PLAN_FROM_ONTOLOGY: Record<string, RoomPlan> = {`);

for (const room of rooms) {
  const key = roomKey({ value: room });
  const ext = one(room, `${PL}hasExtent`);
  const pal = one(room, `${PL}hasPalette`);
  const lines = [];
  lines.push(`    w: ${num(ext, `${PL}halfWidth`)}, d: ${num(ext, `${PL}halfDepth`)},`);
  lines.push(`    floor: ${j(lit(pal, `${PL}floorColour`))}, wall: ${j(lit(pal, `${PL}wallColour`))}, accent: ${j(lit(pal, `${PL}accentColour`))},`);

  const stations = all(room, `${PL}hasStation`)
    .map((s) => ({ x: num(s, `${PL}atX`), z: num(s, `${PL}atZ`), label: lit(s, `${RDFS}label`) ?? '' }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  lines.push(`    spots: [${stations.map((s) => `[${n(s.x)}, ${n(s.z)}]`).join(', ')}],`);

  // ONLY DOORS BETWEEN ROOMS become the plan's doors: the 3D plan walks people room to room, and an opening onto
  // the grounds (the ski room's piste door) is real in the place, real to the story's requirements, and NOT a
  // place the app can put a body — so it is a fact of the A-box that the plan leaves out on purpose.
  const doors = all(room, `${PL}hasOpening`)
    .map((d) => ({ to: roomKey(one(d, `${PL}leadsTo`)), toIri: one(d, `${PL}leadsTo`)?.value, x: num(d, `${PL}atX`), z: num(d, `${PL}atZ`) }))
    .filter((d) => d.to && rooms.includes(d.toIri));
  lines.push(`    doors: { ${doors.map((d) => `${/^[a-z][a-z0-9]*$/i.test(d.to) ? d.to : j(d.to)}: [${n(d.x)}, ${n(d.z)}]`).join(', ')} },`);

  const repose = all(room, `${PL}hasAnchor`).find((a) => lit(a, `${PL}anchorRole`) === 'repose');
  if (repose) {
    const y = num(repose, `${PL}yaw`);
    lines.push(`    deathAt: { x: ${n(num(repose, `${PL}atX`))}, z: ${n(num(repose, `${PL}atZ`))}${y === null ? '' : `, yaw: ${n(y)}`} },`);
  }

  // the features, so a placement can say which prop it is
  const features = all(room, `${PL}holdsPlacement`).length
    ? store.getSubjects(namedNode(`${PL}featureIn`), namedNode(room), null).map((f) => ({
        placement: one(f.value, `${PL}featureOf`)?.value ?? null,
        key: lit(f.value, `${PL}featureKey`),
        // the SHORT label is what floats over the thing in the picture; the full one is for a list
        label: lit(f.value, `${PL}shortLabel`) ?? lit(f.value, `${RDFS}label`),
      }))
    : [];
  const featureAt = new Map(features.filter((f) => f.placement).map((f) => [f.placement, f]));

  const things = all(room, `${PL}holdsPlacement`)
    .map((p) => p.value)
    .sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
  lines.push(`    things: [`);
  for (const p of things) {
    const bits = [];
    const piece = lit(p, `${PL}kitPiece`);
    const shape = lit(p, `${PL}primitiveShape`);
    if (piece) bits.push(`piece: ${j(piece)}`);
    if (shape) {
      const glow = num(p, `${PL}glow`);
      bits.push(`prim: { shape: ${j(shape)}, size: [${n(num(p, `${PL}sizeX`))}, ${n(num(p, `${PL}sizeY`))}, ${n(num(p, `${PL}sizeZ`))}], colour: ${j(lit(p, `${PL}colour`))}${glow === null ? '' : `, glow: ${n(glow)}`} }`);
    }
    bits.push(`x: ${n(num(p, `${PL}atX`))}`, `z: ${n(num(p, `${PL}atZ`))}`);
    for (const [prop, key] of [['atY', 'y'], ['yaw', 'yaw'], ['tilt', 'tilt'], ['lean', 'lean'], ['scale', 'scale']]) {
      const v = num(p, `${PL}${prop}`);
      if (v !== null) bits.push(`${key}: ${n(v)}`);
    }
    const f = featureAt.get(p);
    if (f?.key) bits.push(`prop: ${j(f.key)}`, `label: ${j(f.label)}`);
    lines.push(`      { ${bits.join(', ')} },`);
  }
  lines.push(`    ],`);
  out.push(`  ${/^[a-z][a-z0-9]*$/i.test(key) ? key : j(key)}: {`);
  out.push(...lines);
  out.push(`  },`);
}
out.push(`};`);
out.push('');
console.log(out.join('\n'));
