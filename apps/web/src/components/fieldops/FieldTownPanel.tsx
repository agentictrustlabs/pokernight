/**
 * THE TOWN, WITH ITS CONTROLS — what a person does with the scene (docs/FIELD-OPERATIONS.md §7).
 *
 * `FieldTown` is the picture; this is the frame around it:
 *   · WHERE — "The whole field", a chip for each corridor, and any town's name: each flies the camera there.
 *   · WHO — one filter, by people group or by team. Everything else dims, and the camera frames what is left, so
 *     "where are the Somalis" and "what has the Plains team built" are each one press.
 *   · WHEN — the season as a line of days. Drag it back to the registry's floor and press play: the teams' offices
 *     go up, people move in, quarters take their colour, circles form, a church gets its tower. A day says what it
 *     did in a sentence under the line.
 *   · WHAT — press a building for what it is: the counts it had THAT day, who formed it, the phase and what the
 *     colour means.
 *
 * It reads a `FieldOpsView` and nothing else, and sends nothing: looking at the town is not an act, so a page can
 * show it for a season nobody is attending without waking it.
 *
 * NO HOOK AFTER AN EARLY RETURN — every hook is above the first `return`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldOpsView } from '@pokernight/fieldops';
import { PHASE_NAMES } from '@pokernight/fieldops';
import { buildFieldTown, extentOf, lastDay, layoutField, phaseColor, type TownBuilding, type TownFilter, type TownPerson } from '../../lib/fieldTown';
import { FieldTown, type FieldTownHandle } from './FieldTown';

const KIND_WORDS: Record<TownBuilding['kind'], string> = {
  civic: 'A building in town', hall: 'The town', partner: 'A partner church', team: 'A team', home: 'Somebody on a team',
  household: 'A household', circle: 'A circle', church: 'A church', beacon: 'A people community',
};

export function FieldTownPanel({ view, tall = false, onOpenFull }: { view: FieldOpsView; tall?: boolean; onOpenFull?: () => void }) {
  const end = useMemo(() => lastDay(view), [view]);
  // The layout is decided from the whole season; it changes only when the season grows a thing to place.
  const layoutKey = `${view.towns.length}|${view.teams.map((t) => t.id).join(',')}|${view.bodies.map((b) => b.id).join(',')}|${view.communities.map((c) => c.id).join(',')}`;
  const layout = useMemo(() => layoutField(view), [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [day, setDay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState<TownFilter>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [person, setPerson] = useState<TownPerson | null>(null);
  const [place, setPlace] = useState<string>('all');
  const [legend, setLegend] = useState(false);
  /** While the season plays, the camera goes to wherever the day built something. */
  const [follow, setFollow] = useState(true);
  const stage = useRef<FieldTownHandle | null>(null);
  // Following the season: with no day chosen the town is drawn as of now, and moves on as the season does.
  const at = day === null ? end : Math.min(day, end);
  const scene = useMemo(() => buildFieldTown(view, at, layout), [view, at, layout]);

  // PLAY: a day every 1.4 seconds — long enough to see what rose and read the sentence under the line.
  useEffect(() => {
    if (!playing) return;
    if (at >= end) { setPlaying(false); return; }
    const t = setTimeout(() => setDay(at + 1), 1400);
    return () => clearTimeout(t);
  }, [playing, at, end]);

  const fly = (pick: Parameters<typeof extentOf>[1], pad?: number) => { const e = extentOf(scene, pick); if (e) stage.current?.flyTo(e, pad); };
  // FOLLOW THE WORK. On a played day that did something that matters — a team's office, a circle, a church, a
  // baptism, a leader trained — the camera flies to the town it happened in, so a person watching the season sees
  // each thing where it went up and the caption underneath is about what is on screen; a day that only shared and
  // studied leaves the camera where it is.
  const followed = useRef(-1);
  useEffect(() => {
    if (!playing || !follow || followed.current === at) return;
    followed.current = at;
    if (at === 0) { const e = extentOf(scene, {}); if (e) stage.current?.flyTo(e); setPlace('all'); return; }
    if (!scene.spotlight) return;
    const e = extentOf(scene, { town: scene.spotlight });
    if (e) { stage.current?.flyTo(e, 0.7); setPlace(''); }
  }, [playing, follow, at, scene]);
  const choosePlace = (id: string) => { setPlace(id); fly(id === 'all' ? {} : { corridor: id }); };
  const chooseFilter = (next: TownFilter) => {
    const same = (next.people ?? null) === (filter.people ?? null) && (next.team ?? null) === (filter.team ?? null);
    const f = same ? {} : next;
    setFilter(f); setPlace('');
    fly(f.people || f.team ? { filter: f } : {}, 0.8);
  };
  const replay = () => { setSelected(null); setDay(0); setPlaying(true); };

  const sel = selected ? scene.buildings.find((b) => b.id === selected) ?? null : null;
  const week = Math.max(1, Math.ceil(at / Math.max(1, view.daysPerWeek)));
  const t = scene.tally;

  return (
    <section className={`ft-panel${tall ? ' is-tall' : ''}`} data-testid="field-town-panel">
      <header className="ft-head">
        <div className="ft-title">
          <span className="ft-kicker">A season in the field</span>
          <h3>One field. {t.teams === 1 ? 'One team' : `${t.teams} teams`}. {t.communities} peoples.</h3>
          <p>Every building is something the season made, where it made it. A quarter is a people; its colour is how far they have come.</p>
        </div>
        <dl className="ft-tally" aria-label="The field on this day">
          <div><dt>circles</dt><dd data-testid="ft-tally-circles">{t.circles}</dd></div>
          <div><dt>churches</dt><dd data-testid="ft-tally-churches">{t.churches}</dd></div>
          <div><dt>baptised</dt><dd>{t.baptized}</dd></div>
          <div><dt>leaders</dt><dd>{t.leaders}</dd></div>
          <div><dt>believing</dt><dd>{t.believers}</dd></div>
          <div><dt>phases moved</dt><dd data-testid="ft-tally-phases">{t.phasesMoved}</dd></div>
        </dl>
      </header>

      <div className="ft-bar" role="toolbar" aria-label="Where to look and who to show">
        <div className="ft-chips" data-testid="ft-places">
          <span className="ft-chips-label">Go to</span>
          <button type="button" className={`ft-chip${place === 'all' ? ' is-on' : ''}`} onClick={() => choosePlace('all')}>The whole field</button>
          {scene.corridors.map((c) => (
            <button key={c.id} type="button" className={`ft-chip${place === c.id ? ' is-on' : ''}`} style={{ borderColor: c.tone }} onClick={() => choosePlace(c.id)} data-testid={`ft-place-${c.id}`}>{c.name}</button>
          ))}
        </div>
        <div className="ft-chips" data-testid="ft-filter-teams">
          <span className="ft-chips-label">Team</span>
          {scene.teams.length === 0 && <span className="ft-none">none founded yet</span>}
          {scene.teams.map((x) => (
            <button key={x.id} type="button" className={`ft-chip${filter.team === x.id ? ' is-on' : ''}`} onClick={() => chooseFilter({ team: x.id })} data-testid={`ft-team-${x.id}`}>
              <i style={{ background: x.tone }} />{x.name.replace(/ Team$/, '')}
            </button>
          ))}
        </div>
        <div className="ft-chips" data-testid="ft-filter-peoples">
          <span className="ft-chips-label">People</span>
          {scene.peoples.map((p) => (
            <button key={p.name} type="button" className={`ft-chip${filter.people === p.name ? ' is-on' : ''}`} onClick={() => chooseFilter({ people: p.name })} data-testid={`ft-people-${p.name}`}>
              <i style={{ background: p.tone }} />{p.name}
            </button>
          ))}
          {(filter.people || filter.team) && <button type="button" className="ft-chip ft-clear" onClick={() => chooseFilter(filter)}>Show everything</button>}
        </div>
      </div>

      <div className="ft-frame">
        <FieldTown ref={stage} scene={scene} filter={filter} selected={selected} onSelect={(id) => { setSelected(id); setPerson(null); }} onPerson={(p) => { setPerson(p); setSelected(null); }} />
        <div className="ft-zoom" aria-label="Zoom">
          <button type="button" onClick={() => stage.current?.zoomBy(1.5)} aria-label="Zoom in" title="Zoom in">+</button>
          <button type="button" onClick={() => stage.current?.zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" onClick={() => choosePlace('all')} aria-label="See the whole field" title="The whole field">⤢</button>
          {onOpenFull && <button type="button" onClick={onOpenFull} aria-label="Open the town on its own page" title="Open on its own page">↗</button>}
        </div>
        <p className="ft-hint">Drag to move · scroll or pinch to zoom · double-click to go in · press a building</p>

        <div className="ft-legend" aria-label="What the colours and shapes mean">
          <div className="ft-phases">
            <span>phase</span>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((p) => <i key={p} style={{ background: phaseColor(p) }} title={`P${p} — ${PHASE_NAMES[p as 0] ?? ''}`}>{p}</i>)}
          </div>
          <button type="button" className="ft-legend-toggle" onClick={() => setLegend((v) => !v)} aria-expanded={legend}>{legend ? 'Hide the key' : 'What am I looking at?'}</button>
          {legend && <ul>
            <li><b className="ft-k ft-k-quarter" /> a people's quarter (dashed until a team takes them up)</li>
            <li><b className="ft-k ft-k-beacon" /> its beacon: a storey a phase</li>
            <li><b className="ft-k ft-k-house" /> a household: lit when seeking, coloured when believing</li>
            <li><b className="ft-k ft-k-circle" /> a circle · <b className="ft-k ft-k-church" /> a church · <b className="ft-k ft-k-water" /> baptisms</li>
            <li><b className="ft-k ft-k-team" /> a team's office and its people's homes</li>
          </ul>}
        </div>

        {(sel || person) && (
          <aside className="ft-inspect" data-testid="ft-inspect">
            <button type="button" className="ft-x" onClick={() => { setSelected(null); setPerson(null); }} aria-label="Close">×</button>
            {sel && (
              <>
                <span className="ft-kicker">{KIND_WORDS[sel.kind]}{sel.born > 0 ? ` · since day ${sel.born}` : ' · here before the season'}</span>
                <h4>{sel.label}</h4>
                {sel.sub && <p>{sel.sub}</p>}
                {sel.phase !== undefined && <p className="ft-phase"><i style={{ background: phaseColor(sel.phase) }} />P{sel.phase} — {PHASE_NAMES[sel.phase] ?? ''}</p>}
                {sel.stats && (
                  <dl className="ft-stats">
                    <div><dt>gathering</dt><dd>{sel.stats.participants}</dd></div>
                    <div><dt>believing</dt><dd>{sel.stats.believers}</dd></div>
                    <div><dt>baptised</dt><dd>{sel.stats.baptized}</dd></div>
                    <div><dt>leaders</dt><dd>{sel.stats.leaders}</dd></div>
                    <div><dt>generation</dt><dd>{sel.stats.generation}</dd></div>
                    <div><dt>state</dt><dd>{sel.stats.lifecycle}</dd></div>
                  </dl>
                )}
                <div className="ft-inspect-acts">
                  <button type="button" className="ft-chip" onClick={() => fly({ town: sel.town }, 0.9)}>Zoom to {scene.sites.find((s) => s.id === sel.town)?.name ?? 'the town'}</button>
                  {sel.people && <button type="button" className="ft-chip" onClick={() => chooseFilter({ people: sel.people })}>Only the {sel.people}</button>}
                  {sel.team && <button type="button" className="ft-chip" onClick={() => chooseFilter({ team: sel.team })}>Only this team</button>}
                </div>
              </>
            )}
            {person && (
              <>
                <span className="ft-kicker">{person.kind}{person.team ? ` · ${scene.teams.find((x) => x.id === person.team)?.name ?? ''}` : ''}</span>
                <h4>{person.name}</h4>
                <p>In {scene.sites.find((s) => s.id === person.town)?.name ?? person.town} on day {at}{person.acted ? ` — ${person.acted} today.` : '.'}</p>
                <div className="ft-inspect-acts"><button type="button" className="ft-chip" onClick={() => fly({ town: person.town }, 0.9)}>Zoom to them</button></div>
              </>
            )}
          </aside>
        )}
      </div>

      <footer className="ft-time">
        <button type="button" className="ft-play" onClick={() => (playing ? setPlaying(false) : at >= end ? replay() : setPlaying(true))} data-testid="ft-play">{playing ? 'Pause' : at >= end ? 'Replay the season' : 'Play'}</button>
        <label className="ft-scrub">
          <span data-testid="ft-day">{at === 0 ? 'Before the season' : `Day ${at}`}<em>{at > 0 ? ` · week ${week}` : ' · the registry’s floor'}</em></span>
          <input type="range" min={0} max={end} step={1} value={at} onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)); }} aria-label="The day of the season" data-testid="ft-scrub" />
        </label>
        <span className="ft-time-opts">
          <label className="ft-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow the work</label>
          {day !== null && at < end && <button type="button" className="ft-chip" onClick={() => { setPlaying(false); setDay(null); }}>Now</button>}
        </span>
        <p className="ft-happened" data-testid="ft-happened" aria-live="polite">{scene.happened.length ? scene.happened.slice(0, 3).join(' ') : at === 0 ? 'What was already there: the towns, the partner churches, and each people as the registry last read them.' : 'A day of work — sharing, studying, coaching — with nothing new standing yet.'}</p>
      </footer>
    </section>
  );
}
