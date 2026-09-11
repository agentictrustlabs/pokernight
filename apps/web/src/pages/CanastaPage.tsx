import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSession, ClientCommand } from '../lib/types';
import type { CanastaServerMessage } from '../lib/canastaSocket';
import { ApiError, api, type AgentListing } from '../lib/api';
import { tableSocketUrl } from '../lib/api';
import { TableSocket } from '../lib/tableSocket';
import {
  dismissCanastaError,
  initialCanastaState,
  reduceCanasta,
  seatOf,
  setCanastaConnection,
  type CanastaTableState,
} from '../lib/canastaSocket';
import { Identity } from '../components/Identity';
import { useLeaveTable } from '../lib/useLeaveTable';
import { PRODUCT_NAME } from '../lib/brand';
import { clubHash } from '../lib/routes';
import { fillOutcome, seatsToFill, type FillPlan } from '../lib/fillSeats';
import { CanastaTable } from '../components/CanastaTable';
import { CanastaLog } from '../components/CanastaLog';
import { Coach } from '../components/Coach';
import { SoundToggle } from '../components/SoundToggle';
import { canastaCue } from '../lib/cues';
import { useCues } from '../lib/useCues';
import { Toast } from '../components/Toast';

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
  onSignOut,
}: {
  tableId: string;
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
  /** How long each agent's move waits before it lands. Read from the table, changed by the slider. */
  const [pace, setPace] = useState(3500);
  const [paceErr, setPaceErr] = useState<string | null>(null);
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

  /**
   * SEND THE PACE ONCE THE DRAG SETTLES, and believe the answer.
   *
   * A range input fires on every step, so one drag sent eleven requests. They all succeeded and they
   * landed out of order — so the last one to arrive was not the last one sent, and the bar ended up
   * showing five seconds while the table was set to four point six. The control was lying, which is
   * worse than a control that does not work: you cannot tell the difference by looking.
   *
   * So: one request when the dragging stops, and the label takes the value the TABLE reports back
   * rather than the one the slider happens to be sitting on.
   */
  useEffect(() => {
    // Nothing is sent until the table has said what it is already set to. See `paceKnown`.
    if (!mine || !session || !paceKnown) return;
    const h = setTimeout(async () => {
      try {
        const { paceMs } = await api.setPace(tableId, pace, session.token);
        setPaceErr(null);
        // The table's answer wins. If it clamped or refused the number, the bar shows what is real.
        if (paceMs !== pace) setPace(paceMs);
      } catch {
        setPaceErr('not saved');
      }
    }, 350);
    return () => clearTimeout(h);
    // Only the value matters; re-running on identity changes would resend on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, pace, paceKnown, tableId]);

  const send = useCallback((c: ClientCommand) => sockRef.current?.send(c), []);

  /**
   * Set a practice table up, once, on arrival.
   *
   * The four steps a person would otherwise do by hand — sit down, seat three agents, and switch the
   * coach on — which is the errand the practice table exists to remove. Guarded by a ref rather than
   * state so a re-render cannot do it twice, and it stops as soon as the seats are full.
   */
  const [resetting, setResetting] = useState(false);
  /** Why pausing or dealing again did not happen. Both used to fail in silence. */
  const [tableErr, setTableErr] = useState<string | null>(null);
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
      const seatIHave = seats.find((s) => s.playerId === state.playerId)?.seat ?? null;
      let free = [0, 1, 2, 3].filter((n) => !taken.has(n));
      if (seatIHave === null && free.length > 0) {
        send({ type: 'join', seat: free[0] as number, buyIn: 1 });
        free = free.slice(1);
      }
      if (free.length === 0) return;
      try {
        const { agents } = await api.listAgents('canasta');
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

  return (
    <>
      <div className="topbar">
        <a className="brand" href="#/">
          {PRODUCT_NAME}
        </a>
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
        <aside className="side">
          {/* Canasta is four-handed and partnered, so a seat is a choice of SIDE as well as a
              chair. The picker says which, because sitting down opposite your partner is the whole
              structure of the game and is not recoverable once the cards are out. */}
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
          {/* THE COACH SITS ABOVE EVERYTHING ELSE while it is on, because when it is on it is the
              reason the person is at this table. Only offered to somebody actually holding a seat:
              there is nothing to advise a spectator about. */}
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
              /* At a practice table the coach IS the point, so it starts on rather than waiting to
                 be found. Anywhere else it stays off until somebody asks for it. */
              startOn={practice ? 'play' : 'off'}
              send={send}
            />
          ) : null}
          {/* FILLING THE EMPTY SEATS is what makes canasta playable at all.
              Poker deals to two, so a person with one friend has a game. Canasta needs exactly four,
              so without somebody to sit in the other chairs a person alone cannot play — which is
              why every canasta site worth using offers this and why it is not a nicety here. */}
          {session && empty.length > 0 ? (
            <FillSeats tableId={tableId} session={session} empty={empty} mySeat={mySeat} />
          ) : null}
          {mine && session ? (
            <section className="panel can-practice">
              <h2>Your practice table</h2>
              {tableErr ? <div className="form-error">{tableErr}</div> : null}
              <p className="hint">
                This one is yours and nobody else can see it. Leave whenever you like — it is still here next time.
              </p>
              {/* PAUSE, and mean it. Pausing the narration alone would leave the clock running and
                  the agents playing, so somebody who stopped to read would come back to a turn they
                  had already lost. This holds the clock, the agents and the next round together, and
                  resuming gives back exactly the time the pause took. */}
              <button
                type="button"
                className={paused ? 'primary' : ''}
                onClick={async () => {
                  const next = !paused;
                  setPaused(next);
                  setTableErr(null);
                  try {
                    await api.setPaused(tableId, next, session.token);
                  } catch (e) {
                    // The toggle springing back with no word was the whole of the feedback, and from
                    // the outside it is indistinguishable from a control that does not work.
                    setPaused(!next);
                    setTableErr(e instanceof ApiError ? e.message : `The table could not be ${next ? 'paused' : 'restarted'}.`);
                  }
                }}
              >
                {paused ? '▶ Carry on' : '⏸ Pause'}
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={async () => {
                  setResetting(true);
                  setTableErr(null);
                  try {
                    await api.resetPractice(tableId, session.token);
                  } catch (e) {
                    // "The board is the record" is true and is not an answer: a reset that was refused
                    // leaves the same board, so nothing on screen changes and nothing says why.
                    setTableErr(e instanceof ApiError ? e.message : 'The table could not be dealt again.');
                  } finally {
                    setResetting(false);
                  }
                }}
              >
                {resetting ? 'Dealing…' : 'Start a new game'}
              </button>
              {/* HOW FAST THE OTHERS PLAY. An agent answers in a couple of hundred milliseconds, so
                  the table's pace is entirely a choice about what a person can follow — and what
                  that is differs by person and changes as they learn. It is the table's own setting
                  because only at a practice table does one person's preference slow nobody else. */}
              <label className="pace">
                How fast the others play
                <input
                  type="range"
                  min={600}
                  max={6000}
                  step={200}
                  value={pace}
                  onChange={(e) => setPace(Number(e.target.value))}
                />
                <span className="hint">
                  {(pace / 1000).toFixed(1)} s a move
                  {paceErr ? <span className="form-error"> {paceErr}</span> : null}
                </span>
              </label>
            </section>
          ) : null}
          {mySeat != null ? (
            <section className="panel can-seated">
              <h2>Your seat</h2>
              <p className="hint">
                Seat {mySeat + 1}, playing with seat {((mySeat + 2) % 4) + 1}.
              </p>
              {/* A PLAYER MUST ALWAYS HAVE A WAY BACK IN. A dropped connection sits a seat out, which
                  is right — a vanished player should not hold up three others — but a table that
                  offers no way to undo it leaves somebody sat at a game they cannot rejoin. That is
                  exactly what happened here, and the reason is on screen rather than in a log. */}
              {mySitOut ? (
                <>
                  <p className="hint">
                    You are sitting out, so the next round deals without you.
                    {state.players[state.playerId ?? '']?.sitOutReason === 'disconnected'
                      ? ' Your connection dropped and the table carried on.'
                      : ''}
                  </p>
                  <button type="button" className="primary" onClick={() => send({ type: 'sit-in' })}>
                    Sit back in
                  </button>
                </>
              ) : null}
              <button type="button" disabled={leaving} onClick={leave}>
                {leaving ? 'Leaving…' : 'Leave the table'}
              </button>
            </section>
          ) : null}
          <CanastaLog
            log={state.log}
            nameOf={nameOf}
            live={state.view?.toAct != null && !state.view.result}
            canChat={session != null}
            onChat={(text) => send({ type: 'chat', text })}
          />
        </aside>
      </div>
      <Toast error={state.error} onDismiss={onDismiss} />
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
      .then((r) => alive && setAgents(r.agents))
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
