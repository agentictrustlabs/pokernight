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
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const send = () => {
    const t = text.trim().slice(0, 280);
    if (!t) return;
    onChat(t);
    setText('');
  };

  return (
    <section className="panel log-panel" aria-label="Table log">
      <h3>Log</h3>
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
    </section>
  );
}
