import type { Card as CardCode, SeatView } from '../lib/types';
import { fmtChips, secondsLeft } from '../lib/format';
import { Card } from './Card';

export interface SeatProps {
  seatNo: number;
  seat: SeatView | null;
  name: string;
  isYou: boolean;
  isButton: boolean;
  toAct: boolean;
  /** Absolute deadline for this seat's action, if known. */
  deadline: number | null;
  now: number;
  inHand: boolean;
  /** Cards known for this seat (own, or shown at showdown). */
  known?: CardCode[];
  /** Position on the oval, in percent. */
  x: number;
  y: number;
  canSit: boolean;
  onSit: (seat: number) => void;
}

export function Seat(p: SeatProps) {
  const style = { '--x': p.x, '--y': p.y } as React.CSSProperties;
  if (!p.seat) {
    return (
      <li className="seat empty" style={style} aria-label={`Seat ${p.seatNo + 1}, empty`}>
        <div className="hint">Seat {p.seatNo + 1}</div>
        {p.canSit ? (
          <button className="small sit" onClick={() => p.onSit(p.seatNo)}>
            Sit here
          </button>
        ) : (
          <div className="hint">open</div>
        )}
      </li>
    );
  }
  const s = p.seat;
  const ih = s.inHand;
  const folded = ih?.folded ?? false;
  const dealt = p.inHand && ih != null && !folded;
  const cards: (CardCode | undefined)[] = dealt ? (p.known ?? ih.holeCards ?? [undefined, undefined]) : [];
  const cls = ['seat', p.isYou ? 'you' : '', p.toAct ? 'to-act' : '', folded ? 'folded' : '', s.status === 'sitting-out' ? 'sitting-out' : '']
    .filter(Boolean)
    .join(' ');
  let status: { text: string; cls?: string } | null = null;
  if (s.status === 'sitting-out') status = { text: 'Sitting out' };
  else if (folded) status = { text: 'Folded' };
  else if (ih?.allIn) status = { text: 'All-in', cls: 'all-in' };
  const secs = p.toAct && p.deadline != null ? secondsLeft(p.deadline, p.now) : null;

  return (
    <li className={cls} style={style} aria-label={`Seat ${p.seatNo + 1}, ${p.name}`}>
      <div className="head">
        <span className="name" title={p.name}>
          {p.name}
        </span>
        {p.isButton ? (
          <span className="dealer" title="Dealer button">
            D
          </span>
        ) : null}
      </div>
      <div className="stack">{fmtChips(s.stack)}</div>
      <div className="cards">
        {cards.map((c, i) => (
          <Card key={i} card={c} />
        ))}
      </div>
      <div className="foot">
        {ih && ih.streetBet > 0 ? <span className="bet">{fmtChips(ih.streetBet)}</span> : <span />}
        {secs != null ? (
          <span className={`clock${secs <= 5 ? ' urgent' : ''}`}>{secs}s</span>
        ) : status ? (
          <span className={`status ${status.cls ?? ''}`}>{status.text}</span>
        ) : p.toAct ? (
          <span className="status">to act</span>
        ) : null}
      </div>
    </li>
  );
}
