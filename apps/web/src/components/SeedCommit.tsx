import { useState } from 'react';
import { shortHex } from '../lib/format';

/**
 * Shows the hand's seed commitment with a "verify" explainer. After the hand
 * the revealed seed is shown too, so anyone can check sha256(seed) == commit.
 */
export function SeedCommit({ commit, reveal, handNo }: { commit: string; reveal?: string; handNo: number }) {
  const [open, setOpen] = useState(false);
  const tipId = `seed-tip-${handNo}`;
  return (
    <span className="seed" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span>
        seed <code title={commit}>{shortHex(commit)}</code>
        {reveal ? (
          <>
            {' '}
            → <code title={reveal}>{shortHex(reveal)}</code>
          </>
        ) : null}
      </span>
      <button
        type="button"
        className="tipbtn"
        aria-label="How to verify the shuffle"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open ? (
        <div className="tip" role="tooltip" id={tipId}>
          <p>
            <strong>Commit-reveal shuffle.</strong> Before any card is dealt the server publishes{' '}
            <code>sha256(seed)</code> for this hand. The deck order is derived only from that seed, so the shuffle
            was fixed before anyone acted.
          </p>
          <p>
            When the hand ends the seed is revealed. Hash it yourself and compare with the commitment; then replay the
            deal from the seed and the action log to confirm the cards you saw.
          </p>
          <p>
            Commit: <code>{commit}</code>
          </p>
          {reveal ? (
            <p>
              Reveal: <code>{reveal}</code>
            </p>
          ) : (
            <p>Reveal: after the hand.</p>
          )}
        </div>
      ) : null}
    </span>
  );
}
