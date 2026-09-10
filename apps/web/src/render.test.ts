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
import { Room } from './pages/Room';
import { Rail } from './components/Rail';
import { PlayPage } from './pages/PlayPage';
import { TablesPage } from './pages/TablesPage';
import { ClubPage } from './pages/ClubPage';
import { NewClubPage } from './pages/NewClubPage';
import { Landing } from './pages/Landing';
import { SignInPage } from './pages/SignInPage';
import { mapDemoPersonas } from './lib/demo';
import { SESSION_ENDED_NOTICE } from './lib/session';
import { route } from './lib/routes';
import { initialState, reduce, type TableState } from './lib/tableSocket';
import { CanastaTable } from './components/CanastaTable';
import { describe as describeCanastaEvent } from './components/CanastaLog';
import { initialCanastaState, reduceCanasta, type CanastaTableState } from './lib/canastaSocket';
import { emptyView, endOfHandScript, event, flopView, seat, welcome } from './lib/mockServer';

const session = { token: 't', playerId: 'p-alice', name: 'Alice' };
const ctx = { seatName: (n: number) => ['Alice', 'Bob'][n] ?? `Seat ${n + 1}`, viewerSeat: 0 };

function table(state: TableState, over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(Table, { state, session, send: () => {}, ...over }));
}

/**
 * A table with two seated players who are both sitting out: no hand, none possible, and — before this
 * — nothing on screen to explain either. This is the state the user walked into.
 */
function stalledView(viewerSeat: number | null = 0) {
  return emptyView(
    [seat(0, 'p-alice', 194, { status: 'sitting-out' }), seat(1, 'p-bob', 192, { status: 'sitting-out' })],
    viewerSeat,
  );
}

describe('a table that cannot deal', () => {
  it('says it is waiting for another player, and why, instead of going silent', () => {
    const html = table(reduce(initialState, welcome(stalledView(0))));
    expect(html).toContain('Waiting for another player');
    expect(html).toContain('All 2 players at this table are sitting out, so no hand can start.');
  });

  /** The misleading message: with no hand running, "Not your turn" is a claim about a hand that
   *  does not exist. */
  it('does not claim it is somebody else’s turn when there is no hand at all', () => {
    const html = table(reduce(initialState, welcome(stalledView(0))));
    expect(html).toContain('No hand running');
    expect(html).not.toContain('Not your turn');
  });

  it('keeps quiet while a hand is actually running', () => {
    const html = table(reduce(initialState, welcome(flopView(0))));
    expect(html).not.toContain('Waiting for another player');
    expect(html).not.toContain('No hand running');
  });
});

describe('a player who has been sat out', () => {
  it('offers "Sit in" prominently, with the reason they are out', () => {
    // The reason arrives the way it does on a reconnect: on `players`, in the welcome.
    const w = welcome(stalledView(0));
    const state = reduce(initialState, {
      ...w,
      players: { ...(w as { players: Record<string, unknown> }).players, 'p-alice': { playerId: 'p-alice', name: 'Alice', kind: 'human', sitOutReason: 'disconnected' } },
    } as typeof w);
    const html = table(state);
    expect(html).toContain('You are sitting out');
    expect(html).toContain('You were sat out when your connection dropped');
    expect(html).toContain('class="primary sit-in"');
    // And the old, easily-missed duplicate is gone: one button, next to its reason.
    expect(html.match(/Sit in/g)?.length).toBe(1);
  });

  it('picks up the reason from a live seat-status event too', () => {
    let state = reduce(initialState, welcome(emptyView([seat(0, 'p-alice', 194), seat(1, 'p-bob', 192)], 0)));
    state = reduce(
      state,
      event({ type: 'seat-status', seat: 0, playerId: 'p-alice', name: 'Alice', stack: 194, status: 'sitting-out', sitOutReason: 'timeouts' }, stalledView(0)),
    );
    expect(state.players['p-alice']?.sitOutReason).toBe('timeouts');
    expect(table(state)).toContain('You were sat out after two missed turns');
  });

  it('drops the reason again once the seat is active', () => {
    let state = reduce(initialState, welcome(stalledView(0)));
    state = reduce(
      state,
      event({ type: 'seat-status', seat: 0, playerId: 'p-alice', name: 'Alice', stack: 194, status: 'active' }, emptyView([seat(0, 'p-alice', 194), seat(1, 'p-bob', 192)], 0)),
    );
    expect(state.players['p-alice']?.sitOutReason).toBeUndefined();
    expect(table(state)).not.toContain('You are sitting out');
  });
});

