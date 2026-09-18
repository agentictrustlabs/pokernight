/**
 * ONE NIGHT OF GREAT COMMISSION — a Durable Object per staging (docs/GREAT-COMMISSION.md).
 *
 * The same shape as `MysteryDO`, on purpose: the clock, the sockets, presence and attention, the host's hold,
 * the readiness doorway, the parts nobody is playing asked of their agents one at a time, the director asked
 * for words. What differs is the ENGINE it hosts — `@pokernight/commission` — and therefore what a moment is:
 * a slip at a grain, a reading, a corroboration, an offering, an inference. Every invariant learned playing
 * mysteries applies unchanged and is stated once, in `mystery-do.ts`; this file keeps the same names so a
 * reader of one can read the other.
 */
import { DurableObject } from 'cloudflare:workers';
import { bytesToHex, randomSeed, seedCommit } from '@pokernight/deal';
import {
  apply, CHARACTER_CRAFT, chooseAction, DIRECTOR_CRAFT, isSilent, openStaging, parseAction, stagingOf, tick, viewFor,
  type Casting, type CommissionEvent, type CommissionState, type CommissionView, type RoleId,
} from '@pokernight/commission';
import { COMMISSION_ACT_SKILL, COMMISSION_DIRECT_SKILL } from '@pokernight/protocol';
import { askDirector, askPart } from './commission-a2a.js';
import { a2aTimeoutMs } from './a2a.js';
import { castMessaging, whisperAs, whispersToCarry } from './cast-messaging.js';
import { commissionCast, commissionCastAgents, commissionDirector, type Env } from './env.js';

interface Attachment { playerId: string; name: string }
interface Meta {
  stagingId: string; owner: string; ownerName: string; scenario: string; role: RoleId; pace?: 'short' | 'full';
  club?: string; night?: string; casting?: boolean;
  director?: string;
}

const PACE_MS = 9_000;
const TICK_MS = 2_400;
const REST_MS = 120_000;
const ATTENTION_MS = 20 * 60_000;
const PRESENCE_MS = 20_000;
const THINKING_AT_ONCE = 2;

