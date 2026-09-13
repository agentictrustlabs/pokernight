/**
 * THE SIDE OF A HOLD'EM TABLE, AS TABS — one panel with four rooms, under the coach card.
 *
 * It used to be a column of seven panels, one under the other: the coach, the desk, the practice table,
 * the money, the log. Each was defensible; together they were "just a running list of stuff", and the
 * thing a person wanted (what did the coach say? where is the chat? how do I hire a coach?) was
 * somewhere down the scroll with everything else. Now the coach card above this is about THE HAND —
 * mode, wait, advice, move — and this panel is everything else, sorted by what a person came for:
 *
 *   TALK    what the coach is saying as the hand goes (the running commentary), the table chat, and
 *           the full log folded under it — one place for everything said.
 *   ASK     a question to your agent, the earlier advice this session, and the review over the last
 *           N days of recorded hands.
 *   PEOPLE  who advises you and through whom, name your agent, hire or change a coach, who's who.
 *   TABLE   your practice table's hold, restart and pace; the money; getting ready to play.
 *
 * The tab a person was on is remembered in this browser. A tab that got something new while another
 * was open shows a dot, so the commentary is not lost behind a review.
 */
import { useEffect, useRef, useState } from 'react';
import type { AppSession, TableEvent } from '../lib/types';
import type { FormatContext } from '../lib/format';
import type { WhoIsWho as Roster } from '../lib/whoIsWho';
import type { TreasuryView } from '../lib/treasury';
import type { AuthConfig } from '../lib/home';
import { whoSaid } from '../lib/recommendations';
import { AskYourAgent, type Arrangement } from './PokerCoach';
import { CoachSection, ReviewSection } from './CoachDesk';
import { WhoIsWhoPanel } from './WhoIsWho';
import { PracticePanel } from './PracticePanel';
import { StartPanel } from './StartPanel';
import { MoneyPanel } from './MoneyPanel';
import { ChatBox, LogLines } from './LogPanel';

type Tab = 'talk' | 'ask' | 'people' | 'table';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'talk', label: 'Talk' },
  { id: 'ask', label: 'Ask' },
  { id: 'people', label: 'People' },
  { id: 'table', label: 'Table' },
];
const TAB_KEY = 'pokernight.side.tab';
const readTab = (): Tab => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'talk';
  } catch {
    return 'talk';
  }
};

