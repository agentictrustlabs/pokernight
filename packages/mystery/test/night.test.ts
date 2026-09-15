import { describe, expect, it } from 'vitest';
import { bytesToHex, seedCommit } from '@pokernight/deal';
import {
  ALPINE_BELVEDERE as VENUE, BELVEDERE_SNOWFALL as TITLE, apply, chooseAction, isDead, openStaging, redactEvent,
  tick, traitsOf, viewFor, type Casting, type MysteryState,
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
  it('runs from curtain-up to the reveal, with a killer, a death, and the night\'s evidence either way', () => {
    const { state } = playNight(1);
    expect(state.phase).toBe('revealed');
    expect(state.deaths.length).toBeGreaterThanOrEqual(1);
    expect(state.cast.map((c) => c.role)).toContain(state.killer);
    expect(state.deaths.some((d) => d.victim === state.killer)).toBe(false);
    // THE NIGHT GIVES UP ITS EVIDENCE EITHER WAY — two deaths, or one death and a room turned over — and
    // what it gives up is enough to name one person. (How MANY pieces that takes is the killer's own traits'
    // business: a part with three of them is named by three.)
    const pieces = [...state.deaths.flatMap((d) => d.evidence), ...state.traces.filter((t) => t.kind === 'spared').flatMap((t) => t.evidence)];
    expect(pieces.length).toBeGreaterThanOrEqual(TITLE.evidencePerDeath);
    const left = TITLE.roles.filter((r) => traitsOf(TITLE, pieces).every((t) => r.traits.includes(t))).map((r) => r.id);
    expect(left).toEqual([state.killer]);
  });

  it('replays byte-identically from the same seed', () => {
    const a = playNight(7).state;
    const b = playNight(7).state;
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });

  it('a different seed is a different night', () => {
    const killers = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => playNight(n).state.killer));
    expect(killers.size).toBeGreaterThan(1);
  }, 30_000);

  it('draws over the whole cast by default — a solo player must sometimes have a mystery to solve', () => {
    const killers = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => playNight(n, ['doctor']).state.killer));
    expect(killers.size).toBeGreaterThan(1);
  }, 30_000);

  it('the evidence the night produced still names exactly one person', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const { state } = playNight(n);
      const traits = [...state.deaths.flatMap((d) => d.evidence), ...state.traces.filter((t) => t.kind === 'spared').flatMap((t) => t.evidence)]
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
    // nobody acted at all in this one, so the killer took no chance and the night spared somebody
    expect(state.deaths).toHaveLength(1);
    expect(state.traces.filter((t) => t.kind === 'spared')).toHaveLength(1);
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

describe('a room that answers', () => {
  const lines = TITLE.roles.find((r) => r.id === 'concierge')!.lines;

  /** A view for the concierge, with one line just said to the room by somebody else. */
  const asked = (text: string) => {
    let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(31), seedCommit: 'x', now: T0 });
    const said = apply(s, TITLE, VENUE, 'doctor', { type: 'say', text }, T0 + 1000, 'human');
    if (said.ok) s = said.state;
    return viewFor(s, TITLE, VENUE, 'concierge');
  };

  /** Somebody in the room answers — exactly one of them, and every one of them agrees which. */
  const whoAnswers = (text: string) => {
    const view = asked(text);
    const answered = TITLE.roles
      .filter((r) => r.id !== 'doctor')
      .filter((r) => {
        const theirs = viewFor((() => { let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(31), seedCommit: 'x', now: T0 }); const said = apply(s, TITLE, VENUE, 'doctor', { type: 'say', text }, T0 + 1000, 'human'); if (said.ok) s = said.state; return s; })(), TITLE, VENUE, r.id);
        const m = chooseAction(theirs, r.lines, 3);
        return m?.action.type === 'say' && Object.values(r.lines).includes(m.action.text);
      })
      .map((r) => r.id);
    return { view, answered };
  };

  it('is answered by exactly one of the people in the room — never by a chorus', () => {
    const { answered } = whoAnswers('Where were you at nine, exactly?');
    expect(answered).toHaveLength(1);
  });

  it('answers an accusation differently from a greeting', () => {
    const a = whoAnswers('I think it was you, and I can prove it.');
    const b = whoAnswers('Good evening. Is there a drink to be had?');
    const lineOf = (who: string[], text: string) => {
      const role = TITLE.roles.find((r) => r.id === who[0])!;
      const m = chooseAction(asked(text), role.lines, 3);
      return m?.action.type === 'say' ? m.action.text : '';
    };
    // the same part, asked two different things, does not give the same answer
    if (a.answered[0] === b.answered[0]) expect(lineOf(a.answered, 'I think it was you, and I can prove it.')).not.toBe(lineOf(b.answered, 'Good evening. Is there a drink to be had?'));
    else expect(a.answered[0]).not.toBe(b.answered[0]);
  });

  it('does not answer the same line twice — it gets on with the night instead', () => {
    const { view, answered } = whoAnswers('Where were you at nine?');
    const role = TITLE.roles.find((r) => r.id === answered[0])!;
    const theirs = viewFor((() => { let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(31), seedCommit: 'x', now: T0 }); const said = apply(s, TITLE, VENUE, 'doctor', { type: 'say', text: 'Where were you at nine?' }, T0 + 1000, 'human'); if (said.ok) s = said.state; return s; })(), TITLE, VENUE, role.id);
    const first = chooseAction(theirs, role.lines, 3);
    expect(first?.action.type).toBe('say');
    if (first?.action.type !== 'say') return;
    const after = { ...theirs, transcript: [...theirs.transcript, { type: 'said' as const, at: T0 + 2000, by: role.id, room: 'lobby', text: first.action.text, via: 'agent' as const }] };
    expect(chooseAction(after, role.lines, 4)?.action.type).not.toBe('say');
    void view;
  });
});

