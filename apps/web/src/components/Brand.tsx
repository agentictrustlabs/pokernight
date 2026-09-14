import { PRODUCT_MARK, PRODUCT_NAME, PRODUCT_TAGLINE } from '../lib/brand';

/**
 * THE WORDMARK, once. Mark, name and the positioning line together, so every topbar in the room says
 * the same thing the front door says — the landing's identity used to end at the sign-in, and inside
 * the room the brand was one small bold word with a spade drawn by the stylesheet.
 */
export function Brand() {
  return (
    <a className="brand" href="#/" aria-label={PRODUCT_NAME}>
      <span className="brand-mark" aria-hidden="true">{PRODUCT_MARK}</span>
      <span className="brand-name">{PRODUCT_NAME}</span>
      <span className="brand-tag">{PRODUCT_TAGLINE}</span>
    </a>
  );
}
