/**
 * Where the numbers at the top of the table came from.
 *
 * "I would also like it to talk to the points that go into the numbers up top." The scoreboard says
 * 1135 to 435 and a beginner has no idea which of the things they just did produced that — which is
 * the one number in canasta they are actually playing for.
 *
 * So the end of a round is read out as its PARTS. The scoresheet on screen already lists them in a
 * table; this is the same six numbers said as a sentence, in the order they happen at a real table
 * and with the sign made explicit, because two of them are subtractions and that is exactly the bit
 * people get wrong.
 *
 * Pure, so what it says is testable without a table.
 */

export interface TeamScore {
  melds: number;
  canastas: number;
  redThrees: number;
  goingOut: number;
  inHand: number;
  total: number;
  naturalCanastas: number;
  mixedCanastas: number;
}

export interface RoundResult {
  wentOut: number | null;
  concealed: boolean;
  scores: Record<number, TeamScore>;
  totals: Record<number, number>;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The parts of one side's round, longest first.
 *
 * Only the parts that are NOT zero. A list that reads "nothing for canastas, nothing for red threes,
 * nothing for going out" buries the two numbers that actually moved.
 */
export function scoreParts(s: TeamScore): string[] {
  const parts: string[] = [];
  if (s.melds !== 0) parts.push(`${s.melds} for the cards on the table`);
  if (s.canastas !== 0) {
    const bits: string[] = [];
    if (s.naturalCanastas > 0) bits.push(count(s.naturalCanastas, 'natural canasta'));
    if (s.mixedCanastas > 0) bits.push(count(s.mixedCanastas, 'mixed canasta'));
    parts.push(`${s.canastas} for ${bits.join(' and ') || 'canastas'}`);
  }
  // Red threes go NEGATIVE for a side that never melded, which is the rule nobody expects.
  if (s.redThrees > 0) parts.push(`${s.redThrees} for red threes`);
  if (s.redThrees < 0) parts.push(`${Math.abs(s.redThrees)} LOST on red threes, because your side never melded`);
  if (s.goingOut !== 0) parts.push(`${s.goingOut} for going out`);
  if (s.inHand !== 0) parts.push(`${Math.abs(s.inHand)} taken off for the cards still in hand`);
  return parts;
}

/**
 * The round's scoring, said out loud — one short clause first, then the parts.
 *
 * Split the way the coach's own explanations are: the first line is what happened, the rest is why
 * the number is what it is. A voice reads them in order, and the queue keeps them from overlapping.
 */
export function scoreLines(
  result: RoundResult,
  myTeam: 0 | 1 | null,
  nameOf?: (seat: number) => string,
  /** The viewer's SEAT — a different thing from their team, and the only way to tell "you went out"
   *  from "your partner did". Comparing the seat that went out to a team number said "you" whenever
   *  seat and team happened to be the same digit, which for seat 0 on team 0 is always. */
  mySeat?: number | null,
): string[] {
  const lines: string[] = [];
  const mine = myTeam ?? 0;
  const theirs = ((mine + 1) % 2) as 0 | 1;
  const us = result.scores[mine] as TeamScore;
  const them = result.scores[theirs] as TeamScore;
  const side = myTeam === null ? 'The first side' : 'Your side';

  // WHO ENDED IT, first — the thing that just happened, before the arithmetic about it.
  const out = result.wentOut;
  const how = result.concealed ? ', concealed' : '';
  if (out === null) lines.push('The stock ran out, so the round ends there.');
  else if (mySeat != null && out === mySeat) lines.push(`You went out${how}.`);
  else lines.push(`${nameOf?.(out) ?? (myTeam !== null && out % 2 === myTeam ? 'Your partner' : 'They')} went out${how}.`);

  lines.push(`${side} scored ${us.total} this round. They scored ${them.total}.`);
  const parts = scoreParts(us);
  if (parts.length > 0) lines.push(`That is ${parts.join(', ')}.`);
  lines.push(`${myTeam === null ? 'The running total is' : 'You are on'} ${result.totals[mine]}, ${myTeam === null ? 'against' : 'they are on'} ${result.totals[theirs]}.`);
  return lines;
}

/**
 * The line that opens a round: which one it is, and where the game stands.
 *
 * A round starting is the moment a person most needs the score — the target has not moved, but how
 * far off it they are is the whole reason to care about the next twenty minutes. The scoreboard is
 * on screen and says nothing about itself; this says it.
 */
export function roundOpening(roundNo: number, scores: Record<number, number>, myTeam: 0 | 1 | null, target: number): string {
  if (roundNo <= 1) return `Round one. First to ${target}.`;
  const mine = myTeam ?? 0;
  const theirs = ((mine + 1) % 2) as 0 | 1;
  const us = scores[mine] ?? 0;
  const them = scores[theirs] ?? 0;
  if (us === them) return `Round ${roundNo}. Level, ${us} each, playing to ${target}.`;
  const ahead = us > them;
  return `Round ${roundNo}. ${myTeam === null ? `${us} against ${them}` : `You are ${ahead ? 'ahead' : 'behind'}, ${us} to ${them}`}.`;
}

/** The same thing to read rather than hear, as one paragraph under the scoresheet. */
export function scoreSummary(result: RoundResult, myTeam: 0 | 1 | null): string {
  const mine = myTeam ?? 0;
  const us = result.scores[mine] as TeamScore;
  const parts = scoreParts(us);
  const who = myTeam === null ? 'The first side' : 'Your side';
  if (parts.length === 0) return `${who} scored nothing this round.`;
  return `${who}'s ${us.total} is ${parts.join(', ')}.`;
}
