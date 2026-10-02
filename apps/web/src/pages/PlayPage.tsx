import { useEffect, useState } from 'react';
import type { AppSession, TableSummary } from '../lib/types';
import { ApiError, api, commissionApi, fieldOpsApi, mysteryApi, type CommissionScenarioSummary, type FieldOpsScenarioSummary, type MysteryTitleSummary } from '../lib/api';
import { gameLabel } from '../lib/games';
import { commissionHash, fieldOpsHash, goTo, mysteryHash, TABLES_HASH } from '../lib/routes';
import { seatsFree, withRoom } from '../lib/lobby';
import { Drawer } from '../components/Drawer';

/**
 * PLAY — the first row in the rail, and what a signed-in person sees at the front door.
 *
 * ONE PRESS TO A HAND. Every card site worth copying spends its first slot on being dealt in rather
 * than on a lobby (`docs/NAVIGATION-RESEARCH.md` §12.1), and this room has an unfair advantage
 * at it: the engines are pure and seeded, the house agents already play both games, and a practice
 * table is derived from who you are rather than created — so "deal me a hand" is one request and
 * costs the room nothing that has to be cleaned up afterwards.
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
      <MysteryCard session={session} />
      <CommissionCard session={session} />
      <FieldOpsCard session={session} />
      <PracticeCard session={session} game="canasta" />
      <PracticeCard session={session} game="poker" />
      <Running session={session} />
      {/* NO MISSIONS HERE (2026-09-15). Somebody who has just come in came to play; the missions have a page
          of their own and a row in the rail, and a map on the front door for anybody still deciding. */}
    </div>
  );
}

/**
 * A MYSTERY IS NOT A TABLE, and this card is where that starts (docs/MYSTERY-NIGHT.md §10).
 *
 * One press and you are in the Belvedere's lobby with seven characters who talk back, each played by one of
 * the estate's own agents. Your part is yours to pick; the killer is drawn from a seed committed to before
 * the first word, and if it is you, you will be the only one told.
 */
function MysteryCard({ session }: { session: AppSession }) {
  const [titles, setTitles] = useState<MysteryTitleSummary[] | null>(null);
  const [role, setRole] = useState('');
  const [killer, setKiller] = useState<'chance' | 'me'>('chance');
  const [pace, setPace] = useState<'short' | 'full'>('short');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    mysteryApi.titles().then((r) => alive && setTitles(r.titles)).catch(() => alive && setTitles([]));
    return () => { alive = false; };
  }, []);
  const title = titles?.[0] ?? null;
  return (
    <section className="panel play-card play-mystery">
      <div className="play-band">
        <span className="play-suit" aria-hidden="true">♦</span>
        <div>
          <span className="play-kicker">{title ? `${title.venueName} · ${title.cast} parts · ${title.acts} acts` : 'Mystery Night'}</span>
          <h2>{title ? title.name : 'A mystery night'}</h2>
        </div>
      </div>
      <div className="play-body">
        <p className="hint">{title ? title.blurb : 'A story at a place, with a cast who talk back.'}</p>
        {/* THE CHOICES ARE BEHIND ONE PRESS (2026-09-18): four cards with their options open pushed hold'em
            below the fold — "first click on the game and then select your stuff". The card is the pitch and one
            button; the night's own choices open beside the page. */}
        <button type="button" className="primary" disabled={!title} onClick={() => setOpen(true)}>Set up the night…</button>
      </div>
      <Drawer open={open} title={title ? title.name : 'A mystery night'} onClose={() => setOpen(false)}>
        {title ? (
          <label className="mystery-part">
            How long you have
            <select value={pace} onChange={(e) => setPace(e.target.value as 'short' | 'full')}>
              <option value="short">A short night — three acts in about twenty minutes</option>
              <option value="full">The whole evening — an hour at the Belvedere</option>
            </select>
          </label>
        ) : null}
        {title ? (
          <label className="mystery-part">
            Tonight
            <select value={killer} onChange={(e) => setKiller(e.target.value as 'chance' | 'me')}>
              <option value="chance">Let the seed decide who did it</option>
              <option value="me">Make it me — I want to be the one who did it</option>
            </select>
            <span className="hint">Either way the draw is made from a seed committed to before the first word, and the reveal proves it.</span>
          </label>
        ) : null}
        {title ? (
          <label className="mystery-part">
            Your part
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Whoever the house gives you</option>
              {title.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <span className="hint">{title.roles.find((r) => r.id === role)?.blurb ?? title.tone}</span>
          </label>
        ) : null}
        {err ? <div className="form-error">{err}</div> : null}
        <button
          type="button"
          className="primary"
          disabled={busy || !title}
          onClick={async () => {
            if (!title) return;
            setBusy(true); setErr(null);
            try {
              const r = await mysteryApi.solo({ title: title.id, killer, pace, ...(role ? { role } : {}) }, session.token);
              goTo(mysteryHash(r.staging.stagingId));
            } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
          }}
        >
          {busy ? 'Setting the scene…' : 'Begin the night'}
        </button>
      </Drawer>
    </section>
  );
}

