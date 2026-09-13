import { useEffect, useState } from 'react';
import type { AuthState } from '../App';
import type { AppSession, TableSummary } from '../lib/types';
import { api } from '../lib/api';
import { fmtChips, seatLabel } from '../lib/format';
import { dualAmount, tableRate } from '../lib/money';
import { SettlementTag } from '../components/SettlementTag';
import { describeMoment, fmtSeats, pickFeaturedTable, stakeLabel, summarizeLobby, summarizeRoster, type TableDetail } from '../lib/lobby';
import { SignInPanel } from '../components/SignInPanel';
import { brandLine } from '../lib/brand';
import { hasBoard } from '../lib/games';
import { HOME_HASH } from '../lib/routes';

const POLL_MS = 15000;

/**
 * The front door.
 *
 * Four things, in the order a stranger needs them: what this is, how it works, PROOF that it is
 * running, and the way in.
 *
 * WHAT IT SELLS. An evening together, with a mission organisation as the guest at the table. The
 * poker is the shared activity; the fellowship and the relationship with the mission are the point.
 * It does NOT sell the machinery: not agents, not the chain, not delegations, not treasuries. Those
 * are all real and all still here, one screen deeper, where somebody who wants them can find them.
 *
 * THE GIVING BOUNDARY IS PART OF THE BRAND, not a disclaimer under it. Nobody has to give to play,
 * to compete, or to belong, and this page says so where a person reads it rather than in a footer.
 * A mission that is a guest reads differently from a logo beside a donation button, and the whole
 * product rests on the difference.
 *
 * The proof is the part that matters — the lobby strip is the live `GET /tables`, and the featured
 * table's roster comes from the spectator view, so if the page says a hand is running it is because a
 * hand is running. When the room is empty it says so.
 */
export function Landing({ auth, onLogin, session = null }: { auth: AuthState; onLogin: (s: AppSession) => void; session?: AppSession | null }) {
  const live = useLiveLobby();
  // The pitch below says "play money" and never names the coin: the symbol is a detail the sign-in
  // panel states once, in the limit the Home is about to show, and the money page explains in full.
  return (
    <main className="landing">
      <Hero live={live} />
      <div className="landing-body">
        <HowItWorks />
        <LiveRoom live={live} />
        {/* THE SIGN-IN HALF IS FOR PEOPLE WHO ARE NOT SIGNED IN. Everything above it is the product
            explanation and is worth reading at any time, which is why this page has a URL now; the
            pitch below is the one part that would be talking past a reader who already has an account. */}
        <section className="landing-section" id="signin">
          <h2 className="section-title">{session ? 'What you are playing with' : 'Take a seat'}</h2>
          <div className="signin-split">
            <div className="signin-pitch">
              <h2>{session ? 'What you are playing with.' : 'There is no account to create.'}</h2>
              {session ? (
                <p>You have play money of your own, and a seat is one press away.</p>
              ) : (
                <p>
                  Sign in with a phone number, an email address or a social account. You start with{' '}
                  <strong>10,000 in play money</strong> and a seat at a table.
                </p>
              )}
              <p>
                It is <strong>play money</strong>, worth nothing outside this room, and nothing here is a wager. But it is{' '}
                <strong>yours</strong>: a buy-in comes out of your own account, and a cash-out goes straight back the moment it happens.
                Nobody keeps a tab. There is nothing to settle up at the end of the night.
              </p>
              <p>
                Chips and giving are <strong>separate</strong>. Losing a hand costs nobody anything, and giving buys no advantage at the
                table. When a mission is hosting, giving goes to them — and it is always your own choice.
              </p>
            </div>
            {session ? (
              <div className="signin-card panel">
                <h2>You are in.</h2>
                <p className="hint">Everything above is what the card room is for. The tables are where you left them.</p>
                <a className="cta" href={HOME_HASH}>
                  Play a hand
                </a>
              </div>
            ) : (
              <div className="signin-card panel">
                <SignInPanel auth={auth} onLogin={onLogin} />
              </div>
            )}
          </div>
        </section>
      </div>
      <footer className="landing-foot">
        <span>{brandLine()} · play money, and giving that is always your own choice</span>
        <span className="hint">Every deal is committed before the cards come out and revealed after, so any hand can be checked.</span>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ live */

interface LiveLobby {
  tables: TableSummary[] | null;
  featured: TableDetail | null;
  error: string | null;
}

/** The lobby as anyone can see it: `GET /tables` needs no session, and neither does this page. */
function useLiveLobby(): LiveLobby {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [featured, setFeatured] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const list = await api.listTables();
        if (!alive) return;
        setTables(list);
        setError(null);
        const pick = pickFeaturedTable(list);
        if (!pick) {
          setFeatured(null);
          return;
        }
        const detail = await api.getTable(pick.tableId);
        if (alive) setFeatured(detail);
      } catch {
        if (alive) setError('The table service is not answering right now.');
      }
    };
    void load();
    const h = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  return { tables, featured, error };
}

