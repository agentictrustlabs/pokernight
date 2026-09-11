/**
 * WHO IS PLAYING, WHO IS COACHING, AND WHAT EACH OF THEM ACTUALLY IS.
 *
 * There are four different things at one of these tables and the screen was letting them blur:
 *
 *   A PERSON in a seat, taking their own turns.
 *   AN AGENT in a seat — an A2A agent the card room asked to play, which takes turns like anybody.
 *   THE HOUSE COACH — the card room's OWN advice, built into this deployment. Not an agent, no A2A
 *     call, no card, nobody's but the card room's. It never takes a turn.
 *   YOUR OWN ADVISER — an A2A agent YOU named, which answers your questions and takes no turn ever.
 *
 * And cutting across the seats: what is BEHIND each agent — a rules table, or a language model. "I
 * cannot see which ones are playing vs coaches vs agent coaches from a2a and my llm's."
 *
 * THE CONFLICT IS WORTH SAYING OUT LOUD. Nothing stops you naming an agent that is also sitting at
 * this table — the house personas advertise both skills, so the pick-list offers them — and then the
 * thing advising you is one of the players trying to beat you. It is not forbidden and it is not a
 * bug; it is a fact a person should be able to see rather than deduce.
 *
 * Pure: given the view, the players and who is advising, it says who everybody is.
 */

/** What sits behind an agent, in words rather than in the card room's own shorthand. */
export function strategyWords(kind: string | null | undefined): string {
  const k = (kind ?? '').trim().toLowerCase();
  if (k === 'rules') return 'rules-based';
  if (k === 'claude' || k === 'llm') return 'language model';
  return k || 'unknown';
}

export interface Seated {
  seat: number;
  /** As the table names them. */
  name: string;
  /** You, another person, or an agent. */
  kind: 'you' | 'person' | 'agent';
  /** For an agent: its A2A name, which is also where its card lives. */
  agentName?: string;
  /** For an agent: what is behind it — "rules-based", "language model". */
  behind?: string;
  /** Seated but not in the deal. */
  sittingOut: boolean;
}

export type CoachRole =
  | { kind: 'house'; label: string; what: string }
  | { kind: 'agent'; label: string; what: string; agentName: string; alsoPlaying: boolean };

export interface WhoIsWho {
  playing: Seated[];
  coach: CoachRole;
}

interface PlayerLike {
  kind?: 'human' | 'agent';
  name?: string;
  agentName?: string;
  agentKind?: string;
}

/**
 * @param seats      the table's own seat list, in seat order
 * @param nameOf     how the page names a seat
 * @param playerOf   what the table said about whoever holds a seat, or undefined for a person
 * @param mySeat     the viewer's seat, or null for somebody watching
 * @param adviser    the agent this person named, or null for the house coach
 */
export function whoIsWho(
  seats: readonly { seat: number; playerId: string; status?: string }[],
  nameOf: (seat: number) => string,
  playerOf: (playerId: string) => PlayerLike | undefined,
  mySeat: number | null,
  adviser: { agentName: string; displayName: string } | null,
): WhoIsWho {
  const playing: Seated[] = seats.map((s) => {
    const p = playerOf(s.playerId);
    const isAgent = p?.kind === 'agent';
    return {
      seat: s.seat,
      name: nameOf(s.seat),
      kind: s.seat === mySeat ? 'you' : isAgent ? 'agent' : 'person',
      ...(isAgent && p?.agentName ? { agentName: p.agentName } : {}),
      ...(isAgent ? { behind: strategyWords(p?.agentKind) } : {}),
      sittingOut: s.status === 'sitting-out',
    };
  });

  if (!adviser) {
    return {
      playing,
      coach: {
        kind: 'house',
        label: 'The house coach',
        what: 'the card room’s own advice, the same for everybody. Not an agent, and it never takes a turn.',
      },
    };
  }

  // "Also playing" is asked of the SEATS, not of a name, because an agent may sit under a display
  // name that does not match the one you typed.
  const alsoPlaying = playing.some((s) => s.agentName != null && s.agentName === adviser.agentName);
  return {
    playing,
    coach: {
      kind: 'agent',
      label: adviser.displayName,
      what: alsoPlaying
        ? `an A2A agent you named — and it is also PLAYING at this table, so the thing advising you is one of your opponents.`
        : 'an A2A agent you named. It answers your questions over A2A and never takes a turn here.',
      agentName: adviser.agentName,
      alsoPlaying,
    },
  };
}

/** One line per seat, for a screen with no room for a table. */
export function seatLine(s: Seated): string {
  const who =
    s.kind === 'you' ? 'you' : s.kind === 'person' ? 'a person' : `an A2A agent, ${s.behind ?? 'unknown'}`;
  return `${s.name} — ${who}${s.sittingOut ? ', sitting out' : ''}`;
}
