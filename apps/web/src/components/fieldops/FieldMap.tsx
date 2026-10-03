/**
 * THE FIELD, DRAWN — northern Colorado as a map, with the work on it (docs/FIELD-OPERATIONS.md §7).
 *
 * A field is outdoors, so its picture is a MAP rather than a room: the four corridors as regions, the towns at their
 * real coordinates, I-25 and the two highways as the lines everybody drives, the partner churches as crosses at
 * their addresses, every worker as a marker that slides to the town it is in, every circle as a ring and every
 * church as a cross-in-a-ring beside the town, stacked by generation. An act lights its town for a moment, so a
 * person watching sees the work happen where it happens. Plain SVG: no engine, nothing lazy, sharp at any size.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldOpsEvent, FieldOpsView, TownDef } from '@pokernight/fieldops';

const W = 760; const H = 520;
/** The window the four corridors fit in, with a margin for labels. */
const LAT = { min: 39.86, max: 40.78 }; const LNG = { min: -105.42, max: -102.58 };
export function project(lat: number, lng: number): { x: number; y: number } {
  return { x: 36 + ((lng - LNG.min) / (LNG.max - LNG.min)) * (W - 72), y: 24 + ((LAT.max - lat) / (LAT.max - LAT.min)) * (H - 60) };
}
const CORRIDOR_COLOR: Record<string, string> = { weld: '#c9a14a', larimer: '#8fd0a2', boulder: '#9ab7e0', plains: '#e0a07a' };
const ROADS: Array<{ name: string; pts: Array<[number, number]> }> = [
  { name: 'I-25', pts: [[39.86, -104.99], [39.92, -104.99], [40.08, -104.98], [40.33, -104.98], [40.40, -105.0], [40.59, -105.03], [40.70, -105.0], [40.78, -105.0]] },
  { name: 'US-34', pts: [[40.40, -105.25], [40.40, -105.07], [40.42, -104.71], [40.26, -104.0], [40.25, -103.80], [40.26, -103.62]] },
  { name: 'US-85', pts: [[39.86, -104.86], [40.08, -104.81], [40.38, -104.69], [40.42, -104.71], [40.53, -104.71], [40.78, -104.72]] },
  { name: 'I-76', pts: [[39.86, -104.75], [40.08, -104.60], [40.25, -103.80], [40.26, -103.62], [40.63, -103.21], [40.78, -103.0]] },
  { name: 'US-36', pts: [[39.90, -105.09], [39.99, -105.09], [40.02, -105.27]] },
  { name: 'CO-119', pts: [[40.02, -105.27], [40.17, -105.10], [40.19, -104.99]] },
];

export interface MapPulse { town: string; at: number; kind: string }

