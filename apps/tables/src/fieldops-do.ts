/**
 * ONE SEASON OF FIELD OPERATIONS — a Durable Object per staging (docs/FIELD-OPERATIONS.md).
 *
 * The same shape as `CommissionDO`, on purpose: the clock, the sockets, presence and attention, the host's hold,
 * the readiness doorway, the parts nobody is playing asked of their agents, the director asked for words. What
 * differs is the ENGINE — `@pokernight/fieldops` — and therefore what a moment is: a DAY, on which every part
 * spends one act; and TWO THINGS THIS OBJECT DOES THAT NO NIGHT DID. It is a TEST OF THE AGENTS: every ask of a
 * part's agent is counted — asked, answered, refused by the engine, missed, how long it took — and the score shows
 * it beside what the house's own policy would have done. And it WRITES THE SEASON TO THE FIELD APP: at every
 * interlude and at the reveal the week's activity, observations, circles, churches and readings go into the team,
 * body and workspace vaults the operator chartered (`field-estate.ts`), and at the reveal the season is published
 * to the game's graph.
 */
import { DurableObject } from 'cloudflare:workers';
import { bytesToHex, randomSeed, seedCommit } from '@pokernight/deal';
import {
  apply, attachAgent, CHARACTER_CRAFT, chooseAction, DIRECTOR_CRAFT, openStaging, parseAction, roleOf, stagingOf, tick, viewFor,
  type Casting, type FieldOpsEvent, type FieldOpsState, type FieldOpsView, type RoleId,
} from '@pokernight/fieldops';
import { admit, advance, directMessage, ensureGeneral, postLine, reparent, sessionOf, stewardCustodian, STORAGE_V, type CharterProgress, type CharterSpec, type Standing } from './field-charter.js';
import { FIELDOPS_ACT_SKILL, FIELDOPS_DIRECT_SKILL } from '@pokernight/protocol';
import { askFieldDirector, askPart } from './fieldops-a2a.js';
import { a2aTimeoutMs } from './a2a.js';
import { fieldEstate, publishSeasonGraph, writeSeason, type EstateWriteReport } from './field-estate.js';
import { fieldOpsCast, fieldOpsCastAgents, fieldOpsDirector, type Env } from './env.js';

interface Attachment { playerId: string; name: string }
interface Meta {
  /** The owner's part — or `watch`: EVERY PART IS ITS AGENT'S and the owner looks on, which is the season as a pure test of the agents. */
  stagingId: string; owner: string; ownerName: string; scenario: string; role: RoleId | 'watch'; pace?: 'short' | 'full';
  club?: string; night?: string; casting?: boolean; topic?: string; director?: string;
  /** The last day whose records were written to the field app, and how that went. */
  estateDay?: number; estate?: EstateWriteReport & { at: number };
  /** Was the season published to the game's graph at the reveal, and if not why. */
  graph?: { ok: boolean; error?: string; at: number };
}
/** THE TEST OF ONE AGENT: what it was asked, what came back, and what the engine made of it. */
export interface AgentStats { asked: number; answered: number; applied: number; refused: number; unparsed: number; missed: number; ms: number[]; rested: number; byRules: number; empty?: number }

const PACE_MS = 5_000;
const TICK_MS = 2_000;
const REST_MS = 90_000;
const ATTENTION_MS = 20 * 60_000;
const PRESENCE_MS = 20_000;
const THINKING_AT_ONCE = 2;
const RULES_PER_WAKE = 3;
/** KV `CLUB_WIRES` key: every agent any season chartered — what a reset retires. */
export const CHARTERED_KEY = 'fieldops-chartered';
/** Acts that spend no day: the house plays the day's act after an agent answers one of these. */
const FREE_ACTS = new Set(['move', 'join', 'decline', 'invite', 'adopt', 'choose']);
/** A charter step that failed waits this long per failure before the next try. */
const CHARTER_BACKOFF_MS = 15_000;
export interface Charter { ref: { team: string } | { body: string }; spec: CharterSpec; progress: CharterProgress }
/** A day is at least this long per agent-played part, so every agent gets asked once a day. */
const MS_PER_AGENT_PER_DAY = 9_000;