/**
 * A NIGHT IN THE MARCHES (docs/GREAT-COMMISSION.md).
 *
 * The third game and the first that is a substrate test: five fictional peoples whose hidden state moves on
 * its own, seven parts who hold testimony in vaults, and one adversary reading the same coarsened signals. One
 * press and you are in the commons with six characters played by the estate's own agents. Your part is yours to
 * pick; the world's schedule is drawn from a seed committed to before the first word.
 */
function CommissionCard({ session }: { session: AppSession }) {
  const [scenarios, setScenarios] = useState<CommissionScenarioSummary[] | null>(null);
  const [scenario, setScenario] = useState('');
  const [role, setRole] = useState('');
  const [pace, setPace] = useState<'short' | 'full'>('short');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    commissionApi.scenarios().then((r) => alive && setScenarios(r.scenarios)).catch(() => alive && setScenarios([]));
    return () => { alive = false; };
  }, []);
  const chosen = scenarios?.find((s) => s.id === scenario) ?? scenarios?.[0] ?? null;
  return (
    <section className="panel play-card play-commission">
      <div className="play-band">
        <span className="play-suit" aria-hidden="true">✦</span>
        <div>
          <span className="play-kicker">{chosen ? `${chosen.regionName} · ${chosen.cast} parts · ${chosen.rounds} rounds` : 'Great Commission'}</span>
          <h2>{chosen ? chosen.name : scenarios === null ? 'Great Commission' : 'Great Commission — unavailable'}</h2>
        </div>
      </div>
      <div className="play-body">
        {/* THE CARD BEFORE IT KNOWS WHICH NIGHT. Three states and each says which it is: still asking, nothing
            offered (the button is disabled either way, and a disabled button with no sentence is a dead end),
            or the night's own words. The old fallback promised an adversary the game no longer has — the part
            that carries it out of the room is drawn now, and nobody at the table knows who. */}
        <p className="hint">
          {chosen ? chosen.blurb
            : scenarios === null ? 'A substrate test played as a game: assemble a true picture of where the gospel is moving, before somebody assembles a dangerous one.'
              : 'No night is being offered here at the moment. Try again in a minute.'}
        </p>
        <button type="button" className="primary" disabled={!chosen} onClick={() => setOpen(true)}>Set up the night…</button>
      </div>
      <Drawer open={open} title={chosen ? chosen.name : 'Great Commission'} onClose={() => setOpen(false)}>
        {scenarios && scenarios.length > 1 ? (
          <label className="mystery-part">
            Which night
            <select value={chosen?.id ?? ''} onChange={(e) => { setScenario(e.target.value); setRole(''); }}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>Night {s.night} — {s.name}</option>)}
            </select>
          </label>
        ) : null}
        {chosen ? (
          <label className="mystery-part">
            How long you have
            <select value={pace} onChange={(e) => setPace(e.target.value as 'short' | 'full')}>
              <option value="short">A short night — three rounds in about fifteen minutes</option>
              <option value="full">The whole evening — about an hour</option>
            </select>
          </label>
        ) : null}
        {chosen ? (
          <label className="mystery-part">
            Your part
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Whoever the house gives you</option>
              {chosen.roles.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.kind}</option>)}
            </select>
            <span className="hint">{role === 'watch' ? 'Every part is played by its own agent at the Home; you look on, and the season runs while you are actually at the page.' : chosen.roles.find((r) => r.id === role)?.blurb ?? chosen.tone}</span>
          </label>
        ) : null}
        {err ? <div className="form-error">{err}</div> : null}
        <button
          type="button"
          className="primary"
          disabled={busy || !chosen}
          onClick={async () => {
            if (!chosen) return;
            setBusy(true); setErr(null);
            try {
              const r = await commissionApi.solo({ scenario: chosen.id, pace, ...(role ? { role } : {}) }, session.token);
              goTo(commissionHash(r.staging.stagingId));
            } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
          }}
        >
          {busy ? 'Opening the road…' : `Come to ${chosen?.regionName ?? 'the night'}`}
        </button>
      </Drawer>
    </section>
  );
}


/**
 * A SEASON OF FIELD OPERATIONS (docs/FIELD-OPERATIONS.md).
 *
 * The fourth game and the first played on a map by REAL AGENTS: four teams of worker personas, four partner-church
 * agents, twelve of the public registry's people communities, each starting where the public picture puts it. One
 * press and you are a worker on a team for six weeks that play out in minutes; what the season does is written to
 * the field app, marked as a game's, and the score says how far the field moved and how every agent played.
 */
