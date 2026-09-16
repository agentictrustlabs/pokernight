/**
 * THE MYSTERY ENGINE — pure, seeded, replayable (docs/MYSTERY-NIGHT.md §6).
 *
 * THE ENGINE OWNS FACTS. Who the killer is, where a clue is, whether a murder was possible, whether an
 * accusation is right: decided here, deterministically, from a seed committed to before the night began.
 * The director service writes prose AROUND what this decides and can no more invent a clue than a coach
 * can invent a card.
 *
 * A CLUE IS A CARD. Private knowledge lives behind `viewFor` and `redactEvent`; an implementation that
 * broadcast the state and hid it in the client would not have implemented this, exactly as with hole cards.
 *
 * FACTS ARE THE ENGINE'S, CLAIMS ARE THE PLAYERS'. Testimony and alibis are recorded with a speaker and a
 * time and are never checked for truth. Lying is the game.
 */
import { hexToBytes, seededShuffle } from '@pokernight/deal';
import type {
  Applied, Casting, ClueDef, Death, KillerRule, Look, MysteryAction, MysteryEvent, MysteryState, MysteryView,
  Refusal, Role, RoleId, RoomId, Title, Venue, ViewPerson,
} from './types.js';

/** How long the house holds the room between acts. Long enough to read what happened, short enough to hurt. */
export const INTERLUDE_MS = 25_000;
/** An act's length: what the title authored, at the pace this night is running. */
export const actMs = (minutes: number, pace: number): number => Math.max(20_000, Math.round(minutes * 60_000 * pace));

const no = (code: string, reason: string): Refusal => ({ ok: false, code, reason });

/** When this act's chance opens: a while in, so the killing shapes the act rather than ending it at the door. */
export function chanceOpensAt(state: MysteryState, title: Title): number {
  const act = actOf(title, state.act);
  return state.actStartedAt + Math.round(actMs(act.minutes, state.pace) * Math.max(0, Math.min(0.9, title.murderAfter)));
}

