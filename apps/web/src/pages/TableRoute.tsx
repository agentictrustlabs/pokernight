import { useEffect, useState } from 'react';
import type { AppSession } from '../lib/types';
import type { AuthConfig } from '../lib/home';
import { api } from '../lib/api';
import { DRAWN_GAME, drawsGame, gameLabel } from '../lib/games';
import { OtherGame } from '../components/OtherGame';
import { PRODUCT_NAME } from '../lib/brand';
import { CanastaPage } from './CanastaPage';
import { TablePage } from './TablePage';

/**
 * Which board to draw for a table.
 *
 * A CLIENT DRAWS ONE GAME PER BOARD, and this is where it chooses. It cost a crash to learn that:
 * a canasta table was listed in the lobby, somebody pressed Join, and the poker board mounted
 * against a canasta view and died on `view.config.bigBlind`. The lesson was not "check harder in
 * the poker board" — it was that a board should never be handed another game's table at all.
 *
 * The game comes from the table's own summary, which is stamped at creation and never re-read. That
 * means one HTTP read before anything mounts. It is worth it: mounting a board and then discovering
 * it is the wrong one means the wrong socket, the wrong reducer and a frame of the wrong screen.
 */
export function TableRoute({
  tableId,
  practice,
  session,
  config,
  onSignOut,
}: {
  tableId: string;
  /** Set the table up on arrival — a seat, the other three filled, the coach on. */
  practice: boolean;
  session: AppSession | null;
  config: AuthConfig | null;
  onSignOut: () => void;
}) {
  const [game, setGame] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const token = session?.token ?? undefined;

  useEffect(() => {
    let alive = true;
    setGame(null);
    setMissing(false);
    // ONE TABLE, not the lobby. A club's tables are not in the public list, so a route that read
    // the list could not name the game for exactly the tables that are private — which is how the
    // first version of this sent every club table to "that table is not here".
    api
      .getTable(tableId, token)
      .then((detail) => {
        if (!alive) return;
        setGame(detail.game ?? DRAWN_GAME);
      })
      // A 404 here is a table that is gone OR one this person may not see, and the card room
      // deliberately does not say which. Neither is a table to draw a board for.
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [tableId, token]);

  if (missing) {
    return (
      <div className="page">
        <section className="panel">
          <h2>That table is not here</h2>
          <p>
            It may have been retired, or it may belong to a club you are not in. {PRODUCT_NAME} does not say which.
          </p>
          <a className="small" href="#/">
            ← Back to the lobby
          </a>
        </section>
      </div>
    );
  }

  if (game === null) return <div className="page"><p className="hint">Opening the table…</p></div>;
  if (game === 'canasta') return <CanastaPage tableId={tableId} practice={practice} session={session} onSignOut={onSignOut} />;
  if (drawsGame(game)) return <TablePage tableId={tableId} practice={practice} session={session} config={config} onSignOut={onSignOut} />;

  return (
    <div className="page">
      <OtherGame game={game} tableName={gameLabel(game)} />
    </div>
  );
}
