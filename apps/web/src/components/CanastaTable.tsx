import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { AppSession, ClientCommand } from '../lib/types';
import type { CanastaCard, CanastaLegal, CanastaView, ViewMeld } from '../lib/canasta';
import {
  checkSelection,
  groupHand,
  hasCanasta,
  openingMinimum,
  rankOf,
  seatRing,
  teamName,
  teamOf,
  primaryAction,
  turnLine,
  valueOf,
  whyNotTakePile,
} from '../lib/canasta';
import { seatBadge } from '../lib/commentary';
import { scoreSummary } from '../lib/scoreWords';
import type { CanastaTableState } from '../lib/canastaSocket';
import { seatOf } from '../lib/canastaSocket';
import { seatLabel, secondsLeft } from '../lib/format';
import { Card, CardSlot } from './Card';
import { CanastaHand } from './CanastaHand';

/**
 * A canasta table.
 *
 * LAID OUT LIKE THE REAL ONE. You sit at the bottom, your partner is across from you, and the two
 * opponents are to your left and right — because in a partnership game the single most important
 * fact on the table is who is on your side, and a row of four equal chips does not say it. Play
 * runs to your left, which is the seat drawn on the left, so the turn visibly travels round.
 *
 * The middle holds the two piles. Each partnership's melds sit in front of them, on their own half,
 * which is where they are on a real table and is what makes "what have they got down?" answerable at
 * a glance rather than by reading a list.
 *
 * THE TABLE IS DIRECTLY MANIPULABLE. The stock is a button that draws, the discard pile is a button
 * that takes it, and each of your own melds is a button that adds what you have picked up. The row
 * of controls underneath is the same moves said in words, for anybody who would rather read them.
 *
 * THE ONE RULE A NEWCOMER TRIPS ON is that a turn has two halves: you must draw or take the pile
 * before you may meld or discard. So the controls are numbered, only one half is ever live, and the
 * line at the top says which half it is.
 *
 * Nothing here decides legality. The board says what it believes and the engine says what is so;
 * when the two disagree, the engine's refusal is what the player reads.
 */
