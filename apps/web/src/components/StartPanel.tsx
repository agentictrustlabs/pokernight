import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSession } from '../lib/types';
import { ApiError, api } from '../lib/api';
import { startBuyInMandate, type AuthConfig } from '../lib/home';
import { rememberReturn } from '../lib/routes';
import { progressLine, readyLine, stakeBalance, stakeFailed, stakeName, stakeProblem, stakeStage, type StakeResult } from '../lib/stake';
import type { TreasuryView } from '../lib/treasury';
import { TreasuryPanel } from './TreasuryPanel';

/** How often we look for the treasury a player is creating at their Home, and for how long. */
const POLL_MS = 4000;
const POLL_FOR_MS = 5 * 60 * 1000;

/**
 * Getting ready to play. One action, one progress line, one money sentence at the end.
 *
 * A newcomer needs three things before a settled seat — somewhere of their own to keep money, some
 * money in it, and a signed authority for this table to take a buy-in — and has no reason to know
 * that is three things. So this shows ONE button and `POST /treasury/quick-start` does the
 * sequence. What comes back is a sentence per step in money terms; the panel prints it and does not
 * re-word it, because the server is the one that knows what actually happened.
 *
 * Two steps belong to the player's own Home when the player is a real person: their Home creates
 * and custodies their treasury, and their Home signs the buy-in mandate. Neither is hidden and
 * neither is faked — each becomes one clearly-labelled trip with a return, and the panel watches
 * for the result rather than asking the person to come back and press something again.
 *
 * Addresses, transaction hashes and mandate caveats exist and are one disclosure away. They are
 * never in the default view: this is a chain-backed product, so the receipts stay reachable, but a
 * person deciding whether to play poker is not reading an address.
 */
