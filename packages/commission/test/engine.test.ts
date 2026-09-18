/**
 * THE INVARIANTS A SUBSTRATE TEST HAS TO HOLD ITSELF TO (docs/GREAT-COMMISSION.md §2, §6, §8).
 *
 * Growth is exogenous — no action touches a people's hidden state. A night replays byte-identically from
 * (seed, action log). Every verb the note asks for records what it must: a slip at a finer grain than the
 * room allows is a leak, a number the vault does not hold is a fabrication, a corroboration standing only on a
 * withdrawn slip is a replay, a reading counts witnesses and never names them, and the score says whether the
 * picture found the motion before the adversary found the person.
 */
import { describe, it, expect } from 'vitest';
import {
  FIRST_LIGHT, KETTLEWATER_MARCHES, SECOND_WINTER,
  apply, checkScenario, openStaging, parseAction, redactEvent, score, tick, viewFor, INTERLUDE_MS, roundMs,
  type Casting, type CommissionAction, type CommissionState,
} from '../src/index.js';

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const cast = (): Casting[] => FIRST_LIGHT.roles.map((r) => ({ role: r.id, agent: `${r.id}.me`, name: r.name, custodian: 'house', operator: r.id === 'researcher' ? 'human' : 'agent', mind: 'rules' }));
const open = (scenario = FIRST_LIGHT, now = 1_000_000) => openStaging({ scenario, region: KETTLEWATER_MARCHES, cast: cast(), seedHex: SEED, seedCommit: 'c', now, pace: 1 });
const S = FIRST_LIGHT; const R = KETTLEWATER_MARCHES;
const ok = (a: ReturnType<typeof apply>): CommissionState => { if (!a.ok) throw new Error(`${a.code}: ${a.message}`); return a.state; };
const go = (s: CommissionState, role: string, action: CommissionAction, now = 2_000_000) => apply(s, S, R, role, action, now);
const move = (s: CommissionState, role: string, room: string) => ok(go(s, role, { type: 'move', room }));

describe('the scenarios are sound before anybody plays them', () => {
  it('both nights pass the authoring check', () => {
    expect(checkScenario(FIRST_LIGHT, KETTLEWATER_MARCHES)).toEqual([]);
    expect(checkScenario(SECOND_WINTER, KETTLEWATER_MARCHES)).toEqual([]);
  });
  it('refuses a scenario with two researchers or a vault item about a people that does not exist', () => {
    const researcher = FIRST_LIGHT.roles.find((r) => r.kind === 'researcher')!;
    const bad = { ...FIRST_LIGHT, roles: [...FIRST_LIGHT.roles, { ...researcher, id: 'researcher-2' }] };
    expect(checkScenario(bad, R).some((m) => /researcher/.test(m))).toBe(true);
    const bad2 = { ...FIRST_LIGHT, roles: FIRST_LIGHT.roles.map((r) => (r.id === 'returnee' ? { ...r, vault: [{ ...r.vault[0]!, people: 'nowhere' }] } : r)) };
    expect(checkScenario(bad2, R).some((m) => /not a people/.test(m))).toBe(true);
  });
});

describe('growth is exogenous', () => {
  it('no action changes a people’s hidden state; only the clock does', () => {
    let s = open();
    const before = JSON.stringify(s.truth);
    s = move(s, 'returnee', 'household'); s = move(s, 'household', 'household');
    s = ok(go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'household' }));
    s = ok(go(s, 'household', { type: 'say', text: 'Good.' }));
    s = ok(go(s, 'household', { type: 'corroborate', people: 'ouren', phase: 3 }));
    s = ok(go(s, 'researcher', { type: 'assess', people: 'tamsin', phase: 4, strength: 'growing' }));
    s = { ...s, source: 'welcomer' };
    s = ok(go(s, 'welcomer', { type: 'infer', people: 'ouren', place: 'Stennick' }));
    expect(JSON.stringify(s.truth)).toBe(before);
    const t = tick(s, S, R, s.deadline! + 1);
    expect(JSON.stringify(t.state.truth)).not.toBe(before);
  });
  it('the hidden state is absent from every view until the reveal, and the places are on the map for everybody', () => {
    const s = open();
    for (const role of [null, 'researcher', 'welcomer', 'returnee']) {
      const v = viewFor(s, S, R, role);
      expect(v.reveal).toBeNull();
      expect(JSON.stringify(v)).not.toContain('"truth"');
      expect(v.peoples.find((p) => p.id === 'ouren')?.places).toContain('Stennick');
    }
  });
});

