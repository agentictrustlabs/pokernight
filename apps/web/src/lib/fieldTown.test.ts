// THE FIELD AS A TOWN — the scene a season builds, checked against a season the engine plays by its own house
// policy (no agent, no network): what exists on each day, that nothing standing ever moves, and that the last day
// is exactly what the view holds.
import { describe, it, expect } from 'vitest';
import { NORTH_OF_DENVER as S, NORTHERN_COLORADO as R, apply, chooseAction, openStaging, tick, viewFor, type Casting, type FieldOpsState, type FieldOpsView } from '@pokernight/fieldops';
import { BLOCK, buildFieldTown, extentOf, geo, hull, lastDay, layoutField, matchesFilter, phaseColor, seasonAt } from './fieldTown';

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
function play(days: number): FieldOpsView {
  const cast: Casting[] = S.roles.map((r) => ({ role: r.id, agent: `${r.id}.me`, name: r.name, custodian: 'house', operator: 'agent', mind: 'rules' }));
  let s: FieldOpsState = openStaging({ scenario: S, region: R, cast, seedHex: SEED, seedCommit: 'c', now: Date.UTC(2026, 8, 1), pace: 1 });
  let now = s.startedAt; let n = 0;
  for (let guard = 0; guard < 4000 && s.phase !== 'revealed' && s.day <= days; guard++) {
    if (s.phase === 'day') {
      for (const c of s.cast) {
        const lines = S.roles.find((r) => r.id === c.role)!.lines;
        const move = chooseAction(viewFor(s, S, R, c.role), lines, n++);
        if (!move) continue;
        const r = apply(s, S, R, c.role, move.action, now, 'agent');
        if (r.ok) s = r.state;
        if (['move', 'adopt', 'join', 'invite', 'decline'].includes(move.action.type)) {
          const m2 = chooseAction(viewFor(s, S, R, c.role), lines, n++);
          if (m2 && m2.action.type !== 'move') { const r2 = apply(s, S, R, c.role, m2.action, now, 'agent'); if (r2.ok) s = r2.state; }
        }
      }
    }
    now = s.deadline! + 1;
    s = tick(s, S, R, now).state;
  }
  return viewFor(s, S, R, null);
}
const view = play(24);
const layout = layoutField(view);
const end = lastDay(view);

describe('the ground', () => {
  it('keeps direction: Fort Collins is north of Loveland, and the plains are east of Greeley', () => {
    const fc = geo(40.5853, -105.0844); const lv = geo(40.3978, -105.075); const gr = geo(40.4233, -104.7091); const fm = geo(40.2503, -103.7999);
    expect(fc.y).toBeLessThan(lv.y);
    expect(fm.x).toBeGreaterThan(gr.x);
    // …and the empty plains are shortened: Fort Morgan is drawn nearer than the road is long.
    expect(fm.x - gr.x).toBeLessThan(77);
  });
  it('gives every town a place, and no two drawn towns overlap', () => {
    expect(layout.sites.map((s) => s.id).sort()).toEqual(view.towns.map((t) => t.id).sort());
    for (let i = 0; i < layout.sites.length; i++) for (let j = i + 1; j < layout.sites.length; j++) {
      const a = layout.sites[i]!; const b = layout.sites[j]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(a.r + b.r - 0.5);
    }
  });
  it('keeps the towns in the order they lie on the map', () => {
    const at = Object.fromEntries(layout.sites.map((s) => [s.id, s]));
    expect(at['fort-collins']!.y).toBeLessThan(at['loveland']!.y);
    expect(at['boulder']!.x).toBeLessThan(at['greeley']!.x);
    expect(at['sterling']!.x).toBeGreaterThan(at['fort-morgan']!.x);
  });
  it('a hull holds its points', () => {
    const h = hull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 2, y: 2 }]);
    expect(h).toHaveLength(4);
    expect(h.some((p) => p.x === 2 && p.y === 2)).toBe(false);
  });
});

