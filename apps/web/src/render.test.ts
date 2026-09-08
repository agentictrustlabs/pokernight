/**
 * Render smoke test. `renderToStaticMarkup` needs no DOM, so it runs in the
 * node environment alongside the pure tests and catches a component that throws
 * or a prop contract that drifts.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthState } from './App';
import { Identity } from './components/Identity';
import { Table } from './components/Table';
import { WinnerBanner } from './components/WinnerBanner';
import { Lobby } from './pages/Lobby';
import { initialState, reduce, type TableState } from './lib/tableSocket';
import { endOfHandScript, flopView, welcome } from './lib/mockServer';

const session = { token: 't', playerId: 'p-alice', name: 'Alice' };
const ctx = { seatName: (n: number) => ['Alice', 'Bob'][n] ?? `Seat ${n + 1}`, viewerSeat: 0 };

function table(state: TableState): string {
  return renderToStaticMarkup(createElement(Table, { state, session, send: () => {} }));
}

describe('table render', () => {
  it('draws seats, chips and the board mid-hand', () => {
    const html = table(reduce(initialState, welcome(flopView(0))));
    expect(html).toContain('Alice');
    expect(html).toContain('aria-label="Stack: 194 chips"');
    expect(html).toContain('class="board"');
    expect(html).toContain('Your turn');
  });

  it('survives the end of a hand', () => {
    let s = reduce(initialState, welcome(flopView(0)));
    for (const m of endOfHandScript()) s = reduce(s, m);
    expect(table(s)).toContain('Alice');
  });

  it('draws the winner window with the board and the per-seat result', () => {
    let s = reduce(initialState, welcome(flopView(0)));
    for (const m of endOfHandScript()) s = reduce(s, m);
    const result = s.lastHand?.result;
    expect(result).toBeTruthy();
    const html = renderToStaticMarkup(createElement(WinnerBanner, { result: result!, ctx, board: s.lastHand!.board }));
    expect(html).toContain('Alice wins 16');
    expect(html).toContain('Two pair, aces and kings');
    expect(html).toContain('wb-board');
    expect(html).toContain('+8');
  });
});

/**
 * The sign-in screen has to say something useful in every state — a failure that renders nothing is
 * the one outcome a person cannot act on.
 */
describe('sign-in render', () => {
  const auth = (over: Partial<AuthState> = {}): AuthState => ({
    config: { devAuth: false, home: { clientId: 'pokernight', origin: 'https://www.faithnet.me', zone: 'faithnet.me', delegate: '0xabc', redirectUri: 'https://poker.faithnet.io/' } },
    configError: null,
    busy: false,
    error: null,
    signInWithHome: () => {},
    dismissError: () => {},
    ...over,
  });
  const signIn = (a: AuthState): string => renderToStaticMarkup(createElement(Lobby, { session: null, auth: a, onLogin: () => {} }));

  it('offers Home sign-in, naming the Home', () => {
    const html = signIn(auth());
    expect(html).toContain('Sign in with your Home');
    expect(html).toContain('www.faithnet.me');
    expect(html).not.toContain('dev name');
  });

  it('offers the dev name box only where the API says dev auth is on', () => {
    const cfg = auth().config;
    const html = signIn(auth({ config: { ...cfg, devAuth: true } as NonNullable<AuthState['config']> }));
    expect(html).toContain('Sign in with your Home');
    expect(html).toContain('Enter with a dev name');
  });

  it('shows a failure and a way onward rather than a blank screen', () => {
    expect(signIn(auth({ error: 'Sign-in was cancelled at your Home.' }))).toContain('Sign-in was cancelled at your Home.');
    const unreachable = signIn(auth({ config: null, configError: '502: bad gateway' }));
    expect(unreachable).toContain('502: bad gateway');
    expect(unreachable).toContain('Try again');
    expect(signIn(auth({ config: null }))).toContain('Checking how you sign in');
  });

  it('shows who you are signed in as', () => {
    const home = renderToStaticMarkup(
      createElement(Identity, {
        session: { token: 't', playerId: 'home:0xabc', name: 'richard.me', via: 'home', address: '0xabcdef0123456789abcdef0123456789abcdef01', agentName: 'richard.me' },
        onSignOut: () => {},
      }),
    );
    expect(home).toContain('richard.me');
    expect(home).toContain('sign out');
    const nameless = renderToStaticMarkup(
      createElement(Identity, {
        session: { token: 't', playerId: 'home:0xabc', name: '0xabcdef01…abcdef01', via: 'home', address: '0xabcdef0123456789abcdef0123456789abcdef01' },
        onSignOut: () => {},
      }),
    );
    expect(nameless).toContain('0xabcdef01…abcdef01');
  });
});
