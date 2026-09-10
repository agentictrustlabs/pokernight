import { MONEY_HASH } from '../lib/routes';

/**
 * "Get set up to play" — a link to the panel beside you, not a trip away from the table.
 *
 * IT USED TO THROW YOU OFF THE TABLE. `<a href="#stake">` sets `location.hash` to `#stake`, the
 * router reads `stake`, matches nothing and falls through to the front door — so the table
 * unmounted and its socket closed. At a money table that is not leaving, it is DISCONNECTING: the
 * seat is sat out still holding chips rather than stood up and cashed out.
 *
 * The panel it points at is already on screen, in the same sidebar, under nearly the same condition —
 * every place this link is drawn, the set-up card is drawn too. So it scrolls, and does not navigate.
 * A button rather than an anchor, because an anchor that does not navigate is a promise the browser
 * cannot keep: middle-click, copy-link and open-in-new-tab all produce a page that is not this one.
 *
 * AND IF THE PANEL IS NOT THERE, it goes to `#/money` rather than doing nothing. The conditions agree
 * today; a silent no-op is what they would become if they ever stopped agreeing, and a person pressing
 * "get set up to play" and watching nothing happen is the same dead end in a quieter costume.
 */
export function StakeLink({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="link-button stake-link"
      onClick={() => {
        const panel = document.getElementById('stake');
        if (!panel) {
          location.hash = MONEY_HASH;
          return;
        }
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Somebody who pressed this is about to use the panel, so put them in it.
        panel.querySelector<HTMLElement>('button, a, input')?.focus({ preventScroll: true });
      }}
    >
      {children}
    </button>
  );
}
