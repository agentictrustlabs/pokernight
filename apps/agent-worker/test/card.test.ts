import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { AgentCardV1 } from '@agenticprimitives/a2a/standard';
import { A2A_AGENT_CARD_PATH, CANASTA_ACT_SKILL, POKER_ACT_SKILL, agentNameToHost } from '@pokernight/protocol';
import { endpointFor } from '../src/card.js';
import type { Env } from '../src/env.js';
import { PERSONAS, gameOf } from '../src/personas.js';

const ZONE = 'faithnet.ai';

async function card(url: string, headers: Record<string, string> = {}): Promise<AgentCardV1> {
  const res = await SELF.fetch(url, { headers });
  expect(res.status, `${url} -> ${res.status}`).toBe(200);
  return (await res.json()) as AgentCardV1;
}

const PUBLIC_ORIGIN = 'https://agents.faithnet.io';

describe('agent card', () => {
  it('serves one card per persona on the persona host', async () => {
    for (const p of PERSONAS) {
      const host = agentNameToHost(p.agentName, ZONE);
      const c = await card(`https://${host}${A2A_AGENT_CARD_PATH}`);
      expect(c.name).toBe(p.displayName);
      expect(c.description).toBe(p.description);
      expect(c.version).toBe('1.0.0');
      expect(c.capabilities.streaming).toBe(false);
      expect(c.defaultInputModes).toEqual(['application/json']);
      expect(c.defaultOutputModes).toEqual(['application/json']);
      expect(c.supportedInterfaces).toHaveLength(1);
      expect(c.supportedInterfaces[0]).toMatchObject({
        url: `https://${host}/api/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      });
      // ONE SKILL, AND IT IS THE PERSONA'S OWN GAME'S. The table asks for its game's skill by name
      // and refuses to seat an agent whose card does not advertise it, so a poker persona and a
      // canasta persona can never be handed each other's turns — or seated at each other's tables.
      const game = gameOf(p);
      const skill = game === 'canasta' ? CANASTA_ACT_SKILL : POKER_ACT_SKILL;
      expect(c.skills).toHaveLength(1);
      expect(c.skills[0]!.id).toBe(skill);
      // The tables app reads agentKind off the first tag past the id and the game's own name.
      expect(c.skills[0]!.tags.slice(0, 3)).toEqual([skill, game, p.strategy]);
    }
  });

  it('resolves a persona from a path prefix and from ?agent=', async () => {
    for (const p of PERSONAS) {
      const byPath = await card(`http://localhost:8788/${p.agentName}${A2A_AGENT_CARD_PATH}`);
      const byQuery = await card(`http://localhost:8788${A2A_AGENT_CARD_PATH}?agent=${p.agentName}`);
      const byId = await card(`http://localhost:8788${A2A_AGENT_CARD_PATH}?agent=${p.id}`);
      expect(byPath.name).toBe(p.displayName);
      expect(byQuery.name).toBe(p.displayName);
      expect(byId.name).toBe(p.displayName);
      // Every persona is served from ONE host and selected by path (`agents.faithnet.io/<persona>`),
      // because a wildcard on the card zone is already claimed by the estate's demo-a2a worker.
      // The card therefore advertises the path form, which is what a caller must POST to.
      expect(byPath.supportedInterfaces[0]!.url).toBe(`${PUBLIC_ORIGIN}/${p.agentName}/api/a2a`);
    }
  });

  it('falls back to the default persona when nothing names one', async () => {
    const c = await card(`http://localhost:8788${A2A_AGENT_CARD_PATH}`);
    expect(c.name).toBe(PERSONAS[0]!.displayName);
  });

  it('lists every persona at /agents and answers /health', async () => {
    const res = await SELF.fetch('http://localhost:8788/agents');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { zone: string; agents: Array<{ agentName: string; host: string; strategy: string }> };
    expect(body.zone).toBe(ZONE);
    expect(body.agents.map((a) => a.agentName)).toEqual(PERSONAS.map((p) => p.agentName));
    expect(body.agents.map((a) => a.host)).toEqual(PERSONAS.map((p) => agentNameToHost(p.agentName, ZONE)));
    expect(body.agents.filter((a) => a.strategy === 'claude')).toHaveLength(2);

    const health = await SELF.fetch('http://localhost:8788/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'pokernight-agent-worker' });
  });

  it('points a local-dev card at the one-port path form', () => {
    // Off the card zone (wrangler dev on :8788) the endpoint carries the persona in the path, so a
    // single origin serves every persona.
    const env: Env = {
      AGENT_CARD_ZONE: 'localhost',
      PUBLIC_ORIGIN: 'http://localhost:8788',
      DEFAULT_STRATEGY: 'rules',
      LLM_MODEL: 'claude-opus-5',
      LLM_EFFORT: 'low',
    };
    const url = new URL('http://localhost:8788/.well-known/agent-card.json');
    for (const p of PERSONAS) {
      expect(endpointFor(p, env, url, false)).toBe(`http://localhost:8788/${p.agentName}/api/a2a`);
    }
    // On the persona's own host the card names that host, whatever PUBLIC_ORIGIN says.
    expect(endpointFor(PERSONAS[0]!, env, new URL('https://sharkbot-svc.faithnet.ai/x'), true)).toBe(
      'https://sharkbot-svc.faithnet.ai/api/a2a',
    );
  });

  it('404s an unknown path without pretending it is an agent', async () => {
    const res = await SELF.fetch('http://localhost:8788/nope');
    expect(res.status).toBe(404);
  });
});
