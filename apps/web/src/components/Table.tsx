import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Action, Card as CardCode, ClientCommand, Session } from '../lib/types';
import type { TableState } from '../lib/tableSocket';
import { seatBlock, type TreasuryView } from '../lib/treasury';
import { describeMode, describeRange, dualAmount, tableRate } from '../lib/money';
import { seatLabel, summarizeResult, type FormatContext } from '../lib/format';

import { awardedTo, blindSeats, lastActions, netBySeat, potTotal, shownCards, winningCards, winningSeats } from '../lib/hand';
import { dealState, satOutAction, satOutHeadline, sitOutNotice, waitingToBeDealtIn } from '../lib/seating';
import { useLeaveTable } from '../lib/useLeaveTable';
import { useNow, usePrefersReducedMotion } from '../lib/hooks';
import { ActionBar } from './ActionBar';
import { StakeLink } from './StakeLink';
import { Announcer } from './Announcer';
import { Card, CardSlot } from './Card';
import { ChipStack } from './ChipStack';
import { Seat } from './Seat';
import { SettlementTag } from './SettlementTag';
import { StatusBar } from './StatusBar';
import { WinnerBanner } from './WinnerBanner';

export interface SeatPos {
  /** Seat centre, in percent of the seat layer. */
  x: number;
  y: number;
  /** Where this seat's street bet sits, between the seat and the pot. */
  bx: number;
  by: number;
}

/**
 * How far seats are eased away from the two horizontal extremes of the oval
 * (3 and 9 o'clock), in radians. A seat card is taller than it is wide, so the
 * neighbours that crowd are the ones stacked up the left and right flanks:
 * easing them towards the top and bottom runs spends plentiful horizontal
 * clearance to buy the scarce vertical kind. Four seats or fewer sit on the
 * quarters of the oval and have nothing to crowd, so they take no bias.
 */
function flankBias(n: number): number {
  return n >= 5 ? 0.175 : 0;
}

/**
 * Percent coordinates on the oval for `n` seats, the viewer rotated to the bottom.
 *
 * The ring is intentionally non-uniform: seats are spaced evenly in index, then
 * warped by `flankBias` so that no two adjacent cards overlap at any seat count
 * from 2 to 9. The clearance is a ratio of the ring, so `.seat` keeps its width
 * proportional to the oval — change one and the other has to move with it.
 */
export function seatLayout(n: number, viewerSeat: number | null): SeatPos[] {
  const offset = viewerSeat ?? 0;
  const bias = flankBias(n);
  return Array.from({ length: n }, (_, seat) => {
    const idx = (seat - offset + n) % n;
    const t = Math.PI / 2 + (idx * 2 * Math.PI) / n; // start at the bottom, go clockwise
    const a = t + bias * Math.sin(2 * t); // ease away from 3 and 9 o'clock
    return {
      // The ring is laid on the rail: `.felt` is inset so its edge runs through the
      // seat centres, and a card straddles it the way a nameplate straddles a table.
      x: 50 + 46 * Math.cos(a),
      y: 50 + 40.5 * Math.sin(a),
      // The bet ring sits inside the seat ring. It is pulled in a little further than the drawing
      // alone needs because on a settled table a bet carries a second line (its value in the table's currency), and
      // the seat cards paint over the bets — a money figure half-hidden behind a nameplate is worse
      // than no money figure at all.
      bx: 50 + 26 * Math.cos(a),
      by: 50 + 21 * Math.sin(a),
    };
  });
}

/**
 * The winner moment runs in three beats: reveal the cards, slide the pot to the
 * winner, then settle with the net deltas and the banner. Reduced motion jumps
 * straight to the end.
 */
type WinPhase = 'none' | 'reveal' | 'collect' | 'settled';

