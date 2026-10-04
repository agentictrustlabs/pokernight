/**
 * THE SEASON'S RECORDS, WRITTEN WHERE THE FIELD APP READS THEM (docs/FIELD-OPERATIONS.md §6).
 *
 * field.faithnet.io draws a workspace from its agents' vaults: the workspace agent's `ws-*` rows, each team's
 * `team-*` rows and the records the team holds (`field/activities`, `field/circles`, `field/churches`,
 * `field/observations`), each body's `body-*` rows, and the workspace's `community-phase-result`s. This module turns
 * one season's log into those records and writes them, so a season a person played shows up in the field app as
 * real teams doing real-shaped work — every record TITLED AND PURPOSED AS A GAME'S, on a workspace that is the
 * game's own.
 *
 * WHO WRITES. A vault write needs a steward's session, and the Worker holds no person's bearer. The ESTATE NOTE
 * (`FIELDOPS_ESTATE`, JSON — a Worker secret, or KV `CLUB_WIRES` under `fieldops-estate`) names, for every agent the
 * operator chartered, the DEMO PERSON who custodies it; the Home lends a demo person's session to anybody who asks
 * (`/connect/demo-signin`), which is the door every walk script already uses. That is a DEMO estate's property and
 * is said here so nobody mistakes it for the production path: a real field would write through its own ceremony.
 *
 * IDEMPOTENT. Record ids are derived from the season and the event, so a week written twice is the same rows.
 */
import { sha256, stringToBytes } from 'viem';
import type { Body, CommunityDef, FieldOpsEvent, FieldOpsState, PhaseN, Region, Scenario, Support, TeamState, TownDef } from '@pokernight/fieldops';
import { DAYS_PER_WEEK, PHASE_NAMES, SOWING_CONVERSATIONS, phaseOf, roleOf } from '@pokernight/fieldops';
import type { Env } from './env.js';
import { DEFAULT_DOORS, type EstateDoors, type Standing } from './field-charter.js';
import { POE_FRAMEWORK, POE_FRAMEWORK_VERSION, dimensionsOf, poeLevelIri, poePhase } from './field-phase.js';

export interface EstateAgent { sa: string; custodian: string; name?: string; label?: string }
/**
 * THE ESTATE NOTE — what the operator chartered: the game's workspace (its realm), the partner churches' agents and
 * the cast's personas. TEAMS, CIRCLES AND CHURCHES ARE NOT IN IT: a season founds those, and the season object charters
 * each one as the founding character's act (`field-charter.ts`). The doors say where the estate's services answer.
 */
export interface FieldEstate extends EstateDoors {
  /** THE ORGANIZATION THAT GOVERNS THE WORKSPACE — the only thing that has members (the characters). A `.workspace` is a service. */
  organization?: EstateAgent & { name: string };
  workspace: EstateAgent & { name: string };
  partners: Record<string, EstateAgent & { name: string }>;
  workers: Record<string, EstateAgent>;
  /** The mark every record and name carries. */
  mark?: string;
}

export const ESTATE_KEY = 'fieldops-estate';
export const GAME_MARK = 'game';

export function parseEstate(raw: string): FieldEstate | null {
  try {
    const j = JSON.parse(raw) as Partial<FieldEstate>;
    if (!j.workspace?.sa) return null;
    return {
      home: j.home ?? 'https://www.faithnet.me', clientId: j.clientId ?? 'field-app', chainId: j.chainId ?? 34348,
      a2a: j.a2a ?? DEFAULT_DOORS.a2a, mcp: j.mcp ?? DEFAULT_DOORS.mcp, origin: j.origin ?? DEFAULT_DOORS.origin,
      deliveryServiceSa: j.deliveryServiceSa ?? DEFAULT_DOORS.deliveryServiceSa, interactionsServiceSa: j.interactionsServiceSa ?? DEFAULT_DOORS.interactionsServiceSa,
      workspace: j.workspace as FieldEstate['workspace'], ...(j.organization?.sa ? { organization: j.organization } : {}), partners: j.partners ?? {}, workers: j.workers ?? {}, ...(j.mark ? { mark: j.mark } : {}),
    };
  } catch { return null; }
}

/** The estate note: the secret, or the KV key, or nothing — and it says which it lacks. */
export async function fieldEstate(env: Pick<Env, 'FIELDOPS_ESTATE' | 'CLUB_WIRES'>): Promise<FieldEstate | null> {
  const raw = (env.FIELDOPS_ESTATE ?? '').trim() || (await env.CLUB_WIRES?.get(ESTATE_KEY)) || '';
  if (!raw) return null;
  const e = parseEstate(raw);
  if (!e) console.warn('[fieldops] the estate note is not the shape this Worker reads');
  return e;
}

