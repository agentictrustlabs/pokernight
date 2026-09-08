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
import { MoneyPanel } from './components/MoneyPanel';
import { StartPanel } from './components/StartPanel';
import { TreasuryPanel } from './components/TreasuryPanel';
import { Table } from './components/Table';
import { WinnerBanner } from './components/WinnerBanner';
import { Lobby } from './pages/Lobby';
import { Landing } from './pages/Landing';
import { SignInPage } from './pages/SignInPage';
import { mapDemoPersonas } from './lib/demo';
import { SESSION_ENDED_NOTICE } from './lib/session';
import { initialState, reduce, type TableState } from './lib/tableSocket';
import { endOfHandScript, flopView, welcome } from './lib/mockServer';

const session = { token: 't', playerId: 'p-alice', name: 'Alice' };
const ctx = { seatName: (n: number) => ['Alice', 'Bob'][n] ?? `Seat ${n + 1}`, viewerSeat: 0 };

function table(state: TableState, over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(Table, { state, session, send: () => {}, ...over }));
}

describe('table render', () => {
  it('draws seats, chips and the board mid-hand', () => {
    const html = table(reduce(initialState, welcome(flopView(0))));
    expect(html).toContain('Alice');
    expect(html).toContain('aria-label="Stack: 194 chips"');
    expect(html).toContain('class="board"');
    expect(html).toContain('Your turn');
  });

  /**
   * Bug 2: on a settled table every chip amount a player reads carries the money it is worth, and
   * the settlement mode is legible before anyone takes a seat. On a play-money table none of it
   * appears — a bare chip count is honest there and "0.00 USDC" would not be.
   */
  it('prices every chip figure on a settled table, at the TABLE’s rate', () => {
    const state = reduce(initialState, welcome(flopView(0)));
    const html = table(state, { settlement: 'mandate-transfer', chipValue: '1000000' });
    // The stack: chips primary, money under it, both in the label a screen reader hears.
    expect(html).toContain('aria-label="Stack: 194 chips · 194.00 USDC"');
    expect(html).toContain('194.00 USDC');
    // The pot, and the bet sitting in front of Bob.
    expect(html).toContain('4.00 USDC');
    expect(html).toContain('6.00 USDC');
    // The mode, on every open seat, before anyone sits.
    expect(html).toContain('<span class="sit-mode money">USDC</span>');

    // …and on the seat a spectator can actually press, in the label as well as on the plate.
    const spectator = table(reduce(initialState, welcome(flopView(null))), { settlement: 'mandate-transfer', chipValue: '1000000' });
    expect(spectator).toContain('aria-label="Sit at seat 3 — USDC"');

    // The SAME table at the rate it would have been opened with last week reads as pennies.
    const cheap = table(state, { settlement: 'mandate-transfer', chipValue: '10000' });
    expect(cheap).toContain('aria-label="Stack: 194 chips · 1.94 USDC"');
    expect(cheap).not.toContain('194.00 USDC');
  });

  it('says nothing about money on a play-money table, and says THAT', () => {
    const html = table(reduce(initialState, welcome(flopView(0))));
    expect(html).toContain('aria-label="Stack: 194 chips"');
    expect(html).not.toContain('USDC');
    expect(html).toContain('<span class="sit-mode">play money</span>');
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
    personas: [],
    demoBusy: null,
    demoError: null,
    connectAsDemo: () => {},
    notice: null,
    ...over,
  });
  const signIn = (a: AuthState): string => renderToStaticMarkup(createElement(Lobby, { session: null, auth: a, onLogin: () => {} }));

  it('offers Home sign-in, naming the Home', () => {
    const html = signIn(auth());
    expect(html).toContain('Sign in to play');
    expect(html).toContain('www.faithnet.me');
    expect(html).not.toContain('dev name');
  });

  it('offers the dev name box only where the API says dev auth is on', () => {
    const cfg = auth().config;
    const html = signIn(auth({ config: { ...cfg, devAuth: true } as NonNullable<AuthState['config']> }));
    expect(html).toContain('Sign in to play');
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
    // A Home that knows someone as a phone number asserts no name and hands back their address.
    // The top bar of every screen is not the place for a raw `0x…`, so it reads "You" — with the
    // address still on the title for anyone who wants it.
    expect(nameless).toContain('>You<');
    expect(nameless).not.toContain('0xabcdef01…abcdef01');
    expect(nameless).toContain('title="0xabcdef0123456789abcdef0123456789abcdef01"');
  });
});

/**
 * The front door and the doors in it. The landing page is the only thing a signed-out stranger sees,
 * so what it says when it knows nothing yet matters as much as what it says when it knows everything.
 */
