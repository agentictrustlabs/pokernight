/**
 * WHICH OF SOMEBODY'S TREASURIES FUNDS THEIR PLAY, when they have not said.
 *
 * THE BUG THIS EXISTS TO END. A person's Home lists the treasuries they already have, and the card
 * room showed them as "candidates" while `chosen` stayed null — so `stakeStage` said `set-up` and the
 * screen offered "Set up your stake", which CREATES A NEW ONE. Somebody with a funded treasury was
 * told they had no stake, and the fix on offer made them a second account. Do that a few times and a
 * demo person has five treasuries, one of them holding all the money and none of them selected. That
 * is exactly what happened.
 *
 * SO: if they have one and have not chosen, choose for them. It is safe to do, and the reason is the
 * mandate — nothing is ever spent from a treasury without an authorisation the person signs AT THEIR
 * HOME, where they are shown the account and the amounts. Choosing only decides which account that
 * authorisation will be about. The alternative on offer was not "no account is touched"; it was "a
 * new account is created", which is the more surprising of the two by a distance.
 *
 * Pure, because "which one" is a decision worth being able to read as a table of cases rather than
 * inferring from a loop that also does network calls.
 */

/** As much of a candidate as the choice depends on. */
export interface Candidate {
  address: string;
  /** `alice2.treasury`, or empty for one that was never named. */
  name?: string | null;
  /** Base units, as a decimal string. Null when the balance could not be read. */
  balance?: string | null;
  /** Set when reading it failed — such a candidate is never chosen. */
  error?: string | null;
}

function amount(c: Candidate): bigint {
  if (typeof c.balance !== 'string' || !/^\d+$/.test(c.balance)) return -1n;
  try {
    return BigInt(c.balance);
  } catch {
    return -1n;
  }
}

/**
 * The treasury to fund play from, or null when there is nothing to choose.
 *
 * MOST MONEY FIRST, because the point of choosing is that the person can sit down, and an empty
 * account chosen over a funded one produces the same "you need a stake" dead end by another route.
 * Ties break toward a NAMED treasury — a name is something its owner typed, so it is the one they
 * will recognise on their Home when they authorise a buy-in against it — and then by list order, so
 * the answer is stable across reads and a refresh never silently moves somebody's money.
 *
 * A candidate whose balance could not be read is never chosen: an unreadable account might be empty,
 * might be fine, and choosing it would bind the mandate to a guess.
 */
export function pickTreasury(candidates: readonly Candidate[]): Candidate | null {
  const usable = candidates.filter((c) => !c.error && amount(c) >= 0n);
  if (usable.length === 0) return null;
  let best = usable[0] as Candidate;
  for (const c of usable.slice(1)) {
    const a = amount(c);
    const b = amount(best);
    if (a > b) best = c;
    else if (a === b && !(best.name ?? '').trim() && (c.name ?? '').trim()) best = c;
  }
  return best;
}

/**
 * What to tell somebody whose treasury was chosen for them.
 *
 * It is said out loud rather than done quietly. A person who is about to authorise a buy-in needs to
 * know which account it will come from BEFORE they go to their Home to sign, not after.
 */
export function chosenNotice(c: Candidate, money: string): string {
  const who = (c.name ?? '').trim() || `${c.address.slice(0, 10)}…${c.address.slice(-6)}`;
  return `Play is set to come from ${who}, which your Home already lists as yours. You can change it below.`;
}
