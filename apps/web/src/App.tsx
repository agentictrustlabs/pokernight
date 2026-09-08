import { useCallback, useState } from 'react';
import type { Session } from './lib/types';
import { loadSession, saveSession } from './lib/api';
import { useHash } from './lib/hooks';
import { CardDefs } from './components/Card';
import { Lobby } from './pages/Lobby';
import { TablePage } from './pages/TablePage';

/** Hash routes: `#/` lobby, `#/t/<tableId>` table. */
function route(hash: string): { page: 'lobby' } | { page: 'table'; tableId: string } {
  const m = /^\/t\/([^/?#]+)/.exec(hash);
  if (m?.[1]) return { page: 'table', tableId: decodeURIComponent(m[1]) };
  return { page: 'lobby' };
}

export function App() {
  const hash = useHash();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const login = useCallback((s: Session) => {
    saveSession(s);
    setSession(s);
  }, []);
  const logout = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);
  const r = route(hash);

  return (
    <div className="app">
      <CardDefs />
      {r.page === 'table' ? (
        <TablePage tableId={r.tableId} session={session} />
      ) : (
        <>
          <div className="topbar">
            <a className="brand" href="#/">
              Pokernight
            </a>
            <span className="spacer" />
            <span className="meta">card room · play money</span>
          </div>
          <div className="page">
            <Lobby session={session} onLogin={login} onLogout={logout} />
          </div>
        </>
      )}
    </div>
  );
}
