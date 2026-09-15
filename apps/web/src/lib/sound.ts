/**
 * The table's own sounds — synthesised, not sampled.
 *
 * A room is not silent. A card landing, chips going in, and the small chime that says it is
 * your turn are how a player at a real table knows what happened without watching every seat; on
 * screen the same job is done by a log line they may not be looking at. This is the difference
 * between a page and a game.
 *
 * WHY WEB AUDIO AND NOT FILES. Sampled sounds mean assets, and assets mean a second thing to host,
 * cache and version — and the artifact CSP and this Worker's asset bundle both get simpler with
 * none. These are a few dozen milliseconds of shaped noise and tone each, which is what a card and
 * a chip actually are, and they cost nothing to ship.
 *
 * TWO RULES, both about not being rude.
 *
 * 1. NOTHING PLAYS UNTIL THE PLAYER HAS TOUCHED THE PAGE. Browsers refuse to start audio before a
 *    gesture, and they are right to: a page that makes noise at somebody who has not asked it to is
 *    a page they close. The context is created lazily on the first real interaction.
 * 2. THE CHOICE IS REMEMBERED, and it is per person, per browser. `localStorage`, wrapped, because
 *    a private window that refuses to store it must still play the game.
 *
 * Every failure here is swallowed. Sound is the least important thing on the table and must never
 * be the reason something else does not happen.
 */

const KEY = 'pokernight.sound';

export type SoundName =
  /** A card dealt or turned. Short, dry, percussive. */
  | 'card'
  /** Several cards at once — a deal, or a pile being taken. */
  | 'deal'
  /** Chips going in: a bet, a call, a buy-in. */
  | 'chips'
  /** Your turn. The only sound that is a note rather than a noise, because it is addressed to you. */
  | 'turn'
  /** A meld going down, or a pot being won: something good, resolved. */
  | 'good'
  /** A refusal. Low and short — it should read as "no", not as an alarm. */
  | 'bad';

let ctx: AudioContext | null = null;
let enabled = read();

function read(): boolean {
  try {
    // ON by default. A room with the sound off by default is a room nobody knows has any.
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* a browser that will not remember still plays for this tab */
  }
  if (on) void resume();
}

/** Called from a real gesture. Before one, browsers refuse to start audio — and are right to. */
export async function resume(): Promise<void> {
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    ctx = null;
  }
}

/* ------------------------------------------------------------------ voices */

/** A short burst of filtered noise: a card on baize, a stack of chips. */
function noise(at: number, ms: number, freq: number, q: number, gain: number): void {
  if (!ctx) return;
  const frames = Math.max(1, Math.floor((ctx.sampleRate * ms) / 1000));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Linear decay over the burst. A card is loudest where it lands.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const vol = ctx.createGain();
  vol.gain.value = gain;
  src.connect(filter).connect(vol).connect(ctx.destination);
  src.start(at);
  src.stop(at + ms / 1000);
}

/** A shaped tone. Used only where the sound is addressed to the player rather than describing the table. */
function tone(at: number, ms: number, from: number, to: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + ms / 1000);
  const vol = ctx.createGain();
  // A short attack and a full decay: no click at either end.
  vol.gain.setValueAtTime(0.0001, at);
  vol.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  osc.connect(vol).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + ms / 1000 + 0.02);
}

/**
 * Play one of the table's sounds.
 *
 * Never throws, never awaits, and does nothing at all when sound is off or the player has not yet
 * touched the page. Call it freely from a reducer's neighbourhood; it is not a side effect anything
 * else depends on.
 */
export function play(name: SoundName): void {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  try {
    switch (name) {
      case 'card':
        noise(t, 55, 2400, 0.9, 0.16);
        break;
      case 'deal':
        // Four cards in quick succession — the sound of a deal, not of one card four times.
        for (let i = 0; i < 4; i++) noise(t + i * 0.055, 50, 2300 + i * 90, 0.9, 0.12);
        break;
      case 'chips':
        // Two closely spaced clicks: chips are never a single sound.
        noise(t, 38, 5200, 2.2, 0.1);
        noise(t + 0.035, 46, 3800, 1.8, 0.12);
        break;
      case 'turn':
        tone(t, 150, 660, 880, 0.06);
        break;
      case 'good':
        tone(t, 120, 523, 659, 0.05);
        tone(t + 0.1, 200, 784, 988, 0.05);
        break;
      case 'bad':
        tone(t, 180, 220, 165, 0.05, 'triangle');
        break;
    }
  } catch {
    /* an audio graph that will not build is not a reason for anything else to stop */
  }
}
