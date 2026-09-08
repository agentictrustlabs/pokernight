/**
 * Agent cards. One `AgentCardV1` per persona, served at `/.well-known/agent-card.json` (the constant
 * lives in `@pokernight/protocol` as `A2A_AGENT_CARD_PATH`).
 *
 * The card's `supportedInterfaces[0].url` must be a URL the table can actually POST to, so it is built
 * from how the request arrived:
 *   - on the persona's own host (`sharkbot-svc.faithnet.ai`) -> `https://sharkbot-svc.faithnet.ai/api/a2a`
 *   - anywhere else (local dev, PUBLIC_ORIGIN)               -> `${PUBLIC_ORIGIN}/sharkbot.svc/api/a2a`
 */

import type { AgentCardV1, AgentSkillV1 } from '@agenticprimitives/a2a/standard';
import { A2A_JSONRPC_PATH, POKER_ACT_SKILL, agentNameToHost } from '@pokernight/protocol';
import type { Env } from './env.js';
import type { Persona, Resolution } from './personas.js';

export const CARD_VERSION = '1.0.0';

/**
 * The one skill every persona registers.
 *
 * Tag order matters: the tables app reads the strategy label for `PlayerInfo.agentKind` off the first
 * tag that is neither the skill id nor the generic "poker" (`agentKindFromCard`), so the strategy name
 * sits in that slot.
 */
function pokerActSkill(persona: Persona): AgentSkillV1 {
  return {
    id: POKER_ACT_SKILL,
    name: 'Poker action',
    description: [
      'Choose one legal no-limit hold’em action for a seat.',
      'Input: a single A2A data part `{ skill: "poker.act", input: PokerActInput }` where PokerActInput is',
      '`{ tableId, handNo, seat, view, legal, deadlineMs }` — `view` is the redacted TableView for that seat',
      '(own hole cards, board, stacks, pot, action history) and `legal` is the LegalActions record',
      '`{ fold, check, call, bet, raise, allIn }`.',
      'Output: a single data part `{ action, note }` where `action` is one of',
      '`{type:"fold"} | {type:"check"} | {type:"call"} | {type:"bet",amount} | {type:"raise",amount} | {type:"all-in"}`',
      '(bet/raise `amount` is the total street bet to raise TO, in chips) and `note` is a short rationale.',
      'The reply is a MESSAGE, not a task: it comes back in the same HTTP response as the SendMessage call.',
    ].join(' '),
    tags: [POKER_ACT_SKILL, 'poker', persona.strategy, 'holdem', 'pokernight'],
    examples: [
      'It is your turn on the flop with 180 chips behind and 8 to call — act.',
      'You are in the big blind facing a 3-bet preflop — act.',
    ],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

/** Where a table should send `poker.act` for this persona, given how this request arrived. */
export function endpointFor(persona: Persona, env: Env, url: URL, onPersonaHost: boolean): string {
  if (onPersonaHost) return `${url.protocol}//${url.host}${A2A_JSONRPC_PATH}`;
  const zone = (env.AGENT_CARD_ZONE ?? '').trim();
  const base = (env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '') || `${url.protocol}//${url.host}`;
  // A deployed persona host is the canonical target even when the card was fetched some other way.
  if (zone && base.includes(`.${zone}`)) return `https://${agentNameToHost(persona.agentName, zone)}${A2A_JSONRPC_PATH}`;
  return `${base}/${persona.agentName}${A2A_JSONRPC_PATH}`;
}

export function buildCard(persona: Persona, env: Env, url: URL, onPersonaHost = false): AgentCardV1 {
  return {
    name: persona.displayName,
    description: persona.description,
    version: CARD_VERSION,
    supportedInterfaces: [
      { url: endpointFor(persona, env, url, onPersonaHost), protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
    ],
    // No SSE: a turn is one synchronous request/reply inside the table's action clock.
    capabilities: { streaming: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [pokerActSkill(persona)],
    provider: { organization: 'Pokernight', url: (env.PUBLIC_ORIGIN ?? '').trim() || `${url.protocol}//${url.host}` },
  };
}

export function cardFor(resolution: Resolution, env: Env, url: URL): AgentCardV1 {
  return buildCard(resolution.persona, env, url, resolution.onPersonaHost);
}
