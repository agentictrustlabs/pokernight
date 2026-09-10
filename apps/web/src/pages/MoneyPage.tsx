import type { AppSession } from '../lib/types';
import { StartPanel } from '../components/StartPanel';
import { TABLES_HASH } from '../lib/routes';
import { pickSeat } from '../lib/lobby';
import { stakeStage } from '../lib/stake';
import type { TreasuryView } from '../lib/treasury';
import type { TableSummary } from '../lib/types';
import type { AuthConfig } from '../lib/home';

/**
 * YOUR MONEY — a page, not a panel stacked beside a table list.
 *
 * It is a `You` destination and it reads identically wherever you came from, which is not a detail: a
 * club holds no treasury, no balance and no dues (`docs/WORKSPACES.md` §12.1), and this page being the
 * same in every club is how that stops being a promise in a design document and becomes a fact about
 * the screen. It is also the reason there is no context switcher above it — a context you cannot
 * change the money of is not a context the application needs to enter.
 */
export function MoneyPage({
  session,
  config,
  treasury,
  treasuryErr = null,
  tables,
  onChanged,
}: {
  session: AppSession;
  config: AuthConfig | null;
  treasury: TreasuryView | null;
  /** Why the read failed, when it failed. Distinct from "has not answered yet". */
  treasuryErr?: string | null;
  /** Read by the shell, so what this page offers and where it sends you agree. */
  tables: TableSummary[] | null;
  onChanged: () => void;
}) {
  const ready = stakeStage(treasury) === 'ready';
  // Where "take a seat" goes once somebody is set up: a money table with room, because that is what
  // they just got set up FOR.
  const target = pickSeat(tables);
  return (
    <div className="stack money-page">
      <StartPanel
        session={session}
        config={config}
        treasury={treasury}
        onChanged={onChanged}
        readError={treasuryErr}
        {...(ready && target ? { playHref: `#/t/${encodeURIComponent(target.tableId)}`, playLabel: `Take a seat at ${target.name}` } : {})}
      />
      {ready && !target ? (
        <p className="hint">
          You are set up to play. <a href={TABLES_HASH}>No table has a free seat right now</a> — open one and it is ready
          when you are.
        </p>
      ) : null}
    </div>
  );
}