export class FieldOpsDO extends DurableObject<Env> {
  private state: FieldOpsState | null = null;
  private meta: Meta | null = null;
  private stats: Record<RoleId, AgentStats> = {};
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
  private writing: Promise<void> | null = null;
  /** THE CHARTERS: one per team or body the season founded, keyed `team:<id>` / `body:<id>`, persisted step by step. */
  private charters: Record<string, Charter> = {};
  /** Members whose membership wires have been written, `team:<id>:<role>`. */
  private admitted: string[] = [];
  /** The `general` conversation per board (team id, or `org`), and the lines already carried there. */
  private boards: Record<string, string> = {};
  private talked = new Set<string>();
  private talking = false;
  private wordless = new Set<string>();
  private driving = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
      for (const r of ctx.storage.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM kv`).toArray()) {
        if (r.k === 'state') this.state = JSON.parse(r.v) as FieldOpsState | null;
        if (r.k === 'meta') this.meta = JSON.parse(r.v) as Meta;
        if (r.k === 'paused') this.paused = r.v === '1';
        if (r.k === 'taken') this.taken = JSON.parse(r.v) as Record<string, { role: RoleId; name: string }>;
        if (r.k === 'heard') this.heard = Number(r.v) || 0;
        if (r.k === 'stats') this.stats = JSON.parse(r.v) as Record<RoleId, AgentStats>;
        if (r.k === 'charters') this.charters = JSON.parse(r.v) as Record<string, Charter>;
        if (r.k === 'admitted') this.admitted = JSON.parse(r.v) as string[];
        if (r.k === 'boards') this.boards = JSON.parse(r.v) as Record<string, string>;
        if (r.k === 'talked') this.talked = new Set(JSON.parse(r.v) as string[]);
      }
    });
  }

  private save(): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO kv (k, v) VALUES ('state', ?), ('meta', ?), ('paused', ?), ('taken', ?), ('heard', ?), ('stats', ?), ('charters', ?), ('admitted', ?), ('boards', ?), ('talked', ?)`,
      JSON.stringify(this.state), JSON.stringify(this.meta), this.paused ? '1' : '0', JSON.stringify(this.taken), String(this.heard), JSON.stringify(this.stats), JSON.stringify(this.charters), JSON.stringify(this.admitted), JSON.stringify(this.boards), JSON.stringify([...this.talked].slice(-800)),
    );
    // The talk goes by the characters' OWN sessions and wires (`carryTalk`), not the commission's cast-messaging note.
    this.ctx.waitUntil(this.carryTalk().catch((e: unknown) => console.warn('[fieldops] carrying the talk threw:', String(e))));
  }


  /** The cast for a season: the person in their part, the estate's standing personas, the house's rules for the rest. */
  private castFor(roles: ReadonlyArray<{ id: RoleId; name: string }>, human: (r: RoleId) => { name: string; playerId: string } | null, scenarioId?: string): Casting[] {
    const minds = fieldOpsCastAgents(this.env);
    const standing = fieldOpsCast(this.env, scenarioId);
    let handed = 0;
    return roles.map((r) => {
      const person = human(r.id);
      if (person) {
        const own = standing.find((c) => c.role === r.id);
        return { role: r.id, agent: own?.agent ?? person.playerId, name: r.name, custodian: person.playerId, operator: 'human' as const, playerId: person.playerId, mind: 'human' as const, ...(person.name ? { playedBy: person.name } : {}), ...(own ? { personaCustodian: own.custodian } : {}) };
      }
      const own = standing.find((c) => c.role === r.id);
      if (own) return { role: r.id, agent: own.agent, name: r.name, custodian: own.custodian, operator: 'agent' as const, mind: 'agent' as const };
      const named = minds.length ? minds[handed++ % minds.length] : undefined;
      return named
        ? { role: r.id, agent: named, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'agent' as const }
        : { role: r.id, agent: `${r.id}.cast`, name: r.name, custodian: 'house', operator: 'agent' as const, mind: 'rules' as const };
    });
  }

  /** A day lasts long enough for every agent-played part to be asked once; the pace stretches to fit, never shrinks. */
  private paceFor(cast: Casting[], scenarioDayMinutes: number, wanted: 'short' | 'full'): number {
    const base = wanted === 'short' ? 0.33 : 1;
    const agents = cast.filter((c) => c.mind === 'agent').length;
    const needed = (agents * MS_PER_AGENT_PER_DAY) / (scenarioDayMinutes * 60_000);
    return Math.max(base, Math.min(2, needed));
  }

  private async open(b: { stagingId: string; owner: string; ownerName: string; scenario: string; role?: RoleId | 'watch'; pace?: 'short' | 'full' }, human: (r: RoleId) => { name: string; playerId: string } | null, extra: Partial<Meta>): Promise<void> {
    const pair = stagingOf(b.scenario)!;
    const cast = this.castFor(pair.scenario.roles, human, pair.scenario.id);
    // A SEASON OPENED AGAIN LEAVES ITS CHARTERED AGENTS BEHIND — they are in the chartered ledger for a reset to retire.
    this.charters = {}; this.admitted = [];
    const seed = randomSeed();
    const pace = this.paceFor(cast, pair.scenario.dayMinutes, b.pace === 'short' ? 'short' : 'full');
    this.state = openStaging({ scenario: pair.scenario, region: pair.region, cast, seedHex: bytesToHex(seed), seedCommit: seedCommit(seed), now: Date.now(), pace });
    this.meta = { stagingId: b.stagingId, owner: b.owner, ownerName: b.ownerName, scenario: pair.scenario.id, role: b.role ?? pair.scenario.roles[0]!.id, pace: b.pace === 'short' ? 'short' : 'full', ...(fieldOpsDirector(this.env) ? { director: fieldOpsDirector(this.env)! } : {}), ...extra, estateDay: 0 };
    this.stats = {};
    for (const c of cast) if (c.mind === 'agent') this.stats[c.role] = { asked: 0, answered: 0, applied: 0, refused: 0, unparsed: 0, missed: 0, ms: [], rested: 0, byRules: 0 };
    this.paused = false;
    this.lastMoved = {};
    this.save();
    this.heardFrom();
    await this.arm();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/open') {
      const b = (await request.json()) as { stagingId: string; owner: string; ownerName: string; scenario: string; role?: RoleId | 'watch'; restart?: boolean; pace?: 'short' | 'full' };
      const pair = stagingOf(b.scenario);
      if (!pair) return json({ error: `no such scenario: ${b.scenario}` }, 404);
      const wantsOther = (!!b.role && !!this.meta && this.meta.role !== b.role) || (!!b.pace && !!this.meta && (this.meta.pace ?? 'full') !== b.pace);
      if (this.state && !b.restart && !wantsOther && this.state.phase !== 'revealed') return json({ ok: true, staging: this.summary() });
      // WATCHING: no part is the owner's, so all sixteen are their agents' (or the house's where no persona stands).
      const role = b.role === 'watch' ? 'watch' : pair.scenario.roles.find((r) => r.id === b.role)?.id ?? pair.scenario.roles[0]!.id;
      await this.open({ ...b, role }, (r) => (role !== 'watch' && r === role ? { name: b.ownerName, playerId: b.owner } : null), {});
      return json({ ok: true, staging: this.summary() });
    }
    if (request.method === 'POST' && url.pathname === '/plan') {
      const b = (await request.json()) as { stagingId: string; club: string; night?: string; scenario: string; host: string; hostName: string; pace?: 'short' | 'full'; restart?: boolean };
      const pair = stagingOf(b.scenario);
      if (!pair) return json({ error: `no such scenario: ${b.scenario}` }, 404);
      if (this.state && !b.restart) return json({ ok: true, staging: this.summary(), cast: this.castList() });
      this.state = null; this.taken = {}; this.stats = {};
      this.meta = { stagingId: b.stagingId, owner: b.host, ownerName: b.hostName, scenario: pair.scenario.id, role: pair.scenario.roles[0]!.id, pace: b.pace === 'short' ? 'short' : 'full', club: b.club, ...(b.night ? { night: b.night } : {}), casting: true, ...(fieldOpsDirector(this.env) ? { director: fieldOpsDirector(this.env)! } : {}) };
      this.save();
      return json({ ok: true, staging: this.summary(), cast: this.castList() });
    }
    if (request.method === 'POST' && url.pathname === '/cast') {
      const b = (await request.json()) as { playerId: string; name: string; role: RoleId | null };
      if (!this.meta?.casting) {
        if (!this.state) return json({ error: 'this season is not casting' }, 409);
        if (b.role === null) return json({ error: 'the season has begun — a part taken now is yours for it' }, 409);
        if (this.state.cast.some((c) => c.playerId === b.playerId)) return json({ error: 'you are already in this season' }, 409);
        const seat = this.state.cast.find((c) => c.role === b.role);
        if (!seat) return json({ error: 'no such part' }, 404);
        if (seat.operator === 'human') return json({ error: 'somebody is already playing that part' }, 409);
        this.state = { ...this.state, cast: this.state.cast.map((c) => (c.role === b.role ? { ...c, custodian: b.playerId, operator: 'human' as const, playerId: b.playerId, mind: 'human' as const, ...(b.name ? { playedBy: b.name } : {}), ...(c.custodian !== 'house' && !c.personaCustodian ? { personaCustodian: c.custodian } : {}) } : c)) };
        this.save(); this.tellEverybody();
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
    if (request.method === 'POST' && url.pathname === '/curtain') {
      const b = (await request.json()) as { by: string };
      if (!this.meta?.casting) return json({ error: 'this season has already begun' }, 409);
      if (this.meta.owner !== b.by) return json({ error: 'the host opens the season' }, 403);
      const m = this.meta;
      await this.open({ stagingId: m.stagingId, owner: m.owner, ownerName: m.ownerName, scenario: m.scenario, pace: m.pace }, (r) => { const p = Object.entries(this.taken).find(([, t]) => t.role === r); return p ? { name: p[1].name, playerId: p[0] } : null; }, { club: m.club, ...(m.night ? { night: m.night } : {}), ...(m.topic ? { topic: m.topic } : {}), casting: false });
      return json({ ok: true, staging: this.summary() });
    }
    if (request.method === 'GET' && url.pathname === '/view') {
      const playerId = url.searchParams.get('playerId') ?? '';
      if (playerId) this.seenAt[playerId] = Date.now();
      this.catchUp();
      if (!this.state && !this.meta) return json({ error: 'no such season' }, 404);
      return json({ staging: this.summary(), view: this.state ? this.viewOf(playerId) : null, cast: this.castList(), agents: this.agentReport() });
    }
    if (request.method === 'POST' && url.pathname === '/estate') {
      // The operator (or the host) asks for the season's records to be written now rather than at the week's end.
      if (!this.state) return json({ error: 'no such season' }, 404);
      const r = await this.writeEstate(true);
      return json({ ok: r.ok, report: r }, r.ok ? 200 : 400);
    }
    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket upgrade' }, 426);
      const playerId = request.headers.get('x-player-id');
      if (!playerId || !this.state) return json({ error: 'no such season' }, 404);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [playerId]);
      server.serializeAttachment({ playerId, name: decodeURIComponent(request.headers.get('x-player-name') ?? '') } satisfies Attachment);
      this.catchUp(); this.heardFrom(); await this.arm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not found' }, 404);
  }

  private roleOfPlayer(playerId: string): RoleId | null { return this.state?.cast.find((c) => c.playerId === playerId)?.role ?? null; }
  private viewOf(playerId: string): FieldOpsView | null {
    if (!this.state) return null;
    const pair = stagingOf(this.state.scenario);
    return pair ? viewFor(this.state, pair.scenario, pair.region, this.roleOfPlayer(playerId)) : null;
  }
  private isHost(playerId: string): boolean { return !!this.meta && this.meta.owner === playerId; }
  private presentIds(): string[] {
    const out = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) { const who = ws.deserializeAttachment() as Attachment | null; if (who?.playerId) out.add(who.playerId); }
    const now = Date.now();
    for (const [id, at] of Object.entries(this.seenAt)) if (now - at < PRESENCE_MS) out.add(id);
    return [...out];
  }
  private readiness() {
    const here = new Set(this.presentIds());
    const expected = Object.entries(this.taken);
    const waitingFor = expected.filter(([id]) => !here.has(id)).map(([, t]) => t.name || 'somebody');
    return { taken: expected.length, present: expected.filter(([id]) => here.has(id)).length, waitingFor, everybodyHere: waitingFor.length === 0 };
  }
  /** THE AGENT REPORT: per agent-played part, what it was asked and what it did — the test's running tally. */
  private agentReport() {
    return Object.entries(this.stats).map(([role, s]) => ({ role, ...s, ms: undefined, avgMs: s.ms.length ? Math.round(s.ms.reduce((a, b) => a + b, 0) / s.ms.length) : null, muted: this.mute.get(role) ?? null, resting: (this.resting[role] ?? 0) > Date.now() }));
  }
  private summary() {
    const m = this.meta;
    if (!m) return null;
    const s = this.state;
    return {
      stagingId: m.stagingId, scenario: m.scenario, region: s?.region ?? stagingOf(m.scenario)?.region.id ?? '', role: m.role,
      day: s?.day ?? 0, week: s?.week ?? 0, phase: m.casting ? 'casting' : s?.phase ?? 'casting',
      deadline: s?.deadline ?? null, seedCommit: s?.seedCommit ?? '', paused: this.paused, startedAt: s?.startedAt ?? 0, endedAt: s?.endedAt ?? null,
      ...(m.club ? { club: m.club } : {}), ...(m.night ? { clubNight: m.night } : {}), ...(m.topic ? { topic: m.topic } : {}),
      host: m.owner, pace: m.pace ?? 'full', ...(m.director ? { director: m.director } : {}),
      ready: this.readiness(),
      estate: m.estate ? { ...m.estate, throughDay: m.estateDay ?? 0 } : null,
      graph: m.graph ?? null,
      charters: this.charterReport(),
    };
  }
  private castList() {
    const m = this.meta;
    const pair = m ? stagingOf(m.scenario) : null;
    if (!m || !pair) return [];
    return pair.scenario.roles.map((r) => {
      const person = Object.entries(this.taken).find(([, t]) => t.role === r.id);
      const playing = this.state?.cast.find((c) => c.role === r.id);
      return { role: r.id, name: r.name, kind: r.kind, blurb: r.blurb, look: r.look, team: r.team ?? null, takenBy: person ? person[1].name : playing?.operator === 'human' ? playing.playedBy ?? null : null, takenById: person ? person[0] : playing?.playerId ?? null, operator: person || playing?.operator === 'human' ? 'human' : 'agent' };
    });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment;
    type Incoming = { type?: string; action?: unknown; text?: string; on?: boolean };
    let m: Incoming | null = null;
    try { m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as Incoming; } catch { m = null; }
    if (!m?.type || !this.state) return;
    if (m.type === 'ping') { this.catchUp(); await this.arm(); return; }
    // A WATCHER HAS NO ACT TO SEND, so the page says when its person is actually there (their own pointer or key,
    // throttled) and that is what keeps sixteen agents' clocks running — a tab left open stops them like any other.
    if (m.type === 'attend') { this.heardFrom(); this.save(); this.catchUp(); await this.arm(); return; }
    if (m.type === 'join') { this.heardFrom(); this.save(); this.catchUp(); this.send(ws, { type: 'staging', staging: this.summary(), view: this.viewOf(who.playerId), agents: this.agentReport() }); await this.arm(); return; }
    if (m.type === 'pause') {
      if (!this.isHost(who.playerId)) { this.send(ws, { type: 'error', code: 'not-host', message: 'Your host holds the season.' }); return; }
      const on = m.on !== false;
      if (on && !this.paused) { this.paused = true; this.pausedAt = Date.now(); }
      else if (!on && this.paused) { const owed = Date.now() - this.pausedAt; if (this.state.deadline !== null) this.state = { ...this.state, deadline: this.state.deadline + owed }; this.paused = false; }
      this.heardFrom(); this.save(); await this.arm(); this.tellEverybody(); return;
    }
    this.heardFrom();
    const role = this.roleOfPlayer(who.playerId);
    if (!role) { this.send(ws, { type: 'error', code: 'watching', message: 'You are not in this season.' }); return; }
    const raw = m.type === 'say' ? { type: 'say', text: m.text } : m.action;
    const parsed = parseAction(raw);
    if (!parsed.ok) { this.send(ws, { type: 'error', code: parsed.code, message: parsed.message }); return; }
    const pair = stagingOf(this.state.scenario);
    if (!pair) return;
    const r = apply(this.state, pair.scenario, pair.region, role, parsed.action, Date.now(), 'human');
    if (!r.ok) { this.send(ws, { type: 'error', code: r.code, message: r.message }); return; }
    this.state = r.state;
    this.save(); this.tellEverybody(); this.charterWhatIsNew(); await this.arm();
  }
  override async webSocketClose(): Promise<void> { /* the alarm notices on its next wake */ }

  /** The clock, and the parts nobody is playing — each asked for its day, a few per wake. */
  override async alarm(): Promise<void> {
    if (!this.state || this.state.phase === 'revealed') return;
    if (!this.ctx.getWebSockets().length || this.paused) return;
    if (!this.attended()) return;
    const pair = stagingOf(this.state.scenario);
    if (!pair) return;
    const now = Date.now();
    let changed = false;
    if (this.state.phase === 'day') {
      const day = this.state.day;
      const waiting = this.state.cast
        .filter((c) => c.operator === 'agent' && (this.state!.acted[c.role] ?? 0) < day && now - (this.lastMoved[c.role] ?? 0) >= PACE_MS && !this.thinking.has(c.role))
        .sort((a, b) => (this.lastMoved[a.role] ?? 0) - (this.lastMoved[b.role] ?? 0));
      let rules = 0;
      for (const c of waiting) {
        const role = pair.scenario.roles.find((r) => r.id === c.role);
        if (!role) continue;
        const rested = (this.resting[c.role] ?? 0) <= now;
        if (c.mind === 'agent' && c.agent && rested) {
          if (this.thinking.size >= THINKING_AT_ONCE) continue;
          this.lastMoved[c.role] = now;
          this.thinking.add(c.role);
          void this.askOne(c.role, c.agent, pair.scenario.id);
          continue;
        }
        if (rules >= RULES_PER_WAKE) continue;
        rules += 1;
        this.lastMoved[c.role] = now;
        if (c.mind === 'agent') (this.stats[c.role] ??= blank()).byRules += 1;
        changed = this.playByRules(c.role, now) || changed;
      }
    }
    const ticked = tick(this.state, pair.scenario, pair.region, now);
    if (ticked.events.length) {
      this.state = ticked.state;
      changed = true;
      const dayEv = ticked.events.find((e): e is Extract<FieldOpsEvent, { type: 'day' }> => e.type === 'day');
      if (dayEv?.phase === 'interlude') { void this.direct(ticked.events).catch((e: unknown) => console.warn('[fieldops] the narration threw:', String(e))); void this.writeEstate(false); }
      // THE FIELD APP FOLLOWS THE SEASON BY THE DAY, not by the week: a day's end writes what the day produced, so a
      // person looking at field.faithnet.io beside the board sees the circle that was founded a minute ago.
      else if (dayEv?.phase === 'day' && this.state.day > 1) void this.writeEstate(false);
      if (this.state.phase === 'revealed') { void this.writeEstate(true); void this.publish(); }
    }
    if (changed) { this.save(); this.tellEverybody(); }
    this.charterWhatIsNew();
    if (this.state.phase !== 'revealed') await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  /** The house's own policy for one part: a move, a join, an adoption are free, so each is followed by the day's act. */
  private playByRules(role: RoleId, now: number): boolean {
    const pair = this.state ? stagingOf(this.state.scenario) : null;
    if (!this.state || !pair) return false;
    const part = pair.scenario.roles.find((r) => r.id === role);
    if (!part) return false;
    let changed = false;
    for (let step = 0; step < 4; step++) {
      const view = viewFor(this.state, pair.scenario, pair.region, role);
      const move = chooseAction(view, part.lines, Math.floor(now / PACE_MS) + step);
      if (!move) break;
      const done = apply(this.state, pair.scenario, pair.region, role, move.action, now, 'agent');
      if (!done.ok) break;
      this.state = done.state; changed = true;
      if (move.line && move.action.type !== 'say') {
        const said = apply(this.state, pair.scenario, pair.region, role, { type: 'say', text: move.line }, now, 'agent');
        if (said.ok) this.state = said.state;
      }
      if (!FREE_ACTS.has(move.action.type)) break;
    }
    return changed;
  }

  private catchUp(): void {
    const pair = this.state ? stagingOf(this.state.scenario) : null;
    if (!this.state || !pair || this.paused) return;
    let wrote = false;
    for (let i = 0; i < 8; i++) {
      const out = tick(this.state, pair.scenario, pair.region, Date.now());
      if (!out.events.length) break;
      this.state = out.state;
      wrote = true;
    }
    if (wrote) { this.save(); if (this.state.phase === 'revealed') { void this.writeEstate(true); void this.publish(); } }
  }

  /** ONE PART'S DAY, asked of the agent that plays it; what comes back is validated by the engine like anybody's, and counted. */
  private async askOne(role: RoleId, agent: string, scenarioId: string): Promise<void> {
    const st = (this.stats[role] ??= blank());
    try {
      const pair = stagingOf(scenarioId);
      const s0 = this.state;
      if (!pair || !s0) return;
      const part = pair.scenario.roles.find((r) => r.id === role);
      const view = viewFor(s0, pair.scenario, pair.region, role);
      const legal = view.you?.may.map((m) => m.action) ?? [];
      st.asked += 1;
      const out = await askPart(this.env, agent, {
        skill: FIELDOPS_ACT_SKILL, stagingId: this.meta?.stagingId ?? '', act: s0.day, role, roleName: part?.name ?? role,
        brief: `${part?.blurb ?? ''} What only you know: ${part?.secret ?? ''}`.trim(),
        view: view as unknown as Record<string, unknown>, legal,
        craft: [...CHARACTER_CRAFT, ...(pair.scenario.voice?.character ?? [])],
        deadlineMs: a2aTimeoutMs(this.env),
      }, a2aTimeoutMs(this.env));
      st.ms = [...st.ms, out.ms].slice(-20);
      // AN ANSWER WITH NOTHING IN IT IS A MISS, said out loud: an agent that replies but neither speaks nor acts — a
      // Home whose model did not go through (a 402 from its provider, a timeout) — is counted as not having answered,
      // so after three the house plays the part and the season moves, rather than a season full of silent "answers"
      // that looks exactly like one going well.
      const empty = out.ok && out.output.action === undefined && !out.output.say;
      if (empty) { st.empty = (st.empty ?? 0) + 1; console.warn(`[fieldops] ${role}'s agent answered with neither a line nor an act: ${out.raw}`); }
      // A PART THAT ACTS BUT NEVER SPEAKS is a part whose words are being lost somewhere between its Home and here —
      // the shape asks for a line every day. Said once per part per season, with the raw reply, so it can be read.
      if (out.ok && !empty && !out.output.say && !this.wordless.has(role)) { this.wordless.add(role); console.warn(`[fieldops] ${role}'s agent acted without a line: ${out.raw}`); }
      const miss: { ok: false; error: string; ms: number } | null = !out.ok ? out : empty ? { ok: false, error: `empty answer: ${out.raw.slice(0, 160)}`, ms: out.ms } : null;
      if (miss) {
        const out = miss;
        st.missed += 1;
        const permanent = /does not advertise|card unreachable|not an A2A agent card|is not JSON/.test(out.error);
        const misses = (this.misses[role] ?? 0) + 1;
        this.misses[role] = misses;
        console.warn(`[fieldops] ${agent} missed ${role} (${misses}): ${out.error}`);
        if (!permanent && misses >= 3) { this.resting[role] = Date.now() + REST_MS; this.misses[role] = 0; st.rested += 1; return; }
        if (permanent) {
          if (!this.mute.has(role)) { this.mute.set(role, out.error); console.warn(`[fieldops] ${role} is played by the house from here: ${out.error}`); }
          const cur0 = this.state;
          if (cur0) { this.state = { ...cur0, cast: cur0.cast.map((c) => (c.role === role ? { ...c, mind: 'rules' as const } : c)) }; this.save(); this.tellEverybody(); }
        }
        return;
      }
      if (!out.ok) return;
      st.answered += 1;
      this.misses[role] = 0;
      const now = Date.now();
      const base = this.state;
      const pair2 = stagingOf(base?.scenario ?? '');
      if (!base || !pair2) return;
      let changed = false;
      if (out.output.action !== undefined) {
        const parsed = parseAction(out.output.action);
        if (parsed.ok) {
          let cur = base;
          const done = apply(cur, pair2.scenario, pair2.region, role, parsed.action, now, 'agent');
          if (done.ok) {
            cur = done.state; changed = true;
            st.applied += 1;
            // A MOVE, A JOIN, AN ADOPTION ARE FREE, and an agent that answered one has a day still to spend: the house
            // spends it, so a thoughtful agent that answered "go to Evans" or "count me in" is not a part that lost its day.
            if (FREE_ACTS.has(parsed.action.type)) { this.state = cur; if (this.playByRules(role, now)) cur = this.state!; }
            this.state = cur;
          } else { st.refused += 1; console.warn(`[fieldops] ${role}'s agent tried something the season refused: ${done.code}`); }
        } else { st.unparsed += 1; console.warn(`[fieldops] ${role}'s agent answered in no shape the engine knows: ${parsed.code}`); }
      }
      if (out.output.say) {
        const cur = this.state ?? base;
        const said = apply(cur, pair2.scenario, pair2.region, role, { type: 'say', text: out.output.say }, now, 'agent');
        if (said.ok) { this.state = said.state; changed = true; }
      }
      if (changed) { this.save(); this.tellEverybody(); this.charterWhatIsNew(); }
    } finally {
      this.thinking.delete(role);
    }
  }

  /** The week's narration, asked of the director — a miss leaves the house's line. */
  private async direct(events: FieldOpsEvent[]): Promise<void> {
    const m = this.meta; const s = this.state;
    const pair = s ? stagingOf(s.scenario) : null;
    if (!s || !pair || !m?.director) return;
    const publicView = viewFor(s, pair.scenario, pair.region, null);
    const facts = [
      `Week ${s.week} is over; day ${s.day}.`,
      ...publicView.communities.map((c) => `${c.name}: Phase ${c.derived} (${c.reading ? `published ${c.reading.phase}` : 'no reading'}); ${c.counts.believers} believers, ${c.counts.baptized} baptised, ${c.bodies.length} bodies.`),
      ...events.filter((e) => e.type === 'stalled').map((e) => (e.type === 'stalled' ? `${s.bodies.find((b) => b.id === e.body)?.name ?? e.body} has stalled.` : '')),
    ];
    const fallback = events.find((e) => e.type === 'cue');
    const out = await askFieldDirector(this.env, m.director, {
      skill: FIELDOPS_DIRECT_SKILL, stagingId: m.stagingId, act: s.week, phase: s.phase,
      publicView: { teams: publicView.teams, communities: publicView.communities.map((c) => ({ id: c.id, name: c.name, derived: c.derived, reading: c.reading })), cast: publicView.cast.map((c) => ({ role: c.role, name: c.name, town: c.townName })), week: s.week, day: s.day } as unknown as Record<string, unknown>,
      facts, fallback: fallback?.type === 'cue' ? fallback.text : '', craft: [...DIRECTOR_CRAFT, ...(pair.scenario.voice?.director ?? [])], deadlineMs: a2aTimeoutMs(this.env),
    }, a2aTimeoutMs(this.env)).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    if (!out.ok) { console.warn('[fieldops] the director was quiet:', out.error); return; }
    const cur = this.state;
    if (!cur) return;
    this.state = { ...cur, log: [...cur.log, { type: 'cue', at: Date.now(), text: out.output.cue, by: 'director' } as FieldOpsEvent].slice(-1200) };
    this.save(); this.tellEverybody();
  }

  /** The season's records to the field app, through the last completed day — once per week's end, or on demand. */
  private async writeEstate(force: boolean): Promise<EstateWriteReport> {
    const s = this.state; const m = this.meta;
    const pair = s ? stagingOf(s.scenario) : null;
    if (!s || !m || !pair) return { ok: false, written: 0, failures: ['no season'] };
    if (this.writing) await this.writing;
    const since = m.estateDay ?? 0;
    const through = s.day;
    if (!force && through <= since) return m.estate ?? { ok: true, written: 0, failures: [] };
    const run = (async () => {
      const standing: Record<string, Record<string, Standing>> = {};
      for (const c of Object.values(this.charters)) if ('team' in c.ref && c.progress.standing) standing[c.ref.team] = c.progress.standing;
      const r = await writeSeason(this.env, s, pair.scenario, pair.region, m.stagingId, since, standing);
      if (this.meta) { this.meta.estate = { ...r, at: Date.now() }; if (r.ok || r.written > 0) this.meta.estateDay = through; this.save(); this.tellEverybody(); }
      if (!r.ok) console.warn(`[fieldops] the field app got ${r.written} records; not written: ${r.failures.join('; ')}`); else console.log(`[fieldops] ${r.written} records written to the field app through day ${through}`);
      return r;
    })();
    this.writing = run.then(() => undefined, () => undefined);
    return run;
  }
  private async publish(): Promise<void> {
    const s = this.state; const m = this.meta;
    const pair = s ? stagingOf(s.scenario) : null;
    if (!s || !m || !pair || m.graph?.ok) return;
    const r = await publishSeasonGraph(this.env, s, pair.region, m.stagingId);
    if (this.meta) { this.meta.graph = { ...r, at: Date.now() }; this.save(); this.tellEverybody(); }
    if (!r.ok) console.warn(`[fieldops] ${r.error}`); else console.log('[fieldops] the season is in the game\'s graph');
  }

  /**
   * THE CHARTERS. Every team and every founded body the season has and no charter yet is queued as the founding
   * character's act, with the character's custodian as signer; the queue is driven in the background to completion,
   * one checkpointed step at a time, and an agent that lands is attached to the season and written to the field app.
   * A charter that fails for good leaves a team or body with no agent — the season never waits on it.
   */
  private charterWhatIsNew(): void {
    const s = this.state;
    if (!s) return;
    let queued = false;
    for (const t of s.teams ?? []) {
      const key = `team:${t.id}`;
      if (t.agent || this.charters[key]) continue;
      this.charters[key] = { ref: { team: t.id }, spec: { kind: 'team', name: `${t.name} (game)`, purpose: t.purpose, custodian: '', steward: { sa: '', name: this.nameOf(t.steward) }, viewers: [], under: '' }, progress: { step: 'deploy', tries: 0, at: 0 } };
      queued = true;
    }
    for (const b of s.bodies) {
      const key = `body:${b.id}`;
      if (b.agent || this.charters[key] || (b.foundedDay === 0 && !b.recognizedFrom) || !b.facilitator) continue;
      this.charters[key] = { ref: { body: b.id }, spec: { kind: b.kind, name: `${b.name} (game)`, purpose: null, custodian: '', steward: { sa: '', name: this.nameOf(b.facilitator) }, viewers: [], under: '' }, progress: { step: 'deploy', tries: 0, at: 0 } };
      queued = true;
    }
    if (queued) this.save();
    this.ctx.waitUntil(this.driveCharters());
  }
  private nameOf(role: RoleId): string { const pair = this.state ? stagingOf(this.state.scenario) : null; return (pair && roleOf(pair.scenario, role)?.name) ?? role; }

  private async driveCharters(): Promise<void> {
    if (this.driving) return;
    this.driving = true;
    try {
      const estate = await fieldEstate(this.env);
      if (!estate) return;
      for (let guard = 0; guard < 40; guard++) {
        const s = this.state;
        if (!s) return;
        const now = Date.now();
        const next = Object.entries(this.charters).find(([, c]) => c.progress.step !== 'done' && c.progress.step !== 'failed' && now - c.progress.at >= c.progress.tries * CHARTER_BACKOFF_MS);
        if (!next) break;
        const [key, c] = next;
        // Who signs: the founding character's custodian; who sees: the members' custodians.
        const ref = c.ref;
        const founder = 'team' in ref ? s.teams.find((t) => t.id === ref.team)?.steward : s.bodies.find((b) => b.id === ref.body)?.facilitator;
        const persona = founder ? estate.workers[founder] : undefined;
        if (!founder || !persona) { c.progress = { ...c.progress, step: 'failed', error: `no persona for ${founder ?? 'the founder'} in the estate note`, at: now }; this.save(); continue; }
        const team = 'team' in ref ? s.teams.find((t) => t.id === ref.team) : s.teams.find((t) => t.id === s.bodies.find((b) => b.id === ref.body)?.team);
        const viewers = [...new Set((team?.members ?? []).map((m) => estate.workers[m]?.custodian).filter((h): h is string => !!h))];
        // A team hangs under the workspace; a body under its team once that team's agent has landed (the workspace until then).
        const under = 'team' in c.ref ? estate.workspace.sa : (team?.agent ?? estate.workspace.sa);
        c.spec = { ...c.spec, custodian: persona.custodian, steward: { sa: persona.sa, name: this.nameOf(founder) }, viewers, under };
        const p = await advance(estate, c.spec, c.progress, estate.workspace.custodian);
        c.progress = p;
        if (p.step === 'done' && p.sa) {
          const cur = this.state;
          if (cur) this.state = attachAgent(cur, c.ref, p.sa, c.spec.custodian);
          console.log(`[fieldops] ${c.spec.name} chartered at ${p.sa}, custodied by ${c.spec.custodian}`);
          await this.noteChartered({ sa: p.sa, kind: c.spec.kind, name: c.spec.name, custodian: c.spec.custodian, steward: c.spec.steward, viewers: [c.spec.custodian, estate.workspace.custodian, ...viewers], stagingId: this.meta?.stagingId ?? '' });
          this.save(); this.tellEverybody();
          void this.writeEstate(true);
        } else if (p.step === 'failed') { console.warn(`[fieldops] ${c.spec.name} could not be chartered: ${p.error}`); this.save(); this.tellEverybody(); }
        else { this.save(); if (p.error) { console.warn(`[fieldops] ${c.spec.name} ${p.step} (try ${p.tries}): ${p.error}`); this.tellEverybody(); } }
        void key;
      }
      // Charters made before the custodian was a steward, or before links hung under the workspace: repair them.
      let repaired = false;
      for (const c of Object.values(this.charters)) {
        const sa = c.progress.sa;
        if (!sa) continue;
        // A charter whose storage was granted under an older scope list goes back through STORAGE (a re-grant) and
        // then its ceremonies; a charter that FAILED at its ceremonies with an agent in hand is retried after a fix.
        if ((c.progress.step === 'done' || c.progress.step === 'failed' || c.progress.step === 'membership') && (c.progress.storageV ?? 0) !== STORAGE_V) { c.progress = { ...c.progress, step: 'storage', tries: 0, at: 0, error: undefined }; this.save(); repaired = true; continue; }
        if (c.progress.step === 'failed') { c.progress = { ...c.progress, step: 'membership', tries: 0, at: 0, error: undefined }; this.save(); repaired = true; continue; }
        if (c.progress.step !== 'done') continue;
        if (!c.spec.under) { const t = 'team' in c.ref ? undefined : this.state?.teams.find((x) => x.id === this.state?.bodies.find((b) => b.id === (c.ref as { body: string }).body)?.team); c.spec = { ...c.spec, under: 'team' in c.ref ? estate.workspace.sa : (t?.agent ?? estate.workspace.sa) }; }
        if (!c.progress.custodianSteward) {
          try { await stewardCustodian(estate, c.spec, sa); c.progress = { ...c.progress, custodianSteward: true }; repaired = true; this.save(); console.log(`[fieldops] ${c.spec.name}: ${c.spec.custodian} now stewards it`); }
          catch (e: unknown) { console.warn(`[fieldops] ${c.spec.name}: could not make ${c.spec.custodian} a steward: ${String(e)}`); }
        }
        if (!c.progress.parented) {
          const failures = await reparent(estate, c.spec, sa, estate.workspace.custodian);
          if (!failures.length) { c.progress = { ...c.progress, parented: true }; this.save(); console.log(`[fieldops] ${c.spec.name} now hangs under ${c.spec.under.slice(0, 10)}…`); }
          else console.warn(`[fieldops] ${c.spec.name}: not every link could be re-hung: ${failures.join('; ')}`);
        }
        // A charter from before the Home's ceremonies were run: back to the membership step, which the loop above takes.
        if (!c.progress.standing) { c.progress = { ...c.progress, step: 'membership', tries: 0, at: 0 }; this.save(); repaired = true; }
      }
      if (repaired) void this.writeEstate(true);
      await this.admitJoined(estate);
      if (repaired) this.ctx.waitUntil(this.driveCharters());
    } catch (e: unknown) { console.warn('[fieldops] chartering threw:', String(e)); }
    finally { this.driving = false; }
  }
  /** The second half of an invite: a member who joined gets the membership wire the team's custodian signs. */
  private async admitJoined(estate: NonNullable<Awaited<ReturnType<typeof fieldEstate>>>): Promise<void> {
    const s = this.state;
    if (!s) return;
    for (const t of s.teams ?? []) {
      if (!t.agent || !t.custodian) continue;
      for (const m of t.members) {
        const key = `team:${t.id}:${m}`;
        if (m === t.steward || this.admitted.includes(key)) continue;
        const persona = estate.workers[m];
        if (!persona) continue;
        const charter = this.charters[`team:${t.id}`];
        if (!charter || charter.progress.step !== 'done') continue; // the team's own ceremonies come first
        try {
          const standing = await admit(estate, t.custodian, { sa: t.agent, name: `${t.name} (game)`, under: estate.workspace.sa }, { sa: persona.sa, name: this.nameOf(m), custodian: persona.custodian }, estate.workspace.custodian, charter.progress.standing ?? {});
          charter.progress = { ...charter.progress, standing: { ...(charter.progress.standing ?? {}), ...standing } };
          this.admitted = [...this.admitted, key]; this.save(); this.tellEverybody();
          const mine = standing[persona.sa.toLowerCase()];
          console.log(`[fieldops] ${this.nameOf(m)} joined ${t.name}: membership ${mine?.membership ?? 'not recorded'}, credential ${mine?.credential?.slice(0, 10) ?? 'none'}`);
          void this.writeEstate(true);
        } catch (e: unknown) { console.warn(`[fieldops] ${this.nameOf(m)}'s membership of ${t.name} was not signed: ${String(e)}`); }
      }
    }
  }
  /**
   * THE TALK, CARRIED WHERE THE TEAM TALKS: what a character SAYS goes to its team's `general` (the field app's own
   * conversation on the team's board) as that character; a character on no team speaks on the organization's; what a
   * character WHISPERS is a direct message from its own agent to the other character's. Each line once; a refusal is
   * said in the log, never retried into a storm. A part with no persona (the house's rules with no agent) is silent here.
   */
  private async carryTalk(): Promise<void> {
    if (this.talking) return;
    this.talking = true;
    try {
      const s = this.state;
      const estate = await fieldEstate(this.env);
      if (!s || !estate) return;
      const partyOf = (role: RoleId) => { const w = estate.workers[role]; return w ? { sa: w.sa, name: w.name ?? role, custodian: w.custodian, persona: true as const } : null; };
      const sessionFor = async (role: RoleId) => { const p = partyOf(role); return p ? { party: p, ...(await sessionOf(estate, p)) } : null; };
      const recent = s.log.slice(-60).filter((e): e is Extract<FieldOpsEvent, { type: 'said' | 'whispered' }> => (e.type === 'said' || e.type === 'whispered') && e.at > s.startedAt);
      let changed = false;
      const tally = { lines: 0, posted: 0, sent: 0, failed: 0, nobody: 0 };
      for (const e of recent) {
        const key = `${e.type}:${e.at}:${e.by}`;
        if (this.talked.has(key)) continue;
        this.talked.add(key); changed = true; tally.lines += 1;
        const from = await sessionFor(e.by).catch((err: unknown) => { console.warn(`[fieldops] no session for ${e.by}'s character: ${String(err).slice(0, 160)}`); return null; });
        if (!from) { tally.nobody += 1; continue; }
        if (e.type === 'said') {
          const teamId = s.membership[e.by];
          const team = teamId ? s.teams.find((t) => t.id === teamId) : undefined;
          const boardKey = team?.agent ? team.id : 'org';
          const boardSa = team?.agent ?? estate.organization?.sa;
          if (!boardSa) continue;
          let channel = this.boards[boardKey];
          if (!channel) {
            // The team's founder opens its `general`; the organization's custodian opens the organization's.
            const opener = team ? await sessionFor(team.steward).catch(() => null) : null;
            const openerSession = opener?.homeSession ?? (await sessionOf(estate, { sa: '', name: estate.workspace.custodian, custodian: estate.workspace.custodian })).homeSession;
            channel = (await ensureGeneral(estate, openerSession, boardSa).catch(() => null)) ?? '';
            if (!channel) { console.warn(`[fieldops] no general conversation on ${team?.name ?? 'the organization'}'s board yet`); continue; }
            this.boards[boardKey] = channel;
          }
          const r = await postLine(estate, from.homeSession, boardSa, channel, e.text);
          if (r.ok) tally.posted += 1; else { tally.failed += 1; console.warn(`[fieldops] ${from.party.name}'s line stayed in the field (${team?.name ?? 'organization'}): ${r.error}`); }
        } else {
          const to = estate.workers[e.to];
          if (!to) continue;
          const r = await directMessage(estate, from.party, to.sa, `A whisper in the field, day ${s.day}`, e.text);
          if (r.ok) tally.sent += 1; else { tally.failed += 1; console.warn(`[fieldops] ${from.party.name}'s whisper to ${to.name} stayed in the field: ${r.error}`); }
        }
      }
      if (tally.lines) console.log(`[fieldops] talk carried: ${tally.lines} new of ${recent.length} recent — ${tally.posted} posted to a board, ${tally.sent} whispered, ${tally.failed} refused, ${tally.nobody} without a session`);
      if (changed) this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('boards', ?), ('talked', ?)`, JSON.stringify(this.boards), JSON.stringify([...this.talked].slice(-800)));
    } finally { this.talking = false; }
  }

  private async noteChartered(entry: Record<string, unknown>): Promise<void> {
    try {
      const raw = (await this.env.CLUB_WIRES?.get(CHARTERED_KEY)) ?? '[]';
      const list = JSON.parse(raw) as unknown[];
      list.push({ ...entry, at: new Date().toISOString() });
      await this.env.CLUB_WIRES?.put(CHARTERED_KEY, JSON.stringify(list));
    } catch (e: unknown) { console.warn('[fieldops] the chartered ledger was not written:', String(e)); }
  }
  /** What the charters are up to, for the page. */
  private charterReport(): Array<{ key: string; kind: string; name: string; step: string; sa: string | null; error: string | null; tries: number; standing: number }> {
    return Object.entries(this.charters).map(([key, c]) => ({ key, kind: c.spec.kind, name: c.spec.name, step: c.progress.step, sa: c.progress.sa ?? null, error: c.progress.error ?? null, tries: c.progress.tries, standing: Object.values(c.progress.standing ?? {}).filter((x) => x.credential).length }));
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
      this.send(ws, { type: 'staging', staging: this.summary(), view: this.viewOf(who.playerId), agents: this.agentReport() });
    }
  }
  private send(ws: WebSocket, msg: unknown): void { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } }
}

const blank = (): AgentStats => ({ asked: 0, answered: 0, applied: 0, refused: 0, unparsed: 0, missed: 0, ms: [], rested: 0, byRules: 0 });
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
