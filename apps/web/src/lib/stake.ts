/**
 * Getting ready to play, as the client understands it — the PURE half.
 *
 * A person who has just signed in does not have a treasury, money in it, or a signed mandate, and
 * has no reason to know those are three separate things. `POST /treasury/quick-start` does all three
 * in one call and answers in money; this module is the read model for that answer, plus the one
 * question every surface asks before anyone presses anything: what stage is this player at?
 *
 * Nothing here fetches, and nothing here decides anything the server has not already decided. The
 * server's `ready` is the only thing that means a settled seat is allowed.
 */

import { fmtAsset } from './money';
import type { TreasuryView } from './treasury';

/** Mirrors `QuickStartStep` in apps/tables/src/routes-treasury.ts. */
export interface StakeStep {
  step: 'treasury' | 'stake' | 'authority';
  status: 'done' | 'kept' | 'blocked' | 'failed';
  /** One plain sentence. This IS the progress line — it is never re-worded here. */
  said: string;
  /** The address or transaction behind it. Details disclosure only, never the default view. */
  detail?: string;
}

/** Mirrors `QuickStartNext`. What the player must do that the card room cannot do for them. */
export interface StakeNext {
  action: 'none' | 'create-at-home' | 'authorise-at-home' | 'retry';
  said: string;
  portalUrl?: string | null;
}

/** Mirrors `QuickStartView`. */
export interface StakeResult {
  ready: boolean;
  treasury: string | null;
  treasuryName: string | null;
  balance: string | null;
  balanceUsdc: string | null;
  steps: StakeStep[];
  next: StakeNext;
}

/**
 * Where this player stands, read off the treasury view alone — so the panel can show the right one
 * thing on first paint rather than after a round trip.
 *
 *   loading      we have not been told yet
 *   unavailable  this deployment cannot settle at all; play money is unaffected
 *   set-up       one action away from playing: no treasury, or no money in it
 *   authorise    they have the money and have not yet said what the table may take
 *   ready        a settled seat would be allowed
 */
export type StakeStage = 'loading' | 'unavailable' | 'set-up' | 'authorise' | 'ready';

export function stakeStage(view: TreasuryView | null | undefined): StakeStage {
  if (!view) return 'loading';
  if (view.unavailable) return 'unavailable';
  if (!view.chosen) return 'set-up';
  const funded = /^\d+$/.test(view.balance ?? '') && BigInt(view.balance as string) > 0n;
  if (!funded) return 'set-up';
  if (view.mandate.unavailable) return 'unavailable';
  return view.mandate.present && !view.mandate.problem ? 'ready' : 'authorise';
}

/**
 * Why a mandate the player just signed was NOT accepted.
 *
 * `stakeStage` collapses a rejected mandate back into `authorise`, which is right for what to do next
 * but loses the reason — so the screen silently returned to "One thing left…" and the player had no
 * idea anything had been refused. That is exactly the dead end that got reported: "it shows the
 * correct dollars and goes home but won't get past it." The server's sentence names the mismatch
 * precisely; it was written to be read, and nobody was reading it.
 *
 * Null when there is nothing to explain: no mandate attempted, or one that was accepted.
 */
export function stakeProblem(view: TreasuryView | null | undefined): string | null {
  const problem = view?.mandate?.problem;
  if (typeof problem !== 'string') return null;
  const said = problem.trim();
  return said === '' ? null : said;
}

/** What a player is shown instead of an address: the treasury's name, else nothing at all. */
export function stakeName(view: TreasuryView | null | undefined): string | null {
  const name = view?.chosenName?.trim();
  return name ? name : null;
}

/**
 * `"10,000.00 SHQ"`, or null when there is no balance to state. A balance is money, so it reads as
 * money — and in the currency the card room actually states, because there is more than one on this
 * estate now. `USDC` is the fallback for a server that names none, which is what it settles in.
 */
export function stakeBalance(view: TreasuryView | null | undefined): string | null {
  const raw = view?.balance;
  if (raw === null || raw === undefined || !/^-?\d+$/.test(raw.trim())) return null;
  return `${fmtAsset(BigInt(raw.trim()))} ${(view?.assetSymbol ?? '').trim() || 'USDC'}`;
}

/**
 * The line to show while, and after, the button runs.
 *
 * The LAST step is what happened most recently, so that is what a person watching wants to read; a
 * step that failed outranks it, because a failure that scrolls past is a failure nobody saw.
 */
export function progressLine(result: StakeResult | null | undefined): string | null {
  if (!result) return null;
  const broke = result.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
  if (broke) return broke.said;
  return result.steps.at(-1)?.said ?? null;
}

/** Whether anything in the result went wrong, so the panel can offer the same button again. */
export function stakeFailed(result: StakeResult | null | undefined): boolean {
  return result?.steps.some((s) => s.status === 'failed') ?? false;
}

/**
 * The money sentence a finished set-up ends on. Money terms only: what they have, and that they can
 * sit down. Never an address, never a transaction — those are in the details.
 */
export function readyLine(result: StakeResult | null | undefined, symbol?: string | null): string | null {
  if (!result?.ready) return null;
  const raw = result.balance;
  if (!raw || !/^\d+$/.test(raw)) return 'You are ready to sit down.';
  return `You're set up with ${fmtAsset(BigInt(raw))} ${(symbol ?? '').trim() || 'USDC'} to play with.`;
}
