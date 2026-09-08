/**
 * Render a `PokerActInput` as compact, readable poker text.
 *
 * An LLM reads a table far better as a hand history than as a JSON dump of `TableView`, and the dump is
 * also several times the tokens. Everything the rules strategy looks at is here: hole cards, board, pot,
 * stacks, position, the action so far this hand, and the legal actions with their exact chip amounts.
 */

import { effectiveStack, inPosition, myHoleCards, myStack, playersInHand, position, potOdds, potTotal, toCall } from '@pokernight/agent-kit';
import type { Action, ActionRecord } from '@pokernight/engine';
import type { PokerActInput } from '@pokernight/protocol';

function describeAction(record: ActionRecord): string {
  const a: Action = record.action;
  switch (a.type) {
    case 'bet':
      return `bets ${a.amount}`;
    case 'raise':
      return `raises to ${a.amount}`;
    case 'call':
      return record.amount > 0 ? `calls ${record.amount}` : 'calls';
    case 'all-in':
      return `goes all-in for ${record.amount}`;
    case 'check':
      return 'checks';
    case 'fold':
      return 'folds';
  }
}

const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'] as const;

function historyLines(input: PokerActInput): string[] {
  const actions = input.view.hand?.actions ?? [];
  if (actions.length === 0) return ['  (no action yet this hand)'];
  const lines: string[] = [];
  for (const street of STREETS) {
    const onStreet = actions.filter((a) => a.street === street);
    if (onStreet.length === 0) continue;
    const who = (seat: number) => (seat === input.seat ? `seat ${seat} (you)` : `seat ${seat}`);
    lines.push(`  ${street}: ${onStreet.map((a) => `${who(a.seat)} ${describeAction(a)}${a.timedOut ? ' (timed out)' : ''}`).join(', ')}`);
  }
  return lines;
}

function legalLines(input: PokerActInput): string[] {
  const { legal } = input;
  const out: string[] = [];
  if (legal.fold) out.push('  fold                     -> {"type":"fold"}');
  if (legal.check) out.push('  check                    -> {"type":"check"}');
  if (legal.call !== null && legal.call > 0) out.push(`  call ${legal.call} chips`.padEnd(27) + '-> {"type":"call"}');
  if (legal.bet) out.push(`  bet ${legal.bet.min}..${legal.bet.max}`.padEnd(27) + '-> {"type":"bet","amount":<total street bet>}');
  if (legal.raise) out.push(`  raise TO ${legal.raise.min}..${legal.raise.max}`.padEnd(27) + '-> {"type":"raise","amount":<total street bet>}');
  if (legal.allIn > 0) out.push(`  all-in for ${legal.allIn}`.padEnd(27) + '-> {"type":"all-in"}');
  return out.length > 0 ? out : ['  (nothing is legal; answer {"type":"fold"})'];
}

export function renderSituation(input: PokerActInput): string {
  const { view, legal } = input;
  const hand = view.hand;
  const hole = myHoleCards(view);
  const pot = potTotal(view);
  const call = toCall(legal);
  const stack = myStack(view);
  const live = playersInHand(view);

  const seats = view.seats.map((s) => {
    const bits = [`stack ${s.stack}`];
    if (s.inHand) {
      if (s.inHand.streetBet > 0) bits.push(`${s.inHand.streetBet} in this street`);
      if (s.inHand.allIn) bits.push('all-in');
      if (s.inHand.folded) bits.push('folded');
    } else {
      bits.push('not in the hand');
    }
    const tags = [s.seat === input.seat ? 'you' : null, s.seat === view.button ? 'button' : null].filter(Boolean).join(', ');
    return `  seat ${s.seat}${tags ? ` (${tags})` : ''}: ${bits.join(', ')}`;
  });

  return [
    `Table ${input.tableId} · hand #${input.handNo} · ${hand?.street ?? 'no hand'} · ${view.config.seats}-max`,
    `Blinds ${view.config.smallBlind}/${view.config.bigBlind}${view.config.ante > 0 ? ` · ante ${view.config.ante}` : ''}`,
    '',
    `You are seat ${input.seat}, ${position(view) ?? 'unknown'} position, ${inPosition(view) ? 'last to act' : 'out of position'} on this street.`,
    `Your hole cards: ${hole.length === 2 ? hole.join(' ') : '(none dealt)'}`,
    `Board: ${hand && hand.board.length > 0 ? hand.board.join(' ') : '(none)'}`,
    `Pot: ${pot} · current street bet: ${hand?.currentBet ?? 0} · min raise increment: ${hand?.minRaise ?? view.config.bigBlind}`,
    `Your stack: ${stack} · effective stack: ${effectiveStack(view)} · to call: ${call}${call > 0 ? ` (pot odds ${potOdds(legal, view).toFixed(2)})` : ''}`,
    `Opponents still in the hand: ${Math.max(0, live.length - 1)}`,
    '',
    'Seats:',
    ...seats,
    '',
    'Action this hand:',
    ...historyLines(input),
    '',
    'Legal actions (bet/raise amounts are the TOTAL street bet you raise TO, in chips):',
    ...legalLines(input),
    '',
    `You have about ${input.deadlineMs} ms. Answer now.`,
  ].join('\n');
}
