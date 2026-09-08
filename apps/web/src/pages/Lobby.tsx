import { useEffect, useState } from 'react';
import type { AuthState } from '../App';
import type { AppSession, CreateTableRequest, Session, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { fmtChips } from '../lib/format';

const POLL_MS = 5000;

export function Lobby({ session, auth, onLogin }: { session: AppSession | null; auth: AuthState; onLogin: (s: AppSession) => void }) {
  if (!session) return <SignIn auth={auth} onLogin={onLogin} />;
  return (
    <div className="lobby">
      <TableList session={session} />
      <CreateTable session={session} />
    </div>
  );
}

/**
 * The front door. Home sign-in is THE way in; the dev name box is a clearly secondary affordance and
 * appears only where `GET /auth/config` says dev auth is on (localhost today). Every failure — the
 * config not loading, a cancelled ceremony, a rejected token — lands here as a sentence and a retry,
 * never a blank screen.
 */
function SignIn({ auth, onLogin }: { auth: AuthState; onLogin: (s: AppSession) => void }) {
  const { config, configError, busy, error } = auth;
  const homeHost = config?.home.origin ? safeHost(config.home.origin) : null;
  return (
    <div className="panel login">
      <h1>Pokernight</h1>
      {error ? (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button className="quiet small" type="button" onClick={auth.dismissError}>
            dismiss
          </button>
        </div>
      ) : null}

      {configError ? (
        <>
          <p className="hint">The table service did not answer, so we cannot tell which sign-in this room accepts.</p>
          <div className="form-error">{configError}</div>
          <button className="primary" type="button" onClick={() => location.reload()}>
            Try again
          </button>
        </>
      ) : !config ? (
        <p className="hint">Checking how you sign in…</p>
      ) : (
        <>
          <p className="hint">
            Sign in with your Home{homeHost ? ` at ${homeHost}` : ''}. Your Smart Agent proves who you are; the card room never sees a
            password and never holds your keys.
          </p>
          <button className="primary" type="button" onClick={auth.signInWithHome} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in with your Home'}
          </button>
          {config.devAuth ? <DevLogin onLogin={onLogin} /> : null}
        </>
      )}
    </div>
  );
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Dev-only name login. Proves nothing; only offered where the API says DEV_AUTH is on. */
function DevLogin({ onLogin }: { onLogin: (s: AppSession) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="form dev-login"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        setBusy(true);
        setErr(null);
        try {
          const s: Session = await api.devLogin(n);
          onLogin({ ...s, via: 'dev' });
        } catch (ex) {
          setErr(ex instanceof Error ? ex.message : String(ex));
        } finally {
          setBusy(false);
        }
      }}
    >
      <hr />
      <p className="hint">Or, on this development deployment only: pick a name and a play-money session is minted for you. No proof of anything.</p>
      <label>
        Name
        <input type="text" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
      </label>
      {err ? <div className="form-error">{err}</div> : null}
      <button className="quiet" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Signing in…' : 'Enter with a dev name'}
      </button>
    </form>
  );
}

function TableList({ session }: { session: AppSession }) {
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
      <h2>Tables</h2>
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

function CreateTable({ session }: { session: AppSession }) {
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