describe('the season, day by day', () => {
  it('before anybody acts there are no teams, and nothing is younger than the day drawn', () => {
    const d0 = seasonAt(view, 0);
    expect(d0.teams).toEqual([]);
    expect(d0.bodies.filter((b) => b.exists).every((b) => b.foundedDay === 0)).toBe(true);
    for (const d of [0, 3, 9, end]) {
      const sc = buildFieldTown(view, d, layout);
      expect(sc.buildings.every((b) => b.born <= d), `day ${d}`).toBe(true);
    }
  });
  it('only ever grows in what stands: teams, then circles and churches', () => {
    let teams = 0; let bodies = 0;
    for (let d = 0; d <= end; d++) {
      const at = seasonAt(view, d);
      const living = at.bodies.filter((b) => b.exists).length;
      expect(at.teams.length).toBeGreaterThanOrEqual(teams);
      // A circle recognised as a church is replaced by it, so the count never drops by more than it gains.
      expect(living).toBeGreaterThanOrEqual(bodies - 0);
      teams = at.teams.length; bodies = living;
    }
    expect(teams).toBe(view.teams.length);
  });
  it('the last day is exactly what the view holds', () => {
    const at = seasonAt(view, end);
    for (const b of view.bodies) {
      const then = at.bodies.find((x) => x.id === b.id)!;
      expect({ participants: then.participants, believers: then.believers, baptized: then.baptized, leaders: then.leaders }).toEqual({ participants: b.participants, believers: b.believers, baptized: b.baptized, leaders: b.leaders });
    }
    for (const c of view.communities) {
      const then = at.communities.find((x) => x.id === c.id)!;
      expect(then.phase, c.id).toBe(c.derived);
      expect(then.workedBy, c.id).toBe(c.workedBy);
      expect(then.believers).toBe(c.counts.believers);
    }
  });
  it('counts never run below nothing on the way back', () => {
    for (let d = 0; d <= end; d++) for (const b of seasonAt(view, d).bodies) for (const k of ['participants', 'believers', 'baptized', 'leaders'] as const) expect(b[k]).toBeGreaterThanOrEqual(0);
  });
  it('everybody is somewhere every day', () => {
    const towns = new Set(view.towns.map((t) => t.id));
    for (const d of [0, 1, 7, end]) for (const p of view.cast) expect(towns.has(seasonAt(view, d).where[p.role]!), `${p.role} on day ${d}`).toBe(true);
  });
});

