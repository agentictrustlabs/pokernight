import { useMemo, useState } from 'react';
import type { Action, Card as CardCode, ClientCommand, Session } from '../lib/types';
import type { TableState } from '../lib/tableSocket';
import { fmtChips } from '../lib/format';
import { useNow } from '../lib/hooks';
import { ActionBar } from './ActionBar';
import { Card } from './Card';
import { Seat } from './Seat';
import { SeedCommit } from './SeedCommit';

/** Percent coordinates on the oval for `n` seats, viewer's seat at the bottom. */
function seatPositions(n: number, viewerSeat: number | null): { x: number; y: number }[] {
  const offset = viewerSeat ?? 0;
  return Array.from({ length: n }, (_, seat) => {
    const idx = (seat - offset + n) % n;
    const angle = Math.PI / 2 + (idx * 2 * Math.PI) / n; // start at bottom, go clockwise
    return { x: 50 + 44 * Math.cos(angle), y: 50 + 44 * Math.sin(angle) };
  });
}

export function Table({ state, session, send }: { state: TableState; session: Session | null; send: (c: ClientCommand) => void }) {
  const view = state.view;
  const [picking, setPicking] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState<string>('');
  const [addAmt, setAddAmt] = useState<string>('');

  const myTurn = state.turn != null && view?.viewerSeat != null && state.turn.seat === view.viewerSeat;
  const inHand = view?.hand != null && view.hand.result == null;
  const now = useNow(inHand || myTurn);

  const nameOf = useMemo(() => {
    const bySeat = new Map<number, string>();
    for (const s of view?.seats ?? []) bySeat.set(s.seat, state.names[s.playerId] ?? s.playerId.slice(0, 8));
    return (seat: number) => bySeat.get(seat) ?? `Seat ${seat + 1}`;
  }, [view, state.names]);

  if (!view) return <div className="panel hint">Connecting to the table…</div>;

  const cfg = view.config;
  const positions = seatPositions(cfg.seats, view.viewerSeat);
  const seatMap = new Map(view.seats.map((s) => [s.seat, s]));
  const me = view.viewerSeat != null ? seatMap.get(view.viewerSeat) ?? null : null;
  const hand = view.hand;
  const shownCards = new Map<number, CardCode[]>();
  for (const s of hand?.result?.shown ?? state.lastHand?.result?.shown ?? []) shownCards.set(s.seat, s.holeCards);
  const board = hand?.board ?? [];
  const potTotal = (hand?.pots.reduce((a, p) => a + p.amount, 0) ?? 0) + view.seats.reduce((a, s) => a + (s.inHand?.streetBet ?? 0), 0);
  const canSit = session != null && view.viewerSeat == null;
  const seedCommit = hand?.seedCommit ?? state.lastHand?.seedCommit;
  const seedReveal = hand?.seedReveal ?? (state.lastHand && (!hand || state.lastHand.handNo === hand.handNo) ? state.lastHand.seedReveal : undefined);

  const act = (action: Action) => {
    if (!state.turn) return;
    send({ type: 'act', handNo: state.turn.handNo, action });
  };
  const startSit = (seat: number) => {
    setPicking(seat);
    setBuyIn(String(cfg.maxBuyIn));
  };
  const confirmSit = () => {
    if (picking == null) return;
    const n = Math.round(Number(buyIn));
    if (!Number.isFinite(n)) return;
    send({ type: 'join', seat: picking, buyIn: Math.min(cfg.maxBuyIn, Math.max(cfg.minBuyIn, n)) });
    setPicking(null);
  };

  return (
    <div>
      <div className="arena">
        <div className="felt">
          <div className="hand-no">
            {hand ? `Hand #${hand.handNo} · ${hand.street}` : view.handNo > 0 ? `Between hands · last #${view.handNo}` : 'Waiting for players'}
          </div>
          <div className="board" aria-label="Board">
            {Array.from({ length: 5 }, (_, i) => {
              const c = board[i];
              return c ? <Card key={i} card={c} /> : <div key={i} className="slot" />;
            })}
          </div>
          {hand ? (
            <div className="pots">
              {hand.pots.length > 1 ? (
                hand.pots.map((p, i) => (
                  <span key={i} className="pot">
                    <span className="lbl">{i === 0 ? 'Main' : `Side ${i}`}</span>
                    {fmtChips(p.amount)}
                  </span>
                ))
              ) : (
                <span className="pot">
                  <span className="lbl">Pot</span>
                  {fmtChips(potTotal)}
                </span>
              )}
            </div>
          ) : (
            <div className="idle">
              {cfg.smallBlind}/{cfg.bigBlind} blinds{cfg.ante ? `, ante ${cfg.ante}` : ''} · buy-in {fmtChips(cfg.minBuyIn)}–{fmtChips(cfg.maxBuyIn)}
            </div>
          )}
          {seedCommit ? <SeedCommit commit={seedCommit} reveal={seedReveal} handNo={hand?.handNo ?? state.lastHand?.handNo ?? 0} /> : null}
        </div>
        <ul className="seats">
          {positions.map((pos, seatNo) => {
            const sv = seatMap.get(seatNo) ?? null;
            return (
              <Seat
                key={seatNo}
                seatNo={seatNo}
                seat={sv}
                name={nameOf(seatNo)}
                isYou={view.viewerSeat === seatNo}
                isButton={view.button === seatNo && sv != null}
                toAct={inHand && hand?.toAct === seatNo}
                deadline={hand && hand.toAct === seatNo ? (myTurn && state.turn?.deadline != null ? state.turn.deadline : hand.actionDeadline) : null}
                now={now}
                inHand={hand != null}
                known={sv?.inHand?.holeCards ?? shownCards.get(seatNo)}
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
          <button className="primary" type="submit">
            Sit down
          </button>
          <button type="button" className="quiet" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </form>
      ) : null}

      {myTurn && state.turn ? <ActionBar turn={state.turn} view={view} now={now} onAct={act} /> : null}

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
            <input type="number" min={1} placeholder="Add chips" value={addAmt} onChange={(e) => setAddAmt(e.target.value)} style={{ width: 120 }} aria-label="Chips to add" />
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
