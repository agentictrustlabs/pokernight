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

/** The lines alone — every event of every hand, as a ledger. Mounted where the side panel wants it. */
export function LogLines({ log, ctx, open = true }: { log: TableEvent[]; ctx: FormatContext; open?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // The scroll-to-bottom runs only while it is shown, so showing it lands on the latest line.
  useEffect(() => {
    const el = ref.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [log, open]);
  return (
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
  );
}

/** One line to the table. */
export function ChatBox({ canChat, onChat }: { canChat: boolean; onChat: (text: string) => void }) {
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim().slice(0, 280);
    if (!t) return;
    onChat(t);
    setText('');
  };
  return (
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
        placeholder={canChat ? 'Say something to the table' : 'Log in to chat'}
        disabled={!canChat}
        onChange={(e) => setText(e.target.value)}
        aria-label="Chat message"
      />
      <button type="submit" disabled={!canChat || !text.trim()}>
        Send
      </button>
    </form>
  );
}

/** The log folded away as its own panel — what a page without a side panel of tabs mounts. */
export function LogPanel({ log, ctx, canChat, onChat }: { log: TableEvent[]; ctx: FormatContext; canChat: boolean; onChat: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="panel log-panel" aria-label="Table log" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><h3>Log &amp; chat{log.length ? <span className="hint"> · {log.length} line{log.length === 1 ? '' : 's'}</span> : null}</h3></summary>
      <LogLines log={log} ctx={ctx} open={open} />
      <ChatBox canChat={canChat} onChat={onChat} />
    </details>
  );
}
