import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSession, ClientCommand } from '../lib/types';
import type { CanastaTableEvent, CanastaView } from '../lib/canasta';
import { ApiError, api, type CoachAdvice } from '../lib/api';
import { remember, whoSaid, type Recommendation } from '../lib/recommendations';
import { alertsFor, newAlerts } from '../lib/alerts';
import { commentaryFor, spokenLine } from '../lib/commentary';
import { roundOpening, scoreLines } from '../lib/scoreWords';
import { announce, canSpeak, hush, primeVoices, rate, say, setRate, setVoiceName, voiceName, voices } from '../lib/speech';

/**
 * Somebody to play your hand while you learn it, and tell you what is going on.
 *
 * Canasta's rules are the barrier, not its tactics: a beginner is not choosing badly between two
 * moves, they are missing the rule that says which moves exist. So the real output is the WORDS.
 *
 * IT NARRATES THE WHOLE TABLE, not only your turn. The first version spoke about the learner's own
 * move and nothing else — and since three of every four turns belong to somebody else, what that
 * produced was long silences broken by something sudden. "It sits for a while and then does
 * something. I have no idea what is going on." Watching the others is most of learning a card game;
 * this says what they did as they do it.
 *
 * AND IT SHOWS WHAT IT IS ABOUT TO DO. The pause between naming a move and playing it exists so you
 * can hear the reason, but an unexplained pause is just a hang. It counts down in front of you.
 *
 * Three settings: off, tell me (it explains, you press), play for me (it plays and talks).
 */
export type CoachMode = 'off' | 'watch' | 'play';

/** The first sentence of a longer explanation — what there is time to say between two moves. */
function firstSentence(text: string): string {
  const m = /^[^.!?]*[.!?]/.exec(text.trim());
  return (m ? m[0] : text).trim();
}

/** How long to let a move be read before playing it. Long enough to hear, short enough not to burn
 *  the turn clock. */
const READ_MS = 3200;
const FEED_LIMIT = 8;
/** How long to wait before asking again, and how many times. A moment, a few times — long enough
 *  for the table to catch up, short enough that a turn is not spent waiting. */
const RETRY_MS = 1200;
/**
 * How long to wait before asking, when nothing has gone wrong.
 *
 * Long enough for the table's answer to a move just played to have come back. MELDING DOES NOT END
 * A TURN — the round and the phase are both unchanged after one — so the moment the coach lays
 * something down it must ask again, and asking before the meld has landed would get advice about a
 * hand that no longer exists.
 */
const FIRST_ASK_MS = 900;
/** Generous: a turn clock is tens of seconds, and each try costs one small request. */
const RETRIES = 20;

interface Said {
  id: number;
  text: string;
}

