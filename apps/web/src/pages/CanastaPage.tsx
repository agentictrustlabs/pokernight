import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSession, ClientCommand } from '../lib/types';
import type { CanastaServerMessage } from '../lib/canastaSocket';
import { ApiError, api, costsTokens, type AgentListing } from '../lib/api';
import { tableSocketUrl } from '../lib/api';
import { TableSocket } from '../lib/tableSocket';
import {
  dismissCanastaError,
  dismissTookPile,
  initialCanastaState,
  reduceCanasta,
  seatOf,
  setCanastaConnection,
  type CanastaTableState,
} from '../lib/canastaSocket';
import { Identity } from '../components/Identity';
import { useLeaveTable } from '../lib/useLeaveTable';
import { Brand } from '../components/Brand';
import { clubHash } from '../lib/routes';
import { useClubScope } from '../lib/useClubScope';
import { HuddleAffordance } from '../components/huddle/ClubHuddleDock';
import { fillOutcome, seatsToFill, type FillPlan } from '../lib/fillSeats';
import { CanastaTable } from '../components/CanastaTable';
import { CanastaLog } from '../components/CanastaLog';
import { Coach, type CanastaArrangement } from '../components/Coach';
import { CanastaSide } from '../components/CanastaSide';
import { whoIsWho } from '../lib/whoIsWho';
import { SoundToggle } from '../components/SoundToggle';
import { canastaCue } from '../lib/cues';
import { useCues } from '../lib/useCues';
import { Toast } from '../components/Toast';
import { PracticePanel } from '../components/PracticePanel';
import { CoachQuestion } from '../components/CoachQuestion';
import type { AuthConfig } from '../lib/home';
import { PileReveal } from '../components/PileReveal';
import { RoundCurtain } from '../components/RoundCurtain';
import { curtainFor } from '../lib/roundEnd';

/**
 * The page for a canasta table.
 *
 * A SEPARATE PAGE, not a branch inside the poker one. The two games share the transport, the
 * session, the topbar and the log panel's shape, and share nothing else: no pot, no blinds, no
 * buy-in, no treasury, no settlement. `canastaGame.staked` is false and this page is what that
 * looks like from the front — there is no money on this screen because there is no money in this
 * game, and a page that branched would have carried poker's money furniture in disabled.
 */
