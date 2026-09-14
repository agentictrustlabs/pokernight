/**
 * THE PRODUCT NAME, in one place.
 *
 * The name is copy. Everything else that says `pokernight` — the Workers, the domains, the packages,
 * the OIDC client id, the deterministic salts the house agents were deployed under — is
 * INFRASTRUCTURE, and it stays exactly as it is. Those are identifiers other systems have already
 * bound to: a renamed Worker is a new Durable Object namespace, a renamed client invalidates every
 * grant a member has signed, and the house agents' addresses are derived from their salts and cannot
 * be renamed at all.
 *
 * Separating the two is what makes the name a decision that can be revisited. Today it is
 * "Game Night" (2026-09-14; it was "Pokernight" until the second game arrived). When it changes, this file
 * changes and nothing is redeployed, nothing is re-consented, and no state is abandoned.
 *
 * WHAT LIVES HERE. Only what a person reads. A string that identifies this app to another system is
 * not a brand string even when it looks like one, and moving it here would quietly turn a rename
 * into a migration — which is the exact thing this file exists to prevent.
 *
 * ONE DISPLAY STRING IS NOT HERE AND CANNOT BE. The consent screen at the person's own Home says
 * "Poker Night" because that name is in the Home's own curated client registry, which is the point:
 * a relying app does not get to choose the name it is introduced under. Renaming the product means a
 * change there too, and it is the one piece of copy that is not this repository's to change.
 */

/** What the product calls itself, wherever a person reads it. */
export const PRODUCT_NAME = 'Game Night';

/** The positioning line. Sits under the name in the topbar and on the sign-in page. */
export const PRODUCT_TAGLINE = 'fellowship with a mission';

/** The mark. A spade; it belongs with the name rather than scattered through the markup. */
export const PRODUCT_MARK = '♠';

/** `Pokernight · fellowship with a mission` — the two together, for a footer or a document title. */
export function brandLine(separator = ' · '): string {
  return `${PRODUCT_NAME}${separator}${PRODUCT_TAGLINE}`;
}

/** `Signing you out — Pokernight`. A page title that is about something, named after the product. */
export function pageTitle(about: string): string {
  return `${about} — ${PRODUCT_NAME}`;
}
