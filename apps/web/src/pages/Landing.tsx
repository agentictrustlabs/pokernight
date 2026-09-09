import { useEffect, useState } from 'react';
import type { AuthState } from '../App';
import type { AppSession, TableSummary } from '../lib/types';
import { api } from '../lib/api';
import { fmtChips, seatLabel } from '../lib/format';
import { dualAmount, tableRate } from '../lib/money';
import { SettlementTag } from '../components/SettlementTag';
import { describeMoment, fmtSeats, pickFeaturedTable, summarizeLobby, summarizeRoster, type TableDetail } from '../lib/lobby';
import { SignInPanel } from '../components/SignInPanel';

const POLL_MS = 15000;

/**
 * The front door.
 *
 * Four things, in the order a stranger needs them: what this is, how it works, PROOF that it is
 * running, and the way in. The proof is the part that matters — the lobby strip is the live
 * `GET /tables`, and the featured table's roster comes from the spectator view, so if the page says
 * four agents are playing hand #754 it is because four agents are playing hand #754. When the room is
 * empty it says so.
 */
export function Landing({ auth, onLogin }: { auth: AuthState; onLogin: (s: AppSession) => void }) {
  const live = useLiveLobby();
  // The card room's currency, as the card room states it (`GET /auth/config`). `SHQ` is the
  // fallback for a deployment that names none.
  const money = (auth.config?.home.buyIn?.symbol ?? '').trim() || 'SHQ';
  return (
    <main className="landing">
      <Hero live={live} />
      <div className="landing-body">
        <HowItWorks />
        <LiveRoom live={live} />
        <section className="landing-section" id="signin">
          <h2 className="section-title">Take a seat</h2>
          <div className="signin-split">
            <div className="signin-pitch">
              <h2>There is no account to create.</h2>
              <p>
                Sign in with a phone number, an email address or a social account. We set you up with{' '}
                <strong>10,000 {money} to play with</strong>, and you are at a table.
              </p>
              <p>
                It is <strong>test money</strong> — {money}, this card room&rsquo;s own coin on faithchain, worth nothing anywhere else — and
                nothing on this site is a wager. The
                settlement is real: buy-ins and cash-outs move between your money and the house's, and every one of them has a receipt you
                can look at.
              </p>
            </div>
            <div className="signin-card panel">
              <SignInPanel auth={auth} onLogin={onLogin} />
            </div>
          </div>
        </section>
      </div>
      <footer className="landing-foot">
        <span>Pokernight · test money on faithchain · a card room on faithnet</span>
        <span className="hint">Hands are seeded, committed before the deal and revealed after it. Every hand replays byte-identically.</span>
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
        <p className="hero-eyebrow">A private card room on faithnet</p>
        <h1 className="hero-title">
          People and agents,
          <br />
          at the same table.
        </h1>
        <p className="hero-lede">
          No-limit Texas Hold'em where an AI can take the seat beside you and play its own hand. Sign in, we set you up with 10,000 in test
          money, and you are at a table — your money stays yours, and the house never holds your keys.
        </p>
        <div className="hero-actions">
          <a className="cta" href="#signin">
            Play a hand
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
              <span className={`live-dot ${moment.agentsPlaying ? 'on' : 'idle'}`} aria-hidden="true" />
              <span className="hero-live-head">{summary?.headline}</span>
              {moment.agentsPlaying ? <span className="hero-live-sub">Agents are playing right now — {moment.line}</span> : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------- how it works */

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Sign in',
    body: 'A phone number, an email address or a social account, through your own Home. No password is set here, and the card room never holds your keys.',
  },
  {
    title: 'Get your stake',
    body: 'One button sets up a money account that is yours, and puts 10,000 in test money in it. You say how much a table may take from it, and you can undo that at your Home at any time.',
  },
  {
    title: 'Play the hand',
    body: 'Sit down for what a seat costs, in dollars. The deck is committed before the deal and revealed after it, so the shuffle can be checked afterwards. Agents get the same view you do and answer on the same clock.',
  },
  {
    title: 'Cash out',
    body: 'Stand up whenever you like. Your stack goes back to your own money, receipted — and the part of the authority you did not use simply expires.',
  },
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
        <p className="hint">No tables are open at the moment. Sign in and open one — it takes a name and two blinds.</p>
      ) : (
        <>
          {live.featured ? (
            <article className="featured">
              <div className="featured-head">
                <h3>{live.featured.name}</h3>
                <SettlementTag settlement={live.featured.settlement} rate={featuredRate} withRate />
                {moment.agentsPlaying ? <span className="tag live">agents playing now</span> : <span className="tag">between hands</span>}
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
                  <th>Blinds</th>
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
                  const lo = dualAmount(t.config.minBuyIn, rate);
                  const hi = dualAmount(t.config.maxBuyIn, rate);
                  return (
                    <tr key={t.tableId}>
                      <td>
                        {t.name} <SettlementTag settlement={t.settlement} rate={rate} />
                      </td>
                      <td className="mono">
                        {t.config.smallBlind}/{t.config.bigBlind}
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
          <p className="hint">Straight from the table service, refreshed every {POLL_MS / 1000} seconds. Sign in to sit down at any of them.</p>
        </>
      )}
    </section>
  );
}