function useWinnerPhase(handNo: number | null, reduced: boolean): WinPhase {
  const [phase, setPhase] = useState<WinPhase>('none');
  useEffect(() => {
    if (handNo == null) {
      setPhase('none');
      return;
    }
    if (reduced) {
      setPhase('settled');
      return;
    }
    setPhase('reveal');
    const t1 = setTimeout(() => setPhase('collect'), 450);
    const t2 = setTimeout(() => setPhase('settled'), 1350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [handNo, reduced]);
  return phase;
}

export function Table({
  state,
  session,
  send,
  settlement = 'play-money',
  chipValue = null,
  assetSymbol = null,
  treasury = null,
}: {
  state: TableState;
  session: Session | null;
  send: (c: ClientCommand) => void;
  /** The table's settlement mode. A settled table refuses a seat until the money is in order. */
  settlement?: string;
  /**
   * What one chip is worth AT THIS TABLE, in asset base units — the rate pinned when the table was
   * created (`TableSummary.chipValue`). Never a deployment default: an old table settles at the
   * rate it was opened with, and showing any other number here would be showing the wrong money.
   */
  chipValue?: string | null;
  /** What that rate is denominated in (`TableSummary.assetSymbol`). Per table, never per deployment. */
  assetSymbol?: string | null;
  /** This player's money, as the card room sees it. Null while it is still being read. */
  treasury?: TreasuryView | null;
}) {
  const view = state.view;
  // Leaving takes you back to the room, once the seat has actually gone. Declared with the other
  // hooks, above the early return further down — React counts them.
  const { leaving, leave } = useLeaveTable(state.view?.viewerSeat != null, () => send({ type: 'leave' }));
  const [picking, setPicking] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState<string>('');
  const [addAmt, setAddAmt] = useState<string>('');
  const reduced = usePrefersReducedMotion();

  // One rate for the whole table view. Null on play money, where a bare chip count is the truth.
  const rate = tableRate(settlement, chipValue, assetSymbol);
  const mode = describeMode(settlement, rate);

  const myTurn = state.turn != null && view?.viewerSeat != null && state.turn.seat === view.viewerSeat;
  const inHand = view?.hand != null && view.hand.result == null;
  const now = useNow(inHand || myTurn);
  const ended = state.lastHand;
  const phase = useWinnerPhase(ended?.result ? ended.handNo : null, reduced);

  const nameOf = useMemo(() => {
    const bySeat = new Map<number, string>();
    // A Home that knows someone only as a phone number asserts no name, and the table service falls
    // back to their address. `seatLabel` turns that into "Seat N" rather than putting a raw `0x…` on
    // a seat plate and in every line of the log.
    for (const s of view?.seats ?? []) bySeat.set(s.seat, seatLabel(state.names[s.playerId], s.seat));
    return (seat: number) => bySeat.get(seat) ?? `Seat ${seat + 1}`;
  }, [view, state.names]);

  if (!view) return <div className="panel hint">Connecting to the table…</div>;

  const cfg = view.config;
  const bb = cfg.bigBlind;
  const positions = seatLayout(cfg.seats, view.viewerSeat);
  const seatMap = new Map(view.seats.map((s) => [s.seat, s]));
  const me = view.viewerSeat != null ? (seatMap.get(view.viewerSeat) ?? null) : null;
  const hand = view.hand;
  const ctx: FormatContext = { seatName: nameOf, viewerSeat: view.viewerSeat };

  const result = ended?.result ?? hand?.result ?? null;
  const moment = result != null && phase !== 'none';
  const board: CardCode[] = hand?.board?.length ? hand.board : (ended?.board ?? []);
  const winSeats = result ? new Set(winningSeats(result)) : new Set<number>();
  const winCards = winningCards(result);
  const shown = shownCards(result);
  const nets = netBySeat(result);
  const lastAct = lastActions(hand?.actions ?? [], hand?.street ?? 'preflop');
  const blinds = blindSeats(view);
  const handKey = hand?.handNo ?? ended?.handNo ?? 0;

  const awardTotal = result ? result.awards.reduce((a, w) => a + w.amount, 0) : 0;
  const pots = hand?.pots ?? [];
  const potShown = moment ? awardTotal : potTotal(view);
  // Whether a hand can start at all, and — if not — the sentence that says why. Derived from the
  // view rather than asked for: everything the answer needs is already on screen.
  const deal = dealState(view);
  const sittingOut = me != null && me.status === 'sitting-out';
  // Seated, sitting in, with chips — and still not in the hand. An ordinary rule with a name nobody
  // outside a card room knows, so it gets a sentence rather than a two-letter badge.
  const dealtInSoon = waitingToBeDealtIn(view);
  const myReason = me != null ? state.players[me.playerId]?.sitOutReason : undefined;
  // What a sat-out player is offered, decided by the one fact that matters: whether they have chips.
  // Offering "Sit in" to somebody on zero is offering a control that cannot help them, which is how
  // a busted player ends up pressing a button forever at a table that never deals them in.
  const satOut = satOutAction(me?.stack ?? 1);
  // The cheapest way back in, so the default commits the least money. Clamped into the table's own
  // range, and never past what the stack may hold — a rebuy is capped by `maxBuyIn` like any buy-in.
  const rebuyChips = Math.max(0, Math.min(cfg.minBuyIn, cfg.maxBuyIn - (me?.stack ?? 0)));
  const rebuyCost = dualAmount(rebuyChips, rate);
  // Priced and refused by name BEFORE the button, exactly as a fresh buy-in is: a rebuy moves the
  // same money under the same mandate, so it meets the same four conditions in the same order.
  const rebuyBlock = satOut === 'rebuy' ? seatBlock(settlement, treasury, rebuyChips, rate) : null;
  const canSit = session != null && view.viewerSeat == null;
  const waitingOn = inHand && hand?.toAct != null && hand.toAct !== view.viewerSeat ? nameOf(hand.toAct) : null;

  const announce = result
    ? summarizeResult(result, ctx).line
    : myTurn
      ? 'Your turn to act.'
      : waitingOn
        ? `${waitingOn} to act.`
        : '';

  const act = (action: Action) => {
    if (!state.turn) return;
    send({ type: 'act', handNo: state.turn.handNo, action });
  };
  const startSit = (seat: number) => {
    setPicking(seat);
    setBuyIn(String(cfg.maxBuyIn));
  };
  // What this exact buy-in still needs, if anything. Recomputed as the number changes, so a player
  // typing 20 000 chips is told they are short before they press the button rather than after.
  const wanted = Math.min(cfg.maxBuyIn, Math.max(cfg.minBuyIn, Math.round(Number(buyIn) || 0)));
  const block = seatBlock(settlement, treasury, wanted, rate);
  // Both units, live, as the number changes: the amount that will actually be committed (the typed
  // value clamped into the table's range) and the money it costs.
  const cost = dualAmount(wanted, rate);

  const confirmSit = () => {
    if (picking == null || block) return;
    const n = Math.round(Number(buyIn));
    if (!Number.isFinite(n)) return;
    send({ type: 'join', seat: picking, buyIn: Math.min(cfg.maxBuyIn, Math.max(cfg.minBuyIn, n)) });
    setPicking(null);
  };

  return (
    <div className="table-main">
      <Announcer message={announce} />
      <StatusBar view={view} lastHand={ended} />

      {/* Two things the table used to leave unsaid, said before anything else on the felt.

          A table with fewer than two players sitting in cannot deal, and until now it simply went
          quiet: no hand, no message, and an action bar claiming it was not your turn. That is the
          state the user walked into and read as the table being broken.

          And a player who has been sat out — by a dropped connection, or by missing two turns — is
          not being dealt in and has no way to know why. The reason and the button that undoes it
          belong together, at the top, not as a small control among the others. */}
      {deal.waiting ? (
        <div className="table-notice waiting" role="status">
          <strong>Waiting for another player</strong>
          <span className="hint">{deal.waiting}</span>
        </div>
      ) : null}

      {dealtInSoon && !sittingOut ? (
        <div className="table-notice waiting" role="status">
          <strong>You are next in</strong>
          <span className="hint">{dealtInSoon}</span>
        </div>
      ) : null}

      {sittingOut ? (
        <div className={`table-notice sat-out${satOut === 'rebuy' ? ' broke' : ''}`} role="status">
          <div className="notice-text">
            <strong>{satOutHeadline(me?.stack ?? 1)}</strong>
            <span className="hint">{sitOutNotice(myReason, me?.stack ?? 1)}</span>
            {/* A rebuy that cannot be paid for says which of the four things is missing, in the same
                words and the same order the server refuses in, and points at the one card that
                fixes whichever it is. Silence here is what "the game is stuck" felt like. */}
            {rebuyBlock ? (
              <span className={rebuyBlock.action === 'wait' ? 'hint' : 'form-error'}>
                {rebuyBlock.reason}
                {rebuyBlock.action === 'wait' || rebuyBlock.action === 'configure' ? null : (
                  <>
                    {' '}
                    <StakeLink>Get set up to play →</StakeLink>
                  </>
                )}
              </span>
            ) : null}
          </div>
          {satOut === 'rebuy' ? (
            <button
              className="primary sit-in"
              disabled={rebuyBlock !== null || rebuyChips <= 0}
              onClick={() => send({ type: 'add-chips', amount: rebuyChips })}
            >
              {/* One press does the whole thing: the server sits a busted seat back in as part of
                  the rebuy, so there is no second button and no way to land half-way. */}
              Buy back in — {rebuyCost.assetLabel ?? `${rebuyCost.chipsText} chips`}
            </button>
          ) : (
            <button className="primary sit-in" onClick={() => send({ type: 'sit-in' })}>
              Sit in
            </button>
          )}
        </div>
      ) : null}

      <div className={`arena${moment ? ' moment' : ''}`}>
        <div className="felt">
          {moment && phase !== 'reveal' ? null : (
            <div className="felt-street">
              {hand && !moment
                ? `${hand.street}`
                : moment
                  ? 'Hand over'
                  : view.handNo > 0
                    ? `between hands · last #${view.handNo}`
                    : 'waiting for players'}
            </div>
          )}

          {moment && result && phase !== 'reveal' ? (
            <WinnerBanner result={result} ctx={ctx} board={board} rate={rate} />
          ) : (
            <>
              <div className="board" aria-label="Board">
                {Array.from({ length: 5 }, (_, i) => {
                  const c = board[i];
                  return c ? (
                    <Card key={`${handKey}-${c}`} card={c} enter="flip" win={winCards.has(c)} muted={moment && !winCards.has(c)} />
                  ) : (
                    <CardSlot key={`slot-${i}`} />
                  );
                })}
              </div>

              <div className="middle">
                {moment || (hand && pots.length <= 1) ? (
                  <div className="pots">
                    <ChipStack amount={potShown} bigBlind={bb} label="Pot" size="sm" rate={rate} />
                  </div>
                ) : hand ? (
                  <div className="pots">
                    {pots.map((p, i) => (
                      <ChipStack
                        key={i}
                        amount={p.amount}
                        bigBlind={bb}
                        label={i === 0 ? 'Main' : `Side ${i}`}
                        size="sm"
                        maxColumns={3}
                        rate={rate}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="idle">
                    {cfg.smallBlind}/{cfg.bigBlind} blinds{cfg.ante ? `, ante ${cfg.ante}` : ''} · buy-in{' '}
                    {describeRange(cfg.minBuyIn, cfg.maxBuyIn, rate)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <ul className="bets">
          {view.seats.map((s) => {
            const amt = s.inHand?.streetBet ?? 0;
            const pos = positions[s.seat];
            if (amt <= 0 || !pos || moment) return null;
            const style = { '--x': pos.bx, '--y': pos.by, '--sx': pos.x, '--sy': pos.y } as CSSProperties;
            return (
              <li key={s.seat} className="bet-chips" style={style}>
                <ChipStack amount={amt} bigBlind={bb} ariaLabel={`${nameOf(s.seat)} bet`} size="sm" maxColumns={3} maxPerColumn={6} rate={rate} />
              </li>
            );
          })}
        </ul>

        {moment && result && !reduced && (phase === 'reveal' || phase === 'collect') ? (
          <ul className="fly" aria-hidden="true">
            {[...winSeats].map((seatNo) => {
              const pos = positions[seatNo];
              if (!pos) return null;
              const style = { '--tx': pos.x, '--ty': pos.y } as CSSProperties;
              return (
                <li key={seatNo} className={`fly-chips${phase === 'collect' ? ' go' : ''}`} style={style}>
                  <ChipStack
                    amount={awardedTo(result, seatNo)}
                    bigBlind={bb}
                    size="sm"
                    showAmount={false}
                    maxColumns={3}
                    maxPerColumn={6}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}

        <ul className="seats">
          {positions.map((pos, seatNo) => {
            const sv = seatMap.get(seatNo) ?? null;
            return (
              <Seat
                key={seatNo}
                seatNo={seatNo}
                seat={sv}
                name={nameOf(seatNo)}
                player={sv ? state.players[sv.playerId] : undefined}
                bigBlind={bb}
                isYou={view.viewerSeat === seatNo}
                isButton={view.button === seatNo && sv != null}
                isSmallBlind={blinds.small === seatNo && view.button !== seatNo}
                isBigBlind={blinds.big === seatNo && view.button !== seatNo}
                toAct={inHand && hand?.toAct === seatNo}
                deadline={hand && hand.toAct === seatNo ? (myTurn && state.turn?.deadline != null ? state.turn.deadline : hand.actionDeadline) : null}
                timeoutMs={cfg.actionTimeoutMs}
                now={now}
                inHand={hand != null || moment}
                handKey={handKey}
                known={sv?.inHand?.holeCards ?? shown.get(seatNo)}
                winCards={moment ? winCards : undefined}
                isWinner={moment && winSeats.has(seatNo)}
                dimmed={moment && !winSeats.has(seatNo)}
                delta={phase === 'settled' ? (nets.get(seatNo) ?? null) : null}
                last={lastAct.get(seatNo)}
                x={pos.x}
                y={pos.y}
                canSit={canSit && picking == null}
                onSit={startSit}
                rate={rate}
                modeLabel={mode.settles ? mode.label : 'play money'}
              />
            );
          })}
        </ul>
      </div>

      {picking != null ? (
        <form
          className={`panel picker${mode.settles ? ' settles' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            confirmSit();
          }}
        >
          {/* What kind of table this is, said ABOVE the buy-in box rather than in a panel below the
              fold. A player must never commit money on a table they took for play, or the reverse. */}
          <div className="picker-head">
            <strong>Sit at seat {picking + 1}</strong>
            <SettlementTag settlement={settlement} rate={rate} withRate />
          </div>
          <p className={mode.settles ? 'picker-terms money' : 'picker-terms'}>{mode.line}</p>

          <div className="row picker-controls">
            <label>
              Buy-in ({describeRange(cfg.minBuyIn, cfg.maxBuyIn, rate)})
              <input type="number" min={cfg.minBuyIn} max={cfg.maxBuyIn} value={buyIn} onChange={(e) => setBuyIn(e.target.value)} autoFocus />
            </label>
            {/* Both units, live, as the number changes. */}
            <span className="picker-cost">
              <span className="num cost-chips">{cost.chipsText} chips</span>
              {cost.assetLabel ? <span className="num cost-asset">{cost.assetLabel}</span> : null}
            </span>
            <span className="spacer" style={{ flex: 1 }} />
            <button className="primary" type="submit" disabled={block !== null}>
              Sit down
            </button>
            <button type="button" className="quiet" onClick={() => setPicking(null)}>
              Cancel
            </button>
          </div>
          {/* A settled table never falls back to play money. If the seat cannot be paid for, it says
              which of the four things is missing and points at the panel that fixes that one. */}
          {block ? (
            <p className={block.action === 'wait' ? 'hint' : 'form-error'}>
              {block.reason}
              {block.action === 'wait' || block.action === 'configure' ? null : (
                <>
                  {' '}
                  {/* One destination for all four of them: the set-up card is the one control that
                      fixes whichever of them is missing, so a player never has to work out which. */}
                  <StakeLink>Get set up to play →</StakeLink>
                </>
              )}
            </p>
          ) : null}
        </form>
      ) : null}

      {view.viewerSeat != null ? (
        <ActionBar turn={myTurn ? state.turn : null} view={view} now={now} onAct={act} waitingOn={waitingOn} rate={rate} />
      ) : null}

      {me ? (
        <div className="controls row">
          {/* "Sit in" lives in the notice at the top of the table, next to the reason it is needed,
              so it is not repeated here — two identical buttons in two places is worse than one in
              the right place. "Sit out" has no such story to tell and stays with the other controls. */}
          {me.status === 'sitting-out' ? null : <button onClick={() => send({ type: 'sit-out' })}>Sit out</button>}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.round(Number(addAmt));
              if (Number.isFinite(n) && n > 0) {
                send({ type: 'add-chips', amount: n });
                setAddAmt('');
              }
            }}
          >
            <input
              type="number"
              min={1}
              placeholder="Add chips"
              value={addAmt}
              onChange={(e) => setAddAmt(e.target.value)}
              style={{ width: 120 }}
              aria-label="Chips to add"
            />
            <button type="submit" disabled={!addAmt}>
              Add
            </button>
            {/* A rebuy moves money too, so it is priced as it is typed. */}
            {rate && Number(addAmt) > 0 ? <span className="num cost-asset">{dualAmount(Number(addAmt), rate).assetLabel}</span> : null}
          </form>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="danger" disabled={leaving} onClick={leave}>
            {leaving ? 'Leaving…' : 'Leave table'}
          </button>
        </div>
      ) : session == null ? (
        <p className="hint controls">
          You are spectating. <a href="#/">Log in</a> to take a seat.
        </p>
      ) : null}
    </div>
  );
}
