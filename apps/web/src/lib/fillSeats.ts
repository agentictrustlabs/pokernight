/**
 * WHO SITS WHERE when the house fills a canasta table.
 *
 * Canasta is four, in two fixed partnerships: seats 0 and 2 against seats 1 and 3. So "add some
 * bots" is never only a number — WHICH chairs they take decides who you are playing with and who you
 * are playing against, and that is the one thing at this table nobody else can choose for you.
 *
 * Two questions, and the second only exists because of the first:
 *
 *   HOW MANY. Enough to deal is the common answer, because a canasta table with an empty chair does
 *   not start. Fewer, when somebody is on their way.
 *
 *   AND THEN WHOSE CHAIR IS KEPT. If a seat is being saved for a person, it matters enormously
 *   whether it is the one across from you — your partner, playing WITH you against the house — or one
 *   beside you, playing against you. Filling "the empty seats in order" answers that by accident.
 *
 * Pure, because it is a seating plan and a seating plan is worth being able to read as a table of
 * cases rather than inferring from the order of a loop.
 */

/** Seats 0 and 2 are one side, 1 and 3 the other. */
export function partnerOf(seat: number): number {
  return (seat + 2) % 4;
}

export function opponentsOf(seat: number): number[] {
  return [(seat + 1) % 4, (seat + 3) % 4];
}

/** What the person asked for. */
export type FillPlan =
  /** Everybody the house has; the round deals as soon as they are down. */
  | { kind: 'all' }
  /** Keep one chair for somebody, on YOUR side — the two of you against the house. */
  | { kind: 'keep-partner' }
  /** Keep one chair for somebody, on the other side — the two of you against each other. */
  | { kind: 'keep-opponent' };

/**
 * The seats to fill, in order, for a plan.
 *
 * `mine` is null for somebody who has not sat down yet — then there is no "my side" to speak of and
 * every plan is the same plan, so it fills what is empty and says nothing about partnerships.
 *
 * Never returns a seat that is not empty, and never more than there are agents to put in them; the
 * caller says how many it actually has.
 */
export function seatsToFill(empty: readonly number[], mine: number | null, plan: FillPlan): number[] {
  const free = [...empty].sort((a, b) => a - b);
  if (mine === null || plan.kind === 'all') return free;

  // The chair being kept back. It may not be empty — somebody may already be sitting in it — in
  // which case there is nothing to keep and this is just "fill the rest".
  const keep = plan.kind === 'keep-partner' ? partnerOf(mine) : opponentsOf(mine).find((s) => free.includes(s));
  const keeping = keep !== undefined && free.includes(keep) ? keep : null;
  const rest = free.filter((s) => s !== keeping);
  // Keeping every remaining chair would leave nobody to play: if the only free seat is the one being
  // saved, the plan cannot be honoured and filling nothing is the honest outcome rather than filling
  // the very seat that was asked to be kept.
  return rest;
}

/**
 * What the table will look like afterwards, in a sentence.
 *
 * Said BEFORE the seats are taken, because seating three agents is easy to do and awkward to undo,
 * and "who ends up on my side" is exactly what somebody is deciding.
 */
export function fillOutcome(empty: readonly number[], mine: number | null, plan: FillPlan, agents: number): string {
  const wanted = seatsToFill(empty, mine, plan);
  const taking = Math.min(wanted.length, agents);
  const leftEmpty = empty.length - taking;

  if (taking === 0) return 'There is nobody to seat.';
  const who = taking === 1 ? 'one house player' : `${taking} house players`;

  if (leftEmpty === 0) {
    if (mine === null) return `Seats ${who}. The round deals.`;
    return plan.kind === 'all' && empty.length === 3
      ? `Seats ${who} — one across from you and two against you. The round deals.`
      : `Seats ${who}. The round deals.`;
  }

  const seats = leftEmpty === 1 ? 'one seat' : `${leftEmpty} seats`;
  const takes = leftEmpty === 1 ? 'it' : 'them';
  // No "across from you" for somebody who is not sitting anywhere yet, and none when the chairs are
  // left over rather than kept back — saying a seat was saved for a partner when the house simply ran
  // out of players is telling somebody a choice was honoured that nobody made.
  if (mine === null || plan.kind === 'all') return `Seats ${who} and leaves ${seats} empty. The round deals when somebody takes ${takes}.`;
  const chair = plan.kind === 'keep-partner' ? 'across from you, on your side' : 'beside you, against you';
  return `Seats ${who} and keeps ${seats} — ${chair}. The round deals when somebody takes ${takes}.`;
}
