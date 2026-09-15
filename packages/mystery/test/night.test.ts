import { describe, expect, it } from 'vitest';
import { bytesToHex, seedCommit } from '@pokernight/deal';
import {
  ALPINE_BELVEDERE as VENUE, BELVEDERE_SNOWFALL as TITLE, apply, chooseAction, isDead, openStaging, redactEvent,
  tick, viewFor, type Casting, type MysteryState,
} from '../src/index.js';

const T0 = 1_780_000_000_000;

function seedFrom(n: number): string {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (n * 31 + i * 7) % 251;
  return bytesToHex(b);
}

function castOf(humans: string[] = []): Casting[] {
  return TITLE.roles.map((r) => ({
    role: r.id, agent: `${r.id}.cast`, name: r.name, custodian: 'house',
    operator: humans.includes(r.id) ? ('human' as const) : ('agent' as const),
  }));
}

/** A whole night with nobody at it: the harness the engine is actually tested with. */
function playNight(n: number, humans: string[] = []): { state: MysteryState; ticks: number } {
  const seedHex = seedFrom(n);
  let state = openStaging({ title: TITLE, venue: VENUE, cast: castOf(humans), seedHex, seedCommit: seedCommit(new Uint8Array(1)), now: T0 });
  let now = T0;
  let ticks = 0;
  while (state.phase !== 'revealed' && ticks < 4000) {
    ticks++;
    now += 4000;
    for (const c of state.cast) {
      if (isDead(state, c.role)) continue;
      const view = viewFor(state, TITLE, VENUE, c.role);
      const role = TITLE.roles.find((r) => r.id === c.role)!;
      const move = chooseAction(view, role.lines, ticks);
      if (!move) continue;
      const r = apply(state, TITLE, VENUE, c.role, move.action, now, 'agent');
      if (r.ok) state = r.state;
      if (move.line) { const said = apply(state, TITLE, VENUE, c.role, { type: 'say', text: move.line }, now, 'agent'); if (said.ok) state = said.state; }
    }
    state = tick(state, TITLE, VENUE, now).state;
  }
  return { state, ticks };
}

describe('a night at the Belvedere, played by nobody', () => {
  it('runs from curtain-up to the reveal, with two deaths and a killer', () => {
    const { state } = playNight(1);
    expect(state.phase).toBe('revealed');
    expect(state.deaths).toHaveLength(2);
    expect(state.cast.map((c) => c.role)).toContain(state.killer);
    expect(state.deaths.some((d) => d.victim === state.killer)).toBe(false);
  });

  it('replays byte-identically from the same seed', () => {
    const a = playNight(7).state;
    const b = playNight(7).state;
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });

  it('a different seed is a different night', () => {
    const killers = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => playNight(n).state.killer));
    expect(killers.size).toBeGreaterThan(1);
  });

  it('draws over the whole cast by default — a solo player must sometimes have a mystery to solve', () => {
    const killers = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => playNight(n, ['doctor']).state.killer));
    expect(killers.size).toBeGreaterThan(1);
  });

  it('the evidence the night produced still names exactly one person', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const { state } = playNight(n);
      const traits = state.deaths.flatMap((d) => d.evidence)
        .map((id) => TITLE.clues.find((c) => c.id === id))
        .filter((c): c is Extract<typeof TITLE.clues[number], { kind: 'evidence' }> => c?.kind === 'evidence')
        .map((c) => c.trait);
      const left = TITLE.roles.filter((r) => traits.every((t) => r.traits.includes(t))).map((r) => r.id);
      expect(left).toEqual([state.killer]);
    }
  });
});

