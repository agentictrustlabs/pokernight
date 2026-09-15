/**
 * MYSTERY NIGHT'S HOST — one Durable Object per staging (docs/MYSTERY-NIGHT.md §7).
 *
 * A PLACE HOSTS A STORY; it does not know which. This object holds a staging's state as the ENGINE's and
 * asks `@pokernight/mystery` for everything it needs: what an action means, what each character may see,
 * when an act ends. It is the table object's sibling — an append-only log, an alarm for the clock, a view
 * per participant — and it has no seats, no turn queue and no money at all.
 *
 * THE CHARACTERS NOBODY IS PLAYING are driven from here on the engine's own rules policy, held back by a
 * pace so a room of seven does not speak inside one second (the table's `AGENT_PACE_MS`, for a scene). In
 * P2 each of those calls becomes that character's own agent answering `mystery.act` at its Home; nothing
 * about this object changes when it does.
 *
 * NOBODY LOOKING, NOTHING HAPPENS: the clock and the cast only run while a socket is open, so a staging
 * left behind stops where it stands instead of narrating an empty hotel to itself.
 */
import { DurableObject } from 'cloudflare:workers';
import { bytesToHex, randomSeed, seedCommit } from '@pokernight/deal';
import {
  apply, CHARACTER_CRAFT, chooseAction, DIRECTOR_CRAFT, isDead, openStaging, parseAction, stagingOf, tick, viewFor,
  type Casting, type MysteryEvent, type MysteryState, type MysteryView, type RoleId,
} from '@pokernight/mystery';
import { MYSTERY_DIRECT_SKILL } from '@pokernight/protocol';
import { askCharacter, askDirector } from './mystery-a2a.js';
import { a2aTimeoutMs } from './a2a.js';
import { mysteryCastAgents, mysteryDirector, type Env } from './env.js';
import { MYSTERY_ACT_SKILL } from '@pokernight/protocol';

interface Attachment { playerId: string; name: string }
interface Meta {
  stagingId: string; owner: string; ownerName: string; title: string; role: RoleId; pace?: 'short' | 'full';
  /** A CLUB'S NIGHT rather than a night of your own: who may take a part is the club's roster, and it waits
   *  in `casting` until the host says the curtain is up. A solo night has neither. */
  club?: string; night?: string; casting?: boolean;
  /**
   * WHO DIRECTS. An agent, by name — the agent of whoever's night this is, or a service they name. The house
   * spends no tokens, so the prose is thought for at somebody's own Home and costs them; a director that does
   * not answer in the shape, or does not answer at all, leaves the title's own written line standing.
   */
  director?: string;
}

/** How long a character played by an agent is held back, so the room can read what it said. */
const PACE_MS = 3_200;
/** The wake-up between ticks while somebody is here. */
const TICK_MS = 1_600;

