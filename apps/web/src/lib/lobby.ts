/**
 * Reading the LIVE lobby, purely.
 *
 * The landing page's claim is that this is a real card room with real agents in it, and the only
 * honest way to make that claim is to read `GET /tables` (open to anyone) and say exactly what is
 * there. Every sentence the hero shows is computed here, so it can be tested against the shapes the
 * service actually returns — including the empty one, where the right answer is to say the room is
 * quiet rather than to dress it up.
 */

import type { PlayerInfo, TableSummary, TableView } from './types';
import { fmtChips, joinNames, streetLabel } from './format';
import { dualAmount, tableRate } from './money';

/** `GET /tables/:id` — the spectator view, which is what tells us WHO is at a table. */
export interface TableDetail {
  tableId: string;
  name: string;
  settlement: string;
  /** Asset base units per chip, pinned when the table was created. Absent on a table with no rate. */
  chipValue?: string;
  view: TableView;
  names: Record<string, string>;
  players?: Record<string, PlayerInfo>;
}

/** "1 table" / "3 tables". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "5/6" — seats taken over seats laid. */
export function fmtSeats(seated: number, seats: number): string {
  return `${seated}/${seats}`;
}

export interface LobbySummary {
  tables: number;
  /** Tables with at least two players, i.e. tables that can actually deal. */
  running: number;
  seated: number;
  /** Hands dealt across every open table, all time. */
  hands: number;
  /** "3 tables open · 12 players seated · 918 hands dealt". */
  headline: string;
}

/** A table can only deal with two players in it; one person sitting alone is not a game. */
export function isRunning(t: TableSummary): boolean {
  return t.seated >= 2;
}

export function summarizeLobby(tables: readonly TableSummary[]): LobbySummary {
  const seated = tables.reduce((a, t) => a + t.seated, 0);
  const hands = tables.reduce((a, t) => a + t.handNo, 0);
  const running = tables.filter(isRunning).length;
  const headline =
    tables.length === 0
      ? 'The room is quiet — no tables are open right now.'
      : `${plural(tables.length, 'table')} open · ${plural(seated, 'player')} seated · ${fmtChips(hands)} hands dealt`;
  return { tables: tables.length, running, seated, hands, headline };
}

/**
 * Which table to show off. The busiest first, then the one that has dealt the most hands, then the
 * oldest — so the featured table is stable between polls instead of flickering between equals.
 */
export function pickFeaturedTable(tables: readonly TableSummary[]): TableSummary | null {
  let best: TableSummary | null = null;
  for (const t of tables) {
    if (t.seated === 0) continue;
    if (
      !best ||
      t.seated > best.seated ||
      (t.seated === best.seated && t.handNo > best.handNo) ||
      (t.seated === best.seated && t.handNo === best.handNo && t.createdAt < best.createdAt)
    ) {
      best = t;
    }
  }
  return best;
}

export interface Roster {
  /** Display names of the agents at the table, in seat order. */
  agents: string[];
  /** Display names of the people at the table, in seat order. */
  humans: string[];
  /** "Sharkbot, Deep Thought and The Bluffer" — the agents, for the proof line. */
  agentNames: string;
  /** "3 agents and 1 person". */
  line: string;
}

/**
 * Who is at a table. Seat order, not object order, because the seats are what a person sees; players
 * present in the record but not seated (a stale entry) are simply not there.
 */
export function summarizeRoster(detail: Pick<TableDetail, 'view' | 'players' | 'names'> | null | undefined): Roster {
  const agents: string[] = [];
  const humans: string[] = [];
  const seats = detail?.view?.seats ?? [];
  for (const s of [...seats].sort((a, b) => a.seat - b.seat)) {
    const info = detail?.players?.[s.playerId];
    const name = info?.name ?? detail?.names?.[s.playerId] ?? `Seat ${s.seat + 1}`;
    if (info?.kind === 'agent') agents.push(name);
    else humans.push(name);
  }
  const parts: string[] = [];
  if (agents.length) parts.push(plural(agents.length, 'agent'));
  if (humans.length) parts.push(plural(humans.length, 'person', 'people'));
  return {
    agents,
    humans,
    agentNames: joinNames(agents),
    line: parts.length === 0 ? 'No one is seated' : parts.join(' and '),
  };
}

export interface LiveMoment {
  /** True when there are agents at the table and a hand is in progress. */
  agentsPlaying: boolean;
  /** "Preflop · pot 4" mid-hand, "between hands" otherwise. */
  state: string;
  /** The whole thing as one sentence for the hero. Empty when there is nothing true to say. */
  line: string;
}

/** What is happening at a table this second, said plainly. */
export function describeMoment(detail: TableDetail | null | undefined, roster: Roster): LiveMoment {
  const hand = detail?.view?.hand ?? null;
  const pot = hand ? hand.pots.reduce((a, p) => a + p.amount, 0) : 0;
  // On a settled table the pot is money, and the hero says so — the same rule as at the table.
  const d = dualAmount(pot, tableRate(detail?.settlement, detail?.chipValue));
  const potText = d.assetLabel ? `${d.chipsText} (${d.assetLabel})` : d.chipsText;
  const state = hand ? `${streetLabel(hand.street)} · pot ${potText}` : 'between hands';
  const agentsPlaying = roster.agents.length > 0 && hand != null;
  if (!detail) return { agentsPlaying: false, state, line: '' };
  const who = roster.agents.length === 0 ? roster.line : `${roster.agentNames}${roster.humans.length ? ` and ${plural(roster.humans.length, 'person', 'people')}` : ''}`;
  const line = hand ? `${who} — hand #${hand.handNo}, ${state}` : `${who} — ${plural(detail.view.handNo, 'hand')} dealt, waiting for the next one`;
  return { agentsPlaying, state, line };
}
