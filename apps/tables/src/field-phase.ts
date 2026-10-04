/**
 * THE FIELD APP'S OWN RULER, READ OFF THE SEASON'S COUNTS (docs/FIELD-OPERATIONS.md §6).
 *
 * The season derives a phase on the registry's `fw-npl-phases` (entry, sowing, baptisms, churches, generations). The
 * field app does not take a phase on anybody's word: it reads DIMENSION ASSESSMENTS (D1 strategy … D10b sending), each
 * a level with a reason, and derives a Phases-of-Engagement level from those under published criteria. So what the
 * season writes is the dimensions — levelled from its own counters, each saying which count put it there — and the
 * phase the field app's criteria then give, with the criteria that held and the ones that block the next.
 *
 * The criteria below are the field domain's (`@engage/field-domain` `phase.ts`), carried here because this repository
 * links to no private checkout; `pnpm check:field-records --out` leaves a season's records for that repository's own
 * validator and `derivePhase` to be run over. The two scales are DIFFERENT RULERS and are not forced to agree: the registry's P6 is a third
 * generation, the toolkit's Phase 6 is a fourth.
 */
import type { Body, CommunityDef, CommunityState } from '@pokernight/fieldops';

export type DimensionLevel = 'Unknown' | 'None' | 'Emerging' | 'Developing' | 'Established' | 'Multiplying';
export type DimensionId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D5b' | 'D6' | 'D7' | 'D8' | 'D9' | 'D10a' | 'D10b';
export interface Dimension { id: DimensionId; name: string; level: DimensionLevel; rationale: string; confidence: 'low' | 'medium' | 'high' }

export const POE_FRAMEWORK = 'https://ontology.faithchain.org/incubator#fw-poe-phases';
export const POE_FRAMEWORK_VERSION = 'gc-2026a';
export const poeLevelIri = (phase: number): string => `https://ontology.faithchain.org/incubator#lvl-poe-${phase}`;

const ORDER: DimensionLevel[] = ['None', 'Emerging', 'Developing', 'Established', 'Multiplying'];
const meets = (actual: DimensionLevel | undefined, atLeast: DimensionLevel): boolean => !!actual && actual !== 'Unknown' && ORDER.indexOf(actual) >= ORDER.indexOf(atLeast);

interface Criterion { dimensionId: DimensionId; atLeast: DimensionLevel; reads: string }
const POE_PHASES: Array<{ phase: number; label: string; criteria: Criterion[] }> = [
  { phase: 1, label: 'Entry', criteria: [{ dimensionId: 'D1', atLeast: 'Emerging', reads: 'a strategy is under implementation' }, { dimensionId: 'D2', atLeast: 'Emerging', reads: 'access and relational foundations are emerging' }] },
  { phase: 2, label: 'Evangelism', criteria: [{ dimensionId: 'D1', atLeast: 'Emerging', reads: 'a strategy is under implementation' }, { dimensionId: 'D3', atLeast: 'Developing', reads: 'gospel witness is regular, not occasional' }] },
  { phase: 3, label: 'Discipleship', criteria: [{ dimensionId: 'D4', atLeast: 'Emerging', reads: 'there is response, at least isolated or in small clusters' }, { dimensionId: 'D5', atLeast: 'Emerging', reads: 'discipleship has begun' }] },
  { phase: 4, label: 'Local Church', criteria: [{ dimensionId: 'D6', atLeast: 'Established', reads: 'a local church functions — recognised, not merely gathering' }, { dimensionId: 'D7', atLeast: 'Emerging', reads: 'indigenous leaders are emerging' }] },
  { phase: 5, label: 'Reproducing Church', criteria: [{ dimensionId: 'D8', atLeast: 'Emerging', reads: 'a second generation has formed' }, { dimensionId: 'D10b', atLeast: 'Emerging', reads: 'the community sends at least within itself' }] },
  { phase: 6, label: 'Multiplying Church', criteria: [{ dimensionId: 'D9', atLeast: 'Established', reads: 'at least one fourth-generation stream exists' }, { dimensionId: 'D7', atLeast: 'Established', reads: 'leadership is multi-generational' }] },
];

export interface PoeOutcome {
  phase: number; label: string;
  satisfied: Array<{ criterion: string }>;
  blockedBy: Array<{ criterion: string; actual: DimensionLevel }>;
  blockedFromPhase: number | null;
}

