import { useEffect, useState } from 'react';
import type { CreateTableRequest, Session, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { fmtChips } from '../lib/format';

const POLL_MS = 5000;

export function Lobby({ session, onLogin, onLogout }: { session: Session | null; onLogin: (s: Session) => void; onLogout: () => void }) {
  if (!session) return <Login onLogin={onLogin} />;
  return (
    <div className="lobby">
      <TableList session={session} onLogout={onLogout} />
      <CreateTable session={session} />
    </div>
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="panel login form"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        setBusy(true);
        setErr(null);
        try {
          onLogin(await api.devLogin(n));
        } catch (ex) {
          setErr(ex instanceof Error ? ex.message : String(ex));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>Pokernight</h1>
      <p className="hint">Dev login. Pick a name; a play-money session is minted for you.</p>
      <label>
        Name
        <input type="text" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      {err ? <div className="form-error">{err}</div> : null}
      <button className="primary" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Signing in…' : 'Enter the card room'}
      </button>
    </form>
  );
}

function TableList({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const t = await api.listTables(session.token);
        if (alive) {
          setTables(t);
          setErr(null);
        }
      } catch (ex) {
        if (alive) setErr(ex instanceof ApiError ? `${ex.status}: ${ex.message}` : 'Could not reach the table service');
      }
    };
    void load();
    const h = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [session.token]);

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Tables</h2>
        <span className="hint">
          {session.name} · <button className="quiet small" onClick={onLogout}>log out</button>
        </span>
      </div>
      {err ? <div className="form-error">{err}</div> : null}
      {tables == null ? (
        <p className="hint">Loading…</p>
      ) : tables.length === 0 ? (
        <p className="hint">No tables yet. Open one on the right.</p>
      ) : (
        <div className="tables-wrap">
          <table className="tables">
            <thead>
              <tr>
                <th>Table</th>
                <th>Blinds</th>
                <th className="num">Seats</th>
                <th className="num">Buy-in</th>
                <th className="num">Hand</th>
                <th>Settlement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.tableId}>
                  <td>
                    <a href={`#/t/${encodeURIComponent(t.tableId)}`}>{t.name}</a>
                  </td>
                  <td className="mono">
                    {t.config.smallBlind}/{t.config.bigBlind}
                  </td>
                  <td className="num">
                    {t.seated}/{t.config.seats}
                  </td>
                  <td className="num">
                    {fmtChips(t.config.minBuyIn)}–{fmtChips(t.config.maxBuyIn)}
                  </td>
                  <td className="num">{t.handNo}</td>
                  <td className="hint">{t.settlement}</td>
                  <td>
                    <a className="small" href={`#/t/${encodeURIComponent(t.tableId)}`}>
                      Join →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginBottom: 0 }}>
        Refreshes every {POLL_MS / 1000} s.
      </p>
    </section>
  );
}

function CreateTable({ session }: { session: Session }) {
  const [name, setName] = useState('');
  const [seats, setSeats] = useState(6);
  const [sb, setSb] = useState(1);
  const [bb, setBb] = useState(2);
  const [minBuy, setMinBuy] = useState(40);
  const [maxBuy, setMaxBuy] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = name.trim().length > 0 && seats >= 2 && seats <= 9 && sb > 0 && bb >= sb && minBuy > 0 && maxBuy >= minBuy;

  return (
    <form
      className="panel form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setErr(null);
        const req: CreateTableRequest = {
          name: name.trim(),
          settlement: 'play-money',
          config: { seats, smallBlind: sb, bigBlind: bb, minBuyIn: minBuy, maxBuyIn: maxBuy },
        };
        try {
          const t = await api.createTable(req, session.token);
          location.hash = `#/t/${encodeURIComponent(t.tableId)}`;
        } catch (ex) {
          setErr(ex instanceof Error ? ex.message : String(ex));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Open a table</h2>
      <label>
        Name
        <input type="text" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Tuesday night" />
      </label>
      <label>
        Seats
        <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
          {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="pair">
        <label>
          Small blind
          <input type="number" min={1} value={sb} onChange={(e) => setSb(Number(e.target.value))} />
        </label>
        <label>
          Big blind
          <input type="number" min={1} value={bb} onChange={(e) => setBb(Number(e.target.value))} />
        </label>
      </div>
      <div className="pair">
        <label>
          Min buy-in
          <input type="number" min={1} value={minBuy} onChange={(e) => setMinBuy(Number(e.target.value))} />
        </label>
        <label>
          Max buy-in
          <input type="number" min={1} value={maxBuy} onChange={(e) => setMaxBuy(Number(e.target.value))} />
        </label>
      </div>
      <label>
        Settlement
        <select value="play-money" disabled>
          <option value="play-money">play-money</option>
        </select>
      </label>
      {err ? <div className="form-error">{err}</div> : null}
      <button className="primary" type="submit" disabled={busy || !valid}>
        {busy ? 'Opening…' : 'Open table'}
      </button>
    </form>
  );
}