describe('the only person playing is not the victim', () => {
  it('refuses a murder on the one human in the cast, and takes them out of the engine\'s own draw', () => {
    let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(41), seedCommit: 'x', now: T0, killerRule: 'chef' });
    s = { ...s, act: 2, phase: 'act', actStartedAt: T0 - 20 * 60_000, deadline: T0 + 60_000 };
    s = { ...s, where: { ...s.where, chef: 'kitchen', doctor: 'kitchen' } };
    for (const c of s.cast) if (c.role !== 'chef' && c.role !== 'doctor') s.where[c.role] = 'lobby';
    expect(apply(s, TITLE, VENUE, 'chef', { type: 'murder', victim: 'doctor', prop: 'knife-block' }, T0, 'human')).toMatchObject({ ok: false, code: 'the-only-player' });
    // and over a whole night, the player is never one of the two deaths
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const played = playNight(n, ['doctor']).state;
      expect(played.deaths.map((d) => d.victim)).not.toContain('doctor');
    }
  }, 30_000);

  it('but a party may kill a player — there is somebody left to fool', () => {
    let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor', 'widow']), seedHex: seedFrom(42), seedCommit: 'x', now: T0, killerRule: 'chef' });
    s = { ...s, act: 2, phase: 'act', actStartedAt: T0 - 20 * 60_000, deadline: T0 + 60_000 };
    s = { ...s, where: { ...s.where, chef: 'kitchen', doctor: 'kitchen' } };
    for (const c of s.cast) if (c.role !== 'chef' && c.role !== 'doctor') s.where[c.role] = 'lobby';
    expect(apply(s, TITLE, VENUE, 'chef', { type: 'murder', victim: 'doctor', prop: 'knife-block' }, T0, 'human').ok).toBe(true);
  });
});

