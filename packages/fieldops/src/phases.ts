/**
 * A PHASE IS DERIVED FROM THE RECORDS (docs/FIELD-OPERATIONS.md §4).
 *
 * The registry's `fw-npl-phases` says what each level means — entry, sowing, baptisms, churches started, second
 * and third generation churches, multiplying streams or ten percent — and this reads the season's own counters
 * against those words. It is the one place a phase is computed; the board, the steward's reading, the score and
 * the records written to the field app all ask it. A published READING is somebody's claim; this is the derivation
 * the claim is scored against, and both are kept, because the whole point of a reading is that it can be wrong.
 */
import type { Body, CommunityDef, CommunityState, PhaseN } from './types.js';

export const SOWING_CONVERSATIONS = 5;

/** The counters a community opens with when the registry puts it at `phase` — work already done, in round numbers. */
export function floorCounts(phase: PhaseN): Pick<CommunityState, 'presenceDays' | 'visits' | 'conversations' | 'seekers' | 'studies' | 'believers' | 'baptized' | 'leaders'> {
  const c = { presenceDays: 0, visits: 0, conversations: 0, seekers: 0, studies: 0, believers: 0, baptized: 0, leaders: 0 };
  if (phase >= 1) { c.presenceDays = 2; c.visits = 3; }
  if (phase >= 2) { c.conversations = SOWING_CONVERSATIONS + 3; c.seekers = 2; }
  if (phase >= 3) { c.believers = 4; c.baptized = 2; }
  if (phase >= 4) { c.believers = 9; c.baptized = 5; c.leaders = 1; }
  if (phase >= 5) { c.believers = 18; c.baptized = 11; c.leaders = 3; }
  if (phase >= 6) { c.believers = 30; c.baptized = 20; c.leaders = 6; }
  if (phase >= 7) { c.believers = 48; c.baptized = 34; c.leaders = 10; }
  return c;
}

/** The deepest generation any church of this community has reached, counting the church's own as 1. */
export function generationsOf(bodies: readonly Body[], community: string): number {
  return bodies.filter((b) => b.community === community && b.kind === 'church' && b.lifecycle !== 'Stalled').reduce((m, b) => Math.max(m, b.generation), 0);
}

/** The phase the records derive, and the first thing standing between it and the next one. */
export function phaseOf(def: Pick<CommunityDef, 'id' | 'population'>, c: Pick<CommunityState, 'presenceDays' | 'conversations' | 'baptized' | 'believers'>, bodies: readonly Body[]): { phase: PhaseN; blockedBy: string | null } {
  const churches = bodies.filter((b) => b.community === def.id && b.kind === 'church' && b.lifecycle !== 'Stalled').length;
  const gens = generationsOf(bodies, def.id);
  const tenPercent = def.population !== null && def.population > 0 && c.believers * 10 >= def.population;
  if (c.presenceDays < 1) return { phase: 0, blockedBy: 'nobody has been among them yet' };
  if (c.conversations < SOWING_CONVERSATIONS) return { phase: 1, blockedBy: `${SOWING_CONVERSATIONS - c.conversations} more gospel conversations` };
  if (c.baptized < 1) return { phase: 2, blockedBy: 'no baptisms yet' };
  if (churches < 1) return { phase: 3, blockedBy: 'no circle recognised as a church' };
  if (gens < 2 && !tenPercent) return { phase: 4, blockedBy: 'no church has sent a daughter church' };
  if (gens < 3 && !tenPercent) return { phase: 5, blockedBy: 'no daughter church has sent one of its own' };
  if (gens < 4 && !tenPercent) return { phase: 6, blockedBy: 'no third-generation church has sent' };
  return { phase: 7, blockedBy: null };
}
