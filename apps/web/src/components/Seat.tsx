import type { CSSProperties } from 'react';
import type { ActionRecord, Card as CardCode, PlayerInfo, SeatView } from '../lib/types';
import { actionBadge, fmtDelta } from '../lib/format';
import { DEALT_IN_SOON } from '../lib/seating';
import type { TableRate } from '../lib/money';
import { strategyWords } from '../lib/whoIsWho';
import { Card } from './Card';
import { ChipStack } from './ChipStack';
import { TurnClock } from './TurnClock';

/** Initials for the monogram avatar: "Alice" → "A", "Ada L" → "AL". */
export function monogram(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + second).toUpperCase().slice(0, 2);
}

export interface SeatProps {
  seatNo: number;
  seat: SeatView | null;
  name: string;
  player?: PlayerInfo;
  bigBlind: number;
  isYou: boolean;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  toAct: boolean;
  /** Absolute deadline for this seat's action, if known. */
  deadline: number | null;
  /** Full turn clock, for the arc. */
  timeoutMs: number;
  now: number;
  inHand: boolean;
  /** Hand number, so a new deal remounts the cards and replays the entrance. */
  handKey: number;
  /** Cards known for this seat (own, or shown at showdown). */
  known?: CardCode[];
  /** Cards belonging to the winning five, drawn in gold. */
  winCards?: Set<CardCode>;
  /** This seat took a pot in the hand that just ended. */
  isWinner?: boolean;
  /** Fade this seat's cards: the hand is over and it did not win. */
  dimmed?: boolean;
  /** Net chips for the finished hand, floated above the seat. */
  delta?: number | null;
  /** Last action this seat took on the current street. */
  last?: ActionRecord;
  /** Position on the oval, in percent. */
  x: number;
  y: number;
  canSit: boolean;
  onSit: (seat: number) => void;
  /** This table's chip rate, so a stack shows the money it is worth. Null on play money. */
  rate?: TableRate | null;
  /** Two words on an empty seat saying what sitting in it costs: the table's ticker, or "play money". */
  modeLabel?: string;
}

