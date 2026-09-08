import { useEffect, useMemo, useState } from 'react';
import type { Action, TableView } from '../lib/types';
import type { TurnState } from '../lib/tableSocket';
import { fmtChips, secondsLeft } from '../lib/format';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function ActionBar({ turn, view, now, onAct }: { turn: TurnState; view: TableView; now: number; onAct: (a: Action) => void }) {
  const legal = turn.legal;
  const range = legal.raise ?? legal.bet;
  const kind: 'raise' | 'bet' = legal.raise ? 'raise' : 'bet';

  // Pot-relative sizing. "Pot" here is everything on the table right now.
  const { pot, myStreetBet } = useMemo(() => {
    const hand = view.hand;
    const pots = hand?.pots.reduce((a, p) => a + p.amount, 0) ?? 0;
    const street = view.seats.reduce((a, s) => a + (s.inHand?.streetBet ?? 0), 0);
    const me = view.seats.find((s) => s.seat === turn.seat)?.inHand?.streetBet ?? 0;
    return { pot: pots + street, myStreetBet: me };
  }, [view, turn.seat]);
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
  }, [turn.handNo, turn.seat, range?.min, range?.max]);

  const setBoth = (v: number) => {
    if (!range) return;
    const c = clamp(v, range.min, range.max);
    setAmount(c);
    setText(String(c));
  };

  const total = view.config.actionTimeoutMs;
  const left = turn.deadline != null ? Math.max(0, turn.deadline - now) : null;
  const secs = turn.deadline != null ? secondsLeft(turn.deadline, now) : null;
  const urgent = secs != null && secs <= 5;

  return (
    <section className="actions panel" aria-label="Your action">
      {left != null ? (
        <div className={`clockbar${urgent ? ' urgent' : ''}`} aria-hidden="true">
          <div style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
        </div>
      ) : null}
      <div className="buttons">
        <strong>Your turn{secs != null ? <span className={`clock${urgent ? ' urgent' : ''}`}> · {secs}s</span> : null}</strong>
        {legal.fold ? (
          <button className="danger" onClick={() => onAct({ type: 'fold' })}>
            Fold
          </button>
        ) : null}
        {legal.check ? (
          <button className="primary" onClick={() => onAct({ type: 'check' })}>
            Check
          </button>
        ) : null}
        {legal.call != null && legal.call > 0 ? (
          <button className="primary" onClick={() => onAct({ type: 'call' })}>
            Call <span className="num">{fmtChips(legal.call)}</span>
          </button>
        ) : null}
        {range ? (
          <button className="primary" onClick={() => onAct({ type: kind, amount })}>
            {kind === 'raise' ? 'Raise to' : 'Bet'} <span className="num">{fmtChips(amount)}</span>
          </button>
        ) : null}
        {legal.allIn > 0 ? (
          <button onClick={() => onAct({ type: 'all-in' })}>
            All-in <span className="num">{fmtChips(legal.allIn)}</span>
          </button>
        ) : null}
      </div>
      {range ? (
        <div className="sizing">
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={1}
            value={amount}
            onChange={(e) => setBoth(Number(e.target.value))}
            aria-label={`${kind} amount`}
          />
          <input
            type="number"
            min={range.min}
            max={range.max}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setAmount(clamp(n, range.min, range.max));
            }}
            onBlur={() => setBoth(Number(text))}
            aria-label={`${kind} amount (${range.min}–${range.max})`}
          />
          <div className="quick">
            <button className="small" onClick={() => setBoth(range.min)}>
              Min
            </button>
            <button className="small" onClick={() => setBoth(sizeTo(0.5))}>
              ½ pot
            </button>
            <button className="small" onClick={() => setBoth(sizeTo(1))}>
              Pot
            </button>
            <button className="small" onClick={() => setBoth(range.max)}>
              Max
            </button>
            <span className="hint">
              {fmtChips(range.min)}–{fmtChips(range.max)} · pot {fmtChips(pot)}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
