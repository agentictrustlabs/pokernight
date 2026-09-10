import { useEffect, useRef, useState } from 'react';
import type { CanastaTableEvent } from '../lib/canasta';

/**
 * What has happened this round, in sentences.
 *
 * A canasta round is long — dozens of turns, and the thing a player most needs to look back at is
 * what has been melded and who took the pile. The poker log describes a hand; this describes a
 * round, and the two games' events have nothing in common, so it is a separate reader rather than a
 * formatter with a switch on the game.
 */
export function CanastaLog({
  log,
  nameOf,
  live,
  canChat,
  onChat,
}: {
  log: readonly CanastaTableEvent[];
  nameOf: (seat: number) => string;
  /** Whether a round is running. Decides what an EMPTY log means, which is two different things. */
  live: boolean;
  canChat: boolean;
  onChat: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);

  /**
   * Keep the newest line in view WITHOUT moving the page.
   *
   * `scrollIntoView` was the obvious call and the wrong one: when the element's own container is not
   * scrollable — or is only just — the browser satisfies the request by scrolling the WINDOW, so
   * every event at the table dragged the board off screen. Setting `scrollTop` on the box asks the
   * box and nothing else.
   */
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log.length]);

  return (
    <section className="panel log-panel">
      {/* FOLDED SHUT. The coach's commentary says what just happened, where somebody is already
          looking; this is the whole round in order, which is a thing you go and check rather than
          read as you play. Open it stayed on screen taking a column's worth of height off the
          board — and nobody was reading it. */}
      <details>
        <summary>
          Log{log.length > 0 ? <span className="log-count">{log.length}</span> : null}
        </summary>
        <div className="log-scroll" ref={boxRef}>
          {/* Joining mid-round, this client has no history: the events it missed were sent to
              whoever was connected. Saying "waiting for the first deal" while a round is visibly
              running is the one thing it must not say. */}
          {log.length === 0 ? <p className="hint">{live ? 'Nothing since you joined.' : 'Waiting for the first deal.'}</p> : null}
          <ul className="log">
            {log.map((ev, i) => {
              const line = describe(ev, nameOf);
              return line ? <li key={i}>{line}</li> : null;
            })}
          </ul>
        </div>
      </details>
      {canChat ? (
        <form
          className="log-chat"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            onChat(t);
            setText('');
          }}
        >
          <input value={text} maxLength={280} placeholder="Say something" onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim()}>
            Send
          </button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * One event as a sentence, or null for the ones that are not worth a line.
 *
 * The private events — the cards you were dealt, the card you drew — are deliberately silent. They
 * are already on screen in your hand, and repeating them in a log that sits beside the table would
 * put a player's own cards in a place they might read aloud.
 */
export function describe(ev: CanastaTableEvent, nameOf: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'round-started':
      return `Round ${ev.roundNo} — ${nameOf(ev.dealer)} dealt, ${ev.stock} in the stock.`;
    case 'upcard':
      return `Turned up ${ev.card}${ev.frozen ? ' — the pile starts frozen' : ''}.`;
    case 'red-three':
      return `${nameOf(ev.seat)} laid down a red three (${ev.card}) and drew again.`;
    case 'drew':
      return `${nameOf(ev.seat)} drew. ${ev.stock} left in the stock.`;
    case 'took-pile':
      return `${nameOf(ev.seat)} took the pile — ${ev.cards} cards, on the ${ev.top}.`;
    case 'melded':
      return `${nameOf(ev.seat)} melded ${ev.rank}s — ${ev.size} cards${ev.canasta ? ', a canasta' : ''}.`;
    case 'opened':
      return `${nameOf(ev.seat)}'s side opened with ${ev.value}.`;
    case 'discarded': {
      // `frozen` is the pile's STATE after the discard, not news about this one. Repeating it on
      // every line for the rest of the round buries the line where it actually happened — which is
      // the one a player needs, because discarding a wild is what freezes it.
      const froze = ev.card[0] === 'W' || ev.card[0] === '2';
      return `${nameOf(ev.seat)} discarded ${ev.card}${froze && ev.frozen ? ', freezing the pile' : ''}.`;
    }
    case 'round-ended':
      return ev.result.wentOut === null
        ? 'The stock ran out. The round is scored.'
        : `${nameOf(ev.result.wentOut)} went out${ev.result.concealed ? ', concealed' : ''}. The round is scored.`;
    case 'game-ended':
      return `Game over — ${ev.winner === 0 ? 'seats 1 & 3' : 'seats 2 & 4'} won.`;
    case 'chat':
      return `${ev.name}: ${ev.text}`;
    case 'seat-joined':
      return `${ev.name ?? nameOf(ev.seat)} sat down in seat ${ev.seat + 1}.`;
    case 'seat-left':
      return `${ev.name ?? nameOf(ev.seat)} left seat ${ev.seat + 1}.`;
    // 'dealt', 'drew-card' and 'turn' say nothing a player cannot already see, and the first two are
    // their own cards. A log that repeats your hand is a log you cannot show anyone.
    default:
      return null;
  }
}
