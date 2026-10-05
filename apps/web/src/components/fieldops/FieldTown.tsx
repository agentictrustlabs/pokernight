/**
 * THE FIELD AS A TOWN, DRAWN — an isometric scene you can fly around (docs/FIELD-OPERATIONS.md §7).
 *
 * `lib/fieldTown.ts` decides what exists and where; this draws it and lets a person move through it. The look is
 * the estate's own town picture — a dark ground on an isometric grid, buildings as three shaded faces with lit
 * windows, tinted quarters, pill labels — but this one is a MAP: the towns stand where they are north of Denver,
 * and the camera moves. Drag to pan, wheel or pinch to zoom, double-click to go in, press a corridor or a town to
 * fly there. Far away it is a region: corridors, towns, the colour of each people's quarter. Close up it is a
 * street: the team's office and its people's homes, a partner church, a people's households with their windows
 * lit, the circle that formed among them, the church it became.
 *
 * DRAWN, NOT SIMULATED, AND PLAIN SVG. A building is polygons; nothing here needs a WebGL context (the room and
 * the venue already hold the two this app can afford), and it is sharp at any zoom because it is vector.
 *
 * THE CAMERA DOES NOT RE-DRAW THE TOWN. The geometry is laid out once, in fixed units, inside one group; moving the
 * camera only rewrites that group's `transform` — set on the element directly, never through React — so a pan is
 * one attribute a frame however many buildings there are. What IS re-drawn on a camera move is the thin layer of
 * labels, which live in screen space so their type stays one size at any zoom.
 *
 * DETAIL FOLLOWS DISTANCE. Three levels: the region (only what matters from far off — halls, churches, team
 * offices, beacons), the corridor (everything, plainly), the street (windows, shadows, trees, the water beside a
 * circle that has baptised, the leaders standing at a church door). Households and homes are drawn only for the
 * towns in or near the frame.
 *
 * A THING APPEARS ON ITS DAY. Each building's element is keyed by its id, so stepping the season forward MOUNTS
 * the ones born that day — and a mount is what plays the rise. Nothing already standing moves.
 *
 * DRAGGING IS POINTER EVENTS (the rule): capture on press, pan on move, and a press that never travelled is a click.
 * NO HOOK AFTER AN EARLY RETURN — every hook in each component here is above its first `return`.
 */
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { BLOCK, matchesFilter, phaseColor, type FieldTownScene, type TownBuilding, type TownFilter, type TownPerson, type TownPlate } from '../../lib/fieldTown';

// ── isometric projection, in fixed units (the camera scales the group) ───────────────────────────────────────────
const U = 22;           // half a tile's width on screen, before the camera
const ZK = 0.92;        // how tall a tile of height reads
export const iso = (x: number, y: number, z = 0): { x: number; y: number } => ({ x: (x - y) * U, y: (x + y) * (U / 2) - z * U * ZK });
const pt = (x: number, y: number, z = 0): string => { const p = iso(x, y, z); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };

const shade = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`;
};
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

/** How much larger than life a town is drawn from the region's distance. */
const FAR_SCALE = 1.75;
const INK = '#e8eef7'; const MUTED = '#93a4bd'; const GLOW = '#ffd27a'; const WATER = '#6ec6ff';
export type Lod = 0 | 1 | 2;
export const lodOf = (k: number): Lod => (k < 0.3 ? 0 : k < 0.72 ? 1 : 2);

// ── a building ──────────────────────────────────────────────────────────────────────────────────────────────────
function Box({ b, lod }: { b: TownBuilding; lod: Lod }): JSX.Element {
  const { x, y, w, d, h } = b;
  const base = b.tone;
  const top = shade(base, 0.36); const left = shade(base, 0.02); const right = shade(base, -0.32);
  const roofL = shade(base, -0.1); const roofR = shade(base, -0.42);
  const out: ReactNode[] = [];
  if (lod >= 1) out.push(<polygon key="sh" points={`${pt(x + 0.12, y + d + 0.04)} ${pt(x + w + 0.5, y + d + 0.04)} ${pt(x + w + 0.5, y + d + 0.4)} ${pt(x + 0.12, y + d + 0.4)}`} fill="#000" opacity={0.26} />);
  if (b.roof === 'beacon') {
    // A storey a phase: seven rings on a mast, lit as far as the records have derived, with a lamp on top.
    const lit = b.phase ?? 0;
    for (let i = 0; i < 7; i++) {
      const z0 = 0.18 + i * 0.42; const z1 = z0 + 0.3; const on = i < lit;
      const c = on ? phaseColor(i + 1) : '#27344b';
      out.push(<polygon key={`bl${i}`} points={`${pt(x, y + d, z0)} ${pt(x + w, y + d, z0)} ${pt(x + w, y + d, z1)} ${pt(x, y + d, z1)}`} fill={shade(c, on ? 0.05 : 0)} />);
      out.push(<polygon key={`br${i}`} points={`${pt(x + w, y + d, z0)} ${pt(x + w, y, z0)} ${pt(x + w, y, z1)} ${pt(x + w, y + d, z1)}`} fill={shade(c, -0.3)} />);
      out.push(<polygon key={`bt${i}`} points={`${pt(x, y, z1)} ${pt(x + w, y, z1)} ${pt(x + w, y + d, z1)} ${pt(x, y + d, z1)}`} fill={shade(c, on ? 0.4 : 0.12)} />);
    }
    const lamp = iso(x + w / 2, y + d / 2, 0.18 + 7 * 0.42 + 0.25);
    out.push(<circle key="halo" cx={lamp.x} cy={lamp.y} r={U * 0.9} fill={phaseColor(lit)} opacity={0.16} />);
    out.push(<circle key="lamp" cx={lamp.x} cy={lamp.y} r={U * 0.26} fill={phaseColor(lit)} stroke={b.accent ?? INK} strokeWidth={2} />);
    return <>{out}</>;
  }
  out.push(<polygon key="l" points={`${pt(x, y + d)} ${pt(x + w, y + d)} ${pt(x + w, y + d, h)} ${pt(x, y + d, h)}`} fill={left} className="ft-face" />);
  out.push(<polygon key="r" points={`${pt(x + w, y + d)} ${pt(x + w, y)} ${pt(x + w, y, h)} ${pt(x + w, y + d, h)}`} fill={right} className="ft-face" />);
  out.push(<polygon key="t" points={`${pt(x, y, h)} ${pt(x + w, y, h)} ${pt(x + w, y + d, h)} ${pt(x, y + d, h)}`} fill={top} className="ft-face" />);
  // Windows: lit where there is somebody inside — always for an office or a church, by state for a household.
  const glowing = b.kind === 'household' ? (b.lit ?? 0) >= 1 : b.kind !== 'civic' || hash(b.id) > 0.4;
  if (lod === 2 || (lod === 1 && b.kind === 'household' && glowing)) {
    const rows = Math.max(1, Math.min(3, Math.floor(h / 0.5)));
    const win = glowing ? GLOW : '#1b2740';
    for (let r = 0; r < rows; r++) {
      const z0 = 0.2 + r * 0.46; const z1 = Math.min(h - 0.08, z0 + 0.24);
      if (z1 <= z0) continue;
      const nL = Math.max(1, Math.round(w * 1.6)); const nR = Math.max(1, Math.round(d * 1.6));
      for (let i = 0; i < nL; i++) { const t0 = (i + 0.28) / nL; const t1 = (i + 0.72) / nL; out.push(<polygon key={`wl${r}${i}`} points={`${pt(x + w * t0, y + d, z0)} ${pt(x + w * t1, y + d, z0)} ${pt(x + w * t1, y + d, z1)} ${pt(x + w * t0, y + d, z1)}`} fill={win} opacity={glowing ? 0.92 : 0.7} className="ft-face" />); }
      for (let i = 0; i < nR; i++) { const t0 = (i + 0.28) / nR; const t1 = (i + 0.72) / nR; out.push(<polygon key={`wr${r}${i}`} points={`${pt(x + w, y + d * (1 - t0), z0)} ${pt(x + w, y + d * (1 - t1), z0)} ${pt(x + w, y + d * (1 - t1), z1)} ${pt(x + w, y + d * (1 - t0), z1)}`} fill={shade(win, -0.28)} opacity={glowing ? 0.9 : 0.7} className="ft-face" />); }
    }
  }
  const rh = Math.max(0.35, Math.min(0.75, h * 0.6));
  if (b.roof === 'gable') {
    const r0 = pt(x, y + d / 2, h + rh); const r1 = pt(x + w, y + d / 2, h + rh);
    out.push(<polygon key="g1" points={`${pt(x, y, h)} ${pt(x + w, y, h)} ${r1} ${r0}`} fill={shade(base, 0.12)} className="ft-face" />);
    out.push(<polygon key="g2" points={`${pt(x, y + d, h)} ${pt(x + w, y + d, h)} ${r1} ${r0}`} fill={roofL} className="ft-face" />);
    out.push(<polygon key="g3" points={`${pt(x + w, y + d, h)} ${pt(x + w, y, h)} ${r1}`} fill={roofR} className="ft-face" />);
  } else if (b.roof === 'dome') {
    const c = iso(x + w / 2, y + d / 2, h); const rx = w * U * 0.62; const ry = rx * 0.5;
    out.push(<ellipse key="d0" cx={c.x} cy={c.y} rx={rx} ry={ry} fill={roofR} />);
    out.push(<path key="d1" d={`M ${c.x - rx} ${c.y} A ${rx} ${rx * 0.9} 0 0 1 ${c.x + rx} ${c.y} Z`} fill={shade(base, 0.2)} className="ft-face" />);
    if (lod === 2) out.push(<path key="d2" d={`M ${c.x - rx * 0.55} ${c.y - rx * 0.72} A ${rx * 0.9} ${rx * 0.8} 0 0 1 ${c.x + rx * 0.2} ${c.y - rx * 0.86}`} fill="none" stroke={shade(base, 0.6)} strokeWidth={2} opacity={0.7} />);
  } else if (b.roof === 'spire') {
    // A hall with a gable, and a tower at the near end with a pointed roof and a cross.
    const r0 = pt(x, y + d / 2, h + rh); const r1 = pt(x + w, y + d / 2, h + rh);
    out.push(<polygon key="g1" points={`${pt(x, y, h)} ${pt(x + w, y, h)} ${r1} ${r0}`} fill={shade(base, 0.12)} />);
    out.push(<polygon key="g2" points={`${pt(x, y + d, h)} ${pt(x + w, y + d, h)} ${r1} ${r0}`} fill={roofL} />);
    out.push(<polygon key="g3" points={`${pt(x + w, y + d, h)} ${pt(x + w, y, h)} ${r1}`} fill={roofR} />);
    const tw = Math.min(0.5, w * 0.34); const tx = x + w - tw - 0.05; const ty = y + d - tw - 0.05; const th = h + rh + 0.55;
    out.push(<polygon key="tl" points={`${pt(tx, ty + tw)} ${pt(tx + tw, ty + tw)} ${pt(tx + tw, ty + tw, th)} ${pt(tx, ty + tw, th)}`} fill={shade(base, 0.08)} />);
    out.push(<polygon key="tr" points={`${pt(tx + tw, ty + tw)} ${pt(tx + tw, ty)} ${pt(tx + tw, ty, th)} ${pt(tx + tw, ty + tw, th)}`} fill={shade(base, -0.3)} />);
    const apex = iso(tx + tw / 2, ty + tw / 2, th + 0.85);
    out.push(<polygon key="sl" points={`${pt(tx, ty + tw, th)} ${pt(tx + tw, ty + tw, th)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`} fill={roofL} />);
    out.push(<polygon key="sr" points={`${pt(tx + tw, ty + tw, th)} ${pt(tx + tw, ty, th)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`} fill={roofR} />);
    if (lod >= 1) out.push(<path key="x" d={`M ${apex.x} ${apex.y} v ${-U * 0.5} M ${apex.x - U * 0.16} ${apex.y - U * 0.34} h ${U * 0.32}`} stroke={INK} strokeWidth={2} strokeLinecap="round" />);
  } else if (b.roof === 'slab') {
    out.push(<polygon key="s" points={`${pt(x - 0.1, y - 0.1, h + 0.14)} ${pt(x + w + 0.1, y - 0.1, h + 0.14)} ${pt(x + w + 0.1, y + d + 0.1, h + 0.14)} ${pt(x - 0.1, y + d + 0.1, h + 0.14)}`} fill={shade(base, 0.5)} />);
  }
  // A team's office flies its colour.
  if (b.kind === 'team') {
    const m = iso(x + 0.25, y + 0.25, h); const mt = iso(x + 0.25, y + 0.25, h + 1.0);
    out.push(<line key="pole" x1={m.x} y1={m.y} x2={mt.x} y2={mt.y} stroke={INK} strokeWidth={2} />);
    out.push(<path key="flag" d={`M ${mt.x} ${mt.y} l ${U * 0.62} ${U * 0.16} l ${-U * 0.62} ${U * 0.2} Z`} fill={shade(b.accent ?? base, 0.25)} className="ft-flag" />);
  }
  // A body: who formed it (a band in the team's colour), the water it has baptised in, the leaders at its door.
  if (b.stats) {
    if (b.accent && lod >= 1) out.push(<polygon key="band" points={`${pt(x, y + d, 0.04)} ${pt(x + w, y + d, 0.04)} ${pt(x + w, y + d, 0.2)} ${pt(x, y + d, 0.2)}`} fill={b.accent} opacity={0.95} />);
    if (b.stats.baptized > 0 && lod >= 1) {
      const c = iso(x - 0.42, y + d + 0.2, 0); const r = U * (0.24 + Math.min(0.5, Math.sqrt(b.stats.baptized) * 0.13));
      out.push(<ellipse key="pool0" cx={c.x} cy={c.y} rx={r * 1.25} ry={r * 0.62} fill="#0b1830" />);
      out.push(<ellipse key="pool" cx={c.x} cy={c.y} rx={r} ry={r * 0.5} fill={WATER} opacity={0.92} className="ft-water" />);
      if (lod === 2) out.push(<text key="pooln" x={c.x} y={c.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0b1830">{b.stats.baptized}</text>);
    }
    if (lod === 2) {
      for (let i = 0; i < Math.min(6, b.stats.leaders); i++) { const p = iso(x + w + 0.3 + (i % 3) * 0.3, y + d - 0.1 - Math.floor(i / 3) * 0.3, 0); out.push(<Pawn key={`ld${i}`} x={p.x} y={p.y} tone={GLOW} s={0.7} />); }
      for (let g = 1; g < Math.min(5, b.stats.generation); g++) { const p = iso(x + 0.2 + g * 0.22, y + d, h + 0.05); out.push(<path key={`gen${g}`} d={`M ${p.x} ${p.y} v ${-U * 0.5} l ${U * 0.26} ${U * 0.1} l ${-U * 0.26} ${U * 0.1}`} fill={INK} stroke={INK} strokeWidth={1.4} />); }
    }
  }
  return <>{out}</>;
}

function Pawn({ x, y, tone, s = 1, lit = false }: { x: number; y: number; tone: string; s?: number; lit?: boolean }): JSX.Element {
  return (
    <g>
      <ellipse cx={x} cy={y + 2 * s} rx={8 * s} ry={3.6 * s} fill="#000" opacity={0.35} />
      {lit && <circle cx={x} cy={y - 10 * s} r={15 * s} fill={GLOW} opacity={0.22} className="ft-acting" />}
      <rect x={x - 5 * s} y={y - 15 * s} width={10 * s} height={14 * s} rx={5 * s} fill={tone} stroke="#0b1830" strokeWidth={1} />
      <circle cx={x} cy={y - 20 * s} r={5 * s} fill={shade(tone, 0.45)} stroke="#0b1830" strokeWidth={1} />
    </g>
  );
}

function Tree({ x, y, s }: { x: number; y: number; s: number }): JSX.Element {
  const b = iso(x, y); const h = 24 * s;
  return (
    <g>
      <ellipse cx={b.x + 2} cy={b.y + 2} rx={7 * s} ry={3.4 * s} fill="#000" opacity={0.25} />
      <line x1={b.x} y1={b.y} x2={b.x} y2={b.y - h * 0.4} stroke="#6b4a2b" strokeWidth={2 * s} />
      <polygon points={`${b.x - 8 * s},${b.y - h * 0.35} ${b.x + 8 * s},${b.y - h * 0.35} ${b.x},${b.y - h}`} fill="#2e8b6a" />
      <polygon points={`${b.x},${b.y - h * 0.35} ${b.x + 8 * s},${b.y - h * 0.35} ${b.x},${b.y - h}`} fill="#1f6149" />
    </g>
  );
}

const rect = (p: { x: number; y: number; w: number; d: number }, z = 0): string => `${pt(p.x, p.y, z)} ${pt(p.x + p.w, p.y, z)} ${pt(p.x + p.w, p.y + p.d, z)} ${pt(p.x, p.y + p.d, z)}`;

// ── the town's geometry: everything that does not change when the camera moves ───────────────────────────────────
interface GeometryProps { scene: FieldTownScene; lod: Lod; filter: TownFilter; selected: string | null; near: string; intro: boolean }
const Geometry = memo(function Geometry({ scene, lod, filter, selected, near, intro }: GeometryProps): JSX.Element {
  const nearSet = useMemo(() => new Set(near.split(',').filter(Boolean)), [near]);
  const filtering = !!(filter.people || filter.team);
  const dim = (x: { people?: string; team?: string | null; kind?: string }): boolean => filtering && !matchesFilter(x, filter);
  const b = scene.bounds;
  const grid: ReactNode[] = [];
  for (let gx = Math.ceil(b.x0 / 10) * 10; gx <= b.x1; gx += 10) grid.push(<line key={`gx${gx}`} x1={iso(gx, b.y0).x} y1={iso(gx, b.y0).y} x2={iso(gx, b.y1).x} y2={iso(gx, b.y1).y} />);
  for (let gy = Math.ceil(b.y0 / 10) * 10; gy <= b.y1; gy += 10) grid.push(<line key={`gy${gy}`} x1={iso(b.x0, gy).x} y1={iso(b.x0, gy).y} x2={iso(b.x1, gy).x} y2={iso(b.x1, gy).y} />);

  // The foothills along the west edge — Boulder and Fort Collins sit under them, and the plains run east from here.
  const peaks: ReactNode[] = [];
  for (let gy = b.y0 + 2; gy < b.y1 - 2; gy += 5) {
    const r = hash(`peak${gy}`); const px = b.x0 + 1.5 + r * 4; const hgt = 4 + r * 6; const half = 3.2 + r * 2;
    const a = iso(px - half, gy + half); const c = iso(px + half, gy - half); const m = iso(px, gy); const top = iso(px, gy, hgt);
    peaks.push(<g key={`pk${gy}`}><polygon points={`${a.x},${a.y} ${m.x},${m.y + half * U * 0.5} ${top.x},${top.y}`} fill="#22324d" /><polygon points={`${m.x},${m.y + half * U * 0.5} ${c.x},${c.y} ${top.x},${top.y}`} fill="#162238" />{hgt > 7 && <polygon points={`${top.x},${top.y} ${top.x - U * 0.9},${top.y + U * 1.5} ${top.x + U * 0.8},${top.y + U * 1.4}`} fill="#dfe8f5" opacity={0.75} />}</g>);
  }

  const plates = scene.plates;
  const roads = plates.filter((p) => p.kind === 'road');
  const towns = plates.filter((p) => p.kind === 'town');
  const quarters = plates.filter((p) => p.kind === 'quarter');
  const corridors = plates.filter((p) => p.kind === 'corridor');

  // Depth: what is further back (smaller x+y) is drawn first, so the nearer thing covers it.
  type Draw = { key: string; depth: number; town?: string; el: ReactNode };
  const draws: Draw[] = [];
  for (const bd of scene.buildings) {
    if (lod === 0 && bd.rank < 2) continue;
    if (bd.rank === 1 && lod < 2 && !nearSet.has(bd.town) && bd.kind !== 'home') continue;
    if (bd.rank === 1 && lod === 2 && !nearSet.has(bd.town)) continue;
    const isSel = selected === bd.id;
    const delay = intro ? Math.min(1400, Math.round(((bd.x + bd.y) - (b.x0 + b.y0)) * 4)) : 0;
    const style: CSSProperties = { opacity: dim(bd) ? 0.14 : 1, ...(delay ? { animationDelay: `${delay}ms` } : {}) };
    draws.push({
      key: bd.id, town: bd.town, depth: bd.x + bd.y + (bd.w + bd.d) / 2,
      el: (
        <g key={bd.id} data-id={bd.id} className={`ft-b ft-${bd.kind}${isSel ? ' is-sel' : ''}${bd.kind === 'household' ? '' : ' ft-rise'}`} style={style}>
          {isSel && <polygon points={rect({ x: bd.x - 0.18, y: bd.y - 0.18, w: bd.w + 0.36, d: bd.d + 0.36 })} fill="none" stroke={GLOW} strokeWidth={3} strokeDasharray="6 4" className="ft-selring" />}
          <Box b={bd} lod={lod} />
        </g>
      ),
    });
  }
  if (lod >= 1) {
    for (const p of scene.people) {
      const s = iso(p.x, p.y);
      draws.push({ key: `p:${p.role}`, depth: p.x + p.y + 0.2, el: <g key={`p:${p.role}`} data-person={p.role} className="ft-person" style={{ opacity: dim({ team: p.team ?? null, people: undefined }) && filter.team ? 0.14 : 1, transform: `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)` }}><Pawn x={0} y={0} tone={p.tone} s={lod === 2 ? 1 : 0.82} lit={!!p.acted} /></g> });
    }
  }
  if (lod === 2) {
    for (const s of scene.sites) {
      if (!nearSet.has(s.id)) continue;
      for (let i = 0; i < 9; i++) {
        const a = hash(`${s.id}t${i}`) * Math.PI * 2; const rr = s.r - 1.2 + hash(`${s.id}r${i}`) * 1.6;
        const tx = s.x + Math.cos(a) * rr; const ty = s.y + Math.sin(a) * rr;
        draws.push({ key: `tree:${s.id}:${i}`, depth: tx + ty, el: <Tree key={`tree:${s.id}:${i}`} x={tx} y={ty} s={0.8 + hash(`${s.id}s${i}`) * 0.5} /> });
      }
    }
  }
  draws.sort((p, q) => p.depth - q.depth);
  // FROM FAR AWAY A TOWN IS DRAWN LARGER THAN IT IS — as a map draws a city's dot bigger than the city. At the
  // region's distance every town's blocks are scaled up about its own centre, so the field reads as towns rather
  // than specks; coming closer, the scale eases back to true and the streets take over.
  const far = lod === 0 ? FAR_SCALE : 1;
  const townScale = (id: string | undefined): string | undefined => {
    if (far === 1 || !id) return undefined;
    const s = scene.sites.find((t) => t.id === id);
    if (!s) return undefined;
    const c = iso(s.x, s.y);
    return `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) scale(${far}) translate(${(-c.x).toFixed(1)} ${(-c.y).toFixed(1)})`;
  };

  return (
    <>
      <polygon points={rect({ x: b.x0, y: b.y0, w: b.x1 - b.x0, d: b.y1 - b.y0 })} fill="#111f38" stroke="#1f3658" strokeWidth={2} />
      <g stroke="#1b2e4d" strokeWidth={1.2} opacity={0.8}>{grid}</g>
      {peaks}
      {corridors.map((c) => (
        <polygon key={c.id} points={c.poly ? c.poly.map((p) => pt(p.x, p.y)).join(' ') : rect(c)} fill={c.tone} fillOpacity={0.07} stroke={c.tone} strokeOpacity={0.5} strokeWidth={2.4} strokeDasharray="14 10" strokeLinejoin="round" />
      ))}
      {scene.roads.map((r) => {
        const d = r.pts.map((p, i) => { const s = iso(p.x, p.y); return `${i ? 'L' : 'M'} ${s.x.toFixed(1)} ${s.y.toFixed(1)}`; }).join(' ');
        // Somebody is always driving: a pair of lights each way, so the field is never a still picture.
        const len = r.pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - r.pts[i - 1]!.x, p.y - r.pts[i - 1]!.y) : 0), 0);
        const dur = Math.max(14, len * 0.7);
        return (
          <g key={r.id}>
            <path d={d} fill="none" stroke="#2b3a52" strokeWidth={U * 0.9} strokeLinejoin="round" strokeLinecap="round" />
            <path d={d} fill="none" stroke="#8a98b3" strokeWidth={1.6} strokeDasharray="10 12" opacity={0.7} />
            {lod >= 1 && [0, 0.5].map((o, i) => (
              <circle key={i} r={lod === 2 ? 3.2 : 4.5} fill={i ? '#ffd27a' : '#ff8f8f'} opacity={0.9} className="ft-car">
                <animateMotion dur={`${dur.toFixed(1)}s`} begin={`${(-dur * (o + hash(r.id) * 0.4)).toFixed(1)}s`} repeatCount="indefinite" path={d} keyPoints={i ? '0;1' : '1;0'} keyTimes="0;1" calcMode="linear" />
              </circle>
            ))}
          </g>
        );
      })}
      {lod >= 1 && roads.map((p) => <polygon key={p.id} points={rect(p)} fill="#2b3a52" opacity={0.85} />)}
      {towns.map((p) => <polygon key={p.id} points={rect(p)} fill="#24344f" stroke="#3a4d6b" strokeWidth={1.5} transform={townScale(p.town)} />)}
      {quarters.map((p) => {
        const off = dim(p);
        // A people's quarter is the colour of the phase its records derive; a team's block is the team's colour.
        const fill = p.community ? phaseColor(p.phase ?? 0) : p.tone;
        const taken = p.community ? !!p.team : true;
        return <polygon key={p.id} data-plate={p.id} points={rect(p)} fill={fill} fillOpacity={off ? 0.04 : p.community ? (taken ? 0.42 : 0.16) : 0.18} stroke={p.tone} strokeOpacity={off ? 0.12 : 0.9} strokeWidth={2} strokeDasharray={taken ? undefined : '7 6'} className="ft-quarter" transform={townScale(p.town)} />;
      })}
      {far === 1
        ? draws.map((d) => d.el)
        : scene.sites.slice().sort((p, q) => (p.x + p.y) - (q.x + q.y)).map((t) => (
          <g key={`far:${t.id}`} transform={townScale(t.id)}>{draws.filter((d) => d.town === t.id).map((d) => d.el)}</g>
        ))}
      {scene.links.map((l) => {
        const a = iso(l.from.x, l.from.y, l.from.z); const c = iso(l.to.x, l.to.y, l.to.z);
        const mx = (a.x + c.x) / 2; const my = Math.min(a.y, c.y) - Math.max(60, Math.hypot(c.x - a.x, c.y - a.y) * 0.28);
        return <path key={l.id} d={`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`} fill="none" stroke={l.tone} strokeWidth={l.kind === 'daughter' ? 3 : 2.2} strokeDasharray={l.kind === 'daughter' ? '2 9' : '10 8'} strokeLinecap="round" opacity={dim(l) ? 0.1 : 0.9} className={l.kind === 'support' ? 'ft-support' : 'ft-daughter'} pathLength={l.kind === 'support' ? 1 : undefined} />;
      })}
      {scene.pulses.map((p) => { const s = iso(p.x, p.y); return <ellipse key={p.id} cx={s.x} cy={s.y} rx={U * 2.4} ry={U * 1.2} fill="none" stroke={p.tone} strokeWidth={4} className="ft-pulse" />; })}
    </>
  );
});

// ── the camera ──────────────────────────────────────────────────────────────────────────────────────────────────
/** As close as the camera goes: a tile about as wide as the estate's own town picture draws one. */
const MAX_K = 1.7;
export interface Camera { tx: number; ty: number; k: number }
export interface Extent { x0: number; y0: number; x1: number; y1: number; /** The ground points that matter inside it — framed instead of the rectangle's corners when given. */ pts?: Array<{ x: number; y: number }> }
/** The camera that frames a patch of ground in a viewport, with a margin. On an isometric ground a rectangle is a
 *  diamond, and framing its corners leaves two empty triangles; framing the POINTS that matter fills the window. */
export function fitCamera(e: Extent, w: number, h: number, pad = 0.9): Camera {
  const c = e.pts?.length ? e.pts.map((p) => iso(p.x, p.y)) : [iso(e.x0, e.y0), iso(e.x1, e.y0), iso(e.x1, e.y1), iso(e.x0, e.y1)];
  const minX = Math.min(...c.map((p) => p.x)); const maxX = Math.max(...c.map((p) => p.x));
  const minY = Math.min(...c.map((p) => p.y)) - 3 * U; const maxY = Math.max(...c.map((p) => p.y));
  const k = Math.max(0.05, Math.min(MAX_K, Math.min(w / (maxX - minX), h / (maxY - minY)) * pad));
  return { k, tx: w / 2 - ((minX + maxX) / 2) * k, ty: h / 2 - ((minY + maxY) / 2) * k };
}

export interface FieldTownHandle { flyTo: (e: Extent, pad?: number) => void; zoomBy: (f: number) => void }
export interface TownLabel { id: string; x: number; y: number; z: number; /** how high it sits when towns are drawn large */ farZ?: number; /** other places it may sit when the first is taken */ alts?: Array<{ x: number; y: number }>; text: string; tone: string; priority: number; minLod: Lod; kind: 'corridor' | 'town' | 'pill' | 'person'; dim?: boolean }

/** What gets a label at each distance, most important first. */
export function labelsOf(scene: FieldTownScene, filter: TownFilter): TownLabel[] {
  const out: TownLabel[] = [];
  const filtering = !!(filter.people || filter.team);
  const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
  for (const p of scene.plates) {
    if (p.kind !== 'corridor' || !p.label) continue;
    // Its name sits under the lowest point of its outline on screen (the largest x + y on the ground).
    const pts = p.poly ?? [{ x: p.x + p.w, y: p.y + p.d }];
    const low = pts.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
    const leftmost = pts.reduce((a, b) => (b.x - b.y < a.x - a.y ? b : a));
    const rightmost = pts.reduce((a, b) => (b.x - b.y > a.x - a.y ? b : a));
    out.push({ id: p.id, x: low.x, y: low.y, z: 0, alts: [rightmost, leftmost], text: clip(p.label.replace(/\s+corridor$/i, ''), 34).toUpperCase(), tone: p.tone, priority: 100, minLod: 0, kind: 'corridor' });
  }
  for (const s of scene.sites) out.push({ id: `site:${s.id}`, x: s.x, y: s.y, z: 3.6, farZ: 3.6 * FAR_SCALE + 1.2, text: s.name, tone: INK, priority: 60 + Math.min(30, s.population / 6000), minLod: s.population > 20000 || scene.buildings.some((b) => b.town === s.id && (b.kind === 'team' || b.kind === 'church' || b.kind === 'circle')) ? 0 : 1, kind: 'town' });
  for (const b of scene.buildings) {
    const dim = filtering && !matchesFilter(b, filter);
    const top = b.h + (b.roof === 'spire' ? 2.2 : b.roof === 'beacon' ? 3.6 - b.h : b.roof === 'flat' || b.roof === 'slab' ? 0.7 : 1.2);
    if (b.kind === 'team') out.push({ id: b.id, x: b.x + b.w / 2, y: b.y + b.d / 2, z: top + 0.9, text: clip(b.label, 26), tone: b.tone, priority: 50, minLod: 1, kind: 'pill', dim });
    else if (b.kind === 'church') out.push({ id: b.id, x: b.x + b.w / 2, y: b.y + b.d / 2, z: top, text: clip(b.label, 26), tone: b.tone, priority: 48, minLod: 1, kind: 'pill', dim });
    else if (b.kind === 'circle') out.push({ id: b.id, x: b.x + b.w / 2, y: b.y + b.d / 2, z: top, text: clip(b.label, 26), tone: b.tone, priority: 44, minLod: 1, kind: 'pill', dim });
    else if (b.kind === 'beacon') out.push({ id: b.id, x: b.x + b.w / 2, y: b.y + b.d / 2, z: 3.9, text: b.label, tone: phaseColor(b.phase ?? 0), priority: b.rank === 3 ? 46 : 30, minLod: 1, kind: 'pill', dim });
    else if (b.kind === 'partner') out.push({ id: b.id, x: b.x + b.w / 2, y: b.y + b.d / 2, z: top, text: clip(b.label, 28), tone: MUTED, priority: 28, minLod: 2, kind: 'pill', dim });
  }
  for (const p of scene.people) out.push({ id: `p:${p.role}`, x: p.x, y: p.y, z: 1.5, text: p.name.split(' ')[0] ?? p.name, tone: p.tone, priority: p.acted ? 26 : 12, minLod: 2, kind: 'person', dim: !!filter.team && p.team !== filter.team });
  return out.sort((a, b) => b.priority - a.priority);
}

export interface FieldTownProps {
  scene: FieldTownScene;
  filter: TownFilter;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** A person pressed in the street. */
  onPerson?: (p: TownPerson) => void;
  /** The whole town rises on first sight; a day's step only raises what that day made. */
  intro?: boolean;
  className?: string;
}

export const FieldTown = forwardRef<FieldTownHandle, FieldTownProps>(function FieldTown({ scene, filter, selected, onSelect, onPerson, intro = true, className }, ref) {
  const box = useRef<HTMLDivElement | null>(null);
  const world = useRef<SVGGElement | null>(null);
  const cam = useRef<Camera>({ tx: 0, ty: 0, k: 0.2 });
  const size = useRef({ w: 1200, h: 700 });
  const anim = useRef<number | null>(null);
  const framed = useRef(false);
  const [view, setView] = useState<Camera>({ tx: 0, ty: 0, k: 0.2 });
  const [lod, setLod] = useState<Lod>(0);
  const [near, setNear] = useState('');
  const [first, setFirst] = useState(true);
  const pending = useRef(false);

  // Which towns are in or near the frame — the only ones whose households and homes are drawn.
  const nearTowns = useCallback((c: Camera): string => {
    const { w, h } = size.current;
    const margin = 260;
    return scene.sites.filter((s) => { const p = iso(s.x, s.y); const sx = p.x * c.k + c.tx; const sy = p.y * c.k + c.ty; const r = s.r * U * 2 * c.k; return sx > -margin - r && sx < w + margin + r && sy > -margin - r && sy < h + margin + r; }).map((s) => s.id).sort().join(',');
  }, [scene.sites]);

  const apply = useCallback((c: Camera) => {
    cam.current = c;
    world.current?.setAttribute('transform', `translate(${c.tx.toFixed(2)} ${c.ty.toFixed(2)}) scale(${c.k.toFixed(4)})`);
    if (pending.current) return;
    pending.current = true;
    requestAnimationFrame(() => {
      pending.current = false;
      const now = cam.current;
      setView(now);
      setLod(lodOf(now.k));
      setNear(nearTowns(now));
    });
  }, [nearTowns]);

  const limits = useCallback((): { min: number; max: number } => {
    const fit = fitCamera(scene.focus, size.current.w, size.current.h, 0.9);
    return { min: fit.k * 0.7, max: MAX_K };
  }, [scene.focus]);

  const flyTo = useCallback((e: Extent, pad = 0.86) => {
    const to = fitCamera(e, size.current.w, size.current.h, pad);
    const lim = limits(); to.k = Math.max(lim.min, Math.min(lim.max, to.k));
    const c2 = fitCamera(e, size.current.w, size.current.h, pad);
    // Re-centre for the clamped zoom.
    const mid = { x: (size.current.w / 2 - c2.tx) / c2.k, y: (size.current.h / 2 - c2.ty) / c2.k };
    to.tx = size.current.w / 2 - mid.x * to.k; to.ty = size.current.h / 2 - mid.y * to.k;
    const from = { ...cam.current }; const t0 = performance.now(); const ms = 760;
    if (anim.current) cancelAnimationFrame(anim.current);
    const step = (t: number) => {
      const u = Math.min(1, (t - t0) / ms); const e2 = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      // Zoom is eased in log space so going in and coming out feel the same.
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e2);
      const fx = (size.current.w / 2 - from.tx) / from.k; const fy = (size.current.h / 2 - from.ty) / from.k;
      const cx = fx + (mid.x - fx) * e2; const cy = fy + (mid.y - fy) * e2;
      apply({ k, tx: size.current.w / 2 - cx * k, ty: size.current.h / 2 - cy * k });
      if (u < 1) anim.current = requestAnimationFrame(step); else anim.current = null;
    };
    anim.current = requestAnimationFrame(step);
  }, [apply, limits]);

  const zoomAt = useCallback((f: number, px: number, py: number) => {
    const c = cam.current; const lim = limits();
    const k = Math.max(lim.min, Math.min(lim.max, c.k * f));
    const wx = (px - c.tx) / c.k; const wy = (py - c.ty) / c.k;
    apply({ k, tx: px - wx * k, ty: py - wy * k });
  }, [apply, limits]);

  useImperativeHandle(ref, () => ({ flyTo, zoomBy: (f: number) => zoomAt(f, size.current.w / 2, size.current.h / 2) }), [flyTo, zoomAt]);

  // Size, and the first frame: the whole field.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      size.current = { w: r.width, h: r.height };
      if (!framed.current) { framed.current = true; apply(fitCamera(scene.focus, r.width, r.height, 0.9)); }
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [apply, scene.focus]);
  useEffect(() => { const t = setTimeout(() => setFirst(false), 2600); return () => clearTimeout(t); }, []);
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); }, []);

  // Pointer: one finger pans, two pinch; a press that did not travel is a click on whatever is under it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: number; pinch: number | null } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    drag.current = { x: pts[0]!.x, y: pts[0]!.y, moved: drag.current?.moved ?? 0, pinch: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : null };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    const p = local(e); const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && drag.current.pinch) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      zoomAt(dist / drag.current.pinch, (pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2);
      drag.current.pinch = dist; drag.current.moved += 10;
      return;
    }
    const dx = p.x - prev.x; const dy = p.y - prev.y;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.current.moved > 4) apply({ ...cam.current, tx: cam.current.tx + dx, ty: cam.current.ty + dy });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const was = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) { const pts = [...pointers.current.values()]; drag.current = { x: pts[0]!.x, y: pts[0]!.y, moved: was?.moved ?? 0, pinch: null }; return; }
    drag.current = null;
    if (!was || was.moved > 5) return;
    // A click. The element under the pointer says what it is — a figure, a building, or the ground.
    const hit = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
    const person = hit?.closest('[data-person]')?.getAttribute('data-person');
    if (person) { const p = scene.people.find((x) => x.role === person); if (p) onPerson?.(p); return; }
    const id = hit?.closest('[data-id]')?.getAttribute('data-id') ?? null;
    onSelect(id && id !== selected ? id : null);
  };
  const onWheel = useCallback((e: WheelEvent) => { e.preventDefault(); const r = box.current!.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, [zoomAt]);
  useEffect(() => { const el = box.current; if (!el) return; el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); }, [onWheel]);
  const onDoubleClick = (e: React.MouseEvent) => { const p = local(e); zoomAt(1.9, p.x, p.y); };

  // The labels, in screen space: placed most-important first, and one that would sit on another is left out.
  const all = useMemo(() => labelsOf(scene, filter), [scene, filter]);
  const labels = useMemo(() => {
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const out: Array<TownLabel & { sx: number; sy: number; w: number }> = [];
    const { w, h } = size.current;
    for (const l of all) {
      if (l.minLod > lod) continue;
      const lw = l.kind === 'corridor' ? l.text.length * 8.7 : l.text.length * 6.3 + 18;
      // Try where it wants to be, then anywhere else it may sit; a label with no free place is left out.
      for (const at of [{ x: l.x, y: l.y }, ...(l.alts ?? [])]) {
        const p = iso(at.x, at.y, lod === 0 && l.farZ ? l.farZ : l.z); const sx = p.x * view.k + view.tx; const sy = p.y * view.k + view.ty;
        if (sx < -80 || sx > w + 80 || sy < -30 || sy > h + 30) continue;
        const r = { x0: sx - lw / 2 - 3, y0: sy - 12, x1: sx + lw / 2 + 3, y1: sy + 12 };
        if (l.kind === 'corridor') { r.y0 = sy + 8; r.y1 = sy + 26; }
        if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
        placed.push(r);
        out.push({ ...l, sx, sy, w: lw });
        break;
      }
      if (out.length > 90) break;
    }
    return out;
  }, [all, lod, view]);

  return (
    <div ref={box} className={`ft-stage${className ? ` ${className}` : ''}`} data-lod={lod} data-testid="field-town">
      <svg className="ft-svg" role="img" aria-label="The field as a town: every town north of Denver, with the teams, people, circles, churches and people communities the season has made"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
        <g ref={world} className={first && intro ? 'ft-world ft-intro' : 'ft-world'}>
          <Geometry scene={scene} lod={lod} filter={filter} selected={selected} near={near} intro={first && intro} />
        </g>
        <g className="ft-labels" pointerEvents="none">
          {labels.map((l) => l.kind === 'corridor'
            ? <text key={l.id} x={l.sx} y={l.sy + 20} textAnchor="middle" className="ft-corridor" fill={l.tone}>{l.text}</text>
            : (
              <g key={l.id} opacity={l.dim ? 0.2 : 1} className={`ft-label ft-label-${l.kind}`}>
                <line x1={l.sx} y1={l.sy + 10} x2={l.sx} y2={l.sy + 20} stroke={MUTED} strokeWidth={1} />
                <rect x={l.sx - l.w / 2} y={l.sy - 10} width={l.w} height={20} rx={10} fill="#0b1830" stroke={l.tone} strokeWidth={l.kind === 'town' ? 1 : 1.3} strokeOpacity={l.kind === 'town' ? 0.45 : 1} />
                <text x={l.sx} y={l.sy + 4} textAnchor="middle" fontSize={l.kind === 'town' ? 11.5 : 11} fontWeight={l.kind === 'town' ? 700 : 650} fill={INK}>{l.text}</text>
              </g>
            ))}
        </g>
      </svg>
    </div>
  );
});

/** The side of a block, for anybody laying a legend out beside the scene. */
export const TOWN_BLOCK = BLOCK;
export type { TownPlate };
