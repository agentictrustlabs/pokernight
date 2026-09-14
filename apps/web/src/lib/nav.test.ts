import { describe, expect, it } from 'vitest';
import { clubHeading, clubRail, inClub, yourRail } from './nav';
import { route } from './routes';

const CLUBS = [
  { clubId: 'a1', name: 'Thursday Night' },
  { clubId: 'b2', name: 'The Long Game' },
];

describe('the rail that is yours wherever you are', () => {
  it('puts Play first, because being dealt a hand is what somebody came for', () => {
    expect(yourRail(route('#/')).map((i) => i.key)).toEqual(['play', 'tables', 'missions', 'money']);
  });

  it('marks exactly one row as where you are, on every route it has a row for', () => {
    for (const hash of ['#/', '#/tables', '#/missions', '#/money']) {
      expect(yourRail(route(hash)).filter((i) => i.here)).toHaveLength(1);
    }
  });

  it('marks no row at a club, because a club is its own destination and not one of these', () => {
    expect(yourRail(route('#/clubs/a1')).some((i) => i.here)).toBe(false);
  });

  it('sends Tables where leaving a table lands, so the two cannot drift apart', () => {
    const tables = yourRail(route('#/'))[1];
    expect(tables?.hash).toBe('#/tables');
  });
});

describe('the clubs slot', () => {
  it('says LOADING before it has asked — never "you are in none"', () => {
    // Telling somebody they have no clubs before the answer arrives is telling them something we do
    // not know, and they read the two offers underneath as all there is.
    expect(clubRail(null, route('#/')).kind).toBe('loading');
  });

  it('offers a way in when there are none', () => {
    expect(clubRail([], route('#/'))).toEqual({ kind: 'none', clubs: [] });
  });

  it('names the one club you are in, which is what a switcher would have given you', () => {
    const rail = clubRail([CLUBS[0]!], route('#/'));
    expect(rail.kind).toBe('list');
    expect(rail.clubs.map((c) => c.label)).toEqual(['Thursday Night']);
    expect(rail.clubs[0]?.hash).toBe('#/clubs/a1');
  });

  it('marks the club whose page you are on, and only that one', () => {
    const rail = clubRail(CLUBS, route('#/clubs/b2'));
    expect(rail.clubs.filter((c) => c.here).map((c) => c.label)).toEqual(['The Long Game']);
  });

  it('marks none of them anywhere else', () => {
    expect(clubRail(CLUBS, route('#/tables')).clubs.some((c) => c.here)).toBe(false);
  });

  it('escapes a club id into its link rather than pasting it', () => {
    expect(clubRail([{ clubId: 'a b', name: 'x' }], route('#/')).clubs[0]?.hash).toBe('#/clubs/a%20b');
  });

  it('does not put a plural heading over one named row', () => {
    expect(clubHeading(1)).toBe('Your club');
    expect(clubHeading(0)).toBe('Your clubs');
    expect(clubHeading(3)).toBe('Your clubs');
  });
});

describe('the routes the rail links to', () => {
  it('reads #/clubs/new as starting one, never as a club whose id is "new"', () => {
    expect(route('#/clubs/new')).toEqual({ page: 'newClub' });
    expect(route('#/clubs/new/')).toEqual({ page: 'newClub' });
  });

  it('has no club directory: #/clubs alone is not a page', () => {
    // A club you are not in is indistinguishable from one that does not exist, so there is nothing
    // to list. The invitation carries the club instead.
    expect(route('#/clubs')).toEqual({ page: 'home' });
    expect(route('#/clubs/')).toEqual({ page: 'home' });
  });

  it('reads a real club id', () => {
    expect(route('#/clubs/9cf3b05b-1c27-47ac-b9a5-f042f6b97aca')).toEqual({
      page: 'club',
      clubId: '9cf3b05b-1c27-47ac-b9a5-f042f6b97aca',
    });
  });

  it('gives the front page a URL, so signing in does not make it unreadable', () => {
    // It was only ever rendered for `home && !session`, so the whole product explanation — how a night
    // works, what a mission guest is, where the giving boundary sits — vanished the moment somebody
    // had an account, and there was nowhere to send them.
    expect(route('#/about')).toEqual({ page: 'about' });
    expect(route('#/about/')).toEqual({ page: 'about' });
  });

  it('reads the two personal destinations, with or without a trailing slash', () => {
    expect(route('#/tables')).toEqual({ page: 'tables' });
    expect(route('#/tables/')).toEqual({ page: 'tables' });
    expect(route('#/money')).toEqual({ page: 'money' });
  });

  it('marks no rail row on the pages that are not rail rows', () => {
    for (const hash of ['#/clubs/new', '#/signin', '#/t/abc', '#/about']) {
      expect(yourRail(route(hash)).some((i) => i.here)).toBe(false);
    }
  });
});

describe('whether the club in the URL is one of yours', () => {
  it('is null while the list is unread, so nobody is bounced off a slow connection', () => {
    expect(inClub(null, 'a1')).toBeNull();
  });

  it('answers once the list is in', () => {
    expect(inClub(CLUBS, 'a1')).toBe(true);
    expect(inClub(CLUBS, 'zz')).toBe(false);
    expect(inClub([], 'a1')).toBe(false);
  });
});
