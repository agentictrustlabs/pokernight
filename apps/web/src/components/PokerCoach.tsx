import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSession, ClientCommand, HandResult, Street, TableEvent, TableView } from '../lib/types';
import { api, ApiError, type CoachAdvice, type CoachStatus } from '../lib/api';
import { remember, whoSaid, type Recommendation } from '../lib/recommendations';
import { useUserIdle } from '../lib/useUserIdle';
import { newAlerts } from '../lib/alerts';
import type { FormatContext } from '../lib/format';
import { actionWords, handEndLines, playable, pokerAlerts, pokerFeedLines, spokenAction, spokenPokerLine } from '../lib/pokerWords';
import { announce, canSpeak, hush, primeVoices, say } from '../lib/speech';
import type { CoachMode } from './Coach';
import type { PlayerInfo } from '../lib/types';

/**
 * SOMEBODY AT YOUR SHOULDER WHILE YOU LEARN HOLD'EM.
 *
 * Its own component, not a mode of the canasta coach, because the rule of this client is one board
 * and one set of words per game. Sharing them would mean branching on the game inside a coach, and
 * the two games need opposite things said.
 *
 * WHAT MAKES HOLD'EM HARD IS NOT THE RULES. Anybody can be taught the rules of hold'em in five
 * minutes; what a beginner is actually missing is the PRICE — what a call costs against what it can
 * win, and how often it therefore has to be right. So this coach says that number, every time, and
 * `lib/pokerWords.ts` keeps saying it in the alerts too. Canasta's coach explains which moves exist;
 * this one explains what they cost.
 *
 * Three settings, the same three as canasta's: off, tell me (it explains, you press), play for me.
 */

/** How long to let a move be read before playing it. Long enough to hear, short enough not to burn
 *  the turn clock — poker's default clock is 30s, so this is deliberately shorter than canasta's. */
const READ_MS = 2600;
const FEED_LIMIT = 8;
/** How long to wait before asking again, and how many times. */
const RETRY_MS = 1200;
/** How long to wait before asking, when nothing has gone wrong: long enough for the table's answer
 *  to the previous move to have come back. */
const FIRST_ASK_MS = 700;
const RETRIES = 20;

export interface Said {
  id: number;
  text: string;
}

/** The first sentence of a longer explanation — what there is time to say between two moves. */
function firstSentence(text: string): string {
  const m = /^[^.!?]*[.!?]/.exec(text.trim());
  return (m ? m[0] : text).trim();
}

/**
 * WHAT THE COACH CARD HANDS TO THE PANELS BESIDE IT. The card itself is about the hand — the mode, the wait,
 * the advice, the move. Everything else it knows (who advises, which coach answered, the running commentary,
 * the earlier advice, the question box's callbacks) is rendered by `TableSide`'s tabs, so the column reads as
 * ONE thing to look at and a place to go for the rest.
 */
export interface Arrangement {
  adviser: { agentName: string; displayName: string } | null;
  coach: string | null;
  setAdviser: (a: { agentName: string; displayName: string } | null) => void;
  setWaiting: (w: { what: 'advice' | 'review'; who: string } | null) => void;
  /** The running commentary — one line per turn, what the voice says. */
  feed: Said[];
  /** Earlier advice this session, newest first, each with whose voice it was. */
  said: Recommendation[];
  /** A question box's answer arrives: remembered, spoken. */
  askAnswer: (a: CoachAdvice) => void;
  /** The mode, so the panels can say why the commentary is quiet. */
  mode: CoachMode;
  speaks: boolean;
}