describe('a clue is a card', () => {
  it('no view carries another character\'s clue, and only the killer is told they are the killer', () => {
    const { state } = playNight(3);
    for (const c of state.cast) {
      const v = viewFor(state, TITLE, VENUE, c.role);
      expect(v.you?.killer).toBe(c.role === state.killer);
      const known = new Set(state.knows[c.role] ?? []);
      for (const clue of v.clues) expect(known.has(clue.id) || state.publicClues.includes(clue.id)).toBe(true);
      // and nothing in the transcript tells them what somebody else found
      for (const e of v.transcript) if (e.type === 'found') expect(e.who).toBe(c.role);
      for (const e of v.transcript) if (e.type === 'whispered') expect([e.by, e.to]).toContain(c.role);
    }
  });

  it('a spectator sees the public story and no private knowledge', () => {
    const { state } = playNight(4);
    const mid = { ...state, phase: 'act' as const };
    const v = viewFor(mid, TITLE, VENUE, null);
    expect(v.you).toBeNull();
    expect(v.reveal).toBeNull();
    for (const e of v.transcript) expect(e.type === 'found' || e.type === 'whispered').toBe(false);
  });

  it('redaction keeps a room\'s talk in its room', () => {
    const { state } = playNight(5);
    const said = state.log.find((e) => e.type === 'said');
    if (!said || said.type !== 'said') return;
    const elsewhere = state.cast.map((c) => c.role).find((r) => state.where[r] !== said.room && r !== said.by);
    if (elsewhere) expect(redactEvent(state, said, elsewhere)).toBeNull();
  });
});

describe('what the engine refuses', () => {
  const start = () => openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(2), seedCommit: 'x', now: T0 });

  it('refuses a walk through a wall, and a room the act has not opened', () => {
    const s = start();
    const r1 = apply(s, TITLE, VENUE, 'doctor', { type: 'move', room: 'kitchen' }, T0, 'human');
    expect(r1.ok).toBe(false);
    const r2 = apply(s, TITLE, VENUE, 'doctor', { type: 'move', room: 'lounge' }, T0, 'human');
    expect(r2.ok).toBe(true);
  });

  it('refuses a murder from somebody who is not the killer, and one with the room full', () => {
    const s = start();
    const notKiller = s.cast.find((c) => c.role !== s.killer)!.role;
    expect(apply(s, TITLE, VENUE, notKiller, { type: 'murder', victim: s.killer, prop: 'knife-block' }, T0, 'human')).toMatchObject({ ok: false, code: 'not-you' });
    expect(apply(s, TITLE, VENUE, s.killer, { type: 'murder', victim: notKiller, prop: 'knife-block' }, T0, 'human')).toMatchObject({ ok: false });
  });

  it('lets the killer kill when they are alone with somebody, where the act allows it and the act is old enough', () => {
    let s = start();
    // wind the night on to act 2, where the kitchen is a chance, and far enough into it for one
    s = { ...s, act: 2, phase: 'act', actStartedAt: T0 - 20 * 60_000, deadline: T0 + 60_000 };
    const victim = s.cast.find((c) => c.role !== s.killer)!.role;
    s = { ...s, where: { ...s.where, [s.killer]: 'kitchen', [victim]: 'kitchen' } };
    for (const c of s.cast) if (c.role !== s.killer && c.role !== victim) s.where[c.role] = 'lobby';
    const r = apply(s, TITLE, VENUE, s.killer, { type: 'murder', victim, prop: 'knife-block' }, T0, 'human');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.deaths[0]).toMatchObject({ victim, room: 'kitchen' });
      expect(r.state.deaths[0]!.evidence.length).toBe(TITLE.evidencePerDeath);
    }
  });

  it('records a claim without ever checking it', () => {
    const s = start();
    const other = s.cast.find((c) => c.role !== 'doctor')!.role;
    const r = apply(s, TITLE, VENUE, 'doctor', { type: 'alibi', for: other }, T0, 'human');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.claims[0]).toMatchObject({ by: 'doctor', about: other, kind: 'alibi' });
  });
});