export function CanastaPage({
  tableId,
  practice = false,
  session,
  config = null,
  onSignOut,
  onSetUp,
}: {
  tableId: string;
  /** The Home this card room trusts — where a coach is hired. */
  config?: AuthConfig | null;
  /**
   * Set the table up on arrival: take a seat, fill the other three, switch the coach on.
   *
   * THIS IS AN INTENT, NOT A FACT ABOUT THE TABLE, and the two used to be the same prop. It comes
   * from `?practice=1`, which is only ever on the link the "deal me in" button builds — doing this to
   * an ordinary table would be sitting somebody down at other people's game without asking.
   *
   * Whether the table IS yours is a different question with a different answer (`mine`, below), and
   * conflating them meant a bookmark to your own practice table — or a copied link, or a typed one —
   * opened a screen with no pause, no reset and no pace, and nothing saying why.
   */
  practice?: boolean;
  session: AppSession | null;
  onSignOut: () => void;
  /** Round the Home's connect ceremony again — the road to a coach for an agent that has none set up. */
  onSetUp?: () => void;
}) {
  const [state, setState] = useState<CanastaTableState>(initialCanastaState);
  const [tableName, setTableName] = useState<string | null>(null);
  /**
   * Whether this is YOUR practice table — asked of the table, not of the URL.
   *
   * The card room already answers it: `practiceFor` is on the view every one of these pages reads, and
   * the routes that reset, pause and pace a table check the same field. The screen was the only part
   * still taking the query string's word for it, so the controls appeared on the link that carried the
   * query and vanished on every other way of arriving at the same table.
   */
  const [mine, setMine] = useState(false);
  /** The club this table belongs to, if any — so the screen can say who can see it. */
  const [club, setClub] = useState<{ id: string; name: string } | null>(null);
  const clubScope_ = useClubScope(club, session?.token ?? null);
  /** How long each agent's move waits before it lands. Read from the table, changed by the slider. */
  const [pace, setPace] = useState(3500);
  /**
   * Whether the TABLE has told us its own pace yet.
   *
   * Until it has, `pace` is only this component's opening guess — and sending a guess is how the
   * setting got thrown away: arriving at your practice table posted 3500 over whatever you chose last
   * time, before the answer saying what you chose had come back. A control that quietly resets itself
   * every time you walk in is worse than one that does not work.
   */
  const [paceKnown, setPaceKnown] = useState(false);

  const sockRef = useRef<TableSocket<CanastaServerMessage> | null>(null);
  const token = session?.token ?? null;

  useEffect(() => {
    setState(initialCanastaState);
    const sock = new TableSocket<CanastaServerMessage>({
      url: tableSocketUrl(tableId, token),
      onMessage: (msg) => setState((s) => reduceCanasta(s, msg)),
      onStatus: (c) => setState((s) => setCanastaConnection(s, c)),
    });
    sockRef.current = sock;
    sock.connect();
    return () => {
      sock.close();
      if (sockRef.current === sock) sockRef.current = null;
    };
  }, [tableId, token]);

  useEffect(() => {
    let alive = true;
    // This table, not the lobby — a club's tables are not in the public list.
    api
      .getTable(tableId, token ?? undefined)
      .then((d) => {
        if (!alive) return;
        setTableName(d.name ?? null);
        setMine(d.practiceFor != null && d.practiceFor === session?.playerId);
        setClub(d.club && d.clubName ? { id: d.club, name: d.clubName } : null);
        if (typeof d.paceMs === 'number') setPace(d.paceMs);
        // Known either way: a table that reports no pace is one running the deployment's default, and
        // the slider may write to that from here on.
        setPaceKnown(true);
        setPaused(d.paused === true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tableId, token]);


  const send = useCallback((c: ClientCommand) => sockRef.current?.send(c), []);

  /**
   * Set a practice table up, once, on arrival.
   *
   * The four steps a person would otherwise do by hand — sit down, seat three agents, and switch the
   * coach on — which is the errand the practice table exists to remove. Guarded by a ref rather than
   * state so a re-render cannot do it twice, and it stops as soon as the seats are full.
   */
  /** Why pausing or dealing again did not happen. Both used to fail in silence. */
  const [tableErr, setTableErr] = useState<string | null>(null);
  /** What the coach card handed up — who advises, the commentary, the earlier advice — for the side panel. */
  const [arrangement, setArrangement] = useState<CanastaArrangement | null>(null);
  /** The coach service the person's agent consults for canasta, when one is hired — read once. */
  const [coachName, setCoachName] = useState<string | null>(null);
  useEffect(() => {
    if (!session || session.via === 'dev') return;
    let alive = true;
    api.coachStatus(session.token, 'canasta').then((r) => { if (alive) setCoachName(r.coach); }).catch(() => {});
    return () => { alive = false; };
  }, [session]);
  /** Whether the table is holding. Nothing moves while it is — clock, agents and next round alike. */
  const [paused, setPaused] = useState(false);
  const setUp = useRef(false);
  useEffect(() => {
    if (!practice || !session || setUp.current) return;
    const seats = state.view?.seats;
    if (!seats) return; // no view yet: nothing to set up against
    setUp.current = true;
    void (async () => {
      const taken = new Set(seats.map((s) => s.seat));
      const mySeatNow = seats.find((s) => s.playerId === state.playerId) ?? null;
      const seatIHave = mySeatNow?.seat ?? null;
      let free = [0, 1, 2, 3].filter((n) => !taken.has(n));
      if (seatIHave === null && free.length > 0) {
        send({ type: 'join', seat: free[0] as number, buyIn: 1 });
        free = free.slice(1);
      } else if (mySeatNow?.status === 'sitting-out') {
        // STILL YOUR CHAIR, but the table stopped dealing to you — a missed turn or a dropped
        // connection, from some session you have long forgotten. Pressing "deal me in" and being shown
        // a table that deals to everybody except you is the worst version of this screen, and sitting
        // back in is one of the chores the practice table exists to do for you.
        send({ type: 'sit-in' });
      }
      if (free.length === 0) return;
      try {
        // Rules-based only, for the same reason as the poker page: a practice table must not spend
        // language-model tokens on opponents nobody chose. (Today every canasta persona is rules-based;
        // the filter is what keeps that true if one is not.)
        const agents = (await api.listAgents('canasta')).agents.filter((a) => !costsTokens(a));
        for (let i = 0; i < Math.min(free.length, agents.length); i++) {
          await api.seatAgent(
            tableId,
            { seat: free[i] as number, buyIn: 1, agentName: (agents[i] as AgentListing).agentName, displayName: (agents[i] as AgentListing).displayName },
            session.token,
          );
        }
      } catch {
        // The seats stay empty and the panels below offer them by hand. A practice table that could
        // not fill itself is still a table.
      }
    })();
  }, [practice, send, session, state.playerId, state.view?.seats, tableId]);
  const onDismiss = useCallback(() => setState((s) => dismissCanastaError(s)), []);
  // Leaving takes you back to the room. It waits for the seat to actually go first.
  const { leaving, leave } = useLeaveTable(seatOf(state.view, state.playerId) != null, () => send({ type: 'leave' }));

  const mySeat = seatOf(state.view, state.playerId);

  // The same palette as the poker table: a card is the same card in both games, and a player moving
  // between them should not have to learn the room twice.
  useCues(state.log, (ev) => canastaCue(ev, mySeat));

  /** Seated and out of the deal. The one state with no way back until this page offered one. */
  const mySitOut = mySeat != null && state.view?.seats.find((s) => s.seat === mySeat)?.status === 'sitting-out';
  const seats = state.view?.seats ?? [];
  const empty = useMemo(() => {
    const taken = new Set(seats.map((s) => s.seat));
    return [0, 1, 2, 3].filter((i) => !taken.has(i));
  }, [seats]);

  const nameOf = useCallback(
    (seat: number) => {
      const s = state.view?.seats.find((x) => x.seat === seat);
      return (s ? state.names[s.playerId] : undefined) ?? `Seat ${seat + 1}`;
    },
    [state.view, state.names],
  );

  /* ------------------------------------------------------ the end of a round */

  /**
   * WHAT TO SAY WHEN IT ENDS, read off the view's own result rather than off an event.
   *
   * The result rides on the view and is cleared by the next round, which is exactly the property this
   * needs: there is nothing to remember and nothing to forget, and a reconnect mid-interval shows the
   * curtain again rather than skipping it.
   */
  const curtain = useMemo(
    () => curtainFor(state.view?.result ?? null, mySeat, state.view?.winner ?? null, nameOf),
    [state.view?.result, state.view?.winner, mySeat, nameOf],
  );
  /** Put aside, by round, so dismissing one round's curtain does not dismiss the next one's. */
  const [reviewed, setReviewed] = useState<number | null>(null);
  const roundNo = state.view?.roundNo ?? 0;
  const showCurtain = curtain != null && reviewed !== roundNo;

  /**
   * FREEZE THE TABLE WHEN THE ROUND ENDS — but only at a table where one person's pause is nobody
   * else's problem.
   *
   * Holding the table is the pause that already exists, and it holds the right things: the clock, the
   * other players and the next deal, together. Reusing it means a round-end review cannot drift out of
   * step with what a pause actually does.
   *
   * ONLY AT YOUR OWN PRACTICE TABLE. At a table with other people in it, one player wanting to study
   * the board must not stop three others from playing — so there the curtain is a screen of your own
   * and the table deals on its own schedule, which is the same reasoning as the pace slider's.
   */

  /**
   * HOLD OR RELEASE THE TABLE — one door, and requests go through it IN ORDER.
   *
   * Three things ask for this now: the freeze when a round ends, "deal the next round", and the pause
   * button. Two of them can happen within a few hundred milliseconds of each other — the freeze fires
   * on arrival at a table whose round has already ended, and a person can press "deal the next round"
   * before that request has landed. Fired independently they race, and the loser is whichever the
   * card room happens to receive last: the screen said running, the table said held, and the board sat
   * there until somebody reloaded.
   *
   * So the requests are CHAINED. The screen changes at once, which is right — it is saying what was
   * asked for — and the card room is told in the order it was asked.
   */
  const holdQueue = useRef<Promise<unknown>>(Promise.resolve());
  const setHeld = useCallback(
    (next: boolean) => {
      if (!session) return;
      setPaused(next);
      holdQueue.current = holdQueue.current
        .then(() => api.setPaused(tableId, next, session.token))
        .catch((e) => {
          // The toggle springing back with no word was the whole of the feedback, and from the outside
          // that is indistinguishable from a control that does not work.
          setPaused(!next);
          setTableErr(e instanceof ApiError ? e.message : `The table could not be ${next ? 'held' : 'restarted'}.`);
        });
    },
    [session, tableId],
  );

  const froze = useRef<number | null>(null);
  useEffect(() => {
    if (!mine || !session || !curtain) return;
    // ONCE PER ROUND, and spent the moment the curtain is first seen — including when the table was
    // ALREADY held. Marking it only on the freeze itself meant "Deal the next round" unpaused and this
    // effect, whose `curtain` does not go away until the next round actually starts, immediately froze
    // it again. From the outside the button did nothing.
    if (froze.current === roundNo) return;
    froze.current = roundNo;
    if (paused) return;
    setHeld(true);
    // `paused` is read but deliberately not a dependency: this runs when a ROUND ends, and re-running
    // it because the pause changed is exactly the loop described above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curtain, mine, roundNo, session, setHeld]);

  /** Let it go: put the curtain aside and start the table again. */
  const carryOn = useCallback(() => {
    setReviewed(roundNo);
    // NOT gated on `paused`. The freeze's own request may still be in flight, so "the screen does not
    // think it is held yet" is not the same as "there is nothing to release" — and the chain is what
    // makes asking anyway correct rather than a second racer.
    if (mine && session) setHeld(false);
  }, [mine, roundNo, session, setHeld]);

  return (
    <>
      <div className="topbar">
        <Brand />
        <span className="meta">
          <strong>{tableName ?? tableId}</strong>
          <span className="tag">canasta</span>
          {club ? (
            // WHICH GROUP CAN SEE THIS. A club's table is private to its members and an ordinary one
            // is not, and from the seat those looked identical. It links back to the club, because
            // the club is where the rest of its tables are.
            <a className="tag club" href={clubHash(club.id)} title={`Private to ${club.name}`}>
              {club.name}
            </a>
          ) : null}
          {/* THE CLUB'S HUDDLE, from the table too: start or join the club's call without leaving the cards. */}
          {club ? <HuddleAffordance scope={clubScope_} scopeName={club.name} compact /> : null}

          {state.view ? <span className="num">round #{state.view.roundNo}</span> : null}
        </span>
        <span className="spacer" />
        <span className="meta">
          <SoundToggle />
          <span className={`conn ${state.connection}`}>{state.connection}</span>
          {session ? <Identity session={session} onSignOut={onSignOut} /> : <a href="#/">sign in</a>}
        </span>
      </div>
      <div className="page table-page">
        <CanastaTable state={state} session={session} paused={paused} send={send} />
        {/* WHAT WAS IN THE PILE. Over the board, because the board is what it is explaining. */}
        {state.took ? <PileReveal took={state.took} onDismiss={() => setState((s) => dismissTookPile(s))} /> : null}
        {showCurtain && curtain ? (
          <RoundCurtain
            curtain={curtain}
            frozen={paused}
            /* Putting it aside leaves the table held, which is the point: the board is still the one
               the round ended on, and it is there to be read. */
            onReview={() => setReviewed(roundNo)}
            onContinue={curtain.scope === 'round' ? carryOn : undefined}
            /* Only whoever's table it is can deal a new game at it. */
            onNewGame={
              curtain.scope === 'game' && mine && session
                ? () => {
                    setReviewed(roundNo);
                    void api.resetPractice(tableId, session.token).catch(() => {});
                  }
                : undefined
            }
          />
        ) : null}
        <aside className="side">
          {/* Canasta is four-handed and partnered, so a seat is a choice of SIDE as well as a
              chair. The picker says which, because sitting down opposite your partner is the whole
              structure of the game and is not recoverable once the cards are out. FIRST while you
              are standing: it is the one thing to do. */}
          {session && mySeat == null ? (
            <section className="panel can-sit">
              <h2>Take a seat</h2>
              <p className="hint">
                Four players, two partnerships. Seats 1 and 3 play together, and so do 2 and 4.
              </p>
              <div className="can-seat-picker">
                {[0, 1, 2, 3].map((seat) => {
                  const taken = seats.find((s) => s.seat === seat);
                  return (
                    <button
                      key={seat}
                      type="button"
                      disabled={taken != null}
                      onClick={() => send({ type: 'join', seat, buyIn: 1 })}
                    >
                      Seat {seat + 1}
                      <span className="hint">{taken ? nameOf(seat) : seat % 2 === 0 ? 'with seat ' + (seat === 0 ? 3 : 1) : 'with seat ' + (seat === 1 ? 4 : 2)}</span>
                    </button>
                  );
                })}
              </div>
              {empty.length === 0 ? <p className="hint">Every seat is taken.</p> : null}
            </section>
          ) : null}
          {/* THE SEAT BAR: one line that is always on screen — which seat, whose side, sit back in if you
              were sat out, and LEAVE. "It is hard to find anything in the right pane" started with the
              leave button, three panels down. */}
          {mySeat != null ? (
            <div className={`seat-bar${mySitOut ? ' out' : ''}`} role="group" aria-label="Your seat">
              <span className="seat-bar-who">
                <strong>Seat {mySeat + 1}</strong> · with seat {((mySeat + 2) % 4) + 1}
                {mySitOut ? <span className="hint"> · sitting out{state.players[state.playerId ?? '']?.sitOutReason === 'disconnected' ? ' — your connection dropped' : ''}</span> : null}
              </span>
              {mySitOut ? <button type="button" className="primary" onClick={() => send({ type: 'sit-in' })}>Sit back in</button> : null}
              <button type="button" className="seat-bar-leave" disabled={leaving} onClick={leave}>
                {leaving ? 'Leaving…' : 'Leave the table'}
              </button>
            </div>
          ) : null}
          {/* THE COACH IS ABOUT THE TURN. Only offered to somebody actually holding a seat: there is
              nothing to advise a spectator about. Everything else it used to carry — the adviser picker,
              who's who, the commentary, the voice settings — is on the panel of tabs under it. */}
          {mySeat != null ? (
            <Coach
              tableId={tableId}
              session={session}
              myTurn={state.view?.toAct === mySeat && !state.view?.result}
              paused={paused}
              roundNo={state.view?.roundNo ?? 0}
              phase={state.view?.phase ?? 'draw'}
              log={state.log}
              logSeq={state.logSeq}
              view={state.view}
              viewerSeat={mySeat}
              scoreboard={state.view ? { scores: state.view.scores, target: state.view.target } : null}
              nameOf={nameOf}
              players={state.players}
              /* EVERY TABLE OPENS QUIET — "don't ask" — except your own practice table, which exists to be
                 talked through and opens in "ask every turn"; the same rule as hold'em's board. */
              startOn={mine ? 'watch' : 'off'}
              send={send}
              onArrangement={setArrangement}
            />
          ) : null}
          <CanastaSide
            tableId={tableId}
            session={session}
            config={config}
            arrangement={arrangement}
            roster={whoIsWho(state.view?.seats ?? [], nameOf, (playerId) => state.players[playerId], mySeat, arrangement?.adviser ?? null, coachName)}
            mine={mine}
            paused={paused}
            myTurn={state.view?.toAct === mySeat && !state.view?.result}
            onHold={setHeld}
            tableErr={tableErr}
            paceMs={paceKnown ? pace : null}
            coach={coachName}
            log={
              <CanastaLog
                log={state.log}
                nameOf={nameOf}
                live={state.view?.toAct != null && !state.view.result}
                canChat={session != null}
                onChat={(text) => send({ type: 'chat', text })}
              />
            }
            seat={
              mySeat != null ? (
                <div className="side-sub">
                  <h3>Your seat</h3>
                  <p className="hint">Seat {mySeat + 1}, playing with seat {((mySeat + 2) % 4) + 1}.{mySitOut ? ' You are sitting out, so the next round deals without you.' : ''}</p>
                  <div className="desk-row">
                    {mySitOut ? <button type="button" className="primary" onClick={() => send({ type: 'sit-in' })}>Sit back in</button> : null}
                    <button type="button" disabled={leaving} onClick={leave}>{leaving ? 'Leaving…' : 'Leave the table'}</button>
                  </div>
                </div>
              ) : (
                <p className="hint">You are watching. Take a seat above to play.</p>
              )
            }
            fillSeats={
              /* FILLING THE EMPTY SEATS is what makes canasta playable at all. Poker deals to two, so a
                 person with one friend has a game. Canasta needs exactly four. */
              session && empty.length > 0 ? <FillSeats tableId={tableId} session={session} empty={empty} mySeat={mySeat} /> : null
            }
          />
        </aside>
      </div>
      <Toast error={state.error} onDismiss={onDismiss} />
      {/* WANT A CANASTA COACH? Asked once, the first time a canasta table is opened — the hold'em question is
          asked on arrival; a coach knows one game, so each game asks for itself. */}
      <CoachQuestion session={session} config={config} game="canasta" onSetUp={onSetUp} />
    </>
  );
}


/**
 * Sit house players in the empty chairs — and decide who is on your side.
 *
 * ONE PRESS FILLS THE TABLE, because that is what somebody alone wants and seating three agents one
 * at a time is asking them to do it three times.
 *
 * BUT WHICH CHAIRS IS NOT AN ARBITRARY DETAIL. Canasta's partnerships are fixed by seat — 0 and 2
 * against 1 and 3 — so if a chair is being kept for a person who is on their way, whether it is the
 * one ACROSS from you or one BESIDE you decides whether the two of you play together against the
 * house or against each other. Filling the empty seats in order answers that by accident, which is
 * how two friends end up on opposite sides of a game they sat down to play together.
 *
 * So: fill everything and deal, or keep one chair and say whose. `lib/fillSeats.ts` is the plan and
 * the sentence; this is the buttons.
 *
 * Which AGENT goes in which chair is still not worth choosing — they are the same engine. The card
 * room resolves each one, fetches its card and refuses one that does not advertise this table's
 * game, so a seat that cannot play is refused here rather than timing out every turn.
 */
function FillSeats({ tableId, session, empty, mySeat }: { tableId: string; session: AppSession; empty: number[]; mySeat: number | null }) {
  const [agents, setAgents] = useState<AgentListing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listAgents('canasta')
      // Free players first. Filling takes from the top of the list, so the order IS the policy: a
      // rules-based agent costs nothing per turn and a language-model one costs tokens every turn,
      // and nobody pressing "fill the table" chose to spend them.
      .then((r) => alive && setAgents([...r.agents.filter((a) => !costsTokens(a)), ...r.agents.filter(costsTokens)]))
      .catch(() => alive && setAgents([]));
    return () => {
      alive = false;
    };
  }, []);

  if (agents != null && agents.length === 0) return null;

  const fill = async (plan: FillPlan) => {
    if (!agents || agents.length === 0 || busy) return;
    setBusy(true);
    setErr(null);
    // ONE AGENT PER SEAT, and never the same one twice: a table identifies an agent seat by the
    // agent's NAME, so seating the same persona in two chairs is seating the same player twice and
    // is refused. If there are fewer agents than chairs, the ones that can be filled are, and the
    // rest are said out loud rather than failing silently half-way.
    const wanted = seatsToFill(empty, mySeat, plan);
    const takeable = Math.min(wanted.length, agents.length);
    try {
      for (let i = 0; i < takeable; i++) {
        const agent = agents[i] as AgentListing;
        await api.seatAgent(
          tableId,
          // `buyIn` is the port's word for a stake. Canasta is played for score and has none, so it
          // is the smallest positive number the schema accepts and means nothing at this table.
          { seat: wanted[i] as number, buyIn: 1, agentName: agent.agentName, displayName: agent.displayName },
          session.token,
        );
      }
      if (takeable < wanted.length) {
        setErr(`Only ${takeable} of the ${wanted.length} chairs could be filled — this card room has ${agents.length} canasta players.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That seat was refused.');
    } finally {
      setBusy(false);
    }
  };

  const have = agents?.length ?? 0;
  // The choice only exists when there is a chair to keep AND a side to keep it on: somebody who has
  // not sat down has no "across from me", and one empty chair cannot be both filled and kept.
  const canChoose = mySeat !== null && empty.length > 1;

  return (
    <section className="panel can-fill">
      <h2>Play with the house</h2>
      <p className="hint">
        Canasta is four, in two partnerships — you and the player across from you, against the other two.{' '}
        {empty.length === 1 ? 'One chair is' : `${empty.length} chairs are`} empty.
      </p>
      {err ? <div className="form-error">{err}</div> : null}

      <button type="button" className="primary" disabled={busy || agents == null} onClick={() => void fill({ kind: 'all' })}>
        {busy ? 'Seating…' : empty.length === 1 ? 'Fill the chair and deal' : `Fill all ${empty.length} and deal`}
      </button>
      <p className="hint">{agents == null ? 'Reading the house players…' : fillOutcome(empty, mySeat, { kind: 'all' }, have)}</p>

      {/* KEEPING A CHAIR, and saying whose. This is the whole reason the panel is not one button:
          two friends who sit down to play TOGETHER and let the seats fill in order end up on
          opposite sides, and nothing on screen ever told them that was the choice being made. */}
      {canChoose ? (
        <details className="can-keep">
          <summary>Somebody else is coming</summary>
          <p className="hint">Keep a chair for them, and say which side they are on. The rest fill now.</p>
          <div className="row">
            <button type="button" disabled={busy || agents == null} onClick={() => void fill({ kind: 'keep-partner' })}>
              They play with me
            </button>
            <button type="button" disabled={busy || agents == null} onClick={() => void fill({ kind: 'keep-opponent' })}>
              They play against me
            </button>
          </div>
          {/* Deliberately says no side. Two buttons are on offer and the side is exactly what they
              choose between — a sentence describing one of them reads as a description of both. */}
          <p className="hint">
            {Math.min(empty.length - 1, have) === 1 ? 'One house player sits' : `${Math.min(empty.length - 1, have)} house players sit`} down and one chair
            is held. The round deals when somebody takes it.
          </p>
        </details>
      ) : null}
    </section>
  );
}