function FieldOpsCard({ session }: { session: AppSession }) {
  const [scenarios, setScenarios] = useState<FieldOpsScenarioSummary[] | null>(null);
  const [role, setRole] = useState('');
  const [pace, setPace] = useState<'short' | 'full'>('short');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    fieldOpsApi.scenarios().then((r) => alive && setScenarios(r.scenarios)).catch(() => alive && setScenarios([]));
    return () => { alive = false; };
  }, []);
  const chosen = scenarios?.[0] ?? null;
  const floors = chosen ? chosen.communities.reduce<Record<number, number>>((m, c) => ({ ...m, [c.phase]: (m[c.phase] ?? 0) + 1 }), {}) : {};
  return (
    <section className="panel play-card play-fieldops">
      <div className="play-band">
        <span className="play-suit" aria-hidden="true">⛰</span>
        <div>
          <span className="play-kicker">{chosen ? `${chosen.regionName} · ${chosen.teams.length} teams · ${chosen.communities.length} communities · ${chosen.weeks} weeks` : 'Field Operations'}</span>
          <h2>{chosen ? chosen.name : scenarios === null ? 'Field Operations' : 'Field Operations — unavailable'}</h2>
        </div>
      </div>
      <div className="play-body">
        <p className="hint">
          {chosen ? chosen.blurb : scenarios === null ? 'A season of field work north of Denver, played by real agents toward Phase 7.' : 'No season is being offered here at the moment. Try again in a minute.'}
        </p>
        {chosen ? <p className="hint small">The registry's floor: {Object.entries(floors).sort().map(([p, n]) => `${n} at P${p}`).join(', ')}{chosen.registryReadAt ? ` (read ${chosen.registryReadAt.slice(0, 10)})` : ''}.</p> : null}
        <button type="button" className="primary" disabled={!chosen} onClick={() => setOpen(true)}>Set up the season…</button>
      </div>
      <Drawer open={open} title={chosen ? chosen.name : 'Field Operations'} onClose={() => setOpen(false)}>
        {chosen ? (
          <label className="mystery-part">
            How long you have
            <select value={pace} onChange={(e) => setPace(e.target.value as 'short' | 'full')}>
              <option value="short">A short season — six weeks in about twenty minutes</option>
              <option value="full">The whole season — a day a minute, about an hour</option>
            </select>
            <span className="hint">A day lasts longer when agents are playing, so every one of them gets asked.</span>
          </label>
        ) : null}
        {chosen ? (
          <label className="mystery-part">
            Your part
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Whoever the field gives you</option>
              <option value="watch">Nobody — watch all sixteen agents play it</option>
              {chosen.roles.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.kind}{r.team ? ` · ${chosen.teams.find((t) => t.id === r.team)?.name ?? r.team}` : ''}</option>)}
            </select>
            <span className="hint">{chosen.roles.find((r) => r.id === role)?.blurb ?? chosen.tone}</span>
          </label>
        ) : null}
        {err ? <div className="form-error">{err}</div> : null}
        <button
          type="button"
          className="primary"
          disabled={busy || !chosen}
          onClick={async () => {
            if (!chosen) return;
            setBusy(true); setErr(null);
            try {
              const r = await fieldOpsApi.solo({ scenario: chosen.id, pace, ...(role ? { role } : {}) }, session.token);
              goTo(fieldOpsHash(r.staging.stagingId));
            } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
          }}
        >
          {busy ? 'Driving out…' : 'Start the season'}
        </button>
      </Drawer>
    </section>
  );
}

/** What each practice table is FOR, in the words of somebody who does not know the game yet. */
const PITCH: Record<string, { title: string; blurb: string; cta: string; suit: string; kicker: string }> = {
  canasta: {
    suit: '♣',
    kicker: 'Classic canasta · with a coach',
    title: 'Learn canasta',
    blurb:
      'Your own table, with three of the house players and somebody talking you through every move — what to draw, what to keep, and why a three is worth putting down. Leave whenever you like; it is still here, and one press deals a new game.',
    cta: 'Deal me in',
  },
  poker: {
    suit: '♠',
    kicker: 'Texas hold’em · play money',
    title: 'Play hold’em against the house',
    blurb:
      'Your own table and the house players, for play money. No buy-in, no authorisation, nothing to set up — it is the same engine the money tables run, so what works here works there.',
    cta: 'Deal me in',
  },
};

/**
 * One press to a table of your own.
 *
 * The table is the SAME one every time: the room derives its id from who you are rather than
 * storing one, so this is not "make me another" but "take me to mine". It is in no listing, it
 * settles nothing, and its owner can deal again without leaving a dead game behind.
 */
function PracticeCard({ session, game }: { session: AppSession; game: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pitch = PITCH[game] ?? { title: `Play ${gameLabel(game)}`, blurb: 'Your own table, with the house players.', cta: 'Deal me in', suit: '♦', kicker: 'play money' };

  return (
    <section className={`panel play-card play-${game}`}>
      {/* The felt band: the game's suit, what kind of table this is, and its name — the landing's hero, per game. */}
      <div className="play-band">
        <span className="play-suit" aria-hidden="true">{pitch.suit}</span>
        <div>
          <span className="play-kicker">{pitch.kicker}</span>
          <h2>{pitch.title}</h2>
        </div>
      </div>
      <div className="play-body">
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
      </div>
    </section>
  );
}

/**
 * Where you already are, and where there is room — but only when there is something to say.
 *
 * This page is about starting, so it never becomes a table list: at most a couple of lines, and
 * nothing at all when nothing is running. An empty "no tables" panel on the front door would be the
 * newcomer's first impression of a room, and it would be of an empty one.
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
