import { describe, expect, it } from 'vitest';
import {
  agentOfPlayer,
  canInvite,
  homeMembershipLabel,
  membershipAtHome,
  canOpenTable,
  charterState,
  checkMember,
  confirmsRetire,
  memberAction,
  noTablesLine,
  retireConsequences,
  retiredLine,
  standingLabel,
} from './clubs';
import type { ClubListing } from './api';

const listing = (name: string): ClubListing => ({ clubId: crypto.randomUUID(), name, joinedAt: 1 });

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

describe('checking who is being added', () => {
  it('accepts a Smart Agent address, in either case', () => {
    expect(checkMember(`0x${'ab'.repeat(20)}`)).toMatchObject({ ok: true, shape: 'address' });
    expect(checkMember(`0x${'AB'.repeat(20)}`).ok).toBe(true);
    expect(checkMember(`  0x${'ab'.repeat(20)}  `).ok).toBe(true);
  });

  it('accepts a player id, which is what a roster row already carries', () => {
    expect(checkMember(`home:0x${'ab'.repeat(20)}`)).toMatchObject({ ok: true, shape: 'player' });
    expect(checkMember('dev:marcus')).toMatchObject({ ok: true, shape: 'player' });
  });

  it('accepts an AGENT NAME, which is how people actually know each other', () => {
    expect(checkMember('carol.me')).toMatchObject({ ok: true, shape: 'name' });
    expect(checkMember('vault.svc.richcanvas.org')).toMatchObject({ ok: true, shape: 'name' });
    // One label is not a name. `carol` names nobody, and guessing a suffix for them would be
    // guessing which Carol.
    expect(checkMember('carol')).toMatchObject({ ok: false, shape: 'unknown' });
  });

  it('accepts an EMAIL, because it is a thing a host can do something with', () => {
    // It does not go on a roster — it opens an invitation. Refusing it outright was what sent
    // hosts looking for a hex string they had no way to get.
    expect(checkMember('marcus@example.com')).toMatchObject({ ok: true, shape: 'email' });
  });

  it('says nothing at all about an empty box', () => {
    // A form that goes red before you have typed is telling you off for arriving.
    expect(checkMember('')).toMatchObject({ ok: true, shape: 'empty' });
    expect(checkMember('   ').ok).toBe(true);
  });

  it('says what the box takes when the thing typed is none of them', () => {
    const r = checkMember('0xnope');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.hint).toContain('carol.me');
  });
});

describe('what the button will do', () => {
  it('promises to add somebody named or addressed, straight away', () => {
    expect(memberAction('carol.me').label).toBe('Add to the club');
    expect(memberAction(`0x${'ab'.repeat(20)}`).label).toBe('Add to the club');
  });

  it('promises to SEND, not to add, when an email was typed', () => {
    // The two roads have different consequences and the host should know which one they are on
    // before they press the button: one is immediate and private, the other sends mail and waits.
    const a = memberAction('marcus@example.com');
    expect(a.label).toBe('Send an invitation');
    expect(a.hint).toMatch(/link/i);
  });

  it('says what the box takes while it is still empty', () => {
    expect(memberAction('').hint).toContain('carol.me');
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

describe('the club’s own agent', () => {
  const club = (agent: string | undefined, standing: 'host' | 'member') => ({
    ...(agent ? { agent } : {}),
    you: { standing } as const,
  });

  it('reports a chartered club to anyone who can see it', () => {
    expect(charterState(club('0xabc', 'member'), true)).toEqual({ kind: 'chartered', agent: '0xabc' });
    expect(charterState(club('0xabc', 'host'), false)).toEqual({ kind: 'chartered', agent: '0xabc' });
  });

  it('offers the ceremony only to a host, and only where the Home can run it', () => {
    expect(charterState(club(undefined, 'host'), true)).toEqual({ kind: 'offer' });
    expect(charterState(club(undefined, 'host'), false)).toEqual({ kind: 'unavailable' });
  });

  it('says nothing to a member — an unchartered club is not their errand', () => {
    // Not "unavailable" either: that reads as something broken, and offering a member a button
    // they would be refused at is worse than saying nothing at all.
    expect(charterState(club(undefined, 'member'), true)).toEqual({ kind: 'hidden' });
  });
});

/* -------------------------------------------------------------------- retiring */

describe('closing a club', () => {
  it('names every consequence, including the one nobody expects', () => {
    const said = retireConsequences('Thursday Night', 2, '0xabc');
    expect(said.join(' ')).toContain("everybody's list");
    expect(said.join(' ')).toContain('2 tables close');
    expect(said.join(' ')).toContain('Invitations');
    expect(said.join(' ')).toContain('no undo');
    // THE ONE THAT MATTERS. The card room cannot remove the club's Smart Agent, and a host who reads
    // "closed" and assumes it went too has been misled about something still out there with their name
    // on it.
    expect(said.join(' ')).toMatch(/Smart Agent is NOT removed/);
  });

  it('says nothing about an agent for a club that never had one', () => {
    expect(retireConsequences('The Long Game', 0, undefined).join(' ')).not.toMatch(/Smart Agent/);
  });

  it('does not mention tables when there are none', () => {
    // Named without the word "table" in it on purpose: the first version of this test asserted
    // against a club called "Kitchen Table" and matched its own name.
    expect(retireConsequences('The Long Game', 0, undefined).join(' ')).not.toMatch(/table/i);
  });

  it('counts one table as one', () => {
    expect(retireConsequences('The Long Game', 1, undefined).join(' ')).toContain('Its table closes');
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

describe('membership at the Home (the roster as a projection)', () => {
  const club = { agent: '0x' + 'e'.repeat(40), createdBy: 'home:0x' + 'a'.repeat(40) };
  const bob = 'home:0x' + 'b'.repeat(40);

  it('is the host\'s own agent for the host, and nothing for an unchartered club', () => {
    expect(membershipAtHome(club, { member: club.createdBy })).toBe('steward');
    expect(membershipAtHome({ createdBy: club.createdBy }, { member: bob })).toBe('none');
  });

  it('reads the row\'s projection, and calls a chartered club\'s card-room-only member pending', () => {
    expect(membershipAtHome(club, { member: bob })).toBe('pending');
    expect(membershipAtHome(club, { member: bob, home: 'invited' })).toBe('invited');
    expect(membershipAtHome(club, { member: bob, home: 'joined' })).toBe('joined');
  });

  it('has no Home errand for somebody with no agent', () => {
    expect(membershipAtHome(club, { member: 'dev:carol' })).toBe('none');
    expect(agentOfPlayer('dev:carol')).toBeNull();
    expect(agentOfPlayer(bob)).toBe('0x' + 'b'.repeat(40));
  });

  it('says it in the row\'s word, and says nothing where there is nothing to say', () => {
    expect(homeMembershipLabel('joined')).toBe('joined at Home');
    expect(homeMembershipLabel('pending')).toBe('not yet at Home');
    expect(homeMembershipLabel('steward')).toBe('');
  });
});