export function PokerCoach({
  tableId,
  session,
  view,
  viewerSeat,
  myTurn,
  handNo,
  street,
  log,
  logSeq,
  ctx,
  players,
  paused = false,
  startOn = 'off',
  mine = false,
  onStatus,
  onArrangement,
  send,
}: {
  tableId: string;
  session: AppSession | null;
  view: TableView | null;
  viewerSeat: number | null;
  myTurn: boolean;
  handNo: number;
  /**
   * The street, which is hold'em's second half of "what turn is this".
   *
   * It matters for the same reason canasta's phase does: a hand number alone does not change when the
   * board does, so anything keyed on the hand would ask once and then sit there. A new street is a new
   * question about the same hand.
   */
  street: Street | null;
  log: readonly TableEvent[];
  /** How many have EVER arrived. The log is capped, so its length is not a position in a stream. */
  logSeq: number;
  /** How to name a seat, and which one is the viewer's — the log's own context, reused. */
  ctx: FormatContext;
  /** What the table said about whoever holds each seat: a person, or an agent and what is behind it. */
  players: Record<string, PlayerInfo>;
  /** The table is holding. Nothing is said and nothing is played until it starts again. */
  paused?: boolean;
  startOn?: CoachMode;
  /** This is the viewer's OWN practice table — the one place a review may hold the table while it runs. */
  mine?: boolean;
  /** What the coach is doing, for the BOARD to show beside the turn clock. */
  onStatus?: (s: CoachStatus) => void;
  /** Who advises here and which coach answered — for the side panel under this card, which owns the arrangement. */
  onArrangement?: (a: Arrangement) => void;
  send: (c: ClientCommand) => void;
}) {
  const [mode, setMode] = useState<CoachMode>(startOn);
  /**
   * Whether the person has chosen for themselves.
   *
   * Until they have, a default that arrives LATE is still the default. `startOn` depends on whether
   * this is the viewer's own practice table, and that is a fact the card room keeps — it comes back
   * from an HTTP read a moment after the board has mounted. A coach that fixed its mode on the first
   * frame ignored it, so arriving at your own practice table any way other than through the "deal me
   * in" link gave you a coach switched off. Once somebody presses one of the three, this stops.
   */
  const chosen = useRef(false);
  useEffect(() => {
    if (!chosen.current) setMode(startOn);
  }, [startOn]);
  const [advice, setAdvice] = useState<CoachAdvice | null>(null);
  const [said, setSaid] = useState<Recommendation[]>([]);
  /**
   * WHO IS ADVISING YOU, read from the TABLE rather than remembered from your own last press.
   *
   * Held in state alone, this was wrong for everybody who reloaded, opened a second tab, or simply
   * came back later: the panel said "advised by the house coach" while somebody's own agent answered
   * every question. A screen that names the wrong voice is the one dishonest thing here.
   */
  const [adviser, setAdviser] = useState<{ agentName: string; displayName: string } | null>(null);
  /**
   * THE COACH BEHIND YOUR AGENT, learned from an answer. Your agent is what the table addresses; when
   * it consulted the coaching service you named at your Home, the answer says so (`source.coach`), and
   * from then on the panel names both. Nothing here is asked of the table — it holds no such address.
   */
  const [coach, setCoach] = useState<string | null>(null);
  const noteVoice = (a: { source?: CoachAdvice['source'] } | null) => {
    const src = a?.source;
    if (src && src !== 'house' && src.coach) setCoach(src.coach);
  };
  /**
   * WHAT IS BEING WAITED FOR, SAID LOUDLY. A consultation goes table → your agent → your coach → back,
   * ten to eighteen seconds; a review reads your recorded hands and takes up to a minute. A panel that
   * showed "Asking…" in a button while the clock ran gave nobody a reason to wait — "it just dropped me
   * out" was a person timed out of a hand while a review ran. So the wait is a banner with a stopwatch,
   * and it says whose tokens are burning and what the table is doing meanwhile.
   */
  const [waiting, setWaiting] = useState<{ what: 'advice' | 'review'; who: string; since: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [waiting]);
  const voiceName = adviser ? (coach ? `${coach}, via ${adviser.displayName}` : adviser.displayName) : 'the house coach';
  useEffect(() => {
    if (!session) return;
    let alive = true;
    api
      .getAdviser(tableId, session.token)
      .then(async (r) => {
        if (!alive) return;
        if (r.adviser) {
          setAdviser(r.adviser);
          // WHICH COACH, known before the first answer: the People tab says "no coach hired yet" until told otherwise.
          if (session.via !== 'dev') api.coachStatus(session.token).then((st) => { if (alive && st.coach) setCoach(st.coach); }).catch(() => {});
          return;
        }
        // YOUR OWN AGENT IS THE ADVISER BY DEFAULT WHEN IT HAS A COACH. A person whose Home has bound a coach to
        // their agent arrived at a table still "advised by the house coach" and had to find the picker; the
        // whole point of hiring was not to. Appointed once here — a person who then chooses the house keeps
        // that choice at this table (the cleared mark), and a dev session has no agent to appoint.
        if (session.via === 'dev') return;
        try { if (sessionStorage.getItem(`pokernight.adviser.cleared:${tableId}`)) return; } catch { /* appoint anyway */ }
        const st = await api.coachStatus(session.token).catch(() => null);
        if (!alive || !st?.agent || !st.coach || st.advertises === false) return;
        const named = await api.setAdviser(tableId, st.agent, session.token).catch(() => null);
        if (alive && named?.adviser) { setAdviser(named.adviser); setCoach(st.coach); }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session, tableId]);
  const [feed, setFeed] = useState<Said[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [missed, setMissed] = useState(0);
  /** The page is not being looked at (`document.visibilityState`). No adviser is asked while so. */
  const [hidden, setHidden] = useState(false);
  const asked = useRef<string>('');
  const seen = useRef(0);
  const nextId = useRef(0);
  const toldAbout = useRef(new Set<string>());
  const speaks = canSpeak();

  const push = useCallback((text: string) => {
    setFeed((f) => [...f, { id: nextId.current++, text }].slice(-FEED_LIMIT));
  }, []);

  /* ------------------------------------------ what everybody else is doing */

  /**
   * The table's own events on screen, and one short line per event out loud.
   *
   * Reuses the log's formatter for the screen rather than writing a second set of sentences: the log
   * is already the record, and a coach that described the same events in different words would make a
   * player check whether the two agreed.
   */
  // THE PANELS BESIDE THIS CARD own the arrangement and the commentary (who advises, hire a coach, the review); it is told who
  // advises here and which coach answered, and given the two setters it needs — so this panel stays about the hand.
  useEffect(() => {
    onArrangement?.({
      adviser, coach, setAdviser, mode, speaks, feed, said,
      setWaiting: (w) => setWaiting(w ? { ...w, since: Date.now() } : null),
      askAnswer: (a) => { noteVoice(a); setSaid((cur) => remember(cur, a, handNo)); if (a.because) say(firstSentence(a.because)); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adviser, coach, mode, speaks, feed, said, handNo]);
  useEffect(() => {
    if (mode === 'off') return;
    const fresh = Math.min(Math.max(0, logSeq - seen.current), log.length);
    for (let i = log.length - fresh; i < log.length; i++) {
      const ev = log[i] as TableEvent;
      for (const line of pokerFeedLines(ev, ctx)) push(line);

      // A HAND ENDING IS AN ANNOUNCEMENT, not another line of commentary — the same reason canasta
      // announces a round: it is several sentences into a queue two deep, so as ordinary chatter the
      // ones that matter get evicted by whatever happens next.
      const result = (ev as { type: string; result?: HandResult }).result;
      if (ev.type === 'hand-ended' && result) {
        const lines = handEndLines(result, ctx);
        for (const l of lines) push(l);
        announce(lines);
        continue;
      }

      const short = spokenPokerLine(ev, ctx);
      if (short) say(short);
    }
    seen.current = logSeq;
    // `ctx` is rebuilt every render, so it cannot be a dependency without replaying the log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logSeq, mode]);

  /**
   * THE FEW MOMENTS WORTH INTERRUPTING FOR — the price, being short, the hand going heads-up, the pot
   * outgrowing the stack behind it. Each fires once; a warning repeated every turn is noise.
   */
  useEffect(() => {
    if (mode === 'off' || !view) return;
    const fresh = newAlerts(pokerAlerts(view, viewerSeat, ctx.seatName), toldAbout.current);
    for (const a of fresh) {
      toldAbout.current.add(a.key);
      push(a.text);
      say(a.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode, viewerSeat]);

  /* ---------------------------------------------------- what YOU should do */

  const ask = useCallback(async () => {
    // A PAUSED TABLE IS NOT PLAYED, and the coach is the one thing that would otherwise carry on:
    // the table refuses a move with `paused`, and a coach that kept asking and pressing would be a
    // loop of refusals with a voice attached.
    if (!session || !myTurn || mode === 'off' || paused) return;
    const key = `${handNo}:${street ?? ''}`;
    asked.current = key;
    // THE QUESTION IS OUT, and the board says so too. The house answers in a blink; a named adviser is
    // a trip to your Home and your coach — either way the person sees a stopwatch, not a quiet line.
    const since = Date.now();
    setWaiting({ what: 'advice', who: voiceName, since });
    onStatus?.({ phase: 'thinking', who: voiceName, since });
    try {
      const a = await api.advice(tableId, session.token);
      setWaiting(null);
      onStatus?.({ phase: 'ready', who: whoSaid(a.source ?? 'house'), since, say: a.say });
      setMissed(0);
      // The world moves while the coach thinks. An answer about a decision that has passed is worse
      // than no answer, because in `play` mode it would be PLAYED.
      if (asked.current !== key) return;
      setAdvice(a);
      noteVoice(a);
      setSaid((cur) => remember(cur, a, handNo));
      // THE REASON IS THE POINT AT A POKER TABLE, so unlike canasta it is spoken every time rather
      // than only for the interesting moves. The reason here is the price, and the price is what the
      // person is at this table to learn to read.
      if (a.because) say(firstSentence(a.because));
      if (mode === 'play') {
        let left = Math.ceil(READ_MS / 1000);
        setCountdown(left);
        const tick = setInterval(() => {
          left -= 1;
          setCountdown(left > 0 ? left : null);
          if (left <= 0) clearInterval(tick);
        }, 1000);
        setTimeout(() => {
          clearInterval(tick);
          setCountdown(null);
          // The decision moved on while we were reading it out. Ordinary — and the heartbeat below
          // picks the next one up, which is what stops a dropped move becoming a table that sits
          // there until the clock runs down.
          if (asked.current !== key) return;
          // Same rule as the button: nothing is sent for advice that named no move. Sending an empty
          // action burned the turn silently, which is the worst of both — no move and no explanation.
          if (playable(a.action)) send({ type: 'act', handNo, action: a.action, auto: true } as ClientCommand);
          setAdvice(null);
        }, READ_MS);
      }
    } catch {
      // A MISS IS NOT AN ENDING. The card room answers 404 for the moment before it agrees it is this
      // seat's turn, which happens on most turns because the view learns first. Counting the miss is
      // what makes it retry instead of going quiet for the rest of the hand.
      setWaiting(null);
      onStatus?.({ phase: 'idle', who: voiceName, since });
      setAdvice(null);
      setMissed((n) => n + 1);
    }
  }, [adviser, handNo, mode, myTurn, onStatus, paused, send, session, street, tableId, voiceName]);

  // A new decision is a new question: forget the old answer and let the heartbeat ask.
  useEffect(() => {
    setAdvice(null);
    setCountdown(null);
    setMissed(0);
    onStatus?.({ phase: 'idle', who: voiceName, since: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, myTurn, handNo, street]);

  /**
   * A HEARTBEAT while it is your turn and there is nothing to say.
   *
   * Unconditional on purpose, and the reason is the same one canasta's coach documents: every way of
   * ending up empty-handed that is NOT a refused request — a move dropped because the key moved on, a
   * countdown that fired into a stale key, a request that landed while the view was catching up —
   * used to leave the seat silent until the clock ran out. Keying on "there is no advice" catches all
   * of them, because playing a move is what clears the advice.
   */
  useEffect(() => {
    if (mode === 'off' || paused || !myTurn || advice || countdown != null || missed > RETRIES || hidden) return;
    const h = setTimeout(() => void ask(), missed === 0 ? FIRST_ASK_MS : RETRY_MS);
    return () => clearTimeout(h);
  }, [advice, ask, countdown, missed, mode, myTurn, paused, hidden]);

  /**
   * NOBODY IS LOOKING, SO NOBODY IS ASKED. A tab in the background, a phone in a pocket, a window
   * behind another: the turn still comes round, and a coach that asked a person's named adviser for
   * every one of them spent that person's coach's tokens on advice nobody read. The heartbeat waits
   * while the page is hidden and asks the moment it is seen again — the clock is the card room's,
   * and it is still running, which is the honest cost of walking away.
   */
  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /**
   * SAT OUT FOR NOT ANSWERING ⇒ THE COACH SWITCHES ITSELF OFF. Two turns timed out in a row is the
   * card room's own verdict that the person has gone, and a named adviser kept being consulted on
   * every turn until then. Switched off — not merely paused — so that a person who comes back finds
   * it off and presses "Tell me" on purpose; the panel says why. The house coach costs nothing, but
   * the rule is the same for it: a coach talking to an empty chair is noise.
   */
  const sitOutReason = viewerSeat != null ? players[(view?.seats ?? []).find((x) => x.seat === viewerSeat)?.playerId ?? '']?.sitOutReason : undefined;
  const [switchedOff, setSwitchedOff] = useState<string | null>(null);
  useEffect(() => {
    if (sitOutReason !== 'timeouts' || mode === 'off') return;
    chosen.current = true;
    setMode('off');
    hush();
    setSwitchedOff(adviser ? `You were sat out for not answering, so the coach is off — ${voiceName} is not asked while you are away. Press "Tell me" to switch it back on.` : 'You were sat out for not answering, so the coach is off. Press "Tell me" to switch it back on.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitOutReason]);
  // NOBODY HAS TOUCHED THE PAGE FOR TEN MINUTES ⇒ OFF, whichever mode. In play-for-me the coach would
  // otherwise keep acting for an empty chair — the seat stays active, the table keeps dealing, and every
  // turn asks the person's agent and its coach. The table stops counting those moves too (`auto`).
  const idle = useUserIdle();
  useEffect(() => {
    if (!idle || mode === 'off') return;
    chosen.current = true;
    setMode('off');
    hush();
    setSwitchedOff(`Nobody has touched the table for ten minutes, so the coach is off${adviser ? ` — ${voiceName} is not asked while you are away` : ''}. Press "Tell me" to switch it back on.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle]);

  /** PAUSE MEANS NOW: a voice partway through a sentence keeps talking otherwise, and from a chair
   *  that is not a pause, it is a request that gets around to being honoured. */
  useEffect(() => {
    if (paused) {
      hush();
      setCountdown(null);
    }
  }, [paused]);

  useEffect(() => {
    if (mode === 'off') {
      hush();
      setAdvice(null);
      setFeed([]);
      setCountdown(null);
      seen.current = logSeq;
    }
    return () => hush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (!session) return null;

  return (
    <section className={`panel coach${mode !== 'off' ? ' on' : ''}`}>
      <div className="coach-head">
        <h2>Coach</h2>
        <div className="coach-modes" role="group" aria-label="Coach">
        {(
          [
            ['off', 'Off'],
            ['watch', 'Tell me'],
            ['play', 'Play for me'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={`coach-mode${mode === m ? ' on' : ''}`}
            aria-pressed={mode === m}
            onClick={() => {
              // Switching it on is a real gesture, which is the moment a browser will let the voice
              // list load. Asking here means the first line is not the one that goes unheard.
              primeVoices();
              chosen.current = true;
              setMode(m);
              if (m !== 'off') setSwitchedOff(null);
              if (m === 'off') hush();
            }}
          >
            {label}
          </button>
        ))}
        </div>
      </div>
      {/* WHOSE VOICE, in one muted line — and where to change it. The panel used to say it three times. */}
      <p className="coach-who">
        {adviser ? (coach ? <><strong>{coach}</strong> via {adviser.displayName} · its tokens, never yours mid-hand</> : <><strong>{adviser.displayName}</strong> · no coach hired — the house answers</>) : <><strong>the house coach</strong> · one strategy for everybody, free</>}
      </p>

      {mode === 'off' ? (
        switchedOff ? (
          <p className="hint coach-off-why" role="status">{switchedOff}</p>
        ) : (
          <p className="hint">
            New to hold’em? It will say what everyone at the table is doing, name your move, and — the part nobody tells
            you — what a call costs against what it can win.
          </p>
        )
      ) : (
        <>
          {waiting ? (
            <div className={`coach-waiting ${waiting.what}`} role="status" aria-live="polite">
              <span className="coach-waiting-dot" aria-hidden="true" />
              <div>
                <strong>
                  {waiting.what === 'review' ? `Reviewing your recorded hands with ${waiting.who}…` : `Looking at your hand — asking ${waiting.who}…`}
                </strong>
                <span className="coach-waiting-clock">{Math.max(0, Math.round((now - waiting.since) / 1000))} s</span>
                <span className="hint">
                  {waiting.what === 'review'
                    ? `A review reads every hand on file and takes up to a minute.${mine ? ' The table is held while you wait.' : ' The table keeps going — your seat is still on the clock.'}`
                    : adviser
                      ? 'Your agent is consulting your coach. Ten to twenty seconds, then the move is yours — the clock is running.'
                      : 'The house coach answers in a moment.'}
                </span>
              </div>
            </div>
          ) : null}
          <p className="coach-now">
            {paused
              ? 'Paused. Nothing moves until you carry on.'
              : countdown != null
              ? `Playing in ${countdown}…`
              : myTurn
                ? advice
                  ? mode === 'watch'
                    ? 'Your move — press below when you are ready.'
                    : 'Your move.'
                  : missed > RETRIES
                    ? 'The card room is not answering. Play this one yourself, or switch me off and on.'
                    : waiting
                      ? 'Your turn.'
                      : 'Your turn. About to look at your hand…'
                : mode === 'play'
                  ? 'Playing your hand. Waiting for the other players.'
                  : 'Waiting for the other players.'}
          </p>

          {advice ? (
            <div className="coach-said">
              <p className="coach-say">{advice.say}</p>
              <p className="coach-why">{advice.because}</p>
              {/* NO BUTTON WITHOUT A MOVE BEHIND IT. An adviser may answer with words and no action —
                  the skill allows it, and a coach that only talks is a real coach. What must never
                  happen is a button for a move that does not exist: it sends nothing, the card room
                  has nothing to apply, and the clock runs out while the person waits for the press to
                  do something. Enough of those and the table sits them out. */}
              {!playable(advice.action) ? (
                <p className="hint">
                  {whoSaid(advice.source ?? 'house')} did not name a move here — play this one yourself.
                </p>
              ) : mode === 'watch' ? (
                // THE BUTTON NAMES THE MOVE, not "do that". At a poker table the difference between
                // calling 8 and raising to 24 is the whole decision, and a button that hid which one
                // it was about to make would be asking for blind consent.
                <button
                  type="button"
                  className="primary"
                  onClick={() => send({ type: 'act', handNo, action: advice.action } as ClientCommand)}
                >
                  {actionWords(advice.action, view?.legal ?? null)}
                </button>
              ) : (
                <p className="hint">It will {spokenAction(advice.action)}.</p>
              )}
            </div>
          ) : null}

        </>
      )}
    </section>
  );
}

/**
 * THE QUESTION BOX. Only for a named adviser: the house coach is a rule, and a rule has nothing to say
 * about "how am I playing" — it keeps no memory. Your own agent does: the card room records every
 * finished hand, as you saw it, to YOUR vault, and the coach you named reads them there under a grant
 * you signed. A question mid-hand goes the same way as advice (your agent consults the coach). The
 * REVIEW over past hands lives on the Ask tab under the coach card. Spends the coach's tokens, never your
 * agent's, and the panel says so.
 */
export function AskYourAgent({
  tableId,
  session,
  adviser,
  coach,
  onWaiting,
  onAnswer,
}: {
  tableId: string;
  session: AppSession;
  adviser: { agentName: string; displayName: string };
  /** The coaching service your agent consults, once an answer has named it. */
  coach: string | null;
  /** Say what is being waited for, loudly, in the panel above. */
  onWaiting: (w: { what: 'advice' | 'review'; who: string } | null) => void;
  onAnswer: (advice: CoachAdvice) => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<CoachAdvice | null>(null);
  const voice = coach ? `${coach}, via ${adviser.displayName}` : adviser.displayName;
  const ask = async (question: string) => {
    if (busy || !question.trim()) return;
    setBusy(true);
    setErr(null);
    onWaiting({ what: 'advice', who: voice });
    try {
      const a = await api.askAdviser(tableId, question.trim(), session.token);
      setAnswer(a);
      onAnswer(a);
      setQ('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : `${adviser.displayName} could not be reached.`);
    } finally {
      onWaiting(null);
      setBusy(false);
    }
  };
  return (
    <form
      className="coach-ask"
      onSubmit={(e) => {
        e.preventDefault();
        void ask(q);
      }}
    >
      <div className="coach-ask-row">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Ask ${adviser.displayName} anything about this table`}
          aria-label={`Ask ${adviser.displayName}`}
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !q.trim()}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </div>
      <div className="coach-ask-presets">
        <button type="button" className="link-button" disabled={busy} onClick={() => void ask('How do the other players at this table play? What have you noticed about each of them?')}>
          How do they play?
        </button>
        <span className="hint">Uses {coach ? `${coach}’s` : `${adviser.displayName}’s`} tokens — never yours mid-hand.</span>
      </div>
      {err ? <div className="form-error">{err}</div> : null}
      {answer ? (
        <div className="coach-ask-answer">
          <p className="coach-say">{answer.say}</p>
          {answer.because ? <p className="coach-why">{answer.because}</p> : null}
          <p className="hint">— {voice}</p>
        </div>
      ) : null}

    </form>
  );
}