/** The toolkit's level for a set of dimensions — sequential, stopped at the first phase whose criteria fail. */
export function poePhase(dims: readonly Dimension[], searched: { corpus: string; asOf: string }): PoeOutcome {
  const level = new Map(dims.map((d) => [d.id, d.level] as const));
  const rows = (p: (typeof POE_PHASES)[number]) => p.criteria.map((c) => ({ c, ok: meets(level.get(c.dimensionId), c.atLeast), actual: level.get(c.dimensionId) ?? 'Unknown' as DimensionLevel }));
  let attained: (typeof POE_PHASES)[number] | null = null;
  let blocker: (typeof POE_PHASES)[number] | null = null;
  for (const p of POE_PHASES) { if (rows(p).every((r) => r.ok)) { attained = p; continue; } blocker = p; break; }
  const blockedBy = blocker ? rows(blocker).filter((r) => !r.ok).map((r) => ({ criterion: `${r.c.dimensionId} — ${r.c.reads}`, actual: r.actual })) : [];
  if (!attained) return { phase: 0, label: 'Waiting', satisfied: [{ criterion: `Searched ${searched.corpus} as of ${searched.asOf}; no qualifying strategy implementation or witness found.` }], blockedBy, blockedFromPhase: blocker?.phase ?? null };
  if (attained.phase === 6 && meets(level.get('D9'), 'Multiplying') && meets(level.get('D10a'), 'Established') && meets(level.get('D10b'), 'Established')) {
    return { phase: 7, label: 'Sustained Gospel Presence', satisfied: [{ criterion: 'D9 — multiple fourth-generation streams' }, { criterion: 'D10a — indigenous ownership' }, { criterion: 'D10b — sending beyond the community' }, { criterion: 'Reached by the multi-stream route. The saturation route was not used.' }], blockedBy: [], blockedFromPhase: null };
  }
  return { phase: attained.phase, label: attained.label, satisfied: rows(attained).map((r) => ({ criterion: `${r.c.dimensionId} — ${r.c.reads} (${r.actual})` })), blockedBy, blockedFromPhase: blocker?.phase ?? null };
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * THE DIMENSIONS, from one community's counters and the bodies among it. Every level names the count that put it
 * there, so a reader can disagree with the threshold instead of with a number. `taken` is whether a team has taken the
 * community up — the only evidence of a strategy a season has; `acts` is how many acts the season recorded among it.
 */
export function dimensionsOf(def: Pick<CommunityDef, 'id' | 'name'>, c: CommunityState, bodies: readonly Body[], taken: boolean, acts: number): Dimension[] {
  const mine = bodies.filter((b) => b.community === def.id && b.lifecycle !== 'Stalled');
  const circles = mine.filter((b) => b.kind === 'circle' && b.lifecycle !== 'RecognizedAsChurch');
  const churches = mine.filter((b) => b.kind === 'church');
  const gens = churches.reduce((m, b) => Math.max(m, b.generation), 0);
  const sent = mine.filter((b) => b.parent !== null).length;
  const streams = new Set(churches.filter((b) => b.generation >= 4).map((b) => b.parent)).size;
  const d = (id: DimensionId, name: string, level: DimensionLevel, rationale: string, confidence: Dimension['confidence'] = 'medium'): Dimension => ({ id, name, level, rationale, confidence });
  return [
    d('D1', 'Strategy Implementation', !taken ? 'None' : acts >= 5 ? 'Developing' : 'Emerging', taken ? `A team has taken this community up and the season records ${n(acts, 'act')} among it — work under way, which is implementation rather than a written strategy.` : 'No team has taken this community up.'),
    d('D2', 'Relational Access', c.presenceDays < 1 ? 'None' : c.presenceDays >= 6 && c.visits >= 3 ? 'Established' : c.visits >= 3 ? 'Developing' : 'Emerging', `${n(c.presenceDays, 'day')} of presence and ${n(c.visits, 'visit')} on record.`),
    d('D3', 'Gospel Witness', c.conversations < 1 ? 'None' : c.conversations >= 12 ? 'Established' : c.conversations >= 5 ? 'Developing' : 'Emerging', `${n(c.conversations, 'gospel conversation')} on record — five is where the season calls witness regular rather than occasional.`),
    d('D4', 'Spiritual Response', c.believers + c.seekers < 1 ? 'None' : c.believers >= 10 ? 'Established' : c.believers >= 3 ? 'Developing' : 'Emerging', `${n(c.seekers, 'seeker')} and ${n(c.believers, 'believer')} counted — a claim about people, so it stays low until the count is not small.`, 'low'),
    d('D5', 'Disciple Formation', c.baptized < 1 ? 'None' : c.baptized >= 5 && c.leaders >= 1 ? 'Established' : c.baptized >= 3 && circles.length + churches.length > 0 ? 'Developing' : 'Emerging', `${n(c.baptized, 'baptism')}, ${n(c.studies, 'discovery study', 'discovery studies')} running — the season takes a baptism as the mark that discipleship has begun.`),
    d('D5b', 'Community Formation', circles.length < 1 ? 'None' : circles.length >= 2 ? 'Developing' : 'Emerging', `${n(circles.length, 'circle')} gathering, short of being a church.`),
    d('D6', 'Church Formation', churches.length > 0 ? 'Established' : circles.some((b) => b.believers >= 3) ? 'Emerging' : 'None', churches.length > 0 ? `${n(churches.length, 'church', 'churches')} recognised among this community — recognition is a decision, and it was made.` : 'No circle has been recognised as a church.'),
    d('D7', 'Indigenous Leadership', c.leaders < 1 ? 'None' : c.leaders >= 6 ? 'Established' : c.leaders >= 3 ? 'Developing' : 'Emerging', `${n(c.leaders, 'local leader')} trained or leading.`),
    d('D8', 'Church Reproduction', gens < 2 ? 'None' : gens >= 4 ? 'Established' : gens >= 3 ? 'Developing' : 'Emerging', gens < 2 ? 'No church has sent a daughter church — a circle sent out is not yet a church.' : `The deepest church lineage is generation ${gens}.`),
    d('D9', 'Movement Multiplication', gens < 3 ? 'None' : streams >= 2 ? 'Multiplying' : gens >= 4 ? 'Established' : 'Emerging', gens < 3 ? 'No lineage has reached a third generation.' : `Generation ${gens} reached${streams ? ` in ${n(streams, 'stream')}` : ''}.`),
    d('D10a', 'Indigenous Ownership', c.leaders >= 6 && churches.length >= 2 ? 'Established' : c.leaders >= 1 && churches.length >= 1 ? 'Emerging' : 'None', `${n(c.leaders, 'local leader')} across ${n(churches.length, 'church', 'churches')} — ownership is read from who leads, which a season can only count.`, 'low'),
    d('D10b', 'Sending Capacity', sent < 1 ? 'None' : gens >= 4 ? 'Established' : sent >= 3 ? 'Developing' : 'Emerging', `${n(sent, 'body', 'bodies')} sent out of another among this community.`),
  ];
}