export class MysteryDO extends DurableObject<Env> {
  private state: MysteryState | null = null;
  private meta: Meta | null = null;
  private paused = false;
  private pausedAt = 0;
  private lastMoved: Record<string, number> = {};
  /** Who has taken which part while a club's night is casting. Empty for a night of your own. */
  private taken: Record<string, { role: RoleId; name: string }> = {};
  /** Characters whose agent is mid-thought, so one slow Home does not become a queue of asks. */
  private thinking = new Set<RoleId>();
  /** Parts whose agent could not be asked, and why — said once per night rather than every scene. */
  private mute = new Map<RoleId, string>();
  /** How many goes an agent has had at a part it keeps missing. */
  private misses: Record<string, number> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
      for (const r of ctx.storage.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM kv`).toArray()) {
        if (r.k === 'state') {
          const st = JSON.parse(r.v) as MysteryState | null;
          // A NIGHT OPENED BY AN OLDER ENGINE is repaired here, once, rather than defended against everywhere.
          this.state = st ? { ...st, traces: st.traces ?? [], claims: st.claims ?? [], accusations: st.accusations ?? [] } : null;
        }
        if (r.k === 'meta') this.meta = JSON.parse(r.v) as Meta;
        if (r.k === 'paused') this.paused = r.v === '1';
        if (r.k === 'taken') this.taken = JSON.parse(r.v) as Record<string, { role: RoleId; name: string }>;
      }
    });
  }

  private save(): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO kv (k, v) VALUES ('state', ?), ('meta', ?), ('paused', ?), ('taken', ?)`,
      JSON.stringify(this.state), JSON.stringify(this.meta), this.paused ? '1' : '0', JSON.stringify(this.taken),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/open') {
      const b = (await request.json()) as { stagingId: string; owner: string; ownerName: string; title: string; role?: RoleId; restart?: boolean; killer?: 'chance' | 'me'; pace?: 'short' | 'full'; director?: string };
      const pair = stagingOf(b.title);
      if (!pair) return json({ error: `no such mystery: ${b.title}` }, 404);
      const { title, venue } = pair;
      // ONE NIGHT AT A TIME, and asking again is asking about the same one — until it is over, or the owner
      // asks for another. The practice table's rule: derived, reusable, and thrown away on request.
      // ASKING FOR ANOTHER PART IS ASKING FOR ANOTHER NIGHT — you cannot be recast inside a story that has
      // already drawn its killer, so a different part starts the evening again rather than ignoring you.
      const wantsOther = (!!b.role && !!this.meta && this.meta.role !== b.role)
        || (!!b.pace && !!this.meta && (this.meta.pace ?? 'full') !== b.pace);
      if (this.state && !b.restart && !wantsOther && this.state.phase !== 'revealed') return json({ ok: true, staging: this.summary() });
      const role = title.roles.find((r) => r.id === b.role)?.id ?? title.roles[0]!.id;
      const minds = mysteryCastAgents(this.env);
      let handed = 0;
      const cast: Casting[] = title.roles.map((r) => {
        if (r.id === role) return { role: r.id, agent: b.owner, name: b.ownerName || r.name, custodian: b.owner, operator: 'human' as const, playerId: b.owner, mind: 'human' as const };
        // A PART NOBODY IS PLAYING GETS AN AGENT OF ITS OWN, from the deployment's list, and the house's own
        // rules when the list runs out. Which agent plays which part is fixed here and never re-drawn.
        const named = minds[handed];
        if (named) handed++;
        return named
          ? { role: r.id, agent: named, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'agent' as const }
          : { role: r.id, agent: `${r.id}.cast`, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'rules' as const };
      });
      const seed = randomSeed();
      const seedHex = bytesToHex(seed);
      // WHO THE SEED MAY LAND ON, said before it is spent: the whole cast by default — a solo player who was
      // always the murderer would never once get a mystery — or this player, if they asked for that night.
      // A SHORT NIGHT IS A WHOLE NIGHT. Somebody with twenty minutes gets all three acts, both deaths and
      // the reveal, at a quarter of the length the title was written for — not the first act and a wall.
      this.state = openStaging({
        title, venue, cast, seedHex, seedCommit: seedCommit(seed), now: Date.now(),
        killerRule: b.killer === 'me' ? role : 'any',
        pace: b.pace === 'short' ? 0.25 : 1,
      });
      this.meta = { stagingId: b.stagingId, owner: b.owner, ownerName: b.ownerName, title: title.id, role, pace: b.pace === 'short' ? 'short' : 'full', ...(mysteryDirector(this.env) ? { director: mysteryDirector(this.env)! } : {}) };
      this.paused = false;
      this.lastMoved = {};
      this.save();
      await this.arm();
      return json({ ok: true, staging: this.summary() });
    }
    /**
     * A CLUB'S MYSTERY. Created by the host and left in CASTING: the cast is the club's people, taking parts
     * one at a time, and nothing is drawn — not the killer, not a clue — until the host says the curtain is
     * up. That is the difference between a night of your own (opened on the spot) and a night people come to.
     */
    if (request.method === 'POST' && url.pathname === '/plan') {
      const b = (await request.json()) as { stagingId: string; club: string; night?: string; title: string; host: string; hostName: string; pace?: 'short' | 'full'; restart?: boolean; director?: string };
      const pair = stagingOf(b.title);
      if (!pair) return json({ error: `no such mystery: ${b.title}` }, 404);
      if (this.state && !b.restart) return json({ ok: true, staging: this.summary(), cast: this.castList() });
      this.state = null;
      this.taken = {};
      this.meta = {
        stagingId: b.stagingId, owner: b.host, ownerName: b.hostName, title: pair.title.id,
        role: pair.title.roles[0]!.id, pace: b.pace === 'short' ? 'short' : 'full',
        club: b.club, ...(b.night ? { night: b.night } : {}), casting: true, ...(mysteryDirector(this.env) ? { director: mysteryDirector(this.env)! } : {}),
      };
      this.save();
      return json({ ok: true, staging: this.summary(), cast: this.castList() });
    }
    /** A PART, TAKEN. One per person, given up by taking another, and refused once the night has begun. */
    if (request.method === 'POST' && url.pathname === '/cast') {
      const b = (await request.json()) as { playerId: string; name: string; role: RoleId | null };
      if (!this.meta?.casting) return json({ error: 'this night is not casting' }, 409);
      const pair = stagingOf(this.meta.title);
      if (!pair) return json({ error: 'no such mystery' }, 404);
      if (b.role === null) { delete this.taken[b.playerId]; this.save(); return json({ ok: true, cast: this.castList() }); }
      if (!pair.title.roles.some((r) => r.id === b.role)) return json({ error: 'no such part' }, 404);
      const heldByAnother = Object.entries(this.taken).some(([id, t]) => id !== b.playerId && t.role === b.role);
      if (heldByAnother) return json({ error: 'somebody has already taken that part' }, 409);
      this.taken[b.playerId] = { role: b.role, name: b.name };
      this.save();
      return json({ ok: true, cast: this.castList() });
    }
    /** CURTAIN UP: the parts nobody took are played by the house, and the seed is spent. */
    if (request.method === 'POST' && url.pathname === '/curtain') {
      const b = (await request.json()) as { by: string };
      if (!this.meta?.casting) return json({ error: 'this night has already begun' }, 409);
      if (this.meta.owner !== b.by) return json({ error: 'the host raises the curtain' }, 403);
      const pair = stagingOf(this.meta.title);
      if (!pair) return json({ error: 'no such mystery' }, 404);
      const minds = mysteryCastAgents(this.env);
      let handed = 0;
      const cast: Casting[] = pair.title.roles.map((r) => {
        const person = Object.entries(this.taken).find(([, t]) => t.role === r.id);
        if (person) return { role: r.id, agent: person[0], name: person[1].name || r.name, custodian: person[0], operator: 'human' as const, playerId: person[0], mind: 'human' as const };
        const named = minds[handed];
        if (named) handed++;
        return named
          ? { role: r.id, agent: named, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'agent' as const }
          : { role: r.id, agent: `${r.id}.cast`, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'rules' as const };
      });
      const seed = randomSeed();
      // A PARTY WANTS SOMEBODY AT THE TABLE TO HAVE TO LIE, so a club's night draws over the people in it.
      this.state = openStaging({
        title: pair.title, venue: pair.venue, cast, seedHex: bytesToHex(seed), seedCommit: seedCommit(seed),
        now: Date.now(), killerRule: 'human', pace: this.meta.pace === 'short' ? 0.25 : 1,
      });
      this.meta = { ...this.meta, casting: false };
      this.save();
      await this.arm();
      return json({ ok: true, staging: this.summary() });
    }
    if (request.method === 'GET' && url.pathname === '/view') {
      const playerId = url.searchParams.get('playerId') ?? '';
      // A READ IS A LOOK. The clock only runs while somebody is here, so a night left alone stops where it
      // stood — and then the first person back must see where it stands NOW, not the act it was halfway
      // through last night. Catching up is the engine's own `tick`, run until it has nothing left to do.
      this.catchUp();
      // A NIGHT BEING CAST IS A NIGHT. It has no state yet — no killer, no clue, nothing drawn — but it has
      // parts and people who have taken them, and the club's page is asking about exactly that.
      if (!this.state && !this.meta) return json({ error: 'no such night' }, 404);
      return json({ staging: this.summary(), view: this.state ? this.viewOf(playerId) : null, cast: this.castList() });
    }
    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket upgrade' }, 426);
      const playerId = request.headers.get('x-player-id');
      if (!playerId || !this.state) return json({ error: 'no such night' }, 404);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [playerId]);
      server.serializeAttachment({ playerId, name: decodeURIComponent(request.headers.get('x-player-name') ?? '') } satisfies Attachment);
      this.catchUp();
      await this.arm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not found' }, 404);
  }

  /** Which character this person is, if any. A watcher gets the public story and no private knowledge. */
  private roleOfPlayer(playerId: string): RoleId | null {
    return this.state?.cast.find((c) => c.playerId === playerId)?.role ?? null;
  }

  private viewOf(playerId: string): MysteryView | null {
    if (!this.state) return null;
    const pair = stagingOf(this.state.title);
    if (!pair) return null;
    return viewFor(this.state, pair.title, pair.venue, this.roleOfPlayer(playerId));
  }

  private summary() {
    const m = this.meta;
    if (!m) return null;
    const s = this.state;
    return {
      stagingId: m.stagingId, title: m.title, venue: s?.venue ?? stagingOf(m.title)?.venue.id ?? '', role: m.role,
      act: s?.act ?? 0, phase: m.casting ? 'casting' : s?.phase ?? 'casting',
      deadline: s?.deadline ?? null, seedCommit: s?.seedCommit ?? '', paused: this.paused,
      startedAt: s?.startedAt ?? 0, endedAt: s?.endedAt ?? null,
      ...(m.club ? { club: m.club } : {}), ...(m.night ? { night: m.night } : {}),
      host: m.owner, pace: m.pace ?? 'full', ...(m.director ? { director: m.director } : {}),
    };
  }

  /** Every part, and who has taken it — what a club's page shows while the night is being cast. */
  private castList() {
    const m = this.meta;
    const pair = m ? stagingOf(m.title) : null;
    if (!m || !pair) return [];
    return pair.title.roles.map((r) => {
      const person = Object.entries(this.taken).find(([, t]) => t.role === r.id);
      const playing = this.state?.cast.find((c) => c.role === r.id);
      return {
        role: r.id, name: r.name, blurb: r.blurb, look: r.look,
        takenBy: person ? person[1].name : playing?.operator === 'human' ? playing.name : null,
        takenById: person ? person[0] : playing?.playerId ?? null,
        operator: person || playing?.operator === 'human' ? 'human' : 'agent',
      };
    });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment;
    type Incoming = { type?: string; action?: unknown; text?: string; on?: boolean };
    let m: Incoming | null = null;
    try { m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as Incoming; } catch { m = null; }
    if (!m?.type || !this.state) return;
    // ANY TRAFFIC RE-ARMS THE CLOCK. A socket that survived a restart, or one whose alarm was lost with an
    // eviction, heals on its next heartbeat instead of leaving the night frozen with somebody watching it.
    if (m.type === 'ping') { this.catchUp(); await this.arm(); return; }
    if (m.type === 'join') { this.send(ws, { type: 'staging', staging: this.summary(), view: this.viewOf(who.playerId) }); await this.arm(); return; }
    if (m.type === 'pause') {
      // THE HOLD IS THE TABLE'S, REUSED: everything stops, including the characters, and the clock gives back
      // the time it took — a night held overnight must not wake up with its act already over.
      const on = m.on !== false;
      if (on && !this.paused) { this.paused = true; this.pausedAt = Date.now(); }
      else if (!on && this.paused) {
        const owed = Date.now() - this.pausedAt;
        if (this.state.deadline !== null) this.state = { ...this.state, deadline: this.state.deadline + owed };
        this.paused = false;
      }
      this.save(); await this.arm(); this.tellEverybody(); return;
    }
    const role = this.roleOfPlayer(who.playerId);
    if (!role) { this.send(ws, { type: 'error', code: 'watching', message: 'You are not in this story.' }); return; }
    const raw = m.type === 'say' ? { type: 'say', text: m.text } : m.action;
    const parsed = parseAction(raw);
    if (!parsed.ok) { this.send(ws, { type: 'error', code: parsed.code, message: parsed.reason }); return; }
    const pair = stagingOf(this.state.title);
    if (!pair) return;
    const r = apply(this.state, pair.title, pair.venue, role, parsed.action, Date.now(), 'human');
    if (!r.ok) { this.send(ws, { type: 'error', code: r.code, message: r.reason }); return; }
    this.state = r.state;
    this.save();
    this.tellEverybody();
    await this.arm();
  }

  override async webSocketClose(): Promise<void> { /* the alarm notices on its next wake */ }

  /** The clock, and the characters nobody is playing. */
  override async alarm(): Promise<void> {
    if (!this.state || this.state.phase === 'revealed') return;
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length || this.paused) return; // nobody looking, or held: nothing happens and nothing re-arms
    const pair = stagingOf(this.state.title);
    if (!pair) return;
    const now = Date.now();
    let changed = false;

    for (const c of this.state.cast) {
      if (c.operator !== 'agent' || isDead(this.state, c.role)) continue;
      if (now - (this.lastMoved[c.role] ?? 0) < PACE_MS) continue;
      const role = pair.title.roles.find((r) => r.id === c.role);
      if (!role) continue;
      /**
       * A CHARACTER WITH AN AGENT IS ASKED, and the night does not wait for the answer.
       *
       * A Home takes ten seconds or more to think; an act is minutes long and a scene is a few seconds, so
       * the ask goes out and the answer is applied whenever it lands — validated against the state as it is
       * THEN, which is the only honest way to take a late answer. Meanwhile the house's rules keep the part
       * moving, so a slow agent is a quieter character rather than a frozen one.
       */
      this.lastMoved[c.role] = now;
      if (c.mind === 'agent' && c.agent && !this.thinking.has(c.role)) {
        this.thinking.add(c.role);
        void this.askOne(c.role, c.agent, pair.title.id);
        continue;
      }
      const view = viewFor(this.state, pair.title, pair.venue, c.role);
      const move = chooseAction(view, role.lines, Math.floor(now / PACE_MS));
      if (!move) continue;
      const done = apply(this.state, pair.title, pair.venue, c.role, move.action, now, 'agent');
      if (done.ok) { this.state = done.state; changed = true; }
      if (move.line) {
        const said = apply(this.state, pair.title, pair.venue, c.role, { type: 'say', text: move.line }, now, 'agent');
        if (said.ok) { this.state = said.state; changed = true; }
      }
    }
    const ticked = tick(this.state, pair.title, pair.venue, now);
    if (ticked.events.length) {
      this.state = ticked.state;
      changed = true;
      // A BEAT IS WHERE THE STORY IS TOLD. The engine has just decided something; the director is asked for
      // the words that carry it, and whatever it says is narration over facts that are already settled.
      void this.direct(ticked.events);
    }
    if (changed) { this.save(); this.tellEverybody(); }
    if (this.state.phase !== 'revealed') await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  /**
   * THE NIGHT CATCHES UP. `tick` advances at most one phase per call, so a night that sat out an act and a
   * half needs several — bounded, because a loop in a Durable Object is a loop nobody can stop.
   */
  private catchUp(): void {
    const pair = this.state ? stagingOf(this.state.title) : null;
    if (!this.state || !pair || this.paused) return;
    for (let i = 0; i < 8; i++) {
      const out = tick(this.state, pair.title, pair.venue, Date.now());
      if (!out.events.length) break;
      this.state = out.state;
    }
    this.save();
  }

  /**
   * ONE CHARACTER'S MOMENT, ASKED OF THE AGENT THAT PLAYS THEM.
   *
   * The whole point of the road: the part is not played by code in this object but by an agent at its own
   * endpoint, reasoning from the role's own skill artifacts in its playbook. What comes back is validated by
   * the ENGINE like anybody else's move — an agent cannot walk through a wall or murder somebody in a room
   * full of people because it said so — and a refusal is logged rather than applied.
   */
  private async askOne(role: RoleId, agent: string, titleId: string): Promise<void> {
    try {
      const pair = stagingOf(titleId);
      const s0 = this.state;
      if (!pair || !s0) return;
      const part = pair.title.roles.find((r) => r.id === role);
      const view = viewFor(s0, pair.title, pair.venue, role);
      const out = await askCharacter(this.env, agent, {
        skill: MYSTERY_ACT_SKILL,
        stagingId: this.meta?.stagingId ?? '',
        act: s0.act,
        role,
        roleName: part?.name ?? role,
        brief: `${part?.blurb ?? ''} ${view.you?.killer ? 'You are the one who did it, and nobody else knows.' : ''} What only you know: ${part?.secret ?? ''}`.trim(),
        view: view as unknown as Record<string, unknown>,
        legal: ['move', 'say', 'whisper', 'examine', 'search', 'share', 'testify', 'alibi', ...(view.you?.killer ? ['murder', 'plant'] : []), ...(s0.phase === 'accusations' || s0.act >= pair.title.acts.length ? ['accuse'] : [])],
        // THE CRAFT TRAVELS WITH THE ASK until it is a published artifact in the agent's own playbook.
        craft: [...CHARACTER_CRAFT, ...(pair.title.voice?.character ?? [])],
        deadlineMs: a2aTimeoutMs(this.env),
      }, a2aTimeoutMs(this.env));
      if (!out.ok) {
        /**
         * AN AGENT THAT CANNOT PLAY THE PART HANDS IT BACK — really hands it back, rather than being logged
         * about. The casting's mind becomes `rules` and the house plays that character for the rest of the
         * night, which is the difference between a fallback and a silent room. A card that does not advertise
         * the skill is a permanent answer and demotes at once; anything else (a slow Home, a bad moment) is
         * given three goes first, because an agent worth asking is worth waiting for twice.
         */
        const permanent = /does not advertise|card unreachable|not an A2A agent card|is not JSON/.test(out.error);
        const misses = (this.misses[role] ?? 0) + 1;
        this.misses[role] = misses;
        // EVERY MISS IS SAID, not just the last one: "the part went quiet" is not a diagnosis, and the reason
        // an agent could not answer is the only thing that tells you whether to fix a card, a skill or a wire.
        console.warn(`[mystery] ${agent} missed ${role} (${misses}): ${out.error}`);
        if (permanent || misses >= 3) {
          if (!this.mute.has(role)) { this.mute.set(role, out.error); console.warn(`[mystery] ${role} is played by the house from here: ${out.error}`); }
          const cur0 = this.state;
          if (cur0) {
            this.state = { ...cur0, cast: cur0.cast.map((c) => (c.role === role ? { ...c, mind: 'rules' as const } : c)) };
            this.save();
            this.tellEverybody();
          }
        }
        return;
      }
      this.misses[role] = 0;
      // LATE IS FINE; ILLEGAL IS NOT. The answer is applied to the state as it is now, and the engine says.
      const now = Date.now();
      const cur = this.state;
      const pair2 = cur ? stagingOf(cur.title) : null;
      if (!cur || !pair2) return;
      let changed = false;
      if (out.output.action) {
        const parsed = parseAction(out.output.action);
        if (parsed.ok) {
          const done = apply(cur, pair2.title, pair2.venue, role, parsed.action, now, 'agent');
          if (done.ok) { this.state = done.state; changed = true; }
          else console.warn(`[mystery] ${role}'s agent tried something the night refused: ${done.code}`);
        }
      }
      if (out.output.say) {
        const said = apply(this.state ?? cur, pair2.title, pair2.venue, role, { type: 'say', text: out.output.say }, now, 'agent');
        if (said.ok) { this.state = said.state; changed = true; }
      }
      if (changed) { this.save(); this.tellEverybody(); }
    } finally {
      this.thinking.delete(role);
    }
  }

  /**
   * THE DIRECTOR, ASKED — over A2A, at the endpoint its own card names, signed as the house.
   *
   * It is handed the PUBLIC view and the facts it must carry, and what can come back is prose (and at most a
   * nod at a room or a prop that already exists). It cannot decide anything: not who did it, not what is
   * found, not where anybody is. A miss — no such agent, no such skill, too slow, the wrong shape — leaves
   * the title's line standing, which is why the night never depends on it.
   */
  private async direct(events: MysteryEvent[]): Promise<void> {
    const m = this.meta;
    const s = this.state;
    const pair = s ? stagingOf(s.title) : null;
    if (!m?.director || !s || !pair) return;
    const facts = events.flatMap((e) => (
      e.type === 'died' ? [`${pair.title.roles.find((r) => r.id === e.victim)?.name ?? e.victim} has been found dead in ${pair.venue.rooms.find((r) => r.id === e.room)?.name ?? e.room}.`]
        : e.type === 'spared' ? [`Nobody died, but ${pair.venue.rooms.find((r) => r.id === e.room)?.name ?? e.room} was turned over in the dark.`]
          : e.type === 'act' ? [`Act ${e.act} — ${e.phase}.`]
            : []
    ));
    if (!facts.length) return;
    const fallback = events.find((e) => e.type === 'cue');
    const publicView = viewFor(s, pair.title, pair.venue, null);
    const out = await askDirector(this.env, m.director, {
      skill: MYSTERY_DIRECT_SKILL,
      stagingId: m.stagingId,
      act: s.act,
      phase: s.phase,
      publicView: { rooms: publicView.rooms, cast: publicView.cast.map((c) => ({ role: c.role, name: c.name, alive: c.alive })), deaths: publicView.deaths, act: publicView.act, actName: publicView.actName, objective: publicView.objective } as unknown as Record<string, unknown>,
      facts,
      fallback: fallback?.type === 'cue' ? fallback.text : '',
      craft: [...DIRECTOR_CRAFT, ...(pair.title.voice?.director ?? [])],
      deadlineMs: a2aTimeoutMs(this.env),
    }, a2aTimeoutMs(this.env)).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    if (!out.ok) { console.warn('[mystery] the director was quiet:', out.error); return; }
    // The narration joins the story as the house's own voice, from whoever directed it.
    const cur = this.state;
    if (!cur) return;
    const line: MysteryEvent = { type: 'cue', at: Date.now(), text: out.output.cue, by: 'director' };
    this.state = { ...cur, log: [...cur.log, line].slice(-600) };
    this.save();
    this.tellEverybody();
  }

  private async arm(): Promise<void> {
    if (!this.state || this.state.phase === 'revealed' || this.paused) return;
    const at = await this.ctx.storage.getAlarm();
    if (at === null) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  /** Everybody's own view, because two people in this story do not see the same thing. */
  private tellEverybody(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as Attachment | null;
      if (!who) continue;
      this.send(ws, { type: 'staging', staging: this.summary(), view: this.viewOf(who.playerId) });
    }
  }

  private send(ws: WebSocket, msg: unknown): void {
    try { ws.send(JSON.stringify(msg)); } catch { /* a socket that has gone is not an error here */ }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