export function StartPanel({
  session,
  config,
  treasury,
  onChanged,
  playHref,
  playLabel,
}: {
  session: AppSession;
  /** `GET /auth/config`, for the trip to the player's Home. Null while it is still being read. */
  config: AuthConfig | null;
  /** This player's money, read by the page so the seat gate and this panel agree. */
  treasury: TreasuryView | null;
  /** Re-read it once this panel has moved something. */
  onChanged: () => void | Promise<void>;
  /** Where a set-up player goes to play. Passed only when there is actually a seat for them. */
  playHref?: string;
  playLabel?: string;
}) {
  const [result, setResult] = useState<StakeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True while we are waiting for a treasury the player is making at their Home. */
  const [watching, setWatching] = useState(false);
  const watchUntil = useRef(0);

  const stage = stakeStage(treasury);
  const refused = stakeProblem(treasury);
  const token = session.token;

  const run = useCallback(async (): Promise<StakeResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.quickStart(token);
      setResult(r);
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
      await onChanged();
    }
  }, [onChanged, token]);

  /**
   * Watch for a treasury being created at the player's Home. It is their Home's ceremony in their
   * Home's tab, so there is nothing to await — the only honest way to know is to keep asking, and
   * the moment the answer changes the rest of the set-up runs by itself.
   */
  useEffect(() => {
    if (!watching) return;
    const tick = async () => {
      if (Date.now() > watchUntil.current) {
        setWatching(false);
        return;
      }
      if (document.hidden) return;
      const r = await run();
      if (r && r.next.action !== 'create-at-home') setWatching(false);
    };
    const h = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(h);
  }, [run, watching]);

  const start = useCallback(async () => {
    const r = await run();
    if (r?.next.action === 'create-at-home') {
      watchUntil.current = Date.now() + POLL_FOR_MS;
      setWatching(true);
      if (r.next.portalUrl) window.open(r.next.portalUrl, '_blank', 'noopener');
    }
  }, [run]);

  const authorise = useCallback(async () => {
    if (!config) {
      setError('The card room has not said which Home to ask yet. Reload and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The Home returns to the site's one registered redirect URI, so note the table first.
      rememberReturn();
      location.href = await startBuyInMandate(config, treasury?.mandate.maxPerBuyIn ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [config, treasury?.mandate.maxPerBuyIn]);

  const balance = stakeBalance(treasury);
  const name = stakeName(treasury);
  const next = result?.next ?? null;
  const broke = stakeFailed(result) || error !== null;
  // The stage copy above already says what an unauthorised player has left to do, so repeating the
  // server's version of the same sentence underneath is noise, not honesty. A failure always shows.
  const echoes = next?.action === 'authorise-at-home' && stage === 'authorise' && !broke;
  const line = echoes ? null : (readyLine(result, treasury?.assetSymbol) ?? progressLine(result));

  return (
    <section className="panel start" id="stake">
      <h2>{stage === 'ready' ? 'Your money' : 'Get ready to play'}</h2>

      {stage === 'unavailable' ? (
        <>
          <p className="hint">{treasury?.unavailable ?? treasury?.mandate.unavailable}</p>
          <p className="hint">Play-money tables are unaffected.</p>
        </>
      ) : (
        <>
          {/* The default view is money: what you have, and what it is called. Never an address. */}
          <div className="start-money">
            <span className="start-amount">{balance ?? '—'}</span>
            {name ? <span className="start-name">in {name}</span> : null}
          </div>

          {stage === 'ready' ? (
            <>
              <p className="hint">Buy-ins come out of this, and cash-outs come back into it.</p>
              {/* Set up is not the end of anything: the next thing is a seat, so it is the button. */}
              {playHref ? (
                <a className="button primary" href={playHref}>
                  {playLabel ?? 'Take a seat'}
                </a>
              ) : null}
            </>
          ) : stage === 'authorise' ? (
            <>
              {/* A mandate that came back and was REFUSED must say so. Without this the screen just
                  returned to the sentence below, and a player who had already been to their Home and
                  approved the caps saw no reason why nothing had changed. */}
              {refused ? (
                <p className="start-refused" role="alert">
                  Your Home signed it, but the card room could not accept it: {refused}
                </p>
              ) : null}
              <p className="hint">
                One thing left: your say-so for how much a table may take from your money when you sit down. Your Home asks you that and
                signs it — the card room never can — and you can undo it there whenever you like.
              </p>
              <button className="primary" type="button" disabled={busy} onClick={() => void authorise()}>
                {busy ? 'Sending you to your Home…' : 'Authorise buy-ins at your Home'}
              </button>
            </>
          ) : stage === 'loading' ? (
            <p className="hint">Reading your money…</p>
          ) : (
            <>
              <p className="hint">
                You need a stake before you can sit at a money table. This sets one up for you — it takes a few seconds and costs nothing.
              </p>
              <button className="primary" type="button" disabled={busy || watching} onClick={() => void start()}>
                {busy || watching ? 'Setting up…' : 'Set up your stake'}
              </button>
            </>
          )}

          {/* One honest progress line, in the server's own words. */}
          {line ? <p className={broke ? 'form-error' : 'hint start-line'}>{line}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}

          {next?.action === 'create-at-home' ? (
            <div className="start-handoff">
              <p className="hint">{next.said}</p>
              <span className="pair">
                {next.portalUrl ? (
                  <a className="button primary" href={next.portalUrl} target="_blank" rel="noreferrer">
                    Open your Home →
                  </a>
                ) : null}
                <button type="button" disabled={busy} onClick={() => void start()}>
                  {watching ? 'Watching for it…' : "I've done it"}
                </button>
              </span>
              {watching ? <p className="hint">We are watching for it. When it appears, the rest happens on its own.</p> : null}
            </div>
          ) : null}

          {next?.action === 'authorise-at-home' && stage !== 'authorise' ? <p className="hint">{next.said}</p> : null}

          {next?.action === 'retry' && !busy ? (
            <button type="button" onClick={() => void run()}>
              Try again
            </button>
          ) : null}
        </>
      )}

      {/* Everything the machinery view used to lead with. Reachable, never in the way. */}
      <details className="start-details">
        <summary>Show the details</summary>
        <TreasuryPanel session={session} config={config} bare />
      </details>
    </section>
  );
}
