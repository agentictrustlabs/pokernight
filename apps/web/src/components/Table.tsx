import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Action, Card as CardCode, ClientCommand, Session } from '../lib/types';
import type { TableState } from '../lib/tableSocket';
import { seatBlock, type TreasuryView } from '../lib/treasury';
import { fmtChips, summarizeResult, type FormatContext } from '../lib/format';
import { awardedTo, blindSeats, lastActions, netBySeat, potTotal, shownCards, winningCards, winningSeats } from '../lib/hand';
import { useNow, usePrefersReducedMotion } from '../lib/hooks';
import { ActionBar } from './ActionBar';
import { Announcer } from './Announcer';
import { Card, CardSlot } from './Card';
import { ChipStack } from './ChipStack';
import { Seat } from './Seat';
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
      bx: 50 + 27 * Math.cos(a),
      by: 50 + 24 * Math.sin(a),
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
  treasury = null,
}: {
  state: TableState;
  session: Session | null;
  send: (c: ClientCommand) => void;
  /** The table's settlement mode. A settled table refuses a seat until the money is in order. */
  settlement?: string;
  /** This player's money, as the card room sees it. Null while it is still being read. */
  treasury?: TreasuryView | null;
}) {
  const view = state.view;
  const [picking, setPicking] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState<string>('');
  const [addAmt, setAddAmt] = useState<string>('');
  const reduced = usePrefersReducedMotion();

  const myTurn = state.turn != null && view?.viewerSeat != null && state.turn.seat === view.viewerSeat;
  const inHand = view?.hand != null && view.hand.result == null;
  const now = useNow(inHand || myTurn);
  const ended = state.lastHand;
  const phase = useWinnerPhase(ended?.result ? ended.handNo : null, reduced);

  const nameOf = useMemo(() => {
    const bySeat = new Map<number, string>();
    for (const s of view?.seats ?? []) bySeat.set(s.seat, state.names[s.playerId] ?? s.playerId.slice(0, 8));
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
  const block = seatBlock(settlement, treasury, wanted);

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
            <WinnerBanner result={result} ctx={ctx} board={board} />
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
                    <ChipStack amount={potShown} bigBlind={bb} label="Pot" size="sm" />
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
                      />
                    ))}
                  </div>
                ) : (
                  <div className="idle">
                    {cfg.smallBlind}/{cfg.bigBlind} blinds{cfg.ante ? `, ante ${cfg.ante}` : ''} · buy-in{' '}
                    {fmtChips(cfg.minBuyIn)}–{fmtChips(cfg.maxBuyIn)}
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
                <ChipStack amount={amt} bigBlind={bb} ariaLabel={`${nameOf(s.seat)} bet`} size="sm" maxColumns={3} maxPerColumn={6} />
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
              />
            );
          })}
        </ul>
      </div>

      {picking != null ? (
        <form
          className="panel picker row"
          onSubmit={(e) => {
            e.preventDefault();
            confirmSit();
          }}
        >
          <strong>Sit at seat {picking + 1}</strong>
          <label>
            Buy-in ({fmtChips(cfg.minBuyIn)}–{fmtChips(cfg.maxBuyIn)})
            <input type="number" min={cfg.minBuyIn} max={cfg.maxBuyIn} value={buyIn} onChange={(e) => setBuyIn(e.target.value)} autoFocus />
          </label>
          <button className="primary" type="submit" disabled={block !== null}>
            Sit down
          </button>
          <button type="button" className="quiet" onClick={() => setPicking(null)}>
            Cancel
          </button>
          {/* A settled table never falls back to play money. If the seat cannot be paid for, it says
              which of the four things is missing and points at the panel that fixes that one. */}
          {block ? (
            <p className={block.action === 'wait' ? 'hint' : 'form-error'}>
              {block.reason}
              {block.action === 'wait' || block.action === 'configure' ? null : (
                <>
                  {' '}
                  <a href={block.action === 'create-treasury' || block.action === 'choose-treasury' ? '#/' : '#money'}>
                    {block.action === 'fund-treasury'
                      ? 'Fund it in the Money panel →'
                      : block.action === 'sign-mandate'
                        ? 'Authorise buy-ins in the Money panel →'
                        : 'Set your treasury up in the lobby →'}
                  </a>
                </>
              )}
            </p>
          ) : null}
        </form>
      ) : null}

      {view.viewerSeat != null ? (
        <ActionBar turn={myTurn ? state.turn : null} view={view} now={now} onAct={act} waitingOn={waitingOn} />
      ) : null}

      {me ? (
        <div className="controls row">
          {me.status === 'sitting-out' ? (
            <button onClick={() => send({ type: 'sit-in' })}>Sit in</button>
          ) : (
            <button onClick={() => send({ type: 'sit-out' })}>Sit out</button>
          )}
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
          </form>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="danger" onClick={() => send({ type: 'leave' })}>
            Leave table
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
