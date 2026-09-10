import { describe, expect, it } from 'vitest';
import { bundleOf } from './version';

describe('which build is running', () => {
  it('reads the bundle name out of a script URL', () => {
    expect(bundleOf('https://poker.faithnet.io/assets/index-Bdq5mdTN.js')).toBe('index-Bdq5mdTN.js');
  });

  it('reads it out of served HTML', () => {
    expect(bundleOf('<script type="module" crossorigin src="/assets/index-Cs3uLzu3.js"></script>')).toBe('index-Cs3uLzu3.js');
  });

  it('finds nothing in markup that names no bundle, rather than guessing', () => {
    expect(bundleOf('<html><body>nope</body></html>')).toBeNull();
    expect(bundleOf('')).toBeNull();
  });

  it('does not mistake a stylesheet for the bundle', () => {
    expect(bundleOf('<link rel="stylesheet" href="/assets/index-NAbvsTIN.css">')).toBeNull();
  });
});
