/**
 * THE ONTOLOGY IS THE SOURCE, AND THIS IS THE PROOF.
 *
 * `~/skills/ontology/kettlewater.ttl` is authored under the faith ontology (a people is a `gc:PeopleGroup`, a
 * reading a `gc:EngagementAssessmentResult`, a phase a `poe:` concept) and the story ontology (parts, acts,
 * secrets, choices). `scripts/world-to-commission.mjs` compiles it. This test deep-compares what it compiled
 * with the hand-written world the engine was built against — the same round-trip the mystery's generators
 * were proven by. When they differ, one of them is wrong, and it is the TypeScript: edit the TTL and rerun
 * the generator, never the other way.
 */
import { describe, it, expect } from 'vitest';
import { FIRST_LIGHT, KETTLEWATER_MARCHES, SECOND_WINTER } from '../src/worlds/kettlewater.js';
import { FIRST_LIGHT_FROM_ONTOLOGY, KETTLEWATER_MARCHES_FROM_ONTOLOGY, SECOND_WINTER_FROM_ONTOLOGY } from '../src/worlds/kettlewater.generated.js';
import { checkScenario } from '../src/engine.js';

describe('the world compiled from the ontology is the world the engine plays', () => {
  it('the region: five peoples, six workspaces, every schedule and hidden fact', () => {
    expect(KETTLEWATER_MARCHES_FROM_ONTOLOGY).toEqual(KETTLEWATER_MARCHES);
  });
  it('the first night: seven parts with their vaults, lines, looks and choices; three rounds', () => {
    expect(FIRST_LIGHT_FROM_ONTOLOGY).toEqual(FIRST_LIGHT);
  });
  it('the second night: the same marches, the returnee gone silent', () => {
    expect(SECOND_WINTER_FROM_ONTOLOGY).toEqual(SECOND_WINTER);
  });
  it('and both compiled nights pass the authoring check on their own', () => {
    expect(checkScenario(FIRST_LIGHT_FROM_ONTOLOGY, KETTLEWATER_MARCHES_FROM_ONTOLOGY)).toEqual([]);
    expect(checkScenario(SECOND_WINTER_FROM_ONTOLOGY, KETTLEWATER_MARCHES_FROM_ONTOLOGY)).toEqual([]);
  });
});
