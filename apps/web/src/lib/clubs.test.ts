import { describe, expect, it } from 'vitest';
import { canInvite, canOpenTable, confirmsRetire, noTablesLine, retireConsequences, retiredLine, standingLabel } from './clubs';
import type { ClubListing } from './api';

const listing = (name: string): ClubListing => ({ clubId: `0x${'ab'.repeat(20)}`, name, standing: 'member' });

describe('what a standing lets you do', () => {
  it('gives the roster and the tables to a host, and neither to a member', () => {
    expect(canInvite('host')).toBe(true);
    expect(canOpenTable('host')).toBe(true);
    expect(canInvite('member')).toBe(false);
    expect(canOpenTable('member')).toBe(false);
  });

  it('gives nothing to no standing — the case the client should never render at all', () => {
    expect(canInvite('none')).toBe(false);
    expect(canOpenTable('none')).toBe(false);
    expect(standingLabel('none')).toBe('');
  });

  it('names what somebody is, in the word the club uses', () => {
    expect(standingLabel('host')).toBe('Host');
    expect(standingLabel('member')).toBe('Member');
  });
});



describe('an empty club lobby', () => {
  it('offers a host the thing they can actually do', () => {
    expect(noTablesLine('host', 'Thursday Night')).toContain('Open one');
    expect(noTablesLine('host', 'Thursday Night')).toContain('Thursday Night');
  });

  it('does not offer a member a button they would be refused at', () => {
    const line = noTablesLine('member', 'Thursday Night');
    expect(line).not.toContain('Open one');
    expect(line).toContain('A host opens them');
  });
});


/* -------------------------------------------------------------------- retiring */

describe('closing a club', () => {
  it('names every consequence, including the one nobody expects', () => {
    const said = retireConsequences('Thursday Night', 2);
    expect(said.join(' ')).toContain("everybody's list");
    expect(said.join(' ')).toContain('2 tables close');
    expect(said.join(' ')).toContain('no undo');
    // THE ONE THAT MATTERS. The card room cannot remove the club's Smart Agent, and a host who reads
    // "closed" and assumes it went too has been misled about something still out there with their name
    // on it.
    expect(said.join(' ')).toMatch(/Smart Agent is NOT removed/);
  });

  it('does not mention tables when there are none', () => {
    // Named without the word "table" in it on purpose: the first version of this test asserted
    // against a club called "Kitchen Table" and matched its own name.
    expect(retireConsequences('The Long Game', 0).join(' ')).not.toMatch(/table/i);
  });

  it('counts one table as one', () => {
    expect(retireConsequences('The Long Game', 1).join(' ')).toContain('Its table closes');
  });

  it('accepts the name typed back, forgiving case and stray space', () => {
    expect(confirmsRetire('Thursday Night', 'Thursday Night')).toBe(true);
    expect(confirmsRetire('  thursday   night ', 'Thursday Night')).toBe(true);
  });

  it('refuses anything else, and refuses empty hardest of all', () => {
    expect(confirmsRetire('Thursday', 'Thursday Night')).toBe(false);
    expect(confirmsRetire('', 'Thursday Night')).toBe(false);
    expect(confirmsRetire('   ', '   ')).toBe(false);
  });

  it('reports what happened, and never claims the agent went with it', () => {
    expect(retiredLine({ name: 'Thursday Night', tablesClosed: ['a', 'b'], agent: '0xabc' })).toBe(
      'Thursday Night is closed. Its 2 tables were closed with it. Its Smart Agent is untouched and still yours, at your Home.',
    );
    expect(retiredLine({ name: 'The Long Game', tablesClosed: [] })).toBe('The Long Game is closed.');
  });
});