/* ------------------------------------------------------------------ hero */

function Hero({ live }: { live: LiveLobby }) {
  const summary = live.tables ? summarizeLobby(live.tables) : null;
  const roster = summarizeRoster(live.featured);
  const moment = describeMoment(live.featured, roster);
  return (
    <header className="hero">
      <div className="hero-inner">
        <p className="hero-eyebrow">Fellowship with a mission</p>
        <h1 className="hero-title">
          Play together.
          <br />
          Grow closer.
          <br />
          Meet the mission.
        </h1>
        <p className="hero-lede">
          An evening of Texas Hold&rsquo;em with the group you already meet with, and a mission organisation as your guest at the table.
          Their people join the conversation, share their work and answer questions. Getting to know them is the point. Giving is a separate
          choice, and never a condition of playing.
        </p>
        {/* TWO DOORS, because two different people arrive here. A host comes to set a night up; far
            more often somebody comes to play cards and has never heard of a club. The second door used
            to be missing entirely, and the only call to action was the one that asks you to organise
            something. Both lead to sign-in — and sign-in lands on Play, so the second one is a promise
            that is actually kept. */}
        <div className="hero-actions">
          <a className="cta" href="#signin">
            Start a club
          </a>
          <a className="cta-quiet" href="#signin">
            Or just play a hand
          </a>
          <a className="cta-quiet" href="#how">
            How it works
          </a>
        </div>
        <div className="hero-live">
          {live.tables == null ? (
            <span className="hint">Reading the lobby…</span>
          ) : (
            <>
              <span className={`live-dot ${moment.handRunning ? 'on' : 'idle'}`} aria-hidden="true" />
              <span className="hero-live-head">{summary?.headline}</span>
              {moment.handRunning ? <span className="hero-live-sub">A hand is running right now — {moment.line}</span> : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------- how it works */

/**
 * The four steps are the PRODUCT, in the order a host meets it: the club, the night, the guest, the
 * evening. Deliberately not the four steps of the money, which is what this list used to be — that is
 * a thing a player does once, in one press, and it belongs on the panel that does it.
 */
const STEPS: { title: string; body: string }[] = [
  {
    title: 'Start a club',
    body: 'For the group you already meet with. Name it and add them. It is yours, it is private, and nobody outside it can see it or sit at its tables.',
  },
  {
    title: 'Set the night',
    body: 'Once or twice a week at a time that suits you, or a one-off tournament across several tables. Blinds, buy-in and seats once, and then not again.',
  },
  {
    title: 'Invite a mission to host',
    body: 'A mission organisation is the guest dealer for the evening. Their people introduce their work, join the conversation and answer questions — and can take a seat and play if they would like to.',
  },
  {
    title: 'Play, talk, and choose what is next',
    body: 'Everybody gets asked, the table opens itself on time, and the season keeps its own score. Afterwards you can learn more about the mission, ask a question, stay in touch, or give. Each of those is your own choice.',
  },
];

/** The four things a guest mission offers a participant, and the order they come in. Named here
 *  because "meet the mission" has to mean something specific before anyone will believe it. */
const MISSION_ACTIONS: { title: string; body: string }[] = [
  { title: 'Learn', body: 'What the organisation does, in their own words.' },
  { title: 'Ask', body: 'Out loud, or privately, without interrupting the table.' },
  { title: 'Stay connected', body: 'Hear from them again, only if you say so.' },
  { title: 'Give', body: 'Optional, separate, and never a condition of anything.' },
];

function HowItWorks() {
  return (
    <section className="landing-section how" id="how">
      <h2 className="section-title">How a night works</h2>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="step-no mono">{String(i + 1).padStart(2, '0')}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mission-actions">
        <h3 className="mission-actions-head">The mission is a guest, not a fundraising screen</h3>
        <p className="hint">
          Their representatives are in the room for the evening. Four things stay open to you the whole time, and none of them is required
          to play, to compete, or to belong.
        </p>
        <ul>
          {MISSION_ACTIONS.map((a) => (
            <li key={a.title}>
              <span className="ma-title">{a.title}</span>
              <span className="ma-body">{a.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ live room */

function LiveRoom({ live }: { live: LiveLobby }) {
  const roster = summarizeRoster(live.featured);
  const moment = describeMoment(live.featured, roster);
  const tables = live.tables;
  // The featured table's own rate. Null on play money, and null while the detail is still loading —
  // never the deployment's default, which is not what an already-open table settles at.
  const featuredRate = tableRate(live.featured?.settlement, live.featured?.chipValue, live.featured?.assetSymbol);
  return (
    <section className="landing-section live" id="live">
      <h2 className="section-title">In the room right now</h2>

      {live.error ? <p className="form-error">{live.error}</p> : null}

      {tables == null ? (
        <p className="hint">Reading the lobby…</p>
      ) : tables.length === 0 ? (
        <p className="hint">No tables are open at the moment. Sign in to start a club, or open a table now — it takes a name and two blinds.</p>
      ) : (
        <>
          {live.featured ? (
            <article className="featured">
              <div className="featured-head">
                <h3>{live.featured.name}</h3>
                <SettlementTag settlement={live.featured.settlement} rate={featuredRate} withRate />
                {moment.handRunning ? <span className="tag live">playing now</span> : <span className="tag">between hands</span>}
              </div>
              <p className="featured-line">{moment.line}</p>
              <ul className="featured-seats">
                {[...(live.featured.view.seats ?? [])]
                  .sort((a, b) => a.seat - b.seat)
                  .map((s) => {
                    const info = live.featured?.players?.[s.playerId];
                    // `seatLabel`, not the raw name: a player with no name of their own carries a
                    // truncated Smart Agent address as one, and the PUBLIC landing page is the last
                    // place that belongs — the table itself has always said "Seat 4" instead.
                    const name = seatLabel(info?.name ?? live.featured?.names?.[s.playerId], s.seat);
                    const kind = info?.kind === 'agent' ? (info.agentKind ?? 'agent') : 'person';
                    const stack = dualAmount(s.stack, featuredRate);
                    return (
                      <li key={s.seat} className={info?.kind === 'agent' ? 'is-agent' : 'is-human'}>
                        <span className="fs-name">{name}</span>
                        <span className="fs-kind">{kind}</span>
                        <span className="fs-stack mono" title={stack.label}>
                          {stack.chipsText}
                          {stack.assetLabel ? <span className="cost-asset">{stack.assetLabel}</span> : null}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </article>
          ) : null}

          <div className="tables-wrap">
            <table className="tables">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Stakes</th>
                  <th className="num">Seats</th>
                  <th className="num">Buy-in (chips)</th>
                  <th className="num">Hand</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => {
                  // A visitor reads this list before they have anything to compare it against, so a
                  // settled table's buy-in is priced here too rather than left as a bare number.
                  const rate = tableRate(t.settlement, t.chipValue, t.assetSymbol);
                  const lo = dualAmount(t.config.minStake, rate);
                  const hi = dualAmount(t.config.maxStake, rate);
                  return (
                    <tr key={t.tableId}>
                      <td>
                        {/* A LINK, because watching needs no session: `GET /tables/:id` and the socket
                            both admit an anonymous spectator at a pickup table, and the board draws a
                            spectator hint. This list showed a live game as flat text while the signed-in
                            one linked the same rows — a visitor was shown a hand in progress and given
                            no way into it. A table this client cannot draw is still not offered. */}
                        {hasBoard(t.game) ? (
                          <a href={`#/t/${encodeURIComponent(t.tableId)}`}>{t.name}</a>
                        ) : (
                          t.name
                        )}{' '}
                        <SettlementTag settlement={t.settlement} rate={rate} />
                      </td>
                      <td className="mono">
                        {stakeLabel(t)}
                      </td>
                      <td className="num">{fmtSeats(t.seated, t.config.seats)}</td>
                      <td className="num buyin-cell">
                        <span>
                          {lo.chipsText}–{hi.chipsText}
                        </span>
                        {lo.assetText && hi.assetText ? (
                          <span className="cost-asset">
                            {lo.assetText}–{hi.assetText} {rate?.asset ?? 'SHQ'}
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{t.handNo}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Straight from the card room, refreshed every {POLL_MS / 1000} seconds. These are the open tables anyone may join; a club&rsquo;s
            own tables are private to its members.
          </p>
        </>
      )}
    </section>
  );
}
