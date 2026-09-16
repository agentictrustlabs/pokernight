/**
 * THE CAST, OUT LOUD (docs/MYSTERY-NIGHT.md §11, road A).
 *
 * A mystery is people talking, so the characters an agent plays should be heard rather than read. They are
 * NOT participants in a meeting: their line arrives from the staging as text, every client says it locally,
 * and nothing is published to an SFU — seven characters cost zero participant-minutes, arrive instantly, and
 * everybody hears the same words because the words are the staging's. The 3D venue will pan these through
 * the same panners the lounge already builds; here they are simply spoken.
 *
 * EIGHT PEOPLE MUST NOT SOUND LIKE ONE. A browser may offer a dozen voices or two, so a character takes a
 * voice by its own name's hash AND a pitch and rate of its own — with two voices and eight characters they
 * are still told apart, which is the only thing that matters in a room where everybody is lying.
 *
 * THE RULES ARE THE COACH'S (`lib/speech.ts`): off until asked, a short queue that drops the OLDEST when the
 * room outruns the voice, and a watchdog, because Chrome loses `onend` often enough to wedge a queue for good.
 */
import { voices } from './speech';

const ON_KEY = 'pokernight.mystery.voices';

function synth(): SpeechSynthesis | null {
  try { return typeof speechSynthesis === 'undefined' ? null : speechSynthesis; } catch { return null; }
}

export function voicesAvailable(): boolean { return synth() !== null; }

export function castVoicesOn(): boolean {
  try { return localStorage.getItem(ON_KEY) === '1'; } catch { return false; }
}
export function setCastVoicesOn(on: boolean): void {
  try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch { /* this tab still speaks */ }
  if (!on) hushCast();
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** A character's own voice: which of the browser's, and how it is pitched. The house gets the low, slow one. */
export function voiceFor(role: string): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
  const all = voices();
  if (role === 'house') return { voice: all[all.length - 1] ?? all[0] ?? null, pitch: 0.8, rate: 0.82 };
  const h = hash(role);
  return {
    voice: all.length ? all[h % all.length]! : null,
    pitch: 0.82 + ((h >> 3) % 9) * 0.06,   // 0.82 … 1.30
    rate: 0.88 + ((h >> 7) % 5) * 0.06,    // 0.88 … 1.12
  };
}

interface Pending { role: string; text: string }
const queue: Pending[] = [];
const QUEUE_LIMIT = 2;
let speaking = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;

/** Say a character's line. Ignored unless the person asked for voices. */
/**
 * SAY THIS WHETHER OR NOT THE CAST ARE SPEAKING (2026-09-15).
 *
 * The cast's voices are a preference about how noisy the night is — seven people talking at once is a lot.
 * Looking at somebody or something is a QUESTION the player just asked, and an answer nobody hears is not an
 * answer. It goes through the same queue, so it still never talks over a line of the story.
 */
export function narrate(text: string): void {
  if (!synth() || !text.trim()) return;
  queue.push({ role: 'narrator', text: text.trim().slice(0, 240) });
  while (queue.length > QUEUE_LIMIT) queue.shift();
  pump();
}

export function sayAs(role: string, text: string): void {
  if (!castVoicesOn() || !synth() || !text.trim()) return;
  queue.push({ role, text: text.trim().slice(0, 240) });
  // A ROOM OUTRUNS A VOICE. Seven characters can speak in the time it takes to say one line, and hearing
  // what was said four moves ago over what is being said now is worse than not hearing it at all.
  while (queue.length > QUEUE_LIMIT) queue.shift();
  pump();
}

function pump(): void {
  const s = synth();
  if (!s || speaking) return;
  const next = queue.shift();
  if (!next) return;
  const pick = voiceFor(next.role);
  let u: SpeechSynthesisUtterance;
  try { u = new SpeechSynthesisUtterance(next.text); } catch { return; }
  if (pick.voice) u.voice = pick.voice;
  u.pitch = pick.pitch;
  u.rate = pick.rate;
  speaking = true;
  const done = () => {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    speaking = false;
    pump();
  };
  u.onend = done;
  u.onerror = done;
  watchdog = setTimeout(done, Math.min(15000, 900 + next.text.length * 75));
  try { s.speak(u); } catch { done(); }
}

/** Stop, and forget what was waiting — leaving a place, or switching voices off. */
export function hushCast(): void {
  queue.length = 0;
  speaking = false;
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  try { synth()?.cancel(); } catch { /* nothing to stop */ }
}
