/**
 * Which sound each game's events make.
 *
 * A MAPPING, not game logic — which is why both games' cues live in one file rather than inside
 * their own boards. They have to sound like the same card room: a card is the same card in poker and
 * canasta, and if each board invented its own palette a player moving between the two would have to
 * learn the room twice.
 *
 * The rule for what gets a sound: it happened at the TABLE, and a player who was not reading the log
 * would want to know. A player's own private events (the cards they were dealt, the card they drew)
 * are already on screen in their hand and get nothing — a sound for those is a sound that plays
 * while nothing visibly changes for anybody else.
 *
 * `null` means silence, and most events are silent. A table that pings at everything is a table
 * people mute, and then it pings at nothing.
 */

import type { SoundName } from './sound';
import type { TableEvent } from './types';
import type { CanastaTableEvent } from './canasta';

/**
 * Poker's cues.
 *
 * `viewerSeat` decides one thing only: whether the turn chime plays. It is the single sound
 * addressed to the person rather than describing the table, so it must never fire for somebody
 * else's turn.
 */
export function pokerCue(ev: TableEvent, viewerSeat: number | null): SoundName | null {
  switch (ev.type) {
    case 'hand-started':
      return 'deal';
    case 'blind-posted':
      return 'chips';
    case 'action': {
      const a = ev.record.action;
      if (a.type === 'fold') return 'card';
      if (a.type === 'check') return 'card';
      return 'chips';
    }
    case 'street':
      // The board coming out is cards landing, which is exactly what it sounds like.
      return 'deal';
    case 'hand-ended':
      return 'good';
    case 'turn':
      return ev.seat === viewerSeat ? 'turn' : null;
    default:
      return null;
  }
}

/**
 * Canasta's cues, from the same palette.
 *
 * Taking the pile is a `deal` rather than a `card`: it is a dozen cards moving at once, and it is
 * the loudest thing that happens in a round, which is right — it is also the most consequential.
 */
export function canastaCue(ev: CanastaTableEvent, viewerSeat: number | null): SoundName | null {
  switch (ev.type) {
    case 'round-started':
      return 'deal';
    case 'drew':
      return 'card';
    case 'discarded':
      return 'card';
    case 'took-pile':
      return 'deal';
    case 'melded':
      // A canasta is the thing the whole game is for. It gets the sound that says so.
      return ev.canasta ? 'good' : 'chips';
    case 'red-three':
      return 'chips';
    case 'round-ended':
    case 'game-ended':
      return 'good';
    case 'turn':
      return ev.seat === viewerSeat ? 'turn' : null;
    default:
      return null;
  }
}