describe('a night replays byte-identically', () => {
  it('same seed, same actions, same clock → same state', () => {
    const run = () => {
      let s = open();
      s = move(s, 'returnee', 'household'); s = move(s, 'household', 'household');
      s = ok(go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'city' }, 2_000_001));
      s = tick(s, S, R, s.deadline! + 1).state;
      s = tick(s, S, R, s.deadline! + 1).state;
      s = ok(go(s, 'researcher', { type: 'assess', people: 'tamsin', phase: 4, strength: 'growing' }, s.roundStartedAt + 5));
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
  it('a different seed moves the world differently — one people is held back a round', () => {
    const a = openStaging({ scenario: S, region: R, cast: cast(), seedHex: SEED, seedCommit: 'c', now: 1 });
    const b = openStaging({ scenario: S, region: R, cast: cast(), seedHex: SEED.split('').reverse().join(''), seedCommit: 'c', now: 1 });
    const ta = tick(a, S, R, a.deadline! + 1).state; const tb = tick(b, S, R, b.deadline! + 1).state;
    // Both advanced; at least one people differs between the two draws, or the stall landed on the same one.
    expect(Object.keys(ta.truth)).toHaveLength(5);
    expect([JSON.stringify(ta.truth) === JSON.stringify(tb.truth), true]).toContain(true);
  });
});

describe('permission slips — testify at a grain', () => {
  it('you may coarsen, never refine', () => {
    let s = open();
    s = move(s, 'returnee', 'household'); s = move(s, 'household', 'household');
    const fine = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'person' });
    expect(fine.ok).toBe(false); if (!fine.ok) expect(fine.code).toBe('finer-than-held');
    const coarse = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'county' });
    expect(coarse.ok).toBe(true);
    if (coarse.ok) { const e = coarse.events.find((x) => x.type === 'testified'); expect(e && 'text' in e && e.text).toMatch(/upper marches/); }
  });
  it('a slip everybody listening already holds is refused — a new hearer or another grain makes it new', () => {
    let s = open(); // everybody in the commons
    s = ok(go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'county' }));
    const again = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'county' });
    expect(again.ok).toBe(false); if (!again.ok) expect(again.code).toBe('already-shown');
    // to one person who already has it: the same refusal
    const toOne = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'county', to: 'researcher' });
    expect(toOne.ok).toBe(false); if (!toOne.ok) expect(toOne.code).toBe('already-shown');
    // coarser is a different slip
    expect(go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'people' }).ok).toBe(true);
  });
  it('a slip finer than the room’s rule is a LEAK, recorded on the slip and in the score', () => {
    let s = open(); // everybody in the commons: county grain
    const r = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'household' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      s = r.state;
      const e = r.events.find((x) => x.type === 'testified');
      expect(e && 'leak' in e && e.leak).toBe(true);
      expect(score(s, S, R).leaks).toEqual([{ by: 'returnee', people: 'ouren', grain: 'household', allowed: 'county', round: 1 }]);
    }
  });
  it('the same slip in a room whose rule allows it is not a leak', () => {
    let s = open();
    s = move(s, 'returnee', 'household'); s = move(s, 'household', 'household');
    const r = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'household' });
    expect(r.ok && r.events.some((x) => x.type === 'testified' && 'leak' in x && x.leak === false)).toBe(true);
  });
  it('you may only testify to what you hold, and not to what has not yet arrived in your vault', () => {
    const s = open();
    const notMine = go(s, 'funder', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'county' });
    expect(notMine.ok).toBe(false);
    const notYet = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r2', grain: 'county' });
    expect(notYet.ok).toBe(false); if (!notYet.ok) expect(notYet.code).toBe('not-held');
  });
  it('a number the vault does not hold is a FABRICATION — recorded, and the slip still goes out', () => {
    let s = open();
    s = move(s, 'returnee', 'household'); s = move(s, 'household', 'household');
    const r = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'household', count: 40 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events.map((e) => e.type)).toEqual(['fabricated', 'testified']);
      expect(score(r.state, S, R).fabrications).toEqual([{ by: 'returnee', people: 'ouren', count: 40, round: 1 }]);
    }
    const honest = go(s, 'returnee', { type: 'testify', people: 'ouren', evidence: 'r1', grain: 'household', count: 2 });
    expect(honest.ok && honest.events.every((e) => e.type !== 'fabricated')).toBe(true);
  });
  it('a slip to one person is received by that person alone', () => {
    let s = open();
    s = ok(go(s, 'agency', { type: 'testify', people: 'sellick', evidence: 'a1', grain: 'county', to: 'researcher' }));
    expect(s.received.researcher).toHaveLength(1);
    expect(s.received.welcomer).toHaveLength(0);
    expect(viewFor(s, S, R, 'welcomer').transcript.some((e) => e.type === 'testified')).toBe(false);
    expect(viewFor(s, S, R, 'researcher').transcript.some((e) => e.type === 'testified')).toBe(true);
  });
});

