import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSession, ClientCommand } from '../lib/types';
import { ApiError, api, tableSocketUrl } from '../lib/api';
import type { AuthConfig } from '../lib/home';
import type { TreasuryView } from '../lib/treasury';
import { seatLabel } from '../lib/format';
import { tableRate } from '../lib/money';

import { stakeStage } from '../lib/stake';
import { TableSocket, dismissError, initialState, reduce, setConnection, type TableState } from '../lib/tableSocket';
import { Identity } from '../components/Identity';
import { SettlementTag } from '../components/SettlementTag';
import { PRODUCT_NAME } from '../lib/brand';
import { clubHash } from '../lib/routes';
import { useClubScope } from '../lib/useClubScope';
import { HuddleAffordance } from '../components/huddle/ClubHuddleDock';
import { SoundToggle } from '../components/SoundToggle';
import { pokerCue } from '../lib/cues';
import { useCues } from '../lib/useCues';
import { OtherGame } from '../components/OtherGame';
import { Table } from '../components/Table';
import { drawsGame } from '../lib/games';
import { Toast } from '../components/Toast';
import { PokerCoach, type Arrangement } from '../components/PokerCoach';
import { useLeaveTable } from '../lib/useLeaveTable';
import { TableSide } from '../components/TableSide';
import { whoIsWho } from '../lib/whoIsWho';
import type { CoachStatus } from '../lib/api';
import { costsTokens, type AgentListing } from '../lib/api';

/**
 * The treasury view changes when money moves or the player acts, both of which this page knows about
 * already — so this poll only has to catch a settlement that landed elsewhere. Slower than the
 * settlement rows on purpose: reading it asks the player's HOME a question, and a table full of
 * people should not turn into a request per player per few seconds at somebody else's server.
 */
const TREASURY_POLL_MS = 15_000;

/**
 * What a learner is given at their own practice table. The top of the buy-in range rather than the
 * bottom: a beginner who busts in three hands has learnt nothing except that they busted, and this
 * table settles nothing, so there is no argument for keeping them short.
 */
const PRACTICE_STACK = 200;
/** Enough other players that position, folding and a multi-way pot all exist. Three is a real game. */
const PRACTICE_OPPONENTS = 3;