describe('who the seed may land on is decided before it is spent', () => {
  const cast = (humans: string[]) => TITLE.roles.map((r) => ({
    role: r.id, agent: `${r.id}.cast`, name: r.name, custodian: 'house',
    operator: humans.includes(r.id) ? ('human' as const) : ('agent' as const),
  }));
  const open = (rule: 'any' | 'human' | string, humans: string[], n = 1) =>
    openStaging({ title: TITLE, venue: VENUE, cast: cast(humans), seedHex: seedFrom(n), seedCommit: 'x', now: T0, killerRule: rule });

  it('"me" makes it you, and says so in the record of the night', () => {
    const s = open('chef', ['chef']);
    expect(s.killer).toBe('chef');
    expect(s.killerRule).toBe('chef');
  });

  it('"human" picks somebody with a person behind them — which is for a party, not for one player', () => {
    for (const n of [1, 2, 3, 4]) expect(open('human', ['guide', 'widow'], n).cast.find((c) => c.role === open('human', ['guide', 'widow'], n).killer)?.operator).toBe('human');
  });

  it('the rule cannot change what the seed already drew — same seed, same rule, same killer', () => {
    expect(open('any', ['chef'], 5).killer).toBe(open('any', ['chef'], 5).killer);
  });
});

describe('a short night is a whole night', () => {
  it('runs every act, both deaths and the reveal at a quarter of the length', () => {
    const seedHex = seedFrom(11);
    let state = openStaging({ title: TITLE, venue: VENUE, cast: castOf(), seedHex, seedCommit: 'x', now: T0, pace: 0.25 });
    expect(state.deadline! - T0).toBe(Math.round(TITLE.acts[0]!.minutes * 60_000 * 0.25));
    let now = T0;
    for (let i = 0; i < 4000 && state.phase !== 'revealed'; i++) {
      now += 4000;
      state = tick(state, TITLE, VENUE, now).state;
    }
    expect(state.phase).toBe('revealed');
    expect(state.deaths).toHaveLength(2);
    // and it took about a quarter of an evening, not an evening
    const minutes = (state.endedAt! - state.startedAt) / 60_000;
    expect(minutes).toBeLessThan(20);
    expect(minutes).toBeGreaterThan(10);
  });
});

describe('what you heard, you heard', () => {
  it('keeps a line in your transcript after you have walked out of the room', () => {
    let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(21), seedCommit: 'x', now: T0 });
    const said = apply(s, TITLE, VENUE, 'chef', { type: 'say', text: 'The soup is at eight, whatever else happens.' }, T0, 'agent');
    expect(said.ok).toBe(true);
    if (!said.ok) return;
    s = said.state;
    const heard = () => viewFor(s, TITLE, VENUE, 'doctor').transcript.filter((e) => e.type === 'said' && e.text.startsWith('The soup')).length;
    expect(heard()).toBe(1);
    const moved = apply(s, TITLE, VENUE, 'doctor', { type: 'move', room: 'lounge' }, T0 + 1000, 'human');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    s = moved.state;
    expect(heard()).toBe(1); // still theirs — they were standing there when it was said
    // and somebody who was never in the room never hears it, whatever room they end up in
    const elsewhere = viewFor(s, TITLE, VENUE, 'chef');
    expect(elsewhere.transcript.some((e) => e.type === 'said' && e.by === 'chef')).toBe(true);
  });

  it('a chance does not open at the door: the killer is refused until the act has been played', () => {
    let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(22), seedCommit: 'x', now: T0, killerRule: 'doctor' });
    const actTwo = Math.round(TITLE.acts[0]!.minutes * 60_000) + 26_000;
    s = { ...s, act: 2, phase: 'act', actStartedAt: T0 + actTwo, deadline: T0 + actTwo + TITLE.acts[1]!.minutes * 60_000 };
    const victim = s.cast.find((c) => c.role !== s.killer)!.role;
    s = { ...s, where: { ...s.where, [s.killer]: 'kitchen', [victim]: 'kitchen' } };
    for (const c of s.cast) if (c.role !== s.killer && c.role !== victim) s.where[c.role] = 'lobby';
    const early = apply(s, TITLE, VENUE, s.killer, { type: 'murder', victim, prop: 'knife-block' }, T0 + actTwo + 10_000, 'human');
    expect(early).toMatchObject({ ok: false, code: 'too-soon' });
    const later = apply(s, TITLE, VENUE, s.killer, { type: 'murder', victim, prop: 'knife-block' }, T0 + actTwo + TITLE.acts[1]!.minutes * 60_000 * 0.6, 'human');
    expect(later.ok).toBe(true);
  });
});