describe('the killer\'s choices change the night', () => {
  const start = (killer: string) => {
    let s = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(51), seedCommit: 'x', now: T0, killerRule: killer });
    s = { ...s, act: 2, phase: 'act', actStartedAt: T0 - 20 * 60_000, deadline: T0 + 1000 };
    return s;
  };

  it('sparing somebody is allowed, and the night still gives up what the second death would have', () => {
    const s = start('chef');
    const after = tick(s, TITLE, VENUE, T0 + 2000).state;
    expect(after.deaths).toHaveLength(0);            // nothing was staged over the killer's choice
    expect(after.traces.filter((t) => t.kind === 'spared')).toHaveLength(1);
    const trace = after.traces[0]!;
    expect(trace.evidence).toHaveLength(TITLE.evidencePerDeath);
    expect(trace.room).toBe(TITLE.spared.room);
    // and it is findable: go there and search
    let s2: MysteryState = { ...after, act: 3, phase: 'act', where: { ...after.where, doctor: TITLE.spared.room } };
    const found = apply(s2, TITLE, VENUE, 'doctor', { type: 'search', room: TITLE.spared.room }, T0 + 3000, 'human');
    expect(found.ok).toBe(true);
    if (found.ok) { s2 = found.state; expect(s2.knows.doctor).toContain(trace.evidence[0]); }
  });

  it('the house says something else happened, rather than reading the line about a scream', () => {
    const after = tick(start('chef'), TITLE, VENUE, T0 + 2000);
    const cue = after.events.find((e) => e.type === 'cue');
    expect(cue?.type === 'cue' && cue.text).toBe(TITLE.spared.interlude);
    expect(after.events.some((e) => e.type === 'spared')).toBe(true);
  });

  it('lets the killer leave a trail that points somewhere else — once, and never at themselves', () => {
    let s = start('chef');
    s = { ...s, where: { ...s.where, chef: 'lounge' } };
    const mine = TITLE.roles.find((r) => r.id === 'chef')!.traits[0]!;
    expect(apply(s, TITLE, VENUE, 'chef', { type: 'plant', prop: 'drinks-tray', trait: mine }, T0, 'human')).toMatchObject({ ok: false, code: 'yours' });
    const notMine = 'scent:iris';
    const planted = apply(s, TITLE, VENUE, 'chef', { type: 'plant', prop: 'drinks-tray', trait: notMine }, T0, 'human');
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    s = planted.state;
    expect(s.traces.filter((t) => t.kind === 'planted')).toHaveLength(1);
    expect(apply(s, TITLE, VENUE, 'chef', { type: 'plant', prop: 'drinks-tray', trait: 'hands:ink' }, T0, 'human')).toMatchObject({ ok: false, code: 'enough' });
    // somebody else finds it, and the reveal names it for what it was
    let s3: MysteryState = { ...s, where: { ...s.where, doctor: 'lounge' } };
    const found = apply(s3, TITLE, VENUE, 'doctor', { type: 'search', room: 'lounge' }, T0 + 1000, 'human');
    expect(found.ok).toBe(true);
    if (found.ok) s3 = found.state;
    const revealed = viewFor({ ...s3, phase: 'revealed' }, TITLE, VENUE, 'doctor');
    expect(revealed.reveal?.planted.map((p) => p.trait)).toContain(notMine);
  });

  it('refuses a plant from anybody who is not the killer', () => {
    const s = start('chef');
    expect(apply(s, TITLE, VENUE, 'doctor', { type: 'plant', prop: 'drinks-tray', trait: 'scent:iris' }, T0, 'human')).toMatchObject({ ok: false, code: 'not-you' });
  });
});

describe('a night opened by an older engine', () => {
  it('still ticks, still applies, still views — a field added today is missing from every night opened yesterday', () => {
    const fresh = openStaging({ title: TITLE, venue: VENUE, cast: castOf(['doctor']), seedHex: seedFrom(61), seedCommit: 'x', now: T0 });
    // exactly what a Durable Object holds after a deploy that added a list
    const old = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>;
    delete old['traces'];
    const before = old as unknown as MysteryState;
    expect(() => tick(before, TITLE, VENUE, T0 + 60 * 60_000)).not.toThrow();
    const moved = apply(before, TITLE, VENUE, 'doctor', { type: 'move', room: 'lounge' }, T0 + 1000, 'human');
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.state.traces).toEqual([]);
    expect(() => viewFor(before, TITLE, VENUE, 'doctor')).not.toThrow();
  });
});
