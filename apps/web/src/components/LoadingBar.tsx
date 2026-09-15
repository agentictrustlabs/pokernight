/**
 * A SKINNY BAR ALONG THE TOP while the room is still answering.
 *
 * Arriving used to be a blank page and then, all at once, everything — with no sign in between that anything
 * was happening. A thread across the top is the smallest honest thing to show: it is there while something is
 * outstanding and gone the moment nothing is, and it never moves the page under anybody.
 */
export function LoadingBar({ show }: { show: boolean }) {
  if (!show) return null;
  return <div className="loading-bar" role="status" aria-label="Loading" />;
}
