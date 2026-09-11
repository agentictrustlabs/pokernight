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
import {
  A2A_JSONRPC_PATH,
  CANASTA_ACT_SKILL,
  CANASTA_ADVISE_SKILL,
  CANASTA_REVIEW_SKILL,
  POKER_ACT_SKILL,
  POKER_ADVISE_SKILL,
  POKER_REVIEW_SKILL,
  agentNameToHost,
} from '@pokernight/protocol';
import type { Env } from './env.js';
import { gameOf, type Persona, type Resolution } from './personas.js';

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

/**
 * The canasta persona's one skill.
 *
 * A SEPARATE SKILL ID, which is the whole point: the table asks for its own game's skill by name and
 * refuses to seat an agent whose card does not advertise it. An agent that plays poker and an agent
 * that plays canasta cannot be handed each other's turns, and neither can be seated at the other's
 * table by mistake.
 *
 * Tag order matters the same way it does for poker: the tables app reads the strategy label off the
 * first tag that is neither the skill id nor the game's own name.
 */
function canastaActSkill(persona: Persona): AgentSkillV1 {
  return {
    id: CANASTA_ACT_SKILL,
    name: 'Canasta move',
    description: [
      'Choose one legal Classic Canasta move for a seat in a four-handed partnership game.',
      'Input: a single A2A data part `{ skill: "canasta.act", input }` where input is',
      '`{ tableId, handNo, seat, view, legal, deadlineMs }` — `view` is the redacted CanastaView for that',
      'seat (own hand, both sides\' melds, the stock count, the pile\'s top card and size, scores) and',
      '`legal` is `{ phase, canDraw, canTakePile, takePileReason, pileTop, pileSize, minimumMeld, discardable, canGoOut }`.',
      'Output: a single data part `{ action, note }` where `action` is one of',
      '`{type:"draw"} | {type:"take-pile",meld,also?} | {type:"meld",melds} | {type:"discard",card}`',
      'and `note` is a short rationale.',
      'A turn has two halves: draw or take the pile first, then meld and discard.',
      'The reply is a MESSAGE, not a task: it comes back in the same HTTP response as the SendMessage call.',
    ].join(' '),
    tags: [CANASTA_ACT_SKILL, 'canasta', persona.strategy, 'partnership', 'pokernight'],
    examples: [
      'It is your turn, the pile has nine cards and you hold two natural sevens — act.',
      'You have drawn, your side has not opened, and you need fifty — act.',
    ],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

/**
 * ADVISING, which is not acting.
 *
 * Declared as its own skill so a caller can ask for one without the other — and so a table can refuse
 * to name an agent as an adviser when it does not answer advice, rather than discovering it mid-hand.
 * Nothing returned here is applied to anybody's table: the action in a reply is a suggestion.
 */
function adviseSkill(persona: Persona, game: string): AgentSkillV1 {
  const id = game === 'canasta' ? CANASTA_ADVISE_SKILL : POKER_ADVISE_SKILL;
  return {
    id,
    name: game === 'canasta' ? 'Canasta advice' : "Hold'em advice",
    description: [
      `Say what the person in a seat should do, and why. Advice only: nothing here takes a turn.`,
      `Input: one A2A data part \`{ skill: "${id}", input }\` where input is`,
      '`{ tableId, handNo, seat, view, legal, deadlineMs, question? }` — `view` is the redacted view for',
      "that seat and `question` is the person's own words when they asked something.",
      'Output: one data part `{ say, because?, action? }`. `say` is one sentence for somebody with a',
      'clock running; `because` is the reason; `action` is a SUGGESTION and is applied by nobody.',
    ].join(' '),
    tags: [id, game, 'advice', 'coach', 'pokernight'],
    examples:
      game === 'canasta'
        ? ['Is the pile worth taking here?', 'How far am I from opening?']
        : ['Am I getting the right price to call?', 'What can beat me on this board?'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

/**
 * BEING TOLD HOW A ROUND WENT — the only moment an adviser learns whether its advice was any good.
 *
 * Sent after a round ends, as that seat saw it. There is no answer the table acts on, which is why it
 * is a third skill rather than a variant of advising: an agent may remember without advising, or
 * advise without remembering.
 */
function reviewSkill(persona: Persona, game: string): AgentSkillV1 {
  const id = game === 'canasta' ? CANASTA_REVIEW_SKILL : POKER_REVIEW_SKILL;
  return {
    id,
    name: game === 'canasta' ? 'Canasta round review' : "Hold'em hand review",
    description: [
      'Receive a finished round as one seat saw it, including its result, so a coach can learn from it.',
      `Input: one A2A data part \`{ skill: "${id}", input }\` with the same shape as the advice call.`,
      'No answer is required and none is acted on. A personal coach writes to its own memory here.',
    ].join(' '),
    tags: [id, game, 'memory', 'coach', 'pokernight'],
    examples: ['The round ended; here is how it went for your seat.'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

/** Where a table should send this persona's turn calls, given how this request arrived. */
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
    // THREE SKILLS, listed separately on purpose: take a turn, say something, remember something. A
    // table reads this list to decide what it may ask of an agent, so an agent that only advises is
    // never handed a seat.
    skills: [
      gameOf(persona) === 'canasta' ? canastaActSkill(persona) : pokerActSkill(persona),
      adviseSkill(persona, gameOf(persona)),
      reviewSkill(persona, gameOf(persona)),
    ],
    provider: { organization: 'Pokernight', url: (env.PUBLIC_ORIGIN ?? '').trim() || `${url.protocol}//${url.host}` },
  };
}

export function cardFor(resolution: Resolution, env: Env, url: URL): AgentCardV1 {
  return buildCard(resolution.persona, env, url, resolution.onPersonaHost);
}
