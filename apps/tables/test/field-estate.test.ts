/**
 * WHAT A SEASON WRITES TO THE FIELD APP (docs/FIELD-OPERATIONS.md §6). The field app draws each screen from ONE vault
 * and joins by id, so a record in the wrong vault, a link that points out of its vault or a phase with nothing behind
 * it is a screen that stays empty without an error. A season the house plays (no agent, no model) is run through the
 * same `recordsFor` the season object uses; these are the joins the screens make.
 */
import { describe, expect, it } from 'vitest';
import { NORTH_OF_DENVER as S, NORTHERN_COLORADO as R, apply, attachAgent, chooseAction, openStaging, tick, viewFor, type Casting, type FieldOpsState } from '@pokernight/fieldops';
import { artifactId, recordsFor, type FieldEstate, type FieldRecordOut } from '../src/field-estate.js';
import { dimensionsOf, poePhase } from '../src/field-phase.js';

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const estate: FieldEstate = {
  home: 'https://home.example', clientId: 'field-app', chainId: 34348, a2a: 'https://a2a.example', mcp: 'https://mcp.example', origin: 'https://games.example', deliveryServiceSa: addr(1), interactionsServiceSa: addr(2),
  workspace: { sa: addr(0x10), custodian: 'nathan', name: 'the game workspace' }, partners: {}, workers: Object.fromEntries(S.roles.map((r, i) => [r.id, { sa: addr(0x100 + i), custodian: 'elena' }])),
};

/** A season the house plays to `days`, every team and body it founds given an agent as the host would. */
function season(days: number): FieldOpsState {
  const cast: Casting[] = S.roles.map((r) => ({ role: r.id, agent: `${r.id}.me`, name: r.name, custodian: 'house', operator: 'agent', mind: 'rules' }));
  let s = openStaging({ scenario: S, region: R, cast, seedHex: SEED, seedCommit: 'c', now: Date.UTC(2026, 8, 1), pace: 1 });
  let n = 0x1000; let tickN = 0;
  const charter = () => {
    for (const t of s.teams) if (!t.agent) s = attachAgent(s, { team: t.id }, addr(n++), 'elena');
    for (const b of s.bodies) if (!b.agent && (b.foundedDay > 0 || b.recognizedFrom)) s = attachAgent(s, { body: b.id }, addr(n++), 'elena');
  };
  for (let guard = 0; guard < 3000 && s.phase !== 'revealed' && s.day <= days; guard++) {
    if (s.phase === 'day') {
      for (const c of s.cast) {
        const lines = S.roles.find((r) => r.id === c.role)!.lines;
        const move = chooseAction(viewFor(s, S, R, c.role), lines, tickN++);
        if (!move) continue;
        const r = apply(s, S, R, c.role, move.action, s.deadline! - 1, 'agent');
        if (r.ok) s = r.state;
        if (['move', 'adopt', 'join', 'invite', 'decline'].includes(move.action.type)) {
          const m2 = chooseAction(viewFor(s, S, R, c.role), lines, tickN++);
          if (m2 && m2.action.type !== 'move') { const r2 = apply(s, S, R, c.role, m2.action, s.deadline! - 1, 'agent'); if (r2.ok) s = r2.state; }
        }
      }
      charter();
    }
    s = tick(s, S, R, s.deadline! + 1).state;
  }
  charter();
  return s;
}

const of = (records: FieldRecordOut[], kind: string) => records.filter((r) => r.record.kind === kind).map((r) => r.record as Record<string, any>);

