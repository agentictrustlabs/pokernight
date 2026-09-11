/**
 * WHERE AN AGENT LIVES.
 *
 * Three kinds of name reach this, and they resolve differently on purpose:
 *
 *   a PUBLISHED agent, named by its own host — `alice.faithnet.at` serves its agent card and its A2A
 *   endpoint at that name, and the name is the whole address.
 *   a HOUSE persona — a bare label this deployment serves itself, underneath one base URL.
 *   an explicit endpoint — a server-side request forgery primitive, gated off outside local dev.
 */
import { describe, expect, it } from 'vitest';
import { a2aUrl, messageUrlFromCard, resolveAgentBase } from '../src/a2a.js';
import type { Env } from '../src/env.js';

const env = (over: Partial<Env> = {}): Env => ({ AGENT_CARD_ZONE: 'faithnet.at', ...over }) as Env;

describe('a published agent is named by its host', () => {
  it('uses the name itself when it already ends in the zone', () => {
    // Transforming it further would be inventing a different host.
    expect(resolveAgentBase(env(), 'alice.faithnet.at')).toBe('https://alice.faithnet.at');
  });

  it('does so even when this deployment also serves house personas under a base', () => {
    // The base is how the house's own bots are reached; a person's published agent must not be looked
    // for underneath it.
    const e = env({ AGENT_BASE_URL: 'https://agents.faithnet.io' } as Partial<Env>);
    expect(resolveAgentBase(e, 'alice.faithnet.at')).toBe('https://alice.faithnet.at');
  });

  it('is case-insensitive about the name, as hostnames are', () => {
    expect(resolveAgentBase(env(), 'Alice.FaithNet.AT')).toBe('https://alice.faithnet.at');
  });

  it('speaks http to a localhost zone, so local development needs no certificate', () => {
    expect(resolveAgentBase(env({ AGENT_CARD_ZONE: 'localhost' } as Partial<Env>), 'alice.localhost')).toBe('http://alice.localhost');
  });
});

describe('a house persona', () => {
  it('is a bare label under the deployment’s own base', () => {
    const e = env({ AGENT_BASE_URL: 'https://agents.faithnet.io' } as Partial<Env>);
    expect(resolveAgentBase(e, 'pilehawk')).toBe('https://agents.faithnet.io/pilehawk');
  });

  it('falls back to the zone when there is no base', () => {
    // The old transform: dots become hyphens, so one name is one label.
    expect(resolveAgentBase(env(), 'carol.me')).toBe('https://carol-me.faithnet.at');
  });
});

describe('an explicit endpoint', () => {
  it('is refused unless the deployment opted in — the table would fetch it every turn', () => {
    expect(() => resolveAgentBase(env(), 'x', 'https://anywhere.example')).toThrow(/not accepted here/);
  });
});

describe('a person’s own agent', () => {
  it('is looked for at the estate, never under the house base', () => {
    // `alice.me` is a person. The house base serves only the house's personas and answers 404 to any
    // other name — so sending a `.me` name there first meant "your own agent" could never be named,
    // whatever its card advertised.
    const e = env({ AGENT_BASE_URL: 'https://agents.faithnet.io' } as Partial<Env>);
    expect(resolveAgentBase(e, 'alice.me')).toBe('https://alice-me.faithnet.at');
  });

  it('while a house `.svc` persona still goes to the house base first', () => {
    const e = env({ AGENT_BASE_URL: 'https://agents.faithnet.io' } as Partial<Env>);
    expect(resolveAgentBase(e, 'sharkbot.svc')).toBe('https://agents.faithnet.io/sharkbot.svc');
  });
});

describe('a hostname', () => {
  it('is its own address, whichever zone it is in', () => {
    // The estate publishes the same card on more than one zone; the one a person types is the one
    // to ask. Sending `alice.faithnet.io` to the house base asked for a persona that does not exist.
    const e = env({ AGENT_BASE_URL: 'https://agents.faithnet.io' } as Partial<Env>);
    expect(resolveAgentBase(e, 'alice.faithnet.io')).toBe('https://alice.faithnet.io');
    expect(resolveAgentBase(e, 'Alice.FaithNet.IO')).toBe('https://alice.faithnet.io');
  });

  it('is not confused with a two-label agent name or a scoped one', () => {
    const e = env({ AGENT_BASE_URL: 'https://agents.faithnet.io' } as Partial<Env>);
    expect(resolveAgentBase(e, 'sharkbot.svc')).toBe('https://agents.faithnet.io/sharkbot.svc');
    expect(resolveAgentBase(e, 'vault.svc@richcanvas.org')).toBe('https://agents.faithnet.io/vault.svc%40richcanvas.org');
  });
});

describe('where a message goes', () => {
  it('follows the card’s declared endpoint, which for a Home agent is the estate’s edge', () => {
    // The host the card was fetched from refuses a direct call; the card says where it answers.
    const card = { supportedInterfaces: [{ protocolBinding: 'JSONRPC', url: 'https://edge.faithnet.io/api/a2a/alice.me' }] };
    expect(messageUrlFromCard(card, 'https://alice-me.faithnet.ai')).toBe('https://edge.faithnet.io/api/a2a/alice.me');
  });

  it('builds one from the base when the card names none, or names something that is not http(s)', () => {
    expect(messageUrlFromCard({}, 'https://agents.faithnet.io/sharkbot.svc')).toBe('https://agents.faithnet.io/sharkbot.svc/api/a2a');
    expect(messageUrlFromCard({ supportedInterfaces: [{ url: 'ftp://x' }] }, 'https://agents.faithnet.io/sharkbot.svc')).toBe('https://agents.faithnet.io/sharkbot.svc/api/a2a');
  });

  it('does not append the A2A path twice to an endpoint that already carries it', () => {
    // Stored advisers from before cards were read carry a bare base; ones stored since carry the full
    // message URL. Both have to keep working through the same call.
    expect(a2aUrl('https://edge.faithnet.io/api/a2a/alice.me', '/api/a2a')).toBe('https://edge.faithnet.io/api/a2a/alice.me');
    expect(a2aUrl('https://agents.faithnet.io/sharkbot.svc', '/api/a2a')).toBe('https://agents.faithnet.io/sharkbot.svc/api/a2a');
  });
});
