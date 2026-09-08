/**
 * The persona registry.
 *
 * One Worker hosts every persona. Which one answers a request is decided per-request, in this order:
 *
 *   1. `?agent=` query param        — `…/api/a2a?agent=sharkbot.svc`
 *   2. leading path segment         — `…/sharkbot.svc/api/a2a`
 *   3. Host header label            — `sharkbot-svc.faithnet.ai` (the inverse of `agentNameToHost`)
 *   4. the default persona          — so a bare `http://localhost:8788/api/a2a` still plays
 *
 * (1)–(2) exist so local dev on a single port can serve all of them; (3) is what production uses,
 * where the wildcard route `*.faithnet.ai/*` puts every persona host on this Worker.
 */

import { agentNameToHost } from '@pokernight/protocol';

export type StrategyName = 'rules' | 'claude';

export interface Persona {
  /** Short id, unique. Also accepted as an `?agent=` value. */
  id: string;
  /** A2A agent name, e.g. `sharkbot.svc`. This is what a table stores in `SeatAgentRequest.agentName`. */
  agentName: string;
  /** Name at the table and on the agent card. */
  displayName: string;
  description: string;
  strategy: StrategyName;
  /** Style knob for the rules strategy. Ignored by `claude`. */
  style?: 'tight-aggressive' | 'loose-passive';
  /** System-prompt persona for the `claude` strategy. Ignored by `rules`. */
  persona?: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'sharkbot',
    agentName: 'sharkbot.svc',
    displayName: 'Sharkbot',
    description:
      'Tight-aggressive rules baseline: plays a narrow range from early position, raises rather than calls, and folds without sentiment.',
    strategy: 'rules',
    style: 'tight-aggressive',
  },
  {
    id: 'callingstation',
    agentName: 'callingstation.svc',
    displayName: 'Calling Station',
    description:
      'Loose-passive rules variant: calls far too wide, almost never raises, and pays off value bets. The same engine as Sharkbot with the thresholds biased.',
    strategy: 'rules',
    style: 'loose-passive',
  },
  {
    id: 'deepthought',
    agentName: 'deepthought.svc',
    displayName: 'Deep Thought',
    description:
      'Claude-backed thoughtful player: reasons about ranges, pot odds and board texture before acting, and explains itself in one line.',
    strategy: 'claude',
    persona: [
      'You are Deep Thought, a careful, disciplined no-limit hold’em player.',
      'You think in ranges, not in single hands. You weigh pot odds, board texture, position and stack depth.',
      'You bet for a reason — value or fold equity — and you are perfectly willing to fold a good-looking hand.',
      'You never tilt, never chase without odds, and never make a play you cannot justify in one sentence.',
    ].join(' '),
  },
  {
    id: 'bluffer',
    agentName: 'bluffer.svc',
    displayName: 'The Bluffer',
    description:
      'Claude-backed aggressor: applies maximum pressure, barrels scare cards, and represents the hands the board allows. High variance.',
    strategy: 'claude',
    persona: [
      'You are The Bluffer, a fearless, hyper-aggressive no-limit hold’em player.',
      'You attack weakness: unraised pots, checked flops, and scare cards on the turn and river.',
      'You bet and raise far more often than you call, and you happily represent hands you do not have.',
      'You are not reckless — you still fold to real strength when the price is wrong — but when in doubt you apply pressure.',
    ].join(' '),
  },
];

export const DEFAULT_PERSONA: Persona = PERSONAS[0]!;

/** `sharkbot.svc` -> `sharkbot-svc`. The host label half of `agentNameToHost`. */
export function agentNameToLabel(agentName: string): string {
  return agentName.trim().toLowerCase().replace(/\./g, '-');
}

/** Every string that names this persona: id, agent name, and host label. */
function aliases(p: Persona): string[] {
  return [p.id, p.agentName.toLowerCase(), agentNameToLabel(p.agentName)];
}

/** Look a persona up by id, agent name, or host label. Case-insensitive. */
export function findPersona(name: string | null | undefined): Persona | null {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  if (!want) return null;
  return PERSONAS.find((p) => aliases(p).includes(want)) ?? null;
}

export interface Resolution {
  persona: Persona;
  /** The path with any persona prefix stripped, always starting with `/`. */
  path: string;
  /** True when the request arrived on the persona's own card host (production routing). */
  onPersonaHost: boolean;
  /** How the persona was chosen. `default` means nothing in the request named one. */
  via: 'query' | 'path' | 'host' | 'default';
}

/**
 * Resolve the persona for a request. Never throws and never 404s on an unknown name — an unknown
 * `?agent=` or an unrecognised leading segment simply does not select, and resolution falls through.
 */
export function resolvePersona(url: URL, host: string, zone: string): Resolution {
  const hostname = (host.split(':')[0] ?? '').toLowerCase();
  const label = hostname.split('.')[0] ?? '';
  const byHost = findPersona(label);
  const onPersonaHost = byHost !== null && zone !== '' && hostname === agentNameToHost(byHost.agentName, zone);

  // (2) leading path segment. Strip it whether or not the query param also named a persona, so that
  //     `/sharkbot.svc/api/a2a?agent=bluffer.svc` still routes to `/api/a2a` (the query wins).
  const segments = url.pathname.split('/').filter(Boolean);
  const byPath = segments.length > 1 ? findPersona(segments[0]) : null;
  const path = byPath ? `/${segments.slice(1).join('/')}` : url.pathname;

  // (1) query param.
  const byQuery = findPersona(url.searchParams.get('agent'));

  if (byQuery) return { persona: byQuery, path, onPersonaHost: false, via: 'query' };
  if (byPath) return { persona: byPath, path, onPersonaHost: false, via: 'path' };
  if (byHost) return { persona: byHost, path, onPersonaHost, via: 'host' };
  return { persona: DEFAULT_PERSONA, path, onPersonaHost: false, via: 'default' };
}