export function TableSide({
  tableId,
  session,
  config,
  arrangement,
  roster,
  mine,
  paused,
  myTurn,
  onHold,
  holdErr,
  paceMs,
  settles,
  ready,
  treasury,
  onTreasuryChanged,
  settlement,
  chipValue,
  assetSymbol,
  log,
  ctx,
  canChat,
  onChat,
}: {
  tableId: string;
  session: AppSession | null;
  config: AuthConfig | null;
  /** What the coach card handed up; null until it has rendered once (no session, say). */
  arrangement: Arrangement | null;
  roster: Roster;
  mine: boolean;
  paused: boolean;
  myTurn: boolean;
  onHold: (held: boolean) => void;
  holdErr: string | null;
  paceMs: number | null;
  settles: boolean;
  ready: boolean;
  treasury: TreasuryView | null;
  onTreasuryChanged: () => void | Promise<void>;
  settlement: string;
  chipValue: string | null;
  assetSymbol: string | null;
  log: TableEvent[];
  ctx: FormatContext;
  canChat: boolean;
  onChat: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(readTab);
  const pick = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* remembered for this visit only */ }
  };
  // A DOT ON TALK when the commentary moved while another tab was open.
  const feed = arrangement?.feed ?? [];
  const seenFeed = useRef(feed.length);
  if (tab === 'talk') seenFeed.current = feed.length;
  const unread = tab !== 'talk' && feed.length > seenFeed.current;
  const feedRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const box = feedRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [feed, tab]);
  const [logOpen, setLogOpen] = useState(false);

  const adviser = arrangement?.adviser ?? null;
  const coach = arrangement?.coach ?? null;
  const said = arrangement?.said ?? [];

  return (
    <section className="panel side-panel">
      <div className="side-tabs" role="tablist" aria-label="Beside the table">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`side-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`side-pane-${t.id}`}
            className={`side-tab${tab === t.id ? ' on' : ''}${t.id === 'talk' && unread ? ' unread' : ''}`}
            onClick={() => pick(t.id)}
          >
            {t.label}
            {t.id === 'talk' && unread ? <span className="side-dot" aria-label="new" /> : null}
          </button>
        ))}
      </div>

      <div className="side-pane" role="tabpanel" id={`side-pane-${tab}`} aria-labelledby={`side-tab-${tab}`}>
        {tab === 'talk' ? (
          <div className="side-section talk-section">
            {/* THE COMMENTARY. One line per turn, what the voice said — the same words the browser spoke, for
                whoever missed them or has no voice to hear. */}
            {arrangement?.mode === 'off' ? (
              <p className="hint">The coach is quiet. Switch it to “Ask every turn” above and it will say what everyone at the table is doing; “Ask on demand” gives you a word only when you press Ask.</p>
            ) : feed.length === 0 ? (
              <p className="hint">Nothing said yet — the commentary starts with the first deal.</p>
            ) : (
              <ul className="coach-feed" ref={feedRef} aria-live="polite" aria-label="Coach commentary">
                {feed.map((f) => <li key={f.id}>{f.text}</li>)}
              </ul>
            )}
            {arrangement && !arrangement.speaks ? <p className="hint">This browser has no voice, so the coach is writing rather than talking.</p> : null}
            <ChatBox canChat={canChat} onChat={onChat} />
            <details className="side-more" open={logOpen} onToggle={(e) => setLogOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>Every event{log.length ? ` · ${log.length} line${log.length === 1 ? '' : 's'}` : ''}</summary>
              <LogLines log={log} ctx={ctx} open={logOpen} />
            </details>
          </div>
        ) : null}

        {tab === 'ask' ? (
          <div className="side-section ask-section">
            {session && adviser && arrangement ? (
              <AskYourAgent tableId={tableId} session={session} adviser={adviser} coach={coach} onWaiting={arrangement.setWaiting} onAnswer={arrangement.askAnswer} />
            ) : (
              <p className="hint">
                {session ? 'Questions go to your own agent. Name it under People first — the house coach is a rule, and keeps no memory of you.' : 'Log in to ask your agent about your play.'}
              </p>
            )}
            {said.length > 0 ? (
              <details className="side-more coach-earlier">
                <summary>Earlier advice this session · {said.length}</summary>
                <ul className="coach-earlier-list">
                  {said.map((r) => (
                    <li key={r.id}>
                      <span className="hint">hand {r.round} · {whoSaid(r.from)}</span>
                      <p className="coach-say">{r.say}</p>
                      {r.because ? <p className="coach-why">{r.because}</p> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <ReviewSection session={session} adviser={adviser} coach={coach} mine={mine} paused={paused} myTurn={myTurn} onHold={onHold} onWaiting={arrangement?.setWaiting} />
          </div>
        ) : null}

        {tab === 'people' ? (
          <div className="side-section people-section">
            <CoachSection tableId={tableId} session={session} config={config} adviser={adviser} coach={coach} onAdviserChanged={arrangement?.setAdviser ?? (() => {})} />
            <WhoIsWhoPanel roster={roster} />
          </div>
        ) : null}

        {tab === 'table' ? (
          <div className="side-section table-section">
            {mine && session ? (
              <>
                {holdErr ? <div className="form-error">{holdErr}</div> : null}
                <PracticePanel tableId={tableId} session={session} game="poker" paused={paused} onHold={onHold} paceMs={paceMs} />
              </>
            ) : null}
            {/* A player who is not ready to sit sees the ONE action that fixes that, above the money
                summary — not a refusal pointing at a panel somewhere else. */}
            {settles && session && !ready ? <StartPanel session={session} config={config} treasury={treasury} onChanged={onTreasuryChanged} /> : null}
            <MoneyPanel tableId={tableId} settlement={settlement} chipValue={chipValue} assetSymbol={assetSymbol} session={session} treasury={treasury} onChanged={onTreasuryChanged} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
