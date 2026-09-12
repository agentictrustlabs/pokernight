/**
 * pokernight-agent-worker — poker personas that speak the STANDARD A2A profile.
 *
 * Routes (all persona-resolved; see `resolvePersona` for the four ways a persona is named):
 *   GET  /health                        liveness + which personas this Worker hosts
 *   GET  /agents                        the persona registry, with each one's card and RPC URL
 *   GET  /.well-known/agent-card.json   this persona's AgentCardV1
 *   POST /api/a2a                       A2A 1.0 JSON-RPC (`SendMessage` -> `poker.act`)
 *
 * A fresh `createStandardA2aServer` is built per request ON PURPOSE. The standard server records every
 * run in a task store (in-memory by default) even when the executor answers with `ctx.reply` and no task
 * survives — in a long-lived Worker isolate that store would grow without bound. A turn here is one
 * synchronous request/reply with nothing to resume, so a per-request server is the correct lifetime:
 * building it is a handful of closures, and the store is collected with the request.
 */

import { createStandardA2aServer } from '@agenticprimitives/a2a/standard';
import { A2A_AGENT_CARD_PATH, A2A_JSONRPC_PATH, agentNameToHost } from '@pokernight/protocol';
import { buildCard, cardFor, endpointFor } from './card.js';
import type { Env } from './env.js';
import { createPokerActExecutor } from './executor.js';
import { createCanastaActExecutor } from './canasta-executor.js';
import {
  createCanastaAdviseExecutor,
  createPokerAdviseExecutor,
  createKeepsNothingExecutor,
  createRoutingExecutor,
} from './advise-executor.js';
import { PERSONAS, gameOf, resolvePersona, type Resolution } from './personas.js';

/** Server-to-server traffic needs no CORS, but a browser poking at the card should not be blocked. */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, a2a-version, authorization',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...headers },
  });
}

function a2aServer(resolution: Resolution, env: Env, url: URL) {
  return createStandardA2aServer({
    card: cardFor(resolution, env, url),
    // ONE EXECUTOR PER GAME. They share the envelope — one data part in, one out, a message and not
    // a task — and share nothing else, because a canasta view has no pot and a canasta move has no
    // amount. Which one answers is decided by the persona, not by sniffing the request.
    // Three skills through one server, routed by the skill the caller NAMED — see
    // `createRoutingExecutor`. Taking a turn, giving advice and being told how a round went are
    // different acts, and a request meaning one must never fall through into another.
    executor: createRoutingExecutor(
      resolution.persona,
      gameOf(resolution.persona) === 'canasta'
        ? createCanastaActExecutor(resolution.persona)
        : createPokerActExecutor(resolution.persona, env),
      gameOf(resolution.persona) === 'canasta'
        ? createCanastaAdviseExecutor(resolution.persona)
        : createPokerAdviseExecutor(resolution.persona),
      createKeepsNothingExecutor(resolution.persona),
    ),
    // PHASE 2: NO ADMISSION. `principal` is deliberately omitted, so every caller is admitted and
    // `ctx.principal` is null. That is safe only while a seat cannot move money.
    //
    // PHASE 3 SEAM: when a seat can spend, wire the house's identity in here —
    //   import { sessionWirePrincipal } from '@agenticprimitives/a2a/standard';
    //   principal: sessionWirePrincipal({ /* verifier deps */ }),
    // A request that resolves to nobody then gets a 401 before any method runs, and the executor can
    // check `ctx.principal.agent` against the A2A grant the owner issued for `poker.act`
    // (`buildA2aGrantCaveats` + `skillSelector('poker.act')`, docs/DESIGN.md §6).
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const zone = (env.AGENT_CARD_ZONE ?? '').trim();
    const resolution = resolvePersona(url, request.headers.get('host') ?? url.host, zone);
    const { path, persona } = resolution;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (request.method === 'GET' && path === '/health') {
      return json({
        ok: true,
        service: 'pokernight-agent-worker',
        persona: persona.agentName,
        resolvedVia: resolution.via,
        personas: PERSONAS.map((p) => p.agentName),
      });
    }

    // `?game=canasta` narrows the list to the personas that play it. A lobby filling an empty seat
    // must never be offered an agent for a game other than the one at the table — and this is the
    // cheapest place to answer that, because it is the only place that knows which persona is which.
    if (request.method === 'GET' && path === '/agents') {
      const want = (url.searchParams.get('game') ?? '').trim();
      const listed = want ? PERSONAS.filter((p) => gameOf(p) === want) : PERSONAS;
      return json({
        zone: zone || null,
        agents: listed.map((p) => ({
          id: p.id,
          agentName: p.agentName,
          displayName: p.displayName,
          description: p.description,
          game: gameOf(p),
          strategy: p.strategy,
          ...(p.style ? { style: p.style } : {}),
          host: zone ? agentNameToHost(p.agentName, zone) : null,
          endpoint: endpointFor(p, env, url, false),
          card: `${endpointFor(p, env, url, false).replace(A2A_JSONRPC_PATH, '')}${A2A_AGENT_CARD_PATH}`,
          // WHAT IT WILL ACTUALLY ANSWER, from the same builder that writes the card — never a second
          // list that can drift from it. A card room deciding who may be SEATED and who may ADVISE
          // needs both answers, and fetching seven cards to find out is seven requests to learn what
          // this response already knows.
          skills: buildCard(p, env, url, false).skills.map((sk) => sk.id),
        })),
      });
    }

    if (request.method === 'GET' && path === A2A_AGENT_CARD_PATH) {
      return json(buildCard(persona, env, url, resolution.onPersonaHost));
    }

    if (path === A2A_JSONRPC_PATH) {
      const response = await a2aServer(resolution, env, url).handle(request);
      // The standard server owns the status and body; only the CORS headers are added here.
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      headers.set('x-pokernight-agent', persona.agentName);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return json(
      {
        error: 'not found',
        path,
        persona: persona.agentName,
        routes: ['/health', '/agents', A2A_AGENT_CARD_PATH, A2A_JSONRPC_PATH],
      },
      404,
    );
  },
} satisfies ExportedHandler<Env>;
