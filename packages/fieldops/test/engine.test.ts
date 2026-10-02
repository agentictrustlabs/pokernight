/**
 * THE INVARIANTS A SEASON HOLDS ITSELF TO (docs/FIELD-OPERATIONS.md).
 *
 * The world is compiled from the ontology and the registry and passes the authoring check. A part spends one act a
 * day. Every outcome is the seed's: the same seed and the same actions give the same season, byte for byte. A phase
 * is derived from the records and never set; a reading is a claim scored against it. The hidden readiness reaches
 * no view before the reveal. A season played by the house's own policy moves the field — the control the agents
 * are measured against.
 */
import { describe, it, expect } from 'vitest';
import {
  NORTH_OF_DENVER, NORTHERN_COLORADO, DAYS_PER_WEEK, INTERLUDE_MS,
  apply, attachAgent, checkScenario, chooseAction, dayMs, drawAt, openStaging, parseAction, phaseOf, redactEvent, score, tick, viewFor,
  type Casting, type FieldOpsAction, type FieldOpsState,
} from '../src/index.js';

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const S = NORTH_OF_DENVER; const R = NORTHERN_COLORADO;
const cast = (human = 'naomi'): Casting[] => S.roles.map((r) => ({ role: r.id, agent: `${r.id}.me`, name: r.name, custodian: 'house', operator: r.id === human ? 'human' : 'agent', mind: r.id === human ? 'human' : 'rules' }));
const open = (now = 1_000_000) => openStaging({ scenario: S, region: R, cast: cast(), seedHex: SEED, seedCommit: 'c', now, pace: 1 });
const ok = (a: ReturnType<typeof apply>): FieldOpsState => { if (!a.ok) throw new Error(`${a.code}: ${a.message}`); return a.state; };
const go = (s: FieldOpsState, role: string, action: FieldOpsAction, now = 2_000_000) => apply(s, S, R, role, action, now);
/** A season with Naomi's team already founded on day 1 (her act spent) — the shape most tests want to start from. */
function teamed(now = 1_000_000): FieldOpsState {
  let s = open(now);
  s = ok(apply(s, S, R, 'naomi', { type: 'found-team', name: 'Weld Corridor Team', invite: ['yusuf', 'carla'], plan: 'weld-team' }, now + 1));
  s = ok(apply(s, S, R, 'yusuf', { type: 'join', team: 'team-weld-corridor-team' }, now + 2));
  s = ok(apply(s, S, R, 'naomi', { type: 'adopt', communities: R.communities.filter((c) => c.corridor === 'weld').map((c) => c.id) }, now + 3));
  const t = tick(s, S, R, s.deadline! + 1); return t.state;
}

