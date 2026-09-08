import type { TableView } from '../lib/types';
import type { LastHand } from '../lib/tableSocket';
import { fmtChips, streetLabel } from '../lib/format';
import { playersRemaining, potTotal } from '../lib/hand';
import { SeedCommit } from './SeedCommit';

/**
 * The slim ledger line above the table: which hand, which street, what is in
 * the middle, how many are still in it, and the shuffle commitment.
 */
export function StatusBar({ view, lastHand }: { view: TableView; lastHand: LastHand | null }) {
  const hand = view.hand;
  const live = hand != null && hand.result == null;
  const handNo = hand?.handNo ?? lastHand?.handNo ?? view.handNo;
  const street = hand ? streetLabel(hand.street) : lastHand ? 'Hand over' : 'Waiting';
  const pot = potTotal(view);
  const remaining = playersRemaining(view);
  const seedCommit = hand?.seedCommit ?? lastHand?.seedCommit;
  const seedReveal = hand?.seedReveal ?? (lastHand && (!hand || lastHand.handNo === hand.handNo) ? lastHand.seedReveal : undefined);

  return (
    <div className="statusbar" aria-label="Table status">
      <span className="sb-item">
        <span className="sb-key">Hand</span>
        <span className="sb-val num">{handNo > 0 ? `#${handNo}` : '—'}</span>
      </span>
      <span className="sb-item">
        <span className="sb-key">Street</span>
        <span className="sb-val">{street}</span>
      </span>
      <span className="sb-item">
        <span className="sb-key">Pot</span>
        <span className="sb-val num">{fmtChips(pot)}</span>
      </span>
      <span className="sb-item">
        <span className="sb-key">In hand</span>
        <span className="sb-val num">{live || lastHand ? remaining : 0}</span>
      </span>
      <span className="sb-item blinds">
        <span className="sb-key">Blinds</span>
        <span className="sb-val num">
          {view.config.smallBlind}/{view.config.bigBlind}
          {view.config.ante ? ` +${view.config.ante}` : ''}
        </span>
      </span>
      <span className="sb-spacer" />
      {seedCommit ? <SeedCommit commit={seedCommit} reveal={seedReveal} handNo={handNo} /> : null}
    </div>
  );
}
