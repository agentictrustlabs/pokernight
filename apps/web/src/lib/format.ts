/**
 * Human-readable rendering of wire values: chips, cards and table events.
 * Pure; shared by the log panel and the tests.
 */
import type { Card, HandResult, TableEvent } from './types';

export function fmtChips(n: number): string {
  return n.toLocaleString('en-US');
}

export const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function cardRank(card: Card): string {
  return card[0] === 'T' ? '10' : card[0] ?? '';
}
export function cardSuit(card: Card): string {
  return card[1] ?? '';
}
export function isRedSuit(card: Card): boolean {
  const s = card[1];
  return s === 'h' || s === 'd';
}
/** "Ah 7d 2c" style, matching the wire codes so logs are copy-pasteable. */
export function fmtCards(cards: readonly Card[]): string {
  return cards.join(' ');
}

const STREET_LABEL: Record<string, string> = { flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };

export interface FormatContext {
  /** Display name for a seat index (falls back to "Seat N"). */
  seatName: (seat: number) => string;
  /** The viewer's own seat, for "You are dealt …". */
  viewerSeat?: number | null;
}

/** One event may produce several lines (a hand end lists every award). */
export function formatEvent(ev: TableEvent, ctx: FormatContext): string[] {
  const n = ctx.seatName;
  switch (ev.type) {
    case 'hand-started':
      return [`Hand #${ev.handNo} — button ${n(ev.button)}, ${ev.seats.length} players`];
    case 'blind-posted': {
      const kind = ev.kind === 'ante' ? 'ante' : `${ev.kind} blind`;
      return [`${n(ev.seat)} posts ${kind} ${fmtChips(ev.amount)}`];
    }
    case 'hole-cards':
      return [`${ev.seat === ctx.viewerSeat ? 'You are' : `${n(ev.seat)} is`} dealt ${fmtCards(ev.cards)}`];
    case 'action': {
      const { seat, action, amount, timedOut } = ev.record;
      const who = n(seat);
      let line: string;
      switch (action.type) {
        case 'fold':
          line = `${who} folds`;
          break;
        case 'check':
          line = `${who} checks`;
          break;
        case 'call':
          line = `${who} calls ${fmtChips(amount)}`;
          break;
        case 'bet':
          line = `${who} bets ${fmtChips(action.amount)}`;
          break;
        case 'raise':
          line = `${who} raises to ${fmtChips(action.amount)}`;
          break;
        case 'all-in':
          line = `${who} goes all-in for ${fmtChips(amount)}`;
          break;
      }
      return [timedOut ? `${line} (timed out)` : line];
    }
    case 'street': {
      const label = STREET_LABEL[ev.street] ?? ev.street;
      if (ev.street === 'showdown') return ['Showdown'];
      // Flop shows the three new cards; turn/river show the single new card.
      const shown = ev.street === 'flop' ? ev.board.slice(0, 3) : ev.board.slice(-1);
      return [`${label}: ${fmtCards(shown)}`];
    }
    case 'pots': {
      if (ev.pots.length <= 1) return [];
      return [`Side pots: ${ev.pots.map((p) => fmtChips(p.amount)).join(' / ')}`];
    }
    case 'showdown':
      return ev.shown.map((s) => `${n(s.seat)} shows ${fmtCards(s.holeCards)} — ${s.rank.label}`);
    case 'hand-ended':
      return formatResult(ev.result, ctx);
    case 'turn':
      return [];
    case 'seat-joined':
      return [`${ev.name ?? n(ev.seat)} sits at seat ${ev.seat + 1}${ev.stack != null ? ` with ${fmtChips(ev.stack)}` : ''}`];
    case 'seat-left':
      return [`${ev.name ?? n(ev.seat)} leaves seat ${ev.seat + 1}`];
    case 'seat-status':
      return [`${ev.name ?? n(ev.seat)} ${ev.status === 'sitting-out' ? 'sits out' : 'is back in'}`];
    case 'chat':
      return [`${ev.name}: ${ev.text}`];
    default:
      return [];
  }
}

/** "Bob wins 34 with Two pair, aces and eights" — one line per winning seat. */
export function formatResult(result: HandResult, ctx: FormatContext): string[] {
  const bySeat = new Map<number, { amount: number; label?: string }>();
  for (const a of result.awards) {
    const cur = bySeat.get(a.seat) ?? { amount: 0, label: a.rank?.label };
    cur.amount += a.amount;
    if (!cur.label && a.rank) cur.label = a.rank.label;
    bySeat.set(a.seat, cur);
  }
  const lines: string[] = [];
  for (const [seat, { amount, label }] of bySeat) {
    lines.push(`${ctx.seatName(seat)} wins ${fmtChips(amount)}${label ? ` with ${label}` : ''}`);
  }
  if (result.rake > 0) lines.push(`Rake ${fmtChips(result.rake)}`);
  return lines;
}

/** Short hex prefix for seed commits: "3f9a2c…". */
export function shortHex(hex: string, n = 8): string {
  return hex.length > n ? `${hex.slice(0, n)}…` : hex;
}

/** Whole seconds remaining until `deadline`, never negative. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
