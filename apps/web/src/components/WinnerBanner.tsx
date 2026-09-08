import type { Card as CardCode, HandResult } from '../lib/types';
import { fmtDelta, summarizeResult, type FormatContext } from '../lib/format';
import { netBySeat, shownCards, winningCards, winningSeats } from '../lib/hand';
import { dualAmount, type TableRate } from '../lib/money';
import { Card } from './Card';

/**
 * The result of the hand, in the middle of the table: who won, with what, and
 * what every seat that showed was holding. A fold-to-one win never invents a
 * hand rank — it says "uncontested".
 */
export function WinnerBanner({
  result,
  ctx,
  board = [],
  rate = null,
}: {
  result: HandResult;
  ctx: FormatContext;
  board?: CardCode[];
  /** This table's chip rate. Given, the pot that was just won is also said in money. */
  rate?: TableRate | null;
}) {
  const summary = summarizeResult(result, ctx);
  const win = winningCards(result);
  const winners = new Set(winningSeats(result));
  const shown = shownCards(result);
  const nets = netBySeat(result);
  const rows = [...shown.entries()].sort((a, b) => (winners.has(b[0]) ? 1 : 0) - (winners.has(a[0]) ? 1 : 0));
  const rankBySeat = new Map(result.shown.map((s) => [s.seat, s.rank.label] as const));
  // The pot that was just won, in money — the one chip figure on this banner a player reads as a
  // result rather than as a score.
  const won = dualAmount(result.awards.reduce((a, w) => a + w.amount, 0), rate);

  return (
    <div className="winner-banner">
      <div className="wb-head">
        <span className="wb-headline">{summary.headline}</span>
        <span className={`wb-detail${summary.showdown ? '' : ' quiet'}`}>{summary.detail}</span>
        {won.assetLabel ? <span className="wb-asset num">{won.assetLabel}</span> : null}
      </div>
      {board.length > 0 ? (
        <div className="wb-board" aria-label="Board">
          {board.map((c) => (
            <Card key={c} card={c} size="sm" win={win.has(c)} muted={!win.has(c)} />
          ))}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="wb-rows">
          {rows.slice(0, 4).map(([seat, cards]) => (
            <li key={seat} className={winners.has(seat) ? 'won' : ''}>
              <span className="wb-name">{ctx.seatName(seat)}</span>
              <span className="wb-cards">
                {cards.map((c: CardCode, i: number) => (
                  <Card key={i} card={c} size="sm" win={win.has(c)} muted={!winners.has(seat) && !win.has(c)} />
                ))}
              </span>
              <span className="wb-rank">{rankBySeat.get(seat) ?? ''}</span>
              <span className={`wb-net num ${(nets.get(seat) ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtDelta(nets.get(seat) ?? 0)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.rake > 0 ? <div className="wb-rake hint">Rake {summary.rake}</div> : null}
    </div>
  );
}
