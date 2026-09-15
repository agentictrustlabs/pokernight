import { describe, expect, it } from 'vitest';
import { ALPINE_BELVEDERE, BELVEDERE_SNOWFALL, checkTitle, narrow, pickEvidence, traitsOf } from '../src/index.js';

describe('a title has to be solvable before anybody plays it', () => {
  it('the shipped title plays at the shipped venue', () => {
    expect(checkTitle(BELVEDERE_SNOWFALL, ALPINE_BELVEDERE)).toEqual([]);
  });

  it('two deaths narrow the cast to exactly the killer, whoever the killer is', () => {
    for (const role of BELVEDERE_SNOWFALL.roles.filter((r) => r.canBeKiller)) {
      const first = pickEvidence(BELVEDERE_SNOWFALL, role.id, [], BELVEDERE_SNOWFALL.evidencePerDeath);
      const second = pickEvidence(BELVEDERE_SNOWFALL, role.id, first, BELVEDERE_SNOWFALL.evidencePerDeath);
      const left = narrow(BELVEDERE_SNOWFALL, traitsOf(BELVEDERE_SNOWFALL, [...first, ...second]));
      expect(left, `${role.id}`).toEqual([role.id]);
    }
  });

  it('every piece of evidence a death gives up is true of the killer and of nobody the traits exclude', () => {
    for (const role of BELVEDERE_SNOWFALL.roles) {
      const ev = pickEvidence(BELVEDERE_SNOWFALL, role.id, [], 2);
      for (const t of traitsOf(BELVEDERE_SNOWFALL, ev)) expect(role.traits).toContain(t);
    }
  });

  it('says what is wrong rather than throwing, when a title names what the venue has not got', () => {
    const broken = { ...BELVEDERE_SNOWFALL, acts: BELVEDERE_SNOWFALL.acts.map((a) => (a.n === 1 ? { ...a, opens: ['ballroom'] } : a)) };
    expect(checkTitle(broken, ALPINE_BELVEDERE).join(' ')).toContain('ballroom');
  });
});
