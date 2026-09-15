/**
 * Hash routes. Pure, so the route table is testable and there is exactly one place that decides what
 * a URL means.
 *
 *   #/            the front door — the landing page when signed out, PLAY when signed in
 *   #/tables      what is running: your seats, then the open tables anyone may sit at
 *   #/clubs/<id>  one club — its next tables, its members, its standing
 *   #/money       your treasury, your stake, your buy-in authority
 *   #/about       what this place is — the front page, readable when signed in
 *   #/signin      sign-in on its own, where a sign-out or an expired session lands
 *   #/t/<tableId> a table
 *   #/join/<clubId>          the door into a club: join it at your Home (the host's agent sent the link)
 *
 * WHY `#/` IS PLAY AND NOT THE TABLE LIST. The commonest visitor to a room wants to be dealt a
 * hand, and every game product worth copying spends its first slot on that rather than on a lobby
 * (`docs/NAVIGATION-RESEARCH.md` §12.1). The list is one press away at `#/tables`, which is where
 * leaving a table lands — that is the returning player's first screen, and it is not the newcomer's.
 *
 * WHY A CLUB IS A ROUTE AND NOT A SELECTION. It used to be `useState` inside the lobby, which meant
 * a club could not be linked, did not survive a refresh, and could not be the place an invitation
 * dropped somebody. A club is a DESTINATION with its own sub-navigation, not a mode the application
 * enters: your tables, your money and your identity are the same in it as out of it, which is
 * exactly why there is no context switcher above all this.
 */

export type Route =
  | { page: 'home' }
  | { page: 'tables' }
  /** One club. The id is in the URL, so it is linkable and survives a refresh. */
  | { page: 'club'; clubId: string }
  /** Starting one. Its own page rather than a form folded into the rail. */
  | { page: 'newClub' }
  | { page: 'money' }
  /** THE MISSIONS (docs/MISSION-REGISTRY.md): the map of registered missions, registering one, and one mission. */
  /** Opening a table — its own page. With a club it is private to the club; with a night it is one of the night's. */
  | { page: 'newTable'; clubId?: string; night?: string }
  /** THE ROOM (docs/SPATIAL-ROOM.md): a club's lounge, or the hall. */
  | { page: 'room'; clubId?: string }
  | { page: 'bar'; clubId?: string }
  | { page: 'fire'; clubId?: string }
  | { page: 'missions' }
  | { page: 'newMission' }
  | { page: 'mission'; entryId: string }
  /**
   * The front page, as a page rather than as a state.
   *
   * It was only ever rendered for a visitor with NO session (`home && !session`), so the whole product
   * explanation — how a night works, what a mission guest is, where the giving boundary sits — became
   * unreadable the moment somebody signed in, and there was no URL to send them to. Signing in is not
   * a reason to stop being allowed to read what you signed into.
   */
  | { page: 'about' }
  | { page: 'signin' }
  /** `practice` asks the table page to set the table up rather than wait to be told. */
  | { page: 'table'; tableId: string; practice?: boolean }
  /**
   * An invitation link. It carries the CLUB as well as the token because the token alone does not
   * say which club to ask — a club is its own object, and a global index of every invitation in the
   * room would be a thing to leak rather than a thing to have.
   */
  | { page: 'join'; clubId: string };

/** Where sign-out, an expired session and "I want to sign in" all go. */
export const SIGNIN_HASH = '#/signin';
/** The front door — Play, for somebody signed in. */
export const HOME_HASH = '#/';
/**
 * What is running. Where LEAVING A TABLE lands: "when I leave a table it needs to return me to the
 * open tables screen", and the front door is no longer that screen.
 */
export const TABLES_HASH = '#/tables';
/** Your money, on its own page rather than a panel stacked beside a table list. */
export const MONEY_HASH = '#/money';

/** What this place is. Readable signed in or out. */
export const ABOUT_HASH = '#/about';

/** Starting a club. */
export const NEW_CLUB_HASH = '#/clubs/new';

/** Opening a table: a pickup one, or a club's (for one of its nights, when `night` is given). */
export function newTableHash(clubId?: string | null, night?: string | null): string {
  const base = clubId ? `#/clubs/${encodeURIComponent(clubId)}/tables/new` : '#/tables/new';
  return night ? `${base}?night=${encodeURIComponent(night)}` : base;
}

/** The room: a club's lounge, or the pickup hall. */
/** THE FIRESIDE of a room, where the night's guest is met. */
export function fireHash(clubId?: string | null): string {
  return clubId ? `#/clubs/${encodeURIComponent(clubId)}/fire` : '#/fire';
}
/** THE BAR of a room — a place to talk, with no guest. */
export function barHash(clubId?: string | null): string {
  return clubId ? `#/clubs/${encodeURIComponent(clubId)}/bar` : '#/bar';
}