export function roleOf(title: Title, id: RoleId): Role | undefined { return title.roles.find((r) => r.id === id); }
export function roomOf(venue: Venue, id: RoomId) { return venue.rooms.find((r) => r.id === id); }
export function actOf(title: Title, n: number) { return title.acts.find((a) => a.n === n) ?? title.acts[title.acts.length - 1]!; }
export function adjacent(venue: Venue, a: RoomId, b: RoomId): boolean {
  return venue.doors.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
export function isDead(state: MysteryState, role: RoleId): boolean { return state.deaths.some((d) => d.victim === role); }
export function aliveRoles(state: MysteryState): RoleId[] { return state.cast.map((c) => c.role).filter((r) => !isDead(state, r)); }
export function peopleIn(state: MysteryState, room: RoomId): RoleId[] {
  return aliveRoles(state).filter((r) => state.where[r] === room);
}
const clueOf = (title: Title, id: string): ClueDef | undefined => title.clues.find((c) => c.id === id);

/**
 * WHO IS STILL POSSIBLE, given the traits the deaths have given up.
 *
 * This is the whole solvability mechanism: evidence names a TRAIT, every part has traits, and the cast
 * narrows. It is also what a player does in their head, which is the point — the engine is not keeping a
 * secret the room could not have worked out.
 */
export function narrow(title: Title, traits: readonly string[]): RoleId[] {
  return title.roles.filter((r) => traits.every((t) => r.traits.includes(t))).map((r) => r.id);
}

/** The traits a set of evidence clues reveals. */
export function traitsOf(title: Title, clues: readonly string[]): string[] {
  return clues.map((id) => clueOf(title, id)).filter((c): c is Extract<ClueDef, { kind: 'evidence' }> => c?.kind === 'evidence').map((c) => c.trait);
}

/**
 * WHAT A DEATH GIVES UP — greedily, so a night always converges on one name.
 *
 * Of the killer's own traits, take the one that eliminates the most suspects, then the next. Deterministic
 * (ties break on the clue's own order in the title), so a staging replays, and `checkTitle` can prove ahead
 * of time that every possible killer is narrowed to exactly themselves.
 */
export function pickEvidence(title: Title, killer: RoleId, already: readonly string[], count: number): string[] {
  const k = roleOf(title, killer);
  if (!k) return [];
  const pool = title.clues.filter((c): c is Extract<ClueDef, { kind: 'evidence' }> => c.kind === 'evidence' && k.traits.includes(c.trait) && !already.includes(c.id));
  const chosen: string[] = [];
  const have = [...traitsOf(title, already)];
  for (let i = 0; i < count && pool.length; i++) {
    let best: { id: string; left: number } | null = null;
    for (const c of pool) {
      if (chosen.includes(c.id)) continue;
      const left = narrow(title, [...have, c.trait]).length;
      if (!best || left < best.left) best = { id: c.id, left };
    }
    if (!best) break;
    chosen.push(best.id);
    const cl = clueOf(title, best.id);
    if (cl?.kind === 'evidence') have.push(cl.trait);
  }
  return chosen;
}

/**
 * WILL THIS TITLE PLAY? Asked before anybody is cast, and its answer is a list of what is wrong.
 *
 * Three things, and a title that fails any of them does not ship: every room, door and prop it names exists
 * in the venue; every act opens rooms that exist; and for EVERY role that can be the killer, the traits its
 * deaths give up narrow the cast to exactly one person — that one. This is the mystery's "every hand
 * replays": the property that stops a narrated whodunnit becoming a mush nobody can solve.
 */
export function checkTitle(title: Title, venue: Venue): string[] {
  const bad: string[] = [];
  if (title.venue !== venue.id) bad.push(`title wants venue ${title.venue}, given ${venue.id}`);
  const rooms = new Set(venue.rooms.map((r) => r.id));
  const props = new Set(venue.rooms.flatMap((r) => r.props.map((p) => p.id)));
  for (const a of title.acts) for (const r of a.opens) if (!rooms.has(r)) bad.push(`act ${a.n} opens unknown room ${r}`);
  for (const a of title.acts) for (const o of a.opportunities ?? []) {
    if (!rooms.has(o.room)) bad.push(`act ${a.n} opportunity in unknown room ${o.room}`);
    if (!props.has(o.prop)) bad.push(`act ${a.n} opportunity on unknown prop ${o.prop}`);
  }
  if (!rooms.has(title.openingDeath.room)) bad.push(`opening death in unknown room ${title.openingDeath.room}`);
  for (const c of title.clues) if (c.kind === 'fact' && !props.has(c.prop)) bad.push(`clue ${c.id} hides behind unknown prop ${c.prop}`);
  for (const r of venue.rooms) if (!venue.doors.some(([a, b]) => a === r.id || b === r.id)) bad.push(`room ${r.id} has no door`);
  // the load-bearing one
  for (const r of title.roles.filter((x) => x.canBeKiller)) {
    const first = pickEvidence(title, r.id, [], title.evidencePerDeath);
    const second = pickEvidence(title, r.id, first, title.evidencePerDeath);
    const left = narrow(title, traitsOf(title, [...first, ...second]));
    if (left.length !== 1 || left[0] !== r.id) bad.push(`with ${r.id} as the killer the evidence leaves ${left.length ? left.join(', ') : 'nobody'}`);
  }
  return bad;
}

/** CURTAIN-UP: the cast is set, the seed is spent, the killer is drawn and nothing about it is ever re-decided. */
export function openStaging(args: {
  title: Title; venue: Venue; cast: Casting[]; seedHex: string; seedCommit: string; now: number;
  /** Stated BEFORE the seed is spent, so the commitment still proves nobody chose after the night began. */
  killerRule?: KillerRule;
  /** A multiplier on the title's act lengths; 1 is the evening it was written for. */
  pace?: number;
}): MysteryState {
  const { title, venue, cast, seedHex, seedCommit, now } = args;
  const killerRule: KillerRule = args.killerRule ?? 'any';
  const pace = Math.max(0.05, Math.min(2, args.pace ?? 1));
  const seed = hexToBytes(seedHex);
  const canKill = cast.filter((c) => roleOf(title, c.role)?.canBeKiller);
  const shuffled = seededShuffle(canKill, seed);
  /**
   * THE DRAW, UNDER THE RULE THE NIGHT DECLARED.
   *
   * `any` is the default and it is the one that makes a solo night a mystery: with a single player, always
   * preferring a person would mean you were the murderer every time and never once had a murder to solve.
   * A party declares `human` — somebody at the table ought to have to lie — and anybody may ask to be the
   * one. Either way the seed does the choosing among whoever the rule allows.
   */
  const killer = (
    killerRule === 'human' ? shuffled.find((c) => c.operator === 'human') ?? shuffled[0]
      : killerRule === 'any' ? shuffled[0]
        : shuffled.find((c) => c.role === killerRule) ?? shuffled[0]
  ) ?? cast[0]!;
  const act0 = actOf(title, 1);
  const where: Record<RoleId, RoomId> = {};
  const knows: Record<RoleId, string[]> = {};
  const examined: Record<RoleId, string[]> = {};
  for (const c of cast) { where[c.role] = act0.opens[0] ?? venue.spawn; knows[c.role] = []; examined[c.role] = []; }
  const state: MysteryState = {
    title: title.id, venue: venue.id, seedCommit, seedHex,
    cast, killer: killer.role, killerRule, pace, act: 1, actStartedAt: now, phase: 'act', deadline: now + actMs(act0.minutes, pace),
    where, knows, examined, publicClues: [], deaths: [], traces: [], claims: [], accusations: [], outcomes: [],
    log: [
      { type: 'cue', at: now, text: act0.opening, by: 'house' },
      { type: 'act', at: now, act: 1, phase: 'act', deadline: now + actMs(act0.minutes, pace) },
    ],
    startedAt: now, endedAt: null,
  };
  return state;
}

/**
 * A STATE WRITTEN BY AN OLDER ENGINE IS STILL A NIGHT.
 *
 * A staging outlives a deploy — it is a Durable Object holding JSON somebody is in the middle of playing —
 * so a field added today is missing from every night opened yesterday. `clone` is where every change to state
 * passes, which makes it the one place worth being forgiving: a missing list reads as empty rather than as
 * `undefined.map(...)`, which is what stopped a night dead the first time this file grew a field.
 */
const clone = (s: MysteryState): MysteryState => ({
  ...s,
  cast: (s.cast ?? []).slice(),
  where: { ...s.where }, knows: { ...s.knows }, examined: { ...s.examined },
  publicClues: (s.publicClues ?? []).slice(),
  deaths: (s.deaths ?? []).map((d) => ({ ...d, evidence: d.evidence.slice(), found: d.found.slice() })),
  traces: (s.traces ?? []).map((t) => ({ ...t, evidence: t.evidence.slice(), found: t.found.slice() })),
  claims: (s.claims ?? []).slice(), accusations: (s.accusations ?? []).slice(), log: (s.log ?? []).slice(),
});

/** The log is what everybody's transcript is filtered out of, so it is capped rather than unbounded. */
const LOG_CAP = 600;
function push(s: MysteryState, ...events: MysteryEvent[]): MysteryEvent[] {
  s.log = [...s.log, ...events].slice(-LOG_CAP);
  return events;
}

/** A death, with what it gives up. The only place evidence is ever created. */
function stageDeath(s: MysteryState, title: Title, victim: RoleId, room: RoomId, prop: string, now: number): MysteryEvent[] {
  const already = s.deaths.flatMap((d) => d.evidence);
  const evidence = pickEvidence(title, s.killer, already, title.evidencePerDeath);
  const death: Death = { victim, room, prop, act: s.act, evidence, found: [], at: now };
  s.deaths = [...s.deaths, death];
  return push(s, { type: 'died', at: now, victim, room, act: s.act });
}

/**
 * THE ONE PLAYER IS NOT THE VICTIM.
 *
 * A party can kill a player — they still talk, they still watch, and their death is somebody's problem to
 * explain. A SOLO night cannot: the only person in it would spend the rest of the evening reading a
 * transcript of agents. So with one human in the cast, that human is not available to be murdered — by the
 * engine's own choice or by an agent killer's.
 */
export function mayBeKilled(s: MysteryState, victim: RoleId): boolean {
  const humans = s.cast.filter((c) => c.operator === 'human');
  return !(humans.length === 1 && humans[0]?.role === victim);
}

/** Who dies, when the engine is the one choosing: never the killer, and never a person if an agent will do. */
function chooseVictim(s: MysteryState, title: Title, preferRoom?: RoomId): RoleId | null {
  const seed = hexToBytes(s.seedHex ?? '00');
  const pool = aliveRoles(s).filter((r) => r !== s.killer && mayBeKilled(s, r));
  if (!pool.length) return null;
  const inRoom = preferRoom ? pool.filter((r) => s.where[r] === preferRoom) : [];
  const order = seededShuffle(inRoom.length ? inRoom : pool, seed);
  return order.find((r) => s.cast.find((c) => c.role === r)?.operator === 'agent') ?? order[0] ?? null;
}

/**
 * THE CLOCK — acts, interludes, accusations, the reveal.
 *
 * Called by the host whenever it wakes; pure, and idempotent before the deadline. The host owns the alarm,
 * the engine owns what happens when it goes off, exactly as at a table.
 */
export function tick(state: MysteryState, title: Title, venue: Venue, now: number): { state: MysteryState; events: MysteryEvent[] } {
  if (state.phase === 'revealed' || state.deadline === null || now < state.deadline) return { state, events: [] };
  const s = clone(state);
  const events: MysteryEvent[] = [];
  const act = actOf(title, s.act);
  if (s.phase === 'act') {
    s.phase = 'interlude';
    s.deadline = now + INTERLUDE_MS;
    // A SPARED ACT IS A DIFFERENT SCENE, and the house says so rather than reading the line about a scream.
    const spared = s.act === 2 && s.deaths.length < 2;
    events.push(...push(s, { type: 'cue', at: now, text: spared ? title.spared.interlude : act.interlude, by: 'house' }));
    // The night's deaths happen at the interludes: the first is the engine's, the second is the killer's —
    // and if the killer did not take it, the engine stages what they did not, so the mystery still has one.
    if (s.act === 1 && !s.deaths.length) {
      const victim = chooseVictim(s, title);
      if (victim) events.push(...stageDeath(s, title, victim, title.openingDeath.room, title.openingDeath.prop, now));
    } else if (s.act === 2 && s.deaths.length < 2) {
      /**
       * THE KILLER SPARED SOMEBODY, and the night is theirs to change. Nothing is staged over the top of that
       * choice — but the evidence the second death would have given up turns up anyway, somewhere the title
       * named, because a mystery nobody can solve is not a kindness to anybody.
       */
      const already = s.deaths.flatMap((d) => d.evidence);
      const evidence = pickEvidence(title, s.killer, already, title.evidencePerDeath);
      s.traces = [...(s.traces ?? []), { room: title.spared.room, prop: title.spared.prop, act: s.act, evidence, found: [], at: now, kind: 'spared' }];
      events.push(...push(s, { type: 'spared', at: now, room: title.spared.room, act: s.act }));
    }
    events.push(...push(s, { type: 'act', at: now, act: s.act, phase: s.phase, deadline: s.deadline }));
    return { state: s, events };
  }
  if (s.phase === 'interlude') {
    if (s.act >= title.acts.length) {
      s.phase = 'accusations';
      s.deadline = now + actMs(title.accusationMinutes, s.pace);
    } else {
      s.act += 1;
      s.phase = 'act';
      s.actStartedAt = now;
      const next = actOf(title, s.act);
      s.deadline = now + actMs(next.minutes, s.pace);
      // A room the act has not opened is a room nobody is standing in: everyone still in one is moved.
      for (const r of aliveRoles(s)) if (!next.opens.includes(s.where[r] ?? '')) s.where[r] = next.opens[0] ?? venue.spawn;
      events.push(...push(s, { type: 'cue', at: now, text: next.opening, by: 'house' }));
    }
    events.push(...push(s, { type: 'act', at: now, act: s.act, phase: s.phase, deadline: s.deadline }));
    return { state: s, events };
  }
  // accusations → the reveal
  s.phase = 'revealed';
  s.endedAt = now;
  s.deadline = null;
  events.push(...push(s, { type: 'revealed', at: now, killer: s.killer, seed: s.seedHex ?? '' }));
  return { state: s, events };
}

/** One character does one thing. The game validates its own actions; the host never guesses at legality. */
export function apply(state: MysteryState, title: Title, venue: Venue, role: RoleId, action: MysteryAction, now: number, via: 'human' | 'agent' = 'human'): Applied {
  if (state.phase === 'revealed') return no('night-over', 'The night is over.');
  if (!state.cast.some((c) => c.role === role)) return no('not-cast', 'You are not in this story.');
  if (isDead(state, role) && action.type !== 'say') return no('dead', 'You are dead. You may still be heard, which is generous.');
  const here = state.where[role];
  if (!here) return no('nowhere', 'You are not anywhere.');
  const act = actOf(title, state.act);
  const s = clone(state);
  const events: MysteryEvent[] = [];

  switch (action.type) {
    /**
     * CHANGING YOUR CLOTHES IS NOT AN EVENT (2026-09-15).
     *
     * It changes nothing anybody can deduce from, so it writes no event and costs no time — but it is on the
     * STATE rather than in a browser, because what you are wearing is the one thing about you that everybody
     * in the room can see. You may only wear your OWN part's wardrobe: a free colour picker would let the
     * concierge turn up in the heiress's furs, and half of a mystery is telling people apart.
     */
    /**
     * A CHOICE, TAKEN (2026-09-16). Only a choice written for YOUR part; only once; only in or after the act
     * it opens. It sets an OUTCOME — a mutable fact the night carries from here — and writes an event whose
     * words are the consequence's own, heard by whoever is in the room. It touches no canon: nothing here can
     * reach the culprit, the backstory or the evidence, because nothing here reads them.
     */
    case 'choose': {
      const mine = roleOf(title, role);
      const ch = (mine?.choices ?? []).find((c) => c.id === action.choice);
      if (!ch) return no('not-yours', 'That is not a choice written for you.');
      if (s.act < ch.act) return no('not-yet', 'That is not before you yet.');
      if ((s.outcomes ?? []).some((o) => o.by === role && o.choice === ch.id)) return no('chosen', 'You have already chosen.');
      const opt = ch.options.find((o) => o.id === action.option);
      if (!opt) return no('bad-action', 'Not one of the options.');
      s.outcomes = [...(s.outcomes ?? []), { key: opt.outcome, by: role, choice: ch.id, option: opt.id, at: now }];
      events.push({ type: 'chose', at: now, by: role, choice: ch.id, option: opt.id, outcome: opt.outcome, text: opt.consequence, room: here, saw: peopleIn(s, here) });
      s.log = [...s.log, ...events];
      return { ok: true, state: s, events };
    }
    case 'dress': {
      const mine = roleOf(title, role);
      const owns = (mine?.look.wardrobe ?? []).some((w) => w.id === action.outfit);
      if (!owns) return no('not-yours', 'That is not one of yours to wear.');
      const c = s.cast.find((x) => x.role === role);
      if (!c) return no('not-cast', 'You are not in this story.');
      c.outfit = action.outfit;
      return { ok: true, state: s, events };
    }
    case 'move': {
      if (s.phase !== 'act') return no('not-now', 'Nobody is walking anywhere just now.');
      if (!act.opens.includes(action.room)) return no('closed', 'That part of the hotel is not open.');
      if (!adjacent(venue, here, action.room)) return no('no-door', 'There is no door from here to there.');
      const witnesses = [...new Set([role, ...peopleIn(s, here), ...peopleIn(s, action.room)])];
      s.where[role] = action.room;
      events.push(...push(s, { type: 'moved', at: now, who: role, from: here, to: action.room, saw: witnesses }));
      break;
    }
    case 'say': {
      const text = action.text.trim().slice(0, 280);
      if (!text) return no('empty', 'Say something.');
      events.push(...push(s, { type: 'said', at: now, by: role, room: here, text, via, saw: peopleIn(s, here) }));
      break;
    }
    case 'whisper': {
      if (!peopleIn(s, here).includes(action.to)) return no('not-here', 'They are not in this room.');
      const text = action.text.trim().slice(0, 280);
      if (!text) return no('empty', 'Say something.');
      events.push(...push(s, { type: 'whispered', at: now, by: role, to: action.to, room: here, text }));
      break;
    }
    case 'examine': {
      const room = roomOf(venue, here);
      if (!room?.props.some((p) => p.id === action.prop)) return no('not-here', 'That is not in this room.');
      s.examined[role] = [...(s.examined[role] ?? []), action.prop].filter((v, i, a) => a.indexOf(v) === i);
      const clue = title.clues.find((c) => c.kind === 'fact' && c.prop === action.prop && c.act <= s.act && !(s.knows[role] ?? []).includes(c.id));
      if (!clue) return no('nothing-more', 'Nothing there you have not already seen.');
      s.knows[role] = [...(s.knows[role] ?? []), clue.id];
      events.push(...push(s, { type: 'found', at: now, who: role, clue: clue.id, room: here }));
      break;
    }
    case 'search': {
      if (action.room !== here) return no('not-here', 'You would have to be in there.');
      // A BODY OR A ROOM TURNED OVER — both are things a room has to give up, and both are searched the same.
      const death = s.deaths.find((d) => d.room === here);
      const trace = (s.traces ?? []).find((t) => t.room === here);
      const mine = s.knows[role] ?? [];
      const fromDeath = death?.evidence.find((id) => !mine.includes(id));
      const fromTrace = trace?.evidence.find((id) => !mine.includes(id));
      if (!death && !trace) return no('nothing-here', 'There is nothing in this room to search.');
      const next = fromDeath ?? fromTrace;
      if (!next) return no('nothing-more', 'You have found everything this room has.');
      s.knows[role] = [...mine, next];
      if (fromDeath && death) s.deaths = s.deaths.map((d) => (d === death ? { ...d, found: d.found.includes(next) ? d.found : [...d.found, next] } : d));
      else if (trace) s.traces = (s.traces ?? []).map((t) => (t === trace ? { ...t, found: t.found.includes(next) ? t.found : [...t.found, next] } : t));
      events.push(...push(s, { type: 'found', at: now, who: role, clue: next, room: here }));
      break;
    }
    case 'share': {
      if (!(s.knows[role] ?? []).includes(action.clue)) return no('not-yours', 'You do not have that.');
      const to = action.to ?? null;
      if (to && !peopleIn(s, here).includes(to)) return no('not-here', 'They are not in this room.');
      const recipients = to ? [to] : peopleIn(s, here).filter((r) => r !== role);
      for (const r of recipients) if (!(s.knows[r] ?? []).includes(action.clue)) s.knows[r] = [...(s.knows[r] ?? []), action.clue];
      if (!to && !s.publicClues.includes(action.clue)) s.publicClues = [...s.publicClues, action.clue];
      events.push(...push(s, { type: 'shared', at: now, by: role, to, clue: action.clue, room: here, saw: to ? [role, to] : peopleIn(s, here) }));
      break;
    }
    case 'testify':
    case 'alibi': {
      const about = action.type === 'alibi' ? action.for : action.about;
      if (!s.cast.some((c) => c.role === about)) return no('who', 'Nobody of that name.');
      const text = action.type === 'alibi'
        ? `${roleOf(title, about)?.name ?? about} was with me.`
        : action.text.trim().slice(0, 280);
      if (!text) return no('empty', 'Say what you saw.');
      // A CLAIM IS A CLAIM. Nothing checks it, and nothing ever will: lying is the game.
      s.claims = [...s.claims, { by: role, kind: action.type === 'alibi' ? 'alibi' : 'testimony', about, text, at: now }];
      events.push(...push(s, { type: 'claimed', at: now, by: role, kind: action.type === 'alibi' ? 'alibi' : 'testimony', about, text, room: here, saw: peopleIn(s, here) }));
      break;
    }
    case 'accuse': {
      const lastAct = s.act >= title.acts.length && s.phase === 'act';
      if (!lastAct && s.phase !== 'accusations') return no('too-early', 'Not yet. Find something first.');
      if (!s.cast.some((c) => c.role === action.against)) return no('who', 'Nobody of that name.');
      if (action.against === role) return no('yourself', 'Confessing is not accusing.');
      const clues = action.clues.filter((c) => (s.knows[role] ?? []).includes(c));
      s.accusations = [...s.accusations.filter((a) => a.by !== role), { by: role, against: action.against, clues, at: now }];
      events.push(...push(s, { type: 'accused', at: now, by: role, against: action.against, clues, room: s.phase === 'accusations' ? null : here, saw: peopleIn(s, here) }));
      break;
    }
    case 'murder': {
      if (role !== s.killer) return no('not-you', 'You are not that sort of person.');
      if (s.phase !== 'act') return no('not-now', 'Not with everyone watching the clock.');
      if (s.deaths.length >= 2) return no('enough', 'Two is enough for one night.');
      const chance = (act.opportunities ?? []).find((o) => o.room === here && o.prop === action.prop);
      if (!chance) return no('no-chance', 'Not here, and not with that.');
      if (now < chanceOpensAt(s, title)) return no('too-soon', 'Not yet. The night is young and everybody is still counting heads.');
      const present = peopleIn(s, here);
      if (!present.includes(action.victim)) return no('not-here', 'They are not in this room.');
      if (!mayBeKilled(s, action.victim)) return no('the-only-player', 'Not the only person playing tonight — there would be nobody left to fool.');
      if (present.length !== 2) return no('not-alone', 'Not while somebody else is in the room.');
      events.push(...stageDeath(s, title, action.victim, here, action.prop, now));
      break;
    }
    case 'plant': {
      /**
       * THE KILLER'S OTHER HAND. A trail that points somewhere it should not is a lie told in objects, and it
       * is the one thing the killer can leave that the engine did not decide. It cannot point at themselves,
       * it must be a trait the title made plantable, and it is NAMED at the reveal — a mystery has to be
       * solvable by somebody who found everything, so a planted trail is noise that can be seen through.
       */
      if (role !== s.killer) return no('not-you', 'You have nothing to plant.');
      if (s.phase !== 'act') return no('not-now', 'Not with everyone watching the clock.');
      const kit = title.plantable;
      if (!kit) return no('nothing-to-plant', 'There is nothing here to leave.');
      if (!kit.props.includes(action.prop)) return no('not-there', 'Not somewhere anybody would look.');
      const room = roomOf(venue, here);
      if (!room?.props.some((p) => p.id === action.prop)) return no('not-here', 'That is not in this room.');
      if (!kit.traits.includes(action.trait)) return no('not-that', 'Nothing here would suggest that.');
      const me = roleOf(title, role);
      if (me?.traits.includes(action.trait)) return no('yours', 'That points at you, which is the opposite of the idea.');
      const clue = title.clues.find((c) => c.kind === 'evidence' && c.trait === action.trait);
      if (!clue) return no('not-that', 'Nothing here would suggest that.');
      if ((s.traces ?? []).some((t) => t.kind === 'planted' && t.by === role)) return no('enough', 'One trail is a lie; two is a pattern.');
      s.traces = [...(s.traces ?? []), { room: here, prop: action.prop, act: s.act, evidence: [clue.id], found: [], at: now, kind: 'planted', by: role }];
      // You know what you left — it is your own lie, and you will want to remember whose door it is at.
      s.knows[role] = [...(s.knows[role] ?? []), clue.id];
      events.push(...push(s, { type: 'planted', at: now, by: role, clue: clue.id, room: here }));
      break;
    }
    default:
      return no('unknown', 'That is not a thing anybody can do.');
  }
  return { ok: true, state: s, events };
}

/** Read an action off the wire. The GAME validates its own shape — the host parses nothing. */
export function parseAction(raw: unknown): { ok: true; action: MysteryAction } | Refusal {
  const r = raw as Partial<MysteryAction> & { type?: string };
  const str = (v: unknown, max = 280) => (typeof v === 'string' && v.length <= max ? v : null);
  switch (r?.type) {
    case 'move': return str((r as { room?: string }).room, 64) ? { ok: true, action: { type: 'move', room: (r as { room: string }).room } } : no('bad-action', 'move needs a room');
    case 'say': return str((r as { text?: string }).text) ? { ok: true, action: { type: 'say', text: (r as { text: string }).text } } : no('bad-action', 'say needs words');
    case 'whisper': return str((r as { to?: string }).to, 64) && str((r as { text?: string }).text) ? { ok: true, action: { type: 'whisper', to: (r as { to: string }).to, text: (r as { text: string }).text } } : no('bad-action', 'whisper needs somebody and words');
    case 'examine': return str((r as { prop?: string }).prop, 64) ? { ok: true, action: { type: 'examine', prop: (r as { prop: string }).prop } } : no('bad-action', 'examine needs a thing');
    case 'search': return str((r as { room?: string }).room, 64) ? { ok: true, action: { type: 'search', room: (r as { room: string }).room } } : no('bad-action', 'search needs a room');
    case 'share': return str((r as { clue?: string }).clue, 64) ? { ok: true, action: { type: 'share', clue: (r as { clue: string }).clue, ...(str((r as { to?: string }).to, 64) ? { to: (r as { to: string }).to } : {}) } } : no('bad-action', 'share needs a clue');
    case 'testify': return str((r as { about?: string }).about, 64) && str((r as { text?: string }).text) ? { ok: true, action: { type: 'testify', about: (r as { about: string }).about, text: (r as { text: string }).text } } : no('bad-action', 'testify needs somebody and words');
    case 'alibi': return str((r as { for?: string }).for, 64) ? { ok: true, action: { type: 'alibi', for: (r as { for: string }).for } } : no('bad-action', 'alibi needs somebody');
    case 'dress': return str((r as { outfit?: string }).outfit, 64) ? { ok: true, action: { type: 'dress', outfit: (r as { outfit: string }).outfit } } : no('bad-action', 'dressing needs an outfit');
    case 'choose': return str((r as { choice?: string }).choice, 64) && str((r as { option?: string }).option, 64) ? { ok: true, action: { type: 'choose', choice: (r as { choice: string }).choice, option: (r as { option: string }).option } } : no('bad-action', 'choosing needs a choice and an option');
    case 'accuse': return str((r as { against?: string }).against, 64) ? { ok: true, action: { type: 'accuse', against: (r as { against: string }).against, clues: Array.isArray((r as { clues?: unknown }).clues) ? ((r as { clues: unknown[] }).clues.filter((c) => typeof c === 'string') as string[]) : [] } } : no('bad-action', 'accuse needs somebody');
    case 'murder': return str((r as { victim?: string }).victim, 64) && str((r as { prop?: string }).prop, 64) ? { ok: true, action: { type: 'murder', victim: (r as { victim: string }).victim, prop: (r as { prop: string }).prop } } : no('bad-action', 'murder needs somebody and something');
    case 'plant': return str((r as { prop?: string }).prop, 64) && str((r as { trait?: string }).trait, 64) ? { ok: true, action: { type: 'plant', prop: (r as { prop: string }).prop, trait: (r as { trait: string }).trait } } : no('bad-action', 'planting needs something and somewhere');
    default: return no('bad-action', 'not an action anybody can take');
  }
}

/**
 * THE SAME EVENT AS ONE CHARACTER MAY SEE IT, or null if they may not see it at all.
 *
 * Presence in the room is what most of it turns on; a clue somebody found is theirs alone. This is the
 * method that stands between a player and somebody else's knowledge — the hole-card rule, for a story.
 */
export function redactEvent(state: MysteryState, ev: MysteryEvent, role: RoleId | null): MysteryEvent | null {
  const here = role ? state.where[role] : null;
  // WHO WAS THERE AT THE TIME, when the event recorded it. Falling back to "where they are now" is what an
  // old event has to be judged by, and it is why `saw` exists at all.
  const witnessed = (e: MysteryEvent & { saw?: RoleId[]; room?: RoomId | null }): boolean => {
    if (role === null) return true;
    if (e.saw) return e.saw.includes(role);
    return e.room === here;
  };
  switch (ev.type) {
    case 'cue': case 'act': case 'died': case 'revealed': return ev;
    case 'found': return ev.who === role ? ev : null;
    case 'planted': return ev.by === role ? ev : null;
    case 'whispered': return role && (ev.by === role || ev.to === role) ? ev : null;
    case 'moved': return role === null || ev.who === role || witnessed(ev) ? ev : null;
    case 'accused': return ev.room === null || role === null || ev.by === role || witnessed(ev) ? ev : null;
    case 'chose': return role === null || ev.by === role || witnessed(ev) ? ev : null;
    case 'said': case 'shared': case 'claimed': return role === null || ev.by === role || witnessed(ev) ? ev : null;
    default: return null;
  }
}

/** The part's look with the outfit they have changed into, when it is one of their own. */
function dressed(look: Look, outfit?: string): Look {
  if (!outfit) return look;
  const w = (look.wardrobe ?? []).find((x) => x.id === outfit);
  return w ? { ...look, wear: w.wear, accent: w.accent } : look;
}

function personView(state: MysteryState, title: Title, role: RoleId): ViewPerson {
  const c = state.cast.find((x) => x.role === role);
  const r = roleOf(title, role);
  return {
    role, name: r?.name ?? role,
    operator: c?.operator ?? 'agent', agent: c?.agent ?? '',
    alive: !isDead(state, role),
    ...(r?.appearance ? { appearance: r.appearance } : {}),
    // WHAT THEY ARE WEARING TONIGHT: the title's own dress, with whichever of the part's outfits they have
    // changed into laid over it. Nobody sees a look that is not one of that part's own.
    look: dressed(r?.look ?? { skin: '#d8b08a', hair: '#3b2f2a', wear: '#2b333a', accent: '#5b6b74', hairStyle: 'short' }, c?.outfit),
    ...(c?.mind ? { mind: c.mind } : {}),
    // A character a PERSON plays says whose voice it is — that is how a huddle's audio finds its body, and
    // it is no secret: their name is on the cast list before the curtain goes up.
    ...(c?.operator === 'human' && c.name ? { playedBy: c.name } : {}),
  };
}

/** The staging as one character sees it — or, for `null`, as somebody watching from outside the story. */
export function viewFor(state: MysteryState, title: Title, venue: Venue, role: RoleId | null): MysteryView {
  const act = actOf(title, state.act);
  const me = role ? roleOf(title, role) : undefined;
  const here = role ? state.where[role] ?? null : null;
  const room = here ? roomOf(venue, here) : undefined;
  const death = here ? state.deaths.find((d) => d.room === here) : undefined;
  const trace = here ? (state.traces ?? []).find((t) => t.room === here) : undefined;
  const known = role ? state.knows[role] ?? [] : state.publicClues;
  const revealed = state.phase === 'revealed';
  const opp = role === state.killer ? (act.opportunities ?? []).find((o) => o.room === here) : undefined;
  const oppProp = opp ? roomOf(venue, opp.room)?.props.find((p) => p.id === opp.prop) : undefined;
  // What the killer could leave here, and whose trail it would look like.
  const kit = role === state.killer ? title.plantable : undefined;
  const plantProp = kit && room ? room.props.find((p) => kit.props.includes(p.id)) : undefined;
  const mine = role ? roleOf(title, role)?.traits ?? [] : [];
  const plantOptions = kit && plantProp
    ? kit.traits.filter((t) => !mine.includes(t)).map((t) => ({
        trait: t,
        text: title.clues.find((c) => c.kind === 'evidence' && c.trait === t)?.text ?? t,
        points: title.roles.filter((r) => r.traits.includes(t)).map((r) => ({ role: r.id, name: r.name })),
      })).filter((o) => o.points.length)
    : [];
  return {
    title: title.id, titleName: title.name, venue: venue.id,
    act: state.act, actName: act.name, objective: act.objective, pace: state.pace,
    phase: state.phase, deadline: state.deadline, seedCommit: state.seedCommit,
    you: me && role ? {
      // DRESSED THE SAME WAY EVERYBODY ELSE SEES YOU: your own half of the view took the title's look straight,
      // so changing your clothes changed you for the room and not in your own mirror.
      role, name: me.name, blurb: me.blurb, secret: me.secret, alive: !isDead(state, role),
      look: dressed(me.look, state.cast.find((c) => c.role === role)?.outfit),
      killer: role === state.killer,
      ...(opp && oppProp ? { opportunity: { room: opp.room, prop: opp.prop, propName: oppProp.name, ready: Date.now() >= chanceOpensAt(state, title), readyAt: chanceOpensAt(state, title) } } : {}),
      ...(plantProp && plantOptions.length
        ? { plant: { prop: plantProp.id, propName: plantProp.name, used: (state.traces ?? []).some((t) => t.kind === 'planted' && t.by === role), options: plantOptions } }
        : {}),
    } : null,
    room: room && here ? {
      id: here, name: room.name, blurb: room.blurb,
      people: peopleIn(state, here).filter((r) => r !== role).map((r) => personView(state, title, r)),
      props: room.props.map((p) => ({ id: p.id, name: p.name, examined: (role ? state.examined[role] ?? [] : []).includes(p.id), ...(p.detail ? { detail: p.detail } : {}) })),
      doors: venue.rooms.filter((r) => adjacent(venue, here, r.id)).map((r) => ({ id: r.id, name: r.name, open: act.opens.includes(r.id) })),
      death: death ? { victim: death.victim, searched: death.evidence.every((id) => known.includes(id)) } : null,
      trace: trace ? { searched: trace.evidence.every((id) => known.includes(id)) } : null,
    } : null,
    cast: state.cast.map((c) => personView(state, title, c.role)),
    rooms: venue.rooms.map((r) => ({ id: r.id, name: r.name })),
    clues: known.map((id) => clueOf(title, id)).filter((c): c is ClueDef => !!c).map((c) => ({ id: c.id, kind: c.kind, text: c.text, public: state.publicClues.includes(c.id) })),
    deaths: state.deaths.map((d) => ({ victim: d.victim, victimName: roleOf(title, d.victim)?.name ?? d.victim, room: d.room, roomName: roomOf(venue, d.room)?.name ?? d.room, act: d.act })),
    transcript: state.log.map((e) => redactEvent(state, e, role)).filter((e): e is MysteryEvent => !!e),
    /** THE NIGHT'S OUTCOMES so far — mutable facts choices have set, public to everybody (the consequence was said in a room; the fact of it is the night's). */
    outcomes: (state.outcomes ?? []).map((o) => ({ key: o.key, by: o.by })),
    /** THE CHOICES BEFORE YOU: written for your part, open in this act, not yet taken. */
    choices: role ? (roleOf(title, role)?.choices ?? []).filter((c) => state.act >= c.act && !(state.outcomes ?? []).some((o) => o.by === role && o.choice === c.id)).map((c) => ({ id: c.id, question: c.question, options: c.options.map((o) => ({ id: o.id, label: o.label })) })) : [],
    accusation: (() => { const a = role ? state.accusations.find((x) => x.by === role) : undefined; return a ? { against: a.against, clues: a.clues } : null; })(),
    reveal: revealed ? {
      killer: state.killer, killerName: roleOf(title, state.killer)?.name ?? state.killer, seed: state.seedHex ?? '', rule: state.killerRule,
      spared: state.deaths.length < 2,
      planted: (state.traces ?? []).filter((t) => t.kind === 'planted').flatMap((t) => t.evidence.map((id) => ({ clue: id, trait: traitsOf(title, [id])[0] ?? '' }))),
      correct: state.accusations.filter((a) => a.against === state.killer).map((a) => a.by),
      fooled: state.accusations.filter((a) => a.against !== state.killer).map((a) => ({ by: a.by, against: a.against })),
      missed: [
        ...state.deaths.flatMap((d) => d.evidence.filter((id) => !d.found.includes(id))),
        ...(state.traces ?? []).filter((t) => t.kind === 'spared').flatMap((t) => t.evidence.filter((id) => !t.found.includes(id))),
      ],
    } : null,
  };
}