describe('landing and sign-in surfaces', () => {
  const cfg = {
    devAuth: false,
    home: { clientId: 'pokernight', origin: 'https://www.faithnet.me', zone: 'faithnet.me', delegate: '0xabc', redirectUri: 'https://poker.faithnet.io/' },
  };
  const auth = (over: Partial<AuthState> = {}): AuthState => ({
    config: cfg,
    configError: null,
    busy: false,
    error: null,
    signInWithHome: () => {},
    dismissError: () => {},
    personas: [],
    demoBusy: null,
    demoError: null,
    connectAsDemo: () => {},
    notice: null,
    ...over,
  });
  const personas = mapDemoPersonas([
    { handle: 'alice', sa: '0xb0d11ce19b756a682e78b4904cd8d832303b3d11', name: 'Alice Okoro', blurb: '' },
    { handle: 'jpreg', sa: '0x9e15ef3b4c1add3bb55381c88ac244575bf80b2a', name: 'Jordan Pike — Joshua Project', blurb: '' },
  ]);

  it('says what Pokernight is, how it works, and carries sign-in itself', () => {
    const html = renderToStaticMarkup(createElement(Landing, { auth: auth(), onLogin: () => {} }));
    expect(html).toContain('at the same table');
    // The promise a stranger is actually reading for: what they get, in money.
    expect(html).toContain('10,000 test USDC');
    expect(html).toContain('How a night works');
    expect(html).toContain('Sign in to play'); // the panel is ON the page, not linked away to
    expect(html).toContain('In the room right now');
    // Before the lobby answers, it says it is reading it — never an empty claim about the room.
    expect(html).toContain('Reading the lobby…');
  });

  it('offers the Home\'s demo users as a real list, with name, handle and address', () => {
    const html = renderToStaticMarkup(createElement(SignInPage, { auth: auth({ personas }), onLogin: () => {} }));
    expect(html).toContain('Alice Okoro');
    expect(html).toContain('alice');
    expect(html).toContain('0xb0d11ce1…303b3d11');
    expect(html).toContain('Jordan Pike');
    // Ranked below the real way in, folded shut, and honest about what they are.
    expect(html.indexOf('Sign in to play')).toBeLessThan(html.indexOf('Try it as someone else'));
    expect(html).toContain('shared by everyone who visits');
  });

  it('shows no demo section at all when the Home offers none', () => {
    const html = renderToStaticMarkup(createElement(SignInPage, { auth: auth(), onLogin: () => {} }));
    expect(html).not.toContain('Try it as someone else');
    expect(html).toContain('Sign in to play');
  });

  it('says plainly when the Home will not mint a demo session for this app', () => {
    const html = renderToStaticMarkup(
      createElement(SignInPage, { auth: auth({ personas, demoError: 'Demo sign-in is not enabled for this app yet' }), onLogin: () => {} }),
    );
    expect(html).toContain('Demo sign-in is not enabled for this app yet');
  });

  it('tells a person whose session ended why they are looking at sign-in', () => {
    const html = renderToStaticMarkup(createElement(SignInPage, { auth: auth({ notice: SESSION_ENDED_NOTICE }), onLogin: () => {} }));
    expect(html).toContain(SESSION_ENDED_NOTICE);
    expect(html).toContain('Sign in to play');
  });
});

/**
 * The money surfaces. `renderToStaticMarkup` runs the FIRST render only — no effects, so no fetch —
 * which is exactly the state a person sees for the first few hundred milliseconds. It has to say
 * something true then too, rather than rendering an empty box while it decides.
 */
