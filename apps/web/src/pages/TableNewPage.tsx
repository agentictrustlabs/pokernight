import { useEffect, useState } from 'react';
import type { AppSession, CreateTableRequest, Night } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { BOARDS, DRAWN_GAME, gameBlurb, gameLabel } from '../lib/games';
import { MONEY_HASH, TABLES_HASH, clubHash } from '../lib/routes';
import { nightWhen } from '../lib/nights';
import { MissionPicker } from '../components/MissionPicker';

/**
 * OPENING A TABLE is its own page (2026-09-14). It was a form folded behind a `<details>` at the bottom of two
 * pages — ten fields one under another, "just a scrolling page". Here it is laid out as the two things it is:
 * THE TABLE (its name, its game, who is coming) and THE STAKES (seats, blinds, buy-ins, settlement — hold'em's
 * only), side by side, with the page's name at the top and the way back beside the button.
 *
 * For a club it opens a private table; for a NIGHT (`?night=`) it opens one of that night's tables — the game
 * is the night's, fixed, and the night's guest is the table's unless another is named. A night has any number
 * of tables of its one game.
 */
export function TableNewPage({ session, money, club, night: nightId, ready = true }: { session: AppSession; money: string; club: string | null; night?: string | null; ready?: boolean }) {
  const [clubName, setClubName] = useState<string | null>(null);
  const [night, setNight] = useState<Night | null>(null);
  const [nightErr, setNightErr] = useState<string | null>(null);
  useEffect(() => {
    if (!club) return;
    let alive = true;
    api.getClub(club, session.token).then((v) => {
      if (!alive) return;
      setClubName(v.name);
      if (nightId) {
        const n = v.nights.find((x) => x.nightId === nightId) ?? null;
        setNight(n);
        if (!n) setNightErr('That night is not on the club’s calendar any more.');
      }
    }).catch(() => alive && setNightErr('Could not read the club.'));
    return () => { alive = false; };
  }, [club, nightId, session.token]);

  const back = club ? clubHash(club) : TABLES_HASH;
  const [name, setName] = useState('');
  const [game, setGame] = useState<string>(DRAWN_GAME);
  const [guest, setGuest] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<'play-money' | 'mandate-transfer'>('play-money');
  const [seats, setSeats] = useState(6);
  const [sb, setSb] = useState(1);
  const [bb, setBb] = useState(2);
  const [minBuy, setMinBuy] = useState(40);
  const [maxBuy, setMaxBuy] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A night fixes the game and offers its guest; both are the night's word, taken once when it is read.
  useEffect(() => {
    if (!night) return;
    if (night.game) setGame(night.game);
    if (night.mission) setGuest(night.mission.entryId);
    if (!name) setName(night.title ? `${night.title} · table` : `${nightWhen(night, Date.now()).day} · table`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night]);

  const poker = game === DRAWN_GAME;
  const valid = name.trim().length > 0 && (!poker || (seats >= 2 && seats <= 9 && sb > 0 && bb >= sb && minBuy > 0 && maxBuy >= minBuy));
  const w = night ? nightWhen(night, Date.now()) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    const req: CreateTableRequest = {
      name: name.trim(),
      settlement: poker ? settlement : 'play-money',
      game,
      config: poker ? { seats, smallBlind: sb, bigBlind: bb, minBuyIn: minBuy, maxBuyIn: maxBuy } : {},
      ...(club ? { club } : {}),
      ...(night ? { night: night.nightId } : {}),
      ...(guest ? { mission: guest } : {}),
    };
    try {
      const t = await api.createTable(req, session.token);
      location.hash = `#/t/${encodeURIComponent(t.tableId)}`;
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : ex instanceof Error ? ex.message : String(ex));
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">{club ? clubName ?? 'Your club' : 'Tables'}</span>
          <h1>{night ? `A table for ${night.title ?? 'the night'}` : club ? 'Open a private table' : 'Open a table'}</h1>
        </div>
        <p className="lede">
          {night && w
            ? `${w.day} at ${w.time}. Every table of a night deals the night's one game; the night's guest is this table's unless you name another.`
            : club
              ? 'Only this club’s members will see it, and only they can sit at it.'
              : 'Anyone signed in can see this one and sit at it. A club’s own page opens a private one.'}
        </p>
      </header>

      {nightErr ? <div className="form-error">{nightErr}</div> : null}

      <form className="table-new" onSubmit={submit}>
        <section className="panel table-new-col">
          <h2 className="eyebrow-h">The table</h2>
          <label>
            Name
            <input type="text" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Tuesday night" autoFocus />
          </label>
          <label>
            Game
            <select value={game} onChange={(e) => setGame(e.target.value)} disabled={!!night?.game}>
              {BOARDS.map((g) => (
                <option key={g} value={g}>{gameLabel(g)}</option>
              ))}
            </select>
            <span className="hint">{night?.game ? `The night plays ${gameLabel(night.game)}.` : gameBlurb(game)}</span>
          </label>
          <label>
            Guest mission
            <MissionPicker value={guest} onChange={(id) => setGuest(id ?? null)} />
            <span className="hint">{night?.mission ? `The night's guest is ${night.mission.name}; keep it, or name another for this table.` : 'A registered mission, introduced at the table — its people join the talk. Optional.'}</span>
          </label>
        </section>

        <section className="panel table-new-col">
          <h2 className="eyebrow-h">The stakes</h2>
          {!poker ? (
            <p className="hint">Four players in two partnerships — seats 1 and 3 against 2 and 4 — played to 5,000. No stakes: canasta is played for score, and it settles nothing.</p>
          ) : (
            <>
              <label>
                Seats
                <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="pair">
                <label>Small blind<input type="number" min={1} value={sb} onChange={(e) => setSb(Number(e.target.value))} /></label>
                <label>Big blind<input type="number" min={1} value={bb} onChange={(e) => setBb(Number(e.target.value))} /></label>
              </div>
              <div className="pair">
                <label>Min buy-in<input type="number" min={1} value={minBuy} onChange={(e) => setMinBuy(Number(e.target.value))} /></label>
                <label>Max buy-in<input type="number" min={1} value={maxBuy} onChange={(e) => setMaxBuy(Number(e.target.value))} /></label>
              </div>
              <label>
                Settlement
                <select value={settlement} onChange={(e) => setSettlement(e.target.value as 'play-money' | 'mandate-transfer')}>
                  <option value="play-money">play money</option>
                  <option value="mandate-transfer">{money} (mandate transfer)</option>
                </select>
              </label>
              {settlement === 'mandate-transfer' && !ready ? (
                <p className="hint form-warn">You are not set up to take a seat at a money table yet. You can still open one for other people — <a href={MONEY_HASH}>get set up</a> and you can sit at it too.</p>
              ) : null}
              {settlement === 'mandate-transfer' ? (
                <p className="hint">Buy-ins and cash-outs move {money} between each player’s own account and the house. A player needs an account, {money} in it, and to have authorised this table to take the buy-in; a seat missing one is refused and told which.</p>
              ) : null}
            </>
          )}
        </section>

        <div className="table-new-actions">
          {err ? <div className="form-error">{err}</div> : null}
          <div className="row">
            <button className="primary" type="submit" disabled={busy || !valid || (!!nightId && !night)}>{busy ? 'Opening…' : 'Open table'}</button>
            <a className="small" href={back}>Cancel</a>
          </div>
        </div>
      </form>
    </div>
  );
}