describe('the season as the field app reads it', () => {
  const s = season(28);
  const out = recordsFor(estate, s, S, R, 'c0ffee00-0000-4000-8000-000000000000', 0, new Date(s.startedAt).toISOString());
  const vaults = [...Object.values(out.team), ...Object.values(out.body), out.workspace];

  it('writes ids the field app accepts, once each, every one in an envelope', () => {
    for (const records of vaults) {
      const seen = new Set<string>();
      for (const { folder, record } of records) {
        expect(record.id).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
        expect(seen.has(`${folder}/${record.id}`)).toBe(false);
        seen.add(`${folder}/${record.id}`);
        expect((record.envelope as { purpose?: string }).purpose).toBeTruthy();
      }
    }
  });

  it('keeps every link inside the vault it is read from', () => {
    for (const records of vaults) {
      const ids = new Set(records.map((r) => r.record.id));
      for (const { record } of records) {
        for (const link of ['parentId', 'recognizedFromId', 'fromAssessmentId', 'producedResultId', 'supersedes', 'contextRef', 'planId']) {
          const v = record[link];
          if (typeof v === 'string' && v) expect(ids.has(v), `${record.kind} ${record.id} ${link} → ${v}`).toBe(true);
        }
      }
    }
  });

  it('gives every people a team took up its context, its dimensions and a phase the dimensions derive — in the team’s vault, with the phase copied to the workspace', () => {
    expect(Object.keys(s.worked).length).toBeGreaterThan(8);
    for (const [id, teamId] of Object.entries(s.worked)) {
      const records = out.team[teamId]!;
      const context = of(records, 'community-context').find((c) => c.id === `community-${id}`)!;
      expect(context, id).toBeTruthy();
      expect(of(out.workspace, 'ws-community').find((w) => w.communityId === context.communityId)?.steward).toBe(s.teams.find((t) => t.id === teamId)!.agent);
      const dims = of(records, 'dimension-assessment').filter((d) => d.communityId === context.communityId);
      expect(dims).toHaveLength(12);
      const assessment = of(records, 'community-phase-assessment').find((a) => a.communityId === context.communityId)!;
      const result = of(records, 'community-phase-result').find((r) => r.id === assessment.producedResultId)!;
      expect(result.fromAssessmentId).toBe(assessment.id);
      expect(result.satisfiedCriteria.length).toBeGreaterThan(0);
      expect(result.assignedLevel.endsWith(`#lvl-poe-${result.phase}`)).toBe(true);
      expect(assessment.readings.map((r: { recordId: string }) => r.recordId).sort()).toEqual(dims.map((d) => d.id).sort());
      const def = R.communities.find((c) => c.id === id) ?? s.defined.find((c) => c.id === id)!;
      const acts = s.log.filter((e) => e.type === 'acted' && e.community === id && !['rest', 'assess', 'found-team'].includes(e.action)).length;
      expect(result.phase).toBe(poePhase(dimensionsOf(def, s.communities[id]!, s.bodies, true, acts), { corpus: 'x', asOf: 'y' }).phase);
      expect(of(out.workspace, 'community-phase-result').some((r) => r.id === result.id)).toBe(true);
      // The towns that bound the community are shapes in the same vault — what puts it on the map.
      const places = new Set(of(records, 'geo-feature').map((g) => g.featureId));
      for (const c of context.segment.realizesSpecification.constraints.filter((x: { operator: string }) => x.operator === 'spatially-within')) expect(places.has(c.featureValue)).toBe(true);
      // A registry community is aligned to its people group by the registry's own key.
      if (!def.fictional) expect(context.alignments[0].key).toBe(def.people.ropId);
      expect(of(records, 'local-plan').find((p) => p.communityId === context.communityId)?.acceptedWorkPackages.length).toBe(6);
      expect(of(records, 'work-item').filter((w) => w.communityId === context.communityId)).toHaveLength(6);
      expect(of(records, 'focus-list').some((f) => f.communityId === context.communityId)).toBe(true);
    }
  });

  it('writes a circle with its health, dated and attributed, in a place on the map', () => {
    const circles = Object.values(out.team).flatMap((records) => of(records, 'formation-community'));
    expect(circles.length).toBeGreaterThan(0);
    for (const c of circles) {
      expect(c.health.seekers + c.health.believers).toBe(c.participantCount);
      expect(c.healthFramework).toBe('acts2-gapp');
      expect(c.healthObservedBy).toBeTruthy();
      expect(c.envelope.precision).toBe('settlement');
      expect(R.towns.some((t) => t.id === c.placeId)).toBe(true);
    }
  });

  it('supersedes a phase result only when the phase moves, and keeps its id while it holds', () => {
    const again = recordsFor(estate, s, S, R, 'c0ffee00-0000-4000-8000-000000000000', 0, new Date(s.startedAt).toISOString(), {}, out.phases);
    expect(again.phases).toEqual(out.phases);
    const [id] = Object.keys(out.phases);
    const moved = recordsFor(estate, s, S, R, 'c0ffee00-0000-4000-8000-000000000000', 0, new Date(s.startedAt).toISOString(), {}, { ...out.phases, [id!]: { phase: 99, resultId: 'fo-c0ffee00-phase-earlier', supersedes: null } });
    expect(moved.phases[id!]!.supersedes).toBe('fo-c0ffee00-phase-earlier');
  });

  it('a day’s write is the peoples something happened among — the rest stands, and the series is carried', () => {
    const day = recordsFor(estate, s, S, R, 'c0ffee00-0000-4000-8000-000000000000', s.day - 1, new Date(s.startedAt).toISOString(), {}, out.phases);
    const count = (o: typeof out) => [...Object.values(o.team), ...Object.values(o.body), o.workspace].reduce((n, r) => n + r.length, 0);
    expect(count(day)).toBeLessThan(count(out) / 2);
    expect(day.phases).toEqual(out.phases);
    const touched = new Set(s.log.flatMap((e) => ('day' in e && e.day > s.day - 1 && 'community' in e && e.community ? [e.community] : [])));
    const written = new Set(Object.values(day.team).flatMap((records) => of(records, 'community-context').map((c) => String(c.id).replace('community-', ''))));
    for (const id of touched) if (s.worked[id]) expect(written.has(id), id).toBe(true);
    for (const id of written) expect(touched.has(id), id).toBe(true);
    // No place is written again on an ordinary day except where something new stands.
    expect(of(day.workspace, 'geo-feature')).toHaveLength(0);
  });

  it('derives the artifact id the field app derives', () => {
    expect(artifactId('field/circles', 'x.json', 'https://graph.global.church/community/100207rop3-weld')).toMatch(/^field-circles-100207rop3-weld-[a-z0-9]+$/);
    expect(artifactId('field/team', 'profile.json')).toMatch(/^field-team-nosubject-[a-z0-9]+$/);
  });
});
