import type { CoachStatus } from '../lib/api';
import { useEffect, useMemo, useState } from 'react';
import type { Action, LegalActions, TableView } from '../lib/types';
import type { TurnState } from '../lib/tableSocket';
import { fmtChips, potOdds, secondsLeft } from '../lib/format';
import { dualAmount, type TableRate } from '../lib/money';
import { waitingToBeDealtIn } from '../lib/seating';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

const NOTHING_LEGAL: LegalActions = { fold: false, check: false, call: null, bet: null, raise: null, allIn: 0 };

/** True when a keystroke belongs to whatever the viewer is typing in. */
function typingIn(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

export interface ActionBarProps {
  /** Null when it is not the viewer's turn: the bar stays put, disabled. */
  turn: TurnState | null;
  view: TableView;
  now: number;
  onAct: (a: Action) => void;
  /** Who the table is waiting on, for the idle caption. */
  waitingOn?: string | null;
  /** This table's chip rate. Given, the pot and the amount being committed are also priced. */
  rate?: TableRate | null;
  /** What the coach is doing right now — shown ON THE BOARD, beside the clock, while it is your turn. */
  coach?: CoachStatus | null;
}

/**
 * Fold / check / call / bet with sizing. Always rendered — disabled off-turn, so
 * the page never jumps when the action comes round.
 */
export function ActionBar({ turn, view, now, onAct, waitingOn, rate = null, coach = null }: ActionBarProps) {
  const live = turn != null;
  const legal = turn?.legal ?? NOTHING_LEGAL;
  const range = legal.raise ?? legal.bet;
  const kind: 'raise' | 'bet' = legal.raise ? 'raise' : 'bet';

  // Pot-relative sizing. "Pot" here is everything on the table right now.
  const { pot, myStreetBet } = useMemo(() => {
    const hand = view.hand;
    const pots = hand?.pots.reduce((a, p) => a + p.amount, 0) ?? 0;
    const street = view.seats.reduce((a, s) => a + (s.inHand?.streetBet ?? 0), 0);
    const me = view.seats.find((s) => s.seat === (turn?.seat ?? view.viewerSeat))?.inHand?.streetBet ?? 0;
    return { pot: pots + street, myStreetBet: me };
  }, [view, turn?.seat]);
  const toCall = legal.call ?? 0;
  const sizeTo = (fraction: number) => {
    if (!range) return 0;
    const target = myStreetBet + toCall + Math.floor((pot + toCall) * fraction);
    return clamp(target, range.min, range.max);
  };

  const [amount, setAmount] = useState(range?.min ?? 0);
  const [text, setText] = useState(String(range?.min ?? 0));
  useEffect(() => {
    const v = range?.min ?? 0;
    setAmount(v);
    setText(String(v));
  }, [turn?.handNo, turn?.seat, range?.min, range?.max]);

  const setBoth = (v: number) => {
    if (!range) return;
    const c = clamp(v, range.min, range.max);
    setAmount(c);
    setText(String(c));
  };

  const total = view.config.actionTimeoutMs;
  const left = turn?.deadline != null ? Math.max(0, turn.deadline - now) : null;
  const secs = turn?.deadline != null ? secondsLeft(turn.deadline, now) : null;
  const tone = secs == null ? '' : secs <= 5 ? ' red' : secs <= 10 ? ' amber' : '';

  const canCheck = live && legal.check;
  const canCall = live && legal.call != null && legal.call > 0;
  const canFold = live && legal.fold;
  const canRaise = live && range != null;
  const canAllIn = live && legal.allIn > 0;

  /* Keyboard: F fold, C or Space check/call, R raise/bet, A all-in. */
  useEffect(() => {
    if (!live) return;
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typingIn(document.activeElement)) return;
      const k = e.key.toLowerCase();
      // Space already activates a focused button; do not act twice.
      if (k === ' ' && document.activeElement?.tagName === 'BUTTON') return;
      if (k === 'f' && canFold) {
        e.preventDefault();
        onAct({ type: 'fold' });
      } else if ((k === 'c' || k === ' ') && (canCheck || canCall)) {
        e.preventDefault();
        onAct(canCheck ? { type: 'check' } : { type: 'call' });
      } else if (k === 'r' && canRaise) {
        e.preventDefault();
        onAct({ type: kind, amount });
      } else if (k === 'a' && canAllIn) {
        e.preventDefault();
        onAct({ type: 'all-in' });
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [live, canFold, canCheck, canCall, canRaise, canAllIn, kind, amount, onAct]);

  const odds = live ? potOdds(toCall, pot) : null;

  /**
   * What the bar calls itself when it is not your turn.
   *
   * "Not your turn" used to be the answer to every idle state, including the one where there is no
   * hand at all — which is how a table that had gone quiet for want of players ended up telling two
   * people it was not their turn, sending them looking for a turn that did not exist. When no hand is
   * running, say that instead; it is both true and the thing that explains the silence.
   */
  const handRunning = view.hand != null && view.hand.result == null;
  // A newcomer who is not in this hand is not having a turn they missed — they are not in it at all,
  // and "Not your turn" sends them looking for one. Their own state comes first.
  const notDealtIn = waitingToBeDealtIn(view) != null;
  const idleTitle = notDealtIn
    ? 'Dealt in shortly'
    : handRunning
      ? waitingOn
        ? `Waiting for ${waitingOn}`
        : 'Not your turn'
      : 'No hand running';

  return (
    <section className={`actions panel${live ? ' live' : ''}`} aria-label="Your action">
      <div className="act-head">
        <strong className="act-title">
          {live ? 'Your turn' : idleTitle}
          {secs != null ? <span className={`clock num${tone}`}>{secs}s</span> : null}
        </strong>
        {odds ? <span className="odds">{odds}</span> : null}
        <span className="act-spacer" />
        <span className="shortcuts hint" aria-hidden="true">
          <kbd>F</kbd> fold <kbd>C</kbd> check/call <kbd>R</kbd> {kind} <kbd>A</kbd> all-in
        </span>
      </div>

      {/* THE COACH, ON THE BOARD. "Looking at your hand…" lived in a side panel while the person watched
          the clock here; now the same state sits under the turn title: a pulsing dot and a stopwatch
          while the question is out, the sentence when it is back. Only while it is your turn — off-turn
          the bar is idle and so is the coach. */}
      {live && coach && coach.phase !== 'idle' ? (
        <div className={`act-coach ${coach.phase}`} role="status" aria-live="polite">
          <span className={`coach-waiting-dot${coach.phase === 'ready' ? ' still' : ''}`} aria-hidden="true" />
          {coach.phase === 'thinking' ? (
            <span>
              <strong>Coach is looking at your hand</strong> — asking {coach.who}
              <span className="coach-waiting-clock"> {Math.max(0, Math.round((now - coach.since) / 1000))} s</span>
            </span>
          ) : (
            <span>
              <strong>{coach.who} says:</strong> {coach.say ?? 'see the coach panel'}
            </span>
          )}
        </div>
      ) : null}

      {left != null ? (
        <div className={`clockbar${tone}`} aria-hidden="true">
          <div style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
        </div>
      ) : (
        <div className="clockbar idle" aria-hidden="true">
          <div style={{ width: '0%' }} />
        </div>
      )}

      <div className="buttons">
        <button className="danger" disabled={!canFold} onClick={() => onAct({ type: 'fold' })}>
          Fold
        </button>
        <button
          className="primary"
          disabled={!canCheck && !canCall}
          onClick={() => onAct(canCheck ? { type: 'check' } : { type: 'call' })}
        >
          {canCall ? (
            <>
              Call <span className="num">{fmtChips(legal.call ?? 0)}</span>
            </>
          ) : (
            'Check'
          )}
        </button>
        <button className="primary" disabled={!canRaise} onClick={() => onAct({ type: kind, amount })}>
          {kind === 'raise' ? 'Raise to' : 'Bet'} <span className="num">{canRaise ? fmtChips(amount) : '—'}</span>
        </button>
        <button disabled={!canAllIn} onClick={() => onAct({ type: 'all-in' })}>
          All-in <span className="num">{canAllIn ? fmtChips(legal.allIn) : '—'}</span>
        </button>
      </div>

      <div className="sizing">
        <input
          type="range"
          min={range?.min ?? 0}
          max={range?.max ?? 0}
          step={1}
          value={amount}
          disabled={!canRaise}
          onChange={(e) => setBoth(Number(e.target.value))}
          aria-label={`${kind} amount`}
        />
        <input
          type="number"
          min={range?.min ?? 0}
          max={range?.max ?? 0}
          value={text}
          disabled={!canRaise}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (Number.isFinite(n) && range) setAmount(clamp(n, range.min, range.max));
          }}
          onBlur={() => setBoth(Number(text))}
          aria-label={`${kind} amount${range ? ` (${range.min}–${range.max})` : ''}`}
        />
        <div className="quick">
          <button className="small" disabled={!canRaise} onClick={() => setBoth(range?.min ?? 0)}>
            Min
          </button>
          <button className="small" disabled={!canRaise} onClick={() => setBoth(sizeTo(1 / 3))}>
            ⅓ pot
          </button>
          <button className="small" disabled={!canRaise} onClick={() => setBoth(sizeTo(0.5))}>
            ½ pot
          </button>
          <button className="small" disabled={!canRaise} onClick={() => setBoth(sizeTo(1))}>
            Pot
          </button>
          <button className="small" disabled={!canRaise} onClick={() => setBoth(range?.max ?? 0)}>
            Max
          </button>
          <span className="hint range-hint">
            {range ? (
              <>
                {fmtChips(range.min)}–{fmtChips(range.max)} · pot <span className="num">{fmtChips(pot)}</span>
              </>
            ) : (
              <>pot <span className="num">{fmtChips(pot)}</span></>
            )}
            {/* On a settled table the pot and the amount about to be committed are money, and are
                shown as money — the chips stay the primary figure. */}
            {rate ? (
              <span className="asset-hint num">
                pot {dualAmount(pot, rate).assetLabel}
                {canRaise ? ` · ${kind === 'raise' ? 'raise to' : 'bet'} ${dualAmount(amount, rate).assetLabel}` : ''}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </section>
  );
}
