/**
 * A CHARACTER PLAYED BY AN AGENT — on rules, from the view alone (docs/MYSTERY-NIGHT.md §10).
 *
 * This is the mystery's `@pokernight/canasta-agent`: a strategy that reasons from the SEAT'S OWN VIEW and
 * nothing else, so what it can do a person could do, and a night of eight of these runs headless in seconds.
 * The engine does not import it — a rules engine has no business knowing somebody wrote a policy for it.
 *
 * In P2 this is what an archetype at a Home replaces (`mystery.act`), one character at a time; until then it
 * is what makes a solo night a night at all, and it is how the title's own written lines get spoken.
 */
import type { MysteryAction, MysteryView, RoleId } from './types.js';

export interface CastLines { greet: string; probe: string; deny: string; accuse: string; mourn: string; found: string }

/** Deterministic per (role, act, tick) — so an all-agent staging replays exactly. */
function roll(seedish: string, n: number): number {
  let h = 2166136261 >>> 0;
  const s = `${seedish}:${n}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/**
 * What this character does next, and what it says while doing it.
 *
 * The order is the order a person would use: finish the night if it is time, take the chance if you are the
 * one taking chances, look at what is in front of you, tell somebody what you know, and otherwise go where
 * there is something to find. A character with nothing to do says nothing, which is a scene too.
 */
export function chooseAction(view: MysteryView, lines: CastLines, tick: number): { action: MysteryAction; line?: string } | null {
  const you = view.you;
  if (!you || !you.alive || view.phase === 'revealed') return null;
  const r = (n: number) => roll(`${you.role}:${view.act}:${tick}`, n);
  const room = view.room;
  // WHAT YOU HAVE JUST SAID, so you do not say it again. The transcript is in the view, which means a
  // character can hear itself — the cheapest cure there is for a room that loops on one line.
  const lately = view.transcript.filter((e) => e.type === 'said' && e.by === you.role).slice(-6).map((e) => (e.type === 'said' ? e.text : ''));
  const fresh = (kind: keyof CastLines, n: number): string | undefined => {
    const order: Array<keyof CastLines> = ['probe', 'greet', 'deny', 'mourn', 'accuse', 'found'];
    const start = Math.max(0, order.indexOf(kind));
    for (let i = 0; i < order.length; i++) {
      const k = order[(start + i + (n % order.length)) % order.length]!;
      if (!lately.includes(lines[k])) return lines[k];
    }
    return undefined;
  };

  // 1. The night is ending: name somebody, on what you have.
  if (view.phase === 'accusations' || (view.phase === 'act' && view.act >= 3 && tick % 5 === 4)) {
    if (!view.accusation || view.phase === 'accusations') {
      const against = suspect(view, you.role, r(1));
      if (against) return { action: { type: 'accuse', against, clues: view.clues.filter((c) => c.kind === 'evidence').map((c) => c.id).slice(0, 3) }, line: lines.accuse };
    }
  }
  if (view.phase !== 'act' || !room) return null;

  /**
   * SOMEBODY ASKED YOU SOMETHING. A room where you can say anything and nobody ever answers is a room of
   * mannequins, and it is the first thing a person notices. So: if the last thing said here was said by
   * somebody else, recently, and you have not spoken since, answer it — with the line of yours that fits
   * what they asked. A model does this better; nothing does it faster, and the words are the part's own.
   */
  const spoken = view.transcript.filter((e) => e.type === 'said');
  const last = spoken[spoken.length - 1];
  if (last && last.type === 'said' && last.by !== you.role && view.deadline !== null) {
    const mineAfter = spoken.some((e) => e.type === 'said' && e.by === you.role && e.at > last.at);
    const fresh10s = last.at > (view.transcript[view.transcript.length - 1]?.at ?? last.at) - 12_000;
    /**
     * ONE OF THEM ANSWERS, NOT ALL OF THEM. Seven characters each replying to the same question is a chorus,
     * which is worse than silence. Everybody in the room can see the same set of people, so everybody can
     * work out the same answer to "whose line is this" — the one whose name hashes nearest the words.
     */
    // …and never the person who just spoke, which is how "nobody answered" happened the first time.
    const inTheRoom = [you.role, ...room.people.map((p) => p.role)].filter((id) => id !== last.by).sort();
    const answerer = inTheRoom.map((id) => ({ id, n: roll(`${id}:${last.text}`, 0) })).sort((a, b) => a.n - b.n)[0]?.id;
    if (!mineAfter && fresh10s && answerer === you.role) {
      const q = last.text.toLowerCase();
      const kind: keyof CastLines =
        /where were you|were you|alibi|at nine|all evening|prove/.test(q) ? 'deny'
          : /who did|who killed|killer|murder|accuse|it was you|suspect/.test(q) ? 'accuse'
            : /found|clue|evidence|register|key|letter|print|wax|photograph/.test(q) ? 'found'
              : /dead|body|died|poor|kill/.test(q) ? 'mourn'
                : /hello|evening|hi |welcome|drink/.test(q) ? 'greet'
                  : 'probe';
      const text = fresh(kind, r(14)) ?? lines[kind];
      return { action: { type: 'say', text } };
    }
  }

  // 2. You are the one taking chances, and the room is empty but for one.
  if (you.killer && you.opportunity?.ready && room.people.length === 1 && room.people[0] && view.deaths.length < 2) {
    return { action: { type: 'murder', victim: room.people[0].role, prop: you.opportunity.prop } };
  }

  // 3. There is a body in this room and you have not finished looking at it.
  if (room.death && !room.death.searched) return { action: { type: 'search', room: room.id }, line: lines.found };

  // 4. Something in this room you have not looked at.
  const unseen = room.props.filter((p) => !p.examined);
  if (unseen.length) {
    const p = unseen[r(2) % unseen.length]!;
    return { action: { type: 'examine', prop: p.id }, line: r(3) % 3 === 0 ? fresh('probe', r(9)) : undefined };
  }

  // 5. Somebody is here and you know something they might not. The killer keeps the evidence to themselves.
  const mine = view.clues.filter((c) => !c.public && !(you.killer && c.kind === 'evidence'));
  if (room.people.length && mine.length && r(4) % 3 !== 0) {
    const c = mine[r(5) % mine.length]!;
    return { action: { type: 'share', clue: c.id }, line: fresh(c.kind === 'evidence' ? 'found' : 'probe', r(9)) };
  }

  // 6. Say something to whoever is here — and if you have nothing left to say that you have not already
  //    said, say nothing at all, which is what a person does.
  if (room.people.length && r(6) % 3 === 0) {
    const text = fresh(view.deaths.length ? 'mourn' : 'greet', r(10));
    if (text) return { action: { type: 'say', text } };
    // out of words: put somebody on the spot instead
    const who = room.people[r(11) % room.people.length]!;
    return { action: { type: 'testify', about: who.role, text: `${who.name} was not where they say they were.` } };
  }

  // 7. Otherwise go somewhere with something in it.
  const open = room.doors.filter((d) => d.open);
  if (open.length) {
    const d = open[r(7) % open.length]!;
    return { action: { type: 'move', room: d.id }, line: r(8) % 5 === 0 ? fresh('greet', r(12)) : undefined };
  }
  return { action: { type: 'say', text: view.deaths.length ? lines.mourn : lines.greet } };
}

/** Who this character blames: whoever the evidence they hold still allows, never themselves. */
function suspect(view: MysteryView, me: RoleId, r: number): RoleId | null {
  const others = view.cast.filter((c) => c.role !== me && c.alive).map((c) => c.role);
  if (!others.length) return null;
  return others[r % others.length] ?? null;
}
