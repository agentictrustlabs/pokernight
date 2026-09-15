/**
 * The one thing about the API client worth testing without a server: what happens when there is no
 * server — or when the browser refuses to send the request in the first place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('a request that never arrived', () => {
  it('is an ApiError with status 0, not a bare TypeError nobody catches', () => {
    // `fetch` rejects with a TypeError for a blocked CORS preflight, a dropped connection or a DNS
    // failure. That is not an ApiError, so every caller's `instanceof ApiError` check fell through to
    // its own generic sentence — a missing CORS method read on screen as "that could not be saved".
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    return expect(api.getSchedule('c1', 't')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 0 && /Could not reach the room/.test(e.message),
    );
  });

  it('names the method and the path, because "it failed" is not a lead', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    return expect(api.setSchedule('c1', {} as never, 't')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && /PUT/.test((e as ApiError).message) && /schedule/.test((e as ApiError).message),
    );
  });

  it('still reports a real refusal as a refusal, with the room’s own words', () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'only a host of this club can do that' }), { status: 403 })),
    );
    return expect(api.setSchedule('c1', {} as never, 't')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && (e as ApiError).status === 403 && /only a host/.test((e as ApiError).message),
    );
  });
});
