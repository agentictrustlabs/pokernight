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
import type { FieldOpsEvent, FieldOpsState, Region, Scenario, TeamState } from '@pokernight/fieldops';
import { PHASE_NAMES, phaseOf, roleOf } from '@pokernight/fieldops';
import type { Env } from './env.js';
import { DEFAULT_DOORS, type EstateDoors, type Standing } from './field-charter.js';

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

/** Home's library artifact id for a folder + name — the same FNV the field seeds use, so a re-write is an update. */
export function artifactId(folder: string, name: string): string {
  let h = 0x811c9dc5;
  const key = `${folder}/${name}`;
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${folder.replace(/\W+/g, '-').slice(0, 32) || 'x'}-none-${h.toString(36)}`;
}
const b64 = (text: string): string => btoa(unescape(encodeURIComponent(text)));

export interface FieldRecordOut { folder: string; record: Record<string, unknown> & { id: string; kind: string } }

async function saveBatch(home: string, token: string, org: string, records: FieldRecordOut[]): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  if (!records.length) return { ok: true, n: 0 };
  const artifacts = records.map(({ folder, record }) => ({ id: artifactId(folder, `${record.id}.json`), folder, name: `${record.id}.json`, kind: 'json-ld', bytesB64: b64(JSON.stringify(record, null, 2)) }));
  // The library takes a batch at a time; two hundred records a week is a few calls.
  for (let i = 0; i < artifacts.length; i += 60) {
    const r = await fetch(`${home}/connect/library`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ org, action: 'save-batch', artifacts: artifacts.slice(i, i + 60) }) });
    if (!r.ok) return { ok: false, error: `library ${r.status}: ${(await r.text()).slice(0, 200)}` };
  }
  return { ok: true, n: records.length };
}

// ── the records ──────────────────────────────────────────────────────────────────────────────────────────
const FOLDER = { activity: 'field/activities', observation: 'field/observations', circle: 'field/circles', church: 'field/churches', phase: 'field/phase-results', wsBody: 'field/workspace-bodies', bodyProfile: 'field/body', bodyCommunity: 'field/body-communities', teamProfile: 'field/team', teamMembers: 'field/team-members', wsTeam: 'field/workspace-teams', wsAgent: 'field/workspace-agents', wsCommunity: 'field/workspace-communities', community: 'field/communities' } as const;
/** The field app's id for a community DEFINED in play: its context record lives in the defining team's vault. */
export const definedCommunityId = (id: string): string => `peoplecommunity-${id}`;
const ACTIVITY_KIND: Record<string, string> = { visit: 'RelationshipVisit', share: 'GospelConversation', study: 'DiscipleshipTraining', found: 'CircleGathering', gather: 'CircleGathering', baptize: 'BaptismOrOrdinance', train: 'LeadershipDevelopment', recognize: 'OtherLocalNote', send: 'OtherLocalNote', coach: 'CoachingSession', report: 'CommunityResearch', support: 'SupportDelivery' };
const band = (n: number): string => (n <= 1 ? '1' : n <= 4 ? '2-4' : n <= 9 ? '5-9' : n <= 19 ? '10-19' : '20+');
const envelope = (sensitivity: 'L1' | 'L2' | 'L3', purpose: string) => ({ sensitivity, precision: null, recurringPattern: false, purpose: `${purpose} — Field Operations (${GAME_MARK})` });

const GAME_LINE = 'A GAME agent of Field Operations at gamenight.faithnet.io — not a real team, church or workspace. Every record it holds is a season’s, marked as such.';

/**
 * A season's records since `sinceDay` (exclusive), grouped by the vault that holds them — keyed by the TEAM id for a
 * team's vault, by the body AGENT's address for a body's. A team or body with no agent yet has no vault; its records
 * wait for the charter to land (a week written twice is the same rows, so nothing is lost by waiting).
 */
export function recordsFor(estate: FieldEstate, state: FieldOpsState, scenario: Scenario, region: Region, stagingId: string, sinceDay: number, now: string, standing: Record<string, Record<string, Standing>> = {}): { team: Record<string, FieldRecordOut[]>; workspace: FieldRecordOut[]; body: Record<string, FieldRecordOut[]> } {
  const mark = estate.mark ?? GAME_MARK;
  const tag = stagingId.slice(0, 8);
  const team: Record<string, FieldRecordOut[]> = {};
  const body: Record<string, FieldRecordOut[]> = {};
  const workspace: FieldRecordOut[] = [];
  const into = (map: Record<string, FieldRecordOut[]>, k: string, r: FieldRecordOut) => (map[k] ??= []).push(r);
  // A registry community is its registry node; a community defined in play is the context record the team holds.
  const communityIri = (id: string | null) => (id ? (region.communities.find((c) => c.id === id)?.iri ?? ((state.defined ?? []).some((c) => c.id === id) ? definedCommunityId(id) : null)) : null);
  const agentOf = (role: string) => estate.workers[role]?.sa ?? `role:${role}`;
  const nameOf = (role: string) => roleOf(scenario, role)?.name ?? role;
  const teams = (state.teams ?? []).filter((t): t is TeamState & { agent: string } => !!t.agent);
  const teamById = (id: string | null) => teams.find((t) => t.id === id);
  const teamOfRole = (role: string) => (state.membership ?? {})[role] ?? null;
  const dayIso = (day: number) => new Date(state.startedAt + (day - 1) * 86_400_000).toISOString();

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
  }
  // THE COMMUNITIES THE WORKSPACE WORKS WITH — the ones a team took up, stewarded by that team (where the field app
  // looks for a community's circles); a community DEFINED in play gets its context record in the team's vault and
  // the workspace keeps the pointer, exactly as the field app's "Define a new People Community" does.
  for (const [id, teamId] of Object.entries(state.worked ?? {})) {
    const t = teamById(teamId);
    if (!t) continue;
    const reg = region.communities.find((c) => c.id === id);
    const def = reg ?? (state.defined ?? []).find((c) => c.id === id);
    if (!def) continue;
    const communityId = reg ? reg.iri : definedCommunityId(id);
    workspace.push({ folder: FOLDER.wsCommunity, record: { kind: 'ws-community', id: `comm-${id}`, title: `${def.name} (${mark}${reg ? ' copy' : ', defined in play'})`, updatedAt: now, envelope: envelope('L2', 'workspace community'), workspace: estate.workspace.sa, communityId, steward: t.agent, status: 'active' } });
    if (!reg) {
      const town = region.towns.find((x) => x.id === def.towns[0]);
      into(team, t.id, { folder: FOLDER.community, record: {
        kind: 'community-context', id: `community-${id}`, title: `${def.name} (${mark}, defined in play)`, updatedAt: now, envelope: envelope('L2', 'community definition'),
        communityId, steward: t.agent, definition: `${def.definition ?? ''} — DEFINED IN A FIELD OPERATIONS SEASON by ${def.definedBy ? nameOf(def.definedBy) : 'a part'}: an INVENTED people community, not a registry node and not a real community. ${GAME_LINE}`,
        definitionConfidence: 'low', aliases: [def.people.name], ...(def.people.language ? { facets: { language: def.people.language } } : {}),
        fieldContext: { placeIds: def.towns, placeLabel: town?.name ?? def.towns[0] }, alignments: [], openQuestions: ['Which registry people group, if any, do these people align to? (unresolved — a game\'s invention)'], sources: [{ kind: 'game', label: 'Field Operations season', ref: `season ${tag}` }],
      } });
    }
  }

  state.log.forEach((e: FieldOpsEvent, i: number) => {
    if (e.type === 'acted' && e.day > sinceDay && e.action !== 'rest' && e.action !== 'assess' && e.action !== 'found-team') {
      const t = teamOfRole(e.by);
      if (!t || !teamById(t)) return;
      const participants = (e.outcome.participants ?? 0) + (e.outcome.believers ?? 0) + (e.outcome.seekers ?? 0) + (e.outcome.baptized ?? 0);
      into(team, t, { folder: FOLDER.activity, record: {
        kind: 'activity', id: `fo-${tag}-act-${i}`, title: `${e.text} (${mark})`, updatedAt: now, envelope: envelope('L2', 'activity'),
        activityKind: ACTIVITY_KIND[e.action] ?? 'OtherLocalNote', communityId: communityIri(e.community), contextRef: e.body, occurredAt: dayIso(e.day), recordedAt: now, recordedBy: agentOf(e.by),
        participantBand: participants ? band(participants) : null, languages: roleOf(scenario, e.by)?.languages ?? [], note: `${e.text} Day ${e.day} of a Field Operations season — a game; the people are invented.`, locationState: 'coarse', placeId: e.town,
      } });
    }
    if (e.type === 'reported' && e.day > sinceDay) {
      const t = teamOfRole(e.by);
      if (!t || !teamById(t)) return;
      into(team, t, { folder: FOLDER.observation, record: {
        kind: 'observation', id: `fo-${tag}-obs-${i}`, title: `Observation, day ${e.day} (${mark})`, updatedAt: now, envelope: envelope('L2', 'observation'),
        subjectRef: communityIri(e.community) ?? e.community, evidenceKind: 'GroupFormation', content: `${e.text} (Field Operations — a game.)`, observedAt: dayIso(e.day), recordedAt: now, observedBy: agentOf(e.by),
        method: 'field-report', respondentRole: 'worker', confidence: 'medium', verification: 'V1', modelDerived: state.cast.find((c) => c.role === e.by)?.mind === 'agent',
      } });
    }
  });
  // Every body the season has that holds an agent — written whole each time, because a body's counts move every week.
  for (const b of state.bodies) {
    if (b.foundedDay === 0 && !b.recognizedFrom) continue; // the registry's own floor church is not the season's, whatever it has done since
    // A body with no team of its own (sent out of a floor church by an older engine) is its founder's team's.
    const t = teamById(b.team) ?? (b.facilitator ? teamById(teamOfRole(b.facilitator)) : undefined);
    if (!t) continue;
    const def = region.communities.find((c) => c.id === b.community);
    const common = { updatedAt: now, communityId: def?.iri ?? null, parentId: b.parent, facilitator: b.facilitator ? agentOf(b.facilitator) : null, languages: def?.people.language ? [def.people.language] : [], placeId: b.town, meetsAt: 'weekly', bodyAgent: b.agent, lifecycleObservedAt: now, lifecycleObservedBy: t.agent };
    if (b.kind === 'circle') into(team, t.id, { folder: FOLDER.circle, record: { kind: 'formation-community', id: `fo-${tag}-${b.id}`, title: `${b.name} (${mark})`, envelope: envelope('L3', 'circle'), formationKind: 'DiscoveryCircle', lifecycle: b.lifecycle === 'Stalled' ? 'Stalled' : b.lifecycle === 'RecognizedAsChurch' ? 'RecognizedAsChurch' : b.lifecycle === 'Forming' ? 'Forming' : 'Active', participantCount: b.participants, ...common } });
    else into(team, t.id, { folder: FOLDER.church, record: { kind: 'ekklesia-community', id: `fo-${tag}-${b.id}`, title: `${b.name} (${mark})`, envelope: envelope('L3', 'church'), lifecycle: b.lifecycle === 'Multiplying' ? 'Multiplying' : b.lifecycle === 'Stalled' ? 'Stalled' : 'Established', recognizedFromId: b.recognizedFrom ? `fo-${tag}-${b.recognizedFrom}` : null, believers: b.believers, baptized: b.baptized, leaders: b.leaders, ...common } });
    if (b.agent) {
      into(body, b.agent, { folder: FOLDER.bodyProfile, record: { kind: 'body-profile', id: 'profile', title: `${b.name} (${mark})`, updatedAt: now, envelope: envelope('L1', 'body profile'), body: b.agent, bodyType: b.kind, description: `A ${b.kind} founded in a Field Operations season — a GAME body, not a real congregation. ${b.name}, generation ${b.generation}, ${b.believers} believers, ${b.baptized} baptised, ${b.leaders} leaders.` } });
      if (def) into(body, b.agent, { folder: FOLDER.bodyCommunity, record: { kind: 'body-community', id: `bc-${def.iri.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)}`, title: `${def.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'body community'), body: b.agent, communityId: def.iri, participantCount: b.participants, status: 'active' } });
      workspace.push({ folder: FOLDER.wsBody, record: { kind: 'ws-body', id: `body-${b.agent.toLowerCase()}`, title: `${b.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'workspace body'), workspace: estate.workspace.sa, body: b.agent, bodyType: b.kind, status: 'active', team: t.agent } });
    }
  }
  // The steward's readings, as phase results on the workspace — the season's, marked.
  for (const def of region.communities) {
    const c = state.communities[def.id];
    const latest = c?.readings[c.readings.length - 1];
    if (!c || !latest || latest.day <= sinceDay) continue;
    const derived = phaseOf(def, c, state.bodies);
    workspace.push({ folder: FOLDER.phase, record: {
      kind: 'community-phase-result', id: `fo-${tag}-phase-${def.id}`, title: `Phase ${latest.phase} — ${def.name} (${mark})`, updatedAt: now, envelope: envelope('L2', 'phase reading'),
      communityId: def.iri, fromAssessmentId: `fo-${tag}-assess-${def.id}-${latest.day}`, assignedLevel: `https://ontology.global.church/core#lvl-poe-${latest.phase}`, phase: latest.phase, phaseLabel: PHASE_NAMES[latest.phase],
      qualifier: latest.qualifier, satisfiedCriteria: [], blockedByCriteria: derived.blockedBy ? [{ id: 'next', label: derived.blockedBy }] : [], blockedFromPhase: latest.phase < 7 ? latest.phase + 1 : null,
      provenanceMode: 'derived', lastVerifiedAt: dayIso(latest.day), simulated: true, game: 'field-operations',
    } });
  }
  return { team, workspace, body };
}

export interface EstateWriteReport { ok: boolean; written: number; failures: string[] }

/** Write a season's records since `sinceDay` to every vault that holds them. Never throws; says what it could not do. */
export async function writeSeason(env: Pick<Env, 'FIELDOPS_ESTATE' | 'CLUB_WIRES'>, state: FieldOpsState, scenario: Scenario, region: Region, stagingId: string, sinceDay: number, standing: Record<string, Record<string, Standing>> = {}): Promise<EstateWriteReport> {
  const estate = await fieldEstate(env);
  if (!estate) return { ok: false, written: 0, failures: ['no estate note: this deployment writes nothing to the field app'] };
  const now = new Date().toISOString();
  const out = recordsFor(estate, state, scenario, region, stagingId, sinceDay, now, standing);
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
  return { ok: failures.length === 0, written, failures };
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
