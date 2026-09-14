import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { MissionListing } from '../lib/api';

/** Leaflet touches `window` on import, so it is loaded when a map is first drawn — never at module time,
 *  which is also what keeps 40 KB of map code out of every page that has no map. */
let leafletPromise: Promise<typeof Leaflet> | null = null;
function loadLeaflet(): Promise<typeof Leaflet> {
  if (!leafletPromise) leafletPromise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([m]) => (m.default ?? m) as typeof Leaflet);
  return leafletPromise;
}

/**
 * THE MAP OF MISSIONS — Leaflet over OpenStreetMap tiles, one brass mark per registered mission at the point
 * the registry may show (the ceiling has already been applied to `point`; a `hidden` mission has none and is
 * listed beside the map instead). Circle markers, not image pins: nothing to load, and a coarse point drawn
 * larger and paler says "somewhere near here" without a legend.
 *
 * Not the event metaphor: there is no date on a mark and no "next gathering" — a mark is a standing presence.
 */
export function MissionMap({ missions, selected, onSelect, height = 420 }: { missions: readonly MissionListing[]; selected?: string | null; onSelect?: (entryId: string) => void; height?: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const [L, setL] = useState<typeof Leaflet | null>(null);

  useEffect(() => {
    let alive = true;
    loadLeaflet().then((lib) => { if (alive) setL(lib); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!L || !host.current || map.current) return;
    const m = L.map(host.current, { worldCopyJump: true, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    m.setView([20, 0], 2);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; layer.current = null; };
  }, [L]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!L || !m || !g) return;
    g.clearLayers();
    const shown = missions.filter((x) => x.point && x.status === 'active');
    for (const x of shown) {
      const coarse = x.grain !== 'exact';
      const mark = L.circleMarker([x.point!.lat, x.point!.lng], {
        radius: coarse ? 11 : 8,
        color: '#8a6a24',
        weight: 1.5,
        fillColor: '#d9b26a',
        fillOpacity: coarse ? 0.45 : 0.9,
      });
      mark.bindTooltip(`${x.name}${coarse ? ' · near here' : ''}`, { direction: 'top', offset: [0, -8] });
      if (onSelect) mark.on('click', () => onSelect(x.entryId));
      mark.addTo(g);
    }
    if (shown.length === 1) m.setView([shown[0]!.point!.lat, shown[0]!.point!.lng], shown[0]!.grain === 'exact' ? 11 : 7);
    else if (shown.length > 1) m.fitBounds(L.latLngBounds(shown.map((x) => [x.point!.lat, x.point!.lng] as [number, number])), { padding: [30, 30], maxZoom: 10 });
  }, [L, missions, onSelect]);

  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    const x = missions.find((y) => y.entryId === selected);
    if (x?.point) m.flyTo([x.point.lat, x.point.lng], Math.max(m.getZoom(), x.grain === 'exact' ? 11 : 7), { duration: 0.6 });
  }, [selected, missions]);

  return <div ref={host} className="mission-map" style={{ height }} role="region" aria-label="Map of registered missions" />;
}