export function Coach({
  tableId,
  session,
  myTurn,
  paused,
  roundNo,
  phase,
  log,
  logSeq,
  view,
  viewerSeat,
  scoreboard,
  nameOf,
  startOn = 'off',
  send,
}: {
  tableId: string;
  session: AppSession | null;
  myTurn: boolean;
  /** The table is holding. Nothing is said and nothing is played until it starts again. */
  paused: boolean;
  roundNo: number;
  phase: 'draw' | 'play';
  /** The table's events, which are what the commentary is made of. */
  log: readonly CanastaTableEvent[];
  /** How many have EVER arrived. The log is capped, so its length is not a position in a stream. */
  logSeq: number;
  /** The table as it stands, which is what the strategic warnings are read off. */
  view: CanastaView | null;
  viewerSeat: number | null;
  /** The running scores and the target, for the line that opens a round. */
  scoreboard: { scores: Record<number, number>; target: number } | null;
  nameOf: (seat: number) => string;
  /** What it starts as. `play` at a practice table, where coaching is the reason to be there. */
  startOn?: CoachMode;
  send: (c: ClientCommand) => void;
}) {
  const [mode, setMode] = useState<CoachMode>(startOn);
  const [advice, setAdvice] = useState<CoachAdvice | null>(null);
  /**
   * THE LAST FEW RECOMMENDATIONS, not just the current one.
   *
   * One line at a time is right for a voice and wrong for a screen: advice arrives per turn and a
   * person looks up between turns, wanting "what did it say about the pile again?" rather than only
   * the newest sentence. `lib/recommendations.ts` decides what it keeps and what it forgets.
   */
  const [said, setSaid] = useState<Recommendation[]>([]);
  /** The agent this person has named to advise them here, or null for the house's own coach. */
  const [adviser, setAdviser] = useState<{ agentName: string; displayName: string } | null>(null);
  const [feed, setFeed] = useState<Said[]>([]);
  /** Seconds left before it plays, so the pause is legible rather than a hang. */
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showVoice, setShowVoice] = useState(false);
  /** How many times the card room has said "not yet" for this turn. Drives the retry. */
  const [missed, setMissed] = useState(0);
  const asked = useRef<string>('');
  const seen = useRef(0);
  const nextId = useRef(0);
  const feedRef = useRef<HTMLUListElement | null>(null);
  /** The scoreboard as it stands, for the line that opens a round. Kept in a ref so reading it does
   *  not make the narration effect re-run and replay the log. */
  const viewOf = useRef<{ scores: Record<number, number>; target: number } | null>(null);
  viewOf.current = scoreboard;
  /** Which strategic warnings have already been said. A warning repeated every turn is noise. */
  const toldAbout = useRef(new Set<string>());
  const speaks = canSpeak();

  const push = useCallback((text: string) => {
    setFeed((f) => [...f, { id: nextId.current++, text }].slice(-FEED_LIMIT));
  }, []);

  /* ------------------------------------------ what everybody else is doing */

  /**
   * Everything on screen, and one SHORT line per event out loud, as it happens.
   *
   * Two versions of this have been wrong in opposite directions. Long per-event lines outran the
   * voice, so the queue dropped the oldest and a player heard only whatever came last. Then one
   * sentence per turn fixed the drops — and put the voice ten seconds behind the table, describing
   * a turn that had visibly ended while the next player was already moving.
   *
   * The constraint is arithmetic: agents are paced at about three seconds a move, so a spoken line
   * has to take less than that. `spokenLine` is a name, a verb and a card. Everything longer stays
   * on screen, where reading is not rate-limited.
   */
  useEffect(() => {
    if (mode === 'off') return;
    const fresh = Math.min(Math.max(0, logSeq - seen.current), log.length);
    for (let i = log.length - fresh; i < log.length; i++) {
      const ev = log[i] as CanastaTableEvent;
      const line = commentaryFor(ev, viewerSeat, nameOf);
      if (line) push(line.text);
      if (paused) continue;

      const team = viewerSeat == null ? null : ((viewerSeat % 2) as 0 | 1);
      const kind = (ev as { type: string }).type;

      // A ROUND ENDING IS AN ANNOUNCEMENT, not another line of commentary. It is four sentences into
      // a queue two deep, so as ordinary chatter three of them were evicted by whatever happened
      // next and a player heard the game end without ever hearing the score.
      if (kind === 'round-ended') {
        const result = (ev as { result?: unknown }).result;
        if (result) {
          const lines = scoreLines(result as never, team, nameOf, viewerSeat);
          for (const l of lines) push(l);
          announce(lines);
        }
        continue;
      }

      // …and so is a round beginning. It clears whatever the last one left unsaid, and says where
      // the game stands, which is the reason to care about the next twenty minutes.
      if (kind === 'round-started') {
        const v = viewOf.current;
        const opening = roundOpening((ev as { roundNo: number }).roundNo, v?.scores ?? { 0: 0, 1: 0 }, team, v?.target ?? 5000);
        push(opening);
        announce([opening]);
        continue;
      }

      if (kind === 'game-ended') {
        const won = (ev as { winner: 0 | 1 }).winner;
        const said = team === null ? 'That is the game.' : won === team ? 'That is the game. You win.' : 'That is the game. They win.';
        push(said);
        announce([said]);
        continue;
      }

      const short = spokenLine(ev, viewerSeat, nameOf);
      if (short) say(short);
    }
    seen.current = logSeq;
    // `nameOf` is rebuilt every render, so it cannot be a dependency without replaying the log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logSeq, mode]);

  /**
   * THE FEW MOMENTS WORTH INTERRUPTING FOR.
   *
   * A commentary that says what everybody did is a record. What a person learning needs on top of
   * it is the handful of moments where something is ABOUT to matter and they cannot yet see it —
   * the pile has grown into the biggest swing on the table, somebody is two cards from going out,
   * the stock is nearly gone. Those are the things a player at your shoulder leans over and says.
   *
   * Each fires once. A warning repeated every turn is noise, and noise is what gets a coach muted.
   */
  useEffect(() => {
    if (mode === 'off' || paused || !view) return;
    const fresh = newAlerts(alertsFor(view, viewerSeat, nameOf), toldAbout.current);
    for (const a of fresh) {
      toldAbout.current.add(a.key);
      push(a.text);
      say(a.text);
    }
    // `nameOf` is rebuilt every render; the view is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode, paused, viewerSeat]);

  /* ---------------------------------------------------- what YOU should do */

  const ask = useCallback(async () => {
    // A PAUSED TABLE IS NOT PLAYED, and the coach is the one thing that would otherwise carry on.
    // Pausing stops the agents and the clock, but a human's moves are still accepted — so a coach
    // that kept playing your hand kept the whole table moving, which is why a pause took a minute
    // to look like one.
    if (!session || !myTurn || mode === 'off' || paused) return;
    const key = `${roundNo}:${phase}`;
    asked.current = key;
    try {
      const a = await api.advice(tableId, session.token);
      setMissed(0);
      // The world moves while the coach thinks. An answer about a turn that has passed is worse
      // than no answer, because in `play` mode it would be PLAYED.
      if (asked.current !== key) return;
      setAdvice(a);
      setSaid((cur) => remember(cur, a, roundNo));
      // The narration says WHAT ("You meld 4 eights"); the coach says WHY — and only when there is a
      // why worth hearing. Drawing and discarding happen every turn and have their reason on screen;
      // reading it aloud each time doubled the words and put the voice further behind the table.
      const teaching = (a.action as { type?: string })?.type;
      // An adviser is not obliged to give a reason — the house coach always does, somebody's own
      // agent may just say the move. No reason is silence here rather than an empty utterance.
      if ((teaching === 'meld' || teaching === 'take-pile') && a.because) say(firstSentence(a.because));
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
          // The turn moved on while we were reading it out. That is ordinary — but DROPPING THE
          // MOVE here is what left the table sitting until the clock ran out, because nothing else
          // was ever going to try again. The heartbeat below picks it up instead.
          if (asked.current !== key) return;
          send({ type: 'act', handNo: roundNo, action: a.action } as ClientCommand);
          // Played. Whatever comes next is a new question, and until it is answered the heartbeat
          // is what keeps this seat from going quiet.
          setAdvice(null);
        }, READ_MS);
      }
    } catch {
      // A MISS IS NOT AN ENDING. The card room answers 404 while it does not yet agree that it is
      // this seat's turn, which happens for a moment on every turn the view learns about first. The
      // first version asked once and gave up, so one unlucky moment left the coach silent for the
      // rest of the round and the table looking hung. Counting the miss is what makes it retry.
      setAdvice(null);
      setMissed((n) => n + 1);
    }
  }, [mode, myTurn, paused, phase, roundNo, send, session, tableId]);

  // A new turn, or a new half of one, is a new question: forget the old answer and let the
  // heartbeat above ask. Asking HERE as well raced it and was the source of the stale keys.
  useEffect(() => {
    setAdvice(null);
    setCountdown(null);
    setMissed(0);
  }, [mode, myTurn, phase, roundNo]);

  /**
   * A HEARTBEAT while it is your turn and there is nothing to say.
   *
   * The coach is a mode, not a button pressed per move, so having nothing means asking again — not
   * sitting there. This used to run only after a refused request, which left every OTHER way of
   * ending up empty-handed as a table that paused until the clock ran down: a move dropped because
   * the turn key had moved on, a countdown that fired into a stale key, a request that landed while
   * the view was catching up.
   *
   * So it is unconditional now: your turn, no advice, nothing counting down — ask. Bounded by a
   * count so a table that will never answer is not hammered, and the count resets when the turn
   * changes, which is what makes it a heartbeat rather than a retry.
   *
   * THE CASE THAT MADE THIS NECESSARY: melding does not end a turn. Lay a meld down and the round
   * number and the phase are both exactly what they were, so every effect keyed on them stayed
   * silent — the coach melded once and then sat there until the clock ran out. Keying on "there is
   * no advice" instead is what catches it, because playing a move is what clears the advice.
   */
  useEffect(() => {
    if (mode === 'off' || paused || !myTurn || advice || countdown != null || missed > RETRIES) return;
    const h = setTimeout(() => void ask(), missed === 0 ? FIRST_ASK_MS : RETRY_MS);
    return () => clearTimeout(h);
  }, [advice, ask, countdown, missed, mode, myTurn, paused]);

  /**
   * PAUSE MEANS NOW.
   *
   * The table stops its clock and its agents the moment it is told, but a voice already partway
   * through a sentence — with more waiting behind it — kept talking. From a chair that is not a
   * pause; it is a request that gets around to being honoured.
   */
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

  const list = useMemo(() => (speaks ? voices() : []), [speaks, showVoice]);

  if (!session) return null;

  return (
    <section className={`panel coach${mode !== 'off' ? ' on' : ''}`}>
      {/* The heading SAYS which mode it is in. "Is it in a state of playing for me?" is a question
          nobody should have to ask of a control they just pressed, and a highlighted button was not
          answering it. */}
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
          New to canasta? It will play your hand, say what everyone at the table is doing, and name the rule behind
          each move.
        </p>
      ) : (
        <>
          {/* WHAT IS HAPPENING RIGHT NOW, always on screen — the answer to "it sits for a while". */}
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
              {mode === 'watch' ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => send({ type: 'act', handNo: roundNo, action: advice.action } as ClientCommand)}
                >
                  Do that
                </button>
              ) : null}
            </div>
          ) : null}

          {/* THE ROLLING LIST. Newest first, each line carrying whose advice it was — the house's coach
              and somebody's own agent are not the same voice, and an entry that lost its source would
              be the app quietly passing one off as the other. */}
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

          <Adviser tableId={tableId} session={session} adviser={adviser} onChanged={setAdviser} />

          {/* No `aria-live` on the feed: it is a running commentary, and a screen reader announcing
              every line of it would talk over the one thing that matters — whose turn it is. */}
          {/* Always rendered, even empty, so the panel has one height whether the table is quiet
              or busy. A feed that appeared with the first line moved everything beneath it. */}
          <ul className="coach-feed" ref={feedRef}>
            {feed.map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ul>

          {speaks ? (
            <details className="coach-voice" open={showVoice} onToggle={(e) => setShowVoice(e.currentTarget.open)}>
              <summary>Voice &amp; speed</summary>
              <label>
                Which voice
                <select
                  value={voiceName()}
                  onChange={(e) => {
                    setVoiceName(e.target.value);
                    say('This is the voice I will use.');
                  }}
                >
                  <option value="">Best this browser has</option>
                  {list.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Speed
                <input
                  type="range"
                  min={0.6}
                  max={1.2}
                  step={0.05}
                  defaultValue={rate()}
                  onChange={(e) => {
                    setRate(Number(e.target.value));
                    say('Speaking at this speed.');
                  }}
                />
              </label>
              <p className="hint">
                Browsers ship one flat default voice and better ones behind it. If this one is hard to follow, try
                another — the list is whatever your browser has.
              </p>
            </details>
          ) : (
            <p className="hint">This browser has no voice, so the coach is writing rather than talking.</p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * WHOSE ADVICE THIS IS — the house's coach, or an agent of the person's own.
 *
 * The card room's coach is one strategy and the same for everybody. A person's own agent carries
 * THEIR style, written as their own artifacts somewhere the card room never reaches; naming it here
 * says where to ask and nothing else.
 *
 * Folded, because the house coach is the right answer for almost everybody and a card table is not
 * the place to meet a configuration form. Open, it is one field.
 */
function Adviser({
  tableId,
  session,
  adviser,
  onChanged,
}: {
  tableId: string;
  session: AppSession;
  adviser: { agentName: string; displayName: string } | null;
  onChanged: (a: { agentName: string; displayName: string } | null) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <details className="coach-adviser">
      <summary>{adviser ? `Advised by ${adviser.displayName}` : 'Advised by the house coach'}</summary>
      <p className="hint">
        Name an agent of your own and it answers instead — with your style, from your own skills. It is sent only what
        your seat already sees.
      </p>
      {err ? <div className="form-error">{err}</div> : null}
      {adviser ? (
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await api.clearAdviser(tableId, session.token);
              onChanged(null);
            } catch (e) {
              setErr(e instanceof ApiError ? e.message : 'That could not be changed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Go back to the house coach
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            setErr(null);
            try {
              const r = await api.setAdviser(tableId, name.trim(), session.token);
              onChanged(r.adviser);
              setName('');
            } catch (ex) {
              // The card room refuses an agent that does not advertise the advise skill, by name —
              // and that sentence is far more use than "could not be saved".
              setErr(ex instanceof ApiError ? ex.message : 'That agent could not be reached.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Your agent
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="carol.me" autoComplete="off" />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Asking it…' : 'Ask this one instead'}
          </button>
        </form>
      )}
    </details>
  );
}