export function Seat(p: SeatProps) {
  const style = { '--x': p.x, '--y': p.y, '--seat-hue': `var(--seat-${p.seatNo % 9})` } as CSSProperties;

  if (!p.seat) {
    // An open seat is a gap in the ring, not a peer of a player: no shadow, no
    // fill, small type. The whole card is the button so the target stays large.
    return (
      <li className="seat empty" style={style}>
        {p.canSit ? (
          <button
            className="sit"
            onClick={() => p.onSit(p.seatNo)}
            aria-label={`Sit at seat ${p.seatNo + 1}${p.modeLabel ? ` — ${p.modeLabel}` : ''}`}
          >
            <span className="seat-no">Seat {p.seatNo + 1}</span>
            <span className="sit-cta">Sit here</span>
            {/* What this seat costs, on the seat itself: nobody should learn the table settles in
                Sheqels only after they have pressed the button. */}
            {p.modeLabel ? <span className={`sit-mode${p.rate ? ' money' : ''}`}>{p.modeLabel}</span> : null}
          </button>
        ) : (
          <span className="sit-open" aria-label={`Seat ${p.seatNo + 1}, empty`}>
            <span className="seat-no">Seat {p.seatNo + 1}</span>
            <span className="sit-cta">open</span>
            {p.modeLabel ? <span className={`sit-mode${p.rate ? ' money' : ''}`}>{p.modeLabel}</span> : null}
          </span>
        )}
      </li>
    );
  }

  const s = p.seat;
  const ih = s.inHand;
  const folded = ih?.folded ?? false;
  const dealt = p.inHand && ih != null && !folded;
  const revealed = p.known ?? [];
  // Dealt in: two cards, face down unless we know them. Not dealt in but known:
  // a showdown we are still looking at after the hand state was cleared.
  const cards: (CardCode | undefined)[] = dealt
    ? (revealed.length ? revealed : (ih?.holeCards ?? [undefined, undefined]))
    : revealed;
  const isAgent = p.player?.kind === 'agent';
  const thinking = p.toAct && isAgent;
  // Seated but not in this hand: they arrived after it began and join at the big blind.
  const waiting = s.waitingForBigBlind === true;

  const cls = [
    'seat',
    'taken',
    p.isYou ? 'you' : '',
    p.toAct ? 'to-act' : '',
    folded ? 'folded' : '',
    s.status === 'sitting-out' ? 'sitting-out' : '',
    p.isWinner ? 'winner' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const tags: { key: string; text: string; cls: string }[] = [];
  if (s.status === 'sitting-out') tags.push({ key: 'out', text: 'Sitting out', cls: 'muted' });
  else if (folded) tags.push({ key: 'fold', text: 'Folded', cls: 'muted' });
  else if (ih?.allIn) tags.push({ key: 'allin', text: 'All-in', cls: 'allin' });
  // NOT "Waiting for BB". That is a phrase for people who already know it, and to everybody else it
  // says that something is wrong with them while withholding the one useful fact — that they are
  // about to be dealt in and need do nothing.
  if (waiting) tags.push({ key: 'wait', text: DEALT_IN_SOON, cls: 'muted' });
  if (p.last && !folded) tags.push({ key: 'last', text: actionBadge(p.last), cls: 'last' });

  const puck = p.isButton ? { t: 'D', title: 'Dealer button' } : p.isSmallBlind ? { t: 'SB', title: 'Small blind' } : p.isBigBlind ? { t: 'BB', title: 'Big blind' } : null;

  return (
    <li className={cls} style={style} aria-label={`Seat ${p.seatNo + 1}, ${p.name}`}>
      {p.delta != null && p.delta !== 0 ? (
        <span className={`delta num ${p.delta > 0 ? 'up' : 'down'}`} aria-hidden="true">
          {fmtDelta(p.delta)}
        </span>
      ) : null}

      {/* The name owns a full-width line of its own: a card room calls people by
          name, so it must never be clipped at the default seat width. */}
      <div className="seat-name">
        <span className="name" title={p.name}>
          {p.name}
        </span>
      </div>

      <div className="seat-top">
        <span className="avatar-wrap">
          <span className="avatar" aria-hidden="true">
            {monogram(p.name)}
          </span>
          {p.toAct ? <TurnClock deadline={p.deadline} totalMs={p.timeoutMs} now={p.now} /> : null}
          {puck ? (
            <span className={`puck ${puck.t.toLowerCase()}`} title={puck.title} aria-label={puck.title}>
              {puck.t}
            </span>
          ) : null}
        </span>
        <span className="seat-id">
          {isAgent ? (
            // WHAT IS BEHIND IT, on the seat itself — a rules table or a language model. "Agent" alone
            // said only that it was not a person, and the question people actually have is which of
            // the players are LLMs.
            <span className="agent" title={`A2A agent · ${p.player?.agentName ?? 'a2a'} · ${strategyWords(p.player?.agentKind)}`}>
              <span className="agent-tag">{p.player?.agentKind ? strategyWords(p.player.agentKind) : 'Agent'}</span>
              <span className="agent-name">{p.player?.agentName ?? p.player?.agentKind ?? 'a2a'}</span>
            </span>
          ) : null}
          <ChipStack amount={s.stack} bigBlind={p.bigBlind} label="Stack" size="sm" maxColumns={4} className="seat-stack" rate={p.rate} />
        </span>
      </div>

      <div className="seat-foot">
        <div className="seat-cards">
          {cards.map((c, i) => (
            <Card
              key={`${p.handKey}-${i}`}
              card={c}
              size="sm"
              enter="deal"
              delayMs={i * 70}
              win={c != null && p.winCards?.has(c) === true}
              muted={p.dimmed === true && !(c != null && p.winCards?.has(c) === true)}
            />
          ))}
        </div>

        <div className="seat-tags">
          {thinking ? (
            <span className="tag thinking" title="Agent is deciding">
              <i /> <i /> <i /> thinking
            </span>
          ) : null}
          {tags.map((t) => (
            <span key={t.key} className={`tag ${t.cls}`}>
              {t.text}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}
