import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { TableEvent } from '../lib/types';
import { eventActor, formatEvent, type FormatContext } from '../lib/format';

/** Line flavour: the log reads as a ledger, so each kind of entry gets its own weight. */
function lineClass(ev: TableEvent): string {
  switch (ev.type) {
    case 'chat':
      return 'chat';
    case 'hand-started':
      return 'hand';
    case 'street':
      return 'street';
    case 'showdown':
      return 'showdown';
    case 'hand-ended':
      return 'win';
    case 'blind-posted':
      return 'blind';
    case 'action':
      return `act act-${ev.record.action.type}`;
    default:
      return '';
  }
}

export function LogPanel({ log, ctx, canChat, onChat }: { log: TableEvent[]; ctx: FormatContext; canChat: boolean; onChat: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  // FOLDED AWAY BY DEFAULT, at the bottom of the side. The log is every event of every hand; it is
  // where a dispute is settled and a chat is had, and not what a person looks at between decisions —
  // it was crowding the coach and the money out of the first screen. The scroll-to-bottom runs only
  // while it is open, so opening it lands on the latest line.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [log, open]);

  const send = () => {
    const t = text.trim().slice(0, 280);
    if (!t) return;
    onChat(t);
    setText('');
  };

  return (
    <details className="panel log-panel" aria-label="Table log" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><h3>Log &amp; chat{log.length ? <span className="hint"> · {log.length} line{log.length === 1 ? '' : 's'}</span> : null}</h3></summary>
      <div className="log" ref={ref} role="log">
        {log.length === 0 ? <div className="hint line">Waiting for the first hand.</div> : null}
        {log.map((ev, i) => {
          const actor = eventActor(ev, ctx);
          const style = actor != null ? ({ '--seat-hue': `var(--seat-${actor % 9})` } as CSSProperties) : undefined;
          return formatEvent(ev, ctx).map((line, j) => (
            <div key={`${i}-${j}`} className={`line ${lineClass(ev)}${actor != null ? ' by' : ''}`} style={style}>
              {line}
            </div>
          ));
        })}
      </div>
      <form
        className="chatbox"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          value={text}
          maxLength={280}
          placeholder={canChat ? 'Say something' : 'Log in to chat'}
          disabled={!canChat}
          onChange={(e) => setText(e.target.value)}
          aria-label="Chat message"
        />
        <button type="submit" disabled={!canChat || !text.trim()}>
          Send
        </button>
      </form>
    </details>
  );
}
