/**
 * SITTING DOWN FLIPS TO THE FLAT BOARD; STANDING UP GOES BACK TO THE ROOM (2026-09-15).
 *
 * The two views are one place seen two ways: the ROOM is where you walk, look around and see who is
 * here, and the TABLE is where a hand is actually played — cards you can read, a real action bar, the
 * coach. So taking a seat in the room hands you to the flat board, and leaving the seat hands you
 * back to the room you were standing in.
 *
 * WHICH room has to be remembered, because the flat board has no idea where you came from: the hall
 * and each club's lounge are different places, and a person dropped at the wrong one would rightly
 * think they had been teleported. It is kept in `sessionStorage` rather than the URL because it
 * survives the board's own navigations and dies with the tab, which is exactly the lifetime of
 * "where I was standing".
 */
const KEY = 'pokernight.room.from';

/** Remember the room a seat was taken from, so leaving the seat can go back to it. */
export function cameFromRoom(roomHash: string): void {
  try { sessionStorage.setItem(KEY, roomHash); } catch { /* private mode: the board just falls back to the table list */ }
}

/** The room to return to when a seat is given up, or null when the seat was not taken from one. */
export function roomToReturnTo(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

/** Standing up has happened (or the seat was taken some other way): forget the room. */
export function forgetRoom(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
