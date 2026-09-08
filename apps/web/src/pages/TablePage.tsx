import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSession, ClientCommand } from '../lib/types';
import { api, tableSocketUrl } from '../lib/api';
import type { AuthConfig } from '../lib/home';
import type { TreasuryView } from '../lib/treasury';
import { seatLabel } from '../lib/format';
import { tableRate } from '../lib/money';

import { stakeStage } from '../lib/stake';
import { TableSocket, dismissError, initialState, reduce, setConnection, type TableState } from '../lib/tableSocket';
import { Identity } from '../components/Identity';
import { LogPanel } from '../components/LogPanel';
import { MoneyPanel } from '../components/MoneyPanel';
import { StartPanel } from '../components/StartPanel';
import { SettlementTag } from '../components/SettlementTag';
import { Table } from '../components/Table';
import { Toast } from '../components/Toast';

/**
 * The treasury view changes when money moves or the player acts, both of which this page knows about
 * already — so this poll only has to catch a settlement that landed elsewhere. Slower than the
 * settlement rows on purpose: reading it asks the player's HOME a question, and a table full of
 * people should not turn into a request per player per few seconds at somebody else's server.
 */
const TREASURY_POLL_MS = 15_000;

export function TablePage({
  tableId,
  session,
  config,
  onSignOut,
}: {
  tableId: string;
  session: AppSession | null;
  /** `GET /auth/config`, so the set-up card can send a player to their own Home and back. */
  config: AuthConfig | null;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<TableState>(initialState);
  const [tableName, setTableName] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<string>('play-money');
  /**
   * The rate THIS table pinned when it was created. Read off the table's own summary, never from
   * the deployment's current default — an older table settles at the rate it was opened with.
   */
  const [chipValue, setChipValue] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
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
    api
      .listTables(token ?? undefined)
      .then((ts) => {
        if (!alive) return;
        const summary = ts.find((t) => t.tableId === tableId);
        setTableName(summary?.name ?? null);
        setSettlement(summary?.settlement ?? 'play-money');
        setChipValue(summary?.chipValue ?? null);
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

  const send = useCallback((c: ClientCommand) => sockRef.current?.send(c), []);
  const onDismiss = useCallback(() => setState((s) => dismissError(s)), []);

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

  return (
    <>
      <div className="topbar">
        <a className="brand" href="#/">
          Pokernight
        </a>
        <span className="meta">
          <strong>{tableName ?? tableId}</strong>
          {/* The settlement mode travels with the table's NAME, so it is on screen from the moment
              the page opens and before anyone can reach a seat. */}
          <SettlementTag settlement={settlement} rate={tableRate(settlement, chipValue)} withRate />
          {state.view?.hand ? <span className="num">hand #{state.view.hand.handNo}</span> : null}
        </span>
        <span className="spacer" />
        <span className="meta">
          <span className={`conn ${state.connection}`}>{state.connection}</span>
          {session ? <Identity session={session} onSignOut={onSignOut} /> : <a href="#/">sign in</a>}
        </span>
      </div>
      <div className="page table-page">
        <Table state={state} session={session} send={send} settlement={settlement} chipValue={chipValue} treasury={treasury} />
        <aside className="side">
          {/* A player who is not ready to sit sees the ONE action that fixes that, above the money
              summary — not a refusal pointing at a panel somewhere else. */}
          {settles && session && !ready ? <StartPanel session={session} config={config} treasury={treasury} onChanged={loadTreasury} /> : null}
          <MoneyPanel
            tableId={tableId}
            settlement={settlement}
            chipValue={chipValue}
            session={session}
            treasury={treasury}
            onChanged={loadTreasury}
          />
          <LogPanel log={state.log} ctx={ctx} canChat={session != null} onChat={(text) => send({ type: 'chat', text })} />
        </aside>
      </div>
      <Toast error={state.error} onDismiss={onDismiss} />
    </>
  );
}
