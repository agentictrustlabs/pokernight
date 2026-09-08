/**
 * The Home's demo users, as far as this app decides anything about them: the list mapping, and what
 * a refusal means. Connecting itself is the Home's and the Worker's job, and is tested there.
 */
import { describe, expect, it } from 'vitest';
import type { QuickConnectIdentity } from '@agenticprimitives/connect-client';
import { DEMO_NOT_ENABLED, describeDemoError, mapDemoPersonas } from './demo';

/** The nine the live Home returns today, trimmed to the two shapes that matter. */
const alice: QuickConnectIdentity = {
  handle: 'alice',
  sa: '0xb0d11ce19b756a682e78b4904cd8d832303b3d11',
  name: 'Alice Okoro',
  blurb: '',
  custodian: '0xe36310847C8A35406f48312EC04fb4464e03ef21',
};
const jordan: QuickConnectIdentity = {
  handle: 'jpreg',
  sa: '0x9E15EF3B4C1ADD3BB55381C88AC244575BF80B2A',
  name: 'Jordan Pike — Joshua Project',
  blurb: 'Runs the Joshua Project org agent.',
};

describe('mapDemoPersonas', () => {
  it('maps what the Home sends into what the list draws', () => {
    const [a, j] = mapDemoPersonas([alice, jordan]);
    expect(a).toEqual({
      handle: 'alice',
      sa: '0xb0d11ce19b756a682e78b4904cd8d832303b3d11',
      shortSa: '0xb0d11ce1…303b3d11',
      name: 'Alice Okoro',
      blurb: null, // the Home sends "" for most of them; an empty blurb is no blurb
    });
    expect(j?.sa).toBe('0x9e15ef3b4c1add3bb55381c88ac244575bf80b2a'); // lowercased: it is an address
    expect(j?.name).toBe('Jordan Pike — Joshua Project');
    expect(j?.blurb).toBe('Runs the Joshua Project org agent.');
  });

  it('renders nothing at all when the Home offers nothing (or cannot be reached)', () => {
    expect(mapDemoPersonas([])).toEqual([]);
    expect(mapDemoPersonas(null)).toEqual([]);
    expect(mapDemoPersonas(undefined)).toEqual([]);
    expect(mapDemoPersonas('personas' as unknown as QuickConnectIdentity[])).toEqual([]);
  });

  it('drops entries it could not connect as, rather than drawing a dead row', () => {
    const junk = [
      { handle: '', sa: alice.sa, name: 'No handle' },
      { handle: 'nosa', sa: 'not-an-address', name: 'No address' },
      { handle: 'short', sa: '0xabc', name: 'Truncated address' },
      null,
      alice,
    ] as unknown as QuickConnectIdentity[];
    expect(mapDemoPersonas(junk).map((p) => p.handle)).toEqual(['alice']);
  });

  it('falls back to the handle when the Home named nobody, and de-duplicates', () => {
    const out = mapDemoPersonas([{ handle: 'bob', sa: alice.sa } as QuickConnectIdentity, { ...alice, handle: 'BOB' } as QuickConnectIdentity]);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('bob');
  });
});

describe('describeDemoError', () => {
  it('names the one refusal we actually get today instead of hiding it', () => {
    // `POST /connect/demo-signin` checks the Home's CURATED whitelabel registry; `pokernight` is
    // registered self-service, so it answers 400 {"error":"a registered client_id is required"}.
    // That is an operator change at the Home, and the person deserves to be told so.
    expect(describeDemoError(new Error('a registered client_id is required'))).toBe(DEMO_NOT_ENABLED);
    expect(DEMO_NOT_ENABLED).toMatch(/not enabled for this app yet/);
  });

  it('distinguishes the Home refusing from the card room refusing', () => {
    expect(describeDemoError(new Error('home origin "https://www.faithnet.me" is not a trusted issuer for this deployment'))).toMatch(
      /does not trust that Home/,
    );
    expect(describeDemoError(new Error('quick connect returned an incomplete session (missing id_token or delegation)'))).toMatch(
      /partial sign-in/,
    );
    expect(describeDemoError(new TypeError('Failed to fetch'))).toMatch(/Could not reach the Home/);
  });

  it('still says something for anything else', () => {
    expect(describeDemoError(new Error('boom'))).toBe('Could not connect as that demo user — boom');
    expect(describeDemoError(null)).toBe('Could not connect as that demo user.');
  });
});
