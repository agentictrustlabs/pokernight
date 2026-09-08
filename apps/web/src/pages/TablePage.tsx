import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientCommand, Session } from '../lib/types';
import { api, tableSocketUrl } from '../lib/api';
import { TableSocket, dismissError, initialState, reduce, setConnection, type TableState } from '../lib/tableSocket';
import { LogPanel } from '../components/LogPanel';
import { Table } from '../components/Table';
import { Toast } from '../components/Toast';

export function TablePage({ tableId, session }: { tableId: string; session: Session | null }) {
  const [state, setState] = useState<TableState>(initialState);
  const [tableName, setTableName] = useState<string | null>(null);
  const sockRef = useRef<TableSocket | null>(null);
  const token = session?.token ?? null;

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
        if (alive) setTableName(ts.find((t) => t.tableId === tableId)?.name ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tableId, token]);

  const send = useCallback((c: ClientCommand) => sockRef.current?.send(c), []);
  const onDismiss = useCallback(() => setState((s) => dismissError(s)), []);

  const ctx = useMemo(() => {
    const bySeat = new Map<number, string>();
    const seatOfPlayer = new Map<string, number>();
    for (const s of state.view?.seats ?? []) {
      bySeat.set(s.seat, state.names[s.playerId] ?? s.playerId.slice(0, 8));
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
          {state.view?.hand ? <span className="num">hand #{state.view.hand.handNo}</span> : null}
        </span>
        <span className="spacer" />
        <span className="meta">
          <span className={`conn ${state.connection}`}>{state.connection}</span>
          {session ? <span>{session.name}</span> : <a href="#/">log in</a>}
        </span>
      </div>
      <div className="page table-page">
        <Table state={state} session={session} send={send} />
        <aside className="side">
          <LogPanel log={state.log} ctx={ctx} canChat={session != null} onChat={(text) => send({ type: 'chat', text })} />
        </aside>
      </div>
      <Toast error={state.error} onDismiss={onDismiss} />
    </>
  );
}