describe('the world is sound before anybody plays it', () => {
  it('passes the authoring check', () => { expect(checkScenario(S, R)).toEqual([]); });
  it('cites the registry for every community and opens at its phase', () => {
    for (const c of R.communities) {
      expect(c.iri).toMatch(/^https:\/\/graph\.global\.church\/community\//);
      expect(c.people.iri).toMatch(/^https:\/\/graph\.global\.church\/pg\//);
      expect(c.registry.framework).toContain('fw-npl-phases');
    }
    const s = open();
    for (const c of R.communities) expect(phaseOf(c, s.communities[c.id]!, s.bodies).phase).toBe(c.registry.phase);
    // A registry P4 opens with a church already there, on the registry's word and adopting no pool agent.
    const p4 = R.communities.find((c) => c.registry.phase === 4)!;
    expect(s.bodies.filter((b) => b.community === p4.id && b.kind === 'church')).toHaveLength(1);
    expect(s.bodies[0]!.agent).toBeNull();
  });
  it('refuses a season with two stewards or a team based nowhere', () => {
    const steward = S.roles.find((r) => r.kind === 'steward')!;
    expect(checkScenario({ ...S, roles: [...S.roles, { ...steward, id: 'steward-2' }] }, R).some((m) => /steward/.test(m))).toBe(true);
    expect(checkScenario({ ...S, teams: S.teams.map((t) => ({ ...t, home: 'atlantis' })) }, R).some((m) => /not a town/.test(m))).toBe(true);
  });
});

describe('the seed decides every outcome', () => {
  it('draws the same number for the same seed and position, and different ones otherwise', () => {
    expect(drawAt(SEED, 7)).toBe(drawAt(SEED, 7));
    expect(drawAt(SEED, 7)).not.toBe(drawAt(SEED, 8));
    expect(drawAt(SEED, 7)).not.toBe(drawAt(SEED.replace(/^a/, 'b'), 7));
  });
  it('replays a day byte-identically from (seed, actions)', () => {
    const run = () => {
      let s = teamed();
      s = ok(go(s, 'naomi', { type: 'share', community: 'burmese-weld' }));
      s = ok(go(s, 'yusuf', { type: 'visit', community: 'somali-bantus-weld' }));
      s = ok(go(s, 'carla', { type: 'join', team: 'team-weld-corridor-team' }));
      s = ok(go(s, 'carla', { type: 'coach', who: 'naomi' }));
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
  it('writes readiness at open and never again; no view carries it before the reveal', () => {
    let s = teamed();
    const before = JSON.stringify(s.truth);
    s = ok(go(s, 'naomi', { type: 'share', community: 'burmese-weld' }));
    expect(JSON.stringify(s.truth)).toBe(before);
    for (const role of [null, 'naomi', 'priya']) {
      const v = viewFor(s, S, R, role);
      expect(v.reveal).toBeNull();
      expect(JSON.stringify(v)).not.toContain('readiness');
    }
  });
});

describe('a day is one act', () => {
  it('refuses a second act on the same day, and allows one again after the clock', () => {
    let s = teamed();
    s = ok(go(s, 'naomi', { type: 'visit', community: 'burmese-weld' }));
    const again = go(s, 'naomi', { type: 'share', community: 'burmese-weld' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('spent');
    const t = tick(s, S, R, s.deadline! + 1);
    expect(t.state.day).toBe(s.day + 1);
    expect(go(t.state, 'naomi', { type: 'share', community: 'burmese-weld' }).ok).toBe(true);
  });
  it('moving and talking are free; acting among a people needs you in one of its towns', () => {
    let s = teamed();
    s = ok(go(s, 'naomi', { type: 'adopt', communities: ['afghans-larimer'] })); // a steward may take up a people anywhere
    const far = go(s, 'naomi', { type: 'visit', community: 'afghans-larimer' });
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.code).toBe('not-here');
    s = ok(go(s, 'naomi', { type: 'move', town: 'fort-collins' }));
    s = ok(go(s, 'naomi', { type: 'say', text: 'Here now.' }));
    expect(go(s, 'naomi', { type: 'visit', community: 'afghans-larimer' }).ok).toBe(true);
  });
  it('a partner supports a team somebody founded, and a steward assesses; neither does field work', () => {
    let s = open();
    expect(go(s, 'dan', { type: 'visit', community: 'burmese-weld' }).ok).toBe(false);
    const nobody = go(s, 'dan', { type: 'support', team: 'team-weld-corridor-team', resource: 'funds' });
    expect(nobody.ok).toBe(false);
    s = teamed();
    s = ok(go(s, 'dan', { type: 'support', team: 'team-weld-corridor-team', resource: 'funds' }));
    expect(s.capacity['team-weld-corridor-team']).toBe(1);
    const a = go(s, 'priya', { type: 'assess', community: 'burmese-weld', phase: 2 });
    expect(a.ok).toBe(true);
    if (a.ok) {
      const ev = a.events.find((e) => e.type === 'assessed');
      expect(ev && ev.type === 'assessed' ? ev.derived : null).toBe(1);
    }
    expect(go(s, 'naomi', { type: 'assess', community: 'burmese-weld', phase: 2 }).ok).toBe(false);
  });
  it('the engine says what a part may do, and a client that reads it draws only real buttons', () => {
    const s = teamed();
    const v = viewFor(s, S, R, 'dan');
    expect(v.you?.may.map((m) => m.action)).toContain('support');
    expect(v.you?.may.map((m) => m.action)).not.toContain('visit');
    const w = viewFor(s, S, R, 'naomi');
    expect(w.you?.may.map((m) => m.action)).toEqual(expect.arrayContaining(['visit', 'share', 'report', 'rest', 'define-community']));
    expect(w.you?.may.map((m) => m.action)).not.toContain('found');
    expect(w.you?.may.map((m) => m.action)).not.toContain('found-team');
    const fresh = viewFor(open(), S, R, 'naomi');
    expect(fresh.you?.may.map((m) => m.action)).toContain('found-team');
    expect(fresh.you?.may.map((m) => m.action)).not.toContain('visit'); // nobody has taken anybody up yet
    expect(w.you?.intended?.id).toBe('weld-team');
    expect(fresh.teams).toEqual([]);
  });
});

describe('a season bootstraps: nothing is a team until a part founds one', () => {
  it('a part founds a team where it stands, is its steward, and the invited join or decline — free, like a bell', () => {
    let s = open();
    const f = go(s, 'naomi', { type: 'found-team', name: 'Weld Corridor Team', purpose: 'Greeley and Evans', invite: ['yusuf', 'carla', 'dan', 'naomi'], plan: 'weld-team' });
    expect(f.ok).toBe(true);
    s = ok(f);
    const t = s.teams[0]!;
    expect(t.id).toBe('team-weld-corridor-team');
    expect(t.steward).toBe('naomi'); expect(t.members).toEqual(['naomi']); expect(t.corridor).toBe('weld'); expect(t.home).toBe('greeley');
    expect(t.invited).toEqual(['yusuf', 'carla']); // a partner is not asked; the founder is not asked twice
    expect(t.agent).toBeNull(); expect(t.plan).toBe('weld-team');
    expect(s.membership.naomi).toBe(t.id);
    expect(s.log.filter((e) => e.type === 'invited')).toHaveLength(2);
    expect(go(s, 'naomi', { type: 'visit', community: 'burmese-weld' }).ok).toBe(false); // founding spent the day
    expect(viewFor(s, S, R, 'yusuf').you?.invitedTo).toEqual([t.id]);
    expect(viewFor(s, S, R, 'yusuf').you?.may.map((m) => m.action)).toEqual(expect.arrayContaining(['join', 'decline']));
    s = ok(go(s, 'yusuf', { type: 'join', team: t.id }));
    s = ok(go(s, 'carla', { type: 'decline', team: t.id }));
    expect(s.teams[0]!.members).toEqual(['naomi', 'yusuf']); expect(s.teams[0]!.declined).toEqual(['carla']); expect(s.teams[0]!.invited).toEqual([]);
    s = ok(go(s, 'naomi', { type: 'adopt', communities: ['somali-bantus-weld'] }));
    expect(go(s, 'yusuf', { type: 'visit', community: 'somali-bantus-weld' }).ok).toBe(true); // joining was free
    expect(go(s, 'grace', { type: 'join', team: t.id }).ok).toBe(false); // not asked
    expect(go(s, 'yusuf', { type: 'invite', who: 'grace' }).ok).toBe(false); // not the steward
    s = ok(go(s, 'naomi', { type: 'invite', who: 'grace' }));
    expect(s.teams[0]!.invited).toEqual(['grace']);
    expect(go(s, 'yusuf', { type: 'found-team', name: 'Another', invite: [] }).ok).toBe(false); // on a team already
    expect(go(s, 'grace', { type: 'found-team', name: 'weld corridor team' }).ok).toBe(false); // name taken
  });
  it('a workspace works with the communities somebody took up; a steward defines a new one, invented, with the seed’s readiness', () => {
    let s = open();
    const c = 'burmese-weld';
    const nobody = go(s, 'naomi', { type: 'visit', community: c });
    expect(nobody.ok).toBe(false); if (!nobody.ok) expect(nobody.code).toBe('not-worked');
    expect(go(s, 'naomi', { type: 'adopt', communities: [c] }).ok).toBe(false); // no team to take it up for
    s = ok(go(s, 'naomi', { type: 'found-team', name: 'Weld', invite: ['yusuf'] }));
    s = ok(go(s, 'yusuf', { type: 'join', team: 'team-weld' }));
    expect(go(s, 'yusuf', { type: 'adopt', communities: [c] }).ok).toBe(false); // a member is not the steward
    s = ok(go(s, 'naomi', { type: 'adopt', communities: [c, c, 'no-such'] }));
    expect(s.worked[c]).toBe('team-weld');
    expect(viewFor(s, S, R, null).communities.find((x) => x.id === c)?.workedBy).toBe('team-weld');
    expect(go(s, 'naomi', { type: 'adopt', communities: [c] }).ok).toBe(false); // taken up already
    // Define a new people community: a day's act, the team takes it up, the seed draws its readiness.
    const truthBefore = JSON.stringify(s.truth);
    const t = tick(s, S, R, s.deadline! + 1).state;
    expect(apply(t, S, R, 'naomi', { type: 'visit', community: c }, t.deadline! - 1).ok).toBe(true); // anybody works a community somebody took up
    const d = apply(t, S, R, 'naomi', { type: 'define-community', name: 'Eritreans', people: 'Eritreans', town: 'greeley', definition: 'Tigrinya-speaking families around the 8th Avenue shops, two churches among them already.', language: 'Tigrinya' }, t.deadline! - 1);
    expect(d.ok).toBe(true); if (!d.ok) return;
    const def = d.state.defined[0]!;
    expect(def.id).toBe('defined-eritreans-greeley'); expect(def.fictional).toBe(true); expect(def.registry.phase).toBe(0); expect(def.corridor).toBe('weld');
    expect(d.state.worked[def.id]).toBe('team-weld');
    expect(d.state.truth[def.id]?.readiness).toBeGreaterThan(0.19); expect(d.state.truth[def.id]?.readiness).toBeLessThan(0.81);
    expect(JSON.stringify({ ...d.state.truth, [def.id]: undefined })).toBe(JSON.stringify({ ...JSON.parse(truthBefore), [def.id]: undefined }));
    expect(JSON.stringify(viewFor(d.state, S, R, 'naomi'))).not.toContain('readiness');
    expect(viewFor(d.state, S, R, null).communities.find((x) => x.id === def.id)?.fictional).toBe(true);
    const there = ok(apply(d.state, S, R, 'yusuf', { type: 'move', town: 'greeley' }, d.state.deadline! - 1));
    expect(apply(there, S, R, 'yusuf', { type: 'visit', community: def.id }, there.deadline! - 1).ok).toBe(true);
    // Replays: the same definition twice draws the same readiness.
    const again = apply(t, S, R, 'naomi', { type: 'define-community', name: 'Eritreans', people: 'Eritreans', town: 'greeley', definition: 'Tigrinya-speaking families around the 8th Avenue shops, two churches among them already.' }, t.deadline! - 1);
    expect(again.ok && again.state.truth[def.id]?.readiness).toBe(d.state.truth[def.id]?.readiness);
  });
  it('a circle belongs to a team: no team, no circle; the host attaches the agents it charters', () => {
    let s = open();
    const c = 'burmese-weld';
    s = ok(go(s, 'naomi', { type: 'found-team', name: 'Weld', invite: [] }));
    s = ok(go(s, 'naomi', { type: 'adopt', communities: [c] }));
    s = ok(go(s, 'yusuf', { type: 'move', town: 'greeley' }));
    s = tick(s, S, R, s.deadline! + 1).state;
    // Yusuf, on no team, works the community Naomi's team took up — but cannot found a circle.
    for (let i = 0; i < 40 && (s.communities[c]!.believers < 2 || s.communities[c]!.studies < 1); i++) {
      const r = apply(s, S, R, 'yusuf', s.communities[c]!.believers >= 2 && s.communities[c]!.seekers >= 2 ? { type: 'study', community: c } : { type: 'share', community: c }, s.deadline! - 1);
      if (r.ok) s = r.state;
      s = tick(s, S, R, s.deadline! + 1).state; if (s.phase === 'interlude') s = tick(s, S, R, s.deadline! + 1).state;
    }
    const noTeam = apply(s, S, R, 'yusuf', { type: 'found', community: c }, s.deadline! - 1);
    expect(noTeam.ok).toBe(false); if (!noTeam.ok) expect(noTeam.code).toBe('no-team');
    s = ok(apply(s, S, R, 'naomi', { type: 'found', community: c }, s.deadline! - 1));
    const circle = s.bodies.find((b) => b.kind === 'circle')!;
    expect(circle.team).toBe('team-weld'); expect(circle.agent).toBeNull();
    const attached = attachAgent(attachAgent(s, { team: 'team-weld' }, '0xteam', 'elena'), { body: circle.id }, '0xbody', 'elena');
    expect(attached.teams[0]!.agent).toBe('0xteam'); expect(attached.teams[0]!.custodian).toBe('elena');
    expect(attached.bodies.find((b) => b.id === circle.id)?.agent).toBe('0xbody');
    expect(s.bodies.find((b) => b.id === circle.id)?.agent).toBeNull(); // pure
    expect(viewFor(attached, S, R, null).bodies.find((b) => b.id === circle.id)?.teamName).toBe('Weld');
  });
});

describe('the work compounds and a phase is derived', () => {
  /** Play `role` through enough days of `action` to produce `until(state)`, advancing the clock between acts. */
  function until(s: FieldOpsState, role: string, action: FieldOpsAction, done: (s: FieldOpsState) => boolean, max = 60): FieldOpsState {
    let now = s.deadline! - 1;
    for (let i = 0; i < max && !done(s); i++) {
      const r = apply(s, S, R, role, action, now);
      if (r.ok) s = r.state;
      // the night, and any interlude after it
      let t = tick(s, S, R, s.deadline! + 1); s = t.state;
      if (s.phase === 'interlude') { t = tick(s, S, R, s.deadline! + 1); s = t.state; }
      now = s.deadline! - 1;
    }
    return s;
  }
  it('sharing makes seekers and believers; a study and a circle follow; baptisms reach Phase 3', () => {
    let s = teamed();
    const c = 'burmese-weld';
    expect(s.communities[c]!.phase).toBe(1);
    s = until(s, 'naomi', { type: 'share', community: c }, (x) => x.communities[c]!.believers >= 2 && x.communities[c]!.conversations >= 5);
    expect(s.communities[c]!.phase).toBe(2);
    s = until(s, 'naomi', { type: 'study', community: c }, (x) => x.communities[c]!.studies >= 1);
    s = until(s, 'naomi', { type: 'found', community: c }, (x) => x.bodies.some((b) => b.community === c && b.kind === 'circle'));
    const circle = s.bodies.find((b) => b.community === c && b.kind === 'circle')!;
    expect(circle.generation).toBe(1);
    expect(s.log.some((e) => e.type === 'founded' && e.body === circle.id)).toBe(true);
    s = until(s, 'naomi', { type: 'baptize', body: circle.id }, (x) => x.communities[c]!.baptized >= 1);
    expect(s.communities[c]!.phase).toBe(3);
    expect(s.log.some((e) => e.type === 'phase' && e.community === c && e.to === 3)).toBe(true);
  });
  it('recognising a church needs the criteria; the church is the team\'s and starts with no agent of its own', () => {
    let s = teamed();
    const c = 'burmese-weld';
    s = until(s, 'naomi', { type: 'share', community: c }, (x) => x.communities[c]!.believers >= 3);
    s = until(s, 'naomi', { type: 'study', community: c }, (x) => x.communities[c]!.studies >= 1);
    s = until(s, 'naomi', { type: 'found', community: c }, (x) => x.bodies.some((b) => b.kind === 'circle'));
    const circle = s.bodies.find((b) => b.kind === 'circle')!;
    expect(circle.agent).toBeNull(); expect(circle.team).toBe('team-weld-corridor-team');
    const early = go(s, 'naomi', { type: 'recognize', body: circle.id }, s.deadline! - 1);
    expect(early.ok).toBe(false);
    s = until(s, 'naomi', { type: 'gather', body: circle.id }, (x) => (x.bodies.find((b) => b.id === circle.id)?.believers ?? 0) >= 6);
    s = until(s, 'naomi', { type: 'baptize', body: circle.id }, (x) => (x.bodies.find((b) => b.id === circle.id)?.baptized ?? 0) >= 3);
    s = until(s, 'naomi', { type: 'train', body: circle.id }, (x) => (x.bodies.find((b) => b.id === circle.id)?.leaders ?? 0) >= 1);
    s = until(s, 'naomi', { type: 'recognize', body: circle.id }, (x) => x.bodies.some((b) => b.kind === 'church' && b.recognizedFrom === circle.id));
    const church = s.bodies.find((b) => b.kind === 'church' && b.recognizedFrom === circle.id)!;
    expect(church.agent).toBeNull(); expect(church.team).toBe('team-weld-corridor-team');
    expect(s.bodies.find((b) => b.id === circle.id)?.lifecycle).toBe('RecognizedAsChurch');
    expect(s.communities[c]!.phase).toBe(4);
  });
  it('a church that sends makes a second generation, and the phase follows the generations', () => {
    let s = teamed();
    const c = 'sgaw-karen-weld';
    const church = s.bodies.find((b) => b.community === c && b.kind === 'church')!;
    expect(s.communities[c]!.phase).toBe(4);
    s = until(s, 'naomi', { type: 'gather', body: church.id }, (x) => (x.bodies.find((b) => b.id === church.id)?.believers ?? 0) >= 8);
    s = until(s, 'naomi', { type: 'train', body: church.id }, (x) => (x.bodies.find((b) => b.id === church.id)?.leaders ?? 0) >= 2);
    const sent = go(s, 'naomi', { type: 'send', body: church.id, town: 'windsor' }, s.deadline! - 1);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const daughter = sent.state.bodies.find((b) => b.parent === church.id)!;
    expect(daughter.generation).toBe(2);
    expect(daughter.kind).toBe('circle');
    // The registry's floor church belongs to no team; the circle it sends out belongs to the sender's.
    expect(church.team).toBeNull(); expect(daughter.team).toBe('team-weld-corridor-team');
    // A daughter circle is not yet a church: the phase moves when it is recognised.
    expect(sent.state.communities[c]!.phase).toBe(4);
    expect(go(sent.state, 'naomi', { type: 'send', body: church.id, town: 'fort-collins' }).ok).toBe(false);
  });
  it('a circle nobody gathers for twelve days stalls at the week’s end', () => {
    let s = teamed();
    const c = 'burmese-weld';
    s = until(s, 'naomi', { type: 'share', community: c }, (x) => x.communities[c]!.believers >= 2);
    s = until(s, 'naomi', { type: 'study', community: c }, (x) => x.communities[c]!.studies >= 1);
    s = until(s, 'naomi', { type: 'found', community: c }, (x) => x.bodies.some((b) => b.kind === 'circle'));
    const circle = s.bodies.find((b) => b.kind === 'circle')!;
    s = until(s, 'naomi', { type: 'gather', body: circle.id }, (x) => x.bodies.find((b) => b.id === circle.id)?.lifecycle === 'Active');
    s = until(s, 'naomi', { type: 'rest' }, (x) => x.bodies.find((b) => b.id === circle.id)?.lifecycle === 'Stalled', 40);
    expect(s.bodies.find((b) => b.id === circle.id)?.lifecycle).toBe('Stalled');
    expect(s.log.some((e) => e.type === 'stalled' && e.body === circle.id)).toBe(true);
  });
});

describe('the clock', () => {
  it('runs seven days to an interlude, then the next week, and after the last week closes and reveals', () => {
    let s = open();
    const days = S.weeks.length * DAYS_PER_WEEK;
    let now = s.deadline!;
    let interludes = 0;
    for (let guard = 0; guard < days * 3 && s.phase !== 'revealed'; guard++) {
      const t = tick(s, S, R, now + 1);
      s = t.state;
      if (s.phase === 'interlude') interludes += 1;
      now = s.deadline ?? now + 1;
    }
    expect(interludes).toBe(S.weeks.length);
    expect(s.day).toBe(days);
    expect(s.phase).toBe('revealed');
    expect(viewFor(s, S, R, null).reveal?.score.verdict).toBe('field-held');
    expect(dayMs(1, 1)).toBe(60_000);
    expect(INTERLUDE_MS).toBeGreaterThan(0);
  });
});

describe('what reaches whom', () => {
  it('a whisper is between two parts; everything else is the field’s', () => {
    let s = teamed();
    s = ok(go(s, 'naomi', { type: 'whisper', to: 'carla', text: 'I am tired.' }));
    const w = s.log.find((e) => e.type === 'whispered')!;
    expect(redactEvent(s, w, 'yusuf')).toBeNull();
    expect(redactEvent(s, w, 'carla')).toBe(w);
    expect(redactEvent(s, w, null)).toBe(w);
    s = ok(go(s, 'naomi', { type: 'visit', community: 'burmese-weld' }));
    expect(viewFor(s, S, R, 'walt').transcript.some((e) => e.type === 'acted' && e.by === 'naomi')).toBe(true);
  });
  it('parses the wire and refuses the unknown', () => {
    expect(parseAction({ type: 'send', body: 'x', town: 'y' }).ok).toBe(true);
    expect(parseAction({ type: 'assess', community: 'x', phase: 9 }).ok).toBe(false);
    expect(parseAction({ type: 'support', team: 'x', resource: 'gold' }).ok).toBe(false);
    expect(parseAction({ type: 'teleport' }).ok).toBe(false);
  });
});

describe('a season the house plays is the control', () => {
  it('moves the field: at least three communities gain a phase, and every part acts most days', () => {
    let s = openStaging({ scenario: S, region: R, cast: cast('nobody'), seedHex: SEED, seedCommit: 'c', now: 1_000_000, pace: 1 });
    let now = 1_000_000;
    let tickN = 0;
    for (let guard = 0; guard < 2000 && s.phase !== 'revealed'; guard++) {
      if (s.phase === 'day') {
        for (const c of s.cast) {
          const view = viewFor(s, S, R, c.role);
          const move = chooseAction(view, S.roles.find((r) => r.id === c.role)!.lines, tickN++);
          if (!move) continue;
          const r = apply(s, S, R, c.role, move.action, now, 'agent');
          if (r.ok) s = r.state;
          // a move, a join, an adoption are free: let the part act after one, as the host does
          if (['move', 'adopt', 'join', 'invite', 'decline'].includes(move.action.type)) {
            const v2 = viewFor(s, S, R, c.role);
            const m2 = chooseAction(v2, S.roles.find((r) => r.id === c.role)!.lines, tickN++);
            if (m2 && m2.action.type !== 'move') { const r2 = apply(s, S, R, c.role, m2.action, now, 'agent'); if (r2.ok) s = r2.state; }
          }
        }
      }
      now = s.deadline! + 1;
      s = tick(s, S, R, now).state;
    }
    const sc = score(s, S, R);
    const moved = sc.communities.filter((c) => c.moved > 0).length;
    // THE HOUSE BOOTSTRAPS: four teams founded from the plan, every worker and coach on one, within the first days.
    expect(s.teams).toHaveLength(4);
    expect(s.teams.map((t) => t.plan).sort()).toEqual(['boulder-team', 'larimer-team', 'plains-team', 'weld-team']);
    expect(s.teams.every((t) => t.foundedDay <= 2)).toBe(true);
    for (const r of S.roles.filter((r) => r.kind === 'worker' || r.kind === 'coach')) expect(s.membership[r.id]).toBeDefined();
    expect(Object.keys(s.worked)).toHaveLength(R.communities.length); // every community taken up by its corridor's team
    expect(sc.verdict).toBe('field-moved');
    expect(moved).toBeGreaterThanOrEqual(3);
    expect(sc.communities.some((c) => c.end >= 4 && c.start < 4)).toBe(true);
    for (const p of sc.parts) expect(p.days).toBeGreaterThan(S.weeks.length * DAYS_PER_WEEK * 0.5);
    expect(viewFor(s, S, R, null).reveal?.truth['burmese-weld']?.readiness).toBeGreaterThan(0);
  });
});

describe('the road, and the decisions', () => {
  it('brings something on some days, and never touches readiness; a barrier halves work for anybody who does not speak the language', () => {
    let s = open();
    const before = JSON.stringify(s.truth);
    let now = s.deadline! + 1;
    for (let i = 0; i < 60 && !s.log.some((e) => e.type === 'trail'); i++) {
      // somebody has to have been among a people for the road to find a target
      const r = apply(s, S, R, 'naomi', { type: 'visit', community: 'burmese-weld' }, now - 1); if (r.ok) s = r.state;
      s = tick(s, S, R, now).state; if (s.phase === 'interlude') s = tick(s, S, R, s.deadline! + 1).state;
      now = s.deadline! + 1;
    }
    expect(s.log.some((e) => e.type === 'trail')).toBe(true);
    expect(JSON.stringify(s.truth)).toBe(before);
    expect(viewFor(s, S, R, null).trail.every((t) => t.until >= s.day)).toBe(true);
    expect(JSON.stringify(viewFor(s, S, R, 'naomi'))).not.toContain('readiness');
  });
  it('a decision opens on its day, is taken once, and its consequence changes the season — never the world', () => {
    let s = teamed();
    expect(viewFor(s, S, R, 'naomi').you?.choices).toHaveLength(0);
    let now = s.deadline! + 1;
    while (s.day < 9) { s = tick(s, S, R, now).state; if (s.phase === 'interlude') s = tick(s, S, R, s.deadline! + 1).state; now = s.deadline! + 1; }
    const v = viewFor(s, S, R, 'naomi');
    expect(v.you?.choices.map((c) => c.id)).toEqual(['the-uncle']);
    expect(v.you?.may.map((m) => m.action)).toContain('choose');
    const before = JSON.stringify(s.truth);
    const r = go(s, 'naomi', { type: 'choose', choice: 'the-uncle', option: 'move-evans' }, now - 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.where['naomi']).toBe('evans');
    expect(r.state.outcomes.map((o) => o.key)).toEqual(['naomi:evans']);
    expect(JSON.stringify(r.state.truth)).toBe(before);
    expect(viewFor(r.state, S, R, 'naomi').you?.choices).toHaveLength(0);
    expect(go(r.state, 'naomi', { type: 'choose', choice: 'the-uncle', option: 'keep-going' }, now - 1).ok).toBe(false);
    // A decision does not spend the day: naomi can still work in Evans.
    expect(go(r.state, 'naomi', { type: 'visit', community: 'burmese-weld' }, now - 1).ok).toBe(true);
  });
});