export class CommissionDO extends DurableObject<Env> {
  private state: CommissionState | null = null;
  private meta: Meta | null = null;
  private seenAt: Record<string, number> = {};
  private paused = false;
  private pausedAt = 0;
  private heard = 0;
  private lastMoved: Record<string, number> = {};
  private taken: Record<string, { role: RoleId; name: string }> = {};
  private thinking = new Set<RoleId>();
  private mute = new Map<RoleId, string>();
  private misses: Record<string, number> = {};
  private resting: Record<string, number> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
      for (const r of ctx.storage.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM kv`).toArray()) {
        if (r.k === 'state') this.state = JSON.parse(r.v) as CommissionState | null;
        if (r.k === 'meta') this.meta = JSON.parse(r.v) as Meta;
        if (r.k === 'paused') this.paused = r.v === '1';
        if (r.k === 'taken') this.taken = JSON.parse(r.v) as Record<string, { role: RoleId; name: string }>;
        if (r.k === 'heard') this.heard = Number(r.v) || 0;
      }
    });
  }

  private save(): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO kv (k, v) VALUES ('state', ?), ('meta', ?), ('paused', ?), ('taken', ?), ('heard', ?)`,
      JSON.stringify(this.state), JSON.stringify(this.meta), this.paused ? '1' : '0', JSON.stringify(this.taken), String(this.heard),
    );
    void this.carryWhispers().catch((e: unknown) => console.warn('[commission] carrying whispers threw:', String(e)));
  }

  /** Whispers this object has already sent over A2A, by event key — remembered, never re-sent; bounded. */
  private carried = new Set<string>();

  /**
   * A WHISPER BETWEEN TWO PARTS IS A DIRECT MESSAGE FROM THE ONE AGENT TO THE OTHER (`cast-messaging.ts`). Called
   * on every save, because every change to the night passes through one; each whisper is carried once, after the
   * room already has it, and a miss is logged and never retried — the room's copy is the record of what was said.
   */
  private async carryWhispers(): Promise<void> {
    const cm = await castMessaging(this.env);
    if (!cm || !this.state) return;
    // THE CHARACTER IS THE IDENTITY: both ends are the part's standing persona, whoever plays it tonight.
    const standing = commissionCast(this.env);
    const personaOf = (role: string) => standing.find((m) => m.role === role)?.agent ?? null;
    for (const w of whispersToCarry(this.state.log, this.state.cast, cm, this.carried, personaOf)) {
      this.carried.add(w.key);
      if (this.carried.size > 600) for (const k of [...this.carried].slice(0, 200)) this.carried.delete(k);
      void whisperAs(this.env, cm, w.from, w.toSa, w.toName, w.text)
        .then((r) => { if (!r.ok) console.warn(`[commission] ${w.from.character}'s whisper to ${w.toName} stayed in the room: ${r.error}`); })
        .catch((e: unknown) => console.warn(`[commission] the whisper threw:`, String(e)));
    }
  }

  /** The cast for a night: the person in their part, and everybody else from the deployment's list or the house. */
  private castFor(roles: ReadonlyArray<{ id: RoleId; name: string }>, human: (r: RoleId) => { name: string; playerId: string } | null): Casting[] {
    const minds = commissionCastAgents(this.env);
    const standing = commissionCast(this.env);
    let handed = 0;
    return roles.map((r) => {
      const person = human(r.id);
      // A PERSON CHANGES THE MIND, NOT THE CHARACTER: the part keeps its own agent and its own name, so a
      // whisper to Dr Wren still goes to Dr Wren's agent and the cast list still says who the character is.
      // Only when no persona was ever chartered for the part is the person's own agent its address.
      if (person) {
        const own = standing.find((c) => c.role === r.id);
        return { role: r.id, agent: own?.agent ?? person.playerId, name: r.name, custodian: person.playerId, operator: 'human' as const, playerId: person.playerId, mind: 'human' as const, ...(person.name ? { playedBy: person.name } : {}) };
      }
      // THE PART'S OWN PERSON, when the estate has chartered one (`COMMISSION_CAST`) — a persona agent somebody
      // custodies, with a vault and a memory of the last night. Then a positional list; then the house's rules.
      const own = standing.find((c) => c.role === r.id);
      if (own) return { role: r.id, agent: own.agent, name: r.name, custodian: own.custodian, operator: 'agent' as const, mind: 'agent' as const };
      const named = minds.length ? minds[handed++ % minds.length] : undefined;
      return named
        ? { role: r.id, agent: named, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'agent' as const }
        : { role: r.id, agent: `${r.id}.cast`, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'rules' as const };
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/open') {
      const b = (await request.json()) as { stagingId: string; owner: string; ownerName: string; scenario: string; role?: RoleId; restart?: boolean; pace?: 'short' | 'full'; director?: string };
      const pair = stagingOf(b.scenario);
      if (!pair) return json({ error: `no such scenario: ${b.scenario}` }, 404);
      const { scenario, region } = pair;
      const wantsOther = (!!b.role && !!this.meta && this.meta.role !== b.role) || (!!b.pace && !!this.meta && (this.meta.pace ?? 'full') !== b.pace);
      if (this.state && !b.restart && !wantsOther && this.state.phase !== 'revealed') return json({ ok: true, staging: this.summary() });
      const role = scenario.roles.find((r) => r.id === b.role)?.id ?? scenario.roles[0]!.id;
      const cast = this.castFor(scenario.roles, (r) => (r === role ? { name: b.ownerName, playerId: b.owner } : null));
      const seed = randomSeed();
      this.state = openStaging({ scenario, region, cast, seedHex: bytesToHex(seed), seedCommit: seedCommit(seed), now: Date.now(), pace: b.pace === 'short' ? 0.25 : 1 });
      this.meta = { stagingId: b.stagingId, owner: b.owner, ownerName: b.ownerName, scenario: scenario.id, role, pace: b.pace === 'short' ? 'short' : 'full', ...(commissionDirector(this.env) ? { director: commissionDirector(this.env)! } : {}) };
      this.paused = false;
      this.lastMoved = {};
      this.save();
      this.heardFrom();
      await this.arm();
      return json({ ok: true, staging: this.summary() });
    }
    /** A CLUB'S NIGHT: created by the host and left in CASTING until the host says the curtain is up. */
    if (request.method === 'POST' && url.pathname === '/plan') {
      const b = (await request.json()) as { stagingId: string; club: string; night?: string; scenario: string; host: string; hostName: string; pace?: 'short' | 'full'; restart?: boolean; director?: string };
      const pair = stagingOf(b.scenario);
      if (!pair) return json({ error: `no such scenario: ${b.scenario}` }, 404);
      if (this.state && !b.restart) return json({ ok: true, staging: this.summary(), cast: this.castList() });
      this.state = null;
      this.taken = {};
      this.meta = {
        stagingId: b.stagingId, owner: b.host, ownerName: b.hostName, scenario: pair.scenario.id,
        role: pair.scenario.roles[0]!.id, pace: b.pace === 'short' ? 'short' : 'full',
        club: b.club, ...(b.night ? { night: b.night } : {}), casting: true, ...(commissionDirector(this.env) ? { director: commissionDirector(this.env)! } : {}),
      };
      this.save();
      return json({ ok: true, staging: this.summary(), cast: this.castList() });
    }
    /** A PART, TAKEN — or taken over from the house after the curtain. One per person per night. */
    if (request.method === 'POST' && url.pathname === '/cast') {
      const b = (await request.json()) as { playerId: string; name: string; role: RoleId | null };
      if (!this.meta?.casting) {
        if (!this.state) return json({ error: 'this night is not casting' }, 409);
        if (b.role === null) return json({ error: 'the night has begun — a part taken now is yours for it' }, 409);
        const pair2 = stagingOf(this.meta?.scenario ?? '');
        if (!pair2) return json({ error: 'no such scenario' }, 404);
        if (this.state.cast.some((c) => c.playerId === b.playerId)) return json({ error: 'you are already in this story' }, 409);
        const seat = this.state.cast.find((c) => c.role === b.role);
        if (!seat) return json({ error: 'no such part' }, 404);
        if (seat.operator === 'human') return json({ error: 'somebody is already playing that part' }, 409);
        if (isSilent(this.state, pair2.scenario, seat.role)) return json({ error: 'that part has gone quiet for the night' }, 409);
        // The same character, with the same agent and the same name — only the mind behind it changes.
        this.state = { ...this.state, cast: this.state.cast.map((c) => (c.role === b.role ? { ...c, custodian: b.playerId, operator: 'human' as const, playerId: b.playerId, mind: 'human' as const, ...(b.name ? { playedBy: b.name } : {}) } : c)) };
        this.save();
        this.tellEverybody();
        return json({ ok: true, cast: this.castList() });
      }
      const pair = stagingOf(this.meta.scenario);
      if (!pair) return json({ error: 'no such scenario' }, 404);
      if (b.role === null) { delete this.taken[b.playerId]; this.save(); return json({ ok: true, cast: this.castList() }); }
      if (!pair.scenario.roles.some((r) => r.id === b.role)) return json({ error: 'no such part' }, 404);
      if (Object.entries(this.taken).some(([id, t]) => id !== b.playerId && t.role === b.role)) return json({ error: 'somebody has already taken that part' }, 409);
      this.taken[b.playerId] = { role: b.role, name: b.name };
      this.save();
      return json({ ok: true, cast: this.castList() });
    }
    /** CURTAIN UP: the parts nobody took are played by the house, and the seed is spent. */
    if (request.method === 'POST' && url.pathname === '/curtain') {
      const b = (await request.json()) as { by: string };
      if (!this.meta?.casting) return json({ error: 'this night has already begun' }, 409);
      if (this.meta.owner !== b.by) return json({ error: 'the host raises the curtain' }, 403);
      const pair = stagingOf(this.meta.scenario);
      if (!pair) return json({ error: 'no such scenario' }, 404);
      const cast = this.castFor(pair.scenario.roles, (r) => { const p = Object.entries(this.taken).find(([, t]) => t.role === r); return p ? { name: p[1].name, playerId: p[0] } : null; });
      const seed = randomSeed();
      this.state = openStaging({ scenario: pair.scenario, region: pair.region, cast, seedHex: bytesToHex(seed), seedCommit: seedCommit(seed), now: Date.now(), pace: this.meta.pace === 'short' ? 0.25 : 1 });
      this.meta = { ...this.meta, casting: false };
      this.save();
      this.heardFrom();
      await this.arm();
      return json({ ok: true, staging: this.summary() });
    }
    if (request.method === 'GET' && url.pathname === '/view') {
      const playerId = url.searchParams.get('playerId') ?? '';
      if (playerId) this.seenAt[playerId] = Date.now();
      this.catchUp();
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
      this.heardFrom();
      await this.arm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not found' }, 404);
  }

  private roleOfPlayer(playerId: string): RoleId | null { return this.state?.cast.find((c) => c.playerId === playerId)?.role ?? null; }

  private viewOf(playerId: string): CommissionView | null {
    if (!this.state) return null;
    const pair = stagingOf(this.state.scenario);
    if (!pair) return null;
    return viewFor(this.state, pair.scenario, pair.region, this.roleOfPlayer(playerId));
  }

  private isHost(playerId: string): boolean { return !!this.meta && this.meta.owner === playerId; }

  private presentIds(): string[] {
    const out = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) { const who = ws.deserializeAttachment() as Attachment | null; if (who?.playerId) out.add(who.playerId); }
    const now = Date.now();
    for (const [id, at] of Object.entries(this.seenAt)) if (now - at < PRESENCE_MS) out.add(id);
    return [...out];
  }

  private readiness(): { taken: number; present: number; waitingFor: string[]; everybodyHere: boolean } {
    const here = new Set(this.presentIds());
    const expected = Object.entries(this.taken);
    const waitingFor = expected.filter(([id]) => !here.has(id)).map(([, t]) => t.name || 'somebody');
    return { taken: expected.length, present: expected.filter(([id]) => here.has(id)).length, waitingFor, everybodyHere: waitingFor.length === 0 };
  }

  private summary() {
    const m = this.meta;
    if (!m) return null;
    const s = this.state;
    return {
      stagingId: m.stagingId, scenario: m.scenario, region: s?.region ?? stagingOf(m.scenario)?.region.id ?? '', role: m.role,
      night: s?.night ?? stagingOf(m.scenario)?.scenario.night ?? 1,
      round: s?.round ?? 0, phase: m.casting ? 'casting' : s?.phase ?? 'casting',
      deadline: s?.deadline ?? null, seedCommit: s?.seedCommit ?? '', paused: this.paused,
      startedAt: s?.startedAt ?? 0, endedAt: s?.endedAt ?? null,
      ...(m.club ? { club: m.club } : {}), ...(m.night ? { clubNight: m.night } : {}),
      host: m.owner, pace: m.pace ?? 'full', ...(m.director ? { director: m.director } : {}),
      ready: this.readiness(),
    };
  }

  private castList() {
    const m = this.meta;
    const pair = m ? stagingOf(m.scenario) : null;
    if (!m || !pair) return [];
    return pair.scenario.roles.map((r) => {
      const person = Object.entries(this.taken).find(([, t]) => t.role === r.id);
      const playing = this.state?.cast.find((c) => c.role === r.id);
      return {
        role: r.id, name: r.name, kind: r.kind, blurb: r.blurb, look: r.look,
        takenBy: person ? person[1].name : playing?.operator === 'human' ? playing.playedBy ?? null : null,
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
    if (m.type === 'ping') { this.catchUp(); await this.arm(); return; }
    if (m.type === 'join') { this.heardFrom(); this.save(); this.catchUp(); this.send(ws, { type: 'staging', staging: this.summary(), view: this.viewOf(who.playerId) }); await this.arm(); return; }
    if (m.type === 'pause') {
      if (!this.isHost(who.playerId)) { this.send(ws, { type: 'error', code: 'not-host', message: 'Your host holds the night.' }); return; }
      const on = m.on !== false;
      if (on && !this.paused) { this.paused = true; this.pausedAt = Date.now(); }
      else if (!on && this.paused) {
        const owed = Date.now() - this.pausedAt;
        if (this.state.deadline !== null) this.state = { ...this.state, deadline: this.state.deadline + owed };
        this.paused = false;
      }
      this.heardFrom();
      this.save(); await this.arm(); this.tellEverybody(); return;
    }
    this.heardFrom();
    const role = this.roleOfPlayer(who.playerId);
    if (!role) { this.send(ws, { type: 'error', code: 'watching', message: 'You are not in this story.' }); return; }
    const raw = m.type === 'say' ? { type: 'say', text: m.text } : m.action;
    const parsed = parseAction(raw);
    if (!parsed.ok) { this.send(ws, { type: 'error', code: parsed.code, message: parsed.message }); return; }
    const pair = stagingOf(this.state.scenario);
    if (!pair) return;
    const r = apply(this.state, pair.scenario, pair.region, role, parsed.action, Date.now(), 'human');
    if (!r.ok) { this.send(ws, { type: 'error', code: r.code, message: r.message }); return; }
    this.state = r.state;
    this.save();
    this.tellEverybody();
    await this.arm();
  }

  override async webSocketClose(): Promise<void> { /* the alarm notices on its next wake */ }

  /** The clock, and the parts nobody is playing. */
  override async alarm(): Promise<void> {
    if (!this.state || this.state.phase === 'revealed') return;
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length || this.paused) return;
    if (!this.attended()) return;
    const pair = stagingOf(this.state.scenario);
    if (!pair) return;
    const now = Date.now();
    let changed = false;
    const waiting = this.state.cast
      .filter((c) => c.operator === 'agent' && !isSilent(this.state!, pair.scenario, c.role) && now - (this.lastMoved[c.role] ?? 0) >= PACE_MS)
      .sort((a, b) => (this.lastMoved[a.role] ?? 0) - (this.lastMoved[b.role] ?? 0))
      .slice(0, 1);
    for (const c of waiting) {
      const role = pair.scenario.roles.find((r) => r.id === c.role);
      if (!role) continue;
      this.lastMoved[c.role] = now;
      const rested = (this.resting[c.role] ?? 0) <= now;
      if (c.mind === 'agent' && c.agent && rested && !this.thinking.has(c.role) && this.thinking.size < THINKING_AT_ONCE) {
        this.thinking.add(c.role);
        void this.askOne(c.role, c.agent, pair.scenario.id);
        continue;
      }
      const view = viewFor(this.state, pair.scenario, pair.region, c.role);
      const move = chooseAction(view, role.lines, Math.floor(now / PACE_MS));
      if (!move) continue;
      const done = apply(this.state, pair.scenario, pair.region, c.role, move.action, now, 'agent');
      if (done.ok) { this.state = done.state; changed = true; }
      if (move.line && move.action.type !== 'say') {
        const said = apply(this.state, pair.scenario, pair.region, c.role, { type: 'say', text: move.line }, now, 'agent');
        if (said.ok) { this.state = said.state; changed = true; }
      }
    }
    const ticked = tick(this.state, pair.scenario, pair.region, now);
    if (ticked.events.length) {
      this.state = ticked.state;
      changed = true;
      void this.direct(ticked.events).catch((e: unknown) => console.warn('[commission] the narration threw:', String(e)));
    }
    if (changed) { this.save(); this.tellEverybody(); }
    if (this.state.phase !== 'revealed') await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  private catchUp(): void {
    const pair = this.state ? stagingOf(this.state.scenario) : null;
    if (!this.state || !pair || this.paused) return;
    for (let i = 0; i < 8; i++) {
      const out = tick(this.state, pair.scenario, pair.region, Date.now());
      if (!out.events.length) break;
      this.state = out.state;
    }
    this.save();
  }

  /** ONE PART'S MOMENT, asked of the agent that plays it; what comes back is validated by the engine like anybody's. */
  private async askOne(role: RoleId, agent: string, scenarioId: string): Promise<void> {
    try {
      const pair = stagingOf(scenarioId);
      const s0 = this.state;
      if (!pair || !s0) return;
      const part = pair.scenario.roles.find((r) => r.id === role);
      const view = viewFor(s0, pair.scenario, pair.region, role);
      const legal = ['move', 'say', 'whisper', 'testify', 'corroborate', 'revoke', ...(view.choices?.length ? ['choose'] : [])];
      if (part?.kind === 'researcher') legal.push('assess');
      if (part?.kind === 'funder' || part?.kind === 'agency') legal.push('commit', 'fulfil');
      if (part?.kind === 'convener') legal.push('admit');
      // `infer` is the DRAWN source's, and the view is the only thing that knows who that is — never a kind.
      if (view.you?.source) legal.push('infer');
      const out = await askPart(this.env, agent, {
        skill: COMMISSION_ACT_SKILL,
        stagingId: this.meta?.stagingId ?? '',
        act: s0.round,
        role,
        roleName: part?.name ?? role,
        brief: `${part?.blurb ?? ''} What only you know: ${part?.secret ?? ''}`.trim(),
        view: view as unknown as Record<string, unknown>,
        legal,
        craft: [...CHARACTER_CRAFT, ...(pair.scenario.voice?.character ?? [])],
        deadlineMs: a2aTimeoutMs(this.env),
      }, a2aTimeoutMs(this.env));
      if (!out.ok) {
        const permanent = /does not advertise|card unreachable|not an A2A agent card|is not JSON/.test(out.error);
        const misses = (this.misses[role] ?? 0) + 1;
        this.misses[role] = misses;
        console.warn(`[commission] ${agent} missed ${role} (${misses}): ${out.error}`);
        if (!permanent && misses >= 3) { this.resting[role] = Date.now() + REST_MS; this.misses[role] = 0; console.warn(`[commission] ${agent} is resting on ${role}; the house plays it meanwhile`); return; }
        if (permanent) {
          if (!this.mute.has(role)) { this.mute.set(role, out.error); console.warn(`[commission] ${role} is played by the house from here: ${out.error}`); }
          const cur0 = this.state;
          if (cur0) { this.state = { ...cur0, cast: cur0.cast.map((c) => (c.role === role ? { ...c, mind: 'rules' as const } : c)) }; this.save(); this.tellEverybody(); }
        }
        return;
      }
      this.misses[role] = 0;
      const now = Date.now();
      const base = this.state;
      const pair2 = stagingOf(base?.scenario ?? '');
      if (!base || !pair2) return;
      let changed = false;
      if (out.output.action !== undefined) {
        const parsed = parseAction(out.output.action);
        if (parsed.ok) {
          const done = apply(base, pair2.scenario, pair2.region, role, parsed.action, now, 'agent');
          if (done.ok) { this.state = done.state; changed = true; }
          else console.warn(`[commission] ${role}'s agent tried something the night refused: ${done.code}`);
        } else console.warn(`[commission] ${role}'s agent answered in no shape the engine knows: ${parsed.code}`);
      }
      if (out.output.say) {
        const cur = this.state ?? base;
        const mine = [...cur.log].reverse().find((e) => e.type === 'said' && e.by === role);
        const repeat = mine?.type === 'said' && mine.text.trim() === out.output.say.trim();
        if (!repeat) {
          const said = apply(cur, pair2.scenario, pair2.region, role, { type: 'say', text: out.output.say }, now, 'agent');
          if (said.ok) { this.state = said.state; changed = true; }
        }
      }
      if (changed) { this.save(); this.tellEverybody(); }
    } finally {
      this.thinking.delete(role);
    }
  }

  /** THE DIRECTOR, ASKED for the words between rounds — over A2A, signed as the house; a miss leaves the house's line. */
  private async direct(events: CommissionEvent[]): Promise<void> {
    const m = this.meta;
    const s = this.state;
    const pair = s ? stagingOf(s.scenario) : null;
    if (!s || !pair) return;
    if (!m?.director) return;
    const facts = events.flatMap((e) => (
      e.type === 'round' ? [`Round ${e.round} — ${e.phase}.`]
        : e.type === 'silent' ? [`${pair.scenario.roles.find((r) => r.id === e.role)?.name ?? e.role} has gone quiet; nothing has come from them since round ${e.round}.`]
          : e.type === 'revealed' ? ['The night is over and the board stands.']
            : []
    ));
    if (!facts.length) return;
    const fallback = events.find((e) => e.type === 'cue');
    const publicView = viewFor(s, pair.scenario, pair.region, null);
    const out = await askDirector(this.env, m.director, {
      skill: COMMISSION_DIRECT_SKILL,
      stagingId: m.stagingId,
      act: s.round,
      phase: s.phase,
      publicView: { rooms: publicView.rooms, peoples: publicView.peoples, cast: publicView.cast.map((c) => ({ role: c.role, name: c.name, silent: !!c.silent })), round: publicView.round, roundName: publicView.roundName, objective: publicView.objective } as unknown as Record<string, unknown>,
      facts,
      fallback: fallback?.type === 'cue' ? fallback.text : '',
      craft: [...DIRECTOR_CRAFT, ...(pair.scenario.voice?.director ?? [])],
      deadlineMs: a2aTimeoutMs(this.env),
    }, a2aTimeoutMs(this.env)).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    if (!out.ok) { console.warn('[commission] the director was quiet:', out.error); return; }
    const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(/\s+/).filter(Boolean);
    const house = new Set(plain(fallback?.type === 'cue' ? fallback.text : ''));
    const words = plain(out.output.cue);
    const shared = house.size ? words.filter((w) => house.has(w)).length / words.length : 0;
    if (shared > 0.72) return;
    const cur = this.state;
    if (!cur) return;
    const line: CommissionEvent = { type: 'cue', at: Date.now(), text: out.output.cue, by: 'director' };
    this.state = { ...cur, log: [...cur.log, line].slice(-800) };
    this.save();
    this.tellEverybody();
  }

  private attended(): boolean { return Date.now() - this.heard < ATTENTION_MS; }
  private heardFrom(): void { this.heard = Date.now(); }

  private async arm(): Promise<void> {
    if (!this.state || this.state.phase === 'revealed' || this.paused) return;
    if (!this.attended()) return;
    const at = await this.ctx.storage.getAlarm();
    if (at === null) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

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