export function FieldMap({ view, selected, onTown, onPerson, pulses }: { view: FieldOpsView; selected: string | null; onTown: (town: string) => void; onPerson: (role: string) => void; pulses: MapPulse[] }) {
  const towns = useMemo(() => Object.fromEntries(view.towns.map((t) => [t.id, t])), [view.towns]);
  const [, tickN] = useState(0);
  const raf = useRef<number | null>(null);
  // Pulses fade over two seconds; the map re-renders while any is live, then goes quiet.
  useEffect(() => {
    const live = pulses.some((p) => Date.now() - p.at < 2200);
    if (!live) return;
    const loop = () => { tickN((n) => n + 1); if (pulses.some((p) => Date.now() - p.at < 2200)) raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [pulses]);
  const now = Date.now();
  // People standing in the same town are fanned out around it so nobody hides anybody.
  const byTown = new Map<string, typeof view.cast>();
  for (const p of view.cast) (byTown.get(p.town) ?? byTown.set(p.town, []).get(p.town)!).push(p);
  const bodiesByTown = new Map<string, typeof view.bodies>();
  for (const b of view.bodies) if (b.lifecycle !== 'RecognizedAsChurch') (bodiesByTown.get(b.town) ?? bodiesByTown.set(b.town, []).get(b.town)!).push(b);
  const corridorOf = (t: TownDef) => t.corridor;
  return (
    <svg className="fo-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Northern Colorado: four corridors, the towns, the teams and the circles and churches the season has founded">
      <defs>
        <radialGradient id="fo-pulse" r="0.5"><stop offset="0" stopColor="#ffd98a" stopOpacity="0.85" /><stop offset="1" stopColor="#ffd98a" stopOpacity="0" /></radialGradient>
        <filter id="fo-glow"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#0f1a16" />
      {/* the corridors: a soft hull around each one's towns */}
      {view.corridors.map((c) => {
        const pts = c.towns.map((id) => towns[id]).filter((t): t is TownDef => !!t).map((t) => project(t.lat, t.lng));
        if (!pts.length) return null;
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length; const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        const r = Math.max(46, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy) + 34));
        return (
          <g key={c.id}>
            <ellipse cx={cx} cy={cy} rx={r * 1.15} ry={r * 0.9} fill={CORRIDOR_COLOR[c.id] ?? '#888'} fillOpacity="0.07" stroke={CORRIDOR_COLOR[c.id] ?? '#888'} strokeOpacity="0.35" strokeDasharray="4 4" />
            <text x={cx} y={cy - r * 0.9 - 6} textAnchor="middle" className="fo-map-corridor" fill={CORRIDOR_COLOR[c.id] ?? '#888'}>{c.name}</text>
          </g>
        );
      })}
      {/* the roads */}
      {ROADS.map((r) => (
        <g key={r.name}>
          <polyline points={r.pts.map(([la, ln]) => { const p = project(la, ln); return `${p.x},${p.y}`; }).join(' ')} fill="none" stroke="#3a4a44" strokeWidth={r.name.startsWith('I-') ? 2.4 : 1.4} strokeLinejoin="round" />
          {(() => { const [la, ln] = r.pts[Math.floor(r.pts.length / 2)]!; const p = project(la, ln); return <text x={p.x + 4} y={p.y - 4} className="fo-map-road">{r.name}</text>; })()}
        </g>
      ))}
      {/* the pulses — an act lights its town */}
      {pulses.filter((p) => now - p.at < 2200).map((p, i) => {
        const t = towns[p.town]; if (!t) return null;
        const { x, y } = project(t.lat, t.lng);
        const age = (now - p.at) / 2200;
        return <circle key={`${p.at}-${i}`} cx={x} cy={y} r={10 + age * 34} fill="url(#fo-pulse)" opacity={1 - age} />;
      })}
      {/* the partner churches */}
      {view.partners.map((p) => {
        const { x, y } = project(p.lat, p.lng);
        return (
          <g key={p.id} className="fo-map-partner" transform={`translate(${x + 10},${y - 12})`}>
            <title>{p.name} — {p.used}/{p.capacity} support given (a game agent stands for it)</title>
            <path d="M0,-7 V7 M-5,-2 H5" stroke="#f0d78c" strokeWidth="2" />
          </g>
        );
      })}
      {/* the towns, with their bodies beside them */}
      {view.towns.map((t) => {
        const { x, y } = project(t.lat, t.lng);
        const color = CORRIDOR_COLOR[corridorOf(t)] ?? '#aaa';
        const here = bodiesByTown.get(t.id) ?? [];
        const isSel = selected === t.id;
        return (
          <g key={t.id} className={`fo-map-town${isSel ? ' selected' : ''}`} onClick={() => onTown(t.id)} style={{ cursor: 'pointer' }}>
            <title>{t.name} — pop. {t.population.toLocaleString()}, {t.churches} congregations{here.length ? `; ${here.length} ${here.length === 1 ? 'body' : 'bodies'} the season founded` : ''}</title>
            <circle cx={x} cy={y} r={isSel ? 7 : 4.5} fill={color} stroke="#0f1a16" strokeWidth="1.5" />
            {isSel ? <circle cx={x} cy={y} r={12} fill="none" stroke={color} strokeOpacity="0.6" /> : null}
            <text x={x} y={y + 16} textAnchor="middle" className="fo-map-label">{t.name}</text>
            {here.map((b, i) => {
              const bx = x - 14 - i * 11; const by = y - 10;
              const church = b.kind === 'church';
              return (
                <g key={b.id} transform={`translate(${bx},${by})`} className={`fo-map-body ${b.kind} ${b.lifecycle.toLowerCase()}`}>
                  <title>{b.name} — {b.kind}, generation {b.generation}, {b.believers} believers, {b.baptized} baptised{b.lifecycle === 'Stalled' ? ' (stalled)' : ''}</title>
                  <circle r={4 + Math.min(3, b.generation)} fill={church ? '#ffd98a' : 'none'} fillOpacity={church ? 0.35 : 0} stroke={b.lifecycle === 'Stalled' ? '#e5b3b3' : '#ffd98a'} strokeWidth="1.4" />
                  {church ? <path d="M0,-3 V3 M-2.2,-0.8 H2.2" stroke="#ffd98a" strokeWidth="1.3" /> : null}
                </g>
              );
            })}
          </g>
        );
      })}
      {/* the people — one marker each, fanned around the town they are in; the position eases on change */}
      {[...byTown.entries()].flatMap(([townId, people]) => {
        const t = towns[townId]; if (!t) return [];
        const { x, y } = project(t.lat, t.lng);
        return people.map((p, i) => {
          const a = (i / Math.max(1, people.length)) * Math.PI * 2 - Math.PI / 2;
          const r = people.length > 1 ? 13 : 0;
          const px = x + Math.cos(a) * r; const py = y - 2 + Math.sin(a) * r;
          const agent = p.mind === 'agent';
          return (
            <g key={p.role} className={`fo-map-person ${p.kind}${p.actedToday ? ' acted' : ''}`} style={{ transform: `translate(${px}px,${py}px)`, transition: 'transform 900ms ease-in-out', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onPerson(p.role); }}>
              <title>{p.name} — {p.kind}{p.team ? `, ${view.teams.find((x) => x.id === p.team)?.name ?? p.team}` : ''}; in {p.townName}; {p.actedToday ? p.today ?? 'has acted today' : 'has not acted today'}; {p.mind === 'human' ? `played by ${p.playedBy ?? 'a person'}` : agent ? `agent ${p.agent}` : 'played by the house'}</title>
              <circle r="6.5" fill={p.look.wear} stroke={p.actedToday ? '#ffd98a' : p.mind === 'human' ? '#fff' : agent ? '#8fd0a2' : '#9aa3ab'} strokeWidth={p.mind === 'human' ? 2 : 1.3} filter={p.actedToday ? 'url(#fo-glow)' : undefined} />
              <circle r="3" cy="-1.5" fill={p.look.skin} />
            </g>
          );
        });
      })}
    </svg>
  );
}

/** Which town an event lit, for the map's pulses. */
export function pulseOf(e: FieldOpsEvent): MapPulse | null {
  if (e.type === 'acted' && e.action !== 'rest' && e.action !== 'support' && e.action !== 'coach') return { town: e.town, at: e.at, kind: e.action };
  if (e.type === 'founded' || e.type === 'recognized') return { town: e.town, at: e.at, kind: e.type };
  return null;
}
