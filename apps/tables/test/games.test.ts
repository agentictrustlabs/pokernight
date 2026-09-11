/**
 * A table plays ONE game, chosen when it is opened and never re-read.
 *
 * The stamp is the same discipline as the chip rate, the settlement asset and the club, and it has
 * the sharpest reason of the four: a table whose game was looked up rather than recorded could be
 * dealt different rules than the ones its players sat down to, with their money already on it.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { canastaGame, DEFAULT_CONFIG } from '@pokernight/canasta';
import { pokerGame } from '@pokernight/engine';
import type { TableSummary } from '@pokernight/protocol';
import { TestClient, createTableViaHttp, devSession, engineReady, sleep, soloClub } from './helpers.js';
import { DEFAULT_GAME, gameFor, gameIds } from '../src/games.js';

describe('the game registry', () => {
  it('deals poker and canasta, and says so by name', () => {
    expect(gameIds()).toEqual(['poker', 'canasta']);
    expect(gameFor('poker').name).toBe("Texas Hold'em");
    expect(gameFor('canasta').name).toBe('Canasta');
    expect(gameFor(undefined).id).toBe(DEFAULT_GAME);
  });

  it('knows which of them moves money and which is played for score', () => {
    // The flag the host reads before it opens any settlement path at all. Canasta has no stakes, so
    // a canasta table settles nothing rather than settling amounts of zero.
    expect(gameFor('poker').staked).toBe(true);
    expect(gameFor('canasta').staked).toBe(false);
  });

  it('sends an agent seat to the right skill for the game it is playing', () => {
    // An agent that plays poker cannot play canasta. Naming the skill per game is what stops the two
    // being handed each other's turns.
    expect(gameFor('poker').actSkill).toBe('poker.act');
    expect(gameFor('canasta').actSkill).toBe('canasta.act');
  });

  it('refuses a game it does not have, and says what it does have', () => {
    // Never a silent fall-through to whatever is first in the list: a table stamped with a game this
    // deployment no longer ships must fail loudly rather than quietly becoming poker.
    expect(() => gameFor('bridge')).toThrow(/does not deal "bridge"/);
    expect(() => gameFor('bridge')).toThrow(/poker, canasta/);
  });

  it('answers the same object for the same id, so a table resolves its game once', () => {
    expect(gameFor('poker')).toBe(gameFor('poker'));
  });
});

describe('the game a table plays', () => {
  it('is stamped on every table, including when it is the default', async () => {
    // Always present, never only-when-non-default: a field written only for the unusual case cannot
    // be told apart from an old row that predates the field.
    const t = await createTableViaHttp('stamped');
    expect(t.game).toBe('poker');
  });

  it('is refused at creation when this deployment does not deal it', async () => {
    const { token } = await devSession('bridge hopeful');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'bridge night', game: 'bridge' }),
    });
    expect(res.status).toBe(400);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/does not deal "bridge"/);
  });

  it('opens a CANASTA table, stamped and set up in canasta’s own terms', async () => {
    const { token } = await devSession('canasta host');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Thursday canasta', game: 'canasta' }),
    });
    expect(res.status).toBe(201);
    const t = (await res.json()) as TableSummary & { gameConfig?: { target?: number } };
    expect(t.game).toBe('canasta');
    // Four seats because that is the game, and no stakes because it is played for score.
    expect(t.config.seats).toBe(4);
    expect(t.config.minStake).toBe(0);
    expect(t.config.maxStake).toBe(0);
    // The game's own configuration rides beside the generic setup, and it is canasta's, not poker's.
    expect(t.gameConfig?.target).toBe(5000);
  });

  it('refuses a canasta table that is not four-handed, in the game’s own words', async () => {
    const { token } = await devSession('six handed');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'six canasta', game: 'canasta', config: { seats: 6 } }),
    });
    expect(res.status).toBe(400);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/four-handed/);
  });

  it('writes no money rows for a game that has no money', async () => {
    // The settlement view is the money view. A canasta table has scores, not chips, and a score in a
    // chip ledger would be read back as an amount somebody is owed.
    const { token } = await devSession('unstaked');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'score only', game: 'canasta' }),
    });
    const t = (await res.json()) as TableSummary;
    const view = await SELF.fetch(`http://tables.test/tables/${t.tableId}/settlement`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(view.status).toBe(200);
    const rows = (await view.json()) as { rows?: unknown[] };
    expect(rows.rows ?? []).toEqual([]);
  });

  it('lists poker and canasta tables side by side in one lobby', async () => {
    const { token } = await devSession('both games');
    for (const game of ['poker', 'canasta']) {
      await SELF.fetch('http://tables.test/tables', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: `${game} table`, game }),
      });
    }
    const list = (await (await SELF.fetch('http://tables.test/tables')).json()) as TableSummary[];
    const games = new Set(list.map((t) => t.game));
    expect(games.has('poker')).toBe(true);
    expect(games.has('canasta')).toBe(true);
  });

  it('names the game on the ONE-TABLE read, including for a club table no list carries', async () => {
    // A client picks its board from this. A club's tables are not in the public lobby, so a client
    // that could only learn the game by listing tables could not learn it for exactly the tables
    // that are private — which sent every club table to "that table is not here".
    const { club, token } = await soloClub('game detail');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'club canasta', game: 'canasta', club }),
    });
    expect(res.status).toBe(201);
    const t = (await res.json()) as TableSummary;
    // Not in the public list, by design.
    const pickup = (await (await SELF.fetch('http://tables.test/tables')).json()) as TableSummary[];
    expect(pickup.find((x) => x.tableId === t.tableId)).toBeUndefined();
    // …and still answerable, to a member, about itself.
    const detail = await SELF.fetch(`http://tables.test/tables/${t.tableId}`, { headers: { authorization: `Bearer ${token}` } });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { game?: string }).game).toBe('canasta');
    // A stranger still learns nothing, not even the game.
    const other = await devSession('stranger to this club');
    const refused = await SELF.fetch(`http://tables.test/tables/${t.tableId}`, { headers: { authorization: `Bearer ${other.token}` } });
    expect(refused.status).toBe(404);
  });

  it('names the game on a PICKUP table’s one-table read too', async () => {
    const { token } = await devSession('pickup detail');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'pickup poker' }),
    });
    const t = (await res.json()) as TableSummary;
    const detail = (await (await SELF.fetch(`http://tables.test/tables/${t.tableId}`)).json()) as { game?: string };
    expect(detail.game).toBe('poker');
  });

  it('tells a socket which game it is joining, in the same frame as the first view', async () => {
    // A client that had to fetch the game over HTTP would be racing its own socket, and the race it
    // loses is the one where a poker board is mounted against another game's view. This is the
    // frame that stops that: the game arrives with the view, not after it. It cost a crash to learn.
    const { token } = await devSession('welcome game');
    for (const game of ['poker', 'canasta']) {
      const res = await SELF.fetch('http://tables.test/tables', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: `${game} welcome`, game }),
      });
      const t = (await res.json()) as TableSummary;
      const c = await TestClient.connect(t.tableId, token);
      const welcome = await c.waitFor((m) => m.type === 'welcome');
      if (welcome.type !== 'welcome') throw new Error('unreachable');
      expect(welcome.game).toBe(game);
      c.close();
    }
  });

  it('rejects a game id that is not an id at all, before it reaches the table', async () => {
    const { token } = await devSession('bad game id');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'nope', game: 'Poker Night!' }),
    });
    expect(res.status).toBe(400);
  });

  it('is on the lobby listing, so a client knows what is dealt before it opens the table', async () => {
    const mine = await createTableViaHttp('listed');
    const list = (await (await SELF.fetch('http://tables.test/tables')).json()) as TableSummary[];
    expect(list.find((t) => t.tableId === mine.tableId)?.game).toBe('poker');
    // Every table says what it deals. The lobby holds more than one game now, so this asserts that
    // the field is always there rather than that everything in it is poker.
    for (const t of list) expect(typeof t.game).toBe('string');
  });
});

/**
 * An UNSTAKED game has no such thing as broke, and reading its zero as poverty stranded a player.
 *
 * Canasta reports every seat's stack as zero, because a seat's holding in that game is its cards.
 * The reconnect sit-in was gated on having chips — right at a poker table, where a zero means the
 * player needs to rebuy and sitting them in would hide that. At a canasta table it meant somebody
 * whose connection blinked was sat out permanently, at a game with no rebuy to offer them.
 */