export function TablePage({
  tableId,
  practice = false,
  session,
  config,
  onSignOut,
}: {
  tableId: string;
  /**
   * Set the table up on arrival — a seat, the house players in the other chairs, the coach on.
   *
   * From `?practice=1`, which is only ever on the link the "deal me in" button builds. Deliberately
   * NOT "is this my practice table": a bookmark to your own table, or a link you typed, should open
   * the table you left rather than quietly reseating you and switching the coach back on.
   */
  practice?: boolean;
  session: AppSession | null;
  /** `GET /auth/config`, so the set-up card can send a player to their own Home and back. */
  config: AuthConfig | null;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<TableState>(initialState);
  const [tableName, setTableName] = useState<string | null>(null);
  /** The club this table belongs to, if any — so the screen can say who can see it. */
  const [club, setClub] = useState<{ id: string; name: string } | null>(null);
  const clubScope_ = useClubScope(club, session?.token ?? null);
  const [settlement, setSettlement] = useState<string>('play-money');
  /**
   * The rate THIS table pinned when it was created. Read off the table's own summary, never from
   * the deployment's current default — an older table settles at the rate it was opened with.
   */
  const [chipValue, setChipValue] = useState<string | null>(null);
  // What this table's money is CALLED, from the table's own pin. Two tables in one lobby can settle
  // in two different currencies, so the ticker is never a constant of the deployment.
  const [assetSymbol, setAssetSymbol] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
  /**
   * Whether this is YOUR OWN practice table — asked of the TABLE, not of the URL.
   *
   * `practice` is an intent that rides on one link and is gone the moment you navigate again;
   * `practiceFor` is a fact the card room keeps. The coach's default has to come from the fact: a
   * person who reached their own practice table from history, a bookmark or the back button is at the
   * table whose whole reason to exist is being taught, and they were getting a coach switched off.
   */
  const [mine, setMine] = useState(false);
  /** The table is held — read from the table on arrival, then owned by this page's one door. */
  const [paused, setPaused] = useState(false);
  /** What the coach is doing — shown on the BOARD beside the turn clock, not only in the side panel. */
  const [coachStatus, setCoachStatus] = useState<CoachStatus | null>(null);
  /** The arrangement the coach panel reports, for the desk beside it. */
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  /** The pace the table reported, or null until it has. */
  const [paceMs, setPaceMs] = useState<number | null>(null);
  const [holdErr, setHoldErr] = useState<string | null>(null);
  const sockRef = useRef<TableSocket | null>(null);
  const token = session?.token ?? null;
  const settles = settlement !== 'play-money';

  useEffect(() => {
    setState(initialState);
    const sock = new TableSocket({
      url: tableSocketUrl(tableId, token),
      onMessage: (msg) => setState((s) => reduce(s, msg)),
      onStatus: (c) => setState((s) => setConnection(s, c)),
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
    // THIS table, not the lobby. A club's tables are not in the public list, so reading the list
    // left a club table with no name, no settlement mode and no rate — the whole money identity of
    // the table missing, on the screen where money moves.
    api
      .getTable(tableId, token ?? undefined)
      .then((detail) => {
        if (!alive) return;
        setTableName(detail.name ?? null);
        setClub(detail.club && detail.clubName ? { id: detail.club, name: detail.clubName } : null);
        setMine(detail.practiceFor != null && detail.practiceFor === session?.playerId);
        setPaused(detail.paused === true);
        // Known either way: a table that reports no pace is one running the deployment's default.
        setPaceMs(typeof detail.paceMs === 'number' ? detail.paceMs : 2800);
        setSettlement(detail.settlement ?? 'play-money');
        setChipValue(detail.chipValue ?? null);
        setAssetSymbol(detail.assetSymbol ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tableId, token]);

  /**
   * The money side of this player, read HERE rather than inside a panel, because two different parts
   * of the page need the same answer: the seat picker (which refuses a seat it knows will be refused)
   * and the money panel (which offers the control that fixes it). One read, one truth.
   */
  const loadTreasury = useCallback(async () => {
    if (!token || !settles) return;
    try {
      setTreasury(await api.getTreasury(token));
    } catch {
      /* the panel shows its own failure; a seat gate that cannot read stays closed */
    }
  }, [settles, token]);

  useEffect(() => {
    if (!settles || !token) return;
    void loadTreasury();
    const h = setInterval(() => {
      if (!document.hidden) void loadTreasury();
    }, TREASURY_POLL_MS);
    return () => clearInterval(h);
  }, [loadTreasury, settles, token]);

  // Whether a settled seat would be allowed right now, from the one read above.
  const ready = stakeStage(treasury) === 'ready';

  /** The viewer's own seat. `viewerSeat` is the table's answer, so it is never inferred from a name. */
  const mySeat = state.view?.viewerSeat ?? null;
  /** The seat bar's own leave — the same hook the board's controls use; two buttons, one act. */
  const { leaving, leave } = useLeaveTable(mySeat != null, () => send({ type: 'leave' }));
  const meAtTable = mySeat != null ? state.view?.seats.find((x) => x.seat === mySeat) ?? null : null;

  /**
   * HOLD OR RELEASE THE TABLE — one door, requests in order. The screen changes at once (it is saying
   * what was asked for); the card room is told in the order it was asked, so two presses close
   * together cannot leave it holding the opposite opinion. Same shape as the canasta page's.
   */
  const holdQueue = useRef<Promise<unknown>>(Promise.resolve());
  const setHeld = useCallback(
    (next: boolean) => {
      if (!session) return;
      setPaused(next);
      setHoldErr(null);
      holdQueue.current = holdQueue.current
        .then(() => api.setPaused(tableId, next, session.token))
        .catch((e) => {
          setPaused(!next);
          setHoldErr(e instanceof ApiError ? e.message : `The table could not be ${next ? 'held' : 'restarted'}.`);
        });
    },
    [session, tableId],
  );

  const send = useCallback((c: ClientCommand) => sockRef.current?.send(c), []);
  const onDismiss = useCallback(() => setState((s) => dismissError(s)), []);

  /**
   * Set a practice table up, once, on arrival — the same errand canasta's page runs, and for the same
   * reason: sitting down, finding the house players and switching the coach on are three chores
   * between "deal me in" and a hand, and the practice table exists to remove them.
   *
   * Guarded by a ref rather than state so a re-render cannot do it twice, and it stops as soon as
   * somebody is seated, so re-opening a table you already sit at changes nothing.
   */
  const setUp = useRef(false);
  useEffect(() => {
    if (!practice || !session || setUp.current) return;
    const seats = state.view?.seats;
    if (!seats) return; // no view yet: nothing to set up against
    setUp.current = true;
    void (async () => {
      const cap = state.view?.config.seats ?? 6;
      const taken = new Set(seats.map((s) => s.seat));
      const mySeatNow = seats.find((s) => s.playerId === state.playerId) ?? null;
      let free = Array.from({ length: cap }, (_, n) => n).filter((n) => !taken.has(n));
      if (mySeatNow === null && free.length > 0) {
        send({ type: 'join', seat: free[0] as number, buyIn: PRACTICE_STACK });
        free = free.slice(1);
      } else if (mySeatNow?.status === 'sitting-out') {
        // STILL YOUR CHAIR, but the table stopped dealing to you — a missed turn or a dropped
        // connection from some session you have long forgotten. Pressing "deal me in" and being shown
        // a table that deals to everybody except you is the worst version of this screen.
        send({ type: 'sit-in' });
      }
      // AN OPPONENT ALREADY SEATED THAT COSTS TOKENS IS STOOD UP. Practice tables filled from the top
      // of the list before this rule existed, so an existing one has Deep Thought in a chair and is
      // calling a model every turn it plays. Standing it up here is what makes the rule true for the
      // tables already dealt, not only the next one — and it is a practice table, so nobody else's
      // game is being rearranged.
      const keep = new Set<string>();
      for (const s of seats) {
        const p = state.players[s.playerId];
        if (p?.kind !== 'agent') continue;
        if (p.agentKind && p.agentKind !== 'rules') {
          await api.unseatAgent(tableId, s.seat, session.token).catch(() => {});
          // The chair is NOT free yet: a seat left mid-hand comes free when the hand ends, so seating
          // into it now is refused as taken. The replacement goes into a chair that is actually empty.
        } else if (p.agentName) {
          keep.add(p.agentName);
        }
      }
      // How many opponents to add: up to the usual three, counting the free ones already here.
      const want = Math.max(0, PRACTICE_OPPONENTS - keep.size);
      if (free.length === 0 || want === 0) return;
      try {
        // RULES-BASED OPPONENTS ONLY. A practice table is for learning, and learning should not spend
        // language-model tokens on players nobody chose: the third name on the list is Claude-backed,
        // and filling from the top was calling a model once per turn, every hand, unasked. Somebody
        // who wants a language model at their table can seat one by hand, where it is labelled.
        // Never the same agent twice: a table names an agent seat by the agent, so seating one that is
        // already here is refused.
        const agents = (await api.listAgents('poker')).agents.filter((a) => !costsTokens(a) && !keep.has(a.agentName));
        let seated = 0;
        for (const seat of free) {
          if (seated >= want || seated >= agents.length) break;
          const agent = agents[seated] as AgentListing;
          try {
            await api.seatAgent(tableId, { seat, buyIn: PRACTICE_STACK, agentName: agent.agentName, displayName: agent.displayName }, session.token);
            seated += 1;
          } catch {
            // That chair was refused — taken between the view and the request, or not free after all.
            // Try the next chair with the same agent rather than giving up on the whole table.
          }
        }
      } catch {
        // The seats stay empty and the table's own panels offer them by hand. A practice table that
        // could not fill itself is still a table.
      }
    })();
  }, [practice, send, session, state.playerId, state.players, state.view?.config.seats, state.view?.seats, tableId]);

  const ctx = useMemo(() => {
    const bySeat = new Map<number, string>();
    const seatOfPlayer = new Map<string, number>();
    for (const s of state.view?.seats ?? []) {
      bySeat.set(s.seat, seatLabel(state.names[s.playerId], s.seat));
      seatOfPlayer.set(s.playerId, s.seat);
    }
    return {
      seatName: (seat: number) => bySeat.get(seat) ?? `Seat ${seat + 1}`,
      viewerSeat: state.view?.viewerSeat ?? null,
      seatOf: (playerId: string) => seatOfPlayer.get(playerId) ?? null,
    };
  }, [state.view, state.names]);

  /**
   * Whether this client can draw this table. The socket's own `welcome` says which game the table
   * deals, so this is known before any view is read and without racing the table list — and while
   * it is still unknown the page draws nothing rather than guessing at poker.
   */
  const drawable = drawsGame(state.game);

  // The table's own sounds. A card landing and chips going in are how a player knows what happened
  // without reading the log, which is what they are doing at a real table.
  useCues(state.log, (ev) => pokerCue(ev, state.view?.viewerSeat ?? null));

  return (
    <>
      <div className="topbar">
        <a className="brand" href="#/">
          {PRODUCT_NAME}
        </a>
        <span className="meta">
          <strong>{tableName ?? tableId}</strong>
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
          {/* The settlement mode travels with the table's NAME, so it is on screen from the moment
              the page opens and before anyone can reach a seat. */}
          <SettlementTag settlement={settlement} rate={tableRate(settlement, chipValue, assetSymbol)} withRate />
          {state.view?.hand ? <span className="num">hand #{state.view.hand.handNo}</span> : null}
        </span>
        <span className="spacer" />
        <span className="meta">
          <SoundToggle />
          <span className={`conn ${state.connection}`}>{state.connection}</span>
          {session ? <Identity session={session} onSignOut={onSignOut} /> : <a href="#/">sign in</a>}
        </span>
      </div>
      <div className="page table-page">
        {drawable ? (
          <div className="table-main">
            {/* THE HOLD IS SAID WHERE THE CARDS ARE, not only in the side column: a table that has
                stopped moving and says nothing about it looks broken. */}
            {paused ? <div className="held-banner">Paused. Nothing moves until you carry on.</div> : null}
            <Table state={state} session={session} send={send} settlement={settlement} chipValue={chipValue} assetSymbol={assetSymbol} treasury={treasury} coach={coachStatus} />
          </div>
        ) : (
          <OtherGame game={state.game ?? ''} tableName={tableName} />
        )}
        {/* The side is poker's too — a buy-in, a hand log, a stake to top up — so a table dealing
            something else shows the one panel that is true and none of the ones that are not. */}
        {drawable ? (
        <aside className="side">
          {/* THE SEAT BAR: one line that is always on screen — which seat, the stack, sit out or back in, and
              LEAVE. The board's controls row has a leave button too, under the action bar; at the top of the
              column it is the one people look for. */}
          {mySeat != null && meAtTable ? (
            <div className={`seat-bar${meAtTable.status === 'sitting-out' ? ' out' : ''}`} role="group" aria-label="Your seat">
              <span className="seat-bar-who">
                <strong>Seat {mySeat + 1}</strong> · <span className="num">{meAtTable.stack}</span> chips
                {meAtTable.status === 'sitting-out' ? <span className="hint"> · sitting out</span> : null}
              </span>
              {meAtTable.status === 'sitting-out'
                ? <button type="button" className="primary" onClick={() => send({ type: 'sit-in' })}>Sit back in</button>
                : <button type="button" onClick={() => send({ type: 'sit-out' })}>Sit out</button>}
              <button type="button" className="seat-bar-leave" disabled={leaving} onClick={leave}>
                {leaving ? 'Leaving…' : 'Leave table'}
              </button>
            </div>
          ) : null}
          {/* THE COACH IS FIRST, the same place canasta's is.
              It used to sit under the money panels and be rendered ONLY for somebody already holding a
              seat — so a person who arrived at a table and had not sat down yet, or who reached it by
              its own link rather than through "deal me in", saw no coach and nothing saying one
              existed. "I still don't see any coach stuff in the texas holdem table area." A teacher
              you have to already know about is not being offered. */}
          <PokerCoach
            tableId={tableId}
            session={session}
            view={state.view}
            viewerSeat={mySeat}
            myTurn={mySeat != null && state.view?.hand?.toAct === mySeat && !state.view?.hand?.result}
            handNo={state.view?.hand?.handNo ?? state.view?.handNo ?? 0}
            street={state.view?.hand?.street ?? null}
            log={state.log}
            logSeq={state.logSeq}
            ctx={ctx}
            players={state.players}
            paused={paused}
            /* A PLAY-MONEY TABLE OPENS IN "ASK EVERY TURN": it explains and leaves the move to you until you
               choose otherwise. A MONEY TABLE OPENS QUIET — "don't ask" — because a coach that spoke up on
               every turn of a settled game was a running commentary nobody asked for, and a named adviser's
               tokens spent on a game the person came to play themselves; "ask on demand" is one press away. */
            startOn={settles ? 'off' : 'watch'}
            mine={mine}
            onStatus={setCoachStatus}
            onArrangement={setArrangement}
            send={send}
          />
          {/* EVERYTHING ELSE, in one panel of tabs: what is being said, ask and review, people and
              coaches, the table and the money. The coach card above stays about the hand. */}
          <TableSide
            tableId={tableId}
            session={session}
            config={config}
            arrangement={arrangement}
            roster={whoIsWho(state.view?.seats ?? [], ctx.seatName, (playerId) => state.players[playerId], mySeat, arrangement?.adviser ?? null, arrangement?.coach ?? null)}
            mine={mine}
            paused={paused}
            myTurn={mySeat != null && state.view?.hand?.toAct === mySeat && !state.view?.hand?.result}
            onHold={setHeld}
            holdErr={holdErr}
            paceMs={paceMs}
            settles={settles}
            ready={ready}
            treasury={treasury}
            onTreasuryChanged={loadTreasury}
            settlement={settlement}
            chipValue={chipValue}
            assetSymbol={assetSymbol}
            log={state.log}
            ctx={ctx}
            canChat={session != null}
            onChat={(text) => send({ type: 'chat', text })}
          />
        </aside>
        ) : null}
      </div>
      <Toast error={state.error} onDismiss={onDismiss} />
    </>
  );
}
