/**
 * A PRACTICE TABLE: one per person, always the same one, never in anybody's lobby.
 *
 * THE PROBLEM IT SOLVES. Learning canasta meant opening a new table every time — name it, pick the
 * game, take a seat, fill three chairs, switch the coach on — and every attempt left a dead game
 * behind in the public list. "I just want to be able to join a coaching table and leave and then
 * reset to new game and get coached again."
 *
 * So: yours, reused, and resettable.
 *
 * THE ID IS DERIVED, NOT STORED. A practice table is `sha256(playerId + game)` rendered as a UUID,
 * which means the same person asking twice gets the same table without anything having to remember
 * that they have one. No index, no row, nothing to fall out of step with the table itself — and a
 * table that is never written down anywhere is a table that cannot leak into a listing.
 *
 * IT IS IN NO LOBBY. Ordinary tables are created BY a `LobbyDO`, which is what puts them in a list.
 * This one is initialised directly, so it exists, is reachable by whoever it belongs to, and appears
 * in nothing — because a lobby holding everybody's practice games is exactly the pile of tables this
 * was built to stop.
 */

import type { Env } from './env.js';
import { practiceConfigFor } from './games.js';

/** The namespace, so this hash can never collide with any other id derived from a player. */
const NS = 'pokernight:practice:v1';

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The one practice table this person has for this game.
 *
 * Shaped like a UUID because every other table id is one and the whole estate — routes, links, the
 * client's `CLUB_ID_RE`-adjacent checks — is written for that shape. Version and variant nibbles are
 * set so it is a well-formed v4-looking id rather than a bare hash wearing dashes.
 */
export async function practiceTableId(playerId: string, game: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${NS}:${game}:${playerId}`);
  const h = hex(await crypto.subtle.digest('SHA-256', bytes));
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `${((parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
}

/** What a practice table is called, in the person's own words. */
export function practiceTableName(playerName: string | undefined, game: string): string {
  const who = (playerName ?? '').trim();
  const what = game === 'canasta' ? 'canasta practice' : `${game} practice`;
  return who ? `${who}'s ${what}` : what;
}

/**
 * Make sure this person's practice table exists, and hand back its id.
 *
 * Idempotent twice over: the id is derived, and `init` on a table that already exists returns its
 * summary untouched. Calling this a hundred times produces one table.
 */
export async function ensurePracticeTable(
  env: Env,
  playerId: string,
  playerName: string | undefined,
  game: string,
): Promise<{ ok: true; tableId: string } | { ok: false; error: string }> {
  const tableId = await practiceTableId(playerId, game);
  const res = await env.TABLES.get(env.TABLES.idFromName(tableId)).fetch('https://table/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tableId,
      name: practiceTableName(playerName, game),
      // A learner's clock — the same one "start over" rebuilds with (`practiceConfigFor`).
      config: practiceConfigFor(game),
      // Practice is practice. A table for learning a game settles nothing, whatever the game
      // normally does, and this is the one place that has to be decided rather than inherited.
      settlement: 'play-money',
      createdAt: Date.now(),
      game,
      // WHOSE it is. The table itself knows, so resetting it and reaching it can be gated on the
      // person rather than on a list somewhere else agreeing.
      practiceFor: playerId,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `could not open a practice table (${res.status})` };
  }
  return { ok: true, tableId };
}
