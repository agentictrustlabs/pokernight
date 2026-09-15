import { gameLabel } from '../lib/games';
import { PRODUCT_NAME } from '../lib/brand';

/**
 * What a table looks like when this client cannot draw it.
 *
 * The room deals more than one game; this client draws poker. Sitting somebody down at a
 * canasta table in a poker board would show them a hand that is not theirs, a pot that does not
 * exist and controls that do nothing — so the honest screen is this one, which names the game, says
 * plainly that the seat is not here yet, and points back to the room.
 *
 * It is deliberately a real screen rather than an error. The table is fine. The person is in the
 * right place. It is this client that is behind, and it should say so in those words.
 */
export function OtherGame({ game, tableName }: { game: string; tableName?: string | null }) {
  const name = gameLabel(game);
  return (
    <section className="panel other-game">
      <h2>{name} is dealt here</h2>
      <p>
        {tableName ? <strong>{tableName}</strong> : 'This table'} is a game of {name}. {PRODUCT_NAME} can deal it, but
        this room screen only knows how to draw a poker table — so there is no seat here to take yet.
      </p>
      <p className="hint">
        Nothing is wrong with the table. Its round is running on the service exactly as it should, and a {name} screen
        is what is still to be built.
      </p>
      <p>
        <a className="small" href="#/">
          ← Back to the lobby
        </a>
      </p>
    </section>
  );
}
