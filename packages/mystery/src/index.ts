/**
 * MYSTERY NIGHT — a story at a place (docs/MYSTERY-NIGHT.md).
 *
 * ONE ENGINE, MANY TITLES. Two mysteries share every rule and differ only in what happened, so a title is
 * CONTENT — roles, acts, a clue graph, written lines — and adding one is authoring rather than coding.
 */
export * from './types.js';
export * from './engine.js';
export { chooseAction, type CastLines } from './cast.js';
export { CHARACTER_CRAFT, DIRECTOR_CRAFT } from './craft.js';

import { ALPINE_BELVEDERE } from './venues/alpine-belvedere.js';
import { BELVEDERE_SNOWFALL } from './titles/belvedere-snowfall.js';
import type { Title, Venue } from './types.js';

export { ALPINE_BELVEDERE, BELVEDERE_SNOWFALL };

/** The venues this deployment can stage in — one line per place, as `games.ts` is one line per game. */
export const VENUES: Record<string, Venue> = { [ALPINE_BELVEDERE.id]: ALPINE_BELVEDERE };
/** The titles it can stage. A second mystery is a file in `titles/` and a line here. */
export const TITLES: Record<string, Title> = { [BELVEDERE_SNOWFALL.id]: BELVEDERE_SNOWFALL };
export const DEFAULT_TITLE = BELVEDERE_SNOWFALL.id;

export function titleOf(id: string): Title | undefined { return TITLES[id]; }
export function venueOf(id: string): Venue | undefined { return VENUES[id]; }
/** The pair a staging is pinned to, or a refusal naming what is missing. */
export function stagingOf(titleId: string): { title: Title; venue: Venue } | null {
  const title = TITLES[titleId];
  const venue = title ? VENUES[title.venue] : undefined;
  return title && venue ? { title, venue } : null;
}
