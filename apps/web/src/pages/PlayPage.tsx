import { useEffect, useState } from 'react';
import type { AppSession, TableSummary } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { gameLabel } from '../lib/games';
import { TABLES_HASH } from '../lib/routes';
import { seatsFree, withRoom } from '../lib/lobby';

/**
 * PLAY — the first row in the rail, and what a signed-in person sees at the front door.
 *
 * ONE PRESS TO A HAND. Every card site worth copying spends its first slot on being dealt in rather
 * than on a lobby (`docs/NAVIGATION-RESEARCH.md` §12.1), and this card room has an unfair advantage
 * at it: the engines are pure and seeded, the house agents already play both games, and a practice
 * table is derived from who you are rather than created — so "deal me a hand" is one request and
 * costs the card room nothing that has to be cleaned up afterwards.
 *
 * It leads with the game somebody is most likely to be LEARNING, because a person who already knows
 * how to play does not come here — they go to Tables, which is one row down and is where leaving a
 * table lands them.
 *
 * NOTHING HERE NEEDS A CLUB, AND NOTHING HERE NEEDS MONEY. That is the whole point of it being first:
 * the commonest visitor has neither, and every other row in the rail asks for one of them.
 */
export function PlayPage({ session }: { session: AppSession }) {
  return (
    <div className="play">
      <PracticeCard session={session} game="canasta" />
      <PracticeCard session={session} game="texas-holdem" />
      <Running session={session} />
    </div>
  );
}

/** What each practice table is FOR, in the words of somebody who does not know the game yet. */
const PITCH: Record<string, { title: string; blurb: string; cta: string }> = {
  canasta: {
    title: 'Learn canasta',
    blurb:
      'Your own table, with three of the house players and somebody talking you through every move — what to draw, what to keep, and why a three is worth putting down. Leave whenever you like; it is still here, and one press deals a new game.',
    cta: 'Deal me in',
  },
  'texas-holdem': {
    title: 'Play hold’em against the house',
    blurb:
      'Your own table and the house players, for play money. No buy-in, no authorisation, nothing to set up — it is the same engine the money tables run, so what works here works there.',
    cta: 'Deal me in',
  },
};

/**
 * One press to a table of your own.
 *
 * The table is the SAME one every time: the card room derives its id from who you are rather than
 * storing one, so this is not "make me another" but "take me to mine". It is in no listing, it
 * settles nothing, and its owner can deal again without leaving a dead game behind.
 */
function PracticeCard({ session, game }: { session: AppSession; game: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pitch = PITCH[game] ?? { title: `Play ${gameLabel(game)}`, blurb: 'Your own table, with the house players.', cta: 'Deal me in' };

  return (
    <section className={`panel play-card play-${game}`}>
      <h2>{pitch.title}</h2>
      <p className="hint">{pitch.blurb}</p>
      {err ? <div className="form-error">{err}</div> : null}
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const { tableId } = await api.practiceTable(game, session.token);
            // `?practice=1` tells the table page to set the table up — sit you down, fill the other
            // chairs, switch the coach on — rather than sit you in front of it and wait.
            location.hash = `#/t/${encodeURIComponent(tableId)}?practice=1`;
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : 'Could not open your table.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Dealing…' : pitch.cta}
      </button>
    </section>
  );
}

/**
 * Where you already are, and where there is room — but only when there is something to say.
 *
 * This page is about starting, so it never becomes a table list: at most a couple of lines, and
 * nothing at all when nothing is running. An empty "no tables" panel on the front door would be the
 * newcomer's first impression of a card room, and it would be of an empty one.
 */
function Running({ session }: { session: AppSession }) {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .listTables(session.token)
      .then((t) => alive && setTables(t))
      .catch(() => alive && setTables([]));
    return () => {
      alive = false;
    };
  }, [session.token]);

  const open = withRoom(tables);
  if (open.length === 0) return null;
  const first = open[0] as TableSummary;
  return (
    <section className="panel play-running">
      <h2>Or sit with other people</h2>
      <p className="hint">
        {open.length === 1
          ? `${first.name} has room — ${gameLabel(first.game)}, ${seatsFree(first)} free.`
          : `${open.length} tables have room right now.`}
      </p>
      <a className="small" href={TABLES_HASH}>
        See what is running →
      </a>
    </section>
  );
}