/**
 * "When one player gets out of money the game gets stuck."
 *
 * The busted player was shown the sit-out notice and its one control, "Sit in" — which does nothing
 * for somebody with no chips. The rebuy existed, as an unlabelled number box among the other
 * controls, with nothing anywhere saying that was what they needed. These assert the two halves of
 * the fix: the notice names the real situation, and the action it offers is the one that helps.
 */
describe('a player who has run out of chips', () => {
  /** Both seats broke and sat out: the deadlock, from the busted player's side. */
  const bustedView = (viewerSeat: number | null = 0) =>
    emptyView([seat(0, 'p-alice', 0, { status: 'sitting-out' }), seat(1, 'p-bob', 0, { status: 'sitting-out' })], viewerSeat);

  it('says they are out of chips, not that they are sitting out', () => {
    const html = table(reduce(initialState, welcome(bustedView(0))));
    expect(html).toContain('You are out of chips');
    expect(html).toContain('Your chips are gone');
    expect(html).not.toContain('You are sitting out');
  });

  it('offers a rebuy as the primary action and never "Sit in"', () => {
    const html = table(reduce(initialState, welcome(bustedView(0))));
    expect(html).toContain('Buy back in');
    expect(html).toContain('class="primary sit-in"');
    // The button that cannot help them is not on the screen at all.
    expect(html).not.toContain('>Sit in<');
  });

  /** The reason the drop happened is true and irrelevant: money is what is in the way. */
  it('talks about money even when they were also disconnected', () => {
    const w = welcome(bustedView(0));
    const state = reduce(initialState, {
      ...w,
      players: {
        ...(w as { players: Record<string, unknown> }).players,
        'p-alice': { playerId: 'p-alice', name: 'Alice', kind: 'human', sitOutReason: 'disconnected' },
      },
    } as typeof w);
    const html = table(state);
    expect(html).toContain('You are out of chips');
    expect(html).not.toContain('connection dropped');
  });

  /** And the table itself says why it cannot deal, in money rather than seat status. */
  it('says the table cannot deal because the chips are gone', () => {
    const html = table(reduce(initialState, welcome(bustedView(0))));
    expect(html).toContain('have run out of chips');
    expect(html).toContain('Buying back in starts the next hand');
  });

  /** A rebuy on a settled table is priced in the table's currency before the press. */
  it('prices the rebuy in the table’s own money', () => {
    const view = {
      ...bustedView(0),
      settlement: 'mandate-transfer' as const,
    };
    const state = reduce(initialState, welcome(view));
    const html = table(state, { settlement: 'mandate-transfer', chipValue: '1000000', assetSymbol: 'SHQ' });
    expect(html).toContain('Buy back in');
    expect(html).toContain('40.00 SHQ');
  });
});

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
   * appears — a bare chip count is honest there and "0.00 SHQ" would not be.
   */
  it('prices every chip figure on a settled table, at the TABLE’s rate', () => {
    const state = reduce(initialState, welcome(flopView(0)));
    const html = table(state, { settlement: 'mandate-transfer', chipValue: '1000000' });
    // The stack: chips primary, money under it, both in the label a screen reader hears.
    expect(html).toContain('aria-label="Stack: 194 chips · 194.00 SHQ"');
    expect(html).toContain('194.00 SHQ');
    // The pot, and the bet sitting in front of Bob.
    expect(html).toContain('4.00 SHQ');
    expect(html).toContain('6.00 SHQ');
    // The mode, on every open seat, before anyone sits.
    expect(html).toContain('<span class="sit-mode money">SHQ</span>');

    // …and on the seat a spectator can actually press, in the label as well as on the plate.
    const spectator = table(reduce(initialState, welcome(flopView(null))), { settlement: 'mandate-transfer', chipValue: '1000000' });
    expect(spectator).toContain('aria-label="Sit at seat 3 — SHQ"');

    // The SAME table at the rate it would have been opened with last week reads as pennies.
    const cheap = table(state, { settlement: 'mandate-transfer', chipValue: '10000' });
    expect(cheap).toContain('aria-label="Stack: 194 chips · 1.94 SHQ"');
    expect(cheap).not.toContain('194.00 SHQ');
  });

  it('says nothing about money on a play-money table, and says THAT', () => {
    const html = table(reduce(initialState, welcome(flopView(0))));
    expect(html).toContain('aria-label="Stack: 194 chips"');
    expect(html).not.toContain('SHQ');
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
  // The room with no session IS the sign-in page: the app routes signed-out visitors to the landing
  // page or to `#/signin` before it gets here, so this is the last line rather than the front door.
  const signIn = (a: AuthState): string =>
    renderToStaticMarkup(createElement(Room, { r: { page: 'home' }, session: null, auth: a, onLogin: () => {} }));

  it('asks what to call you, optionally, and says what the name is for', () => {
    const html = signIn(auth());
    expect(html).toContain('What should we call you?');
    expect(html).toContain('optional');
    expect(html).toContain('other players see');
    // A nameless player has to be able to read straight past it: the copy says what blank means.
    expect(html).toContain('Leave it blank');
  });

  it('offers Home sign-in, naming the Home', () => {
    const html = signIn(auth());
    expect(html).toContain('Sign in to play');
    expect(html).toContain('www.faithnet.me');
    expect(html).not.toContain('dev name');
  });

  /**
   * The disclosure and the ask move together. This config states no ceiling (`home.buyIn` absent),
   * so sign-in requests a plain session — and the screen must therefore claim nothing about money.
   * A button that said "set tonight's limit" without a limit to show would be the same failure as a
   * money grant behind a button labelled only "sign in", in the other direction.
   */
  it('promises nothing about money where the card room states no ceiling', () => {
    const html = signIn(auth());
    expect(html).not.toContain('sets your limit for tonight');
    expect(html).not.toContain('Sign in and set tonight');
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
    home: {
      clientId: 'pokernight',
      origin: 'https://www.faithnet.me',
      zone: 'faithnet.me',
      delegate: '0xabc',
      redirectUri: 'https://poker.faithnet.io/',
      // The ceiling signing in also approves, and the currency it is in. Present here because the
      // live deployment states it, and because the landing copy and the consent block read it.
      buyIn: {
        template: 'poker-buyin',
        maxPerBuyIn: '200000000',
        sessionTotal: '1000000000',
        maxBuyIns: 5,
        maxBuyInChips: 200,
        validSeconds: 43200,
        symbol: 'SHQ',
      },
    },
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

  it('says what the product is, how it works, and carries sign-in itself', () => {
    const html = renderToStaticMarkup(createElement(Landing, { auth: auth(), onLogin: () => {} }));
    // THE PRODUCT, not the machinery. The front door sells an evening together with a mission as
    // the guest at the table; agents, the chain, delegations and treasuries are all still real and
    // all one screen deeper.
    expect(html).toContain('Play together.');
    expect(html).toContain('Meet the mission.');
    expect(html).toContain('Start a club');
    // THE SECOND DOOR. Most visitors are not here to organise anything, and the front door used to
    // offer them nothing but the call to action that asks them to.
    expect(html).toContain('Or just play a hand');
    expect(html).toContain('Set the night');
    expect(html).toContain('Invite a mission to host');
    expect(html).not.toMatch(/faithchain|Smart Agent|delegation|treasury/i);
    // THE GIVING BOUNDARY IS ON THE PAGE, not in a footnote. A mission that is a guest reads
    // differently from a logo beside a donation button, and this is where that difference is stated.
    expect(html).toContain('never a condition of playing');
    expect(html).toContain('guest, not a fundraising screen');
    expect(html).toContain('giving buys no advantage');
    // The promise a stranger is actually reading for: what they get, and in WHICH money — the card
    // room's own coin, named by the card room rather than assumed to be SHQ.
    expect(html).toContain('10,000 SHQ to play with');
    expect(html).toContain('How a night works');
    // The panel is ON the page, not linked away to — and its button says both things it does,
    // because pressing it approves a spending ceiling as well as signing in.
    expect(html).toContain('Sign in and set tonight');
    // …and the ceiling itself is on the page BEFORE the button, in the numbers the Home will show.
    expect(html).toContain('Signing all sets your limit for tonight'.replace('all ', 'in also '));
    expect(html).toContain('200.00 SHQ');
    expect(html).toContain('1,000.00 SHQ');
    expect(html).toContain('Nothing is taken until you sit down');
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
    expect(html.indexOf('Sign in and set tonight')).toBeLessThan(html.indexOf('Try it as someone else'));
    expect(html).toContain('shared by everyone who visits');
  });

  it('shows no demo section at all when the Home offers none', () => {
    const html = renderToStaticMarkup(createElement(SignInPage, { auth: auth(), onLogin: () => {} }));
    expect(html).not.toContain('Try it as someone else');
    expect(html).toContain('Sign in and set tonight');
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
    expect(html).toContain('Sign in and set tonight');
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
    balanceText: null,
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
    balanceText: '10000.000000',
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
    expect(html).toContain('10,000.00 SHQ');
    expect(html).toContain('rowan.treasury');
    // The honest label stays; the chain it settles on is not the player's business here. What they
    // need is that it is test money settled for real, and what a chip is worth here.
    expect(html).toContain('Test SHQ — settled for real, and worth nothing anywhere else');
    expect(html).toContain('1.00 SHQ');
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
    expect(html).toContain('10,000.00 SHQ');
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

/**
 * THE RAIL at rest, and the pages behind it — the frames a person actually sees first, before any read
 * has answered. Every one of these is the state that shows on a slow connection, which is the state
 * nobody looks at while building and everybody sees while using.
 */
describe('the left rail', () => {
  const rail = (clubs: unknown, hash = '#/'): string =>
    renderToStaticMarkup(createElement(Rail, { r: route(hash), clubs } as never));

  it('leads with Play, because being dealt a hand is what somebody came for', () => {
    const html = rail(null);
    expect(html.indexOf('Play')).toBeGreaterThan(-1);
    expect(html.indexOf('Play')).toBeLessThan(html.indexOf('Tables'));
  });

  it('says it is reading rather than claiming you are in no clubs', () => {
    const html = rail(null);
    expect(html).toContain('Reading');
    expect(html).not.toContain('Start a club');
  });

  it('offers starting one, and a word for somebody holding an invitation, when there are none', () => {
    const html = rail([]);
    expect(html).toContain('Start a club');
    // There is nothing to press for an invitation — it is a link in somebody's mail — so this is a
    // sentence, not a control that would lead to a worse version of opening it.
    expect(html).toContain('Open the link you were sent');
  });

  it('names the one club you are in, rather than a count', () => {
    const html = rail([{ clubId: 'c1', name: 'Thursday Night' }]);
    expect(html).toContain('Thursday Night');
    expect(html).toContain('Your club');
    expect(html).not.toContain('Your clubs');
  });

  it('marks the club whose page you are on as the current page, for a screen reader too', () => {
    const html = rail([{ clubId: 'c1', name: 'Thursday Night' }], '#/clubs/c1');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('sidenav-row on');
  });

  it('carries a way to the front page, which otherwise has none once you are signed in', () => {
    expect(rail([])).toContain('#/about');
    expect(rail([])).toContain('What this place is');
  });

  it('is a switcher nowhere: no control claims to change what the app is scoped to', () => {
    // The design considered one and the research rejected it (`docs/NAVIGATION-RESEARCH.md` §14.1).
    // This is the assertion that keeps it out: a club is a link to a page, never a mode.
    const html = rail([{ clubId: 'c1', name: 'Thursday Night' }]);
    expect(html).not.toMatch(/select|switch|<button/i);
  });
});

describe('play, the front door for somebody signed in', () => {
  const session = { token: 't', playerId: 'dev:barb', name: 'Barb' } as never;

  it('offers both games, and asks for neither money nor a club', () => {
    const html = renderToStaticMarkup(createElement(PlayPage, { session }));
    expect(html).toContain('Learn canasta');
    expect(html).toContain('hold');
    expect(html).toContain('Deal me in');
    // Nothing on this page ASKS for anything. Saying "no buy-in, no authorisation" is the opposite of
    // asking; what would break the promise is a field, or a link to the money page or a club.
    expect(html).not.toMatch(/<input|<select|<form/);
    expect(html).not.toContain('#/money');
    expect(html).not.toContain('#/clubs');
  });
});

describe('the tables page', () => {
  const session = { token: 't', playerId: 'dev:barb', name: 'Barb' } as never;
  const page = (tables: unknown): string =>
    renderToStaticMarkup(createElement(TablesPage, { session, tables, err: null, money: 'SHQ' } as never));

  it('sends somebody looking at an empty room to the one thing that always works', () => {
    const html = page([]);
    expect(html).toContain('deal yourself a hand');
  });

  it('says it is loading rather than that the room is empty', () => {
    expect(page(null)).toContain('Loading');
  });
});

describe('a club page for a club you are not in', () => {
  const session = { token: 't', playerId: 'dev:barb', name: 'Barb' } as never;

  it('renders at all, and asks for the club before deciding anything', () => {
    // A 404 from the card room means "not a club you are in" AND "no such club", and this page must
    // never tell the two apart — a 403 would confirm somebody else's arrangements exist.
    const html = renderToStaticMarkup(
      createElement(ClubPage, { clubId: 'c1', session, config: null, money: 'SHQ', onChanged: () => {} } as never),
    );
    expect(html).toContain('Reading the club');
  });
});

describe('starting a club', () => {
  const session = { token: 't', playerId: 'dev:barb', name: 'Barb' } as never;

  it('says what a club is before asking for a name', () => {
    const html = renderToStaticMarkup(createElement(NewClubPage, { session, onStarted: () => {} } as never));
    expect(html).toContain('Start a club');
    // The promise the landing page makes, kept here in the same words: private, and yours.
    expect(html).toContain('nobody outside it can see it');
    expect(html).toContain('Call it');
  });
});

/* ------------------------------------------------------------------- canasta */

/**
 * The canasta board renders, and renders the same thing a real table sends it.
 *
 * A render test rather than a unit test because the crash this whole seam exists to prevent was a
 * RENDER: the poker board reading `view.config.bigBlind` off a canasta view. The cheapest guard
 * against the mirror of that is to actually mount the canasta board on a canasta view.
 */
describe('the canasta board', () => {
  const canastaView = (over: Record<string, unknown> = {}) =>
    ({
      roundNo: 1,
      seedCommit: 'abc',
      seedReveal: null,
      dealer: 0,
      toAct: 0,
      phase: 'draw',
      actionDeadline: null,
      stock: 63,
      pileTop: '8C',
      pileSize: 1,
      frozen: false,
      target: 5000,
      scores: { 0: 0, 1: 0 },
      winner: null,
      melds: { 0: [{ rank: 'A', cards: ['AS', 'AH', 'AD', 'W*'], canasta: false, natural: false }], 1: [] },
      redThrees: { 0: 2, 1: 0 },
      seats: [
        { seat: 0, playerId: 'p-alice', status: 'active', cards: 11, team: 0 },
        { seat: 1, playerId: 'p-bob', status: 'active', cards: 11, team: 1 },
        { seat: 2, playerId: 'p-carol', status: 'active', cards: 11, team: 0 },
        { seat: 3, playerId: 'p-dan', status: 'active', cards: 11, team: 1 },
      ],
      hand: ['W*', '2S', 'AS', '7C', '7D', '3H', '3C'],
      result: null,
      ...over,
    }) as never;

  const stateWith = (over: Record<string, unknown> = {}, playerId: string | null = 'p-alice'): CanastaTableState =>
    reduceCanasta(initialCanastaState, {
      type: 'welcome',
      tableId: 't-1',
      game: 'canasta',
      playerId,
      view: canastaView(over),
      names: { 'p-alice': 'Alice', 'p-bob': 'Bob', 'p-carol': 'Carol', 'p-dan': 'Dan' },
    });

  const render = (state: CanastaTableState) =>
    renderToStaticMarkup(createElement(CanastaTable, { state, session: { ...session, via: 'dev' as const }, send: () => {} }));

  it('draws the piles, the melds, the seats and your own hand', () => {
    const html = render(stateWith());
    expect(html).toContain('Your side');
    expect(html).toContain('The other side');
    expect(html).toContain('Stock');
    expect(html).toContain('Discard');
    expect(html).toContain('2 red threes');
    expect(html).toContain('Alice');
    // A red three is in the hand and is shown, but never as a card you can pick up.
    expect(html).toContain('A red three is a bonus');
  });

  it('shows nobody else’s cards — a fan of BACKS and a count, and nothing more', () => {
    const html = render(stateWith());
    // Every card drawn FACE UP is one this viewer is entitled to: their own seven, the four in the
    // public meld, and the pile's top card. Anything more is somebody else's hand on screen, which
    // is the whole game given away.
    expect((html.match(/class="face"/g) ?? [])).toHaveLength(7 + 4 + 1);
    // The other three seats are a fan of backs and a number. The backs are decoration; the number
    // is the fact, and it is the only thing about their hand this viewer may know.
    expect((html.match(/face-down card/g) ?? []).length).toBeGreaterThan(1);
    expect(html).toContain('>11<');
  });

  it('seats the viewer at the bottom, their PARTNER across, opponents left and right', () => {
    // In a partnership game the first thing you need about anybody at the table is which side they
    // are on, and four equal chips in a row do not say it.
    const html = render(stateWith());
    expect(html).toMatch(/can-plate north[^"]*partner/);
    expect(html).toContain('>partner<');
    expect((html.match(/>opponent</g) ?? [])).toHaveLength(2);
    // Seat 2 is the viewer's partner (0 and 2 are one side) and is the one drawn opposite.
    expect(html).toMatch(/can-plate north[\s\S]{0,200}Carol/);
  });

  it('says which HALF of the turn it is, because the controls depend on it', () => {
    expect(render(stateWith())).toContain('draw a card, or take the discard pile');
    expect(render(stateWith({ phase: 'play' }))).toContain('lay melds if you can, then discard');
  });

  it('tells a spectator they are watching rather than showing them a dead hand', () => {
    const html = render(stateWith({ hand: null }, null));
    expect(html).toContain('You are watching');
  });

  it('shows a spectator ALL FOUR players, including the one in the south chair', () => {
    // A seated player's own chair is the row below the felt, so the south slot stays empty for
    // them. A spectator has no such row — and without a plate there, one of four people was simply
    // not on the table. One player invisible is not a smaller bug than a crash, only a quieter one.
    const html = render(stateWith({ hand: null }, null));
    expect((html.match(/can-plate /g) ?? [])).toHaveLength(4);
    for (const name of ['Alice', 'Bob', 'Carol', 'Dan']) expect(html, name).toContain(name);
  });

  it('draws three plates for a SEATED player, whose own chair is the row below the felt', () => {
    const html = render(stateWith());
    expect((html.match(/can-plate /g) ?? [])).toHaveLength(3);
    expect(html).not.toMatch(/can-plate south/);
  });

  it('scores a finished round in a table with the parts named', () => {
    const result = {
      wentOut: 1,
      concealed: false,
      scores: {
        0: { melds: 100, canastas: 300, redThrees: 200, goingOut: 0, inHand: -40, total: 560, naturalCanastas: 0, mixedCanastas: 1 },
        1: { melds: 80, canastas: 0, redThrees: 0, goingOut: 100, inHand: 0, total: 180, naturalCanastas: 0, mixedCanastas: 0 },
      },
      totals: { 0: 560, 1: 180 },
    };
    const html = render(stateWith({ result, toAct: null }));
    expect(html).toContain('Round over');
    expect(html).toContain('Bob went out');
    expect(html).toContain('Canastas');
    expect(html).toContain('560');
  });

  it('does not crash on a table that has not dealt yet', () => {
    const html = render(stateWith({ toAct: null, pileTop: null, stock: 0, hand: null, melds: { 0: [], 1: [] } }));
    expect(html).toContain('Waiting for the next round');
  });

  it('renders with NO VIEW at all, and then with one, without changing its hook count', () => {
    // React counts hooks and a `useState` placed after `if (!view) return …` makes the second render
    // have more than the first — which is a hard crash (error #310), not a warning, and it took the
    // whole canasta page down to a white screen. Rendering both states in one test is what catches
    // it: `renderToStaticMarkup` runs the component, so a misplaced hook throws right here.
    const connecting = renderToStaticMarkup(
      createElement(CanastaTable, {
        state: { ...initialCanastaState },
        session: { ...session, via: 'dev' as const },
        send: () => {},
      }),
    );
    expect(connecting).toContain('Connecting to the table');
    expect(() => render(stateWith())).not.toThrow();
  });
});

describe('the canasta log', () => {
  const nameOf = (s: number) => `Seat ${s + 1}`;

  it('says what happened, in sentences', () => {
    expect(describeCanastaEvent({ type: 'round-started', roundNo: 1, dealer: 0, stock: 63, seedCommit: 'x' } as never, nameOf)).toMatch(/Seat 1 dealt/);
    expect(describeCanastaEvent({ type: 'took-pile', seat: 1, cards: 9, top: '7C' } as never, nameOf)).toMatch(/took the pile — 9 cards/);
    expect(describeCanastaEvent({ type: 'melded', seat: 0, team: 0, rank: 'A', cards: [], size: 7, canasta: true } as never, nameOf)).toMatch(/a canasta/);
  });

  it('mentions freezing only on the discard that FROZE it, not on every one after', () => {
    // `frozen` is the pile's state, not news. Repeating it every line buries the line that matters.
    const wild = describeCanastaEvent({ type: 'discarded', seat: 0, card: '2C', frozen: true } as never, nameOf);
    const plain = describeCanastaEvent({ type: 'discarded', seat: 0, card: '8S', frozen: true } as never, nameOf);
    expect(wild).toMatch(/freezing the pile/);
    expect(plain).not.toMatch(/freez/);
  });

  it('says NOTHING about the private events, which are a player’s own cards', () => {
    // A log that repeats your hand is a log you cannot show anyone.
    expect(describeCanastaEvent({ type: 'dealt', seat: 0, cards: ['AS'], private: true } as never, nameOf)).toBeNull();
    expect(describeCanastaEvent({ type: 'drew-card', seat: 0, card: 'AS', private: true } as never, nameOf)).toBeNull();
  });
});