describe('money render', () => {
  const moneySession = { token: 't', playerId: 'home:0xabc', name: 'Alice', via: 'home' as const, address: '0xabc' };

  it('says it is loading the treasury rather than showing an empty panel', () => {
    const html = renderToStaticMarkup(createElement(TreasuryPanel, { session: moneySession, config: null }));
    expect(html).toContain('Your treasury');
    expect(html).toContain('Loading…');
  });

  const emptyTreasury = {
    chainId: 34348,
    asset: '0x' + 'da'.repeat(20),
    chipValue: '1000000',
    person: '0x' + '11'.repeat(20),
    personName: null,
    chosen: null,
    chosenName: null,
    balance: null,
    balanceUsdc: null,
    candidates: [],
    discoveryError: null,
    create: { mode: 'home-portal' as const, portalUrl: 'https://home.example/treasuries', canName: true },
    mandate: {
      present: false,
      treasury: null,
      maxPerBuyIn: '200000000',
      sessionTotal: '1000000000',
      maxBuyIns: 5,
      validUntil: 1_800_000_000,
      payee: '0x' + 'a0'.repeat(20),
      asset: '0x' + 'da'.repeat(20),
      problem: null,
      unavailable: null,
    },
    faucet: { available: true, asset: 'Mock USD Coin', reason: null },
    notice: null,
    unavailable: null,
  };
  const fundedTreasury = {
    ...emptyTreasury,
    chosen: '0x' + 'ab'.repeat(20),
    chosenName: 'rowan.treasury',
    balance: '10000000000',
    balanceUsdc: '10000.000000',
  };

  const money = (over: Record<string, unknown> = {}) => ({
    tableId: 't1',
    settlement: 'mandate-transfer',
    session: moneySession,
    treasury: null,
    onChanged: () => {},
    ...over,
  });

  it('draws nothing at all on a play-money table — there is no money to show', () => {
    const html = renderToStaticMarkup(createElement(MoneyPanel, money({ settlement: 'play-money' })));
    expect(html).toBe('');
  });

  it('asks a signed-out visitor at a settled table to sign in, and says why', () => {
    const html = renderToStaticMarkup(createElement(MoneyPanel, money({ session: null })));
    expect(html).toContain('This table plays for money');
    expect(html).toContain('Sign in to see yours');
  });

  it('tells a seated player with no treasury where to fix that', () => {
    const html = renderToStaticMarkup(createElement(MoneyPanel, money()));
    // On the very first render the treasury read has not answered yet, so the panel says it is
    // still checking rather than asserting the player has nothing.
    expect(html).toContain('Checking which treasury funds your play');
    expect(html).toContain('Nothing yet. Money moves when you sit down');
  });

  /**
   * The default view is MONEY, not machinery. An address, a transaction hash and a mandate cap all
   * still exist — they are behind "Receipts and addresses" — but none of them may appear before a
   * person has asked for them, and no row may say "not settled" about a hand that never settles.
   */
  it('leads with the balance and keeps every address and hash behind a disclosure', () => {
    const view = { ...fundedTreasury, mandate: { ...fundedTreasury.mandate, present: true } };
    const html = renderToStaticMarkup(createElement(MoneyPanel, money({ treasury: view, chipValue: '1000000' })));
    // Money, in money words, by name.
    expect(html).toContain('10,000.00 USDC');
    expect(html).toContain('rowan.treasury');
    // The honest labels stay: what kind of money this is, and what a chip is worth here.
    expect(html).toContain('Test USDC on faithchain');
    expect(html).toContain('1.00 USDC');
    // Everything a stranger does not need is inside the disclosure, and nowhere before it.
    const [before, after] = html.split('<summary>Receipts and addresses</summary>');
    expect(after).toBeDefined();
    expect(before).not.toContain('0xabab');
    expect(before).not.toContain('per buy-in');
    expect(after).toContain('0xabab');
  });

  /**
   * The set-up card is the whole onboarding, so what it says on first paint is the thing a stranger
   * reads. One action, no machinery: a person who has never heard of a treasury, a test-asset mint
   * or a delegation must not meet any of those words before they have played a hand.
   */
  it('offers a newcomer ONE action, in money words, with no machinery in sight', () => {
    const html = renderToStaticMarkup(
      createElement(StartPanel, { session: moneySession, config: null, treasury: emptyTreasury, onChanged: () => {} }),
    );
    expect(html).toContain('Get ready to play');
    expect(html).toContain('Set up your stake');
    // Not one of the words the old panel led with.
    for (const jargon of ['treasury Smart Agent', 'chartered', 'delegation', 'caveat', 'mandate', 'mint', '0xab']) {
      expect(html.split('<details')[0]).not.toContain(jargon);
    }
  });

  it('leads with the balance by name once a player is set up', () => {
    const ready = { ...fundedTreasury, mandate: { ...fundedTreasury.mandate, present: true } };
    const html = renderToStaticMarkup(createElement(StartPanel, { session: moneySession, config: null, treasury: ready, onChanged: () => {} }));
    expect(html).toContain('10,000.00 USDC');
    expect(html).toContain('rowan.treasury');
    expect(html.split('<details')[0]).not.toContain('0xab');
  });

  it('names what is left when the money is there and the say-so is not', () => {
    const html = renderToStaticMarkup(
      createElement(StartPanel, { session: moneySession, config: null, treasury: fundedTreasury, onChanged: () => {} }),
    );
    expect(html).toContain('how much a table may take from your money');
    expect(html).toContain('Authorise buy-ins at your Home');
    expect(html).toContain('undo it there whenever you like');
  });

  it('never offers the player’s own identity as somewhere to spend from', () => {
    const html = renderToStaticMarkup(createElement(TreasuryPanel, { session: moneySession, config: null }));
    expect(html).not.toContain('your Smart Agent');
    expect(html).not.toContain('Another treasury you custody');
  });
});