export function CanastaTable({
  state,
  session,
  paused = false,
  send,
}: {
  state: CanastaTableState;
  session: AppSession | null;
  /** The table is holding: no clock, no agents, no next round. */
  paused?: boolean;
  send: (c: ClientCommand) => void;
}) {
  const view = state.view;
  const [picked, setPicked] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const mySeat = seatOf(view, state.playerId);
  const hand = useMemo(() => (view?.hand ? [...view.hand] : []), [view?.hand]);
  const roundNo = view?.roundNo ?? 0;
  const handKey = hand.join(',');

  // A new round, a new turn, or a hand that changed under us: the selection is about cards that may
  // no longer be there, so it goes. Keeping it is how a player discards a card they did not mean to.
  useEffect(() => setPicked([]), [roundNo, view?.toAct, view?.phase, handKey]);

  useEffect(() => {
    if (view?.actionDeadline == null) return;
    const h = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(h);
  }, [view?.actionDeadline]);

  /**
   * WHAT EACH PLAYER JUST DID, on their own plate.
   *
   * Cards moving is not enough to see a move: three agents take a whole round of turns quickly, and
   * a count going from eleven to twelve says nothing about what happened. The badge is the same
   * thing the commentary says, put where you are already looking — at the person who did it.
   *
   * Only the LAST thing each seat did, and it is replaced rather than accumulated: a table showing
   * everybody's history is a log, and there is one of those already.
   */
  /**
   * Which melds just changed, so a new one is SEEN arriving rather than found already there.
   *
   * Poker shows you the action — cards fly out, the board flips, a badge says what somebody did.
   * Canasta showed you the result and nothing else: a meld was simply present on the next frame.
   * This marks whatever grew since the last render and lets it fade back over a second or so.
   */
  const sizes = useRef(new Map<string, number>());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!view) return;
    const now = new Map<string, number>();
    const grew = new Set<string>();
    for (const team of [0, 1] as const) {
      for (const m of view.melds[team]) {
        const key = `${team}:${m.rank}`;
        now.set(key, m.cards.length);
        const was = sizes.current.get(key);
        if (was === undefined || m.cards.length > was) grew.add(key);
      }
    }
    const first = sizes.current.size === 0;
    sizes.current = now;
    // The first view is not a change — everything on the table would flash at once.
    if (first || grew.size === 0) return;
    setFresh(grew);
    const h = setTimeout(() => setFresh(new Set()), 1400);
    return () => clearTimeout(h);
  }, [view]);

  /**
   * What is being dragged, and what it is over.
   *
   * DECLARED HERE, above the early return below. Every hook has to run on every render — React
   * counts them — so a `useState` placed after `if (!view) return …` crashes the whole page the
   * moment a view arrives. It cost the canasta table a white screen.
   */
  const [dragging, setDragging] = useState<CanastaCard[] | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /** Where the pointer is, so the cards being dragged follow it. */
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  /**
   * PRESS, MOVE, RELEASE — the whole drag, in pointer events.
   *
   * Not HTML5 drag-and-drop: that does not exist on a touchscreen and cannot be driven by an
   * ordinary mouse press even where it does, so a card game built on it works for some people and
   * silently does nothing for others.
   *
   * A press that does not move is a CLICK and selects the card, which is what the buttons below
   * already worked with. A press that moves far enough becomes a drag, and where it is released
   * decides the move: your own tableau lays the cards down, one of your melds adds to it, the
   * discard pile throws the card. Anything else puts them back.
   *
   * DECLARED HERE, above the early return. Every hook has to run on every render — React counts
   * them — so one placed after `if (!view) return …` crashes the page the moment a view arrives.
   * What the drop actually does lives in a ref that the render below keeps up to date, because the
   * listeners are registered once and the game changes underneath them.
   */
  const drag = useRef<{ from: number; x: number; y: number; cards: CanastaCard[]; live: boolean } | null>(null);
  const drop = useRef<{ meld: (cards: CanastaCard[], rank?: string) => void; discard: (cards: CanastaCard[]) => void } | null>(null);

  useEffect(() => {
    /** Far enough that it was meant as a drag rather than a press that wobbled. */
    const THRESHOLD = 8;
    const targetAt = (x: number, y: number): string | null =>
      document.elementFromPoint(x, y)?.closest('[data-drop]')?.getAttribute('data-drop') ?? null;

    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.live && Math.hypot(e.clientX - d.x, e.clientY - d.y) < THRESHOLD) return;
      if (!d.live) {
        d.live = true;
        setPicked((cur) => (cur.includes(d.from) ? cur : [d.from]));
        setDragging(d.cards);
      }
      setPoint({ x: e.clientX, y: e.clientY });
      setOver(targetAt(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d?.live) return;
      setDragging(null);
      setPoint(null);
      setOver(null);
      const where = targetAt(e.clientX, e.clientY);
      const on = drop.current;
      if (!where || !on) return;
      if (where === 'discard') return on.discard(d.cards);
      if (where === 'meld') return on.meld(d.cards);
      if (where.startsWith('meld:')) return on.meld(d.cards, where.slice('meld:'.length));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    return () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
  }, []);

  const lastMove = useMemo(() => {
    const by = new Map<number, string>();
    for (const ev of state.log) {
      const badge = seatBadge(ev);
      if (badge) by.set(badge.seat, badge.text);
    }
    return by;
  }, [state.log]);

  const nameOf = (seat: number) => {
    const s = view?.seats.find((x) => x.seat === seat);
    return seatLabel(s ? state.names[s.playerId] : undefined, seat);
  };

  if (!view) return <div className="panel hint">Connecting to the table…</div>;

  const myTurn = mySeat != null && view.toAct === mySeat && !view.result;
  const legal = state.turn?.seat === mySeat ? state.turn.legal : null;
  const groups = groupHand(hand);
  const flat = groups.flatMap((g) => g.cards);
  const selection = picked.map((i) => flat[i]).filter((c): c is CanastaCard => c != null);
  const myTeam = mySeat == null ? null : teamOf(mySeat);
  const ring = seatRing(mySeat);

  const existingRanks = myTeam == null ? [] : view.melds[myTeam].map((m) => m.rank as string);

  const act = (action: unknown) => {
    send({ type: 'act', handNo: view.roundNo, action } as ClientCommand);
    setPicked([]);
  };

  const toggle = (i: number) => setPicked((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));

  /**
   * Lay the cards down on your own side, or add them to one meld.
   *
   * Dropping onto a meld of a DIFFERENT rank is not a mistake to be refused — it is somebody
   * aiming at their own side of the table and hitting a card. Their sevens become a sevens meld
   * beside the kings they landed on, which is what they meant. Only a rank that matches is treated
   * as "add to this one".
   */
  const dropMeld = (cards: CanastaCard[], rank?: string) => {
    if (!myTurn || view.phase !== 'play' || cards.length === 0) return;
    const ok = checkSelection(cards, existingRanks);
    if (rank && ok.ok && ok.rank === rank) return act({ type: 'meld', melds: [{ rank, cards }] });
    if (ok.ok) return act({ type: 'meld', melds: [{ rank: ok.rank, cards }] });
    // A handful that is not a meld on its own, dropped onto a meld it could join.
    if (rank) act({ type: 'meld', melds: [{ rank, cards }] });
  };

  /** Throw one card and end the turn. A discard is one card, so a handful is not a discard. */
  const dropDiscard = (cards: CanastaCard[]) => {
    if (!myTurn || view.phase !== 'play' || cards.length !== 1) return;
    const one = cards[0] as CanastaCard;
    if (one[0] === '3' && (one[1] === 'H' || one[1] === 'D')) return;
    act({ type: 'discard', card: one });
  };
  // The listeners were registered once; this is how they reach the game as it stands now.
  drop.current = { meld: dropMeld, discard: dropDiscard };

  /** A card has been pressed. Moving far enough turns it into a drag; not moving is a click. */
  const onCardDown = (i: number, e: React.PointerEvent) => {
    if (!myTurn) return;
    const card = flat[i];
    if (!card) return;
    // Pressing a card that is ALREADY picked takes the whole selection — three sevens go to the
    // table together, which is what somebody doing it with their hands would do.
    drag.current = {
      from: i,
      x: e.clientX,
      y: e.clientY,
      cards: picked.includes(i) && selection.length > 0 ? selection : [card],
      live: false,
    };
  };


  /** Pick every card of one rank at once. A canasta hand runs long and picking four sevens singly is work. */
  const pickRank = (rank: string) =>
    setPicked((cur) => {
      const idx = flat.map((c, i) => [c, i] as const).filter(([c]) => rankOf(c) === rank).map(([, i]) => i);
      const all = idx.every((i) => cur.includes(i));
      return all ? cur.filter((i) => !idx.includes(i)) : [...new Set([...cur, ...idx])];
    });

  const check = checkSelection(selection, existingRanks);
  const topRank = view.pileTop ? rankOf(view.pileTop) : null;
  const takeCheck = view.pileTop ? checkSelection([...selection, view.pileTop], existingRanks) : null;
  const canTake = myTurn && view.phase === 'draw' && legal?.canTakePile === true && takeCheck?.ok === true && topRank != null;
  /**
   * WHY IT WILL NOT COME, when it will not.
   *
   * Two gates guard this button and only one of them ever spoke. The engine refuses with its own
   * words; the table's own check — your selected cards plus the top card have to make a meld — had
   * none on screen at all, so the ordinary case (the pile is takeable, you simply have not chosen
   * your cards) was a dead button with an empty tooltip.
   */
  const takeWhy =
    myTurn && view.phase === 'draw'
      ? whyNotTakePile({
          canTakePile: legal?.canTakePile === true,
          takePileReason: legal?.takePileReason ?? null,
          pileTop: view.pileTop ?? null,
          selection,
          existingRanks,
        })
      : null;
  const canDraw = myTurn && view.phase === 'draw' && legal?.canDraw === true;
  const opened = existingRanks.length > 0;
  const minimum = myTeam == null ? 0 : openingMinimum(view.scores[myTeam]);
  const meldShort = !opened && check.ok && check.value < minimum;
  const canMeld = myTurn && view.phase === 'play' && check.ok && !meldShort;

  const onDraw = () => canDraw && act({ type: 'draw' });
  const onTake = () => canTake && act({ type: 'take-pile', meld: { rank: topRank, cards: selection } });
  const onMeld = () => canMeld && check.ok && act({ type: 'meld', melds: [{ rank: check.rank, cards: selection }] });

  return (
    <div className="table-main canasta">
      <CanastaStatus view={view} viewerSeat={mySeat} nameOf={nameOf} now={now} paused={paused} />

      {view.result ? <RoundResult view={view} viewerSeat={mySeat} nameOf={nameOf} /> : null}

      <div className="can-arena">
        <div className="can-felt">
          <SeatPlate where="north" seat={ring.north} view={view} viewerSeat={mySeat} nameOf={nameOf} now={now} did={lastMove.get(ring.north)} />
          <SeatPlate where="west" seat={ring.west} view={view} viewerSeat={mySeat} nameOf={nameOf} now={now} did={lastMove.get(ring.west)} />
          <SeatPlate where="east" seat={ring.east} view={view} viewerSeat={mySeat} nameOf={nameOf} now={now} did={lastMove.get(ring.east)} />
          {/* THE SOUTH SEAT IS DRAWN TOO, FOR A SPECTATOR.
              A player sees their own seat below the felt with their hand in it, so the south slot on
              the felt is theirs and stays empty. A spectator has no seat and no hand — and without
              this, the player in the south chair was simply not on the table. One of four people
              invisible is not a smaller bug than a crash; it is a quieter one. */}
          {mySeat == null ? (
            <SeatPlate where="south" seat={ring.south} view={view} viewerSeat={mySeat} nameOf={nameOf} now={now} did={lastMove.get(ring.south)} />
          ) : null}

          <div className="can-piles">
            <button type="button" className="can-pile stock" disabled={!canDraw} onClick={onDraw} title={canDraw ? 'Draw a card' : undefined}>
              <span className="lbl">Stock</span>
              {view.stock > 0 ? <Card key={view.stock} size="md" enter="deal" /> : <CardSlot size="md" />}
              <span className="num">{view.stock}</span>
            </button>
            <button
              type="button"
              className={`can-pile discard${view.frozen ? ' frozen' : ''}${over === 'discard' ? ' over' : ''}${dragging?.length === 1 ? ' accepts' : ''}`}
              data-drop="discard"
              disabled={!canTake}
              onClick={onTake}
              title={canTake ? 'Take the pile with the cards you have picked' : (takeWhy ?? undefined)}
            >
              <span className="lbl">Discard</span>
              {/* KEYED ON THE CARD, so React remounts it when somebody throws — and the deal
                  animation runs. Without it the top card simply becomes a different card between
                  two frames, which is the whole reason another player's turn was invisible. */}
              {view.pileTop ? (
                <Card key={`${view.pileTop}-${view.pileSize}`} card={view.pileTop} size="md" enter="deal" />
              ) : (
                <CardSlot size="md" />
              )}
              <span className="num">{view.pileSize}</span>
            </button>
          </div>
          {/* A frozen pile is the single most consequential fact on the table and the one a newcomer
              cannot see. It sits under the piles, in the pile's own colour, not in a legend. */}
          {view.frozen ? <p className="can-frozen">Frozen — only two natural cards of the top rank can take it</p> : null}

          {/* The two tableaux share the width equally. They are the two sides of one table and a
              glance has to compare them; giving one of them two thirds makes that a harder read. */}
          <div className="can-tableaux">
            <Tableau
              over={over}
              dragging={dragging != null}
              where="ours"
              team={myTeam ?? 0}
              view={view}
              viewerSeat={mySeat}
              /* Your own melds are where the selection goes when you press one. */
              onAdd={myTeam != null && myTurn && view.phase === 'play' ? (rank) => act({ type: 'meld', melds: [{ rank, cards: selection }] }) : null}
              addable={selection.length > 0}
              fresh={fresh}
            />
            <Tableau where="theirs" team={myTeam == null ? 1 : (((myTeam + 1) % 2) as 0 | 1)} view={view} viewerSeat={mySeat} onAdd={null} addable={false} fresh={fresh} />
          </div>
        </div>
      </div>

      {mySeat == null ? (
        <p className="hint can-spectating">
          {session ? 'You are watching. Take a seat to play.' : 'You are watching. Sign in to take a seat.'}
        </p>
      ) : (
        <>
          <div className="can-you">
            <span className="cs-name">{nameOf(mySeat)}</span>
            <span className="cs-team">you · seat {mySeat + 1}</span>
            {view.toAct === mySeat && !view.result ? <span className="tag turn-tag">your turn</span> : null}
          </div>
          <CanastaHand groups={groups} selected={picked} onToggle={toggle} onPickRank={pickRank} onCardDown={onCardDown} disabled={!myTurn} />
          {/* The cards in the air, following the pointer. Purely a picture: what is actually being
              dragged lives in a ref, and where it lands is decided by what is under the pointer. */}
          {dragging && point ? (
            <div className="can-ghost" style={{ left: point.x, top: point.y }} aria-hidden="true">
              {dragging.map((c, i) => (
                <Card key={`${c}-${i}`} card={c} size="md" />
              ))}
            </div>
          ) : null}
          <Controls
            view={view}
            legal={legal}
            myTurn={myTurn}
            selection={selection}
            check={check}
            meldShort={meldShort}
            minimum={minimum}
            canDraw={canDraw}
            canTake={canTake}
            canMeld={canMeld}
            takeWhy={takeWhy}
            onDraw={onDraw}
            onTake={onTake}
            onMeld={onMeld}
            onDiscard={() => act({ type: 'discard', card: selection[0] })}
            onClear={() => setPicked([])}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the head */

function CanastaStatus({
  view,
  viewerSeat,
  nameOf,
  now,
  paused,
}: {
  view: CanastaView;
  viewerSeat: number | null;
  nameOf: (seat: number) => string;
  now: number;
  paused: boolean;
}) {
  // A stopped clock with no explanation looks exactly like a hang, which is the thing this table
  // has been mistaken for more than once.
  const secs = paused || view.actionDeadline == null || view.result ? null : secondsLeft(view.actionDeadline, now);
  return (
    <div className="can-status panel">
      <div className="can-turn">
        <strong>{paused ? 'Paused. Nothing moves until you carry on.' : turnLine(view, viewerSeat, nameOf)}</strong>
        {secs != null ? <span className={`clock num${secs <= 5 ? ' red' : secs <= 10 ? ' amber' : ''}`}>{secs}s</span> : null}
      </div>
      <div className="can-scores">
        {([0, 1] as const).map((t) => (
          <span key={t} className={`can-score${viewerSeat != null && teamOf(viewerSeat) === t ? ' mine' : ''}`}>
            <span className="lbl">{teamName(t, viewerSeat)}</span>
            <span className="num">{view.scores[t]}</span>
          </span>
        ))}
        <span className="can-score target">
          <span className="lbl">Target</span>
          <span className="num">{view.target}</span>
        </span>
        <span className="can-score">
          <span className="lbl">Round</span>
          <span className="num">{view.roundNo}</span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- a seat plate */

function SeatPlate({
  where,
  seat,
  view,
  viewerSeat,
  nameOf,
  now,
  did,
}: {
  where: 'north' | 'west' | 'east' | 'south';
  seat: number;
  view: CanastaView;
  viewerSeat: number | null;
  nameOf: (seat: number) => string;
  now: number;
  /** The last thing this seat did, in two or three words. */
  did?: string;
}) {
  const s = view.seats.find((x) => x.seat === seat);
  const toAct = view.toAct === seat && !view.result;
  const secs = toAct && view.actionDeadline != null ? secondsLeft(view.actionDeadline, now) : null;
  const partner = viewerSeat != null && teamOf(viewerSeat) === teamOf(seat);
  return (
    <div className={`can-plate ${where}${toAct ? ' to-act' : ''}${partner ? ' partner' : ''}${s?.status === 'sitting-out' ? ' sitting-out' : ''}`}>
      <span className="cs-name">{s ? nameOf(seat) : 'empty'}</span>
      {/* Partner or opponent, said on the plate — in a partnership game it is the first thing you
          need about anybody at the table, and seat numbers do not say it. */}
      <span className="cs-team">{s ? (viewerSeat == null ? `seat ${seat + 1}` : partner ? 'partner' : 'opponent') : `seat ${seat + 1}`}</span>
      {s ? (
        <span className="cs-cards">
          <CardFan n={s.cards} />
          <span className="num">{s.cards}</span>
        </span>
      ) : null}
      {secs != null ? <span className="clock num">{secs}s</span> : null}
      {did ? <span className="cs-did">{did}</span> : null}
      {s?.status === 'sitting-out' ? <span className="tag muted">sitting out</span> : null}
    </div>
  );
}

/** A little fan of backs, so a hand LOOKS like a hand rather than reading as a number. */
function CardFan({ n }: { n: number }) {
  const shown = Math.min(n, 5);
  return (
    <span className="can-fan" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <Card key={i} size="sm" />
      ))}
    </span>
  );
}

/* --------------------------------------------------------------- a tableau */

function Tableau({
  where,
  team,
  view,
  viewerSeat,
  onAdd,
  addable,
  fresh,
  over,
  dragging,
}: {
  where: 'ours' | 'theirs';
  team: 0 | 1;
  view: CanastaView;
  viewerSeat: number | null;
  /** Given, each meld becomes a button that adds the current selection to it. */
  onAdd: ((rank: string) => void) | null;
  addable: boolean;
  /** `team:rank` keys of the melds that just grew, so they can be seen arriving. */
  fresh: Set<string>;
  /** Given, this tableau accepts cards dragged onto it. A rank means "add to that meld". */
  /** Which drop target the pointer is over, if any — `meld`, or `meld:<rank>`. */
  over?: string | null;
  /** True while cards are in the air, so the targets can show themselves. */
  dragging?: boolean;
}) {
  const melds = view.melds[team];
  const reds = view.redThrees[team];
  const minimum = openingMinimum(view.scores[team]);
  // Only your OWN side takes cards, and only while some are in the air.
  const accepts = onAdd != null && dragging === true;
  return (
    <section
      className={`can-tableau ${where}${accepts ? ' accepts' : ''}${over === 'meld' ? ' over' : ''}`}
      aria-label={teamName(team, viewerSeat)}
      {...(accepts ? { 'data-drop': 'meld' } : {})}
    >
      <header>
        <strong>{teamName(team, viewerSeat)}</strong>
        {reds > 0 ? (
          <span className="tag red-threes">
            {reds} red {reds === 1 ? 'three' : 'threes'}
          </span>
        ) : null}
        {hasCanasta(melds) ? <span className="tag can-tag">can go out</span> : null}
      </header>
      {melds.length === 0 ? (
        <p className="hint">Nothing down — {minimum} to open.</p>
      ) : (
        <div className="can-melds">
          {melds.map((m) =>
            onAdd ? (
              <button
                key={m.rank}
                type="button"
                className="can-meld-btn"
                disabled={!addable}
                title={addable ? `Add what you have picked to the ${m.rank}s` : `${m.cards.length} × ${m.rank}`}
                onClick={() => onAdd(m.rank as string)}
                {...(accepts ? { 'data-drop': `meld:${m.rank}` } : {})}
                data-over={over === `meld:${m.rank}` ? 'yes' : undefined}
              >
                <Meld meld={m} fresh={fresh.has(`${team}:${m.rank}`)} />
              </button>
            ) : (
              <Meld key={m.rank} meld={m} fresh={fresh.has(`${team}:${m.rank}`)} />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function Meld({ meld, fresh }: { meld: ViewMeld; fresh?: boolean }) {
  const label = meld.canasta ? (meld.natural ? 'natural canasta' : 'canasta') : `${meld.cards.length} × ${meld.rank}`;
  return (
    <div className={`can-meld${meld.canasta ? (meld.natural ? ' natural' : ' mixed') : ''}${fresh ? ' fresh' : ''}`}>
      <div className="can-meld-cards">
        {meld.cards.map((c, i) => (
          <Card key={`${c}-${i}`} card={c} size="sm" />
        ))}
      </div>
      <span className="can-meld-label">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------- the controls */

function Controls({
  view,
  legal,
  myTurn,
  selection,
  check,
  meldShort,
  minimum,
  canDraw,
  canTake,
  canMeld,
  takeWhy,
  onDraw,
  onTake,
  onMeld,
  onDiscard,
  onClear,
}: {
  view: CanastaView;
  legal: CanastaLegal | null;
  myTurn: boolean;
  selection: CanastaCard[];
  check: ReturnType<typeof checkSelection>;
  meldShort: boolean;
  minimum: number;
  canDraw: boolean;
  canTake: boolean;
  canMeld: boolean;
  /** Why the pile will not come, or null when it will. Both gates, not only the engine's. */
  takeWhy: string | null;
  onDraw: () => void;
  onTake: () => void;
  onMeld: () => void;
  onDiscard: () => void;
  onClear: () => void;
}) {
  const drawing = view.phase === 'draw';
  const one = selection.length === 1 ? (selection[0] as CanastaCard) : null;
  const canDiscard = myTurn && !drawing && one != null && !(one[0] === '3' && (one[1] === 'H' || one[1] === 'D'));
  const primary = primaryAction({ drawing, selectionCount: selection.length, canDraw, canTake, canMeld, canDiscard });

  return (
    <section className="panel can-actions" aria-label="Your move">
      <div className="can-row">
        <span className="can-step">{drawing ? '1 · Take a card' : '2 · Meld and discard'}</span>
        {selection.length > 0 ? (
          <span className="can-picked">
            {selection.length} picked · {valueOf(selection)} points
            <button type="button" className="link-button" onClick={onClear}>
              clear
            </button>
          </span>
        ) : null}
      </div>

      {/* ONE GREEN BUTTON, and it follows the SELECTION — see `primaryAction`. Draw and Discard were
          both permanently primary, so somebody who picked up three matching cards still saw the green
          on Discard, pressed it, and never noticed Lay down beside it. */}
      <div className="can-buttons">
        <button type="button" className={primary === 'draw' ? 'primary' : ''} disabled={!canDraw} onClick={onDraw}>
          Draw
        </button>
        <button
          type="button"
          className={primary === 'take' ? 'primary' : ''}
          disabled={!canTake}
          title={takeWhy ?? undefined}
          onClick={onTake}
        >
          Take the pile ({view.pileSize})
        </button>
        <button type="button" className={primary === 'meld' ? 'primary' : ''} disabled={!canMeld} onClick={onMeld}>
          Lay down{check.ok ? ` ${selection.length} × ${check.rank}` : ''}
        </button>
        <button type="button" className={primary === 'discard' ? 'primary' : ''} disabled={!canDiscard} onClick={onDiscard}>
          Discard{one ? ` ${one}` : ''}
        </button>
      </div>

      <p className="hint can-why">
        {why({ view, myTurn, drawing, legal, selection, check, meldShort, minimum, takeWhy })}
      </p>
    </section>
  );
}

/**
 * The one line under the buttons, saying what to do next or why not.
 *
 * A dead button with no sentence beside it is the worst thing a rules-heavy game can show, and
 * canasta has more dead buttons than most: it is not your turn, or you have not drawn, or the pile
 * is frozen, or you have not reached your minimum. Each of those is a different sentence.
 */
export function why(a: {
  view: CanastaView;
  myTurn: boolean;
  drawing: boolean;
  legal: CanastaLegal | null;
  selection: CanastaCard[];
  check: ReturnType<typeof checkSelection>;
  meldShort: boolean;
  minimum: number;
  /** Why the pile will not come, or null when it will. Both gates, not only the engine's. */
  takeWhy: string | null;
}): string {
  if (a.view.result) return 'The round is scored. The next one deals shortly.';
  if (!a.myTurn) return 'Waiting for the other players.';
  if (a.drawing) {
    // `takeWhy` is the WHOLE answer — both gates, not just the engine's. This line used to read the
    // engine alone and so said "take the pile with those" while the button beside it was disabled,
    // because the selected cards did not actually make a meld with the top card.
    if (!a.takeWhy) return a.selection.length === 0 ? 'Take the pile, or draw from the stock.' : 'Take the pile with those, or draw instead.';
    return `Draw from the stock. ${a.takeWhy}`;
  }
  if (a.selection.length === 0) return 'Pick cards to lay down, or pick one card to discard and end your turn. You can drag them instead.';
  if (a.selection.length === 1) return 'Discard that to end your turn, or pick more cards to make a meld. Dragging it to the pile discards it.';
  if (!a.check.ok) return a.check.why;
  if (a.meldShort) return `Your side has not opened. That is ${a.check.value} and you need ${a.minimum}. Pick more, or discard to pass.`;
  return `That is a legal ${a.check.rank} meld worth ${a.check.value}. Lay it down, or press one of your melds to add to it.`;
}

/* ------------------------------------------------------------- the scoring */

function RoundResult({ view, viewerSeat, nameOf }: { view: CanastaView; viewerSeat: number | null; nameOf: (seat: number) => string }) {
  const r = view.result;
  if (!r) return null;
  const line =
    r.wentOut === null
      ? 'The stock ran out, so the round ended where it stood.'
      : `${r.wentOut === viewerSeat ? 'You' : nameOf(r.wentOut)} went out${r.concealed ? ', concealed' : ''}.`;
  return (
    <div className="table-notice can-result" role="status">
      <strong>{view.winner !== null ? `${teamName(view.winner, viewerSeat)} won the game` : 'Round over'}</strong>
      <span className="hint">{line}</span>
      {/* The same six numbers as a sentence. A table of figures is a reference; this is the part
          somebody learning actually reads, and it is what the coach says out loud. */}
      <p className="can-score-said">{scoreSummary(r as never, viewerSeat == null ? null : ((viewerSeat % 2) as 0 | 1))}</p>
      <div className="tables-wrap">
        <table className="can-scoresheet">
          <thead>
            <tr>
              <th />
              <th className="num">Melds</th>
              <th className="num">Canastas</th>
              <th className="num">Red threes</th>
              <th className="num">Going out</th>
              <th className="num">In hand</th>
              <th className="num">Round</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {([0, 1] as const).map((t) => {
              const s = r.scores[t];
              return (
                <tr key={t} className={viewerSeat != null && teamOf(viewerSeat) === t ? 'mine' : ''}>
                  <td>{teamName(t, viewerSeat)}</td>
                  <td className="num">{s.melds}</td>
                  <td className="num">{s.canastas}</td>
                  <td className="num">{s.redThrees}</td>
                  <td className="num">{s.goingOut}</td>
                  <td className="num">{s.inHand}</td>
                  <td className="num">{s.total}</td>
                  <td className="num">{r.totals[t]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