describe('the scene', () => {
  it('NOTHING STANDING EVER MOVES: a building keeps its lot from the day it appears to the end', () => {
    const first = new Map<string, string>();
    for (let d = 0; d <= end; d++) {
      for (const b of buildFieldTown(view, d, layout).buildings) {
        const at = `${b.x.toFixed(2)},${b.y.toFixed(2)}`;
        if (!first.has(b.id)) first.set(b.id, at);
        expect(at, `${b.id} on day ${d}`).toBe(first.get(b.id));
      }
    }
  });
  it('no two buildings share ground', () => {
    const sc = buildFieldTown(view, end, layout);
    const big = sc.buildings.filter((b) => b.kind !== 'household' && b.kind !== 'home');
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
      const a = big[i]!; const b = big[j]!;
      const apart = a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01 || a.y + a.d <= b.y + 0.01 || b.y + b.d <= a.y + 0.01;
      expect(apart, `${a.id} / ${b.id}`).toBe(true);
    }
  });
  it('every people community is ground in each town it lives in, coloured by its phase', () => {
    const sc = buildFieldTown(view, end, layout);
    for (const c of view.communities) {
      for (const t of c.towns) {
        const q = sc.plates.find((p) => p.kind === 'quarter' && p.community === c.id && p.town === t);
        expect(q, `${c.id} in ${t}`).toBeTruthy();
        expect(q!.phase).toBe(c.derived);
        expect(q!.w).toBe(BLOCK);
      }
      const beacon = sc.buildings.find((b) => b.kind === 'beacon' && b.community === c.id && b.town === c.towns[0]);
      expect(beacon?.tone).toBe(phaseColor(c.derived));
    }
  });
  it('every circle and church of the season stands in its own town, in its people\'s quarter', () => {
    const sc = buildFieldTown(view, end, layout);
    const at = seasonAt(view, end);
    for (const b of at.bodies.filter((x) => x.exists)) {
      const drawn = sc.buildings.find((x) => x.body === b.id);
      expect(drawn, b.id).toBeTruthy();
      expect(drawn!.town).toBe(b.town);
      expect(drawn!.kind).toBe(b.kind);
      expect(drawn!.stats?.baptized).toBe(b.baptized);
      const q = sc.plates.find((p) => p.kind === 'quarter' && p.community === b.community && p.town === b.town && drawn!.x >= p.x && drawn!.x <= p.x + p.w && drawn!.y >= p.y && drawn!.y <= p.y + p.d);
      expect(q, `${b.id} is inside a quarter of its people`).toBeTruthy();
    }
    expect(sc.tally.circles + sc.tally.churches).toBe(at.bodies.filter((x) => x.exists).length);
  });
  it('a team has an office in its home town from the day it was founded, and a home for each person on it', () => {
    for (const t of view.teams) {
      const born = seasonAt(view, end).teams.find((x) => x.id === t.id)!.born;
      expect(buildFieldTown(view, Math.max(0, born - 1), layout).buildings.some((b) => b.id === `team:${t.id}`)).toBe(born === 0);
      const sc = buildFieldTown(view, end, layout);
      expect(sc.buildings.find((b) => b.id === `team:${t.id}`)?.town).toBe(t.home);
      for (const m of t.members) expect(sc.buildings.some((b) => b.id === `home:${m}`), `${m}'s home`).toBe(true);
    }
  });
  it('filters by a people or by a team, and frames what is left', () => {
    const sc = buildFieldTown(view, end, layout);
    const people = view.communities[0]!.people.name;
    expect(matchesFilter({ people }, { people })).toBe(true);
    expect(matchesFilter({ people: 'somebody else' }, { people })).toBe(false);
    expect(matchesFilter({ team: 'x' }, {})).toBe(true);
    const whole = extentOf(sc, {})!; const some = extentOf(sc, { filter: { people } })!;
    expect((some.x1 - some.x0) * (some.y1 - some.y0)).toBeLessThan((whole.x1 - whole.x0) * (whole.y1 - whole.y0));
    const team = view.teams[0]!;
    const te = extentOf(sc, { filter: { team: team.id } })!;
    const office = sc.buildings.find((b) => b.id === `team:${team.id}`)!;
    expect(office.x).toBeGreaterThanOrEqual(te.x0); expect(office.x).toBeLessThanOrEqual(te.x1);
    expect(extentOf(sc, { town: view.towns[0]!.id })).toBeTruthy();
    expect(extentOf(sc, { filter: { people: 'nobody by that name' } })).toBeNull();
  });
  it('says what a day did', () => {
    const founded = seasonAt(view, end).teams[0]!;
    const sc = buildFieldTown(view, founded.born, layout);
    expect(sc.happened.join(' ')).toContain(founded.name);
  });
  it('names the town a camera following the work should be over, and none before anybody acts', () => {
    expect(buildFieldTown(view, 0, layout).spotlight).toBeUndefined();
    const founded = seasonAt(view, end).teams[0]!;
    const sc = buildFieldTown(view, founded.born, layout);
    expect(sc.spotlight).toBeDefined();
    expect(layout.sites.some((t) => t.id === sc.spotlight)).toBe(true);
    // A circle or a church going up outranks whatever else the day did.
    for (let d = 1; d <= end; d++) {
      const day = buildFieldTown(view, d, layout);
      const raised = day.buildings.filter((b) => b.born === d && (b.kind === 'circle' || b.kind === 'church'));
      if (raised.length) expect(raised.map((b) => b.town)).toContain(day.spotlight);
    }
  });
});
