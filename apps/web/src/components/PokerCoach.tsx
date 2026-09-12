import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSession, ClientCommand, HandResult, Street, TableEvent, TableView } from '../lib/types';
import { api, ApiError, type CoachAdvice, type CoachReview } from '../lib/api';
import { remember, whoSaid, type Recommendation } from '../lib/recommendations';
import { newAlerts } from '../lib/alerts';
import type { FormatContext } from '../lib/format';
import { actionWords, handEndLines, playable, pokerAlerts, pokerFeedLines, spokenAction, spokenPokerLine } from '../lib/pokerWords';
import { announce, canSpeak, hush, primeVoices, say } from '../lib/speech';
import { Adviser, type CoachMode } from './Coach';
import { WhoIsWhoPanel } from './WhoIsWho';
import { whoIsWho } from '../lib/whoIsWho';
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

interface Said {
  id: number;
  text: string;
}

/** The first sentence of a longer explanation — what there is time to say between two moves. */
function firstSentence(text: string): string {
  const m = /^[^.!?]*[.!?]/.exec(text.trim());
  return (m ? m[0] : text).trim();
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
  onHold,
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
  /** Hold or release the table (a practice table's owner only). A review holds it for as long as it takes. */
  onHold?: (held: boolean) => void;
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
      .then((r) => alive && setAdviser(r.adviser))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session, tableId]);
  const [feed, setFeed] = useState<Said[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [missed, setMissed] = useState(0);
  const asked = useRef<string>('');
  const seen = useRef(0);
  const nextId = useRef(0);
  const feedRef = useRef<HTMLUListElement | null>(null);
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
    // The house answers in a blink; a named adviser is a trip to your Home and your coach. Only that is
    // worth a stopwatch.
    if (adviser) setWaiting({ what: 'advice', who: voiceName, since: Date.now() });
    try {
      const a = await api.advice(tableId, session.token);
      setWaiting(null);
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
          if (playable(a.action)) send({ type: 'act', handNo, action: a.action } as ClientCommand);
          setAdvice(null);
        }, READ_MS);
      }
    } catch {
      // A MISS IS NOT AN ENDING. The card room answers 404 for the moment before it agrees it is this
      // seat's turn, which happens on most turns because the view learns first. Counting the miss is
      // what makes it retry instead of going quiet for the rest of the hand.
      setWaiting(null);
      setAdvice(null);
      setMissed((n) => n + 1);
    }
  }, [adviser, handNo, mode, myTurn, paused, send, session, street, tableId, voiceName]);

  // A new decision is a new question: forget the old answer and let the heartbeat ask.
  useEffect(() => {
    setAdvice(null);
    setCountdown(null);
    setMissed(0);
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
    if (mode === 'off' || paused || !myTurn || advice || countdown != null || missed > RETRIES) return;
    const h = setTimeout(() => void ask(), missed === 0 ? FIRST_ASK_MS : RETRY_MS);
    return () => clearTimeout(h);
  }, [advice, ask, countdown, missed, mode, myTurn, paused]);

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

  // Keep the newest line in view inside the feed's own box, never by moving the page.
  useEffect(() => {
    const box = feedRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [feed]);

  if (!session) return null;

  return (
    <section className={`panel coach${mode !== 'off' ? ' on' : ''}`}>
      <h2>
        {mode === 'play' ? 'Playing your hand' : mode === 'watch' ? 'Telling you what to do' : 'Teach me'}
        {mode !== 'off' ? <span className="coach-live">on</span> : null}
      </h2>
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
              if (m === 'off') hush();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'off' ? (
        <p className="hint">
          New to hold’em? It will say what everyone at the table is doing, name your move, and — the part nobody tells
          you — what a call costs against what it can win.
        </p>
      ) : (
        <>
          {waiting ? (
            <div className={`coach-waiting ${waiting.what}`} role="status" aria-live="polite">
              <span className="coach-waiting-dot" aria-hidden="true" />
              <div>
                <strong>
                  {waiting.what === 'review' ? `Reviewing your recorded hands with ${waiting.who}…` : `Asking ${waiting.who}…`}
                </strong>
                <span className="coach-waiting-clock">{Math.max(0, Math.round((now - waiting.since) / 1000))} s</span>
                <span className="hint">
                  {waiting.what === 'review'
                    ? `A review reads every hand on file and takes up to a minute.${mine ? ' The table is held while you wait.' : ' The table keeps going — your seat is still on the clock.'}`
                    : 'Your agent is consulting your coach. Ten to twenty seconds, then the move is yours.'}
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
                    : 'Your turn. Looking at your hand…'
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

          {/* THE ROLLING LIST. Newest first, each line carrying whose advice it was — the house coach
              and somebody's own agent are not the same voice. */}
          {said.length > 0 ? (
            <ol className="coach-said-list">
              {said.map((r) => (
                <li key={r.id}>
                  <span className="rec-say">{r.say}</span>
                  {r.because ? <span className="rec-why">{r.because}</span> : null}
                  <span className="rec-from">{whoSaid(r.from)}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {/* A QUESTION IN YOUR OWN WORDS, to your own agent — the one voice here that remembers how you
              and the others have been playing. "How am I playing?" is one press because it is the
              question a learner most needs answered and least knows to ask. Costs its tokens; said so. */}
          {adviser && session ? (
            <AskYourAgent
              tableId={tableId}
              session={session}
              adviser={adviser}
              coach={coach}
              myTurn={myTurn}
              mine={mine}
              paused={paused}
              onHold={onHold}
              onWaiting={(w) => setWaiting(w ? { ...w, since: Date.now() } : null)}
              onAnswer={(a) => { noteVoice(a); setSaid((cur) => remember(cur, a, handNo)); if (a.because) say(firstSentence(a.because)); }}
              onReview={noteVoice}
            />
          ) : null}

          <Adviser tableId={tableId} session={session} game="poker" adviser={adviser} onChanged={setAdviser} />

          <WhoIsWhoPanel
            roster={whoIsWho(
              view?.seats ?? [],
              ctx.seatName,
              (playerId) => players[playerId],
              viewerSeat,
              adviser,
              coach,
            )}
          />

          {/* No `aria-live`: it is a running commentary, and a screen reader announcing every line of
              it would talk over the one thing that matters — whose turn it is. Always rendered, even
              empty, so the panel has one height whether the table is quiet or busy. */}
          <ul className="coach-feed" ref={feedRef}>
            {feed.map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ul>

          {!speaks ? <p className="hint">This browser has no voice, so the coach is writing rather than talking.</p> : null}
        </>
      )}
    </section>
  );
}

/**
 * THE QUESTION BOX. Only for a named adviser: the house coach is a rule, and a rule has nothing to say
 * about "how am I playing" — it keeps no memory. Your own agent does: the card room records every
 * finished hand, as you saw it, to YOUR vault, and the coach you named reads them there under a grant
 * you signed. A question mid-hand goes the same way as advice (your agent consults the coach); "how
 * have I been playing" is a REVIEW — your question, forwarded, answered from the recorded hands in a
 * few short paragraphs. Both spend the coach's tokens, never your agent's, and the panel says so.
 */
function AskYourAgent({
  tableId,
  session,
  adviser,
  coach,
  myTurn,
  mine,
  paused,
  onHold,
  onWaiting,
  onAnswer,
  onReview,
}: {
  tableId: string;
  session: AppSession;
  adviser: { agentName: string; displayName: string };
  /** The coaching service your agent consults, once an answer has named it. */
  coach: string | null;
  myTurn: boolean;
  mine: boolean;
  paused: boolean;
  onHold?: (held: boolean) => void;
  /** Say what is being waited for, loudly, in the panel above. */
  onWaiting: (w: { what: 'advice' | 'review'; who: string } | null) => void;
  onAnswer: (advice: CoachAdvice) => void;
  onReview: (review: CoachReview) => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<CoachAdvice | null>(null);
  const [review, setReview] = useState<CoachReview | null>(null);
  const voice = coach ? `${coach}, via ${adviser.displayName}` : adviser.displayName;
  /**
   * A REVIEW TAKES A WHILE, AND THE CLOCK DOES NOT KNOW. At your own practice table the table is HELD
   * for the review (the same pause the round curtain uses) and released after — a person reading a
   * review of their play must not be folded by the turn clock while they read it. Anywhere else the
   * table cannot be held for one person, so a review is refused while it is your turn: ask between
   * hands.
   */
  const askReview = async (question: string) => {
    if (busy) return;
    if (myTurn && !mine) { setErr('A review takes a while and it is your turn — ask between hands.'); return; }
    setBusy(true);
    setErr(null);
    const heldForReview = mine && !paused && !!onHold;
    if (heldForReview) onHold!(true);
    onWaiting({ what: 'review', who: voice });
    try {
      const r = await api.reviewHands(tableId, question, session.token);
      setReview(r);
      onReview(r);
      setQ('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : `${adviser.displayName} could not review your hands.`);
    } finally {
      onWaiting(null);
      setBusy(false);
      // Released only if THIS review held it: a table the person paused themselves stays paused.
      if (heldForReview) onHold!(false);
    }
  };
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
        {/* A REVIEW, not a question mid-hand: it reads the hands recorded to your vault, so it is asked
            of the coach in its own time, and it takes a minute rather than a sentence. */}
        <button type="button" className="link-button" disabled={busy} title={mine ? 'Holds the table while the coach reads your recorded hands.' : 'Ask between hands — it takes a while.'} onClick={() => void askReview('How have I been playing? Name my two biggest leaks from my recorded hands, with the count behind each, and one thing to change next session.')}>
          Review my hands{mine ? ' (holds the table)' : ''}
        </button>
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
      {review ? (
        <div className="coach-ask-answer coach-review">
          {/* A review is paragraphs: the coach writes them with line breaks, and they are kept. */}
          <p className="coach-say" style={{ whiteSpace: 'pre-line' }}>{review.say}</p>
          {review.because ? <p className="coach-why">Next session: {review.because}</p> : null}
          <p className="hint">— {review.source?.coach ? `${review.source.coach}, via ${review.source.displayName}` : review.source?.displayName ?? adviser.displayName}, from your recorded hands</p>
        </div>
      ) : null}
    </form>
  );
}