describe('sitting back in at a table with no stakes', () => {
  it.skipIf(!engineReady)('happens on reconnect, even though every stack is zero', async () => {
    const { token, playerId } = await devSession('canasta reconnect');
    const res = await SELF.fetch('http://tables.test/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'reconnect canasta', game: 'canasta' }),
    });
    const t = (await res.json()) as TableSummary;

    const first = await TestClient.connect(t.tableId, token);
    await first.waitFor((m) => m.type === 'welcome');
    first.send({ type: 'join', seat: 0, buyIn: 1 });
    await first.waitFor((m) => m.type === 'event' && m.event.type === 'seat-joined');

    // The connection drops. The table sits the seat out, which is right — a vanished player must
    // not hold up three others.
    first.close();
    await sleep(600);
    const away = (await (await SELF.fetch(`http://tables.test/tables/${t.tableId}`)).json()) as {
      view: { seats: { seat: number; status: string }[] };
    };
    expect(away.view.seats.find((s) => s.seat === 0)?.status).toBe('sitting-out');

    // …and coming back undoes it. Before this, a zero stack read as "cannot afford to play" and the
    // seat stayed out forever.
    const back = await TestClient.connect(t.tableId, token);
    await back.waitFor((m) => m.type === 'welcome');
    await sleep(600);
    const home = (await (await SELF.fetch(`http://tables.test/tables/${t.tableId}`)).json()) as {
      view: { seats: { seat: number; playerId: string; status: string }[] };
    };
    const mine = home.view.seats.find((s) => s.playerId === playerId);
    expect(mine?.status, 'a canasta player who reconnects is dealt back in').toBe('active');
    back.close();
  }, 20_000);
});

/**
 * HOW LONG A TABLE WAITS is the GAME's to decide, not the host's.
 *
 * A poker turn is a decision about two cards; a canasta turn is a search through a dozen for melds
 * that may not be there, made by somebody who is often learning the game. Holding both to the same
 * patience benched the canasta player for thinking — "it keeps taking the person out of the game".
 */
describe('the patience a game asks for', () => {
  it('lets canasta wait longer than the host would', () => {
    expect(canastaGame.maxTimeouts).toBe(4);
  });

  it('gives a canasta turn twice as long as a poker one', () => {
    // Forty-five seconds was inherited from poker rather than chosen for this game.
    expect(DEFAULT_CONFIG.turnMs).toBe(90_000);
  });

  it('leaves poker on the host’s own default, which is right for it', () => {
    // A seat held by somebody who has gone stops a poker table, and a missed turn there costs a
    // check or a fold in a second.
    expect(pokerGame.maxTimeouts).toBeUndefined();
  });
});
