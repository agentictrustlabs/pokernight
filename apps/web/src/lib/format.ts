/**
 * Human-readable rendering of wire values: chips, cards and table events.
 * Pure; shared by the log panel and the tests.
 */
import type { ActionRecord, Card, HandResult, TableEvent } from './types';

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

const STREET_LABEL: Record<string, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
};

/** "Flop", "Turn", … for the status bar and the log. */
export function streetLabel(street: string): string {
  return STREET_LABEL[street] ?? street;
}

export interface FormatContext {
  /** Display name for a seat index (falls back to "Seat N"). */
  seatName: (seat: number) => string;
  /** The viewer's own seat, for "You are dealt …". */
  viewerSeat?: number | null;
  /** Seat a player id is sitting in, for colouring chat by actor. */
  seatOf?: (playerId: string) => number | null;
}

/**
 * Who an event is about: the name it carries when that is a name, and the seat's own label
 * otherwise. An event with no name at all falls through to the context, which already knows.
 */
function who(name: string | undefined, seat: number, ctx: FormatContext): string {
  return name ? seatLabel(name, seat) : ctx.seatName(seat);
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
    // These three carry the name from the table service, which for a nameless Home identity is an
    // address. Same rule as everywhere else: the seat, never the hex.
    case 'seat-joined':
      return [`${who(ev.name, ev.seat, ctx)} sits at seat ${ev.seat + 1}${ev.stack != null ? ` with ${fmtChips(ev.stack)}` : ''}`];
    case 'seat-left':
      return [`${who(ev.name, ev.seat, ctx)} leaves seat ${ev.seat + 1}`];
    case 'seat-status':
      return [`${who(ev.name, ev.seat, ctx)} ${ev.status === 'sitting-out' ? 'sits out' : 'is back in'}`];
    case 'chat': {
      const seat = ctx.seatOf?.(ev.playerId) ?? null;
      return [`${seat === null ? (looksLikeAddress(ev.name) ? 'Someone' : ev.name) : seatLabel(ev.name, seat)}: ${ev.text}`];
    }
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

/** `0x89d13c59…a820ffd0` — recognisable, short enough for a topbar or a roster row. */
export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

/** `0xb2154dd6…e653d7f6`, or a bare address — what a Home asserts for someone with no name yet. */
const ADDRESS_LIKE = /^0x[0-9a-fA-F]{4,}(…|\.{3})?[0-9a-fA-F]*$/;

export function looksLikeAddress(value: string | null | undefined): boolean {
  const v = value?.trim() ?? '';
  return v !== '' && ADDRESS_LIKE.test(v);
}

/**
 * What to call a player at the table.
 *
 * A Home that knows someone by phone number or email address asserts no agent name, so the table
 * service falls back to their Smart Agent address — and a seat plate, or a line of the log, reading
 * `0x2a5ae595…653c2747` is a raw address in the most-looked-at part of the app. "Seat 3" is shorter,
 * and more honest: we do not know their name, and the seat is what anyone at a table actually says.
 */
export function seatLabel(name: string | null | undefined, seat: number): string {
  const n = name?.trim() ?? '';
  return n && !looksLikeAddress(n) ? n : `Seat ${seat + 1}`;
}

/** Short hex prefix for seed commits: "3f9a2c…". */
export function shortHex(hex: string, n = 8): string {
  return hex.length > n ? `${hex.slice(0, n)}…` : hex;
}

/** Whole seconds remaining until `deadline`, never negative. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/* ------------------------------------------------------- the winner moment */

export interface WinnerEntry {
  seat: number;
  name: string;
  amount: number;
  /** Named hand, when the pot was decided at showdown. */
  label?: string;
}

export interface WinnerSummary {
  entries: WinnerEntry[];
  seats: number[];
  /** "Alice wins 34" / "Alice and Bob split 34". */
  headline: string;
  /** "Two pair, aces and eights" at showdown, "uncontested" when everyone folded. */
  detail: string;
  /** The whole thing as one sentence, for the log and the screen-reader announcement. */
  line: string;
  showdown: boolean;
  rake: number;
}

/** "Alice, Bob and Carol". */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Structured version of `formatResult`, for the winner banner. A fold-to-one win
 * has no hand rank and must never be given one: it reads "wins 12 (uncontested)".
 */
export function summarizeResult(result: HandResult, ctx: FormatContext): WinnerSummary {
  const bySeat = new Map<number, WinnerEntry>();
  for (const a of result.awards) {
    const cur = bySeat.get(a.seat) ?? { seat: a.seat, name: ctx.seatName(a.seat), amount: 0 };
    cur.amount += a.amount;
    if (!cur.label && a.rank) cur.label = a.rank.label;
    bySeat.set(a.seat, cur);
  }
  for (const s of result.shown) {
    const cur = bySeat.get(s.seat);
    if (cur && !cur.label) cur.label = s.rank.label;
  }
  const entries = [...bySeat.values()];
  const total = entries.reduce((a, e) => a + e.amount, 0);
  const showdown = entries.some((e) => e.label != null);

  const names = entries.map((e) => e.name);
  const headline =
    entries.length === 0
      ? 'No winner'
      : entries.length === 1
        ? `${names[0]} wins ${fmtChips(total)}`
        : `${joinNames(names)} split ${fmtChips(total)}`;

  const labels = [...new Set(entries.map((e) => e.label).filter((l): l is string => l != null))];
  const detail = !showdown
    ? 'uncontested'
    : labels.length === 1
      ? (labels[0] ?? '')
      : entries
          .filter((e) => e.label)
          .map((e) => `${e.name}: ${e.label}`)
          .join(' · ');

  const line = entries.length === 0 ? headline : showdown ? `${headline} with ${detail}` : `${headline} (${detail})`;
  return { entries, seats: entries.map((e) => e.seat), headline, detail, line, showdown, rake: result.rake };
}

/** Signed chip delta for the float above a seat: "+34", "-12". */
export function fmtDelta(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '-'}${fmtChips(Math.abs(n))}`;
}

/** Short badge for the last thing a seat did: "Call 6", "Raise to 12", "All-in". */
export function actionBadge(record: ActionRecord): string {
  const a = record.action;
  switch (a.type) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return record.amount > 0 ? `Call ${fmtChips(record.amount)}` : 'Call';
    case 'bet':
      return `Bet ${fmtChips(a.amount)}`;
    case 'raise':
      return `Raise to ${fmtChips(a.amount)}`;
    case 'all-in':
      return `All-in ${fmtChips(record.amount)}`;
  }
}

/** Seat behind an event, so the log can colour a line by actor. Null when the table itself speaks. */
export function eventActor(ev: TableEvent, ctx: FormatContext): number | null {
  switch (ev.type) {
    case 'action':
      return ev.record.seat;
    case 'blind-posted':
    case 'hole-cards':
    case 'turn':
    case 'seat-joined':
    case 'seat-left':
    case 'seat-status':
      return ev.seat;
    case 'chat':
      return ctx.seatOf?.(ev.playerId) ?? null;
    default:
      return null;
  }
}

/** Pot odds line for the action bar: "call 8 to win 34". */
export function potOdds(toCall: number, pot: number): string | null {
  if (toCall <= 0) return null;
  return `call ${fmtChips(toCall)} to win ${fmtChips(pot + toCall)}`;
}
