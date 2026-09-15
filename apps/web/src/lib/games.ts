/**
 * Which game this client can draw — and what to say about the ones it cannot.
 *
 * The room deals more than one game. This client draws exactly one of them: every board,
 * every action control and every log line in `components/` reads a poker view and nothing else.
 * That is a fine thing for a client to be, and the only dangerous version of it is the one that
 * does not know it — a poker board mounted against another game's view reads `config.bigBlind` off
 * a shape that has no config and takes the whole page down with it.
 *
 * So the rule is stated once, here, and every place that meets a table asks: the lobby before it
 * offers a seat, the socket before it keeps a view, the table page before it draws a board.
 *
 * When a second board is written, this file is where it announces itself.
 */

/** The game the POKER board draws. Its reducer and its components read a poker view and no other. */
export const DRAWN_GAME = 'poker';

/**
 * Every game this client has a board for.
 *
 * Distinct from {@link drawsGame}, and the distinction is the point: `drawsGame` asks "will the
 * POKER board understand this?", which is what the poker reducer and the poker page need to know.
 * This asks "does this room have a screen for it at all?", which is what the lobby needs
 * before it offers a seat. One board per game, and each knows only its own.
 */
export const BOARDS: readonly string[] = ['poker', 'canasta'];

/** Whether this client can draw a table dealing `game` at all. Absent is poker. */
export function hasBoard(game: string | null | undefined): boolean {
  return !game || BOARDS.includes(game);
}

/**
 * Whether this client can draw a table dealing `game`.
 *
 * Absent is poker: every table opened before games were named is a poker table, and the host
 * stamps the name on new ones.
 */
export function drawsGame(game: string | null | undefined): boolean {
  return !game || game === DRAWN_GAME;
}

/** What each game is CALLED. A client that cannot deal a game can still name it properly. */
const NAMES: Record<string, string> = {
  poker: "Texas Hold'em",
  canasta: 'Canasta',
};

/** The game's name for a person to read, falling back to the id the host gave it. */
export function gameLabel(game: string | null | undefined): string {
  if (!game) return NAMES[DRAWN_GAME] as string;
  return NAMES[game] ?? game;
}

/**
 * WHAT EACH GAME IS, in a sentence, for somebody who has not played it.
 *
 * An invitation names a game, and "Canasta" tells a person nothing if they have never played canasta.
 * One sentence about what happens and one about what it takes is the difference between an invitation
 * somebody accepts and one they leave in the inbox to think about.
 */
const BLURBS: Record<string, string> = {
  poker: 'Texas Hold’em: two cards each, five shared, and the betting is the game. Two to nine players; a hand takes a few minutes.',
  canasta:
    'Canasta: four players in two partnerships, collecting sevens of a kind. Played to 5,000 for score rather than for money — the friendliest way in if you have never played either.',
};

/** One sentence about a game, or null when this client has nothing honest to say about it. */
export function gameBlurb(game: string | null | undefined): string | null {
  return BLURBS[game ?? DRAWN_GAME] ?? null;
}

/**
 * THE SKILL AN AGENT HAS TO ADVERTISE TO ADVISE AT THIS GAME.
 *
 * Named per game for the same reason `*.act` is: an agent that can talk about hold'em has no business
 * being handed a canasta seat's question, and the room refuses one whose card does not say so —
 * before the first question rather than mid-hand. Stated here so the screen can say WHICH skill it is
 * when it explains a refusal, rather than the person discovering it from an error.
 */
export function adviseSkillFor(game: string | null | undefined): string {
  return game === 'canasta' ? 'canasta.advise' : 'poker.advise';
}
