import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, PRODUCT_TAGLINE, brandLine, pageTitle } from './brand';

/**
 * The product name is COPY. These tests do not assert what it currently is — a name that could not
 * change without breaking a test would be the opposite of the point. They assert that it is in one
 * place, and that the things built from it are built from it.
 */
describe('the product name', () => {
  it('composes the brand line and page titles from the one name', () => {
    expect(brandLine()).toBe(`${PRODUCT_NAME} · ${PRODUCT_TAGLINE}`);
    expect(brandLine(' — ')).toBe(`${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`);
    expect(pageTitle('Signing you out')).toBe(`Signing you out — ${PRODUCT_NAME}`);
  });

  it('is a name, not an identifier', () => {
    // The infrastructure keeps saying `pokernight`: the Workers, the domains, the OIDC client, the
    // session key, the salts the house agents were deployed under. If the display name ever became
    // one of those by accident, a rename would stop being a copy edit and become a migration.
    expect(PRODUCT_NAME).not.toMatch(/^[a-z0-9-]+$/);
    expect(PRODUCT_NAME.trim()).toBe(PRODUCT_NAME);
    expect(PRODUCT_NAME.length).toBeGreaterThan(0);
  });
});