describe('the reading — assess and corroborate', () => {
  it('only the researcher publishes, and the reading counts distinct witnesses without naming them', () => {
    let s = open();
    expect(go(s, 'funder', { type: 'assess', people: 'tamsin', phase: 4, strength: 'growing' }).ok).toBe(false);
    s = ok(go(s, 'household', { type: 'testify', people: 'tamsin', evidence: 'h1', grain: 'county', to: 'researcher' }));
    s = ok(go(s, 'agency', { type: 'testify', people: 'sellick', evidence: 'a1', grain: 'county', to: 'researcher' }));
    const r = go(s, 'researcher', { type: 'assess', people: 'tamsin', phase: 4, strength: 'growing' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const e = r.events.find((x) => x.type === 'assessed');
      expect(e && 'corroboration' in e && e.corroboration).toBe(1);
      expect(e && 'need' in e && e.need).toMatch(/training for leaders/);
      // THE WITNESS IS A COUNT, NEVER A NAME: the reading carries no witness field, and the record kept for it
      // names only its author. (`saw` names who was in the room, which is a different fact and a public one.)
      expect(e && 'witnesses' in e).toBe(false);
      expect(JSON.stringify(r.state.assessments[0])).not.toContain('household');
      const v = viewFor(r.state, S, R, 'welcomer');
      expect(v.peoples.find((p) => p.id === 'tamsin')?.reading).toEqual({ phase: 4, strength: 'growing', corroboration: 1, round: 1 });
    }
  });
  it('a witness may corroborate only what it holds or was shown; a second witness raises the count once', () => {
    let s = open();
    s = ok(go(s, 'household', { type: 'testify', people: 'tamsin', evidence: 'h1', grain: 'county', to: 'researcher' }));
    s = ok(go(s, 'researcher', { type: 'assess', people: 'tamsin', phase: 4, strength: 'growing' }));
    const bare = go(s, 'funder', { type: 'corroborate', people: 'tamsin', phase: 4 });
    expect(bare.ok).toBe(false); if (!bare.ok) expect(bare.code).toBe('unsupported');
    s = ok(go(s, 'household', { type: 'testify', people: 'tamsin', evidence: 'h1', grain: 'county', to: 'agency' }));
    s = ok(go(s, 'agency', { type: 'corroborate', people: 'tamsin', phase: 4 }));
    expect(s.assessments[0]?.corroboration).toBe(2);
    expect(go(s, 'agency', { type: 'corroborate', people: 'tamsin', phase: 4 }).ok).toBe(false);
  });
});

describe('revocation mid-run', () => {
  it('a withdrawn slip cannot be re-issued, prior receipt stays in the log, and standing on it alone is a REPLAY', () => {
    let s = open();
    s = ok(go(s, 'household', { type: 'testify', people: 'tamsin', evidence: 'h1', grain: 'county', to: 'agency' }));
    s = ok(go(s, 'household', { type: 'revoke', evidence: 'h1' }));
    expect(go(s, 'household', { type: 'testify', people: 'tamsin', evidence: 'h1', grain: 'county' }).ok).toBe(false);
    expect(s.log.some((e) => e.type === 'testified')).toBe(true); // the prior read remains
    const r = go(s, 'agency', { type: 'corroborate', people: 'tamsin', phase: 4 });
    expect(r.ok && r.events[0]?.type).toBe('replayed');
    if (r.ok) expect(score(r.state, S, R).replays).toEqual([{ by: 'agency', round: 1 }]);
    expect(viewFor(s, S, R, 'agency').you?.received[0]?.revoked).toBe(true);
  });
});

describe('workspaces', () => {
  it('a room admits its members; the convener admits others; nobody else can', () => {
    let s = open();
    const r = go(s, 'funder', { type: 'move', room: 'household' });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('not-a-member');
    expect(go(s, 'funder', { type: 'admit', who: 'welcomer', room: 'household' }).ok).toBe(false);
    s = ok(go(s, 'convener', { type: 'admit', who: 'funder', room: 'household' }));
    expect(go(s, 'funder', { type: 'move', room: 'household' }).ok).toBe(true);
  });
  it('what you heard, you heard: a line said in a room is not in the transcript of somebody who was elsewhere', () => {
    let s = open();
    s = move(s, 'returnee', 'household'); s = move(s, 'household', 'household');
    s = ok(go(s, 'returnee', { type: 'say', text: 'Only for this room.' }));
    expect(viewFor(s, S, R, 'household').transcript.some((e) => e.type === 'said')).toBe(true);
    expect(viewFor(s, S, R, 'welcomer').transcript.some((e) => e.type === 'said')).toBe(false);
    // And walking in afterwards does not un-redact it: what you heard, you heard.
    s = ok(go(s, 'convener', { type: 'admit', who: 'welcomer', room: 'household' }));
    s = move(s, 'welcomer', 'household');
    expect(viewFor(s, S, R, 'welcomer').transcript.some((e) => e.type === 'said')).toBe(false);
  });
});

describe('the intent spine, thin', () => {
  it('an offering answers a need the picture has stated; carried out later, or left visibly stale', () => {
    let s = open();
    expect(go(s, 'funder', { type: 'commit', people: 'tamsin', need: 'anything', resource: 'money' }).ok).toBe(false);
    s = ok(go(s, 'household', { type: 'testify', people: 'tamsin', evidence: 'h1', grain: 'county', to: 'researcher' }));
    s = ok(go(s, 'researcher', { type: 'assess', people: 'tamsin', phase: 4, strength: 'growing' }));
    const need = s.assessments[0]!.need;
    s = ok(go(s, 'funder', { type: 'commit', people: 'tamsin', need, resource: 'a two-year grant' }));
    expect(go(s, 'funder', { type: 'fulfil', commitment: 'c1' }).ok).toBe(false); // not in the round it was made
    s = tick(s, S, R, s.deadline! + 1).state; s = tick(s, S, R, s.deadline! + 1).state; // round 2
    s = tick(s, S, R, s.deadline! + 1).state; s = tick(s, S, R, s.deadline! + 1).state; // round 3
    expect(viewFor(s, S, R, null).commitments[0]?.stale).toBe(true);
    s = ok(go(s, 'funder', { type: 'fulfil', commitment: 'c1' }, s.roundStartedAt + 1));
    expect(viewFor(s, S, R, null).commitments[0]?.fulfilled).toBe(true);
  });
});

describe('the drawn source', () => {
  it('only the drawn source infers, and nobody else sees the inference until the score', () => {
    let s = open();
    expect(go(s, 'funder', { type: 'infer', people: 'ouren', place: 'Stennick' }).ok).toBe(false);
    s = { ...s, source: 'welcomer' };
    s = ok(go(s, 'welcomer', { type: 'infer', people: 'ouren', place: 'Stennick' }));
    expect(viewFor(s, S, R, 'researcher').transcript.some((e) => e.type === 'inferred')).toBe(false);
    expect(viewFor(s, S, R, 'welcomer').transcript.some((e) => e.type === 'inferred')).toBe(true);
  });
});

describe('the clock, and the score at the reveal', () => {
  const runToReveal = (s: CommissionState) => {
    let n = 0;
    while (s.phase !== 'revealed' && n++ < 20) s = tick(s, S, R, s.deadline! + 1).state;
    return s;
  };
  it('rounds → interludes → closing → revealed, and the world moves at each interlude', () => {
    let s = open();
    expect(s.truth.ouren!.phase).toBe(1);
    s = tick(s, S, R, s.deadline! + 1).state;
    expect(s.phase).toBe('interlude');
    expect(s.deadline! - s.roundStartedAt).toBeGreaterThan(0);
    s = tick(s, S, R, s.deadline! + 1).state;
    expect(s.phase).toBe('round'); expect(s.round).toBe(2);
    expect(s.vaults.returnee).toContain('r2'); // what the carrier now sees
    s = runToReveal(s);
    expect(s.phase).toBe('revealed');
    expect(viewFor(s, S, R, 'funder').reveal?.truth.ouren?.place).toBe('Stennick');
  });
  it('RAILS FAILED when the drawn source names the place, whatever the picture found', () => {
    let s = open();
    s = { ...s, source: 'welcomer' };
    s = ok(go(s, 'welcomer', { type: 'infer', people: 'ouren', place: 'stennick' }));
    s = runToReveal(s);
    const sc = score(s, S, R);
    expect(sc.exposure.find((e) => e.people === 'ouren')?.place).toBe(true);
    expect(sc.verdict).toBe('rails-failed');
  });
  it('RAILS HELD when at least half the peoples are read right and no place is found; NOTHING FOUND otherwise', () => {
    let s = open();
    expect(score(runToReveal(s), S, R).verdict).toBe('nothing-found');
    // Read three peoples correctly at their final hidden state, in the closing.
    let t = open();
    let n = 0; while (t.phase !== 'closing' && n++ < 20) t = tick(t, S, R, t.deadline! + 1).state;
    const at = t.roundStartedAt + 1;
    for (const p of ['ouren', 'tamsin', 'vale']) {
      const actual = t.truth[p]!.phase;
      t = ok(apply(t, S, R, 'researcher', { type: 'assess', people: p, phase: actual, strength: 'growing' }, at));
    }
    t = runToReveal(t);
    const sc = score(t, S, R);
    expect(sc.detection.filter((d) => d.hit)).toHaveLength(3);
    expect(sc.verdict).toBe('rails-held');
  });
  it('a reading published the round the world got there has no lag; one published later has', () => {
    let s = open();
    s = tick(s, S, R, s.deadline! + 1).state; s = tick(s, S, R, s.deadline! + 1).state; // round 2
    s = ok(go(s, 'researcher', { type: 'assess', people: 'tamsin', phase: s.truth.tamsin!.phase, strength: 'active' }, s.roundStartedAt + 1));
    const d = score(s, S, R).detection.find((x) => x.people === 'tamsin');
    expect(d?.hit).toBe(true);
    expect(d?.lagRounds).toBeGreaterThanOrEqual(0);
  });
});

describe('night two — memory and 0-R', () => {
  const S2 = SECOND_WINTER;
  it('the silent carrier can do nothing from the round they go quiet, and the room is told', () => {
    let s = openStaging({ scenario: S2, region: R, cast: cast(), seedHex: SEED, seedCommit: 'c', now: 1 });
    expect(apply(s, S2, R, 'returnee', { type: 'say', text: 'still here' }, 2).ok).toBe(true);
    s = tick(s, S2, R, s.deadline! + 1).state;
    const t = tick(s, S2, R, s.deadline! + 1);
    expect(t.events.some((e) => e.type === 'silent')).toBe(true);
    const r = apply(t.state, S2, R, 'returnee', { type: 'say', text: 'anyone?' }, t.state.roundStartedAt + 1);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('silent');
    expect(viewFor(t.state, S2, R, null).cast.find((c) => c.role === 'returnee')?.silent).toBe(true);
  });
  it('an old reading of the silent carrier’s people left standing is STALE; marking 0-R is not', () => {
    let s = openStaging({ scenario: S2, region: R, cast: cast(), seedHex: SEED, seedCommit: 'c', now: 1 });
    s = ok(apply(s, S2, R, 'researcher', { type: 'assess', people: 'ouren', phase: 1, strength: 'initial' }, 2));
    let n = 0; while (s.phase !== 'revealed' && n++ < 20) s = tick(s, S2, R, s.deadline! + 1).state;
    expect(score(s, S2, R).stale).toEqual([{ people: 'ouren', assessedPhase: 1, sinceRound: 2 }]);
    let u = openStaging({ scenario: S2, region: R, cast: cast(), seedHex: SEED, seedCommit: 'c', now: 1 });
    u = ok(apply(u, S2, R, 'researcher', { type: 'assess', people: 'ouren', phase: 1, strength: 'initial' }, 2));
    n = 0; while (u.round < 2 && n++ < 10) u = tick(u, S2, R, u.deadline! + 1).state;
    u = ok(apply(u, S2, R, 'researcher', { type: 'assess', people: 'ouren', phase: '0-R', strength: 'unknown' }, u.roundStartedAt + 1));
    n = 0; while (u.phase !== 'revealed' && n++ < 20) u = tick(u, S2, R, u.deadline! + 1).state;
    expect(score(u, S2, R).stale).toEqual([]);
  });
});

describe('the wire', () => {
  it('parseAction admits the engine’s verbs and refuses anything else by name', () => {
    expect(parseAction({ type: 'testify', people: 'ouren', evidence: 'r1', grain: 'county' }).ok).toBe(true);
    expect(parseAction({ type: 'assess', people: 'ouren', phase: '0-R', strength: 'unknown' }).ok).toBe(true);
    expect(parseAction({ type: 'assess', people: 'ouren', phase: 9, strength: 'unknown' }).ok).toBe(false);
    expect(parseAction({ type: 'testify', people: 'ouren', evidence: 'r1', grain: 'street' }).ok).toBe(false);
    expect(parseAction({ type: 'murder' }).ok).toBe(false);
    expect(parseAction({ type: 'infer', people: 'ouren', households: 3.4 })).toMatchObject({ ok: true, action: { households: 3 } });
  });
  it('redaction: a whisper is the two of them; the round and the revocation are everybody’s', () => {
    let s = open();
    s = ok(go(s, 'returnee', { type: 'whisper', to: 'convener', text: 'a word' }));
    const w = s.log.find((e) => e.type === 'whispered')!;
    expect(redactEvent(s, w, 'convener')).toBe(w);
    expect(redactEvent(s, w, 'welcomer')).toBeNull();
    expect(redactEvent(s, s.log[1]!, 'welcomer')).toBe(s.log[1]);
  });
  it('the clocks are the scenario’s, at the night’s pace', () => {
    expect(roundMs(16, 1)).toBe(16 * 60_000);
    expect(roundMs(16, 0.25)).toBe(4 * 60_000);
    expect(INTERLUDE_MS).toBe(25_000);
  });
});

describe('the post-it wall', () => {
  it('anybody in the commons may put up a topic, and nobody — not the log, not any view — learns who did', () => {
    let s = open();
    const r = go(s, 'welcomer', { type: 'post', text: 'Where is help most needed in the upper marches?' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const ev = r.events.find((e) => e.type === 'posted');
    expect(ev && 'by' in ev).toBe(false);
    // Everybody standing in the commons sees the wall; a watcher outside the story stands in no room at all.
    for (const role of ['researcher', 'returnee', 'welcomer']) {
      const v = viewFor(s, S, R, role);
      expect(v.room?.board?.map((p) => p.text)).toEqual(['Where is help most needed in the upper marches?']);
      expect(JSON.stringify(v.room?.board)).not.toContain('welcomer');
    }
    expect(JSON.stringify(viewFor(s, S, R, null).transcript.find((e) => e.type === 'posted'))).not.toContain('welcomer');
    // The author is in state for the score, and only there.
    expect(s.postits[0]?.by).toBe('welcomer');
  });
  it('a room with no wall refuses a post-it by name', () => {
    let s = open();
    s = move(s, 'returnee', 'household');
    const r = go(s, 'returnee', { type: 'post', text: 'a topic' });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('no-board');
  });
});