export function roomHash(clubId?: string | null): string {
  return clubId ? `#/clubs/${encodeURIComponent(clubId)}/room` : '#/hall';
}

/** The missions: the map, and registering one. */
export const MISSIONS_HASH = '#/missions';
export const NEW_MISSION_HASH = '#/missions/new';
export function missionHash(entryId: string): string {
  return `#/missions/${encodeURIComponent(entryId)}`;
}

/** One club's page. The one place that builds a club URL, so the shape is stated once. */
export function clubHash(clubId: string): string {
  return `#/clubs/${encodeURIComponent(clubId)}`;
}

export function route(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '/';
  const table = /^\/t\/([^/?#]+)/.exec(path);
  if (table?.[1]) {
    const query = hash.split('?')[1] ?? '';
    const practice = new URLSearchParams(query).get('practice') === '1';
    return { page: 'table', tableId: decodeURIComponent(table[1]), ...(practice ? { practice: true } : {}) };
  }
  const join = /^\/join\/(0x[0-9a-fA-F]{40})(?:[/?#]|$)/.exec(path);
  if (join?.[1]) return { page: 'join', clubId: join[1].toLowerCase() };
  // `new` is checked BEFORE the id, and a club id is a UUID, so the two can never be confused.
  if (/^\/clubs\/new\/?$/.test(path)) return { page: 'newClub' };
  if (/^\/bar\/?$/.test(path)) return { page: 'bar' };
  if (/^\/fire\/?$/.test(path)) return { page: 'fire' };
  const clubBar = /^\/clubs\/([^/?#]+)\/bar\/?$/.exec(path);
  if (clubBar) return { page: 'bar', clubId: decodeURIComponent(clubBar[1]!) };
  const clubFire = /^\/clubs\/([^/?#]+)\/fire\/?$/.exec(path);
  if (clubFire) return { page: 'fire', clubId: decodeURIComponent(clubFire[1]!) };
  const clubRoom = /^\/clubs\/([^/?#]+)\/room\/?$/.exec(path);
  if (clubRoom?.[1]) return { page: 'room', clubId: decodeURIComponent(clubRoom[1]) };
  if (/^\/hall\/?$/.test(path)) return { page: 'room' };
  const clubTable = /^\/clubs\/([^/?#]+)\/tables\/new\/?$/.exec(path);
  if (clubTable?.[1]) {
    const night = new URLSearchParams(hash.split('?')[1] ?? '').get('night');
    return { page: 'newTable', clubId: decodeURIComponent(clubTable[1]), ...(night ? { night } : {}) };
  }
  if (/^\/tables\/new\/?$/.test(path)) return { page: 'newTable' };
  // A club id and nothing else. `#/clubs` with no id is not a directory and never will be — a club
  // you are not in is indistinguishable from one that does not exist — so it falls through to Play.
  const club = /^\/clubs\/([^/?#]+)/.exec(path);
  if (club?.[1]) return { page: 'club', clubId: decodeURIComponent(club[1]) };
  if (/^\/missions\/new\/?$/.test(path)) return { page: 'newMission' };
  const mission = /^\/missions\/([^/?#]+)/.exec(path);
  if (mission?.[1]) return { page: 'mission', entryId: decodeURIComponent(mission[1]) };
  if (/^\/missions\/?$/.test(path)) return { page: 'missions' };
  if (/^\/about\/?$/.test(path)) return { page: 'about' };
  if (/^\/tables\/?$/.test(path)) return { page: 'tables' };
  if (/^\/money\/?$/.test(path)) return { page: 'money' };
  if (/^\/signin\/?$/.test(path)) return { page: 'signin' };
  return { page: 'home' };
}

/** Navigate without adding a history entry the back button would bounce off. */
export function goTo(hash: string): void {
  if (location.hash === hash) return;
  location.hash = hash;
}

/* --------------------------------------------------- coming back from the Home */

const RETURN_KEY = 'pokernight.returnTo';

/**
 * Remember where the person was standing before a trip to their Home.
 *
 * The buy-in authorisation returns to the site's ONE registered redirect URI, which is the front
 * door — so without this, a person who authorised buy-ins while sitting at a table comes back to
 * the lobby and has to find the table again. That is the difference between a flow and an errand.
 */
export function rememberReturn(hash: string = location.hash): void {
  try {
    sessionStorage.setItem(RETURN_KEY, hash || HOME_HASH);
  } catch {
    /* storage blocked: they land on the front door, which is where they would have landed anyway */
  }
}

/** Where to send them back to, once and once only. Null when there is nowhere in particular. */
export function takeReturn(): string | null {
  try {
    const hash = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return hash && hash !== location.hash ? hash : null;
  } catch {
    return null;
  }
}