// ── the Home's doors ─────────────────────────────────────────────────────────────────────────────────────
async function demoSignIn(home: string, clientId: string, handle: string): Promise<string | null> {
  const r = await fetch(`${home}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, client_id: clientId }) });
  const j = (await r.json().catch(() => ({}))) as { id_token?: string };
  return j.id_token ?? null;
}

/**
 * Home's library artifact id for a record — THE FIELD APP'S OWN RULE (`@engage/engage-home` `artifactId`): the folder,
 * the record's subject (the last segment of its `communityId`, `nosubject` when it has none), and an FNV hash over
 * `folder/name`. It has to be the same rule and not merely a stable one: a circle the season wrote and a person then
 * edits in the field app must land on ONE artifact, and an id the app would not derive forks a second copy beside it.
 */
const idPart = (s: string, max: number): string => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '').toLowerCase();
export function artifactId(folder: string, name: string, subject?: string | null): string {
  let h = 0x811c9dc5;
  const key = `${folder}/${name}`;
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const about = (subject ? idPart(String(subject).split(/[/#]/).filter(Boolean).slice(-1)[0] ?? '', 20) : '') || 'nosubject';
  return `${idPart(folder, 32) || 'x'}-${about}-${h.toString(36)}`;
}
const b64 = (text: string): string => btoa(unescape(encodeURIComponent(text)));

export interface FieldRecordOut { folder: string; record: Record<string, unknown> & { id: string; kind: string } }

async function saveBatch(home: string, token: string, org: string, records: FieldRecordOut[]): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  if (!records.length) return { ok: true, n: 0 };
  const artifacts = records.map(({ folder, record }) => ({ id: artifactId(folder, `${record.id}.json`, typeof record.communityId === 'string' ? record.communityId : null), folder, name: `${record.id}.json`, kind: 'json-ld', bytesB64: b64(JSON.stringify(record, null, 2)) }));
  // The library takes a batch at a time; two hundred records a week is a few calls.
  for (let i = 0; i < artifacts.length; i += 60) {
    const r = await fetch(`${home}/connect/library`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ org, action: 'save-batch', artifacts: artifacts.slice(i, i + 60) }) });
    if (!r.ok) return { ok: false, error: `library ${r.status}: ${(await r.text()).slice(0, 200)}` };
  }
  return { ok: true, n: records.length };
}

// ── the records ──────────────────────────────────────────────────────────────────────────────────────────
const FOLDER = {
  activity: 'field/activities', observation: 'field/observations', circle: 'field/circles', church: 'field/churches', phase: 'field/phase-results', assessment: 'field/phase-assessments', dimension: 'field/dimensions',
  wsBody: 'field/workspace-bodies', bodyProfile: 'field/body', bodyCommunity: 'field/body-communities', teamProfile: 'field/team', teamMembers: 'field/team-members', wsTeam: 'field/workspace-teams', wsAgent: 'field/workspace-agents', wsCommunity: 'field/workspace-communities',
  community: 'field/communities', identity: 'field/identities', geometry: 'field/geometry', workItem: 'field/work-items', focus: 'field/focus', plan: 'field/plans', support: 'field/support',
} as const;
/** The field app's id for a community DEFINED in play: its context record lives in the defining team's vault. */
export const definedCommunityId = (id: string): string => `peoplecommunity-${id}`;
const ACTIVITY_KIND: Record<string, string> = { visit: 'RelationshipVisit', share: 'GospelConversation', study: 'DiscipleshipTraining', found: 'CircleGathering', gather: 'CircleGathering', baptize: 'BaptismOrOrdinance', train: 'LeadershipDevelopment', recognize: 'OtherLocalNote', send: 'OtherLocalNote', coach: 'CoachingSession', report: 'CommunityResearch', support: 'SupportDelivery' };
const SUPPORT_KIND: Record<Support['resource'], string> = { funds: 'Funding', volunteers: 'MemberCare', venue: 'Travel', prayer: 'MemberCare' };
const band = (n: number): string => (n <= 1 ? '1' : n <= 4 ? '2-4' : n <= 9 ? '5-9' : n <= 19 ? '10-19' : '20+');
type Precision = 'settlement' | 'admin-area' | null;
const envelope = (sensitivity: 'L1' | 'L2' | 'L3', purpose: string, precision: Precision = null) => ({ sensitivity, precision, recurringPattern: false, purpose: `${purpose} — Field Operations (${GAME_MARK})` });
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const titled = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A pinned digest of one record, as the field app computes it: sha-256 over the JSON with its keys sorted. */
const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v);
const digestOf = (v: unknown): string => `sha256:${sha256(stringToBytes(JSON.stringify(canonical(v)))).slice(2)}`;

/**
 * A TOWN AS A SHAPE: a box about three kilometres across around the town's centre. Drawn by the game and said to be
 * (`source: 'local'`) — settlement-sized on purpose, so nothing the season places in a town is finer than the town.
 */
const townShape = (t: TownDef) => {
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  const [w, e, s, n] = [r(t.lng - 0.02), r(t.lng + 0.02), r(t.lat - 0.015), r(t.lat + 0.015)];
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
};

const GAME_LINE = 'A GAME agent of Field Operations at gamenight.faithnet.io — not a real team, church or workspace. Every record it holds is a season’s, marked as such.';
const GAME_NOTE = 'Field Operations — a game; the people are invented.';

/** The last phase result written per community — what the next one supersedes when the phase moves. */
export type PhaseSeries = Record<string, { phase: number; resultId: string; supersedes: string | null }>;
export interface SeasonRecords { team: Record<string, FieldRecordOut[]>; workspace: FieldRecordOut[]; body: Record<string, FieldRecordOut[]>; phases: PhaseSeries }

/**
 * A season's records since `sinceDay` (exclusive), grouped by the vault that holds them — keyed by the TEAM id for a
 * team's vault, by the body AGENT's address for a body's. A team or body with no agent yet has no vault; its records
 * wait for the charter to land (a week written twice is the same rows, so nothing is lost by waiting).
 *
 * WHERE EACH THING GOES IS WHERE THE FIELD APP LOOKS FOR IT, which is one vault per screen and never a merge: a
 * people community's own records (its context, its dimensions, its phase, its plan and work, the activities, the
 * circles and churches) live in the vault of the TEAM that stewards it; the workspace keeps the pointers and — because
 * its Progress, Research and Geography screens read the workspace's own vault when no people is pinned — a COPY of each
 * community's context, phase and place, said to be one. A body's vault keeps what is counted from the body's side.
 */
export function recordsFor(estate: FieldEstate, state: FieldOpsState, scenario: Scenario, region: Region, stagingId: string, sinceDay: number, now: string, standing: Record<string, Record<string, Standing>> = {}, prior: PhaseSeries = {}): SeasonRecords {
  const mark = estate.mark ?? GAME_MARK;
  const tag = stagingId.slice(0, 8);
  const team: Record<string, FieldRecordOut[]> = {};
  const body: Record<string, FieldRecordOut[]> = {};
  const workspace: FieldRecordOut[] = [];
  const phases: PhaseSeries = {};
  const into = (map: Record<string, FieldRecordOut[]>, k: string, r: FieldRecordOut) => (map[k] ??= []).push(r);
  const defOf = (id: string | null): CommunityDef | undefined => (id ? region.communities.find((c) => c.id === id) ?? (state.defined ?? []).find((c) => c.id === id) : undefined);
  // A registry community is its registry node; a community defined in play is the context record the team holds.
  const communityIri = (id: string | null) => { const d = defOf(id); return d ? (d.fictional ? definedCommunityId(d.id) : d.iri) : null; };
  const agentOf = (role: string) => estate.workers[role]?.sa ?? `role:${role}`;
  const nameOf = (role: string) => roleOf(scenario, role)?.name ?? role;
  const teams = (state.teams ?? []).filter((t): t is TeamState & { agent: string } => !!t.agent);
  const teamById = (id: string | null | undefined) => teams.find((t) => t.id === id);
  const teamOfRole = (role: string) => (state.membership ?? {})[role] ?? null;
  const dayIso = (day: number) => new Date(state.startedAt + (day - 1) * 86_400_000).toISOString();
  const asOf = dayIso(Math.max(1, state.day));
  const townOf = (id: string) => region.towns.find((x) => x.id === id);
  const bodyRec = (id: string) => `fo-${tag}-${id}`;
  // THE BODY'S TEAM: its own; a body sent out of a floor church by an older engine is its founder's team's; and the
  // registry's own church among a people a team has taken up is shown in THAT team's vault, as the registry's.
  const teamOfBody = (b: Body) => teamById(b.team) ?? (b.facilitator ? teamById(teamOfRole(b.facilitator)) : undefined) ?? teamById((state.worked ?? {})[b.community]);
  const isFloor = (b: Body) => b.foundedDay === 0 && !b.recognizedFrom;
  const writtenBodies = new Map(state.bodies.flatMap((b) => { const t = teamOfBody(b); return t ? [[b.id, t.id] as const] : []; }));

  // A place is written once into each vault that names it — the corridor's towns, and any town further off that a
  // people the team took up lives in or a body of its meets in.
  const placed = new Set<string>();
  const place = (teamId: string, townId: string) => { const town = townOf(townId); if (!town || placed.has(`${teamId}|${townId}`)) return; placed.add(`${teamId}|${townId}`); into(team, teamId, placeRecord(town, mark, now)); };

  // What the log says happened among each community, by the vault the activity is written to.
  const actsAmong: Record<string, number> = {};
  const activityIds: Record<string, string[]> = {};
  const firstAct: Record<string, string> = {};
  state.log.forEach((e, i) => {
    if (e.type !== 'acted' || !e.community || e.action === 'rest' || e.action === 'assess' || e.action === 'found-team') return;
    actsAmong[e.community] = (actsAmong[e.community] ?? 0) + 1;
    const t = teamOfRole(e.by);
    if (!t || !teamById(t)) return;
    (activityIds[`${t}|${e.community}`] ??= []).push(`fo-${tag}-act-${i}`);
    firstAct[`${t}|${e.community}|${e.action}`] ??= `fo-${tag}-act-${i}`;
  });

  // THE TEAMS, written whole each time: the profile, the roster (steward, members, the invited and who declined —
  // the roster row is the steward's act, written the day of the invite), and the workspace's rows for it. A team
  // STEWARDS the communities of its corridor, which is where the field app looks for a community's circles.
  for (const t of teams) {
    const corridor = region.corridors.find((c) => c.id === t.corridor);
    into(team, t.id, { folder: FOLDER.teamProfile, record: { kind: 'team-profile', id: 'profile', title: `${t.name} (${mark})`, updatedAt: now, envelope: envelope('L1', 'team profile'), team: t.agent, description: `GAME team founded on day ${t.foundedDay} of a Field Operations season by ${nameOf(t.steward)}${t.purpose ? ` — ${t.purpose}` : ''}; works the ${corridor?.name ?? t.corridor}. ${GAME_LINE}` } });
    // THE ROSTER ROW IS A PROJECTION of what the Home holds, never a claim of its own: `active` only when the member's
    // OWN join put an organization membership record and a countersigned credential at the Home (the field domain's
    // rule — "active is a claim only the member's act verifies"); `invited` until then; a declined invitation is no row.
    const held = standing[t.id] ?? {};
    const rosterRow = (sa: string, name: string, orgRole: string, invitedOnly: boolean) => {
      const h = held[sa.toLowerCase()];
      const active = !!h?.credential && !invitedOnly;
      return { folder: FOLDER.teamMembers, record: { kind: 'team-membership', id: `tm-${sa.toLowerCase()}`, title: name, updatedAt: now, envelope: envelope('L2', 'team roster'), team: t.agent, personRef: `eip155:${estate.chainId}:${sa.toLowerCase()}`, display: `${name} (${mark})`, role: orgRole, status: active ? 'active' : 'invited', joinedAt: dayIso(t.foundedDay),
        // aporg:OrganizationMembership (the organization's own record) and the ap:RelationshipCredential both parties signed.
        ...(h?.membership ? { membershipRecord: h.membership } : {}), ...(h?.credential ? { credential: h.credential } : {}), ...(h?.stewardship ? { stewardship: h.stewardship } : {}) } };
    };
    into(team, t.id, rosterRow(agentOf(t.steward), nameOf(t.steward), 'organization-steward', false));
    for (const m of t.members) if (m !== t.steward) into(team, t.id, rosterRow(agentOf(m), nameOf(m), 'member', false));
    for (const m of t.invited) into(team, t.id, rosterRow(agentOf(m), nameOf(m), 'member', true));
    // The people: the custodian stewards it at their Home and belongs to it (as the field app's creator does); the
    // workspace's custodian and each member's custodian belong to it. Their rows carry the names the ceremony used.
    for (const [sa, h] of Object.entries(held)) if (!Object.values(estate.workers).some((w) => w.sa.toLowerCase() === sa)) into(team, t.id, rosterRow(sa, h.who ?? sa, h.role === 'custodian' ? 'organization-steward' : 'member', false));
    workspace.push({ folder: FOLDER.wsTeam, record: { kind: 'ws-team', id: `team-${t.agent.toLowerCase()}`, title: `${t.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'workspace team'), workspace: estate.workspace.sa, team: t.agent, status: 'active' } });
    workspace.push({ folder: FOLDER.wsAgent, record: { kind: 'ws-agent', id: `agent-${t.agent.toLowerCase()}`, title: `${t.name} (${mark})`, updatedAt: now, envelope: envelope('L1', 'workspace directory'), workspace: estate.workspace.sa, agent: t.agent.toLowerCase(), agentKind: 'team', name: null, displayName: `${t.name} (${mark})`, description: `GAME team for the ${corridor?.name ?? t.corridor}, founded in play by ${nameOf(t.steward)}. ${GAME_LINE}`, avatar: null, source: 'steward', entitlement: null, refreshedAt: now } });

    // THE PLACES: every town of the team's corridor as a shape, so a circle's `placeId` and a community's bounds have
    // something on the map to stand on. The workspace keeps the same shapes for its own map.
    for (const town of region.towns.filter((x) => x.corridor === t.corridor)) place(t.id, town.id);

    // THE TEAM'S OWN WORK — what is not about one people: who has not answered, who backs the team.
    const supports = (state.supports ?? []).filter((x) => x.team === t.id);
    const orgWork = (id: string, title: string, status: 'done' | 'in-progress' | 'proposed', note: string, assignee: string | null = agentOf(t.steward)) =>
      into(team, t.id, { folder: FOLDER.workItem, record: { kind: 'work-item', id: `fo-${tag}-wi-${slug(t.id)}-${id}`, title: `${title} (${mark})`, updatedAt: now, envelope: envelope('L3', 'team work coordination'), communityId: null, planId: null, workPackage: null, assignee, due: null, priority: status === 'done' ? 'later' : status === 'in-progress' ? 'now' : 'next', status, blockReason: null, blockedBy: [], note: `${note} ${GAME_NOTE}`, sourceInteraction: null, outcomeActivityIds: [] } });
    const took = Object.entries(state.worked ?? {}).filter(([, tid]) => tid === t.id).map(([cid]) => defOf(cid)?.name ?? cid);
    orgWork('take-up', 'Take up the peoples of the corridor', took.length ? 'done' : 'in-progress', took.length ? `Taken up: ${took.join('; ')}.` : 'No people community taken up yet — nobody works among a people nobody has taken up.');
    for (const m of t.invited) orgWork(`hear-${slug(m)}`, `Hear back from ${nameOf(m)}`, 'in-progress', `${nameOf(m)} was asked onto the team and has not answered.`);
    orgWork('support', 'Ask a partner church to back the team', supports.length ? 'done' : 'proposed', supports.length ? `${plural(supports.length, 'gift')} received: ${[...new Set(supports.map((x) => `${x.resource} from ${region.partners.find((p) => p.id === x.partner)?.name ?? x.partner}`))].join('; ')}.` : 'No partner church has given yet.');
    for (const x of supports) {
      const partner = region.partners.find((p) => p.id === x.partner);
      into(team, t.id, { folder: FOLDER.support, record: { kind: 'support-need', id: `fo-${tag}-support-${slug(x.id)}`, title: `${titled(x.resource)} from ${partner?.name ?? x.partner} (${mark})`, updatedAt: now, envelope: envelope('L2', 'partner support'), supportKind: SUPPORT_KIND[x.resource], summary: `${partner?.name ?? x.partner} gave ${x.resource} to ${t.name} on day ${x.day} of the season. ${GAME_NOTE}`, communityId: null, neededBy: null, state: 'delivered', abstractedSummary: `A partner church gave ${x.resource} to a field team.` } });
    }
  }
  for (const town of region.towns) workspace.push(placeRecord(town, mark, now));

  // THE COMMUNITIES THE WORKSPACE WORKS WITH — the ones a team took up, stewarded by that team (where the field app
  // looks for a community's circles). The workspace keeps the pointer; the TEAM holds the community's context — who
  // these people are, in the steward's words, aligned to the registry's people group and bounded by the towns they
  // live in — exactly as the field app's own onboarding leaves it, and for a community DEFINED in play as "Define a new
  // People Community" does.
  const focusByTeam: Record<string, Array<{ subjectKind: string; subjectId: string; label: string; why: string; weight: number }>> = {};
  for (const [id, teamId] of Object.entries(state.worked ?? {})) {
    const t = teamById(teamId);
    const def = defOf(id);
    const c = state.communities[id];
    if (!t || !def || !c) continue;
    const reg = !def.fictional;
    const communityId = communityIri(id)!;
    const corridor = region.corridors.find((x) => x.id === def.corridor);
    const towns = def.towns.map(townOf).filter((x): x is TownDef => !!x);
    for (const town of towns) place(t.id, town.id);
    const mine = state.bodies.filter((b) => b.community === id);
    const circles = mine.filter((b) => b.kind === 'circle' && b.lifecycle !== 'RecognizedAsChurch');
    const churches = mine.filter((b) => b.kind === 'church');
    const derived = phaseOf(def, c, state.bodies);
    const latest = c.readings[c.readings.length - 1];
    workspace.push({ folder: FOLDER.wsCommunity, record: { kind: 'ws-community', id: `comm-${id}`, title: `${def.name} (${mark}${reg ? ' copy' : ', defined in play'})`, updatedAt: now, envelope: envelope('L2', 'workspace community'), workspace: estate.workspace.sa, communityId, steward: t.agent, status: 'active' } });

    // WHO THE PEOPLE ARE (the registry's identity, cited — never a phase) and the community's alignment to it.
    const identityId = reg ? `pgi-${slug(def.people.name)}-${def.people.ropId ?? def.people.peid ?? slug(def.people.pgId ?? 'x')}` : null;
    const registrySource = { label: 'Global.Church public registry (gc-public)', url: /^https?:/.test(def.iri) ? def.iri : 'https://graph.global.church/', publisher: 'Global.Church', retrievedAt: region.registryReadAt.slice(0, 10) };
    const peopleSource = { label: 'PeopleGroups.org people-group registry', url: 'https://www.peoplegroups.org/', publisher: 'PeopleGroups.org / IMB', retrievedAt: region.registryReadAt.slice(0, 10) };
    if (identityId && (def.people.ropId || def.people.peid || def.people.pgId)) {
      const identity: FieldRecordOut = { folder: FOLDER.identity, record: {
        kind: 'identity', id: identityId, title: def.people.name, updatedAt: now, envelope: envelope('L1', 'people-group identity, copied from the registry'),
        name: def.people.name, ropId: def.people.ropId ?? null, peid: def.people.peid ?? null, pgId: def.people.pgId ?? null, affinity: null, cluster: null,
        primaryLanguage: def.people.language ? titled(def.people.language) : null, primaryReligion: def.people.religion ? titled(def.people.religion) : null,
        registryClaims: [...def.claims.filter((x) => !/^phase|^estimate/i.test(x.label)), ...(def.people.homeCountry ? [{ label: 'home country', value: def.people.homeCountry, source: 'gc-public' }] : [])],
        sources: [peopleSource, registrySource],
      } };
      if (!(team[t.id] ?? []).some((r) => r.record.kind === 'identity' && r.record.id === identityId)) into(team, t.id, identity);
      if (!workspace.some((r) => r.record.kind === 'identity' && r.record.id === identityId)) workspace.push(identity);
    }
    const partners = region.partners.filter((p) => p.corridor === def.corridor);
    const context: FieldRecordOut = { folder: FOLDER.community, record: {
      kind: 'community-context', id: `community-${id}`, title: `${def.name} (${mark}${reg ? ' copy' : ', defined in play'})`, updatedAt: now, envelope: envelope('L3', 'community definition', 'settlement'),
      communityId, steward: t.agent,
      definition: reg
        ? `${def.people.name} living in the ${corridor?.name ?? def.corridor}${towns.length ? ` — ${towns.map((x) => x.name).join(', ')}` : ''}.${def.people.language ? ` Heart language ${titled(def.people.language)}.` : ''}${def.people.homeCountry ? ` Home country ${def.people.homeCountry}.` : ''}${def.population ? ` About ${def.population.toLocaleString('en-US')} people by the season's estimate (${def.claims.find((x) => /^estimate/i.test(x.label))?.value ?? 'no census line'}).` : ''} Taken up by ${t.name} in a Field Operations season — a GAME's copy of the registry's community, and nothing here is an assessment of the real one.`
        : `${def.definition ?? ''} — DEFINED IN A FIELD OPERATIONS SEASON by ${def.definedBy ? nameOf(def.definedBy) : 'a part'}: an INVENTED people community, not a registry node and not a real community. ${GAME_LINE}`,
      definitionConfidence: 'low', aliases: [def.people.name],
      facets: { languages: def.people.language ? [titled(def.people.language)] : [], religions: def.people.religion ? [titled(def.people.religion)] : [], geography: `${towns.map((x) => x.name).join(', ') || def.towns.join(', ')} — ${corridor?.name ?? def.corridor}`, segments: [], socialNetwork: '' },
      // THE BODY OF PEOPLE THIS COMMUNITY IS, as a specification: a people, a language, and the towns that bound it —
      // each town a shape the team holds, which is what puts the community on the map.
      segment: { segmentId: `segment-${id}`, label: def.name, realizesSpecification: { specId: `spec-${id}`, label: `${def.people.name} in ${towns.map((x) => x.name).join(', ') || def.corridor}`,
        constraints: [
          { dimension: 'ethnicity', operator: 'equals', literal: def.people.name, role: 'primarily-identity-defining', confidence: reg ? 'medium' : 'low' },
          ...(def.people.language ? [{ dimension: 'language', operator: 'equals', literal: titled(def.people.language), role: 'descriptive', confidence: 'medium' }] : []),
          ...towns.map((x) => ({ dimension: 'usual-residence', operator: 'spatially-within', featureValue: x.id, role: 'scope-bounding', quantifier: 'primarily', confidence: 'medium' })),
        ],
        features: towns.map((x) => ({ featureId: x.id, label: x.name, source: 'local' })) } },
      fieldContext: {
        access: c.presenceDays > 0 ? `${plural(c.presenceDays, 'day')} of presence and ${plural(c.visits, 'visit')} this season.` : 'Nobody has been among them yet this season.',
        receptivity: `${plural(c.conversations, 'gospel conversation')}, ${plural(c.seekers, 'seeker')}, ${plural(c.believers, 'believer')}, ${plural(c.baptized, 'baptised', 'baptised')} on the season's record.`,
        nearCultureBelievers: churches.length + circles.length ? `${plural(circles.length, 'circle')} and ${plural(churches.length, 'church', 'churches')} among them.` : 'No circle or church among them yet.',
        ...(partners.length ? { bridges: `Partner churches in the corridor: ${partners.slice(0, 4).map((p) => p.name).join('; ')}.` } : {}),
        ...(def.people.language ? { languageByCohort: `${titled(def.people.language)} at home.` } : {}),
      },
      alignments: reg && identityId ? [{ identityId: def.people.pgId ?? identityId, scheme: 'rop3', key: def.people.ropId ?? def.people.peid ?? def.people.pgId ?? null, confidence: 'medium', rationale: `The registry's own community node (${def.iri}) names this people; the season copied the alignment and did not test it.` }] : [],
      nodeRole: null,
      openQuestions: [...(derived.blockedBy ? [`What stands between here and the next phase: ${derived.blockedBy}.`] : []), ...(reg ? [] : ['Which registry people group, if any, do these people align to? (unresolved — a game\'s invention)'])],
      sources: reg ? [registrySource, peopleSource] : [],
    } };
    into(team, t.id, context);
    workspace.push(context);

    // THE DIMENSIONS, and the phase the field app's criteria give them — written whole each time. The result keeps
    // its id while the phase holds and is superseded (result to result, with the reason) when the phase moves.
    const assessor = agentOf(latest?.by ?? t.steward);
    const dims = dimensionsOf(def, c, state.bodies, true, actsAmong[id] ?? 0);
    const evidence = (activityIds[`${t.id}|${id}`] ?? []).slice(-8);
    const dimRecords = dims.map((d) => ({ kind: 'dimension-assessment', id: `fo-${tag}-dim-${id}-${d.id.toLowerCase()}`, title: `${d.id} ${d.name} — ${def.name} (${mark})`, updatedAt: now, envelope: envelope('L3', 'dimension assessment'), communityId, dimensionId: d.id, level: d.level, supportedBy: evidence, assessedBy: assessor, assessedAt: asOf, confidence: d.confidence, rationale: `${d.rationale} Read off the season's counters on day ${state.day}. ${GAME_NOTE}` }));
    for (const record of dimRecords) into(team, t.id, { folder: FOLDER.dimension, record });
    const outcome = poePhase(dims, { corpus: 'the season\'s own records', asOf: asOf.slice(0, 10) });
    const before = prior[id];
    const held = before && before.phase === outcome.phase;
    const resultId = held ? before.resultId : `fo-${tag}-phase-${id}-d${state.day}`;
    const supersedes = held ? before.supersedes : before?.resultId ?? null;
    const assessmentId = resultId.replace(`fo-${tag}-phase-`, `fo-${tag}-assess-`);
    phases[id] = { phase: outcome.phase, resultId, supersedes };
    const phaseTitle = `Phase ${outcome.phase} · ${outcome.label} — ${def.name} (${mark})`;
    const assessment: FieldRecordOut = { folder: FOLDER.assessment, record: {
      kind: 'community-phase-assessment', id: assessmentId, title: phaseTitle, updatedAt: now, envelope: envelope('L2', 'phase assessment'), communityId,
      framework: POE_FRAMEWORK, frameworkVersion: POE_FRAMEWORK_VERSION, disposition: 'assigned', producedResultId: resultId,
      readings: dimRecords.map((r) => ({ dimensionId: r.dimensionId, level: r.level, recordId: r.id, assessedAt: r.assessedAt, digest: digestOf(r) })),
      asOf, assessedBy: assessor, assessedAt: asOf,
      rationale: `Read at day ${state.day} of a Field Operations season from the season's own counters, under the toolkit's criteria.${latest ? ` ${nameOf(latest.by)}'s last published reading (day ${latest.day}) said P${latest.phase} on the registry's scale;` : ' No steward has published a reading;'} the season's records derive P${derived.phase} there (${PHASE_NAMES[derived.phase]}). The two scales are different rulers. A game — nothing here assesses a real community.`,
    } };
    const result: FieldRecordOut = { folder: FOLDER.phase, record: {
      kind: 'community-phase-result', id: resultId, title: phaseTitle, updatedAt: now, envelope: envelope('L2', 'phase reading'), communityId, fromAssessmentId: assessmentId,
      assignedLevel: poeLevelIri(outcome.phase), phase: outcome.phase, phaseLabel: outcome.label, qualifier: outcome.phase === 0 && latest?.qualifier ? latest.qualifier : null,
      satisfiedCriteria: outcome.satisfied, blockedByCriteria: outcome.blockedBy, blockedFromPhase: outcome.blockedFromPhase,
      provenanceMode: 'derived', lastVerifiedAt: asOf, supersedes, supersessionReason: supersedes ? 'field-change' : null, simulated: true, game: 'field-operations',
    } };
    into(team, t.id, assessment); into(team, t.id, result);
    workspace.push(assessment, result);

    // THE PLAN AND THE WORK: the road from here to a church that sends, as the season's own ladder — what is done, what
    // is under way and what the first open rung is waiting on. The plan interprets nothing a campaign sent.
    const barrier = (state.trail ?? []).find((x) => x.kind === 'barrier' && x.target === id && x.until >= state.day);
    const stalled = circles.find((b) => b.lifecycle === 'Stalled');
    const gens = churches.filter((b) => b.lifecycle !== 'Stalled').reduce((m, b) => Math.max(m, b.generation), 0);
    const act = (action: string) => { const a = firstAct[`${t.id}|${id}|${action}`]; return a ? [a] : []; };
    const rungs: Array<{ key: string; title: string; done: boolean; started: boolean; note: string; outcome: string[] }> = [
      { key: 'presence', title: 'Be present among them', done: c.presenceDays >= 1, started: false, note: `${plural(c.presenceDays, 'day')} of presence, ${plural(c.visits, 'visit')}.`, outcome: act('visit') },
      { key: 'witness', title: `Hold ${SOWING_CONVERSATIONS} gospel conversations`, done: c.conversations >= SOWING_CONVERSATIONS, started: c.conversations > 0, note: `${c.conversations} of ${SOWING_CONVERSATIONS} on record; ${plural(c.seekers, 'seeker')}.`, outcome: act('share') },
      { key: 'baptism', title: 'See a first baptism', done: c.baptized >= 1, started: c.believers > 0 || c.studies > 0, note: `${plural(c.believers, 'believer')}, ${plural(c.studies, 'discovery study', 'discovery studies')} running, ${plural(c.baptized, 'baptised', 'baptised')}.`, outcome: act('baptize') },
      { key: 'circle', title: 'Gather a circle', done: circles.length + churches.length > 0, started: c.studies > 0, note: circles.length ? `${circles.map((b) => b.name).join('; ')}.` : 'No circle yet — a discovery study that keeps meeting becomes one.', outcome: act('found') },
      { key: 'church', title: 'See a circle recognised as a church', done: churches.length > 0, started: circles.some((b) => b.lifecycle === 'Active'), note: 'A church is recognised when a circle is active with six believers, three baptised and a leader of its own.', outcome: act('recognize') },
      { key: 'send', title: 'Send a daughter church', done: gens >= 2, started: mine.some((b) => b.parent !== null), note: gens >= 2 ? `The deepest church lineage is generation ${gens}.` : 'No church has sent a daughter church.', outcome: act('send') },
    ];
    const open = rungs.filter((r) => !r.done);
    const planId = `fo-${tag}-plan-${id}`;
    const weekEnd = dayIso(Math.ceil(Math.max(1, state.day) / DAYS_PER_WEEK) * DAYS_PER_WEEK).slice(0, 10);
    into(team, t.id, { folder: FOLDER.plan, record: {
      kind: 'local-plan', id: planId, title: `Season plan — ${def.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'local plan of a season — not a campaign acceptance'),
      interpretsProjection: `season:${tag}:${id}`, projectionVersion: 0, owner: `${t.name} (${mark})`, communityId,
      localObjectives: [open[0] ? `${open[0].title} — ${derived.blockedBy ?? open[0].note}` : 'Keep the churches sending.', `Reach ${PHASE_NAMES[Math.min(7, derived.phase + 1) as PhaseN]} on the registry's scale (now P${derived.phase}).`],
      acceptedWorkPackages: rungs.map((r) => r.title), localConstraints: [...(barrier ? [barrier.text] : []), ...(stalled ? [`${stalled.name} has stalled — nobody has gathered it since day ${stalled.lastGatheredDay}.`] : [])],
      supportNeedIds: [], startedAt: dayIso(t.foundedDay).slice(0, 10), reviewAt: weekEnd, state: 'active', dispositionId: `season:${tag}:${id}`,
    } });
    rungs.forEach((r, i) => {
      const first = open[0]?.key === r.key;
      const blocked = first && (barrier || (r.key === 'church' && stalled));
      const status = r.done ? 'done' : blocked ? 'blocked' : first || r.started ? 'in-progress' : open[1]?.key === r.key ? 'accepted' : 'proposed';
      into(team, t.id, { folder: FOLDER.workItem, record: {
        kind: 'work-item', id: `fo-${tag}-wi-${id}-${i + 1}-${r.key}`, title: `${r.title} — ${def.name} (${mark})`, updatedAt: now, envelope: envelope('L3', 'local work coordination within this people community'),
        communityId, planId, workPackage: r.title, assignee: agentOf(t.steward), due: first ? weekEnd : null, priority: r.done ? 'later' : first ? 'now' : open[1]?.key === r.key ? 'next' : 'later', status,
        blockReason: blocked ? (barrier?.text ?? `${stalled!.name} has stalled.`) : null, blockedBy: [], note: `${r.note} ${GAME_NOTE}`, sourceInteraction: null, outcomeActivityIds: r.done ? r.outcome : [],
      } });
    });
    // WHAT THE TEAM HOLDS IN FRONT OF IT for this people: the open rung, then the bodies that need somebody.
    const entries = [
      ...(open[0] ? [{ subjectKind: 'work-item', subjectId: `fo-${tag}-wi-${id}-${rungs.indexOf(open[0]) + 1}-${open[0].key}`, label: open[0].title, why: derived.blockedBy ?? open[0].note }] : []),
      ...mine.filter((b) => writtenBodies.get(b.id) === t.id && b.lifecycle !== 'RecognizedAsChurch').map((b) => ({ subjectKind: b.kind === 'circle' ? 'formation-community' : 'ekklesia-community', subjectId: bodyRec(b.id), label: b.name, why: b.lifecycle === 'Stalled' ? `Stalled — not gathered since day ${b.lastGatheredDay}.` : `${b.lifecycle}: ${plural(b.believers, 'believer')}, ${plural(b.baptized, 'baptised', 'baptised')}, ${plural(b.leaders, 'leader')}.` })),
      { subjectKind: 'local-plan', subjectId: planId, label: `Season plan — ${def.name}`, why: `Reviewed at the week's end (${weekEnd}).` },
    ];
    into(team, t.id, { folder: FOLDER.focus, record: { kind: 'focus-list', id: `fo-${tag}-focus-${id}`, title: `Focus — ${def.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'team focus'), communityId, assertedBy: agentOf(t.steward), assertedAt: asOf, entries: entries.map((e, i) => ({ ...e, rank: i + 1 })), note: `What ${t.name} holds in front of it among ${def.name}, from the season's records. ${GAME_NOTE}` } });
    (focusByTeam[t.id] ??= []).push({ subjectKind: 'community-context', subjectId: `community-${id}`, label: def.name, why: `P${derived.phase} on the registry's scale — ${derived.blockedBy ?? 'nothing stands in the way'}.`, weight: (stalled || barrier ? 100 : 0) + derived.phase * 10 + c.conversations });
  }
  for (const t of teams) {
    const entries = (focusByTeam[t.id] ?? []).sort((a, b) => b.weight - a.weight).slice(0, 8);
    if (entries.length) into(team, t.id, { folder: FOLDER.focus, record: { kind: 'focus-list', id: `fo-${tag}-focus-team`, title: `Focus — ${t.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'team focus'), communityId: null, assertedBy: agentOf(t.steward), assertedAt: asOf, entries: entries.map(({ weight: _w, ...e }, i) => ({ ...e, rank: i + 1 })), note: `The peoples ${t.name} has taken up, the ones under pressure and the furthest along first. ${GAME_NOTE}` } });
  }

  const observationsOf: Record<string, FieldRecordOut[]> = {};
  const observe = (t: TeamState & { agent: string }, community: string, record: FieldRecordOut) => { into(team, t.id, record); (observationsOf[community] ??= []).push(record); };
  state.log.forEach((e: FieldOpsEvent, i: number) => {
    if (e.type === 'acted' && e.day > sinceDay && e.action !== 'rest' && e.action !== 'assess' && e.action !== 'found-team') {
      const t = teamOfRole(e.by);
      if (!t || !teamById(t)) return;
      const participants = (e.outcome.participants ?? 0) + (e.outcome.believers ?? 0) + (e.outcome.seekers ?? 0) + (e.outcome.baptized ?? 0);
      // An activity happens IN a body only when that body's record is in the same vault — a reference the reader cannot follow is not one.
      const inBody = e.body && writtenBodies.get(e.body) === t ? bodyRec(e.body) : null;
      place(t, e.town);
      into(team, t, { folder: FOLDER.activity, record: {
        kind: 'activity', id: `fo-${tag}-act-${i}`, title: `${e.text} (${mark})`.slice(0, 160), updatedAt: now, envelope: envelope('L3', 'activity', 'settlement'),
        activityKind: ACTIVITY_KIND[e.action] ?? 'OtherLocalNote', communityId: communityIri(e.community), contextRef: inBody, occurredAt: dayIso(e.day), recordedAt: now, recordedBy: agentOf(e.by),
        participantBand: participants ? band(participants) : null, languages: roleOf(scenario, e.by)?.languages ?? [], note: `${e.text} Day ${e.day} of a Field Operations season — a game; the people are invented.`, locationState: 'coarse', placeId: e.town,
      } });
    }
    if (e.type === 'reported' && e.day > sinceDay) {
      const t = teamById(teamOfRole(e.by));
      if (!t) return;
      observe(t, e.community, { folder: FOLDER.observation, record: {
        kind: 'observation', id: `fo-${tag}-obs-${i}`, title: `Observation, day ${e.day} — ${defOf(e.community)?.name ?? e.community} (${mark})`, updatedAt: now, envelope: envelope('L2', 'observation'),
        subjectRef: communityIri(e.community) ?? e.community, evidenceKind: 'GroupFormation', content: `${e.text} (Field Operations — a game.)`, observedAt: dayIso(e.day), recordedAt: now, observedBy: agentOf(e.by),
        method: 'field-report', respondentRole: 'worker', confidence: 'medium', verification: 'V1', modelDerived: state.cast.find((c) => c.role === e.by)?.mind === 'agent',
      } });
    }
    // WHAT THE ROAD BROUGHT is an observation about access, by the steward of the team that works those people.
    if (e.type === 'trail' && e.day > sinceDay) {
      const community = defOf(e.target) ? e.target : state.bodies.find((b) => b.id === e.target)?.community ?? null;
      const t = community ? teamById((state.worked ?? {})[community]) : undefined;
      if (!community || !t) return;
      observe(t, community, { folder: FOLDER.observation, record: {
        kind: 'observation', id: `fo-${tag}-obs-${i}`, title: `${titled(e.kind)}, day ${e.day} — ${e.targetName} (${mark})`, updatedAt: now, envelope: envelope('L2', 'observation'),
        subjectRef: communityIri(community) ?? community, evidenceKind: 'AccessCondition', content: `${e.text} (Field Operations — a game.)`, observedAt: dayIso(e.day), recordedAt: now, observedBy: agentOf(t.steward),
        method: 'field-report', respondentRole: 'worker', confidence: 'medium', verification: 'V1', modelDerived: false,
      } });
    }
  });
  // Every body the season has — written whole each time, because a body's counts move every week. A circle carries
  // its HEALTH (the counts and the practices a season can know), dated and attributed; a church its own counts.
  for (const b of state.bodies) {
    const t = teamOfBody(b);
    if (!t) continue;
    const def = defOf(b.community);
    const communityId = communityIri(b.community);
    const floor = isFloor(b);
    const started = state.bodies.filter((x) => x.parent === b.id && writtenBodies.has(x.id)).length;
    const observer = b.facilitator ? agentOf(b.facilitator) : t.agent;
    place(t.id, b.town);
    const title = `${b.name} (${mark}${floor ? ' — the registry’s church, as the season found it' : ''})`;
    const common = { updatedAt: now, communityId, parentId: b.parent && writtenBodies.get(b.parent) === t.id ? bodyRec(b.parent) : null, facilitator: b.facilitator ? agentOf(b.facilitator) : null, languages: def?.people.language ? [def.people.language] : [], placeId: b.town, meetsAt: 'weekly', bodyAgent: b.agent, lifecycleObservedAt: asOf, lifecycleObservedBy: observer };
    if (b.kind === 'circle') into(team, t.id, { folder: FOLDER.circle, record: {
      kind: 'formation-community', id: bodyRec(b.id), title, envelope: envelope('L3', 'circle', 'settlement'), formationKind: b.believers > 0 ? 'DiscipleshipCircle' : 'DiscoveryCircle',
      lifecycle: b.lifecycle === 'Stalled' ? 'Stalled' : b.lifecycle === 'RecognizedAsChurch' ? 'RecognizedAsChurch' : b.lifecycle === 'Forming' ? 'Forming' : 'Active', participantCount: b.participants,
      health: { seekers: Math.max(0, b.participants - b.believers), believers: b.believers, baptized: b.baptized, leaders: b.leaders, groupsStarted: started, appointedLeaders: b.leaders > 0, practicesBaptism: b.baptized > 0, makingDisciples: b.believers > 0, regularTeaching: state.day - b.lastGatheredDay <= DAYS_PER_WEEK },
      healthObservedAt: asOf, healthObservedBy: observer, healthFramework: 'acts2-gapp', ...common } });
    else into(team, t.id, { folder: FOLDER.church, record: { kind: 'ekklesia-community', id: bodyRec(b.id), title, envelope: envelope('L3', 'church', 'settlement'), lifecycle: b.lifecycle === 'Multiplying' ? 'Multiplying' : b.lifecycle === 'Stalled' ? 'Stalled' : b.lifecycle === 'Forming' ? 'Forming' : 'Established', recognizedFromId: b.recognizedFrom && writtenBodies.get(b.recognizedFrom) === t.id ? bodyRec(b.recognizedFrom) : null, believers: b.believers, baptized: b.baptized, leaders: b.leaders, ...common } });
    if (b.agent && !floor) {
      into(body, b.agent, { folder: FOLDER.bodyProfile, record: { kind: 'body-profile', id: 'profile', title: `${b.name} (${mark})`, updatedAt: now, envelope: envelope('L1', 'body profile'), body: b.agent, bodyType: b.kind, description: `A ${b.kind} founded in a Field Operations season — a GAME body, not a real congregation. ${b.name}, generation ${b.generation}, ${b.believers} believers, ${b.baptized} baptised, ${b.leaders} leaders.` } });
      if (def && communityId) into(body, b.agent, { folder: FOLDER.bodyCommunity, record: { kind: 'body-community', id: `bc-${slug(communityId).slice(0, 64).replace(/-+$/, '')}`, title: `${def.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'body community'), body: b.agent, communityId, participantCount: b.participants, status: 'active' } });
      // What was seen among the body's people, counted from the body's side (where the workspace's Progress looks).
      for (const o of observationsOf[b.community] ?? []) into(body, b.agent, o);
      workspace.push({ folder: FOLDER.wsBody, record: { kind: 'ws-body', id: `body-${b.agent.toLowerCase()}`, title: `${b.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'workspace body'), workspace: estate.workspace.sa, body: b.agent, bodyType: b.kind, status: 'active', team: t.agent } });
    }
  }
  return { team, workspace, body, phases };
}

function placeRecord(town: TownDef, mark: string, now: string): FieldRecordOut {
  return { folder: FOLDER.geometry, record: { kind: 'geo-feature', id: `place-${town.id}`, title: `${town.name} (${mark} — an approximate town area)`, updatedAt: now, envelope: envelope('L1', 'reference geography', 'settlement'), featureId: town.id, label: town.name, source: 'local', geometry: townShape(town), properties: { population: town.population, churches: town.churches, corridor: town.corridor }, rationale: 'A box about three kilometres across around the town’s centre, drawn by the game so a season’s records have a place to stand — not a published boundary.' } };
}

export interface EstateWriteReport { ok: boolean; written: number; failures: string[]; /** The phase series as this write left it — kept by the caller only when the write landed. */ phases?: PhaseSeries }

/** Write a season's records since `sinceDay` to every vault that holds them. Never throws; says what it could not do. */
export async function writeSeason(env: Pick<Env, 'FIELDOPS_ESTATE' | 'CLUB_WIRES'>, state: FieldOpsState, scenario: Scenario, region: Region, stagingId: string, sinceDay: number, standing: Record<string, Record<string, Standing>> = {}, prior: PhaseSeries = {}): Promise<EstateWriteReport> {
  const estate = await fieldEstate(env);
  if (!estate) return { ok: false, written: 0, failures: ['no estate note: this deployment writes nothing to the field app'] };
  const now = new Date().toISOString();
  const out = recordsFor(estate, state, scenario, region, stagingId, sinceDay, now, standing, prior);
  const failures: string[] = [];
  let written = 0;
  const tokens = new Map<string, string | null>();
  const tokenFor = async (handle: string) => { if (!tokens.has(handle)) tokens.set(handle, await demoSignIn(estate.home, estate.clientId, handle).catch(() => null)); return tokens.get(handle) ?? null; };
  const write = async (who: EstateAgent, label: string, records: FieldRecordOut[]) => {
    if (!records.length) return;
    const token = await tokenFor(who.custodian);
    if (!token) { failures.push(`${label}: ${who.custodian} could not sign in`); return; }
    const r = await saveBatch(estate.home, token, who.sa, records).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    if (!r.ok) failures.push(`${label}: ${r.error}`); else written += r.n;
  };
  for (const [teamId, records] of Object.entries(out.team)) {
    const t = (state.teams ?? []).find((x) => x.id === teamId);
    if (t?.agent && t.custodian) await write({ sa: t.agent, custodian: t.custodian }, `team ${t.name}`, records); else failures.push(`team ${teamId}: no agent yet`);
  }
  for (const [sa, records] of Object.entries(out.body)) {
    const b = state.bodies.find((x) => x.agent?.toLowerCase() === sa.toLowerCase());
    if (b?.custodian) await write({ sa, custodian: b.custodian }, `body ${b.name}`, records); else failures.push(`body ${sa.slice(0, 10)}: no custodian known`);
  }
  await write(estate.workspace, 'workspace', out.workspace);
  return { ok: failures.length === 0, written, failures, phases: out.phases };
}

// ── the public graph ─────────────────────────────────────────────────────────────────────────────────────
export const GAME_GRAPH = 'https://graph.global.church/g/gamenight/field-operations';
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

/** The season's founded bodies and readings as triples in the game's own named graph — marked, and about the game's copies. */
export function seasonTriples(state: FieldOpsState, region: Region, stagingId: string): string {
  const FO = 'https://skills.demo/fieldops#';
  const base = `https://gamenight.faithnet.io/fieldops/${stagingId}`;
  const L: string[] = [];
  for (const b of state.bodies) {
    if (b.foundedDay === 0 && !b.recognizedFrom) continue;
    const def = region.communities.find((c) => c.id === b.community);
    const iri = `<${base}/body/${b.id}>`;
    L.push(`${iri} a <${FO}${b.kind === 'circle' ? 'Circle' : 'Church'}> , <${FO}GameAgent> , <https://ontology.global.church/core#${b.kind === 'circle' ? 'FormationCommunity' : 'EkklesiaCommunity'}> ;`);
    L.push(`  <${FO}isGame> true ; <${FO}isSimulated> true ; <http://www.w3.org/2000/01/rdf-schema#label> "${esc(b.name)} (game)" ;`);
    if (def) L.push(`  <https://agentictrustlabs.dev/ns/agentic-trust#aboutSubject> <${def.iri}> ;`);
    if (b.agent) L.push(`  <https://agentictrustlabs.dev/ns/agentic-trust#agentAddress> "${esc(b.agent)}" ;`);
    L.push(`  <${FO}generation> ${b.generation} ; <${FO}believers> ${b.believers} ; <${FO}baptized> ${b.baptized} ; <${FO}leaders> ${b.leaders} ; <${FO}foundedDay> ${b.foundedDay} .`);
  }
  for (const def of state.defined ?? []) {
    L.push(`<${base}/community/${def.id}> a <${FO}FieldCommunity> , <${FO}GameAgent> ; <${FO}isGame> true ; <${FO}isSimulated> true ; <${FO}isFictional> true ;`);
    L.push(`  <http://www.w3.org/2000/01/rdf-schema#label> "${esc(def.name)} (game, defined in play)" ; <${FO}definition> "${esc(def.definition ?? '')}" .`);
  }
  for (const def of [...region.communities, ...(state.defined ?? [])]) {
    const c = state.communities[def.id];
    const latest = c?.readings[c.readings.length - 1];
    if (!latest) continue;
    L.push(`<${base}/reading/${def.id}> a <${FO}Reading> , <https://ontology.global.church/core#CommunityPhaseResult> ; <${FO}isSimulated> true ;`);
    L.push(`  <https://agentictrustlabs.dev/ns/agentic-trust#aboutSubject> <${base}/community/${def.id}> ;${def.fictional ? '' : ` <${FO}registryCommunity> <${def.iri}> ;`}`);
    L.push(`  <https://ontology.global.church/core#assignedLevel> <https://ontology.global.church/core#lvl-npl-p${latest.phase}> ; <${FO}day> ${latest.day} .`);
  }
  return L.join('\n');
}

/** Publish the season to the game's graph, if this deployment holds a registry credential. Never throws. */
export async function publishSeasonGraph(env: Pick<Env, 'GRAPHDB_URL' | 'GRAPHDB_BASIC'>, state: FieldOpsState, region: Region, stagingId: string): Promise<{ ok: boolean; error?: string }> {
  const url = (env.GRAPHDB_URL ?? '').trim();
  const basic = (env.GRAPHDB_BASIC ?? '').trim();
  if (!url || !basic) return { ok: false, error: 'no registry credential: the season is not published to the graph' };
  const triples = seasonTriples(state, region, stagingId);
  if (!triples) return { ok: true };
  const update = `DELETE { GRAPH <${GAME_GRAPH}> { ?s ?p ?o } } WHERE { GRAPH <${GAME_GRAPH}> { ?s ?p ?o . FILTER(STRSTARTS(STR(?s), "https://gamenight.faithnet.io/fieldops/${stagingId}")) } };\nINSERT DATA { GRAPH <${GAME_GRAPH}> {\n${triples}\n} }`;
  try {
    const r = await fetch(`${url}/repositories/gc-public/statements`, { method: 'POST', headers: { authorization: `Basic ${btoa(basic)}`, 'content-type': 'application/sparql-update' }, body: update, signal: AbortSignal.timeout(20_000) });
    return r.ok ? { ok: true } : { ok: false, error: `graph ${r.status}: ${(await r.text()).slice(0, 200)}` };
  } catch (e) { return { ok: false, error: String(e) }; }
}
