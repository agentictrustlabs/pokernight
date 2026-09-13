/**
 * THE SIDE OF A CANASTA TABLE, AS TABS — one panel with four rooms, under the coach card. The hold'em
 * board got this first (`TableSide`); the canasta column had the same problem worse: the coach panel
 * carried the adviser picker, the who's-who, the commentary and the voice settings; under it a desk, the
 * seat-filler, the practice panel, "your seat" with the leave button, and the log — nine things in a
 * column, and "it is hard to find anything in the right pane". The coach card above is about THE TURN;
 * this is everything else, sorted by what a person came for:
 *
 *   TALK    the running commentary, the table chat, the full log folded under it.
 *   ASK     earlier advice this session, and the review over the last N days of recorded rounds.
 *   PEOPLE  name your agent, who coaches you and where to change it, who's who, fill the empty chairs.
 *   TABLE   your seat (sit back in, leave), the practice table's hold, restart and pace, voice & speed.
 *
 * Leaving is never buried: `CanastaPage` also shows a seat bar with "Leave the table" above the tabs.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSession } from '../lib/types';
import type { AuthConfig } from '../lib/home';
import type { WhoIsWho as Roster } from '../lib/whoIsWho';
import { whoSaid } from '../lib/recommendations';
import { Adviser, VoiceSettings, type CanastaArrangement } from './Coach';
import { CoachSection, ReviewSection } from './CoachDesk';
import { WhoIsWhoPanel } from './WhoIsWho';
import { PracticePanel } from './PracticePanel';

type Tab = 'talk' | 'ask' | 'people' | 'table';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'talk', label: 'Talk' },
  { id: 'ask', label: 'Ask' },
  { id: 'people', label: 'People' },
  { id: 'table', label: 'Table' },
];
const TAB_KEY = 'pokernight.canasta.side.tab';
const readTab = (): Tab => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'talk';
  } catch {
    return 'talk';
  }
};

export function CanastaSide({
  tableId,
  session,
  config,
  arrangement,
  roster,
  mine,
  paused,
  myTurn,
  onHold,
  tableErr,
  paceMs,
  coach,
  log,
  seat,
  fillSeats,
}: {
  tableId: string;
  session: AppSession | null;
  config: AuthConfig | null;
  arrangement: CanastaArrangement | null;
  roster: Roster;
  mine: boolean;
  paused: boolean;
  myTurn: boolean;
  onHold: (held: boolean) => void;
  tableErr: string | null;
  paceMs: number | null;
  /** The coach service the person's agent consults for canasta, when one is hired. */
  coach: string | null;
  /** The log panel (its own component — it carries the chat too). */
  log: ReactNode;
  /** The seat panel: sit back in, leave, or the seat picker for somebody standing. */
  seat: ReactNode;
  /** The empty-chair filler, when there are chairs to fill. */
  fillSeats: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(readTab);
  const pick = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* remembered for this visit only */ }
  };
  const feed = arrangement?.feed ?? [];
  const seenFeed = useRef(feed.length);
  if (tab === 'talk') seenFeed.current = feed.length;
  const unread = tab !== 'talk' && feed.length > seenFeed.current;
  const feedRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const box = feedRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [feed, tab]);
  const adviser = arrangement?.adviser ?? null;
  const said = arrangement?.said ?? [];

  return (
    <section className="panel side-panel">
      <div className="side-tabs" role="tablist" aria-label="Beside the table">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`cside-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`cside-pane-${t.id}`}
            className={`side-tab${tab === t.id ? ' on' : ''}${t.id === 'talk' && unread ? ' unread' : ''}`} onClick={() => pick(t.id)}>
            {t.label}
            {t.id === 'talk' && unread ? <span className="side-dot" aria-label="new" /> : null}
          </button>
        ))}
      </div>
      <div className="side-pane" role="tabpanel" id={`cside-pane-${tab}`} aria-labelledby={`cside-tab-${tab}`}>
        {tab === 'talk' ? (
          <div className="side-section talk-section">
            {arrangement?.mode === 'off' ? (
              <p className="hint">The coach is off. Switch it to “Tell me” above and it will say what everyone at the table is doing.</p>
            ) : feed.length === 0 ? (
              <p className="hint">Nothing said yet — the commentary starts with the first deal.</p>
            ) : (
              <ul className="coach-feed" ref={feedRef} aria-label="Coach commentary">
                {feed.map((f) => <li key={f.id}>{f.text}</li>)}
              </ul>
            )}
            {arrangement && !arrangement.speaks ? <p className="hint">This browser has no voice, so the coach is writing rather than talking.</p> : null}
            {log}
          </div>
        ) : null}
        {tab === 'ask' ? (
          <div className="side-section ask-section">
            {said.length > 0 ? (
              <details className="side-more coach-earlier" open>
                <summary>Advice this session · {said.length}</summary>
                <ul className="coach-earlier-list">
                  {said.map((r) => (
                    <li key={r.id}>
                      <span className="hint">round {r.round} · {whoSaid(r.from)}</span>
                      <p className="coach-say">{r.say}</p>
                      {r.because ? <p className="coach-why">{r.because}</p> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <ReviewSection session={session} adviser={adviser} coach={coach} mine={mine} paused={paused} myTurn={myTurn} onHold={onHold} game="canasta" />
          </div>
        ) : null}
        {tab === 'people' ? (
          <div className="side-section people-section">
            {session ? <Adviser tableId={tableId} session={session} game="canasta" adviser={adviser} onChanged={arrangement?.setAdviser ?? (() => {})} /> : null}
            <CoachSection tableId={tableId} session={session} config={config} adviser={adviser} coach={coach} onAdviserChanged={arrangement?.setAdviser ?? (() => {})} game="canasta" pickAdviser={false} />
            <WhoIsWhoPanel roster={roster} />
            {fillSeats}
          </div>
        ) : null}
        {tab === 'table' ? (
          <div className="side-section table-section">
            {seat}
            {mine && session ? (
              <>
                {tableErr ? <div className="form-error">{tableErr}</div> : null}
                <PracticePanel tableId={tableId} session={session} game="canasta" paused={paused} onHold={onHold} paceMs={paceMs} />
              </>
            ) : null}
            <VoiceSettings />
          </div>
        ) : null}
      </div>
    </section>
  );
}
