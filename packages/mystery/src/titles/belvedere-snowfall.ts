import type { Title } from '../types.js';

/**
 * SNOWFALL AT THE BELVEDERE — GENERATED FROM THE STORY ONTOLOGY (2026-09-16).
 *
 * This file used to be six hundred lines of story, and it was a second copy: the same eight people, the same
 * three acts and the same twenty-eight clues were also described in whatever a director was told and in
 * whatever anybody writing the next story would have had to read. Two descriptions of one story drift.
 *
 * There is now ONE. `~/skills/ontology/belvedere-snowfall.ttl` is the story as an A-box over the story upper
 * ontology — every part with its age, its look, its wardrobe, its secret and the traits evidence can point
 * at; every act with its clock, its objective, what it opens and where a chance may fall; every clue with
 * the thing you must look at to find it and the trait it narrows the cast by; and the rule the culprit is
 * drawn under. `node scripts/story-to-title.mjs` compiles it into the title the engine plays.
 *
 * The join to the BUILDING is two strings and nothing else: a clue says `foundAtKey "register"` and the
 * Belvedere says `featureKey "register"`. Neither document holds the other's identifiers, which is what
 * makes a second story at this hotel a new file rather than a fork of this one.
 */
export { BELVEDERE_SNOWFALL_FROM_ONTOLOGY as BELVEDERE_SNOWFALL } from './belvedere-snowfall.generated.js';
